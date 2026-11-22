/**
 * Ponte canônica de IDs entre TMDB, IMDb, TVmaze, AniList e MyAnimeList (D1 / D2).
 * Módulo puro em .js sem dependência de React ou DOM (D7).
 */

export const CANONICAL_ID_KEYS = Object.freeze([
  'tmdb',
  'imdb',
  'tvmaze',
  'anilist',
  'mal',
]);

export function sanitizePositiveIntId(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

export function sanitizeImdbId(raw) {
  if (!raw) return null;
  const clean = String(raw).trim().toLowerCase();
  return /^tt\d{6,10}$/.test(clean) ? clean : null;
}

/**
 * Constrói o bloco canônico `ids` priorizando `raw.ids` e fazendo fallback
 * nos campos soltos legados (`tmdbId`, `imdbId`, `tvmazeId`, `anilistId`, `malId`).
 */
export function normalizeIdsBlock(raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const nested = src.ids && typeof src.ids === 'object' ? src.ids : {};

  return {
    tmdb: sanitizePositiveIntId(nested.tmdb ?? src.tmdbId),
    imdb: sanitizeImdbId(nested.imdb ?? src.imdbId),
    tvmaze: sanitizePositiveIntId(nested.tvmaze ?? src.tvmazeId),
    anilist: sanitizePositiveIntId(nested.anilist ?? src.anilistId),
    mal: sanitizePositiveIntId(nested.mal ?? src.malId),
  };
}

/**
 * Espelha `ids` de volta para os campos planos durante a v1.1.0 (R8 / D2).
 */
export function mirrorFlatIdsFromBlock(ids = {}, tmdbMediaType = null) {
  const norm = normalizeIdsBlock({ ids });
  return {
    tmdbId: norm.tmdb,
    imdbId: norm.imdb || '',
    tvmazeId: norm.tvmaze,
    anilistId: norm.anilist,
    malId: norm.mal,
    ...(tmdbMediaType ? { tmdbMediaType } : {}),
  };
}

/**
 * Mescla dois blocos de IDs preenchendo apenas lacunas (`null`) sem sobrescrever IDs já confirmados.
 */
export function mergeIdsBlocks(primary = {}, incoming = {}) {
  const a = normalizeIdsBlock({ ids: primary });
  const b = normalizeIdsBlock({ ids: incoming });
  return {
    tmdb: a.tmdb ?? b.tmdb ?? null,
    imdb: a.imdb ?? b.imdb ?? null,
    tvmaze: a.tvmaze ?? b.tvmaze ?? null,
    anilist: a.anilist ?? b.anilist ?? null,
    mal: a.mal ?? b.mal ?? null,
  };
}

export function applyCanonicalIdsToWork(work = {}) {
  if (!work || typeof work !== 'object') return work;
  const ids = normalizeIdsBlock(work);
  const flatMirror = mirrorFlatIdsFromBlock(ids, work.tmdbMediaType || null);
  return {
    ...work,
    ids,
    ...flatMirror,
  };
}

/**
 * Resolve lacunas na ponte de IDs usando apenas elos determinísticos oficiais (D2):
 * - `tmdb` -> `external_ids` (`imdb`)
 * - `imdb` (para séries/TV) -> `/lookup/shows?imdb=` no TVmaze (`tvmaze`)
 * - `anilist` -> `idMal` (`mal`)
 * - Regra D1 de anime: se TMDB tem gênero Animação (16) + país JP, confirma na AniList (título + ano).
 * Nunca adivinha IDs aleatoriamente só por título.
 */
export async function resolveIdBridge(work = {}, adapters = {}) {
  let ids = normalizeIdsBlock(work);
  let detectedAnime = work.workType === 'anime';
  const mediaType =
    work.tmdbMediaType ||
    (work.workType === 'movie' && !work.animeFormat ? 'movie' : 'tv');

  // 1. TMDB external_ids -> IMDb ID
  if (ids.tmdb && !ids.imdb && typeof adapters.fetchTmdbExternalIds === 'function') {
    try {
      const ext = await adapters.fetchTmdbExternalIds(ids.tmdb, mediaType);
      if (ext?.imdbId) {
        ids = mergeIdsBlocks(ids, { imdb: ext.imdbId });
      }
    } catch {
      // Falha isolada: mantém null
    }
  }

  // 2. Confirmação D1 para anime vindo do TMDB (gênero Animação + país JP)
  const hasJapanOrigin =
    Array.isArray(work.originCountry)
      ? work.originCountry.includes('JP')
      : String(work.originCountry || '').toUpperCase() === 'JP' ||
        String(work.language || '').toLowerCase() === 'japonês';
  const hasAnimationGenre =
    work.hasTmdbAnimationGenre === true ||
    (Array.isArray(work.genreIds) && work.genreIds.includes(16)) ||
    (Array.isArray(work.genres) && work.genres.some((g) => /anima[çc][aã]o|anime/i.test(String(g))));

  if (
    !ids.anilist &&
    ids.tmdb &&
    hasAnimationGenre &&
    hasJapanOrigin &&
    typeof adapters.confirmAnimeOnAniList === 'function'
  ) {
    try {
      const confirmed = await adapters.confirmAnimeOnAniList({
        title: work.originalTitle || work.title,
        altTitle: work.title,
        releaseYear: work.releaseYear,
      });
      if (confirmed?.anilistId) {
        detectedAnime = true;
        ids = mergeIdsBlocks(ids, {
          anilist: confirmed.anilistId,
          mal: confirmed.malId || null,
        });
      }
    } catch {
      // Falha isolada
    }
  }

  // 3. AniList -> MAL ID
  if (ids.anilist && !ids.mal && typeof adapters.fetchAniListIds === 'function') {
    try {
      const ani = await adapters.fetchAniListIds(ids.anilist);
      if (ani?.malId) {
        ids = mergeIdsBlocks(ids, { mal: ani.malId });
      }
    } catch {
      // Falha isolada
    }
  }

  // 4. IMDb -> TVmaze ID (apenas séries / episódios)
  if (
    ids.imdb &&
    !ids.tvmaze &&
    !detectedAnime &&
    work.workType !== 'movie' &&
    typeof adapters.lookupTvMazeByImdb === 'function'
  ) {
    try {
      const tvShow = await adapters.lookupTvMazeByImdb(ids.imdb);
      if (tvShow?.tvmazeId) {
        ids = mergeIdsBlocks(ids, { tvmaze: tvShow.tvmazeId });
      }
    } catch {
      // Falha isolada
    }
  }

  return {
    ids,
    ...mirrorFlatIdsFromBlock(ids, mediaType),
    workType: detectedAnime ? 'anime' : work.workType || 'movie',
    animeConfirmedByAniList: detectedAnime && Boolean(ids.anilist),
  };
}
