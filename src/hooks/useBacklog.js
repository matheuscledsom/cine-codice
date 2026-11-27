import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getAllEpisodeEvaluations,
  importEpisodeEvaluations,
} from '../api/cacheDb.js';
import {
  saveAutoSnapshot,
  verifyAutoSnapshotIntegrity,
} from '../services/backupEngine.js';
import {
  getAllRelationalWorks,
  migrateLegacyToRelationalDb,
  putRelationalSessions,
  putRelationalWorks,
  runRelationalSchemaMigrations,
} from '../services/relationalDb.js';
import {
  domainConfig,
  inferDomainFromWork,
  normalizeCinemaStatus,
  normalizeGameEditionType,
  normalizeWorkTypeForDomain,
} from '../config/domainConfig.js';
import { normalizeAchievementsModel } from '../lib/gameDepth.js';
import {
  isCompressedManualCoverDataUrl,
  saveManualCoverInIdb,
} from '../lib/manualCovers.js';
import { initialItems } from '../data/mockData.js';
import { applyCanonicalIdsToWork } from '../lib/idBridge.js';
import { classifyLegacyRatingSource } from '../lib/migrations.js';
import {
  calculateCriteriaRating,
  isFiveCriteriaRecord,
  resolveLifeWorkFlag,
} from '../lib/ratingModel.js';
import { normalizeExternalRatings } from '../lib/ratings.js';
import { safeSetLocalStorageJson } from '../lib/storagePersistence.js';
import {
  clearLocalDeletedIds,
  exportSignedBackupPayload,
  loadEmergencyMirror,
  readLocalDeletedIds,
  recordLocalDeletedIds,
  recordBackupExportTimestamp,
} from '../services/backupEngine.js';
import {
  buildCodiceDatabase,
  createUuid,
  exportDatabaseDownloads,
  hydrateAppSnapshotFromDatabase,
  loadStoredCodiceDatabase,
  parseAndValidateBackupText,
  triggerFileDownload,
} from '../services/codiceDatabase.js';
import {
  calculateSmartRating,
  calculateWorkProgress,
  getTodayLocalISO,
  getVerdictForScore,
  isEpisodicWork,
  normalizeTagsList,
  syncCinemaEpisodeFields,
} from '../utils/backlogHelpers.js';
import {
  COLLECTIONS_STORAGE_KEY,
  createCustomCollection,
  normalizeCollectionList,
  reorderCollections,
  reorderWorkInCollection,
  saveCollections,
  toggleWorkInCollection,
} from '../utils/collections.js';

const STORAGE_KEY = domainConfig.storageKey;
const SESSIONS_STORAGE_KEY = 'cine_codice_watch_sessions_v1';
export { clearLocalDeletedIds, readLocalDeletedIds, recordLocalDeletedIds };

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

function normalizeGameRating11(value) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  const clamped = Math.max(0, Math.min(11, parsed));
  return Math.round(clamped * 10) / 10;
}

function normalizeTrackRating10(value) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  const clamped = Math.max(0, Math.min(10, parsed));
  return Math.round(clamped * 10) / 10;
}

export function normalizeItem(rawItem, spectatorDna = null) {
  const status = normalizeCinemaStatus(rawItem.status || domainConfig.ui.add.defaultNewStatus);
  const isCompleted = status === 'completed';
  const domain = inferDomainFromWork(rawItem);
  const workType = normalizeWorkTypeForDomain(rawItem.workType || rawItem.mediaType, domain);
  const today = getTodayLocalISO();

  const completedDate = isCompleted ? rawItem.completedDate || today : null;
  const startDate =
    status === 'playing' || status === 'rewatching'
      ? rawItem.startDate || today
      : isCompleted
        ? rawItem.startDate || completedDate
        : rawItem.startDate || null;

  const gameRating11 = domain === 'games' ? normalizeGameRating11(rawItem.gameRating11) : null;
  const trackRating10 = domain === 'music' ? normalizeTrackRating10(rawItem.trackRating10) : null;
  const lifeWork = resolveLifeWorkFlag(rawItem);
  const ratingManualOverride = Boolean(rawItem.ratingManualOverride);

  const reviewCriteria = rawItem.reviewCriteria || null;
  const reviewCriteria5 = rawItem.reviewCriteria5 || (
    isFiveCriteriaRecord(reviewCriteria, domain) ? reviewCriteria : null
  );
  const derivedFromDomainScale =
    gameRating11 !== null
      ? Math.min(100, Math.round(gameRating11 * 10))
      : trackRating10 !== null
        ? Math.min(100, Math.round(trackRating10 * 10))
        : null;

  const explicitRating = normalizeRating(rawItem.rating);
  let computedRating = explicitRating ?? derivedFromDomainScale;
  if (!ratingManualOverride) {
    if (reviewCriteria5) {
      const calc5 = calculateCriteriaRating(reviewCriteria5, domain);
      computedRating = calc5.suggestedScore100 ?? explicitRating ?? derivedFromDomainScale;
    } else if (reviewCriteria) {
      computedRating = calculateSmartRating(reviewCriteria, spectatorDna);
    }
  }

  const rating = isCompleted
    ? computedRating ?? explicitRating ?? derivedFromDomainScale
    : explicitRating ?? computedRating ?? derivedFromDomainScale;

  const durationMinutes = normalizeNullablePositiveInt(rawItem.durationMinutes);
  const totalSeconds =
    normalizeNullablePositiveInt(rawItem.totalSeconds) ||
    (durationMinutes ? durationMinutes * 60 : null);
  const rawCurrentSeconds = normalizeNonNegativeInt(rawItem.currentSeconds);
  const currentSeconds = isCompleted && totalSeconds ? totalSeconds : rawCurrentSeconds;

  const episodeDurationMinutes = normalizeNullablePositiveInt(
    rawItem.episodeDurationMinutes
  );

  const episodeFields = syncCinemaEpisodeFields(rawItem, isCompleted);
  const withIds = applyCanonicalIdsToWork(rawItem);
  const ratingSource = classifyLegacyRatingSource({
    ...rawItem,
    rating,
    reviewCriteria,
  });
  const externalRatings = normalizeExternalRatings(rawItem.externalRatings);

  const totalPages = normalizeNullablePositiveInt(rawItem.totalPages);
  const pagesRead = normalizeNonNegativeInt(rawItem.pagesRead);
  const manualCoverDataUrl = isCompressedManualCoverDataUrl(rawItem.manualCoverDataUrl)
    ? rawItem.manualCoverDataUrl
    : isCompressedManualCoverDataUrl(rawItem.coverUrl) &&
        (rawItem.isManual || rawItem.ids?.source === 'manual')
      ? rawItem.coverUrl
      : '';
  const cleanWorkUrl = /^https?:\/\//i.test(
    String(rawItem.workUrl ?? rawItem.progress_data?.workUrl ?? '').trim()
  )
    ? String(rawItem.workUrl ?? rawItem.progress_data?.workUrl).trim()
    : '';

  const normalized = {
    ...rawItem,
    id: String(rawItem.id || createUuid()),
    domain,
    workType,
    mediaType: workType,
    status,
    title: String(rawItem.title || ''),
    originalTitle: String(rawItem.originalTitle || '').trim(),
    creator: String(rawItem.creator || rawItem.director || rawItem.studio || rawItem.author || '').trim(),
    director: String(rawItem.director || rawItem.creator || rawItem.studio || rawItem.author || '').trim(),
    coverUrl: rawItem.coverUrl || manualCoverDataUrl || null,
    manualCoverDataUrl,
    isManual: Boolean(
      rawItem.isManual || rawItem.ids?.source === 'manual' || rawItem.progress_data?.isManual
    ),
    seriesVolume: String(rawItem.seriesVolume ?? rawItem.progress_data?.seriesVolume ?? '').trim(),
    workUrl: cleanWorkUrl,
    // Leitura & Acadêmico
    pagesRead,
    totalPages,
    chaptersRead: normalizeNonNegativeInt(rawItem.chaptersRead),
    isbnOrDoi: String(rawItem.isbnOrDoi || rawItem.isbn || rawItem.doi || '').trim(),
    bookFormat: String(rawItem.bookFormat || (domain === 'reading' ? 'Físico' : '')).trim(),
    // Games (nunca assume PC por padrão se não informado)
    platform: String(rawItem.platform || '').trim(),
    platforms: Array.isArray(rawItem.platforms)
      ? Array.from(new Set(rawItem.platforms.map((p) => String(p || '').trim()).filter(Boolean)))
      : [],
    originalPlatforms: Array.isArray(rawItem.originalPlatforms ?? rawItem.progress_data?.originalPlatforms)
      ? Array.from(
          new Set(
            (rawItem.originalPlatforms ?? rawItem.progress_data?.originalPlatforms)
              .map((p) => String(p || '').trim())
              .filter(Boolean)
          )
        )
      : [],
    editionType:
      domain === 'games'
        ? normalizeGameEditionType(rawItem.editionType)
        : String(rawItem.editionType || '').trim(),
    gameRating11,
    masterpieceJustification: String(rawItem.masterpieceJustification || '').trim().slice(0, 400),
    hoursPlayed: Math.max(0, Number(rawItem.hoursPlayed) || 0),
    completionType: String(rawItem.completionType || '').trim(),
    storeOrLauncher: String(rawItem.storeOrLauncher || '').trim(),
    buildOrCharacter: String(rawItem.buildOrCharacter || '').trim(),
    // Música
    albumName: String(rawItem.albumName || '').trim(),
    durationMs: normalizeNullablePositiveInt(rawItem.durationMs),
    trackRating10,
    favoriteTrack: String(rawItem.favoriteTrack || '').trim(),
    subgenre: String(rawItem.subgenre || '').trim(),
    releaseFormat: String(
      rawItem.releaseFormat ||
        (domain === 'music'
          ? workType === 'track'
            ? 'Faixa Individual'
            : 'Álbum de Estúdio'
          : '')
    ).trim(),
    listenCount: normalizeNonNegativeInt(rawItem.listenCount),
    tracks: Array.isArray(rawItem.tracks) ? rawItem.tracks : [],
    trackRatings:
      rawItem.trackRatings &&
      typeof rawItem.trackRatings === 'object' &&
      !Array.isArray(rawItem.trackRatings)
        ? rawItem.trackRatings
        : {},
    trackCount: normalizeNullablePositiveInt(rawItem.trackCount),
    studio: String(rawItem.studio || '').trim(),
    cast: String(rawItem.cast || '').trim(),
    format: rawItem.format || domainConfig.mediaFormats[0],
    audioFormat: rawItem.audioFormat || domainConfig.audioFormatTags[0],
    animeFormat: rawItem.animeFormat || (workType === 'anime' ? 'TV' : ''),
    backdropUrl: rawItem.backdropUrl || null,
    coverSources: Array.isArray(rawItem.coverSources)
      ? rawItem.coverSources.filter(Boolean)
      : rawItem.coverUrl || manualCoverDataUrl
        ? [rawItem.coverUrl || manualCoverDataUrl]
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
    favoriteScene: String(rawItem.favoriteScene || '').trim().slice(0, 200),
    favoriteRank:
      Number.isInteger(Number(rawItem.favoriteRank)) &&
      Number(rawItem.favoriteRank) >= 1 &&
      Number(rawItem.favoriteRank) <= 4
        ? Number(rawItem.favoriteRank)
        : null,
    backdropCheckedAt: Number(rawItem.backdropCheckedAt) || null,
    recommended: rawItem.recommended !== undefined ? Boolean(rawItem.recommended) : false,
    synopsis: String(rawItem.synopsis ?? rawItem.overview ?? '').trim(),
    overview: String(rawItem.overview ?? rawItem.synopsis ?? '').trim(),
    atmosphere: Array.isArray(rawItem.atmosphere)
      ? rawItem.atmosphere
      : Array.isArray(rawItem.moods)
        ? rawItem.moods
        : [],
    moods: Array.isArray(rawItem.moods)
      ? rawItem.moods
      : Array.isArray(rawItem.atmosphere)
        ? rawItem.atmosphere
        : [],
    tropes: Array.isArray(rawItem.tropes) ? rawItem.tropes : [],
    collectionIds: Array.isArray(rawItem.collectionIds)
      ? Array.from(new Set(rawItem.collectionIds.map(String).filter(Boolean)))
      : [],
    quotes: Array.isArray(rawItem.quotes)
      ? rawItem.quotes.filter((q) => q && typeof q === 'object' && q.text)
      : [],
    rating,
    ratingSource,
    lifeWork,
    ratingManualOverride,
    reviewCriteria5,
    franchiseTier: ['mainline', 'spinoff', 'companion', 'unclassified'].includes(
      String(rawItem.franchiseTier || '').trim().toLowerCase()
    )
      ? String(rawItem.franchiseTier).trim().toLowerCase()
      : '',
    editionOf: (() => {
      const clean = String(rawItem.editionOf ?? rawItem.progress_data?.editionOf ?? '').trim();
      return clean && clean !== String(rawItem.id || '') ? clean : null;
    })(),
    releasedEpisodesCount:
      Number(rawItem.releasedEpisodesCount) > 0
        ? Math.floor(Number(rawItem.releasedEpisodesCount))
        : null,
    releasedEpisodesSource: String(rawItem.releasedEpisodesSource || '').trim() || null,
    releasedEpisodesFetchedAt: rawItem.releasedEpisodesFetchedAt || null,
    excludeFromDiscography: Boolean(
      rawItem.excludeFromDiscography ?? rawItem.progress_data?.excludeFromDiscography
    ),
    igdbId:
      Number(rawItem.igdbId ?? rawItem.ids?.igdb ?? rawItem.progress_data?.igdbId) > 0
        ? Math.floor(Number(rawItem.igdbId ?? rawItem.ids?.igdb ?? rawItem.progress_data?.igdbId))
        : null,
    rawgId:
      Number(rawItem.rawgId ?? rawItem.ids?.rawg ?? rawItem.progress_data?.rawgId) > 0
        ? Math.floor(Number(rawItem.rawgId ?? rawItem.ids?.rawg ?? rawItem.progress_data?.rawgId))
        : null,
    campaignTimeHours:
      Number(rawItem.campaignTimeHours ?? rawItem.progress_data?.campaignTimeHours) > 0
        ? Math.round(Number(rawItem.campaignTimeHours ?? rawItem.progress_data?.campaignTimeHours) * 10) / 10
        : null,
    campaignTimeSource:
      String(rawItem.campaignTimeSource ?? rawItem.progress_data?.campaignTimeSource ?? '').trim() ||
      null,
    rawgPlaytimeHours:
      Number(rawItem.rawgPlaytimeHours ?? rawItem.progress_data?.rawgPlaytimeHours) > 0
        ? Math.round(Number(rawItem.rawgPlaytimeHours ?? rawItem.progress_data?.rawgPlaytimeHours) * 10) / 10
        : null,
    rawgPlaytimeSource:
      String(rawItem.rawgPlaytimeSource ?? rawItem.progress_data?.rawgPlaytimeSource ?? '').trim() ||
      null,
    manualCampaignHours:
      Number(rawItem.manualCampaignHours ?? rawItem.progress_data?.manualCampaignHours) > 0
        ? Math.round(Number(rawItem.manualCampaignHours ?? rawItem.progress_data?.manualCampaignHours) * 10) / 10
        : null,
    completion100Hours:
      Number(rawItem.completion100Hours ?? rawItem.progress_data?.completion100Hours) > 0
        ? Math.round(Number(rawItem.completion100Hours ?? rawItem.progress_data?.completion100Hours) * 10) / 10
        : null,
    completion100Source:
      String(rawItem.completion100Source ?? rawItem.progress_data?.completion100Source ?? '').trim() ||
      null,
    parentGame: rawItem.parentGame ?? rawItem.progress_data?.parentGame ?? null,
    versionParent: rawItem.versionParent ?? rawItem.progress_data?.versionParent ?? null,
    achievements: normalizeAchievementsModel(
      rawItem.achievements ?? rawItem.progress_data?.achievements
    ),
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
    createdAt: rawItem.createdAt || '',
    updatedAt: rawItem.updatedAt || rawItem.updated_at || '',
    updated_at: rawItem.updatedAt || rawItem.updated_at || '',
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
    } else if (merged.domain === 'cinema' && merged.totalSeconds > 0) {
      merged.currentSeconds = merged.totalSeconds;
    }

    if (!merged.ratingManualOverride && merged.reviewCriteria5) {
      const calc5 = calculateCriteriaRating(merged.reviewCriteria5, merged.domain);
      if (calc5.suggestedScore100 !== null) {
        merged.rating = calc5.suggestedScore100;
        merged.ratingSource = 'manual';
      }
    } else if (!merged.ratingManualOverride && merged.reviewCriteria) {
      merged.rating = isFiveCriteriaRecord(merged.reviewCriteria, merged.domain)
        ? calculateCriteriaRating(merged.reviewCriteria, merged.domain).suggestedScore100
        : calculateSmartRating(merged.reviewCriteria, spectatorDna);
      merged.ratingSource = merged.rating !== null ? 'manual' : null;
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
  const relationalReadyRef = useRef(false);

  useEffect(() => {
    if (migrationLocked || relationalReadyRef.current) return undefined;
    let active = true;
    (async () => {
      try {
        if (items.length === 0) {
          const fromIdb = await getAllRelationalWorks();
          if (active && Array.isArray(fromIdb) && fromIdb.length > 0) {
            setItems(fromIdb.map((w) => normalizeItem(w, spectatorDna)));
            relationalReadyRef.current = true;
            return;
          }
        }
        const evals = await getAllEpisodeEvaluations();
        await migrateLegacyToRelationalDb({
          items,
          sessions: readingSessions,
          episodeEvaluations: evals,
          collections,
        });
        const schemaRes = await runRelationalSchemaMigrations({
          items,
          sessions: readingSessions,
          episodeEvaluations: evals,
          collections,
          saveSnapshotFn: saveAutoSnapshot,
          verifySnapshotFn: verifyAutoSnapshotIntegrity,
        });
        if (active && schemaRes?.migrated && Array.isArray(schemaRes.items) && schemaRes.items.length > 0) {
          setItems(schemaRes.items.map((w) => normalizeItem(w, spectatorDna)));
        }
      } catch {
        // Silencioso para não travar inicialização
      } finally {
        if (active) relationalReadyRef.current = true;
      }
    })();
    return () => {
      active = false;
    };
  }, [migrationLocked]); // eslint-disable-line react-hooks/exhaustive-deps

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
    putRelationalWorks(items, { replace: true }).catch(() => {});
    putRelationalSessions(readingSessions, { replace: true }).catch(() => {});
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
      if (relationalReadyRef.current) {
        putRelationalWorks(items, { replace: true }).catch(() => {});
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
      if (relationalReadyRef.current) {
        putRelationalSessions(readingSessions, { replace: true }).catch(() => {});
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
            updated_at: nowIso,
          },
          spectatorDna
        ),
        status,
        null,
        spectatorDna
      );

      clearLocalDeletedIds([prepared.id]);
      const normalizedTitle = prepared.title.trim().toLowerCase();
      if (prepared.manualCoverDataUrl) {
        saveManualCoverInIdb(prepared.id, prepared.manualCoverDataUrl).catch(() => {});
      }

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
                  updated_at: nowIso,
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
                updated_at: nowIso,
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
          const preserveUpdatedAt = Boolean(updates.preserveUpdatedAt);
          const cleanUpdates = { ...updates };
          delete cleanUpdates.preserveUpdatedAt;

          const nextUpdatedAt = preserveUpdatedAt
            ? item.updatedAt || item.updated_at || ''
            : cleanUpdates.updatedAt || cleanUpdates.updated_at || nowIso;

          let merged = normalizeItem(
            {
              ...item,
              ...cleanUpdates,
              status: nextStatus,
              updatedAt: nextUpdatedAt,
              updated_at: nextUpdatedAt,
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
          } else if (
            !merged.ratingManualOverride &&
            Object.prototype.hasOwnProperty.call(updates, 'reviewCriteria')
          ) {
            const score = isFiveCriteriaRecord(updates.reviewCriteria, merged.domain)
              ? calculateCriteriaRating(updates.reviewCriteria, merged.domain).suggestedScore100
              : calculateSmartRating(updates.reviewCriteria, spectatorDna);
            merged.rating = score;
            merged.ratingSource =
              updates.ratingSource ?? (score !== null ? 'manual' : null);
            merged.verdict = getVerdictForScore(score);
          }

          if (cleanUpdates.manualCoverDataUrl && merged.manualCoverDataUrl) {
            saveManualCoverInIdb(merged.id, merged.manualCoverDataUrl).catch(() => {});
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
    recordLocalDeletedIds([id]);
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
          let merged = { ...item, updatedAt: nowIso, updated_at: nowIso };
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
      recordLocalDeletedIds(Array.from(idSet));
      setItems((prev) => prev.filter((item) => !idSet.has(String(item.id))));
      setReadingSessions((prev) => prev.filter((s) => !idSet.has(String(s.workId))));
      return { removedItems, removedSessions };
    },
    [items, readingSessions]
  );

  const restoreRemovedItems = useCallback(
    ({ removedItems = [], removedSessions = [] } = {}) => {
      const nowIso = new Date().toISOString();
      if (Array.isArray(removedItems) && removedItems.length > 0) {
        clearLocalDeletedIds(removedItems.map((i) => i?.id).filter(Boolean));
        setItems((prev) => {
          const existingIds = new Set(prev.map((i) => String(i.id)));
          const restored = removedItems
            .filter((i) => !existingIds.has(String(i.id)))
            .map((i) =>
              normalizeItem({ ...i, updatedAt: nowIso, updated_at: nowIso }, spectatorDna)
            );
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
    const nowIso = new Date().toISOString();
    setCollections((prev) => prev.filter((col) => col.id !== targetId));
    setItems((prev) =>
      prev.map((item) =>
        Array.isArray(item.collectionIds) && item.collectionIds.includes(targetId)
          ? {
              ...item,
              collectionIds: item.collectionIds.filter((id) => id !== targetId),
              updatedAt: nowIso,
              updated_at: nowIso,
            }
          : item
      )
    );
  }, []);

  const toggleWorkCollection = useCallback((workId, collectionId) => {
    if (!workId || !collectionId) return;
    const nowIso = new Date().toISOString();
    setItems((prev) =>
      prev.map((item) =>
        item.id === workId
          ? {
              ...item,
              collectionIds: toggleWorkInCollection(item.collectionIds, collectionId),
              updatedAt: nowIso,
              updated_at: nowIso,
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
      updated_at: nowIso,
    };
    setReadingSessions((prev) => [record, ...prev].slice(0, 500));
    if (record.workId) {
      setItems((prev) =>
        prev.map((item) =>
          String(item.id) === record.workId
            ? { ...item, updatedAt: nowIso, updated_at: nowIso }
            : item
        )
      );
    }
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
