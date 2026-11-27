import {
  OMNIPRISM_DOMAIN_IDS,
  inferDomainFromWork,
  normalizeCinemaStatus,
  normalizeDomainId,
  normalizeGameEditionType,
  normalizeWorkTypeForDomain,
} from '../config/domainConfig.js';
import { recordLocalError } from '../lib/errorLogger.js';
import { normalizeAchievementsModel } from '../lib/gameDepth.js';
import { normalizeExternalRatings } from '../lib/ratings.js';
import {
  EPOCH_ZERO_ISO,
  getAllRelationalWorks,
  putRelationalWorks,
} from './relationalDb.js';
import {
  getSupabaseClient,
  getSupabaseConfig,
  requestPersistentBrowserStorage,
} from './supabaseClient.js';

export const OMNI_CATALOG_TABLE = 'catalog_works';
export const OMNI_COVERS_BUCKET = 'covers';
export const OMNI_CINEMA_DOMAIN = 'cinema';
export const SYNC_META_STORAGE_KEY = 'omniprism_cloud_sync_meta_v1';
export const PENDING_DELETES_STORAGE_KEY = 'omniprism_cloud_pending_deletes_v1';
export const CLOUD_TOMBSTONES_STORAGE_KEY = 'omniprism_cloud_tombstones_v1';
export const SYNC_QUEUE_STORAGE_KEY = 'omniprism_cloud_sync_queue_v1';

export const ALLOWED_CLOUD_DOMAINS = Object.freeze(['cinema', 'reading', 'games', 'music']);

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DOMAIN_ALIASES = new Map([
  ['cinema', 'cinema'],
  ['movie', 'cinema'],
  ['movies', 'cinema'],
  ['film', 'cinema'],
  ['filmes', 'cinema'],
  ['series', 'cinema'],
  ['séries', 'cinema'],
  ['tv', 'cinema'],
  ['anime', 'cinema'],
  ['animes', 'cinema'],
  ['reading', 'reading'],
  ['book', 'reading'],
  ['books', 'reading'],
  ['livro', 'reading'],
  ['livros', 'reading'],
  ['leitura', 'reading'],
  ['manga', 'reading'],
  ['mangá', 'reading'],
  ['mangas', 'reading'],
  ['mangás', 'reading'],
  ['hq', 'reading'],
  ['comic', 'reading'],
  ['comics', 'reading'],
  ['academic', 'reading'],
  ['technical', 'reading'],
  ['paper', 'reading'],
  ['games', 'games'],
  ['game', 'games'],
  ['jogo', 'games'],
  ['jogos', 'games'],
  ['videogame', 'games'],
  ['dlc', 'games'],
  ['modpack', 'games'],
  ['music', 'music'],
  ['musica', 'music'],
  ['música', 'music'],
  ['sound', 'music'],
  ['album', 'music'],
  ['álbum', 'music'],
  ['track', 'music'],
  ['faixa', 'music'],
  ['ep', 'music'],
  ['ep_single', 'music'],
  ['single', 'music'],
  ['discography', 'music'],
]);

// Se a coluna external_rating no Supabase for numérica em vez de jsonb, ajusta automaticamente
// (no upload real para `public.catalog_works`, `prepareCatalogRowForCloudUpload` já envia inteiro 0..100 ou null)
let externalRatingNumericFallback = false;
// Se a coluna deleted_at ainda não existir no Supabase (antes de rodar o SQL aditivo), opera em modo compatível
let deletedAtColumnUnsupported = false;

export function resetSyncRuntimeFlagsForTests() {
  externalRatingNumericFallback = false;
  deletedAtColumnUnsupported = false;
}

export function getTombstoneSyncMode() {
  return deletedAtColumnUnsupported ? 'compat_hard_delete' : 'soft_delete';
}

export function isValidUuid(raw) {
  return UUID_REGEX.test(String(raw || '').trim());
}

export function sanitizeCloudDomain(work = {}) {
  const rawDomain = String(work?.domain || '').trim().toLowerCase();
  if (rawDomain && DOMAIN_ALIASES.has(rawDomain)) {
    return DOMAIN_ALIASES.get(rawDomain);
  }
  const rawType = String(work?.workType || work?.mediaType || work?.media_type || '')
    .trim()
    .toLowerCase();
  if (rawType && DOMAIN_ALIASES.has(rawType)) {
    return DOMAIN_ALIASES.get(rawType);
  }
  const inferred = inferDomainFromWork(work);
  return ALLOWED_CLOUD_DOMAINS.includes(inferred) ? inferred : 'cinema';
}

export function sanitizeCloudInt0To100(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'object') {
    if (raw.consensus !== undefined) return sanitizeCloudInt0To100(raw.consensus);
    return null;
  }
  const num = Number(raw);
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.min(100, Math.round(num)));
}

export function sanitizeCloudFavoriteRank(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const num = Number(raw);
  if (!Number.isInteger(num) || num < 1 || num > 4) return null;
  return num;
}

export function sanitizeCloudIsoTimestamp(raw, fallback = EPOCH_ZERO_ISO) {
  if (!raw) return fallback;
  const ms = Date.parse(String(raw));
  if (!Number.isFinite(ms)) return fallback;
  return new Date(ms).toISOString();
}

function deterministicCloudUuid(seedText) {
  const input = String(seedText || 'omniprism');
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  let h3 = 0x85ebca6b;
  let h4 = 0xc2b2ae35;

  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (code + i), 0x85ebca6b) >>> 0;
    h3 = Math.imul(h3 ^ (code * 31), 0xc2b2ae35) >>> 0;
    h4 = Math.imul(h4 ^ (code + 17), 0x27d4eb2f) >>> 0;
  }

  const hex = [h1, h2, h3, h4].map((n) => n.toString(16).padStart(8, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function toCloudWorkId(localId) {
  const clean = String(localId || '').trim();
  if (!clean) return deterministicCloudUuid(`empty:${Date.now()}`);
  if (UUID_REGEX.test(clean)) return clean.toLowerCase();
  return deterministicCloudUuid(`omniprism:cinema:${clean}`);
}

function normalizeHttpUrl(raw) {
  const clean = String(raw || '').trim();
  if (!clean) return null;
  if (/^data:/i.test(clean)) return null;
  if (/^https?:\/\//i.test(clean)) {
    return clean.replace(/^http:\/\//i, 'https://');
  }
  return null;
}

export function parseTimestampMs(isoOrDate) {
  if (!isoOrDate) return 0;
  const ms = Date.parse(String(isoOrDate));
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

/**
 * Resolve o timestamp efetivo de atualização de uma obra para resolução de conflitos.
 * Obra sem `updatedAt`/`updated_at` (ou com Epoch 0) retorna `0` e conta sempre como a mais antiga.
 */
export function parseWorkUpdatedMs(work = {}) {
  if (!work || typeof work !== 'object') return 0;
  const raw = work.updatedAt ?? work.updated_at ?? null;
  return parseTimestampMs(raw);
}

export function buildFranchiseKey(work = {}) {
  if (work?.belongsToCollection?.id) {
    return `tmdb-collection:${work.belongsToCollection.id}`;
  }
  const cleanName = String(work?.franchiseName || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleanName || null;
}

export function computeConsensusExternalRating(externalRatings) {
  const normalized = normalizeExternalRatings(externalRatings);
  const scores = Object.values(normalized)
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const val = Number(entry.value);
      const scale = Number(entry.scale) || 100;
      if (!Number.isFinite(val) || val < 0 || scale <= 0) return null;
      return Math.max(0, Math.min(100, Math.round((val / scale) * 100)));
    })
    .filter((n) => n !== null);
  if (scores.length === 0) return null;
  return Math.round(scores.reduce((acc, n) => acc + n, 0) / scores.length);
}

function serializeExternalRatingForRow(
  externalRatings,
  numericOnly = false,
  fallbackNumeric = null
) {
  const normalized = normalizeExternalRatings(externalRatings);
  const consensus = computeConsensusExternalRating(normalized);
  const hasAny = Object.values(normalized).some(Boolean);
  if (!hasAny) {
    return numericOnly ? sanitizeCloudInt0To100(fallbackNumeric) : null;
  }
  if (numericOnly) {
    return sanitizeCloudInt0To100(consensus ?? fallbackNumeric);
  }
  return {
    consensus: sanitizeCloudInt0To100(consensus),
    ...normalized,
  };
}

function buildExternalIdsPayload(work = {}) {
  const rawIds = work.ids && typeof work.ids === 'object' ? work.ids : {};
  const payload = {};
  const tmdb = work.tmdbId ?? rawIds.tmdb ?? null;
  const imdb = work.imdbId || rawIds.imdb || null;
  const tvmaze = work.tvmazeId ?? rawIds.tvmaze ?? null;
  const anilist = work.anilistId ?? rawIds.anilist ?? null;
  const mal = work.malId ?? rawIds.mal ?? null;

  if (tmdb !== null && tmdb !== undefined && tmdb !== '') payload.tmdb = Number(tmdb) || tmdb;
  if (imdb) payload.imdb = String(imdb).trim();
  if (tvmaze !== null && tvmaze !== undefined && tvmaze !== '') {
    payload.tvmaze = Number(tvmaze) || tvmaze;
  }
  if (anilist !== null && anilist !== undefined && anilist !== '') {
    payload.anilist = Number(anilist) || anilist;
  }
  if (mal !== null && mal !== undefined && mal !== '') payload.mal = Number(mal) || mal;
  if (work.tmdbMediaType) payload.tmdbMediaType = String(work.tmdbMediaType);

  // Domínios Reading, Games e Music
  for (const key of [
    'openlibrary',
    'googleBooks',
    'isbn',
    'doi',
    'igdb',
    'igdbParent',
    'igdbVersionParent',
    'rawg',
    'steam',
    'retroachievements',
    'wikidata',
    'cheapshark',
    'freetogame',
    'itunes',
    'itunesTrack',
    'itunesArtist',
    'musicbrainz',
    'musicbrainzRecording',
    'musicbrainzArtist',
  ]) {
    const val =
      rawIds[key] ??
      work[key] ??
      (key === 'igdb' ? work.igdbId : key === 'rawg' ? work.rawgId : null) ??
      null;
    if (val !== null && val !== undefined && val !== '') {
      payload[key] = val;
    }
  }
  if (rawIds.source === 'manual' || work.isManual) {
    payload.source = 'manual';
    if (rawIds.id || work.id) {
      payload.id = String(rawIds.id || work.id);
    }
  }
  if (rawIds.linkedFromManualId) {
    payload.linkedFromManualId = String(rawIds.linkedFromManualId);
  }
  if (valIsbnOrDoi(work)) {
    const cleanIsbn = String(work.isbnOrDoi || work.isbn || '').trim();
    if (cleanIsbn && !payload.isbn) payload.isbn = cleanIsbn;
  }

  return payload;
}

function valIsbnOrDoi(work) {
  return Boolean(work?.isbnOrDoi || work?.isbn);
}

export function filterWorksByDomain(works = [], domain = 'cinema') {
  const target = normalizeDomainId(domain);
  return (Array.isArray(works) ? works : []).filter(
    (w) => w && inferDomainFromWork(w) === target
  );
}

export function mapLocalWorkToCatalogRow(
  work = {},
  userId,
  {
    numericExternalRating = externalRatingNumericFallback,
    includeDeletedAt = false,
    deletedAt = null,
  } = {}
) {
  const rawIdentity = String(work.cloudId || work.id || work.ids?.id || '').trim();
  const cloudId = rawIdentity ? toCloudWorkId(rawIdentity) : '';
  const domain = sanitizeCloudDomain(work);
  const mediaType = normalizeWorkTypeForDomain(work.workType || work.mediaType, domain);
  const status = normalizeCinemaStatus(work.status);
  const releaseYear = Number(work.releaseYear);
  const favoriteRankVal = sanitizeCloudFavoriteRank(work.favoriteRank ?? work.favorite_rank);
  const ratingVal = sanitizeCloudInt0To100(work.rating);

  const cleanCoverUrl = normalizeHttpUrl(work.coverUrl);
  const cleanBackdropUrl = normalizeHttpUrl(work.backdropUrl);
  const cleanExternalRatings = normalizeExternalRatings(work.externalRatings);

  const pagesRead = Math.max(0, Math.round(Number(work.pagesRead) || 0));
  const totalPages = Number(work.totalPages) > 0 ? Math.round(Number(work.totalPages)) : null;
  const chaptersRead = Math.max(0, Math.round(Number(work.chaptersRead) || 0));
  const isbnOrDoi = String(work.isbnOrDoi || work.isbn || work.doi || '').trim();
  const bookFormat = String(work.bookFormat || '').trim();

  const platform = String(work.platform || '').trim();
  const platforms = Array.isArray(work.platforms)
    ? Array.from(new Set(work.platforms.map((p) => String(p || '').trim()).filter(Boolean)))
    : [];
  const originalPlatforms = Array.isArray(work.originalPlatforms)
    ? Array.from(new Set(work.originalPlatforms.map((p) => String(p || '').trim()).filter(Boolean)))
    : [];
  const editionType =
    domain === 'games'
      ? normalizeGameEditionType(work.editionType)
      : String(work.editionType || '').trim();
  const gameRating11 =
    work.gameRating11 !== null &&
    work.gameRating11 !== undefined &&
    work.gameRating11 !== '' &&
    Number.isFinite(Number(work.gameRating11))
      ? Math.max(0, Math.min(11, Math.round(Number(work.gameRating11) * 10) / 10))
      : null;
  const masterpieceJustification = String(work.masterpieceJustification || '').trim().slice(0, 400);
  const hoursPlayed = Math.max(0, Number(work.hoursPlayed) || 0);
  const completionType = String(work.completionType || '').trim();
  const storeOrLauncher = String(work.storeOrLauncher || '').trim();
  const buildOrCharacter = String(work.buildOrCharacter || '').trim();

  const albumName = String(work.albumName || '').trim();
  const durationMs = Number(work.durationMs) > 0 ? Math.round(Number(work.durationMs)) : null;
  const trackRating10 =
    work.trackRating10 !== null &&
    work.trackRating10 !== undefined &&
    work.trackRating10 !== '' &&
    Number.isFinite(Number(work.trackRating10))
      ? Math.max(0, Math.min(10, Math.round(Number(work.trackRating10) * 10) / 10))
      : null;
  const favoriteTrack = String(work.favoriteTrack || '').trim();
  const subgenre = String(work.subgenre || '').trim();
  const releaseFormat = String(work.releaseFormat || '').trim();
  const listenCount = Math.max(0, Math.round(Number(work.listenCount) || 0));
  const tracks = Array.isArray(work.tracks) ? work.tracks : [];
  const trackRatings =
    work.trackRatings &&
    typeof work.trackRatings === 'object' &&
    !Array.isArray(work.trackRatings)
      ? work.trackRatings
      : {};
  const trackCount = Number(work.trackCount) > 0 ? Math.round(Number(work.trackCount)) : null;

  // Nunca inventa "agora" para obra sem data: garante ISO válido preservando Epoch 0
  const resolvedUpdatedAt = sanitizeCloudIsoTimestamp(
    work.updatedAt || work.updated_at,
    EPOCH_ZERO_ISO
  );
  const resolvedCreatedAt = sanitizeCloudIsoTimestamp(
    work.createdAt || work.created_at || work.updatedAt || work.updated_at,
    EPOCH_ZERO_ISO
  );

  const row = {
    id: cloudId,
    user_id: userId,
    domain,
    media_type: mediaType,
    title: String(work.title || '').trim() || 'Sem título',
    creator: String(work.creator || work.director || work.studio || work.author || '').trim(),
    release_year:
      Number.isFinite(releaseYear) && releaseYear > 1800 ? Math.round(releaseYear) : null,
    status,
    rating: ratingVal,
    external_rating: serializeExternalRatingForRow(
      cleanExternalRatings,
      numericExternalRating,
      work.external_rating ?? work.externalScore ?? null
    ),
    external_ids: buildExternalIdsPayload(work),
    cover_url: cleanCoverUrl,
    backdrop_url: cleanBackdropUrl,
    synopsis: String(work.synopsis ?? work.overview ?? '').trim(),
    genres: Array.isArray(work.genres) ? work.genres.filter(Boolean) : [],
    tags: Array.isArray(work.tags) ? work.tags.filter(Boolean) : [],
    progress_data: {
      localId: String(work.id || cloudId),
      originalTitle: String(work.originalTitle || '').trim(),
      studio: String(work.studio || '').trim(),
      cast: String(work.cast || '').trim(),
      format: work.format || 'Streaming',
      audioFormat: work.audioFormat || 'Legendado',
      animeFormat: work.animeFormat || (mediaType === 'anime' ? 'TV' : ''),
      durationMinutes: work.durationMinutes ?? null,
      totalSeconds: work.totalSeconds ?? null,
      currentSeconds: Number(work.currentSeconds) || 0,
      episodeDurationMinutes: work.episodeDurationMinutes ?? null,
      totalSeasons: Math.max(1, Number(work.totalSeasons) || 1),
      totalEpisodes: work.totalEpisodes ?? null,
      episodesPerSeason: Array.isArray(work.episodesPerSeason)
        ? work.episodesPerSeason
        : [],
      currentSeason: Math.max(1, Number(work.currentSeason) || 1),
      currentEpisode: Math.max(0, Number(work.currentEpisode) || 0),
      watchedEpisodes:
        work.watchedEpisodes && typeof work.watchedEpisodes === 'object'
          ? work.watchedEpisodes
          : {},
      fillerEpisodes: Array.isArray(work.fillerEpisodes) ? work.fillerEpisodes : [],
      storyArcs: Array.isArray(work.storyArcs) ? work.storyArcs : [],
      rewatchCount: Number(work.rewatchCount) || 0,
      progress: Number(work.progress) || 0,
      // Reading
      pages_read: pagesRead,
      total_pages: totalPages,
      chapters_read: chaptersRead,
      isbn_or_doi: isbnOrDoi,
      book_format: bookFormat,
      seriesVolume: String(work.seriesVolume || '').trim(),
      workUrl: /^https?:\/\//i.test(String(work.workUrl || '').trim())
        ? String(work.workUrl).trim()
        : '',
      isManual: Boolean(work.isManual || work.ids?.source === 'manual'),
      // Games
      platform,
      platforms,
      edition_type: editionType,
      game_rating_11: gameRating11,
      masterpiece_justification: masterpieceJustification,
      hours_played: hoursPlayed,
      completion_type: completionType,
      store_or_launcher: storeOrLauncher,
      build_or_character: buildOrCharacter,
      // Music
      album_name: albumName,
      duration_ms: durationMs,
      track_rating_10: trackRating10,
      favorite_track: favoriteTrack,
      subgenre,
      release_format: releaseFormat,
      listen_count: listenCount,
      tracks,
      track_ratings: trackRatings,
      track_count: trackCount,
      ratingSource: work.ratingSource ?? null,
      reviewCriteria: work.reviewCriteria ?? null,
      reviewCriteria5: work.reviewCriteria5 ?? null,
      ratingManualOverride: Boolean(work.ratingManualOverride),
      lifeWork: Boolean(work.lifeWork || Number(work.gameRating11) >= 11),
      franchiseTier: ['mainline', 'spinoff', 'companion', 'unclassified'].includes(
        String(work.franchiseTier || '').trim().toLowerCase()
      )
        ? String(work.franchiseTier).trim().toLowerCase()
        : '',
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
      verdict: work.verdict ?? null,
      externalRatings: cleanExternalRatings,
      atmosphere: Array.isArray(work.atmosphere) ? work.atmosphere : [],
      tropes: Array.isArray(work.tropes) ? work.tropes : [],
      subgenres: Array.isArray(work.subgenres) ? work.subgenres : [],
      excludeFromDiscography: Boolean(
        work.excludeFromDiscography ?? work.progress_data?.excludeFromDiscography
      ),
      igdbId:
        Number(work.igdbId || work.ids?.igdb) > 0
          ? Math.floor(Number(work.igdbId || work.ids?.igdb))
          : null,
      rawgId:
        Number(work.rawgId || work.ids?.rawg) > 0
          ? Math.floor(Number(work.rawgId || work.ids?.rawg))
          : null,
      originalPlatforms,
      campaignTimeHours:
        Number(work.campaignTimeHours) > 0
          ? Math.round(Number(work.campaignTimeHours) * 10) / 10
          : null,
      campaignTimeSource: String(work.campaignTimeSource || '').trim() || null,
      rawgPlaytimeHours:
        Number(work.rawgPlaytimeHours) > 0
          ? Math.round(Number(work.rawgPlaytimeHours) * 10) / 10
          : null,
      rawgPlaytimeSource: String(work.rawgPlaytimeSource || '').trim() || null,
      manualCampaignHours:
        Number(work.manualCampaignHours) > 0
          ? Math.round(Number(work.manualCampaignHours) * 10) / 10
          : null,
      completion100Hours:
        Number(work.completion100Hours) > 0
          ? Math.round(Number(work.completion100Hours) * 10) / 10
          : null,
      completion100Source: String(work.completion100Source || '').trim() || null,
      parentGame: work.parentGame ?? null,
      versionParent: work.versionParent ?? null,
      achievements: normalizeAchievementsModel(work.achievements),
      franchiseName: String(work.franchiseName || '').trim(),
      belongsToCollection: work.belongsToCollection || null,
      franchiseRelations: Array.isArray(work.franchiseRelations)
        ? work.franchiseRelations
        : [],
      franchiseLinks: Array.isArray(work.franchiseLinks) ? work.franchiseLinks : [],
      chronologicalOrder: work.chronologicalOrder ?? null,
      tmdbStatus: work.tmdbStatus || null,
      hype: work.hype || null,
      checkpoint: String(work.checkpoint || '').trim(),
      dropReason: work.dropReason || null,
      startDate: work.startDate || null,
      completedDate: work.completedDate || null,
      completedYear: work.completedYear ?? null,
      dropDate: work.dropDate || null,
      isPlatinum: Boolean(work.isPlatinum),
      isFavorite: Boolean(work.isFavorite),
      isWishlist: Boolean(work.isWishlist),
      inBacklog: work.inBacklog !== false,
      collectionIds: Array.isArray(work.collectionIds) ? work.collectionIds : [],
      quotes: Array.isArray(work.quotes) ? work.quotes : [],
      language: String(work.language || '').trim(),
      sourceBadge: String(work.sourceBadge || '').trim(),
      mergedSources: Array.isArray(work.mergedSources) ? work.mergedSources : [],
      coverSources: Array.isArray(work.coverSources)
        ? work.coverSources.map(normalizeHttpUrl).filter(Boolean)
        : [],
      backdropCheckedAt: Number(work.backdropCheckedAt) || null,
    },
    franchise_key: buildFranchiseKey(work),
    favorite_rank: favoriteRankVal,
    favorite_quote_or_scene:
      String(work.favoriteScene || '').trim().slice(0, 200) || null,
    personal_notes: String(work.notes || ''),
    created_at: resolvedCreatedAt,
    updated_at: resolvedUpdatedAt,
  };

  if (includeDeletedAt) {
    row.deleted_at = deletedAt ?? work.deletedAt ?? work.deleted_at ?? null;
  }

  return row;
}

/**
 * Valida uma linha antes do envio ao Supabase contra as constraints reais de `public.catalog_works`.
 */
export function validateCatalogRowForCloud(row = {}) {
  const errors = [];
  if (!row || typeof row !== 'object') {
    return { ok: false, errors: ['registro inválido'], reason: 'registro inválido' };
  }
  if (!isValidUuid(row.id)) {
    errors.push('id inválido (fora do formato UUID)');
  }
  if (!String(row.user_id || '').trim()) {
    errors.push('usuário não identificado');
  }
  if (!ALLOWED_CLOUD_DOMAINS.includes(row.domain)) {
    errors.push('domínio não aceito');
  }
  if (
    row.rating !== null &&
    row.rating !== undefined &&
    (!Number.isInteger(row.rating) || row.rating < 0 || row.rating > 100)
  ) {
    errors.push('nota fora da faixa (0 a 100)');
  }
  if (
    row.external_rating !== null &&
    row.external_rating !== undefined &&
    (!Number.isInteger(row.external_rating) ||
      row.external_rating < 0 ||
      row.external_rating > 100)
  ) {
    errors.push('nota externa fora da faixa (0 a 100)');
  }
  if (
    row.favorite_rank !== null &&
    row.favorite_rank !== undefined &&
    (!Number.isInteger(row.favorite_rank) || row.favorite_rank < 1 || row.favorite_rank > 4)
  ) {
    errors.push('posição no Top 4 inválida (1 a 4)');
  }
  if (!row.created_at || Number.isNaN(Date.parse(String(row.created_at)))) {
    errors.push('data de criação inválida');
  }
  if (!row.updated_at || Number.isNaN(Date.parse(String(row.updated_at)))) {
    errors.push('data de atualização inválida');
  }

  return {
    ok: errors.length === 0,
    errors,
    reason: errors.join('; '),
  };
}

/**
 * Saneia e valida uma obra para envio ao Supabase (`public.catalog_works`):
 * - `domain` restrito a `cinema | reading | games | music` (`reading` para livros/mangás);
 * - `rating` e `external_rating` inteiros `0..100` ou `null`;
 * - `favorite_rank` inteiro `1..4` ou `null`;
 * - `id` em UUID válido (para todos os domínios, inclusive obras manuais);
 * - `created_at` e `updated_at` sempre em ISO válido.
 */
export function prepareCatalogRowForCloudUpload(
  work = {},
  userId,
  { includeDeletedAt = !deletedAtColumnUnsupported, deletedAt = null } = {}
) {
  if (!work || typeof work !== 'object') {
    return { ok: false, row: null, errors: ['registro inválido'], reason: 'registro inválido' };
  }

  // Se houver um cloudId explícito que NÃO é UUID e não há id local para derivar, rejeita com erro visível
  const explicitCloudId = String(work.cloudId || '').trim();
  const explicitLocalId = String(work.id || work.ids?.id || '').trim();
  if (!explicitCloudId && !explicitLocalId) {
    return {
      ok: false,
      row: null,
      errors: ['id inválido (fora do formato UUID)'],
      reason: 'id inválido (fora do formato UUID)',
    };
  }
  if (explicitCloudId && !isValidUuid(explicitCloudId) && !explicitLocalId) {
    return {
      ok: false,
      row: null,
      errors: ['id inválido (fora do formato UUID)'],
      reason: 'id inválido (fora do formato UUID)',
    };
  }

  // Quando `cloudId` estiver corrompido (não-UUID), deriva UUID determinístico do `id` local em vez de enviar lixo
  const safeWork =
    explicitCloudId && !isValidUuid(explicitCloudId)
      ? { ...work, cloudId: null }
      : work;

  const row = mapLocalWorkToCatalogRow(safeWork, userId, {
    numericExternalRating: true,
    includeDeletedAt,
    deletedAt,
  });

  // Garante saneamento final mesmo se algum campo externo veio fora do padrão
  row.domain = ALLOWED_CLOUD_DOMAINS.includes(row.domain)
    ? row.domain
    : sanitizeCloudDomain(safeWork);
  row.rating = sanitizeCloudInt0To100(row.rating);
  row.external_rating = sanitizeCloudInt0To100(row.external_rating);
  row.favorite_rank = sanitizeCloudFavoriteRank(row.favorite_rank);
  row.created_at = sanitizeCloudIsoTimestamp(row.created_at, EPOCH_ZERO_ISO);
  row.updated_at = sanitizeCloudIsoTimestamp(row.updated_at, EPOCH_ZERO_ISO);

  const check = validateCatalogRowForCloud(row);
  if (!check.ok) {
    return { ok: false, row: null, errors: check.errors, reason: check.reason };
  }
  return { ok: true, row, errors: [], reason: '' };
}

export const workToCloudRow = prepareCatalogRowForCloudUpload;

export function mapCatalogRowToLocalWork(row = {}) {
  const pd = row.progress_data && typeof row.progress_data === 'object' ? row.progress_data : {};
  const extIds = row.external_ids && typeof row.external_ids === 'object' ? row.external_ids : {};
  const rawExternalRating =
    pd.externalRatings && typeof pd.externalRatings === 'object'
      ? pd.externalRatings
      : row.external_rating && typeof row.external_rating === 'object'
        ? row.external_rating
        : {};
  const externalRatings = normalizeExternalRatings(rawExternalRating);
  const domain = normalizeDomainId(
    row.domain || inferDomainFromWork({ workType: row.media_type })
  );
  const workType = normalizeWorkTypeForDomain(row.media_type, domain);
  const status = normalizeCinemaStatus(row.status);
  const synopsis = String(row.synopsis || '').trim();
  const rankNum = Number(row.favorite_rank);
  const localId = String(pd.localId || row.id || '');
  const preservedUpdatedAt = row.updated_at || '';

  return {
    id: localId,
    cloudId: String(row.id || ''),
    domain,
    workType,
    mediaType: workType,
    status,
    title: String(row.title || '').trim(),
    originalTitle: String(pd.originalTitle || '').trim(),
    creator: String(row.creator || '').trim(),
    director: String(row.creator || '').trim(),
    studio: String(pd.studio || '').trim(),
    cast: String(pd.cast || '').trim(),
    releaseYear: row.release_year ?? null,
    format: pd.format || 'Streaming',
    audioFormat: pd.audioFormat || 'Legendado',
    animeFormat: pd.animeFormat || (workType === 'anime' ? 'TV' : ''),
    // Reading
    pagesRead: Math.max(0, Math.round(Number(pd.pages_read ?? pd.pagesRead) || 0)),
    totalPages:
      Number(pd.total_pages ?? pd.totalPages) > 0
        ? Math.round(Number(pd.total_pages ?? pd.totalPages))
        : null,
    chaptersRead: Math.max(0, Math.round(Number(pd.chapters_read ?? pd.chaptersRead) || 0)),
    isbnOrDoi: String(pd.isbn_or_doi ?? pd.isbnOrDoi ?? extIds.isbn ?? extIds.doi ?? '').trim(),
    bookFormat: String(
      pd.book_format ?? pd.bookFormat ?? (domain === 'reading' ? 'Físico' : '')
    ).trim(),
    // Games (preserva plataformas reais e edição sem inventar PC)
    platform: String(pd.platform ?? '').trim(),
    platforms: Array.isArray(pd.platforms)
      ? Array.from(new Set(pd.platforms.map((p) => String(p || '').trim()).filter(Boolean)))
      : [],
    originalPlatforms: Array.isArray(pd.originalPlatforms)
      ? Array.from(new Set(pd.originalPlatforms.map((p) => String(p || '').trim()).filter(Boolean)))
      : [],
    editionType:
      domain === 'games'
        ? normalizeGameEditionType(pd.edition_type ?? pd.editionType)
        : String(pd.edition_type ?? pd.editionType ?? '').trim(),
    gameRating11:
      (pd.game_rating_11 ?? pd.gameRating11) !== null &&
      (pd.game_rating_11 ?? pd.gameRating11) !== undefined &&
      (pd.game_rating_11 ?? pd.gameRating11) !== '' &&
      Number.isFinite(Number(pd.game_rating_11 ?? pd.gameRating11))
        ? Math.max(
            0,
            Math.min(11, Math.round(Number(pd.game_rating_11 ?? pd.gameRating11) * 10) / 10)
          )
        : null,
    masterpieceJustification: String(
      pd.masterpiece_justification ?? pd.masterpieceJustification ?? ''
    )
      .trim()
      .slice(0, 400),
    hoursPlayed: Math.max(0, Number(pd.hours_played ?? pd.hoursPlayed) || 0),
    completionType: String(pd.completion_type ?? pd.completionType ?? '').trim(),
    storeOrLauncher: String(pd.store_or_launcher ?? pd.storeOrLauncher ?? '').trim(),
    buildOrCharacter: String(pd.build_or_character ?? pd.buildOrCharacter ?? '').trim(),
    // Music
    albumName: String(pd.album_name ?? pd.albumName ?? '').trim(),
    durationMs:
      Number(pd.duration_ms ?? pd.durationMs) > 0
        ? Math.round(Number(pd.duration_ms ?? pd.durationMs))
        : null,
    trackRating10:
      (pd.track_rating_10 ?? pd.trackRating10) !== null &&
      (pd.track_rating_10 ?? pd.trackRating10) !== undefined &&
      (pd.track_rating_10 ?? pd.trackRating10) !== '' &&
      Number.isFinite(Number(pd.track_rating_10 ?? pd.trackRating10))
        ? Math.max(
            0,
            Math.min(10, Math.round(Number(pd.track_rating_10 ?? pd.trackRating10) * 10) / 10)
          )
        : null,
    favoriteTrack: String(pd.favorite_track ?? pd.favoriteTrack ?? '').trim(),
    subgenre: String(pd.subgenre ?? '').trim(),
    releaseFormat: String(
      pd.release_format ??
        pd.releaseFormat ??
        (domain === 'music'
          ? workType === 'track'
            ? 'Faixa Individual'
            : 'Álbum de Estúdio'
          : '')
    ).trim(),
    listenCount: Math.max(0, Math.round(Number(pd.listen_count ?? pd.listenCount) || 0)),
    tracks: Array.isArray(pd.tracks) ? pd.tracks : [],
    trackRatings:
      (pd.track_ratings ?? pd.trackRatings) &&
      typeof (pd.track_ratings ?? pd.trackRatings) === 'object' &&
      !Array.isArray(pd.track_ratings ?? pd.trackRatings)
        ? pd.track_ratings ?? pd.trackRatings
        : {},
    trackCount:
      Number(pd.track_count ?? pd.trackCount) > 0
        ? Math.round(Number(pd.track_count ?? pd.trackCount))
        : null,
    coverUrl: row.cover_url || null,
    backdropUrl: row.backdrop_url || null,
    coverSources: Array.isArray(pd.coverSources)
      ? pd.coverSources
      : row.cover_url
        ? [row.cover_url]
        : [],
    synopsis,
    overview: synopsis,
    genres: Array.isArray(row.genres) ? row.genres : [],
    tags: Array.isArray(row.tags) ? row.tags : [],
    atmosphere: Array.isArray(pd.atmosphere) ? pd.atmosphere : [],
    moods: Array.isArray(pd.atmosphere) ? pd.atmosphere : [],
    tropes: Array.isArray(pd.tropes) ? pd.tropes : [],
    subgenres: Array.isArray(pd.subgenres) ? pd.subgenres : [],
    durationMinutes: pd.durationMinutes ?? null,
    totalSeconds: pd.totalSeconds ?? null,
    currentSeconds: Number(pd.currentSeconds) || 0,
    episodeDurationMinutes: pd.episodeDurationMinutes ?? null,
    totalSeasons: Math.max(1, Number(pd.totalSeasons) || 1),
    totalEpisodes: pd.totalEpisodes ?? null,
    episodesPerSeason: Array.isArray(pd.episodesPerSeason) ? pd.episodesPerSeason : [],
    currentSeason: Math.max(1, Number(pd.currentSeason) || 1),
    currentEpisode: Math.max(0, Number(pd.currentEpisode) || 0),
    watchedEpisodes:
      pd.watchedEpisodes && typeof pd.watchedEpisodes === 'object' ? pd.watchedEpisodes : {},
    fillerEpisodes: Array.isArray(pd.fillerEpisodes) ? pd.fillerEpisodes : [],
    storyArcs: Array.isArray(pd.storyArcs) ? pd.storyArcs : [],
    rewatchCount: Number(pd.rewatchCount) || 0,
    progress: Number(pd.progress) || 0,
    rating:
      row.rating === null || row.rating === undefined || row.rating === ''
        ? null
        : Math.max(0, Math.min(100, Math.round(Number(row.rating)))),
    ratingSource:
      pd.ratingSource ?? (row.rating !== null && row.rating !== undefined ? 'manual' : null),
    reviewCriteria: pd.reviewCriteria ?? null,
    reviewCriteria5: pd.reviewCriteria5 ?? null,
    ratingManualOverride: Boolean(pd.ratingManualOverride),
    lifeWork: Boolean(pd.lifeWork || Number(pd.game_rating_11) >= 11),
    franchiseTier: ['mainline', 'spinoff', 'companion', 'unclassified'].includes(
      String(pd.franchiseTier || '').trim().toLowerCase()
    )
      ? String(pd.franchiseTier).trim().toLowerCase()
      : '',
    editionOf: String(pd.editionOf || '').trim() || null,
    releasedEpisodesCount:
      Number(pd.releasedEpisodesCount) > 0
        ? Math.floor(Number(pd.releasedEpisodesCount))
        : null,
    releasedEpisodesSource: String(pd.releasedEpisodesSource || '').trim() || null,
    releasedEpisodesFetchedAt: pd.releasedEpisodesFetchedAt || null,
    excludeFromDiscography: Boolean(pd.excludeFromDiscography),
    igdbId:
      Number(pd.igdbId || extIds.igdb) > 0 ? Math.floor(Number(pd.igdbId || extIds.igdb)) : null,
    rawgId:
      Number(pd.rawgId || extIds.rawg) > 0 ? Math.floor(Number(pd.rawgId || extIds.rawg)) : null,
    campaignTimeHours:
      Number(pd.campaignTimeHours) > 0
        ? Math.round(Number(pd.campaignTimeHours) * 10) / 10
        : null,
    campaignTimeSource: String(pd.campaignTimeSource || '').trim() || null,
    rawgPlaytimeHours:
      Number(pd.rawgPlaytimeHours) > 0
        ? Math.round(Number(pd.rawgPlaytimeHours) * 10) / 10
        : null,
    rawgPlaytimeSource: String(pd.rawgPlaytimeSource || '').trim() || null,
    manualCampaignHours:
      Number(pd.manualCampaignHours) > 0
        ? Math.round(Number(pd.manualCampaignHours) * 10) / 10
        : null,
    completion100Hours:
      Number(pd.completion100Hours) > 0
        ? Math.round(Number(pd.completion100Hours) * 10) / 10
        : null,
    completion100Source: String(pd.completion100Source || '').trim() || null,
    parentGame: pd.parentGame ?? null,
    versionParent: pd.versionParent ?? null,
    achievements: normalizeAchievementsModel(pd.achievements),
    verdict: pd.verdict ?? null,
    externalRatings,
    ids: {
      ...(extIds.source ? { source: extIds.source } : {}),
      ...(extIds.id ? { id: extIds.id } : {}),
      ...(extIds.linkedFromManualId ? { linkedFromManualId: extIds.linkedFromManualId } : {}),
      ...(extIds.tmdb ? { tmdb: extIds.tmdb } : {}),
      ...(extIds.imdb ? { imdb: extIds.imdb } : {}),
      ...(extIds.tvmaze ? { tvmaze: extIds.tvmaze } : {}),
      ...(extIds.anilist ? { anilist: extIds.anilist } : {}),
      ...(extIds.mal ? { mal: extIds.mal } : {}),
      ...(extIds.openlibrary ? { openlibrary: extIds.openlibrary } : {}),
      ...(extIds.googleBooks ? { googleBooks: extIds.googleBooks } : {}),
      ...(extIds.igdb ? { igdb: extIds.igdb } : {}),
      ...(extIds.igdbParent ? { igdbParent: extIds.igdbParent } : {}),
      ...(extIds.igdbVersionParent ? { igdbVersionParent: extIds.igdbVersionParent } : {}),
      ...(extIds.rawg ? { rawg: extIds.rawg } : {}),
      ...(extIds.cheapshark ? { cheapshark: extIds.cheapshark } : {}),
      ...(extIds.steam ? { steam: extIds.steam } : {}),
      ...(extIds.retroachievements ? { retroachievements: extIds.retroachievements } : {}),
      ...(extIds.freetogame ? { freetogame: extIds.freetogame } : {}),
      ...(extIds.wikidata ? { wikidata: extIds.wikidata } : {}),
      ...(extIds.itunes ? { itunes: extIds.itunes } : {}),
      ...(extIds.itunesTrack ? { itunesTrack: extIds.itunesTrack } : {}),
      ...(extIds.itunesArtist ? { itunesArtist: extIds.itunesArtist } : {}),
      ...(extIds.musicbrainz ? { musicbrainz: extIds.musicbrainz } : {}),
      ...(extIds.musicbrainzRecording
        ? { musicbrainzRecording: extIds.musicbrainzRecording }
        : {}),
      ...(extIds.musicbrainzArtist ? { musicbrainzArtist: extIds.musicbrainzArtist } : {}),
    },
    isManual: Boolean(extIds.source === 'manual' || pd.isManual),
    seriesVolume: String(pd.seriesVolume || '').trim(),
    workUrl: /^https?:\/\//i.test(String(pd.workUrl || '').trim())
      ? String(pd.workUrl).trim()
      : '',
    tmdbId: extIds.tmdb ?? null,
    imdbId: extIds.imdb ? String(extIds.imdb) : '',
    tvmazeId: extIds.tvmaze ?? null,
    anilistId: extIds.anilist ?? null,
    malId: extIds.mal ?? null,
    tmdbMediaType: extIds.tmdbMediaType || null,
    franchiseName: String(pd.franchiseName || '').trim(),
    belongsToCollection: pd.belongsToCollection || null,
    franchiseRelations: Array.isArray(pd.franchiseRelations) ? pd.franchiseRelations : [],
    franchiseLinks: Array.isArray(pd.franchiseLinks) ? pd.franchiseLinks : [],
    chronologicalOrder: pd.chronologicalOrder ?? null,
    tmdbStatus: pd.tmdbStatus || null,
    hype: pd.hype || null,
    checkpoint: String(pd.checkpoint || '').trim(),
    dropReason: pd.dropReason || null,
    startDate: pd.startDate || null,
    completedDate: pd.completedDate || null,
    completedYear: pd.completedYear ?? null,
    dropDate: pd.dropDate || null,
    isPlatinum: Boolean(pd.isPlatinum),
    isFavorite: Boolean(pd.isFavorite),
    isWishlist: Boolean(pd.isWishlist),
    inBacklog: pd.inBacklog !== false,
    collectionIds: Array.isArray(pd.collectionIds) ? pd.collectionIds : [],
    quotes: Array.isArray(pd.quotes) ? pd.quotes : [],
    language: String(pd.language || '').trim(),
    sourceBadge: String(pd.sourceBadge || '').trim(),
    mergedSources: Array.isArray(pd.mergedSources) ? pd.mergedSources : [],
    backdropCheckedAt: Number(pd.backdropCheckedAt) || null,
    favoriteRank: Number.isInteger(rankNum) && rankNum >= 1 && rankNum <= 4 ? rankNum : null,
    favoriteScene: String(row.favorite_quote_or_scene || '').trim().slice(0, 200),
    notes: String(row.personal_notes || ''),
    createdAt: row.created_at || '',
    updatedAt: preservedUpdatedAt,
    updated_at: preservedUpdatedAt,
    deletedAt: row.deleted_at || null,
  };
}

function getWorkIdentityKeys(work = {}) {
  const keys = [];
  if (work.cloudId) keys.push(`cloud:${String(work.cloudId).toLowerCase()}`);
  if (work.id) {
    keys.push(`cloud:${toCloudWorkId(work.id).toLowerCase()}`);
    keys.push(`local:${String(work.id)}`);
  }
  const cleanTitle = String(work.title || '').trim().toLowerCase();
  const domain = inferDomainFromWork(work);
  const type = normalizeWorkTypeForDomain(work.workType || work.mediaType, domain);
  if (cleanTitle) {
    if (domain === 'games') {
      const edition = normalizeGameEditionType(work.editionType).toLowerCase();
      const yr = Number(work.releaseYear) > 1970 ? `:${Math.round(Number(work.releaseYear))}` : '';
      keys.push(`title:${domain}:${type}:${edition}::${cleanTitle}${yr}`);
    } else {
      keys.push(`title:${domain}:${type}::${cleanTitle}`);
    }
  }
  return keys;
}

function worksDifferSignificantly(a = {}, b = {}) {
  return (
    String(a.status || '') !== String(b.status || '') ||
    (a.rating ?? null) !== (b.rating ?? null) ||
    String(a.notes || '') !== String(b.notes || '') ||
    Number(a.currentEpisode || 0) !== Number(b.currentEpisode || 0) ||
    Number(a.pagesRead || 0) !== Number(b.pagesRead || 0) ||
    Number(a.hoursPlayed || 0) !== Number(b.hoursPlayed || 0) ||
    Boolean(a.isFavorite) !== Boolean(b.isFavorite)
  );
}

/**
 * Mescla obras locais e remotas usando `updated_at` mais recente + tombstones (`deleted_at`).
 *
 * Garantias:
 * - Obra sem `updated_at` (ou Epoch 0) tem timestamp 0 e NUNCA vence uma versão datada da nuvem.
 * - Tombstone remoto (`deleted_at >= local.updatedAt`) remove do catálogo ativo sem ressuscitar.
 * - Tombstone local (`deletedAt >= remote.updatedAt`) suprime obra e agenda envio de soft-delete.
 * - Edição mais recente após uma exclusão (`updatedAt > deletedAt`) vence a exclusão e reativa a obra.
 */
export function mergeWorksByUpdatedAt(
  localWorks = [],
  remoteWorks = [],
  { pendingDeleteIds = [], localTombstones = null } = {}
) {
  // Normaliza mapa de tombstones locais (combinando lista legada + tombstones com timestamp)
  const tombstoneMap = new Map();
  const fallbackNowIso = new Date().toISOString();

  if (localTombstones && typeof localTombstones === 'object') {
    const entries =
      localTombstones instanceof Map
        ? Array.from(localTombstones.values())
        : Array.isArray(localTombstones)
          ? localTombstones
          : Object.values(localTombstones);
    for (const entry of entries) {
      if (!entry) continue;
      const cid = toCloudWorkId(entry.cloudId || entry.id).toLowerCase();
      if (!cid) continue;
      const deletedAt = entry.deletedAt || entry.deleted_at || fallbackNowIso;
      const prev = tombstoneMap.get(cid);
      if (!prev || parseTimestampMs(deletedAt) >= parseTimestampMs(prev.deletedAt)) {
        tombstoneMap.set(cid, {
          id: String(entry.id || cid),
          cloudId: cid,
          deletedAt,
          synced: Boolean(entry.synced),
        });
      }
    }
  }

  for (const rawId of pendingDeleteIds || []) {
    if (!rawId) continue;
    const cid = toCloudWorkId(rawId).toLowerCase();
    if (!tombstoneMap.has(cid)) {
      tombstoneMap.set(cid, {
        id: String(rawId),
        cloudId: cid,
        deletedAt: fallbackNowIso,
        synced: false,
      });
    }
  }

  const mergedMap = new Map();
  const keyIndex = new Map();
  const localOriginKeys = new Set();
  const remoteOriginKeys = new Set();
  const worksToPush = [];
  const remoteTombstonesApplied = [];
  const cancelledTombstoneCloudIds = [];
  let pulledCount = 0;
  let localWinsCount = 0;
  let remoteWinsCount = 0;
  let conflictProtectedCount = 0;
  let tombstoneDeletesCount = 0;

  const findExistingKey = (work) => {
    for (const k of getWorkIdentityKeys(work)) {
      if (keyIndex.has(k)) return keyIndex.get(k);
    }
    return null;
  };

  const registerWork = (canonicalId, work) => {
    mergedMap.set(canonicalId, work);
    for (const k of getWorkIdentityKeys(work)) {
      keyIndex.set(k, canonicalId);
    }
  };

  const unregisterWork = (canonicalId) => {
    const prev = mergedMap.get(canonicalId);
    if (!prev) return;
    mergedMap.delete(canonicalId);
    for (const [k, v] of Array.from(keyIndex.entries())) {
      if (v === canonicalId) keyIndex.delete(k);
    }
  };

  // 1. Carrega obras locais respeitando tombstones locais (exceto se obra local foi editada depois)
  for (const local of Array.isArray(localWorks) ? localWorks : []) {
    if (!local || !local.id) continue;
    const cloudKey = toCloudWorkId(local.cloudId || local.id).toLowerCase();
    const localTombstone = tombstoneMap.get(cloudKey);
    if (localTombstone) {
      const localMs = parseWorkUpdatedMs(local);
      const delMs = parseTimestampMs(localTombstone.deletedAt);
      if (delMs >= localMs) {
        continue;
      }
      tombstoneMap.delete(cloudKey);
      cancelledTombstoneCloudIds.push(cloudKey);
    }
    registerWork(cloudKey, local);
    localOriginKeys.add(cloudKey);
  }

  // Separa linhas remotas ativas vs tombstones remotos (`deleted_at` preenchido)
  const activeRemoteList = [];
  const remoteTombstoneList = [];
  for (const remote of Array.isArray(remoteWorks) ? remoteWorks : []) {
    if (!remote || (!remote.id && !remote.cloudId)) continue;
    if (remote.deletedAt || remote.deleted_at) {
      remoteTombstoneList.push(remote);
    } else {
      activeRemoteList.push(remote);
    }
  }

  // 2. Aplica tombstones remotos (soft deletes vindos de outro aparelho)
  const remoteDeletedByCloud = new Map();
  for (const remoteTomb of remoteTombstoneList) {
    const remoteCloudKey = toCloudWorkId(remoteTomb.cloudId || remoteTomb.id).toLowerCase();
    const remoteDelIso = remoteTomb.deletedAt || remoteTomb.deleted_at;
    const remoteDelMs = parseTimestampMs(remoteDelIso);
    remoteDeletedByCloud.set(remoteCloudKey, remoteDelIso);

    const matchedKey = findExistingKey(remoteTomb);
    if (matchedKey) {
      const existing = mergedMap.get(matchedKey);
      const localMs = parseWorkUpdatedMs(existing);
      if (remoteDelMs >= localMs) {
        unregisterWork(matchedKey);
        tombstoneDeletesCount += 1;
        remoteTombstonesApplied.push({
          id: existing.id || remoteTomb.id || remoteCloudKey,
          cloudId: remoteCloudKey,
          deletedAt: remoteDelIso,
          synced: true,
        });
      } else {
        // Edição local é estritamente mais nova do que a exclusão remota -> preserva local
        localWinsCount += 1;
        conflictProtectedCount += 1;
      }
    } else {
      remoteTombstonesApplied.push({
        id: remoteTomb.id || remoteCloudKey,
        cloudId: remoteCloudKey,
        deletedAt: remoteDelIso,
        synced: true,
      });
    }
  }

  // 3. Mescla obras remotas ativas
  for (const remote of activeRemoteList) {
    const remoteCloudKey = toCloudWorkId(remote.cloudId || remote.id).toLowerCase();
    const remoteMs = parseWorkUpdatedMs(remote);

    const localTombstone = tombstoneMap.get(remoteCloudKey);
    if (localTombstone) {
      const delMs = parseTimestampMs(localTombstone.deletedAt);
      if (delMs >= remoteMs) {
        // Exclusão local vence a obra remota antiga (e será enviada ao Supabase)
        tombstoneDeletesCount += 1;
        continue;
      }
      // Obra remota foi editada DEPOIS da exclusão local -> cancela tombstone local e puxa obra
      tombstoneMap.delete(remoteCloudKey);
      cancelledTombstoneCloudIds.push(remoteCloudKey);
    }

    const matchedKey = findExistingKey(remote);
    if (!matchedKey) {
      const cleanRemote = { ...remote };
      delete cleanRemote.deletedAt;
      registerWork(remoteCloudKey, cleanRemote);
      remoteOriginKeys.add(remoteCloudKey);
      pulledCount += 1;
      continue;
    }

    remoteOriginKeys.add(matchedKey);
    const existing = mergedMap.get(matchedKey);
    const localMs = parseWorkUpdatedMs(existing);
    const differs = worksDifferSignificantly(existing, remote);

    if (remoteMs > localMs) {
      const winner = {
        ...remote,
        id: existing.id || remote.id,
        cloudId: remote.cloudId || remoteCloudKey,
        ...(existing.manualCoverDataUrl
          ? {
              manualCoverDataUrl: existing.manualCoverDataUrl,
              coverUrl: remote.coverUrl || existing.manualCoverDataUrl,
            }
          : {}),
      };
      delete winner.deletedAt;
      registerWork(matchedKey, winner);
      pulledCount += 1;
      remoteWinsCount += 1;
      if (differs || localMs > 0) {
        conflictProtectedCount += 1;
      }
    } else if (localMs > remoteMs) {
      localWinsCount += 1;
      if (differs || remoteMs > 0) {
        conflictProtectedCount += 1;
      }
    } else {
      // Empate exato de timestamp: preserva capa do Supabase Storage se existir
      const preferRemoteCover =
        typeof remote.coverUrl === 'string' &&
        remote.coverUrl.includes('/storage/v1/object/') &&
        !String(existing.coverUrl || '').includes('/storage/v1/object/');
      if (preferRemoteCover) {
        registerWork(matchedKey, {
          ...existing,
          coverUrl: remote.coverUrl,
          cloudId: remote.cloudId || remoteCloudKey,
        });
      }
    }
  }

  // 4. Determina quais obras locais precisam subir para a nuvem
  const remoteByCloud = new Map();
  for (const remote of activeRemoteList) {
    const k = toCloudWorkId(remote.cloudId || remote.id).toLowerCase();
    remoteByCloud.set(k, remote);
  }

  const mergedWorks = Array.from(mergedMap.values()).sort(
    (a, b) => parseWorkUpdatedMs(b) - parseWorkUpdatedMs(a)
  );

  for (const item of mergedWorks) {
    const cloudKey = toCloudWorkId(item.cloudId || item.id).toLowerCase();
    const remoteMatch =
      remoteByCloud.get(cloudKey) ||
      activeRemoteList.find((r) =>
        getWorkIdentityKeys(r).some((k) => getWorkIdentityKeys(item).includes(k))
      );

    if (!remoteMatch) {
      // Se havia tombstone remoto, mas local era mais novo -> reativa na nuvem
      worksToPush.push(item);
      continue;
    }

    const itemMs = parseWorkUpdatedMs(item);
    const remoteMs = parseWorkUpdatedMs(remoteMatch);
    if (itemMs > remoteMs) {
      worksToPush.push(item);
    }
  }

  // 5. Calcula tombstones locais ainda não sincronizados que precisam ser enviados à nuvem
  const tombstonesToFlush = Array.from(tombstoneMap.values()).filter((entry) => {
    if (entry.synced) return false;
    // Se já existe tombstone remoto com data >= local, não precisa reenviar
    const remoteDelIso = remoteDeletedByCloud.get(entry.cloudId);
    if (remoteDelIso && parseTimestampMs(remoteDelIso) >= parseTimestampMs(entry.deletedAt)) {
      return false;
    }
    return true;
  });

  // Estatísticas para resumo de 1ª conexão ("X só aqui · Y só na nuvem · Z conflitos protegidos")
  let localOnlyCount = 0;
  let remoteOnlyCount = 0;
  for (const key of mergedMap.keys()) {
    const inLocal = localOriginKeys.has(key);
    const inRemote = remoteOriginKeys.has(key);
    if (inLocal && !inRemote) localOnlyCount += 1;
    if (inRemote && !inLocal) remoteOnlyCount += 1;
  }

  return {
    mergedWorks,
    worksToPush,
    pulledCount,
    remoteTombstonesApplied,
    tombstonesToFlush,
    cancelledTombstoneCloudIds,
    stats: {
      localOnlyCount,
      remoteOnlyCount,
      conflictProtectedCount,
      localWinsCount,
      remoteWinsCount,
      tombstoneDeletesCount,
    },
  };
}

export function formatFirstSyncSummary(stats = {}) {
  const localOnly = Math.max(0, Number(stats.localOnlyCount) || 0);
  const remoteOnly = Math.max(0, Number(stats.remoteOnlyCount) || 0);
  const conflicts = Math.max(0, Number(stats.conflictProtectedCount) || 0);
  const localWord = localOnly === 1 ? 'obra só aqui' : 'obras só aqui';
  const conflictWord = conflicts === 1 ? 'conflito protegido' : 'conflitos protegidos';
  return `${localOnly} ${localWord} · ${remoteOnly} só na nuvem · ${conflicts} ${conflictWord}`;
}

export function readSyncMeta(storage = null) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  const empty = {
    lastSyncAt: null,
    lastUserId: null,
    initialPushDone: false,
    lastPreSyncSnapshotId: null,
    tombstoneMode: getTombstoneSyncMode(),
  };
  if (!store || typeof store.getItem !== 'function') {
    return empty;
  }
  try {
    const raw = store.getItem(SYNC_META_STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    return {
      lastSyncAt: parsed?.lastSyncAt || null,
      lastUserId: parsed?.lastUserId || null,
      initialPushDone: Boolean(parsed?.initialPushDone),
      lastPreSyncSnapshotId: parsed?.lastPreSyncSnapshotId || null,
      tombstoneMode: parsed?.tombstoneMode || getTombstoneSyncMode(),
    };
  } catch {
    return empty;
  }
}

export function writeSyncMeta(patch = {}, storage = null) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!store || typeof store.setItem !== 'function') return;
  try {
    const next = { ...readSyncMeta(store), ...patch };
    store.setItem(SYNC_META_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Silencioso
  }
}

export function readCloudTombstones(storage = null) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!store || typeof store.getItem !== 'function') return {};
  try {
    const raw = store.getItem(CLOUD_TOMBSTONES_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out = {};
    for (const [k, val] of Object.entries(parsed)) {
      if (!val || typeof val !== 'object') continue;
      const cid = toCloudWorkId(val.cloudId || k).toLowerCase();
      out[cid] = {
        id: String(val.id || cid),
        cloudId: cid,
        deletedAt: String(val.deletedAt || new Date().toISOString()),
        synced: Boolean(val.synced),
      };
    }
    return out;
  } catch {
    return {};
  }
}

function writeCloudTombstones(mapObj = {}, storage = null) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!store || typeof store.setItem !== 'function') return;
  try {
    store.setItem(CLOUD_TOMBSTONES_STORAGE_KEY, JSON.stringify(mapObj));
  } catch {
    // Silencioso
  }
}

export function recordCloudTombstones(entries = [], storage = null) {
  const current = readCloudTombstones(storage);
  const list = Array.isArray(entries) ? entries : [entries];
  const nowIso = new Date().toISOString();
  for (const item of list) {
    if (!item) continue;
    const rawId = typeof item === 'string' ? item : item.cloudId || item.id;
    if (!rawId) continue;
    const cid = toCloudWorkId(rawId).toLowerCase();
    const deletedAt =
      typeof item === 'object' && item.deletedAt ? String(item.deletedAt) : nowIso;
    const synced = typeof item === 'object' ? Boolean(item.synced) : false;
    const prev = current[cid];
    if (!prev || parseTimestampMs(deletedAt) >= parseTimestampMs(prev.deletedAt)) {
      current[cid] = {
        id: typeof item === 'object' && item.id ? String(item.id) : String(rawId),
        cloudId: cid,
        deletedAt,
        synced: prev && parseTimestampMs(prev.deletedAt) === parseTimestampMs(deletedAt)
          ? prev.synced || synced
          : synced,
      };
    }
  }
  writeCloudTombstones(current, storage);
  return current;
}

export function markCloudTombstonesSynced(cloudIds = [], storage = null) {
  const current = readCloudTombstones(storage);
  for (const rawId of Array.isArray(cloudIds) ? cloudIds : [cloudIds]) {
    if (!rawId) continue;
    const cid = toCloudWorkId(rawId).toLowerCase();
    if (current[cid]) {
      current[cid] = { ...current[cid], synced: true };
    }
  }
  writeCloudTombstones(current, storage);
  return current;
}

export function clearCloudTombstone(workId, storage = null) {
  if (!workId) return;
  const cid = toCloudWorkId(workId).toLowerCase();
  const current = readCloudTombstones(storage);
  if (cid in current) {
    delete current[cid];
    writeCloudTombstones(current, storage);
  }
}

export function readPendingCloudDeletes(storage = null) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  const legacyList = [];
  if (store && typeof store.getItem === 'function') {
    try {
      const raw = store.getItem(PENDING_DELETES_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) {
        legacyList.push(...parsed.map(String).filter(Boolean));
      }
    } catch {
      // Ignora JSON inválido
    }
  }
  const tombstones = readCloudTombstones(storage);
  const unsyncedFromTombstones = Object.values(tombstones)
    .filter((t) => !t.synced)
    .map((t) => t.cloudId);
  return Array.from(new Set([...legacyList, ...unsyncedFromTombstones]));
}

function writePendingCloudDeletes(ids = [], storage = null) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!store || typeof store.setItem !== 'function') return;
  try {
    const unique = Array.from(new Set((ids || []).map((id) => toCloudWorkId(id))));
    store.setItem(PENDING_DELETES_STORAGE_KEY, JSON.stringify(unique));
  } catch {
    // Silencioso
  }
}

export function queuePendingCloudDelete(workId, storage = null, { deletedAt = null } = {}) {
  if (!workId) return;
  const cid = toCloudWorkId(workId);
  const current = readPendingCloudDeletes(storage);
  writePendingCloudDeletes([...current, cid], storage);
  recordCloudTombstones(
    [{ id: String(workId), cloudId: cid, deletedAt: deletedAt || new Date().toISOString(), synced: false }],
    storage
  );
}

export function cancelPendingCloudDelete(workId, storage = null) {
  if (!workId) return;
  const target = toCloudWorkId(workId);
  const next = readPendingCloudDeletes(storage).filter(
    (id) => id !== target && id !== String(workId)
  );
  writePendingCloudDeletes(next, storage);
  clearCloudTombstone(workId, storage);
}

// ============================================================================
// Fila persistente de mutações offline + retry exponencial
// ============================================================================

export function readSyncQueue(storage = null) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  const empty = {
    pendingUpsertIds: [],
    failedItems: [],
    retryCount: 0,
    nextRetryAt: null,
    lastError: null,
    lastErrorAt: null,
  };
  if (!store || typeof store.getItem !== 'function') return empty;
  try {
    const raw = store.getItem(SYNC_QUEUE_STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    const failedItems = Array.isArray(parsed?.failedItems)
      ? parsed.failedItems
          .filter((item) => item && typeof item === 'object')
          .map((item) => ({
            workId: String(item.workId || ''),
            title: String(item.title || 'Sem título'),
            domain: String(item.domain || ''),
            reason: String(item.reason || 'Falha ao enviar obra'),
            failedAt: item.failedAt || null,
          }))
      : [];
    return {
      pendingUpsertIds: Array.isArray(parsed?.pendingUpsertIds)
        ? Array.from(new Set(parsed.pendingUpsertIds.map(String).filter(Boolean)))
        : [],
      failedItems,
      retryCount: Math.max(0, Number(parsed?.retryCount) || 0),
      nextRetryAt: parsed?.nextRetryAt || null,
      lastError: parsed?.lastError ? String(parsed.lastError) : null,
      lastErrorAt: parsed?.lastErrorAt || null,
    };
  } catch {
    return empty;
  }
}

function writeSyncQueue(nextState, storage = null) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!store || typeof store.setItem !== 'function') return;
  try {
    store.setItem(SYNC_QUEUE_STORAGE_KEY, JSON.stringify(nextState));
  } catch {
    // Silencioso
  }
}

export function readFailedSyncItems(storage = null) {
  return readSyncQueue(storage).failedItems;
}

export function recordFailedSyncItems(entries = [], storage = null) {
  const list = Array.isArray(entries) ? entries : [entries];
  if (list.length === 0) return readSyncQueue(storage);
  const current = readSyncQueue(storage);
  const byKey = new Map();
  for (const prev of current.failedItems) {
    const k = prev.workId || `title:${prev.title}`;
    byKey.set(k, prev);
  }
  const nowIso = new Date().toISOString();
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const normalized = {
      workId: String(item.workId || ''),
      title: String(item.title || 'Sem título'),
      domain: String(item.domain || ''),
      reason: String(item.reason || 'Falha ao enviar obra'),
      failedAt: item.failedAt || nowIso,
    };
    const k = normalized.workId || `title:${normalized.title}`;
    byKey.set(k, normalized);
  }
  const next = {
    ...current,
    failedItems: Array.from(byKey.values()).slice(-50),
  };
  writeSyncQueue(next, storage);
  return next;
}

export function clearFailedSyncItems(workIds = null, storage = null) {
  const current = readSyncQueue(storage);
  if (workIds === null) {
    const next = { ...current, failedItems: [] };
    writeSyncQueue(next, storage);
    return next;
  }
  const removeSet = new Set((Array.isArray(workIds) ? workIds : [workIds]).map(String));
  const next = {
    ...current,
    failedItems: current.failedItems.filter((item) => !removeSet.has(item.workId)),
  };
  writeSyncQueue(next, storage);
  return next;
}

export function enqueuePendingWorkUpserts(workIds = [], storage = null) {
  const ids = (Array.isArray(workIds) ? workIds : [workIds]).map(String).filter(Boolean);
  if (ids.length === 0) return readSyncQueue(storage);
  const current = readSyncQueue(storage);
  const next = {
    ...current,
    pendingUpsertIds: Array.from(new Set([...current.pendingUpsertIds, ...ids])),
  };
  writeSyncQueue(next, storage);
  return next;
}

export function clearPendingWorkUpserts(workIds = [], storage = null) {
  const current = readSyncQueue(storage);
  const removeSet = new Set((Array.isArray(workIds) ? workIds : [workIds]).map(String));
  const next = {
    ...current,
    pendingUpsertIds:
      workIds === null
        ? []
        : current.pendingUpsertIds.filter((id) => !removeSet.has(id)),
  };
  writeSyncQueue(next, storage);
  return next;
}

export function computeRetryBackoffMs(retryCount = 0) {
  const steps = [2000, 5000, 15000, 45000, 60000];
  const idx = Math.max(0, Math.min(steps.length - 1, Math.floor(Number(retryCount) || 0)));
  return steps[idx];
}

export function recordSyncFailure(errorMessage, storage = null) {
  const current = readSyncQueue(storage);
  const nextRetryCount = current.retryCount + 1;
  const backoffMs = computeRetryBackoffMs(current.retryCount);
  const next = {
    ...current,
    retryCount: nextRetryCount,
    nextRetryAt: new Date(Date.now() + backoffMs).toISOString(),
    lastError: String(errorMessage || 'Falha ao sincronizar com a nuvem.'),
    lastErrorAt: new Date().toISOString(),
  };
  writeSyncQueue(next, storage);
  return { queue: next, backoffMs };
}

export function clearSyncFailure(storage = null) {
  const current = readSyncQueue(storage);
  const next = {
    ...current,
    failedItems: [],
    retryCount: 0,
    nextRetryAt: null,
    lastError: null,
    lastErrorAt: null,
  };
  writeSyncQueue(next, storage);
  return next;
}

export function getPendingSyncCount(storage = null) {
  const queue = readSyncQueue(storage);
  const pendingDeletes = readPendingCloudDeletes(storage);
  return Math.max(queue.pendingUpsertIds.length, queue.failedItems.length) + pendingDeletes.length;
}

/**
 * Traduz erros de constraint/tipo do PostgreSQL/PostgREST para motivos curtos em português simples.
 */
export function formatFriendlyConstraintError(rawError) {
  const raw = String(rawError?.message || rawError?.details || rawError || '').trim();
  const code = String(rawError?.code || '').trim();
  const lower = raw.toLowerCase();

  if (lower.includes('uuid') || (code === '22P02' && lower.includes('uuid'))) {
    return 'id inválido (fora do formato UUID)';
  }
  if (lower.includes('external_rating')) {
    return 'nota externa fora da faixa (0 a 100)';
  }
  if (lower.includes('rating')) {
    return 'nota fora da faixa (0 a 100)';
  }
  if (lower.includes('favorite_rank')) {
    return 'posição no Top 4 inválida (1 a 4)';
  }
  if (lower.includes('domain')) {
    return 'domínio não aceito (esperado cinema, reading, games ou music)';
  }
  if (lower.includes('created_at') || lower.includes('updated_at')) {
    return 'data de criação ou atualização inválida (esperado formato ISO)';
  }
  if (code === '23503' || lower.includes('foreign key') || lower.includes('user_id')) {
    return 'usuário inválido na conta conectada';
  }
  if (code === '42501' || lower.includes('row-level security') || lower.includes('permission denied')) {
    return 'permissão bloqueada pela política de segurança (RLS)';
  }
  if (code === '23514' || lower.includes('check constraint')) {
    return `valor fora da regra do banco (${raw})`;
  }
  if (code === '22P02' || lower.includes('invalid input syntax')) {
    return `formato de campo inválido (${raw})`;
  }
  return raw || 'falha desconhecida ao enviar esta obra';
}

export function formatFriendlySyncError(rawError) {
  const raw = String(rawError?.message || rawError || '').trim();
  const lower = raw.toLowerCase();
  if (!raw) {
    return {
      message:
        'Não foi possível sincronizar agora. Seus dados continuam salvos neste aparelho — toque em "Sincronizar agora" para tentar novamente.',
      action: 'retry',
      sessionExpired: false,
      isNetwork: false,
    };
  }
  if (
    lower.includes('jwt') ||
    lower.includes('refresh token') ||
    lower.includes('invalid_grant') ||
    lower.includes('session_not_found') ||
    lower.includes('not authenticated') ||
    lower.includes('401')
  ) {
    return {
      message:
        'Sua sessão expirou. Entre novamente na sua conta para retomar a sincronização — seus dados locais continuam seguros.',
      action: 'relogin',
      sessionExpired: true,
      isNetwork: false,
    };
  }
  if (
    lower.includes('42501') ||
    lower.includes('row-level security') ||
    lower.includes('permission denied')
  ) {
    return {
      message:
        'O Supabase bloqueou a gravação por política de segurança (RLS). Verifique suas políticas no Supabase e tente sincronizar novamente.',
      action: 'retry',
      sessionExpired: false,
      isNetwork: false,
    };
  }
  if (lower.includes('42p01') || lower.includes('does not exist')) {
    return {
      message:
        'A tabela public.catalog_works ainda não foi preparada no Supabase. Verifique a migração SQL e tente novamente.',
      action: 'retry',
      sessionExpired: false,
      isNetwork: false,
    };
  }
  if (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('network') ||
    lower.includes('timeout') ||
    lower.includes('abort') ||
    lower.includes('offline')
  ) {
    return {
      message:
        'Sem resposta da nuvem no momento. Suas alterações ficaram na fila local e serão enviadas automaticamente quando a conexão voltar.',
      action: 'retry',
      sessionExpired: false,
      isNetwork: true,
    };
  }
  const constraintReason = formatFriendlyConstraintError(rawError);
  return {
    message: `Não foi possível sincronizar agora: ${constraintReason}. Seus dados continuam salvos localmente.`,
    action: 'retry',
    sessionExpired: false,
    isNetwork: false,
  };
}

function isOnlineBrowser() {
  if (typeof navigator === 'undefined') return true;
  if (typeof navigator.onLine === 'boolean') return navigator.onLine;
  return true;
}

function isExternalRatingTypeError(error) {
  const msg = String(error?.message || error?.details || '');
  const code = String(error?.code || '');
  return (
    code === '22P02' ||
    /invalid input syntax for type (integer|numeric|smallint|double|real)/i.test(msg)
  );
}

export function isDeletedAtColumnMissingError(error) {
  const msg = String(error?.message || error?.details || error?.hint || '');
  const code = String(error?.code || '');
  if (!msg && !code) return false;
  if (code === '42703' || code === 'PGRST204') {
    return /deleted_at/i.test(msg) || code === 'PGRST204';
  }
  return /deleted_at/i.test(msg) && /(does not exist|schema cache|unknown column|could not find)/i.test(msg);
}

function buildFailedWorkRecord(work = {}, reason = '') {
  const workId = String(work?.id || work?.cloudId || '');
  const title = String(work?.title || 'Sem título').trim() || 'Sem título';
  const domain = String(work?.domain || '');
  return {
    workId,
    title,
    domain,
    reason: String(reason || 'Falha ao enviar obra'),
    failedAt: new Date().toISOString(),
  };
}

function summarizeFailedWorksError(failedWorks = []) {
  if (!Array.isArray(failedWorks) || failedWorks.length === 0) return '';
  const preview = failedWorks
    .slice(0, 3)
    .map((f) => `"${f.title}" (${f.reason})`)
    .join(', ');
  const extra = failedWorks.length > 3 ? ` e mais ${failedWorks.length - 3}` : '';
  return `${failedWorks.length} obra${failedWorks.length === 1 ? '' : 's'} não ${failedWorks.length === 1 ? 'pôde' : 'puderam'} ser enviada${failedWorks.length === 1 ? '' : 's'}: ${preview}${extra}.`;
}

/**
 * Envia obras em lotes para `public.catalog_works` com saneamento prévio contra as
 * constraints reais do banco. Se um lote falhar (exceto erro de rede/sessão), NÃO
 * descarta o lote: tenta obra por obra, mantém na fila apenas as que falharam e
 * registra cada obra + motivo em português simples no Diagnóstico.
 */
async function upsertCatalogRows(client, works = [], userId, { storage = null } = {}) {
  if (!client || !userId || !Array.isArray(works) || works.length === 0) {
    return { ok: true, count: 0, succeededWorkIds: [], failedWorks: [] };
  }

  const validEntries = [];
  const failedWorks = [];
  const succeededWorkIds = [];

  for (const work of works) {
    const prepared = prepareCatalogRowForCloudUpload(work, userId, {
      includeDeletedAt: !deletedAtColumnUnsupported,
      deletedAt: null,
    });
    if (!prepared.ok || !prepared.row) {
      const failRec = buildFailedWorkRecord(work, prepared.reason || 'id inválido (fora do formato UUID)');
      failedWorks.push(failRec);
      recordLocalError(
        `Obra "${failRec.title}" rejeitada antes do envio: ${failRec.reason}`,
        { source: 'cloud-sync', storage: storage || undefined }
      );
      continue;
    }
    validEntries.push({ work, row: prepared.row });
  }

  const chunkSize = 40;
  let totalUpserted = 0;

  const stripDeletedAtFromRow = (row) => {
    if (!row || typeof row !== 'object') return row;
    const copy = { ...row };
    delete copy.deleted_at;
    return copy;
  };

  for (let i = 0; i < validEntries.length; i += chunkSize) {
    const slice = validEntries.slice(i, i + chunkSize);
    let rows = slice.map((entry) =>
      deletedAtColumnUnsupported ? stripDeletedAtFromRow(entry.row) : entry.row
    );

    let { error } = await client
      .from(OMNI_CATALOG_TABLE)
      .upsert(rows, { onConflict: 'id' });

    if (error && !deletedAtColumnUnsupported && isDeletedAtColumnMissingError(error)) {
      deletedAtColumnUnsupported = true;
      rows = slice.map((entry) => stripDeletedAtFromRow(entry.row));
      const retry = await client
        .from(OMNI_CATALOG_TABLE)
        .upsert(rows, { onConflict: 'id' });
      error = retry.error;
    }

    if (!error) {
      totalUpserted += slice.length;
      slice.forEach((entry) => {
        if (entry.work?.id) succeededWorkIds.push(String(entry.work.id));
      });
      continue;
    }

    const batchFriendly = formatFriendlySyncError(error);
    // Se for sessão expirada ou queda total de rede, não tenta 40x obra por obra
    if (batchFriendly.sessionExpired || batchFriendly.isNetwork) {
      recordLocalError(batchFriendly.message, {
        source: 'cloud-sync',
        storage: storage || undefined,
      });
      return {
        ok: false,
        count: totalUpserted,
        succeededWorkIds,
        failedWorks,
        error: batchFriendly.message,
        rawError: error.message || '',
        sessionExpired: batchFriendly.sessionExpired,
      };
    }

    // Lote falhou por erro de dado/constraint: NÃO descarta o lote — tenta obra por obra!
    for (const entry of slice) {
      const singleRow = deletedAtColumnUnsupported
        ? stripDeletedAtFromRow(entry.row)
        : entry.row;
      let singleRes = await client
        .from(OMNI_CATALOG_TABLE)
        .upsert([singleRow], { onConflict: 'id' });

      if (
        singleRes?.error &&
        !deletedAtColumnUnsupported &&
        isDeletedAtColumnMissingError(singleRes.error)
      ) {
        deletedAtColumnUnsupported = true;
        singleRes = await client
          .from(OMNI_CATALOG_TABLE)
          .upsert([stripDeletedAtFromRow(entry.row)], { onConflict: 'id' });
      }

      if (!singleRes?.error) {
        totalUpserted += 1;
        if (entry.work?.id) succeededWorkIds.push(String(entry.work.id));
      } else {
        const reason = formatFriendlyConstraintError(singleRes.error);
        const failRec = buildFailedWorkRecord(entry.work, reason);
        failedWorks.push(failRec);
        recordLocalError(
          `Falha ao sincronizar "${failRec.title}": ${failRec.reason}`,
          { source: 'cloud-sync', storage: storage || undefined }
        );
      }
    }
  }

  if (succeededWorkIds.length > 0) {
    clearPendingWorkUpserts(succeededWorkIds, storage);
    clearFailedSyncItems(succeededWorkIds, storage);
  }

  if (failedWorks.length > 0) {
    const failedIds = failedWorks.map((f) => f.workId).filter(Boolean);
    if (failedIds.length > 0) {
      enqueuePendingWorkUpserts(failedIds, storage);
    }
    recordFailedSyncItems(failedWorks, storage);
    const summaryError = summarizeFailedWorksError(failedWorks);
    return {
      ok: false,
      partialSuccess: totalUpserted > 0,
      count: totalUpserted,
      succeededWorkIds,
      failedWorks,
      error: summaryError,
      sessionExpired: false,
    };
  }

  return {
    ok: true,
    partialSuccess: false,
    count: totalUpserted,
    succeededWorkIds,
    failedWorks: [],
  };
}

/**
 * Envia exclusões (soft-delete via `deleted_at` quando a coluna existe; fallback automático
 * para hard `DELETE` em bancos ainda sem a migração aditiva ou em mocks legados).
 */
async function applyCloudDeletes(
  client,
  userId,
  tombstoneEntries = [],
  { domainFilter = null } = {}
) {
  const entries = (Array.isArray(tombstoneEntries) ? tombstoneEntries : []).filter(
    (e) => e && e.cloudId
  );
  if (!client || !userId || entries.length === 0) {
    return { ok: true, count: 0, mode: getTombstoneSyncMode() };
  }

  const rawCloudIds = Array.from(new Set(entries.map((e) => toCloudWorkId(e.cloudId))));
  const cloudIds = rawCloudIds.filter((cid) => isValidUuid(cid));
  if (cloudIds.length !== rawCloudIds.length) {
    recordLocalError(
      'Um ou mais IDs de exclusão estavam fora do formato UUID e foram ignorados.',
      { source: 'cloud-sync' }
    );
  }
  if (cloudIds.length === 0) {
    return {
      ok: false,
      count: 0,
      error: 'id inválido (fora do formato UUID)',
      mode: getTombstoneSyncMode(),
    };
  }
  const latestDeletedAt =
    entries
      .map((e) => e.deletedAt)
      .filter(Boolean)
      .sort()
      .slice(-1)[0] || new Date().toISOString();

  const tableRef = client.from(OMNI_CATALOG_TABLE);
  const canTrySoftDelete =
    !deletedAtColumnUnsupported && typeof tableRef?.update === 'function';

  if (canTrySoftDelete) {
    let softQuery = tableRef
      .update({
        deleted_at: latestDeletedAt,
        updated_at: latestDeletedAt,
      })
      .eq('user_id', userId);
    if (domainFilter && typeof softQuery.eq === 'function') {
      softQuery = softQuery.eq('domain', normalizeDomainId(domainFilter));
    }
    const { error: softErr } = await softQuery.in('id', cloudIds);
    if (!softErr) {
      return { ok: true, count: cloudIds.length, mode: 'soft_delete' };
    }
    if (!isDeletedAtColumnMissingError(softErr)) {
      const friendly = formatFriendlySyncError(softErr);
      return {
        ok: false,
        count: 0,
        error: friendly.message,
        rawError: softErr.message || '',
        sessionExpired: friendly.sessionExpired,
      };
    }
    // Coluna deleted_at ainda não foi aplicada no Supabase -> fallback transparente
    deletedAtColumnUnsupported = true;
  }

  let delQuery = client
    .from(OMNI_CATALOG_TABLE)
    .delete()
    .eq('user_id', userId);
  if (domainFilter && typeof delQuery.eq === 'function') {
    delQuery = delQuery.eq('domain', normalizeDomainId(domainFilter));
  }
  const { error: delErr } = await delQuery.in('id', cloudIds);
  if (delErr) {
    const friendly = formatFriendlySyncError(delErr);
    return {
      ok: false,
      count: 0,
      error: friendly.message,
      rawError: delErr.message || '',
      sessionExpired: friendly.sessionExpired,
    };
  }
  return { ok: true, count: cloudIds.length, mode: 'compat_hard_delete' };
}

export async function getActiveSupabaseSession({ client = null, storage = null } = {}) {
  const sb = client || getSupabaseClient({ storage });
  if (!sb) {
    return { ok: false, configured: false, session: null, user: null, sessionExpired: false };
  }
  try {
    const { data, error } = await sb.auth.getSession();
    if (error) {
      const friendly = formatFriendlySyncError(error);
      return {
        ok: false,
        configured: true,
        session: null,
        user: null,
        sessionExpired: friendly.sessionExpired,
        error: friendly.message,
      };
    }
    const session = data?.session || null;
    const user = session?.user || null;

    // Se online e o token está prestes a expirar (< 90s), renova silenciosamente
    if (
      session &&
      isOnlineBrowser() &&
      typeof sb.auth?.refreshSession === 'function' &&
      Number.isFinite(Number(session.expires_at))
    ) {
      const expiresAtMs = Number(session.expires_at) * 1000;
      if (expiresAtMs - Date.now() < 90_000) {
        try {
          const refreshed = await sb.auth.refreshSession();
          if (refreshed?.data?.session?.user) {
            return {
              ok: true,
              configured: true,
              session: refreshed.data.session,
              user: refreshed.data.session.user,
              refreshed: true,
              sessionExpired: false,
            };
          }
          if (refreshed?.error) {
            const friendly = formatFriendlySyncError(refreshed.error);
            if (friendly.sessionExpired) {
              return {
                ok: false,
                configured: true,
                session: null,
                user: null,
                sessionExpired: true,
                error: friendly.message,
              };
            }
          }
        } catch {
          // Falha transitória de rede durante refresh: mantém sessão em cache se ainda existir
        }
      }
    }

    return {
      ok: true,
      configured: true,
      session,
      user,
      sessionExpired: false,
    };
  } catch (err) {
    const friendly = formatFriendlySyncError(err);
    return {
      ok: false,
      configured: true,
      session: null,
      user: null,
      offline: !isOnlineBrowser(),
      sessionExpired: friendly.sessionExpired,
      error: friendly.message,
    };
  }
}

export async function signInWithEmailPassword(
  { email, password },
  { client = null, storage = null } = {}
) {
  const sb = client || getSupabaseClient({ storage });
  if (!sb) {
    return {
      ok: false,
      error:
        'A conexão com a nuvem ainda não está pronta. Verifique sua internet ou configure manualmente em Opções avançadas.',
    };
  }
  const cleanEmail = String(email || '').trim();
  if (!cleanEmail || !password) {
    return { ok: false, error: 'Informe e-mail e senha.' };
  }
  if (!isOnlineBrowser()) {
    return { ok: false, offline: true, error: 'Sem conexão com a internet no momento.' };
  }

  try {
    const { data, error } = await sb.auth.signInWithPassword({
      email: cleanEmail,
      password,
    });
    if (error) {
      const msg = String(error.message || '');
      const friendly = /invalid login credentials/i.test(msg)
        ? 'E-mail ou senha inválidos.'
        : /email not confirmed/i.test(msg)
          ? 'Confirme seu e-mail antes de entrar na conta.'
          : msg || 'Não foi possível entrar na conta.';
      return { ok: false, error: friendly };
    }
    // Solicita persistência do navegador sem duplicar refresh token no IndexedDB
    requestPersistentBrowserStorage().catch(() => {});
    return {
      ok: true,
      session: data?.session || null,
      user: data?.user || data?.session?.user || null,
    };
  } catch (err) {
    return {
      ok: false,
      error: err?.message || 'Falha de rede ao conectar no Supabase.',
    };
  }
}

export async function signOutFromCloud({ client = null, storage = null } = {}) {
  const sb = client || getSupabaseClient({ storage });
  if (!sb) return { ok: true };
  try {
    await sb.auth.signOut({ scope: 'local' });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export function subscribeToAuthChanges(callback, { client = null, storage = null } = {}) {
  const sb = client || getSupabaseClient({ storage });
  if (!sb || typeof sb.auth?.onAuthStateChange !== 'function') {
    return () => {};
  }
  const { data } = sb.auth.onAuthStateChange((event, session) => {
    callback?.(event, session);
  });
  return () => {
    try {
      data?.subscription?.unsubscribe?.();
    } catch {
      // Silencioso
    }
  };
}

/**
 * Prévia SOMENTE LEITURA antes da primeira sincronização de um segundo aparelho:
 * calcula `"X obras só aqui · Y só na nuvem · Z conflitos protegidos"` sem alterar
 * nada localmente nem na nuvem.
 */
export async function previewCloudSyncWithSupabase({
  client = null,
  localWorksOverride = null,
  domainFilter = null,
  storage = null,
  idbFactory = null,
} = {}) {
  const cfg = getSupabaseConfig({ storage });
  const sb = client || getSupabaseClient({ storage });
  if (!sb || (!client && !cfg.isConfigured)) {
    return { ok: false, unconfigured: true };
  }
  if (!isOnlineBrowser()) {
    return { ok: false, offline: true };
  }

  const sessionRes = await getActiveSupabaseSession({ client: sb, storage });
  const user = sessionRes.user;
  if (!user?.id) {
    return {
      ok: false,
      unauthenticated: true,
      sessionExpired: Boolean(sessionRes.sessionExpired),
      error: sessionRes.error || null,
    };
  }

  try {
    let pullQuery = sb
      .from(OMNI_CATALOG_TABLE)
      .select('*')
      .eq('user_id', user.id);
    if (domainFilter) {
      pullQuery = pullQuery.eq('domain', normalizeDomainId(domainFilter));
    }
    const { data: remoteRows, error: pullError } = await pullQuery;
    if (pullError) {
      const friendly = formatFriendlySyncError(pullError);
      return {
        ok: false,
        error: friendly.message,
        sessionExpired: friendly.sessionExpired,
      };
    }

    const remoteWorks = (Array.isArray(remoteRows) ? remoteRows : []).map(
      mapCatalogRowToLocalWork
    );
    const activeRemoteCount = remoteWorks.filter((w) => !w.deletedAt).length;

    const idbWorks = await getAllRelationalWorks({ idbFactory });
    const localTombstones = readCloudTombstones(storage);
    const pendingDeletes = readPendingCloudDeletes(storage);

    const baseLocalWorks =
      Array.isArray(localWorksOverride) && localWorksOverride.length > 0
        ? mergeWorksByUpdatedAt(idbWorks, localWorksOverride, {
            pendingDeleteIds: pendingDeletes,
            localTombstones,
          }).mergedWorks
        : idbWorks;

    const merged = mergeWorksByUpdatedAt(baseLocalWorks, remoteWorks, {
      pendingDeleteIds: pendingDeletes,
      localTombstones,
    });

    return {
      ok: true,
      user,
      localCount: baseLocalWorks.length,
      remoteCount: activeRemoteCount,
      mergedCount: merged.mergedWorks.length,
      stats: merged.stats,
      summaryText: formatFirstSyncSummary(merged.stats),
      needsConfirmation: baseLocalWorks.length > 0 && activeRemoteCount > 0,
    };
  } catch (err) {
    const friendly = formatFriendlySyncError(err);
    return {
      ok: false,
      offline: !isOnlineBrowser(),
      error: friendly.message,
      sessionExpired: friendly.sessionExpired,
    };
  }
}

/**
 * Sincronização bidirecional resiliente (Local-First, independente de Realtime):
 * 1) Baixa `catalog_works` (todos os 4 domínios, incluindo `deleted_at` se existir);
 * 2) Mescla com o IndexedDB local respeitando `updated_at` (sem inventar data) e tombstones;
 * 3) Envia tombstones locais (soft-delete via `deleted_at` ou compatível antes do SQL);
 * 4) Faz push das obras locais novas ou mais recentes;
 * 5) Persiste o resultado no IndexedDB local e limpa a fila pendente.
 */
export async function syncCatalogWithSupabase({
  client = null,
  localWorksOverride = null,
  domainFilter = null,
  storage = null,
  idbFactory = null,
} = {}) {
  const cfg = getSupabaseConfig({ storage });
  const sb = client || getSupabaseClient({ storage });
  if (!sb || (!client && !cfg.isConfigured)) {
    return { ok: false, unconfigured: true, mode: 'local' };
  }

  if (!isOnlineBrowser()) {
    return { ok: false, offline: true, mode: 'offline' };
  }

  const sessionRes = await getActiveSupabaseSession({ client: sb, storage });
  const user = sessionRes.user;
  if (!user?.id) {
    return {
      ok: false,
      unauthenticated: true,
      sessionExpired: Boolean(sessionRes.sessionExpired),
      mode: 'local',
      error: sessionRes.error || null,
    };
  }

  try {
    // 1. Pull remoto primeiro (permite comparar timestamps contra tombstones locais!)
    let pullQuery = sb
      .from(OMNI_CATALOG_TABLE)
      .select('*')
      .eq('user_id', user.id);
    if (domainFilter) {
      pullQuery = pullQuery.eq('domain', normalizeDomainId(domainFilter));
    }
    const { data: remoteRows, error: pullError } = await pullQuery;

    if (pullError) {
      const friendly = formatFriendlySyncError(pullError);
      recordSyncFailure(friendly.message, storage);
      return {
        ok: false,
        mode: 'error',
        sessionExpired: friendly.sessionExpired,
        error: friendly.message,
      };
    }

    const safeRemoteRows = Array.isArray(remoteRows) ? remoteRows : [];
    // Se a coluna deleted_at apareceu no schema remoto, habilita soft-delete automaticamente
    if (
      deletedAtColumnUnsupported &&
      safeRemoteRows.length > 0 &&
      Object.prototype.hasOwnProperty.call(safeRemoteRows[0], 'deleted_at')
    ) {
      deletedAtColumnUnsupported = false;
    }

    const remoteWorks = safeRemoteRows.map(mapCatalogRowToLocalWork);
    const localTombstones = readCloudTombstones(storage);
    const pendingDeletes = readPendingCloudDeletes(storage);

    // 2. Lê IndexedDB local (`works`) + estado em memória mais recente
    const idbWorks = await getAllRelationalWorks({ idbFactory });
    const baseLocalWorks =
      Array.isArray(localWorksOverride) && localWorksOverride.length > 0
        ? mergeWorksByUpdatedAt(idbWorks, localWorksOverride, {
            pendingDeleteIds: pendingDeletes,
            localTombstones,
          }).mergedWorks
        : idbWorks;

    // 3. Mescla bidirecional pelo updated_at mais recente + tombstones
    const {
      mergedWorks,
      worksToPush,
      pulledCount,
      remoteTombstonesApplied,
      tombstonesToFlush,
      cancelledTombstoneCloudIds,
      stats,
    } = mergeWorksByUpdatedAt(baseLocalWorks, remoteWorks, {
      pendingDeleteIds: pendingDeletes,
      localTombstones,
    });

    // Cancela tombstones locais superados por edição remota mais nova
    for (const cancelledId of cancelledTombstoneCloudIds) {
      cancelPendingCloudDelete(cancelledId, storage);
    }

    // Registra tombstones vindos de outros aparelhos (sem purga automática)
    if (remoteTombstonesApplied.length > 0) {
      recordCloudTombstones(remoteTombstonesApplied, storage);
    }

    // 4. Envia tombstones locais pendentes (soft-delete via deleted_at ou fallback compat)
    let deletedCount = 0;
    if (tombstonesToFlush.length > 0) {
      const delRes = await applyCloudDeletes(sb, user.id, tombstonesToFlush, {
        domainFilter,
      });
      if (!delRes.ok) {
        recordSyncFailure(delRes.error, storage);
        return {
          ok: false,
          mode: 'error',
          sessionExpired: Boolean(delRes.sessionExpired),
          error: delRes.error,
        };
      }
      deletedCount = delRes.count;
      const flushedIds = tombstonesToFlush.map((t) => t.cloudId);
      markCloudTombstonesSynced(flushedIds, storage);
      const remainingPending = readPendingCloudDeletes(storage).filter(
        (id) => !flushedIds.includes(toCloudWorkId(id).toLowerCase())
      );
      writePendingCloudDeletes(remainingPending, storage);
    }

    // 5. Upload inicial / incremental para public.catalog_works (saneado + fallback obra por obra)
    let pushedCount = 0;
    let failedWorks = [];
    if (worksToPush.length > 0) {
      const pushRes = await upsertCatalogRows(sb, worksToPush, user.id, { storage });
      pushedCount = pushRes.count || 0;
      failedWorks = Array.isArray(pushRes.failedWorks) ? pushRes.failedWorks : [];
      if (!pushRes.ok) {
        if (failedWorks.length === 0) {
          enqueuePendingWorkUpserts(
            worksToPush.map((w) => w.id).filter(Boolean),
            storage
          );
        }
        recordSyncFailure(pushRes.error, storage);
        // Mesmo em falha parcial, preserva obras mescladas localmente sem perder dados
        if (pushRes.partialSuccess || pulledCount > 0) {
          await putRelationalWorks(mergedWorks, { idbFactory, replace: true });
        }
        return {
          ok: false,
          partialSuccess: Boolean(pushRes.partialSuccess),
          mode: 'error',
          tombstoneMode: getTombstoneSyncMode(),
          user,
          works: mergedWorks,
          pushedCount,
          pulledCount,
          deletedCount,
          failedWorks,
          sessionExpired: Boolean(pushRes.sessionExpired),
          error: pushRes.error,
        };
      }
    }

    // 6. Persiste resultado mesclado no IndexedDB local
    await putRelationalWorks(mergedWorks, { idbFactory, replace: true });

    // Limpa fila e falhas acumuladas após sincronização completa bem-sucedida
    clearPendingWorkUpserts(null, storage);
    clearSyncFailure(storage);

    const syncedAt = new Date().toISOString();
    const tombstoneMode = getTombstoneSyncMode();
    writeSyncMeta(
      {
        lastSyncAt: syncedAt,
        lastUserId: user.id,
        initialPushDone: true,
        tombstoneMode,
      },
      storage
    );

    return {
      ok: true,
      mode: 'supabase',
      tombstoneMode,
      user,
      works: mergedWorks,
      pushedCount,
      pulledCount,
      deletedCount,
      stats,
      summaryText: formatFirstSyncSummary(stats),
      syncedAt,
    };
  } catch (err) {
    const friendly = formatFriendlySyncError(err);
    recordSyncFailure(friendly.message, storage);
    return {
      ok: false,
      offline: !isOnlineBrowser(),
      mode: isOnlineBrowser() ? 'error' : 'offline',
      sessionExpired: friendly.sessionExpired,
      error: friendly.message,
    };
  }
}

export async function pushWorksToCloud(
  works = [],
  { client = null, storage = null } = {}
) {
  const list = Array.isArray(works) ? works.filter((w) => w && typeof w === 'object') : [];
  if (list.length === 0) return { ok: true, count: 0, skipped: true, succeededWorkIds: [], failedWorks: [] };

  // Enfileira antes de tentar enviar para sobreviver a recarregamento ou queda de rede
  enqueuePendingWorkUpserts(
    list.map((w) => w.id).filter(Boolean),
    storage
  );

  if (!isOnlineBrowser()) {
    return {
      ok: false,
      offline: true,
      queued: list.length,
      succeededWorkIds: [],
      failedWorks: [],
      error:
        'Você está offline. Suas alterações ficaram na fila e serão enviadas automaticamente ao reconectar.',
    };
  }

  const sb = client || getSupabaseClient({ storage });
  if (!sb) return { ok: false, skipped: true, queued: list.length, succeededWorkIds: [], failedWorks: [] };

  const sessionRes = await getActiveSupabaseSession({ client: sb, storage });
  if (!sessionRes.user?.id) {
    return {
      ok: false,
      unauthenticated: true,
      sessionExpired: Boolean(sessionRes.sessionExpired),
      queued: list.length,
      succeededWorkIds: [],
      failedWorks: [],
      error: sessionRes.error || null,
    };
  }

  try {
    const res = await upsertCatalogRows(sb, list, sessionRes.user.id, { storage });
    if (res.ok) {
      clearPendingWorkUpserts(
        list.map((w) => w.id).filter(Boolean),
        storage
      );
      if (getPendingSyncCount(storage) === 0) {
        clearSyncFailure(storage);
      }
      return { ...res, tombstoneMode: getTombstoneSyncMode() };
    }
    recordSyncFailure(res.error, storage);
    return {
      ...res,
      tombstoneMode: getTombstoneSyncMode(),
      queued: Array.isArray(res.failedWorks) && res.failedWorks.length > 0
        ? res.failedWorks.length
        : list.length,
    };
  } catch (err) {
    const friendly = formatFriendlySyncError(err);
    recordSyncFailure(friendly.message, storage);
    recordLocalError(friendly.message, {
      source: 'cloud-sync',
      storage: storage || undefined,
    });
    return {
      ok: false,
      offline: !isOnlineBrowser(),
      queued: list.length,
      succeededWorkIds: [],
      failedWorks: [],
      sessionExpired: friendly.sessionExpired,
      error: friendly.message,
    };
  }
}

export async function deleteWorksFromCloud(
  workIds = [],
  { client = null, storage = null, deletedAt = null } = {}
) {
  const ids = (Array.isArray(workIds) ? workIds : []).filter(Boolean);
  if (ids.length === 0) return { ok: true, count: 0 };

  const delIso = deletedAt || new Date().toISOString();
  ids.forEach((id) => queuePendingCloudDelete(id, storage, { deletedAt: delIso }));

  if (!isOnlineBrowser()) {
    return {
      ok: false,
      offline: true,
      queued: ids.length,
      error: 'Exclusão salva offline e enfileirada para sincronizar ao reconectar.',
    };
  }
  const sb = client || getSupabaseClient({ storage });
  if (!sb) return { ok: false, queued: ids.length };

  const sessionRes = await getActiveSupabaseSession({ client: sb, storage });
  if (!sessionRes.user?.id) {
    return {
      ok: false,
      unauthenticated: true,
      sessionExpired: Boolean(sessionRes.sessionExpired),
      queued: ids.length,
      error: sessionRes.error || null,
    };
  }

  const entries = ids.map((id) => ({
    id: String(id),
    cloudId: toCloudWorkId(id).toLowerCase(),
    deletedAt: delIso,
  }));

  try {
    const delRes = await applyCloudDeletes(sb, sessionRes.user.id, entries);
    if (delRes.ok) {
      const flushedIds = entries.map((e) => e.cloudId);
      markCloudTombstonesSynced(flushedIds, storage);
      const remainingPending = readPendingCloudDeletes(storage).filter(
        (id) => !flushedIds.includes(toCloudWorkId(id).toLowerCase())
      );
      writePendingCloudDeletes(remainingPending, storage);
      if (getPendingSyncCount(storage) === 0) {
        clearSyncFailure(storage);
      }
      return { ok: true, count: delRes.count, tombstoneMode: delRes.mode };
    }
    recordSyncFailure(delRes.error, storage);
    return {
      ok: false,
      queued: ids.length,
      sessionExpired: Boolean(delRes.sessionExpired),
      error: delRes.error,
    };
  } catch (err) {
    const friendly = formatFriendlySyncError(err);
    recordSyncFailure(friendly.message, storage);
    return {
      ok: false,
      offline: !isOnlineBrowser(),
      queued: ids.length,
      sessionExpired: friendly.sessionExpired,
      error: friendly.message,
    };
  }
}

/**
 * Assinatura Realtime (EXTRA OPCIONAL — o sync não depende dela) em `public.catalog_works`
 * para acelerar atualizações quando outro dispositivo alterar ou marcar `deleted_at` numa obra.
 */
export function subscribeToCatalogRealtime(
  { userId, onRemoteWorksMerged, getCurrentWorks },
  { client = null, idbFactory = null, storage = null } = {}
) {
  const sb = client || getSupabaseClient({ storage });
  if (!sb || !userId || typeof sb.channel !== 'function') {
    return () => {};
  }

  const channel = sb
    .channel(`omniprism-catalog-all-${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: OMNI_CATALOG_TABLE,
        filter: `user_id=eq.${userId}`,
      },
      async (payload) => {
        try {
          const eventType = payload?.eventType;
          const baseWorks =
            typeof getCurrentWorks === 'function'
              ? getCurrentWorks()
              : await getAllRelationalWorks({ idbFactory });

          if (eventType === 'DELETE') {
            const deletedCloudId = String(payload?.old?.id || '').toLowerCase();
            if (!deletedCloudId) return;
            recordCloudTombstones(
              [{ id: deletedCloudId, cloudId: deletedCloudId, deletedAt: new Date().toISOString(), synced: true }],
              storage
            );
            const nextWorks = baseWorks.filter(
              (w) => toCloudWorkId(w.cloudId || w.id).toLowerCase() !== deletedCloudId
            );
            if (nextWorks.length !== baseWorks.length) {
              await putRelationalWorks(nextWorks, { idbFactory, replace: true });
              onRemoteWorksMerged?.(nextWorks, { eventType: 'DELETE' });
            }
            return;
          }

          const row = payload?.new;
          const rowDomain = row?.domain || 'cinema';
          if (!row || !OMNIPRISM_DOMAIN_IDS.includes(rowDomain)) return;

          const incomingWork = mapCatalogRowToLocalWork(row);
          const { mergedWorks, remoteTombstonesApplied } = mergeWorksByUpdatedAt(
            baseWorks,
            [incomingWork],
            {
              pendingDeleteIds: readPendingCloudDeletes(storage),
              localTombstones: readCloudTombstones(storage),
            }
          );
          if (remoteTombstonesApplied.length > 0) {
            recordCloudTombstones(remoteTombstonesApplied, storage);
          }
          await putRelationalWorks(mergedWorks, { idbFactory, replace: true });
          onRemoteWorksMerged?.(mergedWorks, {
            eventType: incomingWork.deletedAt ? 'SOFT_DELETE' : eventType,
            work: incomingWork,
          });
        } catch {
          // Resiliente a payloads parciais no canal realtime (o pull periódico garante consistência)
        }
      }
    )
    .subscribe();

  return () => {
    try {
      sb.removeChannel?.(channel);
    } catch {
      // Silencioso
    }
  };
}

async function compressCoverBlobIfPossible(blob) {
  if (
    typeof document === 'undefined' ||
    typeof createImageBitmap !== 'function' ||
    !blob
  ) {
    return { blob, contentType: blob?.type || 'image/jpeg', ext: 'jpg' };
  }
  try {
    const bitmap = await createImageBitmap(blob);
    const maxW = 360;
    const scale = bitmap.width > maxW ? maxW / bitmap.width : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close?.();
      return { blob, contentType: blob.type || 'image/jpeg', ext: 'jpg' };
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const compressed = await new Promise((resolve) => {
      canvas.toBlob((out) => resolve(out), 'image/webp', 0.82);
    });
    if (compressed && compressed.size > 0) {
      return { blob: compressed, contentType: 'image/webp', ext: 'webp' };
    }
  } catch {
    // Fallback silencioso para o blob original
  }
  return { blob, contentType: blob.type || 'image/jpeg', ext: 'jpg' };
}

/**
 * Tenta salvar uma cópia leve da capa no bucket `covers` do Supabase Storage.
 * Caso CORS bloqueie ou Storage esteja indisponível, retorna fallback silencioso
 * mantendo a URL externa original intacta.
 */
export async function cacheCoverImageToSupabaseStorage(
  work,
  { client = null, storage = null, fetchImpl = null } = {}
) {
  const cleanUrl = normalizeHttpUrl(work?.coverUrl);
  if (!cleanUrl || cleanUrl.includes('/storage/v1/object/')) {
    return { ok: false, skipped: true, url: work?.coverUrl || null };
  }
  if (!isOnlineBrowser()) {
    return { ok: false, offline: true, fallback: true, url: cleanUrl };
  }

  const sb = client || getSupabaseClient({ storage });
  if (!sb || !sb.storage) {
    return { ok: false, skipped: true, fallback: true, url: cleanUrl };
  }

  const sessionRes = await getActiveSupabaseSession({ client: sb, storage });
  const userId = sessionRes.user?.id;
  if (!userId) {
    return { ok: false, unauthenticated: true, fallback: true, url: cleanUrl };
  }

  const fetchFn = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!fetchFn) {
    return { ok: false, fallback: true, url: cleanUrl };
  }

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeout = setTimeout(() => controller?.abort(), 6500);

  try {
    const response = await fetchFn(cleanUrl, {
      mode: 'cors',
      signal: controller?.signal,
    });
    if (!response.ok) {
      return { ok: false, fallback: true, url: cleanUrl };
    }

    const rawBlob = await response.blob();
    if (!rawBlob || rawBlob.size === 0 || rawBlob.size > 4 * 1024 * 1024) {
      return { ok: false, fallback: true, url: cleanUrl };
    }

    const prepared = await compressCoverBlobIfPossible(rawBlob);
    const cloudWorkId = toCloudWorkId(work.cloudId || work.id);
    const objectPath = `${userId}/${cloudWorkId}.${prepared.ext}`;

    const bucket = sb.storage.from(OMNI_COVERS_BUCKET);
    const { error: uploadError } = await bucket.upload(objectPath, prepared.blob, {
      upsert: true,
      contentType: prepared.contentType,
      cacheControl: '31536000',
    });

    if (uploadError) {
      return { ok: false, fallback: true, url: cleanUrl, error: uploadError.message };
    }

    const { data: pubData } = bucket.getPublicUrl(objectPath);
    const publicUrl = pubData?.publicUrl || '';
    if (!publicUrl) {
      return { ok: false, fallback: true, url: cleanUrl };
    }

    return {
      ok: true,
      cached: true,
      url: publicUrl,
      originalUrl: cleanUrl,
      storagePath: objectPath,
    };
  } catch {
    // CORS bloqueou ou falha de rede: fallback silencioso para a URL externa
    return { ok: false, fallback: true, url: cleanUrl };
  } finally {
    clearTimeout(timeout);
  }
}
