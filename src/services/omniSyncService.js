import {
  OMNIPRISM_DOMAIN_IDS,
  inferDomainFromWork,
  normalizeCinemaStatus,
  normalizeDomainId,
  normalizeWorkTypeForDomain,
} from '../config/domainConfig.js';
import { normalizeExternalRatings } from '../lib/ratings.js';
import { getAllRelationalWorks, putRelationalWorks } from './relationalDb.js';
import { getSupabaseClient, getSupabaseConfig } from './supabaseClient.js';

export const OMNI_CATALOG_TABLE = 'catalog_works';
export const OMNI_COVERS_BUCKET = 'covers';
export const OMNI_CINEMA_DOMAIN = 'cinema';
export const SYNC_META_STORAGE_KEY = 'omniprism_cloud_sync_meta_v1';
export const PENDING_DELETES_STORAGE_KEY = 'omniprism_cloud_pending_deletes_v1';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Se a coluna external_rating no Supabase for numérica em vez de jsonb, ajusta automaticamente
let externalRatingNumericFallback = false;

export function resetSyncRuntimeFlagsForTests() {
  externalRatingNumericFallback = false;
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

function parseTimestampMs(isoOrDate) {
  if (!isoOrDate) return 0;
  const ms = Date.parse(isoOrDate);
  return Number.isFinite(ms) ? ms : 0;
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

function serializeExternalRatingForRow(externalRatings, numericOnly = false) {
  const normalized = normalizeExternalRatings(externalRatings);
  const consensus = computeConsensusExternalRating(normalized);
  const hasAny = Object.values(normalized).some(Boolean);
  if (!hasAny) return null;
  if (numericOnly) return consensus;
  return {
    consensus,
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
    'cheapshark',
    'steam',
    'freetogame',
    'wikidata',
    'itunes',
    'itunesTrack',
    'itunesArtist',
    'musicbrainz',
    'musicbrainzRecording',
    'musicbrainzArtist',
  ]) {
    const val = rawIds[key] ?? work[key] ?? null;
    if (val !== null && val !== undefined && val !== '') {
      payload[key] = val;
    }
  }
  return payload;
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
  { numericExternalRating = externalRatingNumericFallback } = {}
) {
  const nowIso = new Date().toISOString();
  const cloudId = toCloudWorkId(work.cloudId || work.id);
  const domain = inferDomainFromWork(work);
  const mediaType = normalizeWorkTypeForDomain(work.workType || work.mediaType, domain);
  const status = normalizeCinemaStatus(work.status);
  const releaseYear = Number(work.releaseYear);
  const rankNum = Number(work.favoriteRank);
  const ratingVal =
    work.rating === null || work.rating === undefined || work.rating === ''
      ? null
      : Math.max(0, Math.min(100, Math.round(Number(work.rating))));

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
  const editionType = String(work.editionType || (domain === 'games' ? 'Original' : '')).trim();
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

  return {
    id: cloudId,
    user_id: userId,
    domain,
    media_type: mediaType,
    title: String(work.title || '').trim() || 'Sem título',
    creator: String(work.creator || work.director || work.studio || work.author || '').trim(),
    release_year:
      Number.isFinite(releaseYear) && releaseYear > 1800 ? Math.round(releaseYear) : null,
    status,
    rating: Number.isFinite(ratingVal) ? ratingVal : null,
    external_rating: serializeExternalRatingForRow(
      cleanExternalRatings,
      numericExternalRating
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
      rawgId: Number(work.rawgId || work.ids?.rawg) > 0 ? Math.floor(Number(work.rawgId || work.ids?.rawg)) : null,
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
    favorite_rank:
      Number.isInteger(rankNum) && rankNum >= 1 && rankNum <= 4 ? rankNum : null,
    favorite_quote_or_scene:
      String(work.favoriteScene || '').trim().slice(0, 200) || null,
    personal_notes: String(work.notes || ''),
    created_at: work.createdAt || nowIso,
    updated_at: work.updatedAt || nowIso,
  };
}

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
    bookFormat: String(pd.book_format ?? pd.bookFormat ?? (domain === 'reading' ? 'Físico' : '')).trim(),
    // Games (preserva plataformas reais e edição sem inventar PC)
    platform: String(pd.platform ?? '').trim(),
    platforms: Array.isArray(pd.platforms)
      ? Array.from(new Set(pd.platforms.map((p) => String(p || '').trim()).filter(Boolean)))
      : [],
    editionType: String(pd.edition_type ?? pd.editionType ?? (domain === 'games' ? 'Original' : '')).trim(),
    gameRating11:
      (pd.game_rating_11 ?? pd.gameRating11) !== null &&
      (pd.game_rating_11 ?? pd.gameRating11) !== undefined &&
      (pd.game_rating_11 ?? pd.gameRating11) !== '' &&
      Number.isFinite(Number(pd.game_rating_11 ?? pd.gameRating11))
        ? Math.max(0, Math.min(11, Math.round(Number(pd.game_rating_11 ?? pd.gameRating11) * 10) / 10))
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
        ? Math.max(0, Math.min(10, Math.round(Number(pd.track_rating_10 ?? pd.trackRating10) * 10) / 10))
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
    ratingSource: pd.ratingSource ?? (row.rating !== null && row.rating !== undefined ? 'manual' : null),
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
    rawgId: Number(pd.rawgId || extIds.rawg) > 0 ? Math.floor(Number(pd.rawgId || extIds.rawg)) : null,
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
    verdict: pd.verdict ?? null,
    externalRatings,
    ids: {
      ...(extIds.tmdb ? { tmdb: extIds.tmdb } : {}),
      ...(extIds.imdb ? { imdb: extIds.imdb } : {}),
      ...(extIds.tvmaze ? { tvmaze: extIds.tvmaze } : {}),
      ...(extIds.anilist ? { anilist: extIds.anilist } : {}),
      ...(extIds.mal ? { mal: extIds.mal } : {}),
      ...(extIds.openlibrary ? { openlibrary: extIds.openlibrary } : {}),
      ...(extIds.googleBooks ? { googleBooks: extIds.googleBooks } : {}),
      ...(extIds.cheapshark ? { cheapshark: extIds.cheapshark } : {}),
      ...(extIds.steam ? { steam: extIds.steam } : {}),
      ...(extIds.freetogame ? { freetogame: extIds.freetogame } : {}),
      ...(extIds.wikidata ? { wikidata: extIds.wikidata } : {}),
      ...(extIds.itunes ? { itunes: extIds.itunes } : {}),
      ...(extIds.itunesTrack ? { itunesTrack: extIds.itunesTrack } : {}),
      ...(extIds.itunesArtist ? { itunesArtist: extIds.itunesArtist } : {}),
      ...(extIds.musicbrainz ? { musicbrainz: extIds.musicbrainz } : {}),
      ...(extIds.musicbrainzRecording ? { musicbrainzRecording: extIds.musicbrainzRecording } : {}),
      ...(extIds.musicbrainzArtist ? { musicbrainzArtist: extIds.musicbrainzArtist } : {}),
    },
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
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || row.created_at || new Date().toISOString(),
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
      const edition = String(work.editionType || 'Original').trim().toLowerCase();
      const yr = Number(work.releaseYear) > 1970 ? `:${Math.round(Number(work.releaseYear))}` : '';
      keys.push(`title:${domain}:${type}:${edition}::${cleanTitle}${yr}`);
    } else {
      keys.push(`title:${domain}:${type}::${cleanTitle}`);
    }
  }
  return keys;
}

/**
 * Mescla obras locais e remotas usando `updatedAt` mais recente.
 */
export function mergeWorksByUpdatedAt(
  localWorks = [],
  remoteWorks = [],
  { pendingDeleteIds = [] } = {}
) {
  const deletedSet = new Set((pendingDeleteIds || []).map((id) => toCloudWorkId(id).toLowerCase()));
  const mergedMap = new Map();
  const keyIndex = new Map();
  const worksToPush = [];
  let pulledCount = 0;

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

  for (const local of Array.isArray(localWorks) ? localWorks : []) {
    if (!local || !local.id) continue;
    const cloudKey = toCloudWorkId(local.cloudId || local.id).toLowerCase();
    if (deletedSet.has(cloudKey)) continue;
    registerWork(cloudKey, local);
  }

  for (const remote of Array.isArray(remoteWorks) ? remoteWorks : []) {
    if (!remote || (!remote.id && !remote.cloudId)) continue;
    const remoteCloudKey = toCloudWorkId(remote.cloudId || remote.id).toLowerCase();
    if (deletedSet.has(remoteCloudKey)) continue;

    const matchedKey = findExistingKey(remote);
    if (!matchedKey) {
      registerWork(remoteCloudKey, remote);
      pulledCount += 1;
      continue;
    }

    const existing = mergedMap.get(matchedKey);
    const localMs = parseTimestampMs(existing?.updatedAt || existing?.createdAt);
    const remoteMs = parseTimestampMs(remote?.updatedAt || remote?.createdAt);

    if (remoteMs > localMs) {
      const winner = {
        ...remote,
        id: existing.id || remote.id,
        cloudId: remote.cloudId || remoteCloudKey,
      };
      registerWork(matchedKey, winner);
      pulledCount += 1;
    } else if (remoteMs === localMs) {
      // Em empate exato, preserva capa do Supabase Storage se existir
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

  // Determina quais obras locais precisam subir para a nuvem
  const remoteByCloud = new Map();
  for (const remote of Array.isArray(remoteWorks) ? remoteWorks : []) {
    const k = toCloudWorkId(remote.cloudId || remote.id).toLowerCase();
    remoteByCloud.set(k, remote);
  }

  const mergedWorks = Array.from(mergedMap.values()).sort(
    (a, b) => parseTimestampMs(b.updatedAt) - parseTimestampMs(a.updatedAt)
  );

  for (const item of mergedWorks) {
    const cloudKey = toCloudWorkId(item.cloudId || item.id).toLowerCase();
    const remoteMatch =
      remoteByCloud.get(cloudKey) ||
      (Array.isArray(remoteWorks)
        ? remoteWorks.find((r) =>
            getWorkIdentityKeys(r).some((k) => getWorkIdentityKeys(item).includes(k))
          )
        : null);
    if (!remoteMatch) {
      worksToPush.push(item);
      continue;
    }
    const itemMs = parseTimestampMs(item.updatedAt || item.createdAt);
    const remoteMs = parseTimestampMs(remoteMatch.updatedAt || remoteMatch.createdAt);
    if (itemMs > remoteMs) {
      worksToPush.push(item);
    }
  }

  return {
    mergedWorks,
    worksToPush,
    pulledCount,
  };
}

export function readSyncMeta(storage = null) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!store || typeof store.getItem !== 'function') {
    return { lastSyncAt: null, lastUserId: null, initialPushDone: false };
  }
  try {
    const raw = store.getItem(SYNC_META_STORAGE_KEY);
    if (!raw) return { lastSyncAt: null, lastUserId: null, initialPushDone: false };
    const parsed = JSON.parse(raw);
    return {
      lastSyncAt: parsed?.lastSyncAt || null,
      lastUserId: parsed?.lastUserId || null,
      initialPushDone: Boolean(parsed?.initialPushDone),
    };
  } catch {
    return { lastSyncAt: null, lastUserId: null, initialPushDone: false };
  }
}

function writeSyncMeta(patch = {}, storage = null) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!store || typeof store.setItem !== 'function') return;
  try {
    const next = { ...readSyncMeta(store), ...patch };
    store.setItem(SYNC_META_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Silencioso
  }
}

export function readPendingCloudDeletes(storage = null) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!store || typeof store.getItem !== 'function') return [];
  try {
    const raw = store.getItem(PENDING_DELETES_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
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

export function queuePendingCloudDelete(workId, storage = null) {
  if (!workId) return;
  const current = readPendingCloudDeletes(storage);
  writePendingCloudDeletes([...current, toCloudWorkId(workId)], storage);
}

export function cancelPendingCloudDelete(workId, storage = null) {
  if (!workId) return;
  const target = toCloudWorkId(workId);
  const next = readPendingCloudDeletes(storage).filter((id) => id !== target && id !== String(workId));
  writePendingCloudDeletes(next, storage);
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

async function upsertCatalogRows(client, works = [], userId) {
  if (!client || !userId || !Array.isArray(works) || works.length === 0) {
    return { ok: true, count: 0 };
  }

  const chunkSize = 40;
  let totalUpserted = 0;

  for (let i = 0; i < works.length; i += chunkSize) {
    const slice = works.slice(i, i + chunkSize);
    let rows = slice.map((w) =>
      mapLocalWorkToCatalogRow(w, userId, {
        numericExternalRating: externalRatingNumericFallback,
      })
    );
    let { error } = await client
      .from(OMNI_CATALOG_TABLE)
      .upsert(rows, { onConflict: 'id' });

    if (error && !externalRatingNumericFallback && isExternalRatingTypeError(error)) {
      externalRatingNumericFallback = true;
      rows = slice.map((w) =>
        mapLocalWorkToCatalogRow(w, userId, { numericExternalRating: true })
      );
      const retry = await client
        .from(OMNI_CATALOG_TABLE)
        .upsert(rows, { onConflict: 'id' });
      error = retry.error;
    }

    if (error) {
      return {
        ok: false,
        count: totalUpserted,
        error: error.message || 'Falha ao enviar obras para o Supabase.',
      };
    }
    totalUpserted += rows.length;
  }

  return { ok: true, count: totalUpserted };
}

export async function getActiveSupabaseSession({ client = null } = {}) {
  const sb = client || getSupabaseClient();
  if (!sb) {
    return { ok: false, configured: false, session: null, user: null };
  }
  try {
    const { data, error } = await sb.auth.getSession();
    if (error) {
      return {
        ok: false,
        configured: true,
        session: null,
        user: null,
        error: error.message,
      };
    }
    return {
      ok: true,
      configured: true,
      session: data?.session || null,
      user: data?.session?.user || null,
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      session: null,
      user: null,
      error: err?.message || 'Erro ao verificar sessão Supabase.',
    };
  }
}

export async function signInWithEmailPassword(
  { email, password },
  { client = null } = {}
) {
  const sb = client || getSupabaseClient();
  if (!sb) {
    return {
      ok: false,
      error: 'Configure a URL e a chave pública do Supabase primeiro.',
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
        : msg || 'Não foi possível entrar na conta.';
      return { ok: false, error: friendly };
    }
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

export async function signOutFromCloud({ client = null } = {}) {
  const sb = client || getSupabaseClient();
  if (!sb) return { ok: true };
  try {
    await sb.auth.signOut({ scope: 'local' });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export function subscribeToAuthChanges(callback, { client = null } = {}) {
  const sb = client || getSupabaseClient();
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
 * Sincronização bidirecional resiliente (Local-First):
 * 1) Envia exclusões pendentes;
 * 2) Baixa `catalog_works` com `domain = 'cinema'`;
 * 3) Mescla com o IndexedDB local (`works`) pelo `updated_at` mais recente;
 * 4) Faz push das obras locais novas ou mais recentes (upload inicial / incremental);
 * 5) Persiste o resultado no IndexedDB local.
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

  const sessionRes = await getActiveSupabaseSession({ client: sb });
  const user = sessionRes.user;
  if (!user?.id) {
    return { ok: false, unauthenticated: true, mode: 'local' };
  }

  try {
    // 1. Flush de exclusões pendentes offline (guarda lista para filtrar IndexedDB local)
    const pendingDeletes = readPendingCloudDeletes(storage);
    const flushedDeleteIds = [];
    let deletedCount = 0;
    if (pendingDeletes.length > 0) {
      let delQuery = sb
        .from(OMNI_CATALOG_TABLE)
        .delete()
        .eq('user_id', user.id);
      if (domainFilter) {
        delQuery = delQuery.eq('domain', normalizeDomainId(domainFilter));
      }
      const { error: delErr } = await delQuery.in('id', pendingDeletes);

      if (!delErr) {
        deletedCount = pendingDeletes.length;
        flushedDeleteIds.push(...pendingDeletes);
        writePendingCloudDeletes([], storage);
      }
    }

    const activeDeletedIds = Array.from(
      new Set([...flushedDeleteIds, ...readPendingCloudDeletes(storage)])
    );

    // 2. Pull remoto dos 4 domínios (ou filtrado se domainFilter for passado)
    let pullQuery = sb
      .from(OMNI_CATALOG_TABLE)
      .select('*')
      .eq('user_id', user.id);
    if (domainFilter) {
      pullQuery = pullQuery.eq('domain', normalizeDomainId(domainFilter));
    }
    const { data: remoteRows, error: pullError } = await pullQuery;

    if (pullError) {
      return {
        ok: false,
        mode: 'error',
        error: pullError.message || 'Falha ao consultar obras no Supabase.',
      };
    }

    const remoteWorks = (Array.isArray(remoteRows) ? remoteRows : []).map(
      mapCatalogRowToLocalWork
    );

    // 3. Lê IndexedDB local (`works`) + estado em memória mais recente
    const idbWorks = await getAllRelationalWorks({ idbFactory });
    const baseLocalWorks =
      Array.isArray(localWorksOverride) && localWorksOverride.length > 0
        ? mergeWorksByUpdatedAt(idbWorks, localWorksOverride, {
            pendingDeleteIds: activeDeletedIds,
          }).mergedWorks
        : idbWorks;

    // 4. Mescla bidirecional pelo updated_at mais recente
    const { mergedWorks, worksToPush, pulledCount } = mergeWorksByUpdatedAt(
      baseLocalWorks,
      remoteWorks,
      { pendingDeleteIds: activeDeletedIds }
    );

    // 5. Upload inicial / incremental para public.catalog_works
    let pushedCount = 0;
    if (worksToPush.length > 0) {
      const pushRes = await upsertCatalogRows(sb, worksToPush, user.id);
      if (!pushRes.ok) {
        return {
          ok: false,
          mode: 'error',
          error: pushRes.error,
        };
      }
      pushedCount = pushRes.count;
    }

    // 6. Persiste resultado mesclado no IndexedDB local
    await putRelationalWorks(mergedWorks, { idbFactory, replace: true });

    const syncedAt = new Date().toISOString();
    writeSyncMeta(
      {
        lastSyncAt: syncedAt,
        lastUserId: user.id,
        initialPushDone: true,
      },
      storage
    );

    return {
      ok: true,
      mode: 'supabase',
      user,
      works: mergedWorks,
      pushedCount,
      pulledCount,
      deletedCount,
      syncedAt,
    };
  } catch (err) {
    return {
      ok: false,
      offline: !isOnlineBrowser(),
      mode: isOnlineBrowser() ? 'error' : 'offline',
      error: err?.message || 'Erro ao sincronizar catálogo com o Supabase.',
    };
  }
}

export async function pushWorksToCloud(
  works = [],
  { client = null, storage = null } = {}
) {
  const list = Array.isArray(works) ? works.filter((w) => w && w.id) : [];
  if (list.length === 0 || !isOnlineBrowser()) return { ok: false, skipped: true };

  const sb = client || getSupabaseClient({ storage });
  if (!sb) return { ok: false, skipped: true };

  const sessionRes = await getActiveSupabaseSession({ client: sb });
  if (!sessionRes.user?.id) return { ok: false, skipped: true };

  try {
    return await upsertCatalogRows(sb, list, sessionRes.user.id);
  } catch {
    return { ok: false, offline: !isOnlineBrowser() };
  }
}

export async function deleteWorksFromCloud(
  workIds = [],
  { client = null, storage = null } = {}
) {
  const ids = (Array.isArray(workIds) ? workIds : []).filter(Boolean);
  if (ids.length === 0) return { ok: true, count: 0 };

  ids.forEach((id) => queuePendingCloudDelete(id, storage));

  if (!isOnlineBrowser()) return { ok: false, offline: true, queued: ids.length };
  const sb = client || getSupabaseClient({ storage });
  if (!sb) return { ok: false, queued: ids.length };

  const sessionRes = await getActiveSupabaseSession({ client: sb });
  if (!sessionRes.user?.id) return { ok: false, queued: ids.length };

  const cloudIds = ids.map((id) => toCloudWorkId(id));
  try {
    const { error } = await sb
      .from(OMNI_CATALOG_TABLE)
      .delete()
      .eq('user_id', sessionRes.user.id)
      .in('id', cloudIds);
    if (!error) {
      cloudIds.forEach((cid) => cancelPendingCloudDelete(cid, storage));
      return { ok: true, count: cloudIds.length };
    }
    return { ok: false, error: error.message };
  } catch {
    return { ok: false, offline: true };
  }
}

/**
 * Assinatura Realtime em `public.catalog_works` para atualizar o IndexedDB
 * e a interface em tempo real quando outro dispositivo alterar uma obra.
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
    .channel(`omniprism-catalog-cinema-${userId}`)
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
          const { mergedWorks } = mergeWorksByUpdatedAt(baseWorks, [incomingWork], {
            pendingDeleteIds: readPendingCloudDeletes(storage),
          });
          await putRelationalWorks(mergedWorks, { idbFactory, replace: true });
          onRemoteWorksMerged?.(mergedWorks, { eventType, work: incomingWork });
        } catch {
          // Resiliente a payloads parciais no canal realtime
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

  const sessionRes = await getActiveSupabaseSession({ client: sb });
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
