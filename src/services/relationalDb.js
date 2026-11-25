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

import {
  inferDomainFromWork,
  normalizeDomainId,
  normalizeGameEditionType,
  normalizeWorkTypeForDomain,
} from '../config/domainConfig.js';
import { getEditionBaseWorkId } from '../lib/bookEditions.js';
import { normalizeAchievementsModel } from '../lib/gameDepth.js';
import { isCompressedManualCoverDataUrl } from '../lib/manualCovers.js';
import { stripApiKeysFromUrl } from '../api/httpClient.js';
import {
  CACHE_TTL_MS,
  PRE_SCHEMA_MIGRATION_BACKUP_KEY,
  PRE_V12_BACKUP_KEY,
  RELATIONAL_DB_NAME,
  RELATIONAL_DB_VERSION,
  RELATIONAL_MIGRATED_KEY,
  RELATIONAL_SCHEMA_VERSION_KEY,
  RELATIONAL_STORES,
} from '../api/limits.js';
import {
  gameRating11ToInternal,
  isFiveCriteriaRecord,
  normalizeCriteria5,
  resolveLifeWorkFlag,
} from '../lib/ratingModel.js';
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

export const RELATIONAL_SCHEMA_META_KEY = '__omniprism_schema_meta__';

const VALID_FRANCHISE_TIERS = new Set(['mainline', 'spinoff', 'companion', 'unclassified']);

function normalizeFranchiseTierValue(raw) {
  const clean = String(raw || '').trim().toLowerCase();
  return VALID_FRANCHISE_TIERS.has(clean) ? clean : '';
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
      req.onupgradeneeded = (event) => {
        try {
          const db = req.result;
          const oldVersion = Number(event?.oldVersion || 0);
          if (oldVersion < 1) {
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
          }
          // v1 -> v2 é estritamente aditiva nos documentos armazenados em `works`,
          // preservando todas as 5 stores, índices e dados existentes sem exclusão.
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
  const domain = inferDomainFromWork(work);
  const workType = normalizeWorkTypeForDomain(work.workType || work.mediaType, domain);
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

  const lifeWork = resolveLifeWorkFlag(work);
  const legacyGameConv =
    work.rating === null || work.rating === undefined || work.rating === ''
      ? gameRating11ToInternal(work.gameRating11)
      : { score100: null };
  const resolvedRating =
    work.rating !== null && work.rating !== undefined && work.rating !== '' && Number.isFinite(Number(work.rating))
      ? Math.max(0, Math.min(100, Math.round(Number(work.rating))))
      : legacyGameConv.score100;
  const reviewCriteria5 = work.reviewCriteria5
    ? normalizeCriteria5(work.reviewCriteria5, domain)
    : isFiveCriteriaRecord(work.reviewCriteria, domain)
      ? normalizeCriteria5(work.reviewCriteria, domain)
      : null;

  return {
    ...work,
    id: String(work.id || ''),
    domain,
    workType,
    mediaType: workType,
    status: work.status || 'queued',
    rating: resolvedRating,
    lifeWork,
    ratingManualOverride: Boolean(work.ratingManualOverride),
    reviewCriteria5,
    franchiseTier: normalizeFranchiseTierValue(
      work.franchiseTier ?? work.progress_data?.franchiseTier
    ),
    editionOf: (() => {
      const clean = String(work.editionOf ?? work.progress_data?.editionOf ?? '').trim();
      return clean && clean !== String(work.id || '') ? clean : null;
    })(),
    releasedEpisodesCount:
      Number(work.releasedEpisodesCount) > 0
        ? Math.floor(Number(work.releasedEpisodesCount))
        : null,
    releasedEpisodesSource: String(work.releasedEpisodesSource || '').trim() || null,
    releasedEpisodesFetchedAt: work.releasedEpisodesFetchedAt || null,
    excludeFromDiscography: Boolean(
      work.excludeFromDiscography ?? work.progress_data?.excludeFromDiscography
    ),
    igdbId:
      Number(work.igdbId ?? work.ids?.igdb ?? work.progress_data?.igdbId) > 0
        ? Math.floor(Number(work.igdbId ?? work.ids?.igdb ?? work.progress_data?.igdbId))
        : null,
    rawgId:
      Number(work.rawgId ?? work.ids?.rawg ?? work.progress_data?.rawgId) > 0
        ? Math.floor(Number(work.rawgId ?? work.ids?.rawg ?? work.progress_data?.rawgId))
        : null,
    campaignTimeHours:
      Number(work.campaignTimeHours ?? work.progress_data?.campaignTimeHours) > 0
        ? Math.round(Number(work.campaignTimeHours ?? work.progress_data?.campaignTimeHours) * 10) / 10
        : null,
    campaignTimeSource:
      String(work.campaignTimeSource ?? work.progress_data?.campaignTimeSource ?? '').trim() || null,
    rawgPlaytimeHours:
      Number(work.rawgPlaytimeHours ?? work.progress_data?.rawgPlaytimeHours) > 0
        ? Math.round(Number(work.rawgPlaytimeHours ?? work.progress_data?.rawgPlaytimeHours) * 10) / 10
        : null,
    rawgPlaytimeSource:
      String(work.rawgPlaytimeSource ?? work.progress_data?.rawgPlaytimeSource ?? '').trim() || null,
    manualCampaignHours:
      Number(work.manualCampaignHours ?? work.progress_data?.manualCampaignHours) > 0
        ? Math.round(Number(work.manualCampaignHours ?? work.progress_data?.manualCampaignHours) * 10) / 10
        : null,
    completion100Hours:
      Number(work.completion100Hours ?? work.progress_data?.completion100Hours) > 0
        ? Math.round(Number(work.completion100Hours ?? work.progress_data?.completion100Hours) * 10) / 10
        : null,
    completion100Source:
      String(work.completion100Source ?? work.progress_data?.completion100Source ?? '').trim() || null,
    parentGame: work.parentGame ?? work.progress_data?.parentGame ?? null,
    versionParent: work.versionParent ?? work.progress_data?.versionParent ?? null,
    achievements: normalizeAchievementsModel(work.achievements ?? work.progress_data?.achievements),
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
    // Leitura & Acadêmico
    pagesRead: Math.max(0, Math.round(Number(work.pagesRead) || 0)),
    totalPages: Number(work.totalPages) > 0 ? Math.round(Number(work.totalPages)) : null,
    chaptersRead: Math.max(0, Math.round(Number(work.chaptersRead) || 0)),
    isbnOrDoi: String(work.isbnOrDoi || work.isbn || work.doi || '').trim(),
    bookFormat: String(work.bookFormat || '').trim(),
    seriesVolume: String(work.seriesVolume ?? work.progress_data?.seriesVolume ?? '').trim(),
    workUrl: /^https?:\/\//i.test(String(work.workUrl ?? work.progress_data?.workUrl ?? '').trim())
      ? String(work.workUrl ?? work.progress_data?.workUrl).trim()
      : '',
    isManual: Boolean(work.isManual || work.ids?.source === 'manual' || work.progress_data?.isManual),
    manualCoverDataUrl: isCompressedManualCoverDataUrl(work.manualCoverDataUrl)
      ? work.manualCoverDataUrl
      : isCompressedManualCoverDataUrl(work.coverUrl)
        ? work.coverUrl
        : '',
    coverUrl:
      work.coverUrl ||
      (isCompressedManualCoverDataUrl(work.manualCoverDataUrl) ? work.manualCoverDataUrl : null),
    // Games (preserva plataformas reais e edição sem inventar PC)
    platform: String(work.platform || '').trim(),
    platforms: Array.isArray(work.platforms)
      ? Array.from(new Set(work.platforms.map((p) => String(p || '').trim()).filter(Boolean)))
      : [],
    originalPlatforms: Array.isArray(work.originalPlatforms ?? work.progress_data?.originalPlatforms)
      ? Array.from(
          new Set(
            (work.originalPlatforms ?? work.progress_data?.originalPlatforms)
              .map((p) => String(p || '').trim())
              .filter(Boolean)
          )
        )
      : [],
    editionType:
      domain === 'games'
        ? normalizeGameEditionType(work.editionType)
        : String(work.editionType || '').trim(),
    gameRating11:
      work.gameRating11 !== null &&
      work.gameRating11 !== undefined &&
      work.gameRating11 !== '' &&
      Number.isFinite(Number(work.gameRating11))
        ? Math.max(0, Math.min(11, Math.round(Number(work.gameRating11) * 10) / 10))
        : null,
    masterpieceJustification: String(work.masterpieceJustification || '').trim().slice(0, 400),
    hoursPlayed: Math.max(0, Number(work.hoursPlayed) || 0),
    completionType: String(work.completionType || '').trim(),
    storeOrLauncher: String(work.storeOrLauncher || '').trim(),
    buildOrCharacter: String(work.buildOrCharacter || '').trim(),
    // Música
    albumName: String(work.albumName || '').trim(),
    durationMs: Number(work.durationMs) > 0 ? Math.round(Number(work.durationMs)) : null,
    trackRating10:
      work.trackRating10 !== null &&
      work.trackRating10 !== undefined &&
      work.trackRating10 !== '' &&
      Number.isFinite(Number(work.trackRating10))
        ? Math.max(0, Math.min(10, Math.round(Number(work.trackRating10) * 10) / 10))
        : null,
    favoriteTrack: String(work.favoriteTrack || '').trim(),
    subgenre: String(work.subgenre || '').trim(),
    releaseFormat: String(work.releaseFormat || '').trim(),
    listenCount: Math.max(0, Math.round(Number(work.listenCount) || 0)),
    tracks: Array.isArray(work.tracks) ? work.tracks : [],
    trackRatings:
      work.trackRatings &&
      typeof work.trackRatings === 'object' &&
      !Array.isArray(work.trackRatings)
        ? work.trackRatings
        : {},
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
        const migrated = list.map((w) => normalizeRelationalWorkRecord(w));
        migrated.forEach((w) => memDb[RELATIONAL_STORES.works].set(w.id, w));
        return migrated;
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
  return Array.from(memDb[RELATIONAL_STORES.works].values()).map((w) =>
    normalizeRelationalWorkRecord(w)
  );
}

export async function getRelationalWorksByDomain(domain = 'cinema', options = {}) {
  const cleanDomain = normalizeDomainId(domain);
  const all = await getAllRelationalWorks(options);
  return all.filter((w) => inferDomainFromWork(w) === cleanDomain);
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

export const getRelationalApiCache = getApiCacheEntry;
export const putRelationalApiCache = setApiCacheEntry;

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
      storage.setItem(RELATIONAL_SCHEMA_VERSION_KEY, String(RELATIONAL_DB_VERSION));
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

/**
 * Registro versionado de migrações estritamente aditivas do IndexedDB (v2.4.0).
 * Cada passo preserva 100% dos campos legados e apenas preenche ou normaliza campos novos.
 */
export const RELATIONAL_ADDITIVE_MIGRATIONS = Object.freeze([
  Object.freeze({
    version: 1,
    id: 'v1-relational-base',
    description: 'Infere domínio padrão (cinema) e normaliza estrutura relacional base sem apagar campos antigos.',
    migrateWork(work = {}) {
      const domain = inferDomainFromWork(work);
      return {
        ...work,
        domain,
        workType: normalizeWorkTypeForDomain(work.workType || work.mediaType, domain),
      };
    },
  }),
  Object.freeze({
    version: 2,
    id: 'v2-rating-model-and-franchise-tier',
    description:
      'Adiciona lifeWork (compatível com gameRating11=11), rating interno 0..100, ratingManualOverride e franchiseTier de forma aditiva.',
    migrateWork(work = {}) {
      return normalizeRelationalWorkRecord(work);
    },
  }),
]);

export function readStoredRelationalSchemaVersion(
  storage = typeof localStorage !== 'undefined' ? localStorage : null
) {
  if (!storage || typeof storage.getItem !== 'function') return 0;
  try {
    const raw = storage.getItem(RELATIONAL_SCHEMA_VERSION_KEY);
    if (raw !== null && raw !== '') {
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
    }
    if (storage.getItem(RELATIONAL_MIGRATED_KEY) === '1.2-relational') {
      return 1;
    }
  } catch {
    // Fallback seguro
  }
  return 0;
}

/**
 * Executa migrações aditivas do schema IndexedDB com snapshot automático prévio:
 * 1) Identifica versão atual vs RELATIONAL_DB_VERSION.
 * 2) Grava snapshot automático antes de migrar (IndexedDB via saveSnapshotFn + localStorage) e verifica integridade.
 * 3) Aplica cada migração aditiva em ordem sem perder nenhum campo existente.
 * 4) Atualiza o marcador de versão de forma idempotente.
 */
export async function runRelationalSchemaMigrations({
  items = [],
  sessions = [],
  episodeEvaluations = [],
  profile = null,
  collections = [],
  idbFactory = null,
  storage = typeof localStorage !== 'undefined' ? localStorage : null,
  saveSnapshotFn = null,
  verifySnapshotFn = null,
  fromVersionOverride = null,
  force = false,
} = {}) {
  const safeItems = Array.isArray(items) ? items.filter((w) => w && w.id) : [];
  const safeSessions = Array.isArray(sessions) ? sessions : [];
  const safeReviews = Array.isArray(episodeEvaluations) ? episodeEvaluations : [];
  const fromVersion =
    fromVersionOverride !== null && fromVersionOverride !== undefined
      ? Math.max(0, Math.floor(Number(fromVersionOverride) || 0))
      : readStoredRelationalSchemaVersion(storage);

  if (!force && fromVersion >= RELATIONAL_DB_VERSION) {
    return {
      ok: true,
      alreadyUpToDate: true,
      migrated: false,
      aborted: false,
      fromVersion,
      toVersion: RELATIONAL_DB_VERSION,
      appliedVersions: [],
      snapshotSaved: false,
      items: safeItems,
    };
  }

  const pendingSteps = RELATIONAL_ADDITIVE_MIGRATIONS.filter(
    (step) => force || step.version > fromVersion
  );

  // 1. Snapshot automático obrigatório antes de migrar
  let snapshotSaved = false;
  let snapshotId = null;
  const preMigrationWorkspace = {
    schemaVersion: `relational-v${fromVersion}`,
    targetSchemaVersion: RELATIONAL_DB_VERSION,
    createdAt: new Date().toISOString(),
    itemsCount: safeItems.length,
    items: safeItems,
    profile,
    collections,
    readingSessions: safeSessions,
    episodeEvaluations: safeReviews,
  };

  if (typeof saveSnapshotFn === 'function') {
    try {
      const snapRes = await saveSnapshotFn(preMigrationWorkspace, {
        reason: 'pre-schema-migration',
        label: `Snapshot pré-migração schema v${fromVersion} -> v${RELATIONAL_DB_VERSION}`,
        force: true,
      });
      snapshotId = snapRes?.snapshot?.id || null;
      if (!snapshotId) {
        return {
          ok: false,
          migrated: false,
          aborted: true,
          reason: 'snapshot-failed',
          fromVersion,
          toVersion: RELATIONAL_DB_VERSION,
          items: safeItems,
        };
      }
      if (typeof verifySnapshotFn === 'function') {
        const verified = await verifySnapshotFn(snapshotId, preMigrationWorkspace);
        if (!verified?.ok) {
          return {
            ok: false,
            migrated: false,
            aborted: true,
            reason: verified?.reason || 'snapshot-verify-failed',
            fromVersion,
            toVersion: RELATIONAL_DB_VERSION,
            snapshotId,
            items: safeItems,
          };
        }
      }
      snapshotSaved = true;
    } catch (err) {
      return {
        ok: false,
        migrated: false,
        aborted: true,
        reason: err?.message || 'snapshot-error',
        fromVersion,
        toVersion: RELATIONAL_DB_VERSION,
        items: safeItems,
      };
    }
  }

  if (storage && typeof storage.setItem === 'function') {
    try {
      storage.setItem(PRE_SCHEMA_MIGRATION_BACKUP_KEY, JSON.stringify(preMigrationWorkspace));
      const readBackRaw = storage.getItem(PRE_SCHEMA_MIGRATION_BACKUP_KEY);
      const readBack = readBackRaw ? JSON.parse(readBackRaw) : null;
      if (readBack && Number(readBack.itemsCount) === safeItems.length) {
        snapshotSaved = true;
      }
    } catch {
      // Cota de localStorage cheia: segue se snapshot via saveSnapshotFn já foi confirmado
    }
  }

  // 2. Execução das migrações estritamente aditivas
  let migratedItems = safeItems.map((item) => ({ ...item }));
  const appliedVersions = [];
  for (const step of pendingSteps) {
    migratedItems = migratedItems.map((work) => step.migrateWork(work));
    appliedVersions.push(step.version);
  }

  // 3. Persistência no IndexedDB relacional
  const worksRes = await putRelationalWorks(migratedItems, { idbFactory, replace: true });
  if (safeSessions.length > 0) {
    await putRelationalSessions(safeSessions, { idbFactory, replace: false });
  }
  await setApiCacheEntry(
    RELATIONAL_SCHEMA_META_KEY,
    {
      schemaVersion: RELATIONAL_DB_VERSION,
      migratedFrom: fromVersion,
      appliedVersions,
      migratedAt: new Date().toISOString(),
    },
    { ttlMs: 365 * 24 * 60 * 60 * 1000, idbFactory }
  );

  if (worksRes.ok && storage && typeof storage.setItem === 'function') {
    try {
      storage.setItem(RELATIONAL_SCHEMA_VERSION_KEY, String(RELATIONAL_DB_VERSION));
      storage.setItem(RELATIONAL_MIGRATED_KEY, '1.2-relational');
    } catch {
      // Silencioso
    }
  }

  return {
    ok: worksRes.ok,
    alreadyUpToDate: false,
    migrated: true,
    aborted: false,
    fromVersion,
    toVersion: RELATIONAL_DB_VERSION,
    appliedVersions,
    snapshotSaved,
    snapshotId,
    persisted: Boolean(worksRes.persisted),
    items: migratedItems,
  };
}

// =============================================================================
// FASE 3 (v2.6.0) — Deduplicação Manual + Agrupamento de Reimpressões (`editionOf`)
// =============================================================================

function normalizeDedupText(raw = '') {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractDedupExternalIds(work = {}) {
  const out = {};
  const ids = work?.ids && typeof work.ids === 'object' ? work.ids : {};
  const pairs = [
    ['tmdb', work.tmdbId || ids.tmdb],
    ['imdb', work.imdbId || ids.imdb],
    ['anilist', work.anilistId || ids.anilist],
    ['mal', work.malId || ids.mal],
    ['tvmaze', work.tvmazeId || ids.tvmaze],
    ['igdb', work.igdbId || ids.igdb],
    ['rawg', work.rawgId || ids.rawg],
    ['steam', work.steamAppId || ids.steam],
    ['isbn', work.isbnOrDoi || work.isbn || ids.isbn],
    ['googleBooks', ids.googleBooks],
    ['ol', ids.ol],
    ['musicbrainz', work.musicBrainzId || ids.musicbrainz],
    ['itunes', ids.itunes],
  ];
  for (const [k, v] of pairs) {
    const clean = String(v || '').trim().toLowerCase();
    if (clean) out[k] = clean;
  }
  return out;
}

/**
 * Chave composta canônica de deduplicação:
 * título normalizado + autor/criador normalizado + external_ids.
 */
export function buildWorkDeduplicationKey(work = {}) {
  const domain = inferDomainFromWork(work);
  const normalizedTitle = normalizeDedupText(work?.title || '');
  const normalizedCreator = normalizeDedupText(
    work?.creator || work?.author || work?.director || work?.artist || ''
  );
  const externalIds = extractDedupExternalIds(work);
  const extParts = Object.entries(externalIds)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`);
  return {
    domain,
    normalizedTitle,
    normalizedCreator,
    externalIds,
    compositeKey: `${domain}::${normalizedTitle}::${normalizedCreator}::${extParts.join('|')}`,
  };
}

/**
 * Pontuação determinística de completude para recomendar o registro principal na mesclagem manual.
 */
export function computeWorkCompletenessScore(work = {}) {
  if (!work || typeof work !== 'object') return 0;
  let score = 0;
  const hasRating =
    (typeof work.rating100 === 'number' && Number.isFinite(work.rating100)) ||
    (typeof work.rating === 'number' && Number.isFinite(work.rating)) ||
    (typeof work.score10 === 'number' && Number.isFinite(work.score10));
  if (hasRating) score += 30;
  if (work.verdict) score += 6;
  if (work.isLifeWork) score += 4;

  const criteriaObj = work.criteriaScores || work.dnaScores || null;
  if (criteriaObj && typeof criteriaObj === 'object') {
    const filled = Object.values(criteriaObj).filter(
      (v) => typeof v === 'number' && Number.isFinite(v) && v > 0
    ).length;
    score += Math.min(25, filled * 5);
  }

  const notesLen = String(work.notes || work.review || '').trim().length;
  if (notesLen > 0) score += Math.min(20, 8 + Math.floor(notesLen / 40));

  if (Array.isArray(work.quotes) && work.quotes.length > 0) {
    score += Math.min(12, work.quotes.length * 4);
  }

  if (work.status === 'completed') score += 20;
  else if (work.status === 'in_progress' || work.status === 'playing' || work.status === 'rewatching') {
    score += 12;
  }

  if (
    Number(work.pagesRead) > 0 ||
    Number(work.chaptersRead) > 0 ||
    Number(work.currentEpisode) > 0 ||
    Number(work.hoursPlayed) > 0 ||
    Number(work.currentSeconds) > 0 ||
    Number(work.progress) > 0
  ) {
    score += 10;
  }

  if (work.manualCoverDataUrl || work.coverUrl) score += 8;
  const extCount = Object.keys(extractDedupExternalIds(work)).length;
  if (extCount > 0) score += Math.min(10, extCount * 4);
  if (work.synopsis) score += 4;
  if (work.franchiseName) score += 3;

  return score;
}

/**
 * Agrupa reimpressões vinculadas via `editionOf` sob a obra principal.
 */
export function groupCatalogEditionsByPrimary(items = []) {
  const list = (Array.isArray(items) ? items : []).filter((w) => w && w.inBacklog !== false);
  const byId = new Map(list.map((w) => [String(w.id), w]));
  const editionsByPrimaryId = new Map();
  const primaryWorks = [];

  for (const w of list) {
    const baseId = getEditionBaseWorkId(w);
    if (baseId && byId.has(baseId)) {
      if (!editionsByPrimaryId.has(baseId)) editionsByPrimaryId.set(baseId, []);
      editionsByPrimaryId.get(baseId).push(w);
    } else {
      primaryWorks.push(w);
    }
  }

  return {
    primaryWorks,
    editionsByPrimaryId,
  };
}

function areWorksPotentialDuplicates(a, b, keyA, keyB) {
  if (!a || !b || String(a.id) === String(b.id)) return null;
  if (keyA.domain !== keyB.domain) return null;

  // Reimpressões ligadas via `editionOf` (ou irmãs sob a mesma obra base) ficam sob a obra principal e NÃO são duplicatas
  const baseA = getEditionBaseWorkId(a);
  const baseB = getEditionBaseWorkId(b);
  if (
    (baseA && baseA === String(b.id)) ||
    (baseB && baseB === String(a.id)) ||
    (baseA && baseB && baseA === baseB)
  ) {
    return null;
  }

  // 1. Correspondência direta por external_ids (exceto `source: 'manual'` / `id`)
  for (const [k, valA] of Object.entries(keyA.externalIds)) {
    const valB = keyB.externalIds[k];
    if (!valB || valA !== valB) continue;
    if (keyA.domain === 'music' && k === 'itunes' && a.workType !== b.workType) {
      continue;
    }
    return `ID compartilhado (${k.toUpperCase()})`;
  }

  // 2. Correspondência por título normalizado + autor/criador (inclui obras manuais duplicando obra de API)
  if (!keyA.normalizedTitle || keyA.normalizedTitle !== keyB.normalizedTitle) {
    return null;
  }

  if (keyA.domain === 'music' && a.workType && b.workType && a.workType !== b.workType) {
    return null;
  }

  if (keyA.domain === 'games') {
    const edA = normalizeGameEditionType(a.editionType);
    const edB = normalizeGameEditionType(b.editionType);
    if (edA !== edB) return null;
  }

  const creatorA = keyA.normalizedCreator;
  const creatorB = keyB.normalizedCreator;
  const bothCreatorsPresent = Boolean(creatorA && creatorB);
  const creatorsMatch =
    bothCreatorsPresent &&
    (creatorA === creatorB || creatorA.includes(creatorB) || creatorB.includes(creatorA));

  if (creatorsMatch) {
    return 'Mesmo título e autor/criador';
  }

  // Se um dos lados não tem autor/criador preenchido (comum em cadastro manual rápido ou API parcial)
  if (!bothCreatorsPresent) {
    const yA = Number(a.releaseYear) || null;
    const yB = Number(b.releaseYear) || null;
    const hasManualSide = Boolean(
      a.isManual || a.ids?.source === 'manual' || b.isManual || b.ids?.source === 'manual'
    );
    if ((yA && yB && Math.abs(yA - yB) <= 2) || !yA || !yB || hasManualSide) {
      return hasManualSide ? 'Obra manual com mesmo título' : 'Mesmo título';
    }
  }

  return null;
}

/**
 * Detecta possíveis duplicatas no catálogo sem mesclar nada automaticamente.
 */
export function detectCatalogDuplicates(items = [], { domain = 'all' } = {}) {
  const filterDomain = domain && domain !== 'all' ? normalizeDomainId(domain) : null;
  const active = (Array.isArray(items) ? items : []).filter((w) => {
    if (!w || !w.id || w.inBacklog === false) return false;
    // Reimpressões/edições vinculadas explicitamente via `editionOf` ficam sob a obra principal e não entram como duplicatas
    if (getEditionBaseWorkId(w)) return false;
    if (filterDomain && inferDomainFromWork(w) !== filterDomain) return false;
    return true;
  });

  if (active.length < 2) {
    return { count: 0, totalDuplicateItems: 0, groups: [] };
  }

  const keys = active.map((w) => buildWorkDeduplicationKey(w));
  const parent = active.map((_, i) => i);
  const reasonsByPair = new Map();

  const find = (i) => {
    let curr = i;
    while (parent[curr] !== curr) {
      parent[curr] = parent[parent[curr]];
      curr = parent[curr];
    }
    return curr;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      const reason = areWorksPotentialDuplicates(active[i], active[j], keys[i], keys[j]);
      if (reason) {
        union(i, j);
        reasonsByPair.set(`${find(i)}`, reason);
      }
    }
  }

  const clusters = new Map();
  for (let i = 0; i < active.length; i += 1) {
    const root = find(i);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push({ work: active[i], score: computeWorkCompletenessScore(active[i]) });
  }

  const groups = [];
  for (const [root, members] of clusters.entries()) {
    if (members.length < 2) continue;
    members.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const tA = Date.parse(a.work.updatedAt || a.work.createdAt || '') || 0;
      const tB = Date.parse(b.work.updatedAt || b.work.createdAt || '') || 0;
      return tB - tA;
    });
    const orderedWorks = members.map((m) => m.work);
    groups.push({
      groupId: `dup:${orderedWorks.map((w) => w.id).sort().join('|')}`,
      domain: inferDomainFromWork(orderedWorks[0]),
      title: orderedWorks[0].title,
      reason: reasonsByPair.get(`${root}`) || 'Mesmo título e autor/criador',
      recommendedPrimaryId: orderedWorks[0].id,
      scoresById: Object.fromEntries(members.map((m) => [m.work.id, m.score])),
      items: orderedWorks,
    });
  }

  return {
    count: groups.length,
    totalDuplicateItems: groups.reduce((acc, g) => acc + g.items.length, 0),
    groups,
  };
}

function pickRicherCriteria(a = {}, b = {}) {
  const cA = a && typeof a === 'object' ? a : {};
  const cB = b && typeof b === 'object' ? b : {};
  const countValid = (obj) =>
    Object.values(obj).filter((v) => typeof v === 'number' && Number.isFinite(v) && v > 0).length;
  return countValid(cA) >= countValid(cB) ? { ...cB, ...cA } : { ...cA, ...cB };
}

function mergeDistinctNotes(primaryNotes = '', secondaryNotes = '') {
  const a = String(primaryNotes || '').trim();
  const b = String(secondaryNotes || '').trim();
  if (!a) return b;
  if (!b) return a;
  if (a.toLowerCase() === b.toLowerCase() || a.toLowerCase().includes(b.toLowerCase())) return a;
  if (b.toLowerCase().includes(a.toLowerCase())) return b;
  return `${a}\n\n---\n${b}`;
}

function mergeQuotesUnion(quotesA = [], quotesB = []) {
  const seen = new Set();
  const out = [];
  for (const q of [...(Array.isArray(quotesA) ? quotesA : []), ...(Array.isArray(quotesB) ? quotesB : [])]) {
    const key = String(q?.text || q || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(q);
  }
  return out;
}

const STATUS_PROGRESS_RANK = {
  completed: 5,
  rewatching: 4,
  in_progress: 3,
  playing: 3,
  paused: 2,
  queued: 1,
  dropped: 1,
};

/**
 * Mesclagem estritamente MANUAL entre dois registros duplicados.
 * Preserva nota, critérios, progresso, comentários, citações, capa e external_ids
 * do registro mais completo, devolvendo snapshots completos para Desfazer imediato.
 */
export function mergeDuplicateWorksManual(primaryWork = {}, secondaryWork = {}) {
  if (!primaryWork?.id || !secondaryWork?.id || String(primaryWork.id) === String(secondaryWork.id)) {
    return null;
  }

  const nowIso = new Date().toISOString();
  const primaryScore = computeWorkCompletenessScore(primaryWork);
  const secondaryScore = computeWorkCompletenessScore(secondaryWork);
  const richer = primaryScore >= secondaryScore ? primaryWork : secondaryWork;
  const other = richer === primaryWork ? secondaryWork : primaryWork;

  const hasRating = (w) =>
    (typeof w?.rating100 === 'number' && Number.isFinite(w.rating100)) ||
    (typeof w?.rating === 'number' && Number.isFinite(w.rating)) ||
    (typeof w?.score10 === 'number' && Number.isFinite(w.score10));

  const ratingSource = hasRating(richer) ? richer : hasRating(other) ? other : primaryWork;

  const statusA = primaryWork.status || 'queued';
  const statusB = secondaryWork.status || 'queued';
  const bestStatus =
    (STATUS_PROGRESS_RANK[statusA] || 0) >= (STATUS_PROGRESS_RANK[statusB] || 0)
      ? statusA
      : statusB;

  const idsA = primaryWork.ids && typeof primaryWork.ids === 'object' ? { ...primaryWork.ids } : {};
  const idsB = secondaryWork.ids && typeof secondaryWork.ids === 'object' ? { ...secondaryWork.ids } : {};
  const mergedExternalIds = { ...idsB, ...idsA };
  const hasRealApiId = Object.keys(extractDedupExternalIds({ ids: mergedExternalIds })).length > 0;
  if (hasRealApiId && mergedExternalIds.source === 'manual') {
    const oldManualId = mergedExternalIds.id || primaryWork.id;
    delete mergedExternalIds.source;
    delete mergedExternalIds.id;
    mergedExternalIds.linkedFromManualId = mergedExternalIds.linkedFromManualId || oldManualId;
  }

  const mergedCover =
    primaryWork.manualCoverDataUrl ||
    secondaryWork.manualCoverDataUrl ||
    primaryWork.coverUrl ||
    secondaryWork.coverUrl ||
    null;
  const mergedManualCover =
    primaryWork.manualCoverDataUrl || secondaryWork.manualCoverDataUrl || undefined;

  const mergedWork = {
    ...secondaryWork,
    ...primaryWork,
    id: primaryWork.id,
    isManual: hasRealApiId ? false : Boolean(primaryWork.isManual && secondaryWork.isManual),
    ids: mergedExternalIds,
    title: String(primaryWork.title || secondaryWork.title || '').trim(),
    originalTitle: primaryWork.originalTitle || secondaryWork.originalTitle || '',
    creator: primaryWork.creator || secondaryWork.creator || primaryWork.author || secondaryWork.author || '',
    author: primaryWork.author || secondaryWork.author || primaryWork.creator || secondaryWork.creator || '',
    director: primaryWork.director || secondaryWork.director || primaryWork.creator || secondaryWork.creator || '',
    studio: primaryWork.studio || secondaryWork.studio || '',
    releaseYear: primaryWork.releaseYear || secondaryWork.releaseYear || null,
    status: bestStatus,
    rating: ratingSource.rating ?? null,
    rating100: ratingSource.rating100 ?? null,
    score10: ratingSource.score10 ?? null,
    verdict: ratingSource.verdict ?? primaryWork.verdict ?? secondaryWork.verdict ?? null,
    isLifeWork: Boolean(primaryWork.isLifeWork || secondaryWork.isLifeWork),
    criteriaScores: pickRicherCriteria(richer.criteriaScores, other.criteriaScores),
    dnaScores: pickRicherCriteria(richer.dnaScores, other.dnaScores),
    notes: mergeDistinctNotes(richer.notes, other.notes),
    review: mergeDistinctNotes(richer.review, other.review),
    quotes: mergeQuotesUnion(primaryWork.quotes, secondaryWork.quotes),
    tags: Array.from(new Set([...(primaryWork.tags || []), ...(secondaryWork.tags || [])].filter(Boolean))),
    genres: Array.from(new Set([...(primaryWork.genres || []), ...(secondaryWork.genres || [])].filter(Boolean))),
    collectionIds: Array.from(
      new Set([...(primaryWork.collectionIds || []), ...(secondaryWork.collectionIds || [])].filter(Boolean))
    ),
    coverUrl: mergedCover,
    ...(mergedManualCover ? { manualCoverDataUrl: mergedManualCover } : {}),
    coverSources: Array.from(
      new Set([
        ...(mergedCover ? [mergedCover] : []),
        ...(Array.isArray(primaryWork.coverSources) ? primaryWork.coverSources : []),
        ...(Array.isArray(secondaryWork.coverSources) ? secondaryWork.coverSources : []),
      ].filter(Boolean))
    ),
    synopsis:
      String(primaryWork.synopsis || '').length >= String(secondaryWork.synopsis || '').length
        ? primaryWork.synopsis || secondaryWork.synopsis || ''
        : secondaryWork.synopsis || '',
    totalPages: Math.max(Number(primaryWork.totalPages) || 0, Number(secondaryWork.totalPages) || 0) || null,
    pagesRead: Math.max(Number(primaryWork.pagesRead) || 0, Number(secondaryWork.pagesRead) || 0),
    chaptersRead: Math.max(Number(primaryWork.chaptersRead) || 0, Number(secondaryWork.chaptersRead) || 0),
    currentEpisode: Math.max(Number(primaryWork.currentEpisode) || 0, Number(secondaryWork.currentEpisode) || 0),
    currentSeason: Math.max(Number(primaryWork.currentSeason) || 1, Number(secondaryWork.currentSeason) || 1),
    hoursPlayed: Math.max(Number(primaryWork.hoursPlayed) || 0, Number(secondaryWork.hoursPlayed) || 0),
    currentSeconds: Math.max(Number(primaryWork.currentSeconds) || 0, Number(secondaryWork.currentSeconds) || 0),
    progress: Math.max(Number(primaryWork.progress) || 0, Number(secondaryWork.progress) || 0),
    isbnOrDoi: primaryWork.isbnOrDoi || secondaryWork.isbnOrDoi || '',
    franchiseName: primaryWork.franchiseName || secondaryWork.franchiseName || '',
    seriesVolume: primaryWork.seriesVolume || secondaryWork.seriesVolume || '',
    workUrl: primaryWork.workUrl || secondaryWork.workUrl || '',
    tmdbId: primaryWork.tmdbId || secondaryWork.tmdbId || null,
    imdbId: primaryWork.imdbId || secondaryWork.imdbId || '',
    anilistId: primaryWork.anilistId || secondaryWork.anilistId || null,
    malId: primaryWork.malId || secondaryWork.malId || null,
    igdbId: primaryWork.igdbId || secondaryWork.igdbId || null,
    rawgId: primaryWork.rawgId || secondaryWork.rawgId || null,
    updatedAt: nowIso,
    updated_at: nowIso,
  };

  return {
    mergedWork,
    removedWorkId: secondaryWork.id,
    undoPrimarySnapshot: { ...primaryWork },
    undoRemovedSnapshot: { ...secondaryWork },
  };
}
