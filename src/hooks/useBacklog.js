import { useCallback, useEffect, useState } from 'react';
import {
  getAllEpisodeEvaluations,
  importEpisodeEvaluations,
} from '../api/cacheDb';
import {
  domainConfig,
  normalizeCinemaStatus,
  normalizeCinemaWorkType,
} from '../config/domainConfig';
import { initialItems } from '../data/mockData';
import { applyCanonicalIdsToWork } from '../lib/idBridge';
import { classifyLegacyRatingSource } from '../lib/migrations';
import { normalizeExternalRatings } from '../lib/ratings';
import { safeSetLocalStorageJson } from '../lib/storagePersistence';
import {
  exportSignedBackupPayload,
  loadEmergencyMirror,
  recordBackupExportTimestamp,
} from '../services/backupEngine';
import {
  buildCodiceDatabase,
  createUuid,
  exportDatabaseDownloads,
  hydrateAppSnapshotFromDatabase,
  loadStoredCodiceDatabase,
  parseAndValidateBackupText,
  triggerFileDownload,
} from '../services/codiceDatabase';
import {
  calculateSmartRating,
  calculateWorkProgress,
  getTodayLocalISO,
  getVerdictForScore,
  isEpisodicWork,
  normalizeTagsList,
  syncCinemaEpisodeFields,
} from '../utils/backlogHelpers';
import {
  COLLECTIONS_STORAGE_KEY,
  createCustomCollection,
  normalizeCollectionList,
  reorderCollections,
  reorderWorkInCollection,
  saveCollections,
  toggleWorkInCollection,
} from '../utils/collections';

const STORAGE_KEY = domainConfig.storageKey;
const SESSIONS_STORAGE_KEY = 'cine_codice_watch_sessions_v1';

function normalizeRating(value) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return null;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function normalizeNonNegativeInt(value) {
  if (value === '' || value === null || value === undefined) return 0;
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed < 0) return 0;
  return Math.round(parsed);
}

function normalizeNullablePositiveInt(value) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed <= 0) return null;
  return Math.round(parsed);
}

function normalizeItem(rawItem, spectatorDna = null) {
  const status = normalizeCinemaStatus(rawItem.status || domainConfig.ui.add.defaultNewStatus);
  const isCompleted = status === 'completed';
  const workType = normalizeCinemaWorkType(rawItem.workType);
  const nowIso = new Date().toISOString();
  const today = getTodayLocalISO();

  const completedDate = isCompleted ? rawItem.completedDate || today : null;
  const startDate =
    status === 'playing' || status === 'rewatching'
      ? rawItem.startDate || today
      : isCompleted
        ? rawItem.startDate || completedDate
        : rawItem.startDate || null;

  const reviewCriteria = rawItem.reviewCriteria || null;
  const computedRating = reviewCriteria
    ? calculateSmartRating(reviewCriteria, spectatorDna)
    : normalizeRating(rawItem.rating);

  const rating = isCompleted
    ? computedRating ?? normalizeRating(rawItem.rating)
    : normalizeRating(rawItem.rating);

  const durationMinutes = normalizeNullablePositiveInt(rawItem.durationMinutes);
  const totalSeconds =
    normalizeNullablePositiveInt(rawItem.totalSeconds) ||
    (durationMinutes ? durationMinutes * 60 : null);
  const rawCurrentSeconds = normalizeNonNegativeInt(rawItem.currentSeconds);
  const currentSeconds = isCompleted && totalSeconds ? totalSeconds : rawCurrentSeconds;

  const episodeDurationMinutes =
    normalizeNullablePositiveInt(rawItem.episodeDurationMinutes) ||
    (workType === 'anime' ? 24 : workType === 'series' ? 45 : null);

  const episodeFields = syncCinemaEpisodeFields(rawItem, isCompleted);
  const withIds = applyCanonicalIdsToWork(rawItem);
  const ratingSource = classifyLegacyRatingSource({
    ...rawItem,
    rating,
    reviewCriteria,
  });
  const externalRatings = normalizeExternalRatings(rawItem.externalRatings);

  const normalized = {
    ...rawItem,
    id: String(rawItem.id || createUuid()),
    workType,
    status,
    title: String(rawItem.title || ''),
    originalTitle: String(rawItem.originalTitle || '').trim(),
    director: String(rawItem.director || rawItem.studio || rawItem.author || '').trim(),
    studio: String(rawItem.studio || '').trim(),
    cast: String(rawItem.cast || '').trim(),
    format: rawItem.format || domainConfig.mediaFormats[0],
    audioFormat: rawItem.audioFormat || domainConfig.audioFormatTags[0],
    animeFormat: rawItem.animeFormat || (workType === 'anime' ? 'TV' : ''),
    coverUrl: rawItem.coverUrl || null,
    backdropUrl: rawItem.backdropUrl || null,
    coverSources: Array.isArray(rawItem.coverSources)
      ? rawItem.coverSources.filter(Boolean)
      : rawItem.coverUrl
        ? [rawItem.coverUrl]
        : [],
    genres: Array.isArray(rawItem.genres) ? rawItem.genres : [],
    primaryGenre:
      typeof rawItem.primaryGenre === 'string' && rawItem.primaryGenre.trim()
        ? rawItem.primaryGenre.trim()
        : Array.isArray(rawItem.genres) && rawItem.genres[0]
          ? String(rawItem.genres[0])
          : '',
    subgenres: Array.isArray(rawItem.subgenres) ? rawItem.subgenres.filter(Boolean) : [],
    durationMinutes,
    totalSeconds,
    currentSeconds,
    episodeDurationMinutes,
    ...episodeFields,
    rewatchCount: normalizeNonNegativeInt(rawItem.rewatchCount),
    franchiseName: String(rawItem.franchiseName || rawItem.seriesName || '').trim(),
    franchiseRelations: Array.isArray(rawItem.franchiseRelations)
      ? rawItem.franchiseRelations
      : [],
    franchiseLinks: Array.isArray(rawItem.franchiseLinks) ? rawItem.franchiseLinks : [],
    belongsToCollection: rawItem.belongsToCollection || null,
    tmdbStatus: rawItem.tmdbStatus || null,
    chronologicalOrder: normalizeNullablePositiveInt(rawItem.chronologicalOrder),
    ids: withIds.ids,
    anilistId: withIds.anilistId,
    malId: withIds.malId,
    tvmazeId: withIds.tvmazeId,
    tmdbId: withIds.tmdbId,
    tmdbMediaType: rawItem.tmdbMediaType || null,
    imdbId: withIds.imdbId ? String(withIds.imdbId).trim() : '',
    sourceBadge: String(rawItem.sourceBadge || '').trim(),
    mergedSources: Array.isArray(rawItem.mergedSources) ? rawItem.mergedSources : [],
    openAccessUrl: String(rawItem.openAccessUrl || '').trim(),
    releaseYear: rawItem.releaseYear ?? rawItem.publicationYear ?? null,
    language: String(rawItem.language || '').trim(),
    tags: normalizeTagsList(rawItem.tags),
    recommended: rawItem.recommended !== undefined ? Boolean(rawItem.recommended) : false,
    synopsis: String(rawItem.synopsis || '').trim(),
    atmosphere: Array.isArray(rawItem.atmosphere) ? rawItem.atmosphere : [],
    tropes: Array.isArray(rawItem.tropes) ? rawItem.tropes : [],
    collectionIds: Array.isArray(rawItem.collectionIds)
      ? Array.from(new Set(rawItem.collectionIds.map(String).filter(Boolean)))
      : [],
    quotes: Array.isArray(rawItem.quotes)
      ? rawItem.quotes.filter((q) => q && typeof q === 'object' && q.text)
      : [],
    rating,
    ratingSource,
    externalRatings,
    reviewCriteria,
    verdict: rating !== null ? (rawItem.verdict || getVerdictForScore(rating)) : (rawItem.verdict || null),
    checkpoint: String(rawItem.checkpoint || '').trim(),
    hype: rawItem.hype || null,
    isPlatinum: Boolean(rawItem.isPlatinum),
    dropReason: rawItem.dropReason || null,
    startDate,
    completedDate,
    dropDate:
      status === 'dropped' ? rawItem.dropDate || today : rawItem.dropDate || null,
    notes: String(rawItem.notes || ''),
    completedYear: isCompleted
      ? Number(completedDate?.slice(0, 4)) ||
        rawItem.completedYear ||
        domainConfig.currentYear
      : null,
    isFavorite: Boolean(rawItem.isFavorite),
    isWishlist: Boolean(rawItem.isWishlist),
    inBacklog: rawItem.inBacklog !== undefined ? Boolean(rawItem.inBacklog) : true,
    createdAt: rawItem.createdAt || nowIso,
    updatedAt: rawItem.updatedAt || nowIso,
  };

  normalized.progress = calculateWorkProgress(normalized);
  return normalized;
}

function applyStatusTransitionDefaults(merged, nextStatus, prevItem, spectatorDna = null) {
  const today = getTodayLocalISO();

  if (nextStatus === 'playing' || nextStatus === 'rewatching') {
    merged.startDate = merged.startDate || today;
    merged.completedYear = null;
    if (nextStatus === 'rewatching' && prevItem?.status === 'completed') {
      merged.rewatchCount = (Number(prevItem.rewatchCount) || 0) + 1;
      if (isEpisodicWork(merged)) {
        merged.currentSeason = 1;
        merged.currentEpisode = 0;
        merged.watchedEpisodes = {};
      } else {
        merged.currentSeconds = 0;
      }
    }
    merged.progress = calculateWorkProgress(merged);
  }

  if (nextStatus === 'completed') {
    merged.completedDate = merged.completedDate || today;
    merged.startDate = merged.startDate || prevItem?.startDate || merged.completedDate;
    merged.completedYear =
      Number(merged.completedDate.slice(0, 4)) || domainConfig.currentYear;
    merged.progress = 100;
    merged.progressPercent = 100;

    if (isEpisodicWork(merged)) {
      if (merged.totalSeasons > 0) merged.currentSeason = merged.totalSeasons;
      if (merged.totalEpisodes > 0) merged.currentEpisode = merged.totalEpisodes;
    } else if (merged.totalSeconds > 0) {
      merged.currentSeconds = merged.totalSeconds;
    }

    if (merged.reviewCriteria) {
      merged.rating = calculateSmartRating(merged.reviewCriteria, spectatorDna);
      merged.ratingSource = 'manual';
    } else if (merged.rating !== null && merged.rating !== undefined && merged.rating !== '') {
      merged.ratingSource = classifyLegacyRatingSource(merged);
    } else {
      merged.rating = null;
      merged.ratingSource = null;
    }
    merged.verdict =
      merged.rating !== null ? (merged.verdict || getVerdictForScore(merged.rating)) : null;
  }

  if (nextStatus === 'dropped') {
    merged.dropDate = merged.dropDate || today;
    merged.completedYear = null;
    merged.progress = calculateWorkProgress(merged);
  }

  if (nextStatus === 'queued' || nextStatus === 'paused') {
    merged.completedYear = null;
    merged.progress = calculateWorkProgress(merged);
  }

  return merged;
}

export function readRawBacklogStorageState() {
  try {
    if (typeof localStorage === 'undefined') {
      return { hasStoredItems: false, items: [] };
    }
    const rawLegacy = localStorage.getItem(STORAGE_KEY);
    if (rawLegacy !== null) {
      const parsed = JSON.parse(rawLegacy);
      if (Array.isArray(parsed)) {
        return { hasStoredItems: true, items: parsed };
      }
    }
    const storedDb = loadStoredCodiceDatabase();
    if (storedDb) {
      const hydrated = hydrateAppSnapshotFromDatabase(storedDb);
      return {
        hasStoredItems: true,
        items: hydrated.items,
        storedDb,
      };
    }
    const mirror = loadEmergencyMirror();
    if (mirror.ok && mirror.items.length > 0) {
      return {
        hasStoredItems: true,
        items: mirror.items,
      };
    }
    return { hasStoredItems: false, items: [] };
  } catch {
    return { hasStoredItems: false, items: [] };
  }
}

function loadInitialBacklog() {
  try {
    const rawLegacy = localStorage.getItem(STORAGE_KEY);
    if (rawLegacy !== null) {
      const parsed = JSON.parse(rawLegacy);
      if (Array.isArray(parsed)) return parsed.map((i) => normalizeItem(i));
    }
    const storedDb = loadStoredCodiceDatabase();
    if (storedDb) {
      const { items } = hydrateAppSnapshotFromDatabase(storedDb);
      return items.map((i) => normalizeItem(i));
    }
    const mirror = loadEmergencyMirror();
    if (mirror.ok && mirror.items.length > 0) {
      return mirror.items.map((i) => normalizeItem(i));
    }
    return initialItems.map((i) => normalizeItem(i));
  } catch {
    return initialItems.map((i) => normalizeItem(i));
  }
}

function loadInitialSessions() {
  try {
    const raw = localStorage.getItem(SESSIONS_STORAGE_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
    const storedDb = loadStoredCodiceDatabase();
    if (storedDb) {
      return hydrateAppSnapshotFromDatabase(storedDb).readingSessions || [];
    }
    const mirror = loadEmergencyMirror();
    if (mirror.ok && mirror.readingSessions.length > 0) {
      return mirror.readingSessions;
    }
    return [];
  } catch {
    return [];
  }
}

function loadInitialCollections() {
  try {
    const raw = localStorage.getItem(COLLECTIONS_STORAGE_KEY);
    if (raw !== null) {
      return normalizeCollectionList(JSON.parse(raw));
    }
    const storedDb = loadStoredCodiceDatabase();
    if (storedDb) {
      return normalizeCollectionList(hydrateAppSnapshotFromDatabase(storedDb).collections);
    }
    const mirror = loadEmergencyMirror();
    if (mirror.ok && mirror.collections.length > 0) {
      return mirror.collections;
    }
    return [];
  } catch {
    return [];
  }
}

export function useBacklog(spectatorDna = null, { migrationLocked = false } = {}) {
  const [items, setItems] = useState(loadInitialBacklog);
  const [readingSessions, setReadingSessions] = useState(loadInitialSessions);
  const [collections, setCollections] = useState(loadInitialCollections);
  const [storageError, setStorageError] = useState(null);

  const retryPersistStorage = useCallback(() => {
    const resItems = safeSetLocalStorageJson(STORAGE_KEY, items, { label: 'catálogo' });
    if (!resItems.persisted) {
      setStorageError(resItems);
      return resItems;
    }
    const resSessions = safeSetLocalStorageJson(SESSIONS_STORAGE_KEY, readingSessions, {
      label: 'sessões',
    });
    if (!resSessions.persisted) {
      setStorageError(resSessions);
      return resSessions;
    }
    setStorageError(null);
    return { persisted: true, provisional: false, quotaExceeded: false, warning: null };
  }, [items, readingSessions]);

  useEffect(() => {
    if (migrationLocked) return undefined;
    const flush = () => {
      const res = safeSetLocalStorageJson(STORAGE_KEY, items, { label: 'catálogo' });
      if (!res.persisted) {
        setStorageError(res);
      } else {
        setStorageError((prev) => (prev ? null : prev));
      }
    };
    const timer = setTimeout(flush, 180);
    if (typeof window !== 'undefined') window.addEventListener('pagehide', flush);
    return () => {
      clearTimeout(timer);
      if (typeof window !== 'undefined') window.removeEventListener('pagehide', flush);
    };
  }, [items, migrationLocked]);

  useEffect(() => {
    if (migrationLocked) return undefined;
    const flushSessions = () => {
      const res = safeSetLocalStorageJson(SESSIONS_STORAGE_KEY, readingSessions, {
        label: 'sessões',
      });
      if (!res.persisted) {
        setStorageError(res);
      }
    };
    const timer = setTimeout(flushSessions, 180);
    if (typeof window !== 'undefined') window.addEventListener('pagehide', flushSessions);
    return () => {
      clearTimeout(timer);
      if (typeof window !== 'undefined') window.removeEventListener('pagehide', flushSessions);
    };
  }, [readingSessions, migrationLocked]);

  useEffect(() => {
    if (migrationLocked) return;
    saveCollections(collections);
  }, [collections, migrationLocked]);

  const addItem = useCallback(
    (newItem) => {
      const nowIso = new Date().toISOString();
      const status = normalizeCinemaStatus(newItem.status || domainConfig.ui.add.defaultNewStatus);
      const prepared = applyStatusTransitionDefaults(
        normalizeItem(
          {
            ...newItem,
            rating: newItem.rating ?? null,
            ratingSource:
              newItem.ratingSource ??
              (newItem.rating !== null && newItem.rating !== undefined && newItem.rating !== ''
                ? 'manual'
                : null),
            inBacklog: true,
            createdAt: nowIso,
            updatedAt: nowIso,
          },
          spectatorDna
        ),
        status,
        null,
        spectatorDna
      );

      const normalizedTitle = prepared.title.trim().toLowerCase();

      setItems((prev) => {
        const existingIndex = prev.findIndex(
          (item) =>
            item.id === prepared.id ||
            (item.title.trim().toLowerCase() === normalizedTitle &&
              item.workType === prepared.workType)
        );
        if (existingIndex !== -1) {
          return prev.map((item, idx) =>
            idx === existingIndex
              ? {
                  ...item,
                  ...prepared,
                  id: item.id,
                  createdAt: item.createdAt,
                  updatedAt: nowIso,
                  inBacklog: true,
                }
              : item
          );
        }
        return [prepared, ...prev];
      });
    },
    [spectatorDna]
  );

  const batchAddItems = useCallback(
    (records = []) => {
      const nowIso = new Date().toISOString();
      const preparedList = (Array.isArray(records) ? records : [])
        .filter((r) => r && r.title)
        .map((rec) => {
          const status = normalizeCinemaStatus(rec.status || domainConfig.ui.add.defaultNewStatus);
          return applyStatusTransitionDefaults(
            normalizeItem(
              {
                ...rec,
                inBacklog: true,
                createdAt: rec.createdAt || nowIso,
                updatedAt: nowIso,
              },
              spectatorDna
            ),
            status,
            null,
            spectatorDna
          );
        });
      if (preparedList.length === 0) return [];
      setItems((prev) => [...preparedList, ...prev]);
      return preparedList;
    },
    [spectatorDna]
  );

  const updateItem = useCallback(
    (id, updates) => {
      const nowIso = new Date().toISOString();

      setItems((prev) =>
        prev.map((item) => {
          if (item.id !== id) return item;

          const nextStatus = updates.status
            ? normalizeCinemaStatus(updates.status)
            : item.status;
          const statusChanged = Boolean(updates.status && nextStatus !== item.status);

          let merged = normalizeItem(
            {
              ...item,
              ...updates,
              status: nextStatus,
              updatedAt: nowIso,
            },
            spectatorDna
          );

          if (Object.prototype.hasOwnProperty.call(updates, 'rating')) {
            merged.rating = normalizeRating(updates.rating);
            merged.ratingSource =
              updates.ratingSource ?? (merged.rating !== null ? 'manual' : null);
            if (!Object.prototype.hasOwnProperty.call(updates, 'verdict')) {
              merged.verdict = getVerdictForScore(merged.rating);
            }
          } else if (Object.prototype.hasOwnProperty.call(updates, 'reviewCriteria')) {
            const score = calculateSmartRating(updates.reviewCriteria, spectatorDna);
            merged.rating = score;
            merged.ratingSource =
              updates.ratingSource ?? (score !== null ? 'manual' : null);
            merged.verdict = getVerdictForScore(score);
          }

          if (statusChanged) {
            merged = applyStatusTransitionDefaults(merged, nextStatus, item, spectatorDna);
          } else if (nextStatus === 'completed') {
            merged.progress = 100;
            merged.progressPercent = 100;
          } else {
            merged.progress = calculateWorkProgress(merged);
          }

          return merged;
        })
      );
    },
    [spectatorDna]
  );

  const removeItem = useCallback((id) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
    setReadingSessions((prev) => prev.filter((session) => session.workId !== id));
  }, []);

  const batchUpdateItems = useCallback(
    (ids = [], updates = {}) => {
      const idSet = new Set((Array.isArray(ids) ? ids : []).map(String));
      if (idSet.size === 0) return;
      const nowIso = new Date().toISOString();
      setItems((prev) =>
        prev.map((item) => {
          if (!idSet.has(String(item.id))) return item;
          let merged = { ...item, updatedAt: nowIso };
          if (updates.status) {
            const st = normalizeCinemaStatus(updates.status);
            merged.status = st;
            merged = applyStatusTransitionDefaults(merged, st, item, spectatorDna);
          }
          if (updates.addCollectionId) {
            const cols = Array.isArray(merged.collectionIds) ? merged.collectionIds.map(String) : [];
            if (!cols.includes(String(updates.addCollectionId))) {
              merged.collectionIds = [...cols, String(updates.addCollectionId)];
            }
          }
          if (updates.removeCollectionId) {
            const cols = Array.isArray(merged.collectionIds) ? merged.collectionIds.map(String) : [];
            merged.collectionIds = cols.filter((c) => c !== String(updates.removeCollectionId));
          }
          return normalizeItem(merged, spectatorDna);
        })
      );
    },
    [spectatorDna]
  );

  const batchRemoveItems = useCallback(
    (ids = []) => {
      const idSet = new Set((Array.isArray(ids) ? ids : []).map(String));
      if (idSet.size === 0) return { removedItems: [], removedSessions: [] };
      const removedItems = items.filter((item) => idSet.has(String(item.id)));
      const removedSessions = readingSessions.filter((s) => idSet.has(String(s.workId)));
      setItems((prev) => prev.filter((item) => !idSet.has(String(item.id))));
      setReadingSessions((prev) => prev.filter((s) => !idSet.has(String(s.workId))));
      return { removedItems, removedSessions };
    },
    [items, readingSessions]
  );

  const restoreRemovedItems = useCallback(
    ({ removedItems = [], removedSessions = [] } = {}) => {
      if (Array.isArray(removedItems) && removedItems.length > 0) {
        setItems((prev) => {
          const existingIds = new Set(prev.map((i) => String(i.id)));
          const restored = removedItems
            .filter((i) => !existingIds.has(String(i.id)))
            .map((i) => normalizeItem(i, spectatorDna));
          return [...restored, ...prev];
        });
      }
      if (Array.isArray(removedSessions) && removedSessions.length > 0) {
        setReadingSessions((prev) => {
          const existingIds = new Set(prev.map((s) => String(s.id)));
          const restored = removedSessions.filter((s) => !existingIds.has(String(s.id)));
          return [...restored, ...prev];
        });
      }
    },
    [spectatorDna]
  );

  const moveCollection = useCallback((collectionId, direction = -1) => {
    setCollections((prev) => reorderCollections(prev, collectionId, direction));
  }, []);

  const moveCollectionWork = useCallback(
    (collectionId, workId, direction = -1) => {
      setCollections((prev) =>
        prev.map((col) => {
          if (col.id !== String(collectionId)) return col;
          const memberWorks = items.filter(
            (i) => Array.isArray(i.collectionIds) && i.collectionIds.includes(col.id)
          );
          return reorderWorkInCollection(col, workId, direction, memberWorks);
        })
      );
    },
    [items]
  );

  const createCollection = useCallback(
    (name) => {
      const res = createCustomCollection(name, collections);
      if (res.created && !res.duplicate) {
        setCollections((prev) => createCustomCollection(name, prev).collections);
      }
      return { created: res.created, duplicate: res.duplicate };
    },
    [collections]
  );

  const deleteCollection = useCallback((collectionId) => {
    if (!collectionId) return;
    const targetId = String(collectionId);
    setCollections((prev) => prev.filter((col) => col.id !== targetId));
    setItems((prev) =>
      prev.map((item) =>
        Array.isArray(item.collectionIds) && item.collectionIds.includes(targetId)
          ? {
              ...item,
              collectionIds: item.collectionIds.filter((id) => id !== targetId),
              updatedAt: new Date().toISOString(),
            }
          : item
      )
    );
  }, []);

  const toggleWorkCollection = useCallback((workId, collectionId) => {
    if (!workId || !collectionId) return;
    setItems((prev) =>
      prev.map((item) =>
        item.id === workId
          ? {
              ...item,
              collectionIds: toggleWorkInCollection(item.collectionIds, collectionId),
              updatedAt: new Date().toISOString(),
            }
          : item
      )
    );
  }, []);

  const addReadingSession = useCallback((session) => {
    if (!session) return null;
    const nowIso = new Date().toISOString();
    const minutesWatched = Math.max(
      0,
      Number(session.minutesWatched) ||
        Math.round((Number(session.durationSeconds) || 0) / 60)
    );
    const episodesWatched = Math.max(0, Number(session.episodesWatched) || 0);
    const record = {
      id: session.id || createUuid(),
      workId: String(session.workId || ''),
      startedAt: session.startedAt || nowIso,
      endedAt: session.endedAt || nowIso,
      durationSeconds: Math.max(0, Number(session.durationSeconds) || minutesWatched * 60),
      minutesWatched,
      episodesWatched,
      notes: String(session.notes || ''),
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    setReadingSessions((prev) => [record, ...prev].slice(0, 500));
    return record;
  }, []);

  const exportBackup = useCallback(
    async (extra = {}) => {
      const episodeEvaluations =
        Array.isArray(extra.episodeEvaluations)
          ? extra.episodeEvaluations
          : await getAllEpisodeEvaluations().catch(() => []);
      const db = buildCodiceDatabase({
        items,
        profile: extra.profile || null,
        posts: extra.posts || [],
        streak: extra.streak || null,
        readingSessions,
        collections,
        episodeEvaluations,
        follows: extra.follows || [],
        wallPosts: extra.wallPosts || [],
        directMessages: extra.directMessages || [],
      });
      const signed = await exportSignedBackupPayload(db);
      const stamp = getTodayLocalISO();
      triggerFileDownload(
        JSON.stringify(signed, null, 2),
        `cine-codice-backup-${stamp}.json`,
        'application/json;charset=utf-8'
      );
      recordBackupExportTimestamp();
      return signed;
    },
    [items, readingSessions, collections]
  );

  const exportCatalogCsv = useCallback(
    (extra = {}) => {
      const db = buildCodiceDatabase({
        items,
        profile: extra.profile || null,
        posts: extra.posts || [],
        streak: extra.streak || null,
        readingSessions,
        collections,
      });
      exportDatabaseDownloads(db).csv();
    },
    [items, readingSessions, collections]
  );

  const exportCatalogMarkdown = useCallback(
    (extra = {}) => {
      const db = buildCodiceDatabase({
        items,
        profile: extra.profile || null,
        posts: extra.posts || [],
        streak: extra.streak || null,
        readingSessions,
        collections,
      });
      exportDatabaseDownloads(db).md();
    },
    [items, readingSessions, collections]
  );

  const importBackup = useCallback(
    async (file) => {
      if (!file) return { ok: false, error: domainConfig.ui.profile.backup.importError };
      try {
        const text = await file.text();
        const result = parseAndValidateBackupText(text);
        if (!result.ok) {
          return { ok: false, error: result.error };
        }
        const validItems = result.items.map((i) => normalizeItem(i, spectatorDna));
        setItems(validItems);
        setReadingSessions(result.readingSessions || []);
        if (Array.isArray(result.collections)) {
          setCollections(normalizeCollectionList(result.collections));
        }
        if (Array.isArray(result.episodeEvaluations) && result.episodeEvaluations.length > 0) {
          await importEpisodeEvaluations(result.episodeEvaluations).catch(() => {});
        }
        return {
          ok: true,
          count: validItems.length,
          profile: result.profile || null,
          posts: Array.isArray(result.posts) ? result.posts : null,
          streak: result.streak || null,
          collections: result.collections || null,
          episodeEvaluations: result.episodeEvaluations || [],
          integrity: result.integrity,
          detectedSchemaVersion: result.detectedSchemaVersion,
        };
      } catch {
        return { ok: false, error: domainConfig.ui.profile.backup.importError };
      }
    },
    [spectatorDna]
  );

  const replaceWorkspaceData = useCallback(
    ({ items: nextItems, readingSessions: nextSessions, collections: nextCollections } = {}) => {
      if (Array.isArray(nextItems)) {
        setItems(nextItems.map((i) => normalizeItem(i, spectatorDna)));
      }
      if (Array.isArray(nextSessions)) {
        setReadingSessions(nextSessions);
      }
      if (Array.isArray(nextCollections)) {
        setCollections(normalizeCollectionList(nextCollections));
      }
    },
    [spectatorDna]
  );

  return {
    items,
    readingSessions,
    collections,
    addItem,
    batchAddItems,
    updateItem,
    removeItem,
    batchUpdateItems,
    batchRemoveItems,
    restoreRemovedItems,
    createCollection,
    deleteCollection,
    moveCollection,
    moveCollectionWork,
    toggleWorkCollection,
    addReadingSession,
    replaceWorkspaceData,
    exportBackup,
    exportCatalogCsv,
    exportCatalogMarkdown,
    importBackup,
    storageError,
    retryPersistStorage,
  };
}
