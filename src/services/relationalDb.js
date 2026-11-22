/**
 * Banco Relacional Local Estruturado em IndexedDB (v1.2.0 · Lumière).
 *
 * Stores com índices relacionais (client-side SQL):
 * - works (keyPath: 'id', índices: by_status, by_format, by_franchise, by_updatedAt, by_favoriteRank)
 * - season_progress (keyPath: ['workId', 'seasonNumber'], índice: by_workId)
 * - episode_reviews (keyPath: ['workId', 'seasonNumber', 'episodeNumber'], índice: by_workId)
 * - sessions_log (keyPath: 'id', índices: by_workId, by_date)
 * - api_cache (keyPath: 'cacheKey', índice: by_expiresAt)
 *
 * Mantém espelho transparente em memória quando IndexedDB não está disponível
 * (ambientes node:test ou modo privado restrito) e realiza migração idempotente
 * com snapshot prévio obrigatório (`cine_codice_backup_pre_v1_2`).
 */

import { stripApiKeysFromUrl } from '../api/httpClient.js';
import {
  CACHE_TTL_MS,
  PRE_V12_BACKUP_KEY,
  RELATIONAL_DB_NAME,
  RELATIONAL_DB_VERSION,
  RELATIONAL_MIGRATED_KEY,
  RELATIONAL_STORES,
} from '../api/limits.js';
import {
  getSeasonEpisodeCount,
  isEpisodicWork,
  normalizeEpisodeMap,
  normalizeFillerEpisodes,
  normalizeStoryArcs,
} from '../utils/backlogHelpers.js';

function createEmptyMemoryDb() {
  return {
    [RELATIONAL_STORES.works]: new Map(),
    [RELATIONAL_STORES.seasonProgress]: new Map(),
    [RELATIONAL_STORES.episodeReviews]: new Map(),
    [RELATIONAL_STORES.sessionsLog]: new Map(),
    [RELATIONAL_STORES.apiCache]: new Map(),
  };
}

const memDb = createEmptyMemoryDb();

export function clearRelationalMemoryForTests() {
  for (const map of Object.values(memDb)) {
    map.clear();
  }
}

function makeSeasonCompositeKey(workId, seasonNumber) {
  return `${String(workId)}::${Math.max(1, Math.round(Number(seasonNumber) || 1))}`;
}

function makeEpisodeReviewCompositeKey(workId, seasonNumber, episodeNumber) {
  return `${String(workId)}::${Math.max(1, Math.round(Number(seasonNumber) || 1))}::${Math.max(1, Math.round(Number(episodeNumber) || 1))}`;
}

export function openRelationalDb(idbFactory = null) {
  const factory =
    idbFactory || (typeof indexedDB !== 'undefined' ? indexedDB : null);
  if (!factory || typeof factory.open !== 'function') {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    try {
      const req = factory.open(RELATIONAL_DB_NAME, RELATIONAL_DB_VERSION);
      req.onupgradeneeded = () => {
        try {
          const db = req.result;
          if (!db.objectStoreNames.contains(RELATIONAL_STORES.works)) {
            const worksStore = db.createObjectStore(RELATIONAL_STORES.works, {
              keyPath: 'id',
            });
            worksStore.createIndex('by_status', 'status', { unique: false });
            worksStore.createIndex('by_format', 'workType', { unique: false });
            worksStore.createIndex('by_franchise', 'franchiseName', { unique: false });
            worksStore.createIndex('by_updatedAt', 'updatedAt', { unique: false });
            worksStore.createIndex('by_favoriteRank', 'favoriteRank', { unique: false });
          }

          if (!db.objectStoreNames.contains(RELATIONAL_STORES.seasonProgress)) {
            const spStore = db.createObjectStore(RELATIONAL_STORES.seasonProgress, {
              keyPath: ['workId', 'seasonNumber'],
            });
            spStore.createIndex('by_workId', 'workId', { unique: false });
          }

          if (!db.objectStoreNames.contains(RELATIONAL_STORES.episodeReviews)) {
            const erStore = db.createObjectStore(RELATIONAL_STORES.episodeReviews, {
              keyPath: ['workId', 'seasonNumber', 'episodeNumber'],
            });
            erStore.createIndex('by_workId', 'workId', { unique: false });
          }

          if (!db.objectStoreNames.contains(RELATIONAL_STORES.sessionsLog)) {
            const slStore = db.createObjectStore(RELATIONAL_STORES.sessionsLog, {
              keyPath: 'id',
            });
            slStore.createIndex('by_workId', 'workId', { unique: false });
            slStore.createIndex('by_date', 'date', { unique: false });
          }

          if (!db.objectStoreNames.contains(RELATIONAL_STORES.apiCache)) {
            const acStore = db.createObjectStore(RELATIONAL_STORES.apiCache, {
              keyPath: 'cacheKey',
            });
            acStore.createIndex('by_expiresAt', 'expiresAt', { unique: false });
          }
        } catch {
          // Modo privado pode restringir schema IndexedDB
        }
      };
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function idbPutMany(db, storeName, records) {
  const list = Array.isArray(records) ? records.filter(Boolean) : [];
  if (!db || list.length === 0) return Promise.resolve({ ok: true, count: 0 });
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      for (const rec of list) {
        store.put(rec);
      }
      tx.oncomplete = () => resolve({ ok: true, count: list.length });
      tx.onerror = () => reject(tx.error || new Error('IDB write failed'));
      tx.onabort = () => reject(tx.error || new Error('IDB transaction aborted'));
    } catch (err) {
      reject(err);
    }
  });
}

function idbClearAndPutAll(db, storeName, records) {
  const list = Array.isArray(records) ? records.filter(Boolean) : [];
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      store.clear();
      for (const rec of list) {
        store.put(rec);
      }
      tx.oncomplete = () => resolve({ ok: true, count: list.length });
      tx.onerror = () => reject(tx.error || new Error('IDB replace failed'));
      tx.onabort = () => reject(tx.error || new Error('IDB replace aborted'));
    } catch (err) {
      reject(err);
    }
  });
}

function idbReadAll(db, storeName) {
  if (!db) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = () => reject(req.error || new Error('IDB read failed'));
    } catch (err) {
      reject(err);
    }
  });
}

function idbGetOne(db, storeName, key) {
  if (!db) return Promise.resolve(null);
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

function idbReadByIndex(db, storeName, indexName, keyValue) {
  if (!db) return Promise.resolve([]);
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const index = store.index(indexName);
      const req = index.getAll(keyValue);
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

function idbDeleteKeys(db, storeName, keys) {
  const list = Array.isArray(keys) ? keys : [];
  if (!db || list.length === 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      for (const k of list) {
        store.delete(k);
      }
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

/**
 * Normaliza registro mestre da store `works` garantindo campos R10/D2 e esquema v1.2.
 */
export function normalizeRelationalWorkRecord(work = {}) {
  const overview = String(work.overview ?? work.synopsis ?? '').trim();
  const moods = Array.isArray(work.moods)
    ? work.moods.filter(Boolean)
    : Array.isArray(work.atmosphere)
      ? work.atmosphere.filter(Boolean)
      : [];
  const tags = Array.isArray(work.tags)
    ? work.tags.filter(Boolean)
    : Array.isArray(work.tropes)
      ? work.tropes.filter(Boolean)
      : [];

  const rankNum = Number(work.favoriteRank);
  const favoriteRank =
    Number.isInteger(rankNum) && rankNum >= 1 && rankNum <= 4 ? rankNum : null;

  return {
    ...work,
    id: String(work.id || ''),
    workType: work.workType || 'movie',
    status: work.status || 'queued',
    franchiseName: String(work.franchiseName || '').trim(),
    overview,
    synopsis: overview,
    moods,
    atmosphere: moods,
    tags,
    favoriteRank,
    favoriteScene: String(work.favoriteScene || '').trim().slice(0, 200),
    totalSeasons: Math.max(1, Number(work.totalSeasons) || 1),
    totalEpisodes:
      Number(work.totalEpisodes) > 0 ? Math.round(Number(work.totalEpisodes)) : null,
    episodesPerSeason: Array.isArray(work.episodesPerSeason)
      ? work.episodesPerSeason.map((n) => Math.max(1, Math.round(Number(n) || 1)))
      : [],
    currentSeason: Math.max(1, Number(work.currentSeason) || 1),
    currentEpisode: Math.max(0, Number(work.currentEpisode) || 0),
    updatedAt: work.updatedAt || work.createdAt || new Date().toISOString(),
  };
}

/**
 * Deriva os registros da store `season_progress` ([workId, seasonNumber]) a partir de uma obra.
 */
export function buildSeasonProgressRecordsForWork(work = {}) {
  if (!work?.id || !isEpisodicWork(work)) return [];
  const workId = String(work.id);
  const totalSeasons = Math.max(1, Number(work.totalSeasons) || 1);
  const watchedMap = normalizeEpisodeMap(work.watchedEpisodes);
  const fillerList = normalizeFillerEpisodes(work.fillerEpisodes);
  const storyArcs = normalizeStoryArcs(work.storyArcs);

  const records = [];
  for (let s = 1; s <= totalSeasons; s += 1) {
    const epCount = getSeasonEpisodeCount(work, s);
    const watchedEpisodes = [];
    for (const [key, state] of Object.entries(watchedMap)) {
      if (state !== 'watched') continue;
      const [ks, ke] = key.split(':').map(Number);
      if (ks === s && ke >= 1) watchedEpisodes.push(ke);
    }
    watchedEpisodes.sort((a, b) => a - b);

    const fillerEpisodes = fillerList
      .map((key) => key.split(':').map(Number))
      .filter(([ks, ke]) => ks === s && ke >= 1)
      .map(([, ke]) => ke)
      .sort((a, b) => a - b);

    const arcs = storyArcs.filter((a) => Number(a.season) === s);
    const completed =
      work.status === 'completed' ||
      (epCount > 0 && watchedEpisodes.length >= epCount);

    records.push({
      workId,
      seasonNumber: s,
      title: `Temporada ${s}`,
      episodeCount: epCount,
      watchedEpisodes,
      fillerEpisodes,
      arcs,
      completed,
      updatedAt: work.updatedAt || new Date().toISOString(),
    });
  }
  return records;
}

/**
 * Converte um registro de avaliação por episódio para a store `episode_reviews`.
 */
export function toRelationalEpisodeReview(raw = {}) {
  if (!raw || !raw.workId) return null;
  const workId = String(raw.workId);
  const seasonNumber = Math.max(1, Math.round(Number(raw.seasonNumber ?? raw.season) || 1));
  const episodeNumber = Math.max(1, Math.round(Number(raw.episodeNumber ?? raw.episode) || 1));
  const rating =
    raw.rating === null || raw.rating === undefined || raw.rating === ''
      ? null
      : Math.max(0, Math.min(100, Math.round(Number(raw.rating))));
  return {
    workId,
    seasonNumber,
    episodeNumber,
    season: seasonNumber,
    episode: episodeNumber,
    rating,
    tag: raw.tag ? String(raw.tag).trim().slice(0, 40) : null,
    reaction: raw.reaction ? String(raw.reaction).trim().slice(0, 280) : '',
    episodeTitle: raw.episodeTitle ? String(raw.episodeTitle).trim() : '',
    updatedAt: raw.updatedAt || new Date().toISOString(),
  };
}

/**
 * Converte registro de sessão para a store `sessions_log`.
 */
export function toRelationalSessionLog(raw = {}, idx = 0) {
  if (!raw || typeof raw !== 'object') return null;
  const dateStr = String(
    raw.date || raw.loggedAt || raw.createdAt || new Date().toISOString()
  ).slice(0, 10);
  const id = String(
    raw.id || `sess-${raw.workId || raw.itemId || 'general'}-${dateStr}-${idx}`
  );
  return {
    id,
    workId: String(raw.workId || raw.itemId || 'general'),
    date: dateStr,
    minutes: Math.max(0, Math.round(Number(raw.minutes ?? raw.durationMinutes) || 0)),
    episodesCount: Math.max(0, Math.round(Number(raw.episodesCount ?? raw.episodes) || 0)),
    note: String(raw.note || raw.label || '').trim().slice(0, 200),
    createdAt: raw.createdAt || raw.loggedAt || `${dateStr}T12:00:00.000Z`,
  };
}

export async function putRelationalWorks(works = [], { idbFactory = null, replace = false } = {}) {
  const normalized = (Array.isArray(works) ? works : [])
    .filter((w) => w && w.id)
    .map(normalizeRelationalWorkRecord);

  const seasonRecords = normalized.flatMap((w) => buildSeasonProgressRecordsForWork(w));

  if (replace) {
    memDb[RELATIONAL_STORES.works].clear();
    memDb[RELATIONAL_STORES.seasonProgress].clear();
  }
  for (const w of normalized) {
    memDb[RELATIONAL_STORES.works].set(w.id, w);
  }
  for (const sp of seasonRecords) {
    memDb[RELATIONAL_STORES.seasonProgress].set(
      makeSeasonCompositeKey(sp.workId, sp.seasonNumber),
      sp
    );
  }

  const db = await openRelationalDb(idbFactory);
  if (!db) return { ok: true, persisted: false, worksCount: normalized.length };
  try {
    if (replace) {
      await idbClearAndPutAll(db, RELATIONAL_STORES.works, normalized);
      await idbClearAndPutAll(db, RELATIONAL_STORES.seasonProgress, seasonRecords);
    } else {
      await idbPutMany(db, RELATIONAL_STORES.works, normalized);
      await idbPutMany(db, RELATIONAL_STORES.seasonProgress, seasonRecords);
    }
    return { ok: true, persisted: true, worksCount: normalized.length };
  } catch (err) {
    return { ok: false, persisted: false, error: err?.message || 'RELATIONAL_WORKS_WRITE_ERROR' };
  } finally {
    try {
      db.close?.();
    } catch {
      // Silencioso
    }
  }
}

export async function getAllRelationalWorks({ idbFactory = null } = {}) {
  const db = await openRelationalDb(idbFactory);
  if (db) {
    try {
      const list = await idbReadAll(db, RELATIONAL_STORES.works);
      if (list.length > 0) {
        list.forEach((w) => memDb[RELATIONAL_STORES.works].set(w.id, w));
        return list;
      }
    } catch {
      // Fallback para memória
    } finally {
      try {
        db.close?.();
      } catch {
        // Silencioso
      }
    }
  }
  return Array.from(memDb[RELATIONAL_STORES.works].values());
}

export async function getSeasonProgressByWork(workId, { idbFactory = null } = {}) {
  const cleanId = String(workId || '').trim();
  if (!cleanId) return [];
  const db = await openRelationalDb(idbFactory);
  if (db) {
    try {
      const rows = await idbReadByIndex(db, RELATIONAL_STORES.seasonProgress, 'by_workId', cleanId);
      if (rows.length > 0) {
        return rows.sort((a, b) => a.seasonNumber - b.seasonNumber);
      }
    } catch {
      // Fallback em memória
    } finally {
      try {
        db.close?.();
      } catch {
        // Silencioso
      }
    }
  }
  return Array.from(memDb[RELATIONAL_STORES.seasonProgress].values())
    .filter((sp) => sp.workId === cleanId)
    .sort((a, b) => a.seasonNumber - b.seasonNumber);
}

export async function putRelationalEpisodeReview(review, { idbFactory = null } = {}) {
  const record = toRelationalEpisodeReview(review);
  if (!record) return { ok: false, persisted: false };
  memDb[RELATIONAL_STORES.episodeReviews].set(
    makeEpisodeReviewCompositeKey(record.workId, record.seasonNumber, record.episodeNumber),
    record
  );

  const db = await openRelationalDb(idbFactory);
  if (!db) return { ok: true, persisted: false, record };
  try {
    await idbPutMany(db, RELATIONAL_STORES.episodeReviews, [record]);
    return { ok: true, persisted: true, record };
  } catch {
    return { ok: false, persisted: false, record };
  } finally {
    try {
      db.close?.();
    } catch {
      // Silencioso
    }
  }
}

export async function getEpisodeReviewsByWork(workId, { idbFactory = null } = {}) {
  const cleanId = String(workId || '').trim();
  if (!cleanId) return [];
  const db = await openRelationalDb(idbFactory);
  if (db) {
    try {
      const rows = await idbReadByIndex(db, RELATIONAL_STORES.episodeReviews, 'by_workId', cleanId);
      if (rows.length > 0) return rows;
    } catch {
      // Fallback em memória
    } finally {
      try {
        db.close?.();
      } catch {
        // Silencioso
      }
    }
  }
  return Array.from(memDb[RELATIONAL_STORES.episodeReviews].values()).filter(
    (r) => r.workId === cleanId
  );
}

export async function putRelationalSessions(sessions = [], { idbFactory = null, replace = false } = {}) {
  const records = (Array.isArray(sessions) ? sessions : [])
    .map((s, idx) => toRelationalSessionLog(s, idx))
    .filter(Boolean);

  if (replace) {
    memDb[RELATIONAL_STORES.sessionsLog].clear();
  }
  for (const r of records) {
    memDb[RELATIONAL_STORES.sessionsLog].set(r.id, r);
  }

  const db = await openRelationalDb(idbFactory);
  if (!db) return { ok: true, persisted: false, count: records.length };
  try {
    if (replace) {
      await idbClearAndPutAll(db, RELATIONAL_STORES.sessionsLog, records);
    } else {
      await idbPutMany(db, RELATIONAL_STORES.sessionsLog, records);
    }
    return { ok: true, persisted: true, count: records.length };
  } catch {
    return { ok: false, persisted: false, count: records.length };
  } finally {
    try {
      db.close?.();
    } catch {
      // Silencioso
    }
  }
}

export async function getAllRelationalSessions({ idbFactory = null } = {}) {
  const db = await openRelationalDb(idbFactory);
  if (db) {
    try {
      const list = await idbReadAll(db, RELATIONAL_STORES.sessionsLog);
      if (list.length > 0) return list;
    } catch {
      // Fallback
    } finally {
      try {
        db.close?.();
      } catch {
        // Silencioso
      }
    }
  }
  return Array.from(memDb[RELATIONAL_STORES.sessionsLog].values());
}

export async function getApiCacheEntry(
  rawKey,
  { now = Date.now(), allowStale = false, idbFactory = null } = {}
) {
  const cacheKey = stripApiKeysFromUrl(String(rawKey || '').trim());
  if (!cacheKey) return { hit: false, data: null };

  const memRec = memDb[RELATIONAL_STORES.apiCache].get(cacheKey);
  if (memRec) {
    const expired = Number(memRec.expiresAt || 0) <= now;
    if (!expired || allowStale) {
      return { hit: true, stale: expired, data: memRec.data, updatedAt: memRec.updatedAt };
    }
  }

  const db = await openRelationalDb(idbFactory);
  if (db) {
    try {
      const rec = await idbGetOne(db, RELATIONAL_STORES.apiCache, cacheKey);
      if (rec) {
        memDb[RELATIONAL_STORES.apiCache].set(cacheKey, rec);
        const expired = Number(rec.expiresAt || 0) <= now;
        if (!expired || allowStale) {
          return { hit: true, stale: expired, data: rec.data, updatedAt: rec.updatedAt };
        }
      }
    } catch {
      // Silencioso
    } finally {
      try {
        db.close?.();
      } catch {
        // Silencioso
      }
    }
  }
  return { hit: false, stale: false, data: null };
}

export async function setApiCacheEntry(
  rawKey,
  data,
  { ttlMs = CACHE_TTL_MS.ratings, now = Date.now(), idbFactory = null } = {}
) {
  const cacheKey = stripApiKeysFromUrl(String(rawKey || '').trim());
  if (!cacheKey || data === undefined) return false;
  const record = {
    cacheKey,
    data,
    updatedAt: now,
    expiresAt: now + Math.max(1000, Number(ttlMs) || CACHE_TTL_MS.ratings),
  };
  memDb[RELATIONAL_STORES.apiCache].set(cacheKey, record);

  const db = await openRelationalDb(idbFactory);
  if (!db) return true;
  try {
    await idbPutMany(db, RELATIONAL_STORES.apiCache, [record]);
    return true;
  } catch {
    return false;
  } finally {
    try {
      db.close?.();
    } catch {
      // Silencioso
    }
  }
}

export async function purgeExpiredApiCache({ now = Date.now(), idbFactory = null } = {}) {
  for (const [k, rec] of memDb[RELATIONAL_STORES.apiCache].entries()) {
    if (Number(rec.expiresAt || 0) <= now) {
      memDb[RELATIONAL_STORES.apiCache].delete(k);
    }
  }
  const db = await openRelationalDb(idbFactory);
  if (!db) return 0;
  try {
    const all = await idbReadAll(db, RELATIONAL_STORES.apiCache);
    const expiredKeys = all
      .filter((r) => Number(r.expiresAt || 0) <= now)
      .map((r) => r.cacheKey);
    if (expiredKeys.length > 0) {
      await idbDeleteKeys(db, RELATIONAL_STORES.apiCache, expiredKeys);
    }
    return expiredKeys.length;
  } catch {
    return 0;
  } finally {
    try {
      db.close?.();
    } catch {
      // Silencioso
    }
  }
}

/**
 * Migração idempotente da v1.0/v1.1 (localStorage + store antiga) para o IndexedDB Relacional v1.2:
 * 1) Grava snapshot prévio obrigatório (`cine_codice_backup_pre_v1_2`) e lê de volta para confirmar;
 * 2) Migra `works`, `season_progress`, `episode_reviews` e `sessions_log`;
 * 3) Preserva tudo de forma não destrutiva e idempotente (pode rodar N vezes sem duplicar).
 */
export async function migrateLegacyToRelationalDb({
  items = [],
  sessions = [],
  episodeEvaluations = [],
  profile = null,
  collections = [],
  idbFactory = null,
  storage = typeof localStorage !== 'undefined' ? localStorage : null,
  force = false,
} = {}) {
  const safeItems = Array.isArray(items) ? items.filter((i) => i && i.id) : [];
  const safeSessions = Array.isArray(sessions) ? sessions : [];
  const safeReviews = Array.isArray(episodeEvaluations) ? episodeEvaluations : [];

  try {
    if (!force && storage?.getItem?.(RELATIONAL_MIGRATED_KEY) === '1.2-relational') {
      return { ok: true, alreadyMigrated: true, snapshotSaved: true };
    }
  } catch {
    // Continua migração em memória se storage falhar
  }

  // 1. Grava e verifica snapshot pré-v1.2 antes de alterar o esquema relacional IndexedDB
  let snapshotSaved = false;
  if (storage && typeof storage.setItem === 'function') {
    const preBackup = {
      schemaVersion: '1.1-pre-v1.2-snapshot',
      createdAt: new Date().toISOString(),
      itemsCount: safeItems.length,
      items: safeItems,
      profile,
      collections,
      sessions: safeSessions,
      episodeEvaluations: safeReviews,
    };
    try {
      storage.setItem(PRE_V12_BACKUP_KEY, JSON.stringify(preBackup));
      const readBackRaw = storage.getItem(PRE_V12_BACKUP_KEY);
      const readBack = readBackRaw ? JSON.parse(readBackRaw) : null;
      if (readBack && Number(readBack.itemsCount) === safeItems.length) {
        snapshotSaved = true;
      }
    } catch {
      // Se localStorage falhar por cota cheia, não apaga os dados originais
      snapshotSaved = false;
    }
  }

  // 2. Popula stores relacionais em memória + IndexedDB de forma idempotente
  const worksRes = await putRelationalWorks(safeItems, { idbFactory, replace: true });
  await putRelationalSessions(safeSessions, { idbFactory, replace: true });

  const normalizedReviews = safeReviews
    .map(toRelationalEpisodeReview)
    .filter(Boolean);
  for (const rev of normalizedReviews) {
    memDb[RELATIONAL_STORES.episodeReviews].set(
      makeEpisodeReviewCompositeKey(rev.workId, rev.seasonNumber, rev.episodeNumber),
      rev
    );
  }
  const db = await openRelationalDb(idbFactory);
  if (db) {
    try {
      await idbClearAndPutAll(db, RELATIONAL_STORES.episodeReviews, normalizedReviews);
    } catch {
      // Ignora erro mantendo em memória
    } finally {
      try {
        db.close?.();
      } catch {
        // Silencioso
      }
    }
  }

  if (worksRes.ok && storage && typeof storage.setItem === 'function') {
    try {
      storage.setItem(RELATIONAL_MIGRATED_KEY, '1.2-relational');
    } catch {
      // Silencioso
    }
  }

  return {
    ok: worksRes.ok,
    alreadyMigrated: false,
    snapshotSaved,
    persisted: Boolean(worksRes.persisted),
    counts: {
      works: safeItems.length,
      seasons: safeItems.filter(isEpisodicWork).reduce(
        (sum, w) => sum + Math.max(1, Number(w.totalSeasons) || 1),
        0
      ),
      episodeReviews: normalizedReviews.length,
      sessions: safeSessions.length,
    },
  };
}
