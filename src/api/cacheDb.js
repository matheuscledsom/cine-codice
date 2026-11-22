/**
 * Camada de cache persistente no IndexedDB com versão de schema, TTL por tipo
 * e armazenamento durável sem TTL para avaliações por episódio (D4).
 *
 * Também mantém fallback em memória para ambientes sem IndexedDB (ex.: node --test).
 * Módulo puro em .js (D7).
 */

import {
  CACHE_DB_NAME,
  CACHE_SCHEMA_VERSION,
  CACHE_STORES,
  CACHE_TTL_MS,
  DURABLE_STORES,
  MAX_MEMORY_CACHE_ENTRIES_PER_STORE,
} from './limits.js';

const ALL_TTL_STORES = Object.values(CACHE_STORES);

function createEmptyMemoryState() {
  const stores = new Map();
  ALL_TTL_STORES.forEach((name) => stores.set(name, new Map()));
  stores.set(DURABLE_STORES.episodeEvaluations, new Map());
  return stores;
}

const memoryStores = createEmptyMemoryState();

export function clearMemoryApiCacheForTests() {
  for (const map of memoryStores.values()) {
    map.clear();
  }
}

export function formatCacheDatePt(timestampMs) {
  const num = Number(timestampMs);
  if (!Number.isFinite(num) || num <= 0) return '';
  const d = new Date(num);
  if (Number.isNaN(d.getTime())) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `dados de ${day}/${month}`;
}

export function getEpisodesTtlMs(showStatus = '') {
  const clean = String(showStatus || '')
    .trim()
    .toLowerCase();
  if (!clean) return CACHE_TTL_MS.episodesOngoing;
  if (
    /finaliz|finished|ended|canceled|cancelled|completed/.test(clean)
  ) {
    return CACHE_TTL_MS.episodesFinished;
  }
  return CACHE_TTL_MS.episodesOngoing;
}

function getDefaultTtlForStore(storeName) {
  if (storeName === CACHE_STORES.ratings) return CACHE_TTL_MS.ratings;
  if (storeName === CACHE_STORES.episodes) return CACHE_TTL_MS.episodesOngoing;
  if (storeName === CACHE_STORES.relations) return CACHE_TTL_MS.relations;
  if (storeName === CACHE_STORES.search) return CACHE_TTL_MS.search;
  return CACHE_TTL_MS.search;
}

function isQuotaError(err) {
  if (!err) return false;
  return (
    err.name === 'QuotaExceededError' ||
    err.code === 22 ||
    err.code === 1014 ||
    /quota/i.test(String(err.message || ''))
  );
}

function openApiCacheDb(idbFactory = null) {
  const factory =
    idbFactory ||
    (typeof indexedDB !== 'undefined' ? indexedDB : null);
  if (!factory) return Promise.resolve(null);

  return new Promise((resolve) => {
    try {
      const req = factory.open(CACHE_DB_NAME, CACHE_SCHEMA_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const storeName of ALL_TTL_STORES) {
          if (!db.objectStoreNames.contains(storeName)) {
            const store = db.createObjectStore(storeName, { keyPath: 'cacheKey' });
            store.createIndex('updatedAt', 'updatedAt', { unique: false });
          }
        }
        if (!db.objectStoreNames.contains(DURABLE_STORES.episodeEvaluations)) {
          const evalStore = db.createObjectStore(DURABLE_STORES.episodeEvaluations, {
            keyPath: 'evalKey',
          });
          evalStore.createIndex('workId', 'workId', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function setMemoryEntry(storeName, keyField, record, maxEntries = MAX_MEMORY_CACHE_ENTRIES_PER_STORE) {
  const map = memoryStores.get(storeName);
  if (!map) return;
  const key = record[keyField];
  if (map.has(key)) map.delete(key);
  if (storeName !== DURABLE_STORES.episodeEvaluations) {
    while (map.size >= maxEntries) {
      let oldestKey = null;
      let oldestTime = Infinity;
      for (const [k, rec] of map.entries()) {
        const t = Number(rec.updatedAt || rec.fetchedAt || 0);
        if (t < oldestTime) {
          oldestTime = t;
          oldestKey = k;
        }
      }
      if (!oldestKey) break;
      map.delete(oldestKey);
    }
  }
  map.set(key, record);
}

async function idbGet(db, storeName, key) {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbGetAll(db, storeName) {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

async function idbDeleteKeys(db, storeName, keys = []) {
  if (!keys.length) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      keys.forEach((k) => store.delete(k));
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

async function idbPut(db, storeName, record) {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(record);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error || new Error('IDB put error'));
      tx.onabort = () => reject(tx.error || new Error('IDB put aborted'));
    } catch (err) {
      reject(err);
    }
  });
}

export async function evictOldestCacheEntries(
  {
    fraction = 0.25,
    minDeleteCount = 1,
    db = null,
    idbFactory = null,
  } = {}
) {
  let evicted = 0;

  for (const storeName of ALL_TTL_STORES) {
    const map = memoryStores.get(storeName);
    if (map && map.size > 0) {
      const entries = Array.from(map.entries()).sort(
        (a, b) => Number(a[1].updatedAt || 0) - Number(b[1].updatedAt || 0)
      );
      const count = Math.min(
        entries.length,
        Math.max(minDeleteCount, Math.ceil(entries.length * fraction))
      );
      for (let i = 0; i < count; i += 1) {
        map.delete(entries[i][0]);
        evicted += 1;
      }
    }
  }

  const targetDb = db || (await openApiCacheDb(idbFactory));
  if (targetDb) {
    try {
      for (const storeName of ALL_TTL_STORES) {
        const all = await idbGetAll(targetDb, storeName);
        if (all.length === 0) continue;
        all.sort((a, b) => Number(a.updatedAt || 0) - Number(b.updatedAt || 0));
        const count = Math.min(
          all.length,
          Math.max(minDeleteCount, Math.ceil(all.length * fraction))
        );
        const keys = all.slice(0, count).map((r) => r.cacheKey).filter(Boolean);
        await idbDeleteKeys(targetDb, storeName, keys);
        evicted += keys.length;
      }
    } finally {
      if (!db) targetDb.close?.();
    }
  }

  return evicted;
}

export async function getCachedEntry(
  storeName,
  cacheKey,
  {
    now = Date.now(),
    allowStaleOffline = false,
    idbFactory = null,
  } = {}
) {
  if (!ALL_TTL_STORES.includes(storeName) || !cacheKey) {
    return { hit: false, expired: false, stale: false, data: null };
  }

  let record = memoryStores.get(storeName)?.get(String(cacheKey)) || null;

  if (!record) {
    const db = await openApiCacheDb(idbFactory);
    if (db) {
      try {
        record = await idbGet(db, storeName, String(cacheKey));
        if (record) {
          setMemoryEntry(storeName, 'cacheKey', record);
        }
      } finally {
        db.close?.();
      }
    }
  }

  if (!record) {
    return { hit: false, expired: false, stale: false, data: null };
  }

  const expiresAt = Number(record.expiresAt) || 0;
  const isExpired = expiresAt > 0 && now >= expiresAt;
  const fetchedAt = Number(record.fetchedAt || record.updatedAt) || 0;
  const cacheDateLabel = formatCacheDatePt(fetchedAt);

  if (isExpired && !allowStaleOffline) {
    return {
      hit: false,
      expired: true,
      stale: true,
      data: null,
      fetchedAt,
      expiresAt,
      cacheDateLabel,
    };
  }

  return {
    hit: true,
    expired: isExpired,
    stale: isExpired,
    data: record.data,
    fetchedAt,
    expiresAt,
    cacheDateLabel,
  };
}

export async function setCachedEntry(
  storeName,
  cacheKey,
  data,
  {
    ttlMs = null,
    now = Date.now(),
    maxMemoryEntries = MAX_MEMORY_CACHE_ENTRIES_PER_STORE,
    idbFactory = null,
    onQuotaTestHook = null,
  } = {}
) {
  if (!ALL_TTL_STORES.includes(storeName) || !cacheKey) {
    return { saved: false, evicted: 0 };
  }

  const resolvedTtl = Number(ttlMs) > 0 ? Number(ttlMs) : getDefaultTtlForStore(storeName);
  const record = {
    cacheKey: String(cacheKey),
    data,
    fetchedAt: now,
    updatedAt: now,
    expiresAt: now + resolvedTtl,
    schemaVersion: CACHE_SCHEMA_VERSION,
  };

  setMemoryEntry(storeName, 'cacheKey', record, maxMemoryEntries);

  let evicted = 0;

  if (typeof onQuotaTestHook === 'function') {
    try {
      await onQuotaTestHook(record);
    } catch (err) {
      if (isQuotaError(err)) {
        evicted += await evictOldestCacheEntries({ fraction: 0.25, idbFactory });
        await onQuotaTestHook(record, { retriedAfterEviction: true });
      } else {
        throw err;
      }
    }
  }

  const db = await openApiCacheDb(idbFactory);
  if (db) {
    try {
      try {
        await idbPut(db, storeName, record);
      } catch (err) {
        if (isQuotaError(err)) {
          evicted += await evictOldestCacheEntries({ db, fraction: 0.25 });
          await idbPut(db, storeName, record);
        } else {
          return { saved: false, evicted };
        }
      }
    } catch {
      return { saved: false, evicted };
    } finally {
      db.close?.();
    }
  }

  return { saved: true, evicted, record };
}

/**
 * Armazenamento durável (sem TTL) para avaliações por episódio (D4 / R10).
 * Chave canônica: `workId:S:E`.
 */
export function makeEpisodeEvalKey(workId, season, episode) {
  const w = String(workId || '').trim();
  const s = Math.max(1, Math.round(Number(season) || 1));
  const e = Math.max(1, Math.round(Number(episode) || 1));
  return `${w}:${s}:${e}`;
}

export async function saveEpisodeEvaluation(
  evaluation,
  { now = Date.now(), idbFactory = null } = {}
) {
  if (!evaluation?.workId) return null;
  const season = Math.max(1, Math.round(Number(evaluation.season) || 1));
  const episode = Math.max(1, Math.round(Number(evaluation.episode) || 1));
  const evalKey = makeEpisodeEvalKey(evaluation.workId, season, episode);
  const record = {
    evalKey,
    workId: String(evaluation.workId),
    source: evaluation.source || null,
    season,
    episode,
    rating:
      evaluation.rating !== null && evaluation.rating !== undefined && evaluation.rating !== ''
        ? Math.max(0, Math.min(100, Math.round(Number(evaluation.rating))))
        : null,
    tag: evaluation.tag || null,
    reaction: String(evaluation.reaction || '').slice(0, 280),
    updatedAt: evaluation.updatedAt || now,
  };

  setMemoryEntry(DURABLE_STORES.episodeEvaluations, 'evalKey', record);

  const db = await openApiCacheDb(idbFactory);
  if (db) {
    try {
      await idbPut(db, DURABLE_STORES.episodeEvaluations, record);
    } catch {
      // Preserva em memória se IndexedDB falhar
    } finally {
      db.close?.();
    }
  }
  return record;
}

export async function getEpisodeEvaluationsForWork(
  workId,
  { idbFactory = null } = {}
) {
  const targetId = String(workId || '').trim();
  if (!targetId) return [];

  const db = await openApiCacheDb(idbFactory);
  if (db) {
    try {
      const all = await idbGetAll(db, DURABLE_STORES.episodeEvaluations);
      const filtered = all.filter((r) => String(r.workId) === targetId);
      filtered.forEach((rec) =>
        setMemoryEntry(DURABLE_STORES.episodeEvaluations, 'evalKey', rec)
      );
      if (filtered.length > 0) return filtered;
    } finally {
      db.close?.();
    }
  }

  const memMap = memoryStores.get(DURABLE_STORES.episodeEvaluations);
  return Array.from(memMap.values()).filter((r) => String(r.workId) === targetId);
}

export async function getAllEpisodeEvaluations({ idbFactory = null } = {}) {
  const db = await openApiCacheDb(idbFactory);
  if (db) {
    try {
      const all = await idbGetAll(db, DURABLE_STORES.episodeEvaluations);
      all.forEach((rec) =>
        setMemoryEntry(DURABLE_STORES.episodeEvaluations, 'evalKey', rec)
      );
      return all;
    } finally {
      db.close?.();
    }
  }
  return Array.from(memoryStores.get(DURABLE_STORES.episodeEvaluations).values());
}
