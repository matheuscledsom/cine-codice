import {
  formatAnimeEpisodeCountLabel,
  resolveAnimeEpisodeReleaseInfo,
} from '../lib/animeEpisodes.js';
import {
  buildAniListRating,
  buildMalRating,
  buildTmdbRating,
  createEmptyExternalRatings,
  mergeExternalRatings,
  normalizeExternalRatings,
  parseOmdbRatings,
} from '../lib/ratings.js';
import {
  applyCanonicalIdsToWork,
  mergeIdsBlocks,
  normalizeIdsBlock,
  sanitizeImdbId,
} from '../lib/idBridge.js';
import {
  apiRequest,
  ApiQuotaError,
  getOmdbDailyUsage,
  maskSecretsInText,
  runBoundedConcurrency,
  stripApiKeysFromUrl,
} from '../api/httpClient.js';
import {
  fetchOmdbViaProxyOrDirect,
  fetchTmdbViaProxyOrDirect,
} from './apiProxyClient.js';
import {
  API_TIMEOUT_MS,
  BACKDROP_RETRY_COOLDOWN_MS,
  CACHE_STORES,
  CACHE_TTL_MS,
  OMDB_KEY_STORAGE,
} from '../api/limits.js';
import {
  clearMemoryApiCacheForTests,
  getCachedEntry,
  getEpisodesTtlMs,
  setCachedEntry,
} from '../api/cacheDb.js';
import { fetchAniListBatchByIds } from '../api/anilistBatch.js';
import {
  getRelationalApiCache,
  putRelationalApiCache,
  setApiCacheEntry,
} from './relationalDb.js';
import { migrateFavoriteGenresToObjects } from '../lib/genreCatalog.js';
import { normalizeViewerFocusList } from '../lib/migrations.js';
import { catalogItems } from '../data/mockData.js';
import {
  mapCategoriesToGenreAndSubgenres,
  normalizeLanguageLabel,
} from '../utils/genreMapper.js';

const ANILIST_GRAPHQL_URL = 'https://graphql.anilist.co';
const JIKAN_ANIME_URL = 'https://api.jikan.moe/v4/anime';
const TVMAZE_SEARCH_URL = 'https://api.tvmaze.com/search/shows';
const TVMAZE_SHOW_URL = 'https://api.tvmaze.com/shows';
const TVMAZE_LOOKUP_URL = 'https://api.tvmaze.com/lookup/shows';
const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const TMDB_BACKDROP_BASE = 'https://image.tmdb.org/t/p/w1280';
const OMDB_API_BASE = 'https://www.omdbapi.com';
const IMDB_SUGGESTION_BASE = 'https://v3.sg.media-imdb.com/suggestion';
const WIKIDATA_API_URL = 'https://www.wikidata.org/w/api.php';
const INTERNET_ARCHIVE_SEARCH_URL = 'https://archive.org/advancedsearch.php';

export const TMDB_KEY_STORAGE = 'cine_codice_tmdb_key_v1';
export { API_TIMEOUT_MS, OMDB_KEY_STORAGE };
export const CINEMA_SOURCES_STORAGE_KEY = 'cine_codice_active_sources_v1';
const SEARCH_CACHE_KEY = 'cine_codice_search_cache_v1';
const IDB_SEARCH_CACHE_DB = 'cine_codice_search_cache_idb_v1';
const IDB_SEARCH_CACHE_STORE = 'queries';

const MEMORY_CACHE_TTL_MS = CACHE_TTL_MS.search;
const IDB_SEARCH_CACHE_TTL_MS = CACHE_TTL_MS.search;
const CACHE_MAX_ENTRIES = 80;
const MAX_RESULTS_PER_SOURCE = 10;

export const CINEMA_API_SOURCES = [
  { id: 'anilist', label: 'AniList', hint: 'Animes, relações de franquia, estúdio e pôster HD' },
  { id: 'jikan', label: 'MAL', hint: 'MyAnimeList via Jikan API v4 sem chave' },
  { id: 'tvmaze', label: 'TVmaze', hint: 'Séries com temporadas, episódios e duração sem chave' },
  { id: 'tmdb', label: 'TMDB', hint: 'Filmes e séries (usa VITE_TMDB_API_KEY ou chave local)' },
  { id: 'imdb', label: 'IMDb', hint: 'Sugestões rápidas de filmes e séries sem chave' },
  { id: 'wikidata', label: 'Wikidata', hint: 'Metadados bilíngues abertos de cinema e séries' },
  { id: 'internetArchive', label: 'Archive', hint: 'Clássicos e filmes em domínio público' },
];

const ALL_SOURCE_IDS = CINEMA_API_SOURCES.map((s) => s.id);

export const DEFAULT_SOURCES_BY_FILTER = {
  all: ['tmdb', 'tvmaze', 'imdb', 'anilist', 'jikan', 'wikidata'],
  movie: ['tmdb', 'imdb', 'wikidata', 'internetArchive'],
  series: ['tvmaze', 'tmdb', 'imdb', 'wikidata'],
  anime: ['anilist', 'jikan', 'tmdb'],
};

export const CINEMA_SOURCE_PRESETS = [
  {
    id: 'all',
    label: 'Multi-Fonte',
    filter: 'all',
    sources: [...DEFAULT_SOURCES_BY_FILTER.all],
  },
  {
    id: 'movie',
    label: 'Filmes',
    filter: 'movie',
    sources: [...DEFAULT_SOURCES_BY_FILTER.movie],
  },
  {
    id: 'series',
    label: 'Séries',
    filter: 'series',
    sources: [...DEFAULT_SOURCES_BY_FILTER.series],
  },
  {
    id: 'anime',
    label: 'Animes',
    filter: 'anime',
    sources: [...DEFAULT_SOURCES_BY_FILTER.anime],
  },
];

const TMDB_GENRE_MAP = {
  28: 'Ação & Aventura',
  12: 'Ação & Aventura',
  16: 'Animação',
  35: 'Comédia',
  80: 'Crime & Policial',
  99: 'Documentário',
  18: 'Drama',
  10751: 'Família',
  14: 'Fantasia',
  36: 'Histórico',
  27: 'Terror',
  10402: 'Musical',
  9648: 'Suspense & Thriller',
  10749: 'Romance',
  878: 'Ficção Científica',
  53: 'Suspense & Thriller',
  10752: 'Guerra',
  37: 'Faroeste',
  10759: 'Ação & Aventura',
  10765: 'Ficção Científica',
};

const WIKIDATA_AUDIOVISUAL_TYPES = new Set([
  'Q11424',
  'Q5398426',
  'Q1107',
  'Q202866',
  'Q24856',
  'Q506240',
  'Q21191270',
  'Q226730',
  'Q15416',
]);

export function getDefaultSourcesForFilter(filter = 'all') {
  return [...(DEFAULT_SOURCES_BY_FILTER[filter] || DEFAULT_SOURCES_BY_FILTER.all)];
}

export function sanitizeApiKey(rawKey) {
  return String(rawKey || '')
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/[\r\n\t]+/g, '')
    .trim();
}

export function getEnvTmdbApiKey() {
  try {
    if (!import.meta?.env?.DEV) return '';
    return sanitizeApiKey(import.meta?.env?.VITE_TMDB_API_KEY || '');
  } catch {
    return '';
  }
}

export function loadTmdbApiKey() {
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = sanitizeApiKey(localStorage.getItem(TMDB_KEY_STORAGE));
      if (stored) return stored;
    }
  } catch {
    // Fallback para env em DEV
  }
  return getEnvTmdbApiKey();
}

export function saveTmdbApiKey(rawKey) {
  const clean = sanitizeApiKey(rawKey);
  try {
    if (typeof localStorage === 'undefined') return clean;
    if (clean) {
      localStorage.setItem(TMDB_KEY_STORAGE, clean);
    } else {
      localStorage.removeItem(TMDB_KEY_STORAGE);
    }
  } catch {
    // Ignora falha de quota
  }
  return clean;
}

export function getEnvOmdbApiKey() {
  try {
    if (!import.meta?.env?.DEV) return '';
    return sanitizeApiKey(import.meta?.env?.VITE_OMDB_API_KEY || '');
  } catch {
    return '';
  }
}

export function loadOmdbApiKey() {
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = sanitizeApiKey(localStorage.getItem(OMDB_KEY_STORAGE));
      if (stored) return stored;
    }
  } catch {
    // Fallback para env em DEV
  }
  return getEnvOmdbApiKey();
}

export function saveOmdbApiKey(rawKey) {
  const clean = sanitizeApiKey(rawKey);
  try {
    if (typeof localStorage === 'undefined') return clean;
    if (clean) {
      localStorage.setItem(OMDB_KEY_STORAGE, clean);
    } else {
      localStorage.removeItem(OMDB_KEY_STORAGE);
    }
  } catch {
    // Ignora falha de quota
  }
  return clean;
}

const VALID_SOURCE_IDS = new Set(ALL_SOURCE_IDS);

export function loadActiveCinemaSources(filter = 'all') {
  const fallback = getDefaultSourcesForFilter(filter);
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const raw = localStorage.getItem(CINEMA_SOURCES_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fallback;
    const cleaned = Array.from(new Set(parsed.filter((id) => VALID_SOURCE_IDS.has(id))));
    return cleaned.length > 0 ? cleaned : fallback;
  } catch {
    return fallback;
  }
}

export function saveActiveCinemaSources(sources) {
  try {
    if (typeof localStorage === 'undefined') return;
    const cleaned = Array.from(
      new Set((Array.isArray(sources) ? sources : []).filter((id) => VALID_SOURCE_IDS.has(id)))
    );
    localStorage.setItem(CINEMA_SOURCES_STORAGE_KEY, JSON.stringify(cleaned));
  } catch {
    // Silencioso
  }
}

function stripHtmlTags(raw = '') {
  return String(raw || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeTitleForDedup(title = '') {
  return String(title || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const memoryCache = new Map();

export function clearCinemaSearchCache() {
  memoryCache.clear();
  clearMemoryApiCacheForTests();
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(SEARCH_CACHE_KEY);
    }
  } catch {
    // Silencioso
  }
}

function makeCacheKey(query, filter, sources) {
  const srcToken = Array.isArray(sources) && sources.length ? [...sources].sort().join(',') : 'default';
  return `${filter || 'all'}:${srcToken}:${String(query || '').trim().toLowerCase()}`;
}

export function getCachedCinemaSearch(query, filter = 'all', sources = null) {
  const key = makeCacheKey(query, filter, sources);
  const memHit = memoryCache.get(key);
  if (memHit && Date.now() - Number(memHit.timestamp || 0) < MEMORY_CACHE_TTL_MS) {
    return memHit;
  }
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(SEARCH_CACHE_KEY);
    if (!raw) return null;
    const entries = JSON.parse(raw);
    if (!Array.isArray(entries)) return null;
    const found = entries.find(([k]) => k === key);
    if (!found?.[1]) return null;
    if (Date.now() - Number(found[1].timestamp || 0) >= MEMORY_CACHE_TTL_MS) return null;
    memoryCache.set(key, found[1]);
    return found[1];
  } catch {
    return null;
  }
}

function persistMemoryCacheToLocalStorage() {
  try {
    if (typeof localStorage === 'undefined') return;
    const entries = Array.from(memoryCache.entries()).slice(-CACHE_MAX_ENTRIES);
    localStorage.setItem(SEARCH_CACHE_KEY, JSON.stringify(entries));
  } catch {
    // Ignora quota
  }
}

function setCachedCinemaSearch(query, filter, sources, payload) {
  const key = makeCacheKey(query, filter, sources);
  if (memoryCache.has(key)) memoryCache.delete(key);
  while (memoryCache.size >= CACHE_MAX_ENTRIES) {
    const oldest = memoryCache.keys().next().value;
    if (!oldest) break;
    memoryCache.delete(oldest);
  }
  memoryCache.set(key, { ...payload, timestamp: Date.now() });
  persistMemoryCacheToLocalStorage();
}

function openSearchCacheIdb() {
  if (typeof indexedDB === 'undefined' || typeof indexedDB.open !== 'function') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_SEARCH_CACHE_DB, 1);
      req.onupgradeneeded = () => {
        try {
          const db = req.result;
          if (!db.objectStoreNames.contains(IDB_SEARCH_CACHE_STORE)) {
            db.createObjectStore(IDB_SEARCH_CACHE_STORE, { keyPath: 'key' });
          }
        } catch {
          // Modo privado pode bloquear criação de schema
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

export async function getIdbCachedSearch(key) {
  const safeKey = stripApiKeysFromUrl(key);
  const db = await openSearchCacheIdb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_SEARCH_CACHE_STORE, 'readonly');
      const req = tx.objectStore(IDB_SEARCH_CACHE_STORE).get(safeKey);
      req.onsuccess = () => {
        const rec = req.result;
        try { db.close(); } catch { /* silencioso */ }
        if (!rec || Date.now() - Number(rec.timestamp || 0) >= IDB_SEARCH_CACHE_TTL_MS) {
          resolve(null);
          return;
        }
        resolve(rec);
      };
      req.onerror = () => {
        try { db.close(); } catch { /* silencioso */ }
        resolve(null);
      };
      tx.onabort = () => {
        try { db.close(); } catch { /* silencioso */ }
        resolve(null);
      };
    } catch {
      try { db.close(); } catch { /* silencioso */ }
      resolve(null);
    }
  });
}

export async function setIdbCachedSearch(key, payload) {
  const safeKey = stripApiKeysFromUrl(key);
  const db = await openSearchCacheIdb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_SEARCH_CACHE_STORE, 'readwrite');
      tx.objectStore(IDB_SEARCH_CACHE_STORE).put({
        key: safeKey,
        ...payload,
        timestamp: Date.now(),
      });
      tx.oncomplete = () => {
        try { db.close(); } catch { /* silencioso */ }
        resolve();
      };
      tx.onerror = () => {
        try { db.close(); } catch { /* silencioso */ }
        resolve();
      };
      tx.onabort = () => {
        try { db.close(); } catch { /* silencioso */ }
        resolve();
      };
    } catch {
      try { db.close(); } catch { /* silencioso */ }
      resolve();
    }
  });
}

async function fetchWithTimeout(
  url,
  options = {},
  timeoutMs = API_TIMEOUT_MS,
  fetchImpl = fetch,
  provider = 'generic'
) {
  const {
    method = 'GET',
    headers = undefined,
    body = undefined,
    signal = undefined,
    dedup = true,
    dedupKey = undefined,
    mode = 'auto',
    maxRetries = undefined,
    retryBaseDelayMs = undefined,
    nowFn = undefined,
    sleepFn = undefined,
  } = options || {};

  return apiRequest(url, {
    provider,
    method,
    headers,
    body,
    signal,
    timeoutMs,
    fetchImpl,
    dedup,
    dedupKey,
    mode,
    ...(maxRetries !== undefined ? { maxRetries } : {}),
    ...(retryBaseDelayMs !== undefined ? { retryBaseDelayMs } : {}),
    ...(nowFn ? { nowFn } : {}),
    ...(sleepFn ? { sleepFn } : {}),
  });
}

function parseJikanDurationMinutes(rawDuration) {
  const str = String(rawDuration || '');
  const hourMatch = str.match(/(\d+)\s*hr/);
  const minMatch = str.match(/(\d+)\s*min/);
  const hours = hourMatch ? Number(hourMatch[1]) * 60 : 0;
  const mins = minMatch ? Number(minMatch[1]) : 0;
  const total = hours + mins;
  return total > 0 ? total : null;
}

function buildMonogram(title = '') {
  const words = String(title || '').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${words[0][0]}${words[1][0]}`.toUpperCase();
  return String(title || 'CC').slice(0, 2).toUpperCase();
}

export function normalizeAniListMedia(media) {
  if (!media) return null;
  const title = media.title?.english || media.title?.romaji || media.title?.native || '';
  if (!title) return null;
  const originalTitle = media.title?.romaji || media.title?.native || title;
  const year = media.seasonYear || media.startDate?.year || null;
  const studios = Array.isArray(media.studios?.nodes)
    ? media.studios.nodes.map((s) => s.name).filter(Boolean)
    : [];
  const studio = studios.join(', ');
  const genres = mapCategoriesToGenreAndSubgenres(media.genres || [], { workType: 'anime' }).genres;
  const relations = (Array.isArray(media.relations?.edges) ? media.relations.edges : [])
    .filter((edge) => edge?.node && edge.node.type === 'ANIME')
    .map((edge) => ({
      relationType: edge.relationType,
      anilistId: edge.node.id,
      malId: edge.node.idMal || null,
      title: edge.node.title?.english || edge.node.title?.romaji || edge.node.title?.native || '',
      originalTitle: edge.node.title?.romaji || '',
      format: edge.node.format || 'TV',
      totalEpisodes: edge.node.episodes || null,
      releaseYear: edge.node.seasonYear || null,
      coverUrl: edge.node.coverImage?.large || edge.node.coverImage?.medium || null,
    }))
    .filter((r) => Boolean(r.title));

  const formatMap = {
    MOVIE: 'Filme',
    TV: 'TV',
    TV_SHORT: 'TV',
    OVA: 'OVA',
    ONA: 'ONA',
    SPECIAL: 'Especial',
  };
  const animeFormat = formatMap[media.format] || 'TV';
  const coverUrl = media.coverImage?.extraLarge || media.coverImage?.large || media.coverImage?.medium || null;
  const backdropUrl = media.bannerImage || null;
  const anilistRating = buildAniListRating(media.averageScore);
  const externalRatings = {
    ...createEmptyExternalRatings(),
    anilist: anilistRating,
  };
  const streamingProvidersBR = normalizeBrazilStreamingProviders(
    null,
    media.externalLinks || []
  );
  const episodeReleaseInfo = resolveAnimeEpisodeReleaseInfo(media, {
    source: 'AniList',
  });

  return applyCanonicalIdsToWork({
    id: `anilist-${media.id}`,
    anilistId: media.id,
    malId: media.idMal || null,
    title,
    originalTitle,
    director: studio,
    studio,
    workType: 'anime',
    animeFormat,
    animeStatus: media.status || null,
    streamingProvidersBR,
    nextAiringEpisode: media.nextAiringEpisode || null,
    releaseYear: year,
    totalSeasons: 1,
    totalEpisodes: episodeReleaseInfo.totalEpisodes,
    releasedEpisodesCount: episodeReleaseInfo.releasedEpisodesCount,
    releasedEpisodesSource: episodeReleaseInfo.releasedEpisodesSource,
    releasedEpisodesFetchedAt: episodeReleaseInfo.releasedEpisodesFetchedAt,
    episodeDurationMinutes: Number(media.duration) > 0 ? Number(media.duration) : 24,
    durationMinutes: Number(media.duration) > 0 ? Number(media.duration) : null,
    totalSeconds:
      animeFormat === 'Filme' && Number(media.duration) > 0
        ? Number(media.duration) * 60
        : null,
    genres,
    synopsis: stripHtmlTags(media.description || ''),
    coverUrl,
    backdropUrl,
    coverCandidates: [coverUrl].filter(Boolean),
    franchiseRelations: relations,
    externalScore: media.averageScore || null,
    externalRatings,
    sourceBadge: 'AniList',
    mergedSources: ['AniList'],
    monogram: buildMonogram(title),
  });
}

async function searchAniList(query, { signal, fetchImpl = fetch, timeoutMs = API_TIMEOUT_MS } = {}) {
  const gql = `
    query ($search: String, $perPage: Int) {
      Page(page: 1, perPage: $perPage) {
        media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
          id
          idMal
          title { romaji english native }
          format
          status
          episodes
          duration
          seasonYear
          startDate { year }
          averageScore
          genres
          bannerImage
          description(asHtml: false)
          coverImage { extraLarge large medium }
          studios(isMain: true) { nodes { name } }
          externalLinks { site type }
          nextAiringEpisode { episode airingAt timeUntilAiring }
          relations {
            edges {
              relationType
              node {
                id
                idMal
                type
                format
                status
                episodes
                seasonYear
                title { romaji english native }
                coverImage { large medium }
              }
            }
          }
        }
      }
    }
  `;

  const res = await fetchWithTimeout(
    ANILIST_GRAPHQL_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: gql, variables: { search: query, perPage: MAX_RESULTS_PER_SOURCE } }),
      signal,
    },
    timeoutMs,
    fetchImpl,
    'anilist'
  );

  if (!res.ok) throw new Error(`AniList HTTP ${res.status}`);
  const json = await res.json();
  const list = json?.data?.Page?.media || [];
  return list.map(normalizeAniListMedia).filter(Boolean);
}

async function searchJikan(query, { signal, fetchImpl = fetch, timeoutMs = API_TIMEOUT_MS } = {}) {
  const url = `${JIKAN_ANIME_URL}?q=${encodeURIComponent(query)}&limit=${MAX_RESULTS_PER_SOURCE}&sfw=true`;
  const res = await fetchWithTimeout(url, { signal }, timeoutMs, fetchImpl, 'jikan');
  if (!res.ok) throw new Error(`Jikan HTTP ${res.status}`);
  const json = await res.json();
  const list = Array.isArray(json?.data) ? json.data : [];

  return list
    .map((entry) => {
      const title = entry.title_english || entry.title || '';
      if (!title) return null;
      const originalTitle = entry.title || entry.title_japanese || title;
      const studio = Array.isArray(entry.studios)
        ? entry.studios.map((s) => s.name).filter(Boolean).join(', ')
        : '';
      const rawGenres = [
        ...(Array.isArray(entry.genres) ? entry.genres.map((g) => g.name) : []),
        ...(Array.isArray(entry.themes) ? entry.themes.map((t) => t.name) : []),
      ];
      const coverUrl =
        entry.images?.webp?.large_image_url ||
        entry.images?.jpg?.large_image_url ||
        entry.images?.jpg?.image_url ||
        null;
      const durMin = parseJikanDurationMinutes(entry.duration);
      const animeFormat = entry.type === 'Movie' ? 'Filme' : entry.type || 'TV';
      const malRating = buildMalRating(entry.score);

      return applyCanonicalIdsToWork({
        id: `mal-${entry.mal_id}`,
        malId: entry.mal_id,
        title,
        originalTitle,
        director: studio,
        studio,
        workType: 'anime',
        animeFormat,
        releaseYear: entry.year || entry.aired?.prop?.from?.year || null,
        totalSeasons: 1,
        totalEpisodes: Number(entry.episodes) > 0 ? Number(entry.episodes) : null,
        episodeDurationMinutes: durMin || 24,
        durationMinutes: durMin,
        totalSeconds: animeFormat === 'Filme' && durMin ? durMin * 60 : null,
        genres: mapCategoriesToGenreAndSubgenres(rawGenres, { workType: 'anime' }).genres,
        synopsis: stripHtmlTags(entry.synopsis || ''),
        coverUrl,
        coverCandidates: [coverUrl].filter(Boolean),
        externalRatings: {
          ...createEmptyExternalRatings(),
          mal: malRating,
        },
        sourceBadge: 'MAL',
        mergedSources: ['MAL'],
        monogram: buildMonogram(title),
      });
    })
    .filter(Boolean);
}

async function searchTvMaze(query, { signal, fetchImpl = fetch, timeoutMs = API_TIMEOUT_MS } = {}) {
  const url = `${TVMAZE_SEARCH_URL}?q=${encodeURIComponent(query)}`;
  const res = await fetchWithTimeout(url, { signal }, timeoutMs, fetchImpl, 'tvmaze');
  if (!res.ok) throw new Error(`TVmaze HTTP ${res.status}`);
  const list = await res.json();
  if (!Array.isArray(list)) return [];

  return list
    .slice(0, MAX_RESULTS_PER_SOURCE)
    .map((row) => {
      const show = row?.show;
      if (!show?.name) return null;
      const year = show.premiered ? Number(String(show.premiered).slice(0, 4)) : null;
      const runtime = Number(show.averageRuntime || show.runtime) || null;
      const network = show.network?.name || show.webChannel?.name || '';
      const coverUrl = show.image?.original || show.image?.medium || null;
      const isAnime =
        String(show.type || '').toLowerCase() === 'animation' &&
        String(show.language || '').toLowerCase() === 'japanese';

      return applyCanonicalIdsToWork({
        id: `tvmaze-${show.id}`,
        tvmazeId: show.id,
        imdbId: show.externals?.imdb || '',
        title: show.name,
        originalTitle: show.name,
        director: network,
        studio: network,
        workType: isAnime ? 'anime' : 'series',
        releaseYear: Number.isFinite(year) ? year : null,
        episodeDurationMinutes: runtime || 45,
        durationMinutes: runtime,
        genres: mapCategoriesToGenreAndSubgenres(show.genres || [], {
          workType: isAnime ? 'anime' : 'series',
        }).genres,
        language: normalizeLanguageLabel(show.language || ''),
        synopsis: stripHtmlTags(show.summary || ''),
        coverUrl,
        coverCandidates: [coverUrl].filter(Boolean),
        sourceBadge: 'TVmaze',
        mergedSources: ['TVmaze'],
        monogram: buildMonogram(show.name),
      });
    })
    .filter(Boolean);
}

export async function fetchTvMazeShowDetails(
  tvmazeId,
  {
    signal,
    fetchImpl = fetch,
    timeoutMs = API_TIMEOUT_MS,
    showStatus = '',
    allowStaleOffline = false,
  } = {}
) {
  if (!tvmazeId) return null;
  const cacheKey = `tvmaze:episodes:${tvmazeId}`;
  const cached = await getCachedEntry(CACHE_STORES.episodes, cacheKey, { allowStaleOffline });
  if (cached.hit && !cached.stale) {
    return cached.data;
  }

  try {
    const [seasonsRes, episodesRes, showRes] = await runBoundedConcurrency(
      [
        () => fetchWithTimeout(`${TVMAZE_SHOW_URL}/${tvmazeId}/seasons`, { signal }, timeoutMs, fetchImpl, 'tvmaze'),
        () => fetchWithTimeout(`${TVMAZE_SHOW_URL}/${tvmazeId}/episodes`, { signal }, timeoutMs, fetchImpl, 'tvmaze'),
        () =>
          fetchWithTimeout(`${TVMAZE_SHOW_URL}/${tvmazeId}?embed=nextepisode`, { signal }, timeoutMs, fetchImpl, 'tvmaze').catch(
            () => null
          ),
      ],
      2
    );
    const seasons = seasonsRes.ok ? await seasonsRes.json() : [];
    const episodes = episodesRes.ok ? await episodesRes.json() : [];
    const showData = showRes?.ok ? await showRes.json() : null;
    const validSeasonsList = Array.isArray(seasons)
      ? seasons.filter((s) => Number(s?.number) > 0)
      : [];

    if (
      (!Array.isArray(episodes) || episodes.length === 0) &&
      validSeasonsList.length === 0
    ) {
      return cached.hit ? { ...cached.data, isOfflineCache: true, cacheDateLabel: cached.cacheDateLabel } : null;
    }

    const bySeason = new Map();
    const episodeList = [];
    let durationSum = 0;
    let durationCount = 0;

    if (Array.isArray(episodes)) {
      episodes.forEach((ep) => {
        const sNum = Math.max(1, Number(ep.season) || 1);
        bySeason.set(sNum, (bySeason.get(sNum) || 0) + 1);
        const runtime = Number(ep.runtime) || null;
        if (runtime) {
          durationSum += runtime;
          durationCount += 1;
        }
        episodeList.push({
          season: sNum,
          number: Number(ep.number) || 1,
          name: ep.name || `Episódio ${ep.number || ''}`,
          runtime,
          airdate: ep.airdate || '',
          airstamp: ep.airstamp || '',
          imageUrl: ep.image?.medium || ep.image?.original || null,
          summary: stripHtmlTags(ep.summary || ''),
          rating:
            ep.rating?.average !== null &&
            ep.rating?.average !== undefined &&
            Number(ep.rating.average) > 0
              ? Number(ep.rating.average)
              : null,
        });
      });
    }

    const maxSeason = Math.max(
      validSeasonsList.length,
      Array.isArray(seasons) ? seasons.length : 0,
      ...Array.from(bySeason.keys()),
      1
    );
    const episodesPerSeason = [];
    for (let s = 1; s <= maxSeason; s += 1) {
      const seasonRow = validSeasonsList.find((row) => Number(row.number) === s);
      const countFromSeason = Number(seasonRow?.episodeOrder) || 0;
      episodesPerSeason.push(bySeason.get(s) || countFromSeason || 12);
    }

    const nextEpRaw = showData?._embedded?.nextepisode || null;
    const nextEpisode = nextEpRaw
      ? {
          season: Number(nextEpRaw.season) || null,
          number: Number(nextEpRaw.number) || null,
          name: nextEpRaw.name || null,
          airdate: nextEpRaw.airdate || null,
          airstamp: nextEpRaw.airstamp || null,
        }
      : null;

    const resolvedStatus = showData?.status || showStatus || '';
    const totalEpisodes =
      episodes.length > 0
        ? episodes.length
        : episodesPerSeason.reduce((acc, n) => acc + n, 0);

    const result = {
      totalSeasons: maxSeason,
      totalEpisodes,
      episodesPerSeason,
      episodeList,
      episodeDurationMinutes: durationCount > 0 ? Math.round(durationSum / durationCount) : null,
      showStatus: resolvedStatus || null,
      nextEpisode,
    };

    const ttlMs = getEpisodesTtlMs(resolvedStatus);
    await setCachedEntry(CACHE_STORES.episodes, cacheKey, result, { ttlMs });
    setApiCacheEntry(cacheKey, result, { ttlMs }).catch(() => {});

    return result;
  } catch {
    if (cached.hit) {
      return { ...cached.data, isOfflineCache: true, cacheDateLabel: cached.cacheDateLabel };
    }
    return null;
  }
}

async function searchTmdb(
  query,
  {
    filter = 'all',
    apiKey = '',
    signal,
    fetchImpl = fetch,
    timeoutMs = API_TIMEOUT_MS,
    accessToken = '',
    supabaseClient = null,
    forceProxy = null,
    isDev = undefined,
  } = {}
) {
  const key = apiKey === null ? '' : sanitizeApiKey(apiKey) || loadTmdbApiKey();

  const tmdbPath =
    filter === 'movie'
      ? 'search/movie'
      : filter === 'series'
        ? 'search/tv'
        : 'search/multi';

  const outcome = await fetchTmdbViaProxyOrDirect(
    tmdbPath,
    {
      language: 'pt-BR',
      include_adult: 'false',
      query,
    },
    {
      directApiKey: key,
      signal,
      fetchImpl,
      timeoutMs,
      accessToken,
      supabaseClient,
      forceProxy,
      ...(isDev !== undefined ? { isDev } : {}),
    }
  );
  if (outcome.missingKey || !outcome.res) return [];
  const res = outcome.res;
  if (!res.ok) throw new Error(`TMDB HTTP ${res.status}`);
  const json = await res.json();
  const list = Array.isArray(json?.results) ? json.results : [];

  return list
    .filter((r) => {
      const mType = r.media_type || (filter === 'series' ? 'tv' : 'movie');
      return mType === 'movie' || mType === 'tv';
    })
    .slice(0, MAX_RESULTS_PER_SOURCE)
    .map((r) => {
      const mType = r.media_type || (filter === 'series' ? 'tv' : 'movie');
      const title = r.title || r.name || '';
      if (!title) return null;
      const originalTitle = r.original_title || r.original_name || title;
      const dateStr = r.release_date || r.first_air_date || '';
      const year = dateStr ? Number(String(dateStr).slice(0, 4)) : null;
      const hasAnimation = Array.isArray(r.genre_ids) && r.genre_ids.includes(16);
      const isJp =
        r.original_language === 'ja' ||
        (Array.isArray(r.origin_country) && r.origin_country.includes('JP'));
      const isAnime = hasAnimation && isJp;
      const workType = isAnime ? 'anime' : mType === 'tv' ? 'series' : 'movie';
      const rawGenres = (Array.isArray(r.genre_ids) ? r.genre_ids : [])
        .map((gid) => TMDB_GENRE_MAP[gid])
        .filter(Boolean);
      const coverUrl = r.poster_path ? `https://image.tmdb.org/t/p/w500${r.poster_path}` : null;
      const backdropUrl = r.backdrop_path ? `${TMDB_BACKDROP_BASE}${r.backdrop_path}` : null;
      const tmdbRating = buildTmdbRating(r.vote_average, r.vote_count);

      return applyCanonicalIdsToWork({
        id: `tmdb-${mType}-${r.id}`,
        tmdbId: r.id,
        tmdbMediaType: mType,
        title,
        originalTitle,
        workType,
        releaseYear: Number.isFinite(year) ? year : null,
        genres: mapCategoriesToGenreAndSubgenres(rawGenres, { workType }).genres,
        genreIds: Array.isArray(r.genre_ids) ? r.genre_ids : [],
        hasTmdbAnimationGenre: hasAnimation,
        originCountry: Array.isArray(r.origin_country) ? r.origin_country : isJp ? ['JP'] : [],
        language: normalizeLanguageLabel(r.original_language || ''),
        synopsis: String(r.overview || '').trim(),
        coverUrl,
        backdropUrl,
        coverCandidates: [coverUrl].filter(Boolean),
        externalScore: r.vote_average ? Math.round(r.vote_average * 10) : null,
        externalRatings: {
          ...createEmptyExternalRatings(),
          tmdb: tmdbRating,
        },
        sourceBadge: 'TMDB',
        mergedSources: ['TMDB'],
        monogram: buildMonogram(title),
      });
    })
    .filter(Boolean);
}

async function fetchTmdbDetailsInternal(
  tmdbId,
  mediaType = 'movie',
  {
    apiKey = '',
    signal,
    fetchImpl = fetch,
    timeoutMs = API_TIMEOUT_MS,
    allowStaleOffline = true,
    forceRefresh = false,
    nowFn = Date.now,
    accessToken = '',
    supabaseClient = null,
    forceProxy = null,
    isDev = undefined,
  } = {}
) {
  if (!tmdbId) return { ok: false, status: 'MISSING_ID', data: null };
  const type = mediaType === 'tv' ? 'tv' : 'movie';
  const cacheKey = `tmdb:${type}:${tmdbId}`;
  const now = nowFn();

  const cached = forceRefresh
    ? { hit: false, stale: false, data: null }
    : await getCachedEntry(CACHE_STORES.ratings, cacheKey, {
        now,
        allowStaleOffline,
      });

  if (cached.hit && !cached.stale && cached.data) {
    return {
      ok: true,
      status: 'CACHE_HIT',
      fromCache: true,
      isOfflineCache: false,
      cacheDateLabel: cached.cacheDateLabel,
      data: cached.data,
    };
  }

  const key = apiKey === null ? '' : sanitizeApiKey(apiKey) || loadTmdbApiKey();

  try {
    const outcome = await fetchTmdbViaProxyOrDirect(
      `${type}/${encodeURIComponent(tmdbId)}`,
      {
        language: 'pt-BR',
        append_to_response: 'credits,external_ids,watch/providers',
      },
      {
        directApiKey: key,
        signal,
        fetchImpl,
        timeoutMs,
        nowFn,
        accessToken,
        supabaseClient,
        forceProxy,
        ...(isDev !== undefined ? { isDev } : {}),
      }
    );
    if (outcome.missingKey || !outcome.res) {
      if (cached.hit && allowStaleOffline && cached.data) {
        return {
          ok: true,
          status: 'OFFLINE_CACHE',
          fromCache: true,
          isOfflineCache: true,
          cacheDateLabel: cached.cacheDateLabel,
          data: cached.data,
        };
      }
      return { ok: false, status: 'MISSING_KEY', data: null };
    }
    const res = outcome.res;
    if (!res.ok) {
      throw new Error(`TMDB HTTP ${res.status}`);
    }
    const d = await res.json();

    const directors = Array.isArray(d.credits?.crew)
      ? d.credits.crew
          .filter((c) => c.job === 'Director')
          .map((c) => c.name)
          .slice(0, 2)
      : [];
    const creators = Array.isArray(d.created_by)
      ? d.created_by.map((c) => c.name).slice(0, 2)
      : [];
    const cast = Array.isArray(d.credits?.cast)
      ? d.credits.cast.slice(0, 5).map((c) => c.name).join(', ')
      : '';
    const studios = Array.isArray(d.production_companies)
      ? d.production_companies.slice(0, 2).map((p) => p.name).join(', ')
      : '';

    const imdbId = sanitizeImdbId(d.external_ids?.imdb_id || d.imdb_id) || '';
    const backdropUrl = d.backdrop_path ? `${TMDB_BACKDROP_BASE}${d.backdrop_path}` : null;
    const fetchedAt = nowFn();
    const tmdbRating = buildTmdbRating(d.vote_average, d.vote_count, fetchedAt);
    const ids = normalizeIdsBlock({
      tmdbId: d.id || tmdbId,
      imdbId,
    });
    const externalRatings = {
      ...createEmptyExternalRatings(),
      tmdb: tmdbRating,
    };
    const streamingProvidersBR = normalizeBrazilStreamingProviders(
      d['watch/providers']?.results?.BR || d.watchProviders?.results?.BR || null
    );

    let details;
    if (type === 'movie') {
      const runtime = Number(d.runtime) || null;
      const col = d.belongs_to_collection || null;
      details = {
        ids,
        tmdbId: ids.tmdb,
        imdbId: ids.imdb || '',
        backdropUrl,
        durationMinutes: runtime,
        totalSeconds: runtime ? runtime * 60 : null,
        director: directors.join(', ') || studios,
        studio: studios,
        cast,
        belongsToCollection: col?.id
          ? {
              id: Number(col.id),
              name: String(col.name || '').trim(),
              posterPath: col.poster_path || null,
              backdropPath: col.backdrop_path || null,
            }
          : null,
        franchiseName: col?.name?.replace(/\s*Collection$/i, '').trim() || '',
        tmdbStatus: d.status || null,
        streamingProvidersBR,
        externalRatings,
        synopsis: String(d.overview || '').trim(),
      };
    } else {
      const epRun = Array.isArray(d.episode_run_time) && d.episode_run_time[0]
        ? Number(d.episode_run_time[0])
        : null;
      const validSeasons = Array.isArray(d.seasons)
        ? d.seasons.filter((s) => Number(s.season_number) > 0)
        : [];
      const episodesPerSeason = validSeasons.map((s) => Math.max(1, Number(s.episode_count) || 1));

      details = {
        ids,
        tmdbId: ids.tmdb,
        imdbId: ids.imdb || '',
        backdropUrl,
        totalSeasons: Number(d.number_of_seasons) || validSeasons.length || 1,
        totalEpisodes: Number(d.number_of_episodes) || null,
        episodesPerSeason,
        episodeDurationMinutes: epRun || 45,
        director: creators.join(', ') || studios,
        studio: studios,
        cast,
        tmdbStatus: d.status || null,
        streamingProvidersBR,
        nextEpisodeToAir: d.next_episode_to_air || null,
        originCountry: Array.isArray(d.origin_country) ? d.origin_country : [],
        externalRatings,
        synopsis: String(d.overview || '').trim(),
      };
    }

    await setCachedEntry(CACHE_STORES.ratings, cacheKey, details, {
      ttlMs: CACHE_TTL_MS.ratings,
      now: fetchedAt,
    });

    return {
      ok: true,
      status: 'OK',
      fromCache: false,
      isOfflineCache: false,
      cacheDateLabel: '',
      data: details,
    };
  } catch (err) {
    if (cached.hit && allowStaleOffline && cached.data) {
      return {
        ok: true,
        status: 'OFFLINE_CACHE',
        fromCache: true,
        isOfflineCache: true,
        cacheDateLabel: cached.cacheDateLabel,
        data: cached.data,
      };
    }
    return {
      ok: false,
      status: maskSecretsInText(err?.code || err?.message || 'TMDB_ERROR', [key]),
      data: null,
    };
  }
}

export async function fetchTmdbDetails(
  tmdbId,
  mediaType = 'movie',
  options = {}
) {
  const res = await fetchTmdbDetailsInternal(tmdbId, mediaType, options);
  return res.ok ? res.data : null;
}

async function searchImdbSuggestion(
  query,
  { signal, fetchImpl = fetch, timeoutMs = API_TIMEOUT_MS } = {}
) {
  const asciiQuery = String(query || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const firstCharMatch = asciiQuery.match(/[a-z0-9]/);
  const firstChar = firstCharMatch ? firstCharMatch[0] : 'x';
  const slug = asciiQuery.replace(/\s+/g, '_').slice(0, 60);
  if (!slug) return [];

  const url = `${IMDB_SUGGESTION_BASE}/${firstChar}/${encodeURIComponent(slug)}.json`;
  const res = await fetchWithTimeout(url, { signal }, timeoutMs, fetchImpl, 'imdb');
  if (!res.ok) throw new Error(`IMDb HTTP ${res.status}`);
  const json = await res.json();
  const list = Array.isArray(json?.d) ? json.d : [];

  return list
    .filter((row) => row?.id && String(row.id).startsWith('tt') && row.l && !/game/i.test(String(row.q || '')))
    .slice(0, MAX_RESULTS_PER_SOURCE)
    .map((row) => {
      const qType = String(row.q || '').toLowerCase();
      const workType = /tv series|tv mini-series|series/.test(qType) ? 'series' : 'movie';
      const coverUrl = row.i?.imageUrl || null;
      return applyCanonicalIdsToWork({
        id: `imdb-${row.id}`,
        imdbId: row.id,
        title: String(row.l).trim(),
        originalTitle: String(row.l).trim(),
        cast: String(row.s || '').trim(),
        workType,
        releaseYear: Number(row.y) || null,
        genres: [],
        coverUrl,
        coverCandidates: [coverUrl].filter(Boolean),
        sourceBadge: 'IMDb',
        mergedSources: ['IMDb'],
        monogram: buildMonogram(row.l),
      });
    });
}

async function searchWikidataCinema(
  query,
  { signal, fetchImpl = fetch, timeoutMs = API_TIMEOUT_MS } = {}
) {
  const searchUrl = `${WIKIDATA_API_URL}?action=wbsearchentities&search=${encodeURIComponent(query)}&language=pt&uselang=pt&format=json&origin=*&limit=6`;
  const res = await fetchWithTimeout(searchUrl, { signal }, timeoutMs, fetchImpl, 'wikidata');
  if (!res.ok) throw new Error(`Wikidata HTTP ${res.status}`);
  const searchJson = await res.json();
  const candidates = Array.isArray(searchJson?.search) ? searchJson.search : [];
  if (candidates.length === 0) return [];

  const ids = candidates.map((c) => c.id).join('|');
  const entityUrl = `${WIKIDATA_API_URL}?action=wbgetentities&ids=${encodeURIComponent(ids)}&props=labels|descriptions|claims&languages=pt|en|ja&format=json&origin=*`;
  const entityRes = await fetchWithTimeout(entityUrl, { signal }, timeoutMs, fetchImpl, 'wikidata');
  if (!entityRes.ok) return [];
  const entityJson = await entityRes.json();
  const entities = entityJson?.entities || {};

  const out = [];
  for (const cand of candidates) {
    const ent = entities[cand.id];
    if (!ent) continue;
    const p31 = (ent.claims?.P31 || []).map((c) => c.mainsnak?.datavalue?.value?.id).filter(Boolean);
    const descPt = String(ent.descriptions?.pt?.value || '').trim();
    const descEn = String(ent.descriptions?.en?.value || '').trim();
    const descBlob = `${descPt} ${descEn}`.toLowerCase();
    const isAudiovisual =
      p31.some((q) => WIKIDATA_AUDIOVISUAL_TYPES.has(q)) ||
      /\b(filme|film|movie|série|series|anime|animação|animation|minissérie)\b/i.test(descBlob);

    if (!isAudiovisual) continue;

    const titlePt = ent.labels?.pt?.value || ent.labels?.en?.value || cand.label || '';
    const origTitle = ent.labels?.en?.value || ent.labels?.ja?.value || titlePt;
    if (!titlePt) continue;

    const isAnime = p31.includes('Q1107') || p31.includes('Q21191270') || /\banime\b/i.test(descBlob);
    const isSeries = p31.includes('Q5398426') || p31.includes('Q15416') || /\bs[eé]rie\b/i.test(descBlob);
    const workType = isAnime ? 'anime' : isSeries ? 'series' : 'movie';

    const dateRaw = ent.claims?.P577?.[0]?.mainsnak?.datavalue?.value?.time || '';
    const yearMatch = String(dateRaw).match(/^\+?(\d{4})/);
    const year = yearMatch ? Number(yearMatch[1]) : null;
    const durRaw = ent.claims?.P2047?.[0]?.mainsnak?.datavalue?.value?.amount;
    const durationMinutes = durRaw ? Math.round(Number(String(durRaw).replace(/^\+/, ''))) : null;
    const imdbId = ent.claims?.P345?.[0]?.mainsnak?.datavalue?.value || '';

    out.push({
      id: `wd-${cand.id}`,
      wikidataId: cand.id,
      imdbId,
      title: titlePt,
      originalTitle: origTitle,
      workType,
      releaseYear: year,
      durationMinutes: durationMinutes > 0 ? durationMinutes : null,
      totalSeconds: workType === 'movie' && durationMinutes > 0 ? durationMinutes * 60 : null,
      synopsis: descPt || descEn,
      genres: [],
      coverUrl: null,
      coverCandidates: [],
      sourceBadge: 'Wikidata',
      mergedSources: ['Wikidata'],
      monogram: buildMonogram(titlePt),
    });
  }
  return out;
}

async function searchInternetArchiveMovies(
  query,
  { signal, fetchImpl = fetch, timeoutMs = API_TIMEOUT_MS } = {}
) {
  const safeQ = String(query || '').replace(/[()":]/g, ' ').trim();
  if (!safeQ) return [];
  const qExpr = `title:(${safeQ}) AND mediatype:(movies)`;
  const params = new URLSearchParams({
    q: qExpr,
    rows: '6',
    page: '1',
    output: 'json',
  });
  params.append('fl[]', 'identifier');
  params.append('fl[]', 'title');
  params.append('fl[]', 'creator');
  params.append('fl[]', 'year');
  params.append('fl[]', 'description');

  const url = `${INTERNET_ARCHIVE_SEARCH_URL}?${params.toString()}`;
  const res = await fetchWithTimeout(url, { signal }, timeoutMs, fetchImpl, 'internetArchive');
  if (!res.ok) throw new Error(`Internet Archive HTTP ${res.status}`);
  const json = await res.json();
  const docs = Array.isArray(json?.response?.docs) ? json.response.docs : [];

  return docs
    .filter((d) => d?.identifier && d?.title)
    .map((d) => {
      const title = Array.isArray(d.title) ? d.title[0] : String(d.title);
      const director = Array.isArray(d.creator) ? d.creator.join(', ') : String(d.creator || '');
      const year = d.year ? Number(String(d.year).slice(0, 4)) : null;
      const desc = Array.isArray(d.description) ? d.description[0] : String(d.description || '');
      const coverUrl = `https://archive.org/services/img/${encodeURIComponent(d.identifier)}`;
      return {
        id: `ia-${d.identifier}`,
        title: title.trim(),
        originalTitle: title.trim(),
        director: director.trim(),
        workType: 'movie',
        releaseYear: Number.isFinite(year) && year > 1880 ? year : null,
        synopsis: stripHtmlTags(desc).slice(0, 450),
        genres: ['Clássicos'],
        coverUrl,
        coverCandidates: [coverUrl],
        openAccessUrl: `https://archive.org/details/${encodeURIComponent(d.identifier)}`,
        isPublicDomain: true,
        sourceBadge: 'Archive',
        mergedSources: ['Archive'],
        monogram: buildMonogram(title),
      };
    });
}

function mergeTwoCandidates(primary, incoming) {
  const coverCandidates = Array.from(
    new Set([
      ...(primary.coverCandidates || []),
      primary.coverUrl,
      ...(incoming.coverCandidates || []),
      incoming.coverUrl,
    ].filter(Boolean))
  );
  const mergedSources = Array.from(
    new Set([...(primary.mergedSources || [primary.sourceBadge]), ...(incoming.mergedSources || [incoming.sourceBadge])].filter(Boolean))
  );
  const genres = Array.from(
    new Set([...(primary.genres || []), ...(incoming.genres || [])].filter(Boolean))
  ).slice(0, 4);

  const longerSynopsis =
    String(incoming.synopsis || '').length > String(primary.synopsis || '').length
      ? incoming.synopsis
      : primary.synopsis;

  const mergedIds = mergeIdsBlocks(primary, incoming);
  const mergedRatings = mergeExternalRatings(incoming.externalRatings, primary.externalRatings);

  return applyCanonicalIdsToWork({
    ...incoming,
    ...primary,
    ids: mergedIds,
    originalTitle: primary.originalTitle || incoming.originalTitle || primary.title,
    director: primary.director || incoming.director || '',
    studio: primary.studio || incoming.studio || '',
    cast: primary.cast || incoming.cast || '',
    releaseYear: primary.releaseYear || incoming.releaseYear || null,
    totalEpisodes: primary.totalEpisodes || incoming.totalEpisodes || null,
    totalSeasons: Math.max(Number(primary.totalSeasons) || 1, Number(incoming.totalSeasons) || 1),
    durationMinutes: primary.durationMinutes || incoming.durationMinutes || null,
    totalSeconds: primary.totalSeconds || incoming.totalSeconds || null,
    episodeDurationMinutes: primary.episodeDurationMinutes || incoming.episodeDurationMinutes || null,
    anilistId: mergedIds.anilist,
    malId: mergedIds.mal,
    tvmazeId: mergedIds.tvmaze,
    tmdbId: mergedIds.tmdb,
    tmdbMediaType: primary.tmdbMediaType || incoming.tmdbMediaType || null,
    imdbId: mergedIds.imdb || '',
    openAccessUrl: primary.openAccessUrl || incoming.openAccessUrl || '',
    franchiseRelations:
      Array.isArray(primary.franchiseRelations) && primary.franchiseRelations.length > 0
        ? primary.franchiseRelations
        : incoming.franchiseRelations || [],
    genres,
    synopsis: longerSynopsis || '',
    coverUrl: coverCandidates[0] || null,
    backdropUrl: primary.backdropUrl || incoming.backdropUrl || null,
    coverCandidates,
    externalRatings: mergedRatings,
    sourceBadge: primary.sourceBadge || mergedSources[0],
    mergedSources,
  });
}

function hasConflictingExternalIds(a = {}, b = {}) {
  const keys = [
    ['tmdbId', a.ids?.tmdb ?? a.tmdbId, b.ids?.tmdb ?? b.tmdbId],
    ['imdbId', a.ids?.imdb ?? a.imdbId, b.ids?.imdb ?? b.imdbId],
    ['anilistId', a.ids?.anilist ?? a.anilistId, b.ids?.anilist ?? b.anilistId],
    ['malId', a.ids?.mal ?? a.malId, b.ids?.mal ?? b.malId],
    ['tvmazeId', a.ids?.tvmaze ?? a.tvmazeId, b.ids?.tvmaze ?? b.tvmazeId],
  ];
  for (const [, va, vb] of keys) {
    if (va && vb && String(va).toLowerCase() !== String(vb).toLowerCase()) {
      return true;
    }
  }
  const ya = Number(a.releaseYear) || 0;
  const yb = Number(b.releaseYear) || 0;
  if (ya > 0 && yb > 0 && Math.abs(ya - yb) >= 2) return true;
  if (a.workType && b.workType && a.workType !== b.workType) {
    const bothSeriesLike =
      (a.workType === 'series' || a.workType === 'anime') &&
      (b.workType === 'series' || b.workType === 'anime');
    if (!bothSeriesLike) return true;
  }
  return false;
}

export function deduplicateCinemaResults(items = []) {
  const byExactKey = new Map();
  const normNoYear = new Map();

  for (const item of items) {
    if (!item?.title) continue;
    const normTitle = normalizeTitleForDedup(item.title);
    const normOrig = normalizeTitleForDedup(item.originalTitle || '');
    if (!normTitle) continue;

    const year = Number(item.releaseYear) || 0;
    const exactKey = year > 0 ? `${normTitle}::${year}` : null;
    const origKey = year > 0 && normOrig ? `${normOrig}::${year}` : null;
    const looseKey = `${normTitle}::${item.workType || 'movie'}`;

    let existingKey = null;
    if (exactKey && byExactKey.has(exactKey)) {
      existingKey = exactKey;
    } else if (origKey && byExactKey.has(origKey)) {
      existingKey = origKey;
    } else if (!year && normNoYear.has(looseKey)) {
      existingKey = normNoYear.get(looseKey);
    } else if (year && normNoYear.has(looseKey)) {
      const candidateKey = normNoYear.get(looseKey);
      const existing = byExactKey.get(candidateKey);
      if (existing && !existing.releaseYear) {
        existingKey = candidateKey;
      }
    }

    if (existingKey) {
      const existing = byExactKey.get(existingKey);
      if (hasConflictingExternalIds(existing, item)) {
        const distinctKey = `${exactKey || looseKey}::${byExactKey.size}`;
        byExactKey.set(distinctKey, item);
      } else {
        const merged = mergeTwoCandidates(existing, item);
        byExactKey.set(existingKey, merged);
      }
    } else {
      const storedKey = exactKey || `${normTitle}::${item.workType || 'movie'}::${byExactKey.size}`;
      byExactKey.set(storedKey, item);
      if (!normNoYear.has(looseKey)) {
        normNoYear.set(looseKey, storedKey);
      }
    }
  }

  return Array.from(byExactKey.values());
}

export function searchMockCinema(query = '', filter = 'all') {
  const clean = String(query || '').trim().toLowerCase();
  return catalogItems.filter((item) => {
    if (filter !== 'all' && item.workType !== filter) return false;
    if (!clean) return true;
    const haystack = [
      item.title,
      item.originalTitle,
      item.director,
      item.studio,
      ...(item.genres || []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(clean);
  });
}

export async function searchCinemaMedia(
  query,
  {
    filter = 'all',
    sources = null,
    tmdbApiKey = '',
    signal,
    fetchImpl = fetch,
    timeoutMs = API_TIMEOUT_MS,
    skipCache = false,
    accessToken = '',
    supabaseClient = null,
    forceProxy = null,
    isDev = undefined,
    onPartialResults = null,
  } = {}
) {
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) {
    return {
      results: searchMockCinema('', filter),
      failedSources: [],
      failedCount: 0,
      partialFailure: false,
      allFailed: false,
      fromCache: false,
    };
  }

  const activeSources =
    Array.isArray(sources) && sources.length > 0
      ? sources.filter((id) => VALID_SOURCE_IDS.has(id))
      : getDefaultSourcesForFilter(filter);

  const cacheKey = makeCacheKey(cleanQuery, filter, activeSources);

  if (!skipCache) {
    const memCached = getCachedCinemaSearch(cleanQuery, filter, activeSources);
    if (memCached) {
      return { ...memCached, fromCache: true };
    }
    const idbCached = await getIdbCachedSearch(cacheKey);
    if (idbCached?.results) {
      const payload = {
        results: idbCached.results,
        failedSources: idbCached.failedSources || [],
        failedCount: idbCached.failedCount || 0,
        partialFailure: Boolean(idbCached.partialFailure),
        allFailed: false,
      };
      setCachedCinemaSearch(cleanQuery, filter, activeSources, payload);
      return { ...payload, fromCache: true };
    }
  }

  const sourceFetchers = {
    anilist: () => searchAniList(cleanQuery, { signal, fetchImpl, timeoutMs }),
    jikan: () => searchJikan(cleanQuery, { signal, fetchImpl, timeoutMs }),
    tvmaze: () => searchTvMaze(cleanQuery, { signal, fetchImpl, timeoutMs }),
    tmdb: () =>
      searchTmdb(cleanQuery, {
        filter,
        apiKey: tmdbApiKey,
        signal,
        fetchImpl,
        timeoutMs,
        accessToken,
        supabaseClient,
        forceProxy,
        isDev,
      }),
    imdb: () => searchImdbSuggestion(cleanQuery, { signal, fetchImpl, timeoutMs }),
    wikidata: () => searchWikidataCinema(cleanQuery, { signal, fetchImpl, timeoutMs }),
    internetArchive: () => searchInternetArchiveMovies(cleanQuery, { signal, fetchImpl, timeoutMs }),
  };

  const filterCinemaByType = (rawList) =>
    filter === 'all'
      ? rawList
      : rawList.filter((item) => {
          if (filter === 'anime') return item.workType === 'anime';
          if (filter === 'series') return item.workType === 'series' || item.workType === 'anime';
          return item.workType === 'movie';
        });

  const runners = activeSources
    .filter((id) => typeof sourceFetchers[id] === 'function')
    .map((id) => ({ id, promise: sourceFetchers[id]() }));

  if (typeof onPartialResults === 'function' && runners.length > 0) {
    const streamedCollected = [];
    const streamedSources = new Set();
    let remaining = runners.length;

    runners.forEach((runner) => {
      runner.promise
        .then((items) => {
          remaining = Math.max(0, remaining - 1);
          if (signal?.aborted) return;
          if (Array.isArray(items) && items.length > 0) {
            streamedCollected.push(...items);
            streamedSources.add(runner.id);
            const partialResults = deduplicateCinemaResults(
              filterCinemaByType(streamedCollected)
            );
            onPartialResults({
              results: partialResults,
              usedSources: Array.from(streamedSources),
              pendingCount: remaining,
              partial: remaining > 0,
            });
          }
        })
        .catch(() => {
          remaining = Math.max(0, remaining - 1);
        });
    });
  }

  const settled = await Promise.allSettled(runners.map((r) => r.promise));

  const collected = [];
  const failedSources = [];

  settled.forEach((outcome, idx) => {
    const srcId = runners[idx].id;
    if (outcome.status === 'fulfilled' && Array.isArray(outcome.value)) {
      collected.push(...outcome.value);
    } else {
      failedSources.push(srcId);
    }
  });

  const filteredByType = filterCinemaByType(collected);

  const deduplicated = deduplicateCinemaResults(filteredByType);
  const allFailed = runners.length > 0 && failedSources.length === runners.length;
  const partialFailure = failedSources.length > 0 && failedSources.length < runners.length;

  const responsePayload = {
    results: deduplicated,
    failedSources,
    failedCount: failedSources.length,
    partialFailure,
    allFailed,
    fromCache: false,
  };

  if (!allFailed && deduplicated.length > 0) {
    setCachedCinemaSearch(cleanQuery, filter, activeSources, responsePayload);
    setIdbCachedSearch(cacheKey, responsePayload).catch(() => {});
  }

  return responsePayload;
}

export async function fetchJikanAnimeRating(
  malId,
  {
    allowStaleOffline = true,
    forceRefresh = false,
    signal,
    fetchImpl = fetch,
    timeoutMs = API_TIMEOUT_MS,
    nowFn = Date.now,
    sleepFn = undefined,
  } = {}
) {
  const cleanId = Number(malId);
  if (!Number.isInteger(cleanId) || cleanId <= 0) {
    return { ok: false, reason: 'MISSING_MAL_ID', malRating: null };
  }

  const cacheKey = `jikan:anime:${cleanId}`;
  const now = nowFn();
  const cached = forceRefresh
    ? { hit: false, stale: false, data: null }
    : await getCachedEntry(CACHE_STORES.ratings, cacheKey, {
        now,
        allowStaleOffline,
      });

  if (cached.hit && !cached.stale && cached.data) {
    return {
      ok: true,
      fromCache: true,
      isOfflineCache: false,
      cacheDateLabel: cached.cacheDateLabel,
      malRating: cached.data.malRating || null,
      totalEpisodes: cached.data.totalEpisodes || null,
    };
  }

  try {
    const url = `${JIKAN_ANIME_URL}/${cleanId}`;
    const res = await fetchWithTimeout(
      url,
      { signal, nowFn, sleepFn },
      timeoutMs,
      fetchImpl,
      'jikan'
    );
    if (!res.ok) {
      throw new Error(`Jikan HTTP ${res.status}`);
    }
    const json = await res.json();
    const d = json?.data || null;
    if (!d) {
      return { ok: false, reason: 'JIKAN_NOT_FOUND', malRating: null };
    }

    const fetchedAt = nowFn();
    const malRating = buildMalRating(d.score, fetchedAt);
    const totalEpisodes = Number(d.episodes) > 0 ? Number(d.episodes) : null;
    const payload = { malRating, totalEpisodes };

    await setCachedEntry(CACHE_STORES.ratings, cacheKey, payload, {
      ttlMs: CACHE_TTL_MS.ratings,
      now: fetchedAt,
    });

    return {
      ok: true,
      fromCache: false,
      isOfflineCache: false,
      cacheDateLabel: '',
      malRating,
      totalEpisodes,
    };
  } catch (err) {
    if (cached.hit && allowStaleOffline && cached.data) {
      return {
        ok: true,
        fromCache: true,
        isOfflineCache: true,
        cacheDateLabel: cached.cacheDateLabel,
        malRating: cached.data.malRating || null,
        totalEpisodes: cached.data.totalEpisodes || null,
      };
    }
    return {
      ok: false,
      reason: err?.code || err?.message || 'JIKAN_ERROR',
      malRating: null,
    };
  }
}

function mapJikanRelationType(raw = '') {
  const clean = String(raw || '').trim().toLowerCase();
  if (clean === 'sequel') return 'SEQUEL';
  if (clean === 'prequel') return 'PREQUEL';
  if (clean === 'spin-off' || clean === 'spinoff') return 'SPIN_OFF';
  if (clean === 'side story') return 'SIDE_STORY';
  if (clean.includes('parent')) return 'PARENT';
  if (clean.includes('summary')) return 'SUMMARY';
  if (clean.includes('alternative')) return 'ALTERNATIVE';
  if (clean.includes('character') || clean === 'other') return 'OTHER';
  return 'SIDE_STORY';
}

export async function fetchJikanAnimeRelations(
  malId,
  {
    allowStaleOffline = true,
    forceRefresh = false,
    signal,
    fetchImpl = fetch,
    timeoutMs = API_TIMEOUT_MS,
    nowFn = Date.now,
    sleepFn = undefined,
  } = {}
) {
  const cleanId = Number(malId);
  if (!Number.isInteger(cleanId) || cleanId <= 0) {
    return { ok: false, reason: 'MISSING_MAL_ID', relations: [] };
  }

  const cacheKey = `jikan:relations:${cleanId}`;
  const now = nowFn();
  const cached = forceRefresh
    ? { hit: false, stale: false, data: null }
    : await getCachedEntry(CACHE_STORES.relations, cacheKey, {
        now,
        allowStaleOffline,
      });

  if (cached.hit && !cached.stale && Array.isArray(cached.data)) {
    return {
      ok: true,
      fromCache: true,
      isOfflineCache: false,
      cacheDateLabel: cached.cacheDateLabel,
      relations: cached.data,
    };
  }

  try {
    const url = `${JIKAN_ANIME_URL}/${cleanId}/relations`;
    const res = await fetchWithTimeout(
      url,
      { signal, nowFn, sleepFn },
      timeoutMs,
      fetchImpl,
      'jikan'
    );
    if (!res.ok) {
      throw new Error(`Jikan HTTP ${res.status}`);
    }
    const json = await res.json();
    const list = Array.isArray(json?.data) ? json.data : [];

    const relations = [];
    for (const group of list) {
      const relationType = mapJikanRelationType(group?.relation);
      const entries = Array.isArray(group?.entry) ? group.entry : [];
      for (const entry of entries) {
        if (!entry || String(entry.type || '').toLowerCase() !== 'anime') continue;
        const entryMalId = Number(entry.mal_id);
        const title = String(entry.name || '').trim();
        if (!title) continue;
        relations.push({
          relationType,
          malId: Number.isInteger(entryMalId) && entryMalId > 0 ? entryMalId : null,
          anilistId: null,
          title,
          originalTitle: title,
          format: /\bmovie\b|\bfilme\b/i.test(title)
            ? 'MOVIE'
            : /\bova\b/i.test(title)
              ? 'OVA'
              : /\bona\b/i.test(title)
                ? 'ONA'
                : /\bspecial\b/i.test(title)
                  ? 'SPECIAL'
                  : 'TV',
        });
      }
    }

    await setCachedEntry(CACHE_STORES.relations, cacheKey, relations, {
      ttlMs: CACHE_TTL_MS.relations,
      now: nowFn(),
    });

    return {
      ok: true,
      fromCache: false,
      isOfflineCache: false,
      cacheDateLabel: '',
      relations,
    };
  } catch (err) {
    if (cached.hit && allowStaleOffline && Array.isArray(cached.data)) {
      return {
        ok: true,
        fromCache: true,
        isOfflineCache: true,
        cacheDateLabel: cached.cacheDateLabel,
        relations: cached.data,
      };
    }
    return {
      ok: false,
      reason: err?.code || err?.message || 'JIKAN_RELATIONS_ERROR',
      relations: [],
    };
  }
}

export async function enrichWorkWithExternalRatings(
  work,
  {
    tmdbApiKey = '',
    omdbApiKey = '',
    allowStaleOffline = true,
    forceRefresh = false,
    signal,
    fetchImpl = fetch,
    nowFn = Date.now,
    maxConcurrency = 2,
    accessToken = '',
    supabaseClient = null,
    forceProxy = null,
    isDev = undefined,
  } = {}
) {
  if (!work) return { work, meta: { partial: false, failedSources: [], omdbMissingKey: false } };

  const safeConcurrency = Math.max(1, Math.min(2, Number(maxConcurrency) || 2));
  let enriched = applyCanonicalIdsToWork({
    ...work,
    externalRatings: normalizeExternalRatings(work.externalRatings),
  });

  const attemptedSources = [];
  const succeededSources = [];
  const failedSources = [];
  let omdbMissingKey = false;
  let omdbStatus = null;
  let isOfflineCache = false;
  let cacheDateLabel = '';

  const noteOffline = (res) => {
    if (res?.isOfflineCache) {
      isOfflineCache = true;
      if (res.cacheDateLabel && !cacheDateLabel) {
        cacheDateLabel = res.cacheDateLabel;
      }
    }
  };

  // Etapa 1 (máx. 2 requisições simultâneas): detalhes base (TMDB, AniList, TVmaze) + bridge
  const stage1Tasks = [];
  let tmdbRes = null;
  let tvDetails = null;
  let aniListRes = null;

  if (enriched.ids.tvmaze) {
    stage1Tasks.push(async () => {
      tvDetails = await fetchTvMazeShowDetails(enriched.ids.tvmaze, {
        signal,
        fetchImpl,
        allowStaleOffline,
      });
    });
  }

  if (enriched.ids.tmdb) {
    attemptedSources.push('tmdb');
    stage1Tasks.push(async () => {
      tmdbRes = await fetchTmdbDetailsInternal(
        enriched.ids.tmdb,
        enriched.tmdbMediaType || (enriched.workType === 'movie' ? 'movie' : 'tv'),
        {
          apiKey: tmdbApiKey,
          signal,
          fetchImpl,
          allowStaleOffline,
          forceRefresh,
          nowFn,
          accessToken,
          supabaseClient,
          forceProxy,
          isDev,
        }
      );
    });
  }

  if (
    enriched.ids.anilist &&
    (enriched.workType === 'anime' || !enriched.backdropUrl || !enriched.externalRatings?.anilist)
  ) {
    attemptedSources.push('anilist');
    stage1Tasks.push(async () => {
      const cacheKey = `anilist:media:${enriched.ids.anilist}`;
      const cached = forceRefresh
        ? { hit: false, stale: false, data: null }
        : await getCachedEntry(CACHE_STORES.ratings, cacheKey, {
            now: nowFn(),
            allowStaleOffline,
          });
      if (cached.hit && !cached.stale && cached.data) {
        aniListRes = {
          ok: true,
          data: cached.data,
          isOfflineCache: false,
          cacheDateLabel: cached.cacheDateLabel,
        };
        return;
      }
      try {
        const map = await fetchAniListMediaByIds([enriched.ids.anilist], {
          signal,
          fetchImpl,
          nowFn,
        });
        const media = map.get(enriched.ids.anilist) || null;
        if (media) {
          await setCachedEntry(CACHE_STORES.ratings, cacheKey, media, {
            ttlMs: CACHE_TTL_MS.ratings,
            now: nowFn(),
          });
          aniListRes = { ok: true, data: media, isOfflineCache: false, cacheDateLabel: '' };
        } else {
          aniListRes = { ok: false };
        }
      } catch {
        if (cached.hit && allowStaleOffline && cached.data) {
          aniListRes = {
            ok: true,
            data: cached.data,
            isOfflineCache: true,
            cacheDateLabel: cached.cacheDateLabel,
          };
        } else {
          aniListRes = { ok: false, error: true };
        }
      }
    });
  }

  await runBoundedConcurrency(stage1Tasks, safeConcurrency);

  if (tvDetails) {
    noteOffline(tvDetails);
    enriched = {
      ...enriched,
      totalSeasons: tvDetails.totalSeasons || enriched.totalSeasons,
      totalEpisodes: tvDetails.totalEpisodes || enriched.totalEpisodes,
      episodesPerSeason: tvDetails.episodesPerSeason || enriched.episodesPerSeason,
      episodeList: tvDetails.episodeList || enriched.episodeList,
      episodeDurationMinutes:
        tvDetails.episodeDurationMinutes || enriched.episodeDurationMinutes,
      showStatus: tvDetails.showStatus || enriched.showStatus || null,
      nextEpisode: tvDetails.nextEpisode || enriched.nextEpisode || null,
    };
  }

  if (tmdbRes?.ok && tmdbRes.data) {
    noteOffline(tmdbRes);
    succeededSources.push('tmdb');
    const td = tmdbRes.data;
    const mergedIds = mergeIdsBlocks(enriched.ids, td.ids);
    enriched = applyCanonicalIdsToWork({
      ...enriched,
      ...td,
      ids: mergedIds,
      backdropUrl: td.backdropUrl || enriched.backdropUrl || null,
      director: enriched.director || td.director || '',
      studio: enriched.studio || td.studio || '',
      externalRatings: mergeExternalRatings(enriched.externalRatings, td.externalRatings),
      synopsis:
        String(td.synopsis || '').length > String(enriched.synopsis || '').length
          ? td.synopsis
          : enriched.synopsis,
    });
  } else if (tmdbRes && !tmdbRes.ok && tmdbRes.status !== 'MISSING_KEY' && tmdbRes.status !== 'MISSING_ID') {
    failedSources.push('tmdb');
  }

  if (aniListRes?.ok && aniListRes.data) {
    noteOffline(aniListRes);
    succeededSources.push('anilist');
    const ad = aniListRes.data;
    const mergedIds = mergeIdsBlocks(enriched.ids, ad.ids);
    const aniReleaseInfo = resolveAnimeEpisodeReleaseInfo(
      {
        episodes: enriched.totalEpisodes || ad.totalEpisodes || null,
        nextAiringEpisode: ad.nextAiringEpisode || enriched.nextAiringEpisode || null,
        releasedEpisodesCount:
          ad.releasedEpisodesCount ?? enriched.releasedEpisodesCount ?? null,
        releasedEpisodesSource:
          ad.releasedEpisodesSource || enriched.releasedEpisodesSource || 'AniList',
        releasedEpisodesFetchedAt:
          ad.releasedEpisodesFetchedAt || enriched.releasedEpisodesFetchedAt || null,
      },
      { source: 'AniList' }
    );
    enriched = applyCanonicalIdsToWork({
      ...enriched,
      ids: mergedIds,
      backdropUrl: ad.backdropUrl || enriched.backdropUrl || null,
      externalRatings: mergeExternalRatings(enriched.externalRatings, ad.externalRatings),
      franchiseRelations:
        Array.isArray(ad.franchiseRelations) && ad.franchiseRelations.length > 0
          ? ad.franchiseRelations
          : enriched.franchiseRelations || [],
      totalEpisodes: aniReleaseInfo.totalEpisodes,
      releasedEpisodesCount: aniReleaseInfo.releasedEpisodesCount,
      releasedEpisodesSource: aniReleaseInfo.releasedEpisodesSource,
      releasedEpisodesFetchedAt: aniReleaseInfo.releasedEpisodesFetchedAt,
      animeStatus: ad.animeStatus || enriched.animeStatus || null,
      streamingProvidersBR: normalizeBrazilStreamingProviders(
        enriched.streamingProvidersBR || [],
        ad.streamingProvidersBR || []
      ),
      nextAiringEpisode: ad.nextAiringEpisode || enriched.nextAiringEpisode || null,
      synopsis:
        String(ad.synopsis || '').length > String(enriched.synopsis || '').length
          ? ad.synopsis
          : enriched.synopsis,
    });
  } else if (aniListRes?.error) {
    failedSources.push('anilist');
  }

  // Ponte D1 para anime vindo do TMDB sem anilistId
  const isJp =
    Array.isArray(enriched.originCountry)
      ? enriched.originCountry.includes('JP')
      : String(enriched.originCountry || '').toUpperCase() === 'JP' ||
        String(enriched.language || '').toLowerCase() === 'japonês';
  const hasAnimGenre =
    enriched.hasTmdbAnimationGenre === true ||
    (Array.isArray(enriched.genreIds) && enriched.genreIds.includes(16)) ||
    (Array.isArray(enriched.genres) &&
      enriched.genres.some((g) => /anima[çc][aã]o|anime/i.test(String(g))));

  if (!enriched.ids.anilist && enriched.ids.tmdb && hasAnimGenre && isJp) {
    const confirmed = await confirmAnimeOnAniList(
      {
        title: enriched.originalTitle || enriched.title,
        altTitle: enriched.title,
        releaseYear: enriched.releaseYear,
      },
      { signal, fetchImpl }
    );
    if (confirmed?.anilistId) {
      const aniMedia = confirmed.media;
      const mergedIds = mergeIdsBlocks(enriched.ids, {
        anilist: confirmed.anilistId,
        mal: confirmed.malId || aniMedia?.malId || null,
      });
      const aniReleaseInfo = resolveAnimeEpisodeReleaseInfo(
        {
          episodes: enriched.totalEpisodes || aniMedia?.totalEpisodes || null,
          nextAiringEpisode: aniMedia?.nextAiringEpisode || enriched.nextAiringEpisode || null,
          releasedEpisodesCount:
            aniMedia?.releasedEpisodesCount ?? enriched.releasedEpisodesCount ?? null,
          releasedEpisodesSource:
            aniMedia?.releasedEpisodesSource || enriched.releasedEpisodesSource || 'AniList',
          releasedEpisodesFetchedAt:
            aniMedia?.releasedEpisodesFetchedAt || enriched.releasedEpisodesFetchedAt || null,
        },
        { source: 'AniList' }
      );
      enriched = applyCanonicalIdsToWork({
        ...enriched,
        workType: 'anime',
        ids: mergedIds,
        animeFormat: enriched.animeFormat || aniMedia?.animeFormat || 'TV',
        animeStatus: aniMedia?.animeStatus || enriched.animeStatus || null,
        totalEpisodes: aniReleaseInfo.totalEpisodes,
        releasedEpisodesCount: aniReleaseInfo.releasedEpisodesCount,
        releasedEpisodesSource: aniReleaseInfo.releasedEpisodesSource,
        releasedEpisodesFetchedAt: aniReleaseInfo.releasedEpisodesFetchedAt,
        nextAiringEpisode: aniMedia?.nextAiringEpisode || enriched.nextAiringEpisode || null,
        franchiseRelations:
          Array.isArray(aniMedia?.franchiseRelations) && aniMedia.franchiseRelations.length > 0
            ? aniMedia.franchiseRelations
            : enriched.franchiseRelations || [],
        backdropUrl: enriched.backdropUrl || aniMedia?.backdropUrl || null,
        externalRatings: mergeExternalRatings(
          enriched.externalRatings,
          aniMedia?.externalRatings
        ),
      });
    }
  }

  // Etapa 2 (máx. 2 requisições simultâneas): OMDb (IMDb/RT/Metacritic), Jikan (MAL) e TVmaze IMDb lookup
  const stage2Tasks = [];
  let omdbRes = null;
  let malRes = null;
  let malRelationsRes = null;
  let tvLookupRes = null;

  if (enriched.ids.imdb && enriched.workType !== 'anime') {
    attemptedSources.push('omdb');
    stage2Tasks.push(async () => {
      omdbRes = await fetchOmdbByImdbId(enriched.ids.imdb, {
        apiKey: omdbApiKey,
        allowStaleOffline,
        signal,
        fetchImpl,
        nowFn,
        accessToken,
        supabaseClient,
        forceProxy,
        isDev,
      });
    });
  }

  if (
    enriched.ids.mal &&
    (enriched.workType === 'anime' || Boolean(enriched.ids.anilist))
  ) {
    attemptedSources.push('mal');
    stage2Tasks.push(async () => {
      malRes = await fetchJikanAnimeRating(enriched.ids.mal, {
        allowStaleOffline,
        forceRefresh,
        signal,
        fetchImpl,
        nowFn,
      });
    });
    if (!Array.isArray(enriched.franchiseRelations) || enriched.franchiseRelations.length === 0) {
      stage2Tasks.push(async () => {
        malRelationsRes = await fetchJikanAnimeRelations(enriched.ids.mal, {
          allowStaleOffline,
          forceRefresh,
          signal,
          fetchImpl,
          nowFn,
        });
      });
    }
  }

  if (enriched.ids.imdb && !enriched.ids.tvmaze && enriched.workType === 'series') {
    stage2Tasks.push(async () => {
      tvLookupRes = await lookupTvMazeByImdb(enriched.ids.imdb, {
        signal,
        fetchImpl,
      });
    });
  }

  await runBoundedConcurrency(stage2Tasks, safeConcurrency);

  if (omdbRes?.ok && omdbRes.ratings) {
    noteOffline(omdbRes);
    omdbStatus = 'OK';
    succeededSources.push('omdb');
    enriched = applyCanonicalIdsToWork({
      ...enriched,
      externalRatings: mergeExternalRatings(enriched.externalRatings, omdbRes.ratings),
    });
  } else if (omdbRes && !omdbRes.ok) {
    omdbStatus = omdbRes.reason || 'OMDB_ERROR';
    if (omdbRes.reason === 'MISSING_KEY') {
      omdbMissingKey = true;
    } else if (omdbRes.reason !== 'OMDB_NOT_FOUND') {
      failedSources.push('omdb');
    }
  }

  if (malRes?.ok) {
    noteOffline(malRes);
    succeededSources.push('mal');
    if (malRes.malRating) {
      enriched = applyCanonicalIdsToWork({
        ...enriched,
        externalRatings: mergeExternalRatings(enriched.externalRatings, {
          mal: malRes.malRating,
        }),
      });
    }
    if (!enriched.totalEpisodes && malRes.totalEpisodes) {
      enriched.totalEpisodes = malRes.totalEpisodes;
    }
  } else if (malRes && !malRes.ok && malRes.reason !== 'JIKAN_NOT_FOUND') {
    failedSources.push('mal');
  }

  if (
    malRelationsRes?.ok &&
    Array.isArray(malRelationsRes.relations) &&
    malRelationsRes.relations.length > 0 &&
    (!Array.isArray(enriched.franchiseRelations) || enriched.franchiseRelations.length === 0)
  ) {
    enriched.franchiseRelations = malRelationsRes.relations;
  }

  if (tvLookupRes?.tvmazeId) {
    enriched = applyCanonicalIdsToWork({
      ...enriched,
      ids: mergeIdsBlocks(enriched.ids, { tvmaze: tvLookupRes.tvmazeId }),
    });
    if (!tvDetails && (enriched.workType === 'series' || enriched.workType === 'anime')) {
      try {
        const lookedUpDetails = await fetchTvMazeShowDetails(tvLookupRes.tvmazeId, {
          signal,
          fetchImpl,
          allowStaleOffline,
        });
        if (lookedUpDetails) {
          noteOffline(lookedUpDetails);
          enriched = {
            ...enriched,
            totalSeasons:
              Math.max(Number(enriched.totalSeasons) || 1, Number(lookedUpDetails.totalSeasons) || 1),
            totalEpisodes: lookedUpDetails.totalEpisodes || enriched.totalEpisodes || null,
            episodesPerSeason:
              Array.isArray(lookedUpDetails.episodesPerSeason) &&
              lookedUpDetails.episodesPerSeason.length > 0
                ? lookedUpDetails.episodesPerSeason
                : enriched.episodesPerSeason || [],
            episodeList: lookedUpDetails.episodeList || enriched.episodeList,
            episodeDurationMinutes:
              lookedUpDetails.episodeDurationMinutes || enriched.episodeDurationMinutes,
            showStatus: lookedUpDetails.showStatus || enriched.showStatus || null,
            nextEpisode: lookedUpDetails.nextEpisode || enriched.nextEpisode || null,
          };
        }
      } catch {
        // Segue sem travar se detalhe complementar falhar
      }
    }
  }

  // Fallback de temporadas para animes baseados em cadeia de SEQUEL/PREQUEL da AniList/MAL
  if (
    enriched.workType === 'anime' &&
    enriched.animeFormat !== 'Filme' &&
    Number(enriched.totalSeasons || 1) <= 1 &&
    Array.isArray(enriched.franchiseRelations) &&
    enriched.franchiseRelations.length > 0
  ) {
    const tvSequels = enriched.franchiseRelations.filter(
      (r) =>
        (r.relationType === 'SEQUEL' || r.relationType === 'PREQUEL') &&
        (!r.format || r.format === 'TV' || r.format === 'TV_SHORT' || r.format === 'ONA')
    );
    if (tvSequels.length > 0) {
      const estimatedSeasons = Math.min(24, 1 + tvSequels.length);
      if (estimatedSeasons > Number(enriched.totalSeasons || 1)) {
        enriched.totalSeasons = estimatedSeasons;
      }
    }
  }

  enriched = applyCanonicalIdsToWork({
    ...enriched,
    backdropUrl: enriched.backdropUrl || null,
    externalRatings: normalizeExternalRatings(enriched.externalRatings),
  });

  return {
    work: enriched,
    meta: {
      attemptedSources: Array.from(new Set(attemptedSources)),
      succeededSources: Array.from(new Set(succeededSources)),
      failedSources: Array.from(new Set(failedSources)),
      omdbStatus,
      omdbMissingKey,
      isOfflineCache,
      cacheDateLabel,
      partial: failedSources.length > 0 || omdbMissingKey,
    },
  };
}

/**
 * Busca automática dedicada de temporadas e contagem de episódios por temporada
 * para séries (TMDB / TVmaze sem chave) e animes (AniList / Jikan).
 */
export async function enrichSeriesAndAnimeSeasons(
  work,
  {
    tmdbApiKey = '',
    allowStaleOffline = true,
    signal,
    fetchImpl = fetch,
    nowFn = Date.now,
  } = {}
) {
  if (!work || work.workType === 'movie') return null;

  let resolvedTmdbId = work.ids?.tmdb || work.tmdbId || null;
  let resolvedTvMazeId = work.ids?.tvmaze || work.tvmazeId || null;
  const resolvedImdbId = work.ids?.imdb || work.imdbId || '';

  // 1. Tenta TMDB /tv/{id} via proxy autenticado ou chave TMDB local
  const effectiveTmdbKey = sanitizeApiKey(tmdbApiKey) || loadTmdbApiKey();
  if (resolvedTmdbId) {
    const tmdbRes = await fetchTmdbDetailsInternal(resolvedTmdbId, 'tv', {
      apiKey: effectiveTmdbKey,
      allowStaleOffline,
      signal,
      fetchImpl,
      nowFn,
    });
    if (tmdbRes?.ok && tmdbRes.data) {
      return {
        totalSeasons: tmdbRes.data.totalSeasons || 1,
        totalEpisodes: tmdbRes.data.totalEpisodes || null,
        episodesPerSeason: Array.isArray(tmdbRes.data.episodesPerSeason)
          ? tmdbRes.data.episodesPerSeason
          : [],
        episodeDurationMinutes: tmdbRes.data.episodeDurationMinutes || null,
        tmdbStatus: tmdbRes.data.tmdbStatus || null,
        source: 'tmdb',
      };
    }
  }

  // 2. Fallback TVmaze (100% gratuito sem chave) por tvmazeId, imdbId ou título/ano
  if (!resolvedTvMazeId && resolvedImdbId) {
    const bridge = await lookupTvMazeByImdb(resolvedImdbId, { signal, fetchImpl });
    if (bridge?.tvmazeId) resolvedTvMazeId = bridge.tvmazeId;
  }

  if (!resolvedTvMazeId && work.workType === 'series' && work.title) {
    try {
      const hits = await searchTvMaze(work.originalTitle || work.title, {
        signal,
        fetchImpl,
      });
      const normTarget = normalizeTitleForDedup(work.originalTitle || work.title);
      const normAlt = normalizeTitleForDedup(work.title);
      const matched = hits.find((h) => {
        const hn = normalizeTitleForDedup(h.title);
        const yearOk =
          !work.releaseYear ||
          !h.releaseYear ||
          Math.abs(Number(work.releaseYear) - Number(h.releaseYear)) <= 1;
        return yearOk && (hn === normTarget || hn === normAlt);
      }) || hits[0];
      if (matched?.tvmazeId) {
        resolvedTvMazeId = matched.tvmazeId;
      }
    } catch {
      // Silencioso
    }
  }

  if (resolvedTvMazeId) {
    const tvDetails = await fetchTvMazeShowDetails(resolvedTvMazeId, {
      signal,
      fetchImpl,
      allowStaleOffline,
    });
    if (tvDetails) {
      return {
        tvmazeId: resolvedTvMazeId,
        totalSeasons: tvDetails.totalSeasons || 1,
        totalEpisodes: tvDetails.totalEpisodes || null,
        episodesPerSeason: Array.isArray(tvDetails.episodesPerSeason)
          ? tvDetails.episodesPerSeason
          : [],
        episodeList: tvDetails.episodeList || null,
        episodeDurationMinutes: tvDetails.episodeDurationMinutes || null,
        showStatus: tvDetails.showStatus || null,
        nextEpisode: tvDetails.nextEpisode || null,
        source: 'tvmaze',
      };
    }
  }

  // 3. Animes via AniList/Jikan (episódios + cadeia de sequências TV/ONA)
  if (work.workType === 'anime') {
    const relRes = await fetchAniListBatchByIds(
      work.anilistId ? [Number(work.anilistId)] : [],
      { signal, fetchImpl, nowFn }
    ).catch(() => null);
    const aniMedia = relRes && work.anilistId ? relRes.get(Number(work.anilistId)) : null;
    if (aniMedia) {
      const tvSequels = (aniMedia.franchiseRelations || []).filter(
        (r) =>
          (r.relationType === 'SEQUEL' || r.relationType === 'PREQUEL') &&
          (!r.format || r.format === 'TV' || r.format === 'TV_SHORT' || r.format === 'ONA')
      );
      return {
        totalSeasons: Math.max(
          Number(work.totalSeasons) || 1,
          Math.min(24, 1 + tvSequels.length)
        ),
        totalEpisodes: aniMedia.totalEpisodes || work.totalEpisodes || null,
        episodesPerSeason: aniMedia.totalEpisodes ? [aniMedia.totalEpisodes] : [],
        franchiseRelations: aniMedia.franchiseRelations || work.franchiseRelations || [],
        source: 'anilist',
      };
    }
  }

  return null;
}

export async function enrichCinemaCandidate(
  candidate,
  options = {}
) {
  if (!candidate) return candidate;
  const res = await enrichWorkWithExternalRatings(candidate, options);
  return res.work;
}

export async function testTmdbConnection(
  apiKey = '',
  { fetchImpl = fetch, accessToken = '', supabaseClient = null, forceProxy = null, isDev = undefined } = {}
) {
  const explicitKey = apiKey === null ? '' : sanitizeApiKey(apiKey);
  const fallbackKey = apiKey === null ? '' : explicitKey || loadTmdbApiKey();
  const start = Date.now();

  if (explicitKey) {
    try {
      const res = await fetchWithTimeout(
        `${TMDB_API_BASE}/configuration?api_key=${encodeURIComponent(explicitKey)}`,
        { dedup: false },
        6000,
        fetchImpl,
        'tmdb'
      );
      const latencyMs = Date.now() - start;
      if (!res.ok) {
        return {
          ok: false,
          latencyMs,
          via: 'direct',
          errorMessage: res.status === 401 ? 'Chave TMDB inválida ou expirada.' : `Erro HTTP ${res.status}`,
        };
      }
      return { ok: true, latencyMs, via: 'direct', model: 'TMDB API v3' };
    } catch {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        via: 'direct',
        errorMessage: 'Não foi possível conectar ao TMDB agora.',
      };
    }
  }

  try {
    const outcome = await fetchTmdbViaProxyOrDirect(
      'movie/603',
      { language: 'pt-BR' },
      {
        directApiKey: fallbackKey,
        dedup: false,
        timeoutMs: 6000,
        fetchImpl,
        accessToken,
        supabaseClient,
        forceProxy,
        ...(isDev !== undefined ? { isDev } : {}),
      }
    );
    const latencyMs = Date.now() - start;
    if (outcome.missingKey || !outcome.res) {
      return {
        ok: false,
        latencyMs,
        via: 'none',
        errorMessage: 'Informe uma chave de API TMDB v3 para testar ou ative sua sessão na nuvem.',
      };
    }
    if (!outcome.res.ok) {
      return {
        ok: false,
        latencyMs,
        via: outcome.via,
        errorMessage:
          outcome.res.status === 401
            ? 'Chave TMDB inválida ou expirada.'
            : `Erro HTTP ${outcome.res.status}`,
      };
    }
    return {
      ok: true,
      latencyMs,
      via: outcome.via,
      model: outcome.via === 'proxy' ? 'TMDB (proxy servidor)' : 'TMDB API v3',
    };
  } catch {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      via: 'none',
      errorMessage: 'Não foi possível conectar ao TMDB agora.',
    };
  }
}

export async function fetchTmdbExternalIds(
  tmdbId,
  mediaType = 'movie',
  {
    apiKey = '',
    signal,
    fetchImpl = fetch,
    timeoutMs = API_TIMEOUT_MS,
    accessToken = '',
    supabaseClient = null,
    forceProxy = null,
    isDev = undefined,
  } = {}
) {
  if (!tmdbId) return null;
  const key = apiKey === null ? '' : sanitizeApiKey(apiKey) || loadTmdbApiKey();
  const type = mediaType === 'tv' ? 'tv' : 'movie';
  try {
    const outcome = await fetchTmdbViaProxyOrDirect(
      `${type}/${encodeURIComponent(tmdbId)}/external_ids`,
      {},
      {
        directApiKey: key,
        signal,
        fetchImpl,
        timeoutMs,
        accessToken,
        supabaseClient,
        forceProxy,
        ...(isDev !== undefined ? { isDev } : {}),
      }
    );
    if (outcome.missingKey || !outcome.res || !outcome.res.ok) return null;
    const json = await outcome.res.json();
    return {
      imdbId: sanitizeImdbId(json?.imdb_id) || null,
      tvdbId: Number(json?.tvdb_id) || null,
      wikidataId: json?.wikidata_id || null,
    };
  } catch {
    return null;
  }
}

export async function lookupTvMazeByImdb(
  imdbId,
  { signal, fetchImpl = fetch, timeoutMs = API_TIMEOUT_MS } = {}
) {
  const clean = sanitizeImdbId(imdbId);
  if (!clean) return null;
  try {
    const url = `${TVMAZE_LOOKUP_URL}?imdb=${encodeURIComponent(clean)}`;
    const res = await fetchWithTimeout(url, { signal }, timeoutMs, fetchImpl, 'tvmaze');
    if (res.status === 404 || !res.ok) return null;
    const show = await res.json();
    if (!show?.id) return null;
    return {
      tvmazeId: Number(show.id),
      imdbId: clean,
      name: show.name || '',
      status: show.status || null,
    };
  } catch {
    return null;
  }
}

export async function fetchOmdbByImdbId(
  imdbId,
  {
    apiKey = '',
    mode = 'auto',
    allowStaleOffline = false,
    signal,
    fetchImpl = fetch,
    timeoutMs = API_TIMEOUT_MS,
    nowFn = Date.now,
    sleepFn = undefined,
    accessToken = '',
    supabaseClient = null,
    forceProxy = null,
    isDev = undefined,
  } = {}
) {
  const cleanImdb = sanitizeImdbId(imdbId);
  if (!cleanImdb) {
    return { ok: false, reason: 'MISSING_IMDB_ID', ratings: null, data: null };
  }

  const now = nowFn();
  const cacheKey = `omdb:${cleanImdb}`;
  const cached = await getCachedEntry(CACHE_STORES.ratings, cacheKey, {
    now,
    allowStaleOffline,
  });

  if (cached.hit && !cached.stale) {
    return {
      ok: true,
      fromCache: true,
      isOfflineCache: false,
      cacheDateLabel: cached.cacheDateLabel,
      ratings: cached.data.ratings,
      data: cached.data.raw || null,
    };
  }

  const key = apiKey === null ? '' : sanitizeApiKey(apiKey) || loadOmdbApiKey();

  try {
    const outcome = await fetchOmdbViaProxyOrDirect(
      { i: cleanImdb },
      {
        directApiKey: key,
        mode,
        signal,
        fetchImpl,
        timeoutMs,
        nowFn,
        sleepFn,
        accessToken,
        supabaseClient,
        forceProxy,
        ...(isDev !== undefined ? { isDev } : {}),
      }
    );
    if (outcome.missingKey || !outcome.res) {
      if (cached.hit && allowStaleOffline) {
        return {
          ok: true,
          fromCache: true,
          isOfflineCache: true,
          cacheDateLabel: cached.cacheDateLabel,
          ratings: cached.data.ratings,
          data: cached.data.raw || null,
        };
      }
      return { ok: false, reason: 'MISSING_KEY', ratings: null, data: null };
    }
    const res = outcome.res;
    if (!res.ok) {
      throw new Error(`OMDb HTTP ${res.status}`);
    }
    const json = await res.json();
    if (json?.Response === 'False') {
      return {
        ok: false,
        reason: maskSecretsInText(json?.Error || 'OMDB_NOT_FOUND', [key]),
        ratings: { imdb: null, rottenTomatoes: null, metacritic: null },
        data: null,
      };
    }

    const fetchedAt = nowFn();
    const ratings = parseOmdbRatings(json, fetchedAt);
    await setCachedEntry(
      CACHE_STORES.ratings,
      cacheKey,
      { ratings, raw: json },
      { ttlMs: CACHE_TTL_MS.ratings, now: fetchedAt }
    );

    return {
      ok: true,
      fromCache: false,
      isOfflineCache: false,
      cacheDateLabel: '',
      ratings,
      data: json,
    };
  } catch (err) {
    if (cached.hit && allowStaleOffline) {
      return {
        ok: true,
        fromCache: true,
        isOfflineCache: true,
        cacheDateLabel: cached.cacheDateLabel,
        ratings: cached.data.ratings,
        data: cached.data.raw || null,
      };
    }
    if (err instanceof ApiQuotaError) {
      return { ok: false, reason: err.code, ratings: null, data: null, quota: err.usage };
    }
    return {
      ok: false,
      reason: maskSecretsInText(err?.code || err?.message || 'OMDB_ERROR', [key]),
      ratings: null,
      data: null,
    };
  }
}

export async function testOmdbConnection(
  apiKey = '',
  { fetchImpl = fetch, accessToken = '', supabaseClient = null, forceProxy = null, isDev = undefined } = {}
) {
  const explicitKey = apiKey === null ? '' : sanitizeApiKey(apiKey);
  const fallbackKey = apiKey === null ? '' : explicitKey || loadOmdbApiKey();
  const start = Date.now();

  if (explicitKey) {
    try {
      const res = await fetchWithTimeout(
        `${OMDB_API_BASE}/?apikey=${encodeURIComponent(explicitKey)}&i=tt0133093`,
        { dedup: false, mode: 'manual', maxRetries: 0 },
        6000,
        fetchImpl,
        'omdb'
      );
      const latencyMs = Date.now() - start;
      const json = await res.json().catch(() => null);
      if (!res.ok || json?.Response === 'False') {
        return {
          ok: false,
          latencyMs,
          via: 'direct',
          errorMessage: maskSecretsInText(
            json?.Error || (res.status === 401 ? 'Chave OMDb inválida.' : `Erro HTTP ${res.status}`),
            [explicitKey]
          ),
        };
      }
      return { ok: true, latencyMs, via: 'direct', model: 'OMDb API' };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        via: 'direct',
        errorMessage:
          err instanceof ApiQuotaError
            ? maskSecretsInText(err.message, [explicitKey])
            : 'Não foi possível conectar à OMDb agora.',
      };
    }
  }

  try {
    const outcome = await fetchOmdbViaProxyOrDirect(
      { i: 'tt0133093' },
      {
        directApiKey: fallbackKey,
        dedup: false,
        mode: 'manual',
        maxRetries: 0,
        timeoutMs: 6000,
        fetchImpl,
        accessToken,
        supabaseClient,
        forceProxy,
        ...(isDev !== undefined ? { isDev } : {}),
      }
    );
    const latencyMs = Date.now() - start;
    if (outcome.missingKey || !outcome.res) {
      return {
        ok: false,
        latencyMs,
        via: 'none',
        errorMessage: 'Informe uma chave da API OMDb para testar ou ative sua sessão na nuvem.',
      };
    }
    const json = await outcome.res.json().catch(() => null);
    if (!outcome.res.ok || json?.Response === 'False') {
      return {
        ok: false,
        latencyMs,
        via: outcome.via,
        errorMessage: maskSecretsInText(
          json?.Error ||
            (outcome.res.status === 401 ? 'Chave OMDb inválida.' : `Erro HTTP ${outcome.res.status}`),
          [fallbackKey]
        ),
      };
    }
    return {
      ok: true,
      latencyMs,
      via: outcome.via,
      model: outcome.via === 'proxy' ? 'OMDb (proxy servidor)' : 'OMDb API',
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      via: 'none',
      errorMessage:
        err instanceof ApiQuotaError
          ? maskSecretsInText(err.message, [fallbackKey])
          : 'Não foi possível conectar à OMDb agora.',
    };
  }
}

export async function fetchAniListMediaByIds(anilistIds = [], options = {}) {
  const map = await fetchAniListBatchByIds(anilistIds, options);
  const out = new Map();
  for (const [id, rawMedia] of map.entries()) {
    out.set(id, rawMedia ? normalizeAniListMedia(rawMedia) : null);
  }
  return out;
}

export async function confirmAnimeOnAniList(
  { title = '', altTitle = '', releaseYear = null } = {},
  { signal, fetchImpl = fetch, timeoutMs = API_TIMEOUT_MS } = {}
) {
  const searchTerm = String(title || altTitle || '').trim();
  if (!searchTerm) return null;
  try {
    const results = await searchAniList(searchTerm, { signal, fetchImpl, timeoutMs });
    if (!results.length) return null;
    const targetNorm = normalizeTitleForDedup(searchTerm);
    const altNorm = normalizeTitleForDedup(altTitle);
    const targetYear = Number(releaseYear) || null;

    const matched = results.find((item) => {
      const n1 = normalizeTitleForDedup(item.title);
      const n2 = normalizeTitleForDedup(item.originalTitle);
      const titleMatch =
        (targetNorm && (n1 === targetNorm || n2 === targetNorm)) ||
        (altNorm && (n1 === altNorm || n2 === altNorm));
      if (!titleMatch) return false;
      if (targetYear && item.releaseYear) {
        return Math.abs(Number(item.releaseYear) - targetYear) <= 1;
      }
      return true;
    });

    return matched
      ? { anilistId: matched.anilistId, malId: matched.malId || null, media: matched }
      : null;
  } catch {
    return null;
  }
}

export async function fetchJikanEpisodes(
  malId,
  {
    page = 1,
    showStatus = '',
    allowStaleOffline = false,
    signal,
    fetchImpl = fetch,
    timeoutMs = API_TIMEOUT_MS,
    nowFn = Date.now,
    sleepFn = undefined,
  } = {}
) {
  const cleanId = Number(malId);
  if (!Number.isInteger(cleanId) || cleanId <= 0) return null;

  const cacheKey = `jikan:episodes:${cleanId}:p${page}`;
  const now = nowFn();
  const cached = await getCachedEntry(CACHE_STORES.episodes, cacheKey, {
    now,
    allowStaleOffline,
  });

  if (cached.hit && !cached.stale) {
    return { ...cached.data, fromCache: true, isOfflineCache: false, cacheDateLabel: cached.cacheDateLabel };
  }

  try {
    const url = `${JIKAN_ANIME_URL}/${cleanId}/episodes?page=${Math.max(1, Number(page) || 1)}`;
    const res = await fetchWithTimeout(
      url,
      { signal, nowFn, sleepFn },
      timeoutMs,
      fetchImpl,
      'jikan'
    );
    if (!res.ok) throw new Error(`Jikan HTTP ${res.status}`);
    const json = await res.json();
    const list = Array.isArray(json?.data) ? json.data : [];

    const episodes = list.map((ep) => ({
      malId: Number(ep.mal_id) || null,
      number: Number(ep.mal_id) || null,
      title: ep.title || ep.title_romanji || null,
      aired: ep.aired || null,
      score: ep.score !== null && ep.score !== undefined ? Number(ep.score) : null,
      filler: Boolean(ep.filler),
      recap: Boolean(ep.recap),
    }));

    const result = {
      malId: cleanId,
      page: Number(page) || 1,
      hasNextPage: Boolean(json?.pagination?.has_next_page),
      lastVisiblePage: Number(json?.pagination?.last_visible_page) || 1,
      episodes,
    };

    await setCachedEntry(CACHE_STORES.episodes, cacheKey, result, {
      ttlMs: getEpisodesTtlMs(showStatus),
      now: nowFn(),
    });

    return { ...result, fromCache: false, isOfflineCache: false };
  } catch {
    if (cached.hit && allowStaleOffline) {
      return {
        ...cached.data,
        fromCache: true,
        isOfflineCache: true,
        cacheDateLabel: cached.cacheDateLabel,
      };
    }
    return null;
  }
}

export async function fetchTmdbSeasonDetails(
  tmdbId,
  seasonNumber = 1,
  {
    apiKey = '',
    showStatus = '',
    allowStaleOffline = true,
    signal,
    fetchImpl = fetch,
    timeoutMs = API_TIMEOUT_MS,
    nowFn = Date.now,
  } = {}
) {
  const cleanTmdb = Number(tmdbId);
  const cleanSeason = Math.max(1, Math.round(Number(seasonNumber) || 1));
  if (!Number.isInteger(cleanTmdb) || cleanTmdb <= 0) return null;

  const cacheKey = `tmdb:season:${cleanTmdb}:s${cleanSeason}`;
  const now = nowFn();
  const cached = await getCachedEntry(CACHE_STORES.episodes, cacheKey, {
    now,
    allowStaleOffline,
  });

  if (cached.hit && !cached.stale && cached.data) {
    return {
      ...cached.data,
      fromCache: true,
      isOfflineCache: false,
      cacheDateLabel: cached.cacheDateLabel,
    };
  }

  const key = apiKey === null ? '' : sanitizeApiKey(apiKey) || loadTmdbApiKey();

  try {
    const outcome = await fetchTmdbViaProxyOrDirect(
      `tv/${cleanTmdb}/season/${cleanSeason}`,
      { language: 'pt-BR' },
      { directApiKey: key, signal, nowFn, timeoutMs, fetchImpl }
    );
    if (outcome.missingKey || !outcome.res) {
      return cached.hit && allowStaleOffline && cached.data
        ? {
            ...cached.data,
            fromCache: true,
            isOfflineCache: true,
            cacheDateLabel: cached.cacheDateLabel,
          }
        : null;
    }
    const res = outcome.res;
    if (!res.ok) throw new Error(`TMDB HTTP ${res.status}`);
    const json = await res.json();
    const rawList = Array.isArray(json?.episodes) ? json.episodes : [];

    const episodes = rawList.map((ep) => ({
      season: cleanSeason,
      number: Number(ep.episode_number) || 1,
      name: ep.name || `Episódio ${ep.episode_number || ''}`,
      runtime: Number(ep.runtime) > 0 ? Number(ep.runtime) : null,
      airdate: ep.air_date || '',
      summary: String(ep.overview || '').trim(),
      imageUrl: ep.still_path ? `https://image.tmdb.org/t/p/w500${ep.still_path}` : null,
      rating:
        ep.vote_average !== null &&
        ep.vote_average !== undefined &&
        Number(ep.vote_average) > 0
          ? Math.round(Number(ep.vote_average) * 10) / 10
          : null,
    }));

    const result = {
      tmdbId: cleanTmdb,
      season: cleanSeason,
      episodes,
    };

    await setCachedEntry(CACHE_STORES.episodes, cacheKey, result, {
      ttlMs: getEpisodesTtlMs(showStatus),
      now: nowFn(),
    });

    return { ...result, fromCache: false, isOfflineCache: false, cacheDateLabel: '' };
  } catch {
    if (cached.hit && allowStaleOffline && cached.data) {
      return {
        ...cached.data,
        fromCache: true,
        isOfflineCache: true,
        cacheDateLabel: cached.cacheDateLabel,
      };
    }
    return null;
  }
}

export async function fetchTmdbEpisodeGroups(
  tmdbId,
  {
    apiKey = '',
    showStatus = '',
    allowStaleOffline = true,
    signal,
    fetchImpl = fetch,
    timeoutMs = API_TIMEOUT_MS,
    nowFn = Date.now,
  } = {}
) {
  const cleanTmdb = Number(tmdbId);
  if (!Number.isInteger(cleanTmdb) || cleanTmdb <= 0) return { ok: false, groups: [] };

  const cacheKey = `tmdb:epgroups:${cleanTmdb}`;
  const now = nowFn();
  const cached = await getCachedEntry(CACHE_STORES.episodes, cacheKey, {
    now,
    allowStaleOffline,
  });

  if (cached.hit && !cached.stale && cached.data) {
    return {
      ok: true,
      groups: cached.data,
      fromCache: true,
      isOfflineCache: false,
      cacheDateLabel: cached.cacheDateLabel,
    };
  }

  const key = apiKey === null ? '' : sanitizeApiKey(apiKey) || loadTmdbApiKey();

  try {
    const outcome = await fetchTmdbViaProxyOrDirect(
      `tv/${cleanTmdb}/episode_groups`,
      {},
      { directApiKey: key, signal, nowFn, timeoutMs, fetchImpl }
    );
    if (outcome.missingKey || !outcome.res) {
      return cached.hit && allowStaleOffline && cached.data
        ? {
            ok: true,
            groups: cached.data,
            fromCache: true,
            isOfflineCache: true,
            cacheDateLabel: cached.cacheDateLabel,
          }
        : { ok: false, groups: [] };
    }
    const res = outcome.res;
    if (!res.ok) throw new Error(`TMDB HTTP ${res.status}`);
    const json = await res.json();
    const groups = (Array.isArray(json?.results) ? json.results : []).map((g) => ({
      id: String(g.id),
      name: String(g.name || '').trim(),
      description: String(g.description || '').trim(),
      episodeCount: Number(g.episode_count) || 0,
      groupCount: Number(g.group_count) || 0,
      type: Number(g.type) || null,
      isSuggestion: true,
    }));

    await setCachedEntry(CACHE_STORES.episodes, cacheKey, groups, {
      ttlMs: getEpisodesTtlMs(showStatus),
      now: nowFn(),
    });

    return { ok: true, groups, fromCache: false, isOfflineCache: false, cacheDateLabel: '' };
  } catch {
    if (cached.hit && allowStaleOffline && cached.data) {
      return {
        ok: true,
        groups: cached.data,
        fromCache: true,
        isOfflineCache: true,
        cacheDateLabel: cached.cacheDateLabel,
      };
    }
    return { ok: false, groups: [] };
  }
}

export async function fetchTmdbEpisodeGroupDetails(
  groupId,
  {
    apiKey = '',
    showStatus = '',
    allowStaleOffline = true,
    signal,
    fetchImpl = fetch,
    timeoutMs = API_TIMEOUT_MS,
    nowFn = Date.now,
  } = {}
) {
  const cleanId = String(groupId || '').trim();
  if (!cleanId) return { ok: false, arcs: [] };

  const cacheKey = `tmdb:epgroup:${cleanId}`;
  const now = nowFn();
  const cached = await getCachedEntry(CACHE_STORES.episodes, cacheKey, {
    now,
    allowStaleOffline,
  });
  if (cached.hit && !cached.stale && cached.data) {
    return { ok: true, arcs: cached.data, fromCache: true };
  }

  const key = apiKey === null ? '' : sanitizeApiKey(apiKey) || loadTmdbApiKey();

  try {
    const outcome = await fetchTmdbViaProxyOrDirect(
      `tv/episode_group/${encodeURIComponent(cleanId)}`,
      { language: 'pt-BR' },
      { directApiKey: key, signal, nowFn, timeoutMs, fetchImpl }
    );
    if (outcome.missingKey || !outcome.res) {
      return cached.hit && allowStaleOffline && cached.data
        ? { ok: true, arcs: cached.data, fromCache: true, isOfflineCache: true }
        : { ok: false, arcs: [] };
    }
    const res = outcome.res;
    if (!res.ok) throw new Error(`TMDB HTTP ${res.status}`);
    const json = await res.json();
    const rawGroups = Array.isArray(json?.groups) ? json.groups : [];
    const arcs = rawGroups
      .filter((grp) => grp?.name && Array.isArray(grp.episodes) && grp.episodes.length > 0)
      .map((grp, idx) => {
        const eps = grp.episodes;
        const firstEp = eps[0];
        const lastEp = eps[eps.length - 1];
        return {
          id: `tmdb-arc-${grp.id || idx}`,
          name: String(grp.name).trim(),
          season: Math.max(1, Number(firstEp?.season_number) || 1),
          startEp: Math.max(1, Number(firstEp?.episode_number) || 1),
          endEp: Math.max(1, Number(lastEp?.episode_number) || 1),
          episodeCount: eps.length,
          isSuggestion: true,
        };
      });

    await setCachedEntry(CACHE_STORES.episodes, cacheKey, arcs, {
      ttlMs: getEpisodesTtlMs(showStatus),
      now: nowFn(),
    });
    return { ok: true, arcs, fromCache: false };
  } catch {
    return cached.hit && allowStaleOffline && cached.data
      ? { ok: true, arcs: cached.data, fromCache: true, isOfflineCache: true }
      : { ok: false, arcs: [] };
  }
}

export async function fetchOmdbSeasonEpisodes(
  imdbId,
  seasonNumber = 1,
  {
    apiKey = '',
    showStatus = '',
    allowStaleOffline = true,
    mode = 'auto',
    signal,
    fetchImpl = fetch,
    timeoutMs = API_TIMEOUT_MS,
    nowFn = Date.now,
    sleepFn = undefined,
  } = {}
) {
  const cleanImdb = sanitizeImdbId(imdbId);
  const cleanSeason = Math.max(1, Math.round(Number(seasonNumber) || 1));
  if (!cleanImdb) return { ok: false, reason: 'MISSING_IMDB_ID', episodes: [] };

  const cacheKey = `omdb:season:${cleanImdb}:s${cleanSeason}`;
  const now = nowFn();
  const cached = await getCachedEntry(CACHE_STORES.episodes, cacheKey, {
    now,
    allowStaleOffline,
  });

  if (cached.hit && !cached.stale && cached.data) {
    return {
      ok: true,
      fromCache: true,
      isOfflineCache: false,
      cacheDateLabel: cached.cacheDateLabel,
      episodes: cached.data,
    };
  }

  const key = apiKey === null ? '' : sanitizeApiKey(apiKey) || loadOmdbApiKey();

  try {
    const outcome = await fetchOmdbViaProxyOrDirect(
      { i: cleanImdb, Season: String(cleanSeason) },
      { directApiKey: key, signal, mode, nowFn, sleepFn, timeoutMs, fetchImpl }
    );
    if (outcome.missingKey || !outcome.res) {
      if (cached.hit && allowStaleOffline && cached.data) {
        return {
          ok: true,
          fromCache: true,
          isOfflineCache: true,
          cacheDateLabel: cached.cacheDateLabel,
          episodes: cached.data,
        };
      }
      return { ok: false, reason: 'MISSING_KEY', episodes: [] };
    }
    const res = outcome.res;
    if (!res.ok) throw new Error(`OMDb HTTP ${res.status}`);
    const json = await res.json();
    if (json?.Response === 'False') {
      return {
        ok: false,
        reason: maskSecretsInText(json?.Error || 'OMDB_SEASON_NOT_FOUND', [key]),
        episodes: [],
      };
    }

    const rawList = Array.isArray(json?.Episodes) ? json.Episodes : [];
    const episodes = rawList.map((ep) => {
      const parsedNum = Number(ep.Episode);
      const rawScore = String(ep.imdbRating || '').trim();
      const scoreNum =
        rawScore && !/^n\/a$/i.test(rawScore) && Number.isFinite(Number(rawScore))
          ? Number(rawScore)
          : null;
      return {
        season: cleanSeason,
        number: Number.isInteger(parsedNum) && parsedNum > 0 ? parsedNum : null,
        title: ep.Title && !/^n\/a$/i.test(String(ep.Title).trim()) ? ep.Title : null,
        released: ep.Released && !/^n\/a$/i.test(ep.Released) ? ep.Released : null,
        imdbRating:
          scoreNum !== null && scoreNum > 0 && scoreNum <= 10
            ? Math.round(scoreNum * 10) / 10
            : null,
        imdbId: sanitizeImdbId(ep.imdbID) || null,
      };
    });

    await setCachedEntry(CACHE_STORES.episodes, cacheKey, episodes, {
      ttlMs: getEpisodesTtlMs(showStatus),
      now: nowFn(),
    });

    return {
      ok: true,
      fromCache: false,
      isOfflineCache: false,
      cacheDateLabel: '',
      episodes,
    };
  } catch (err) {
    if (cached.hit && allowStaleOffline && cached.data) {
      return {
        ok: true,
        fromCache: true,
        isOfflineCache: true,
        cacheDateLabel: cached.cacheDateLabel,
        episodes: cached.data,
      };
    }
    return {
      ok: false,
      reason: maskSecretsInText(err?.code || err?.message || 'OMDB_ERROR', [key]),
      episodes: [],
    };
  }
}

/**
 * Backfill silencioso de backdropUrl para o Hero da Home (Fase 5 / Regra Extra 2):
 * - Nunca chama a OMDb.
 * - Respeita fila de API e teto de concorrência (máx. 2 simultâneos).
 * - Memoriza tentativa/falha via checkedAt (cooldown de 30 dias em backdropCheckedAt).
 */
export async function backfillWorkHeroBackdrop(
  work,
  {
    tmdbApiKey = '',
    signal,
    fetchImpl = fetch,
    nowFn = Date.now,
    maxConcurrency = 2,
  } = {}
) {
  if (!work || typeof work !== 'object') {
    return { attempted: false, backdropUrl: null, checkedAt: null, failed: false };
  }
  if (work.backdropUrl && /^https?:\/\//i.test(String(work.backdropUrl).trim())) {
    return {
      attempted: false,
      backdropUrl: String(work.backdropUrl).trim(),
      checkedAt: Number(work.backdropCheckedAt) || null,
      failed: false,
    };
  }

  const now = nowFn();
  const prevChecked = Number(work.backdropCheckedAt) || 0;
  if (prevChecked > 0 && now - prevChecked < BACKDROP_RETRY_COOLDOWN_MS) {
    return {
      attempted: false,
      skippedCooldown: true,
      backdropUrl: null,
      checkedAt: prevChecked,
      failed: false,
    };
  }

  const withIds = applyCanonicalIdsToWork(work);
  const tmdbId = Number(withIds.ids?.tmdb || withIds.tmdbId) || null;
  const anilistId = Number(withIds.ids?.anilist || withIds.anilistId) || null;
  const key = sanitizeApiKey(tmdbApiKey) || loadTmdbApiKey();

  const tasks = [];
  let resolvedUrl = null;
  let hadError = false;

  if (tmdbId) {
    tasks.push(async () => {
      try {
        const mediaType =
          withIds.workType === 'series' ||
          withIds.tmdbMediaType === 'tv' ||
          (withIds.workType === 'anime' && withIds.tmdbMediaType === 'tv')
            ? 'tv'
            : 'movie';
        const res = await fetchTmdbDetailsInternal(tmdbId, mediaType, {
          apiKey: key,
          signal,
          fetchImpl,
          nowFn,
        });
        if (res?.ok && res.data?.backdropUrl) {
          resolvedUrl = resolvedUrl || res.data.backdropUrl;
        } else if (res && !res.ok && res.status !== 'MISSING_KEY') {
          hadError = true;
        }
      } catch {
        hadError = true;
      }
    });
  }

  if (anilistId) {
    tasks.push(async () => {
      try {
        const map = await fetchAniListMediaByIds([anilistId], {
          signal,
          fetchImpl,
          nowFn,
        });
        const media = map.get(anilistId) || null;
        if (media?.backdropUrl) {
          resolvedUrl = resolvedUrl || media.backdropUrl;
        }
      } catch {
        hadError = true;
      }
    });
  }

  if (tasks.length === 0) {
    return {
      attempted: false,
      backdropUrl: null,
      checkedAt: prevChecked || null,
      failed: false,
    };
  }

  const safeConc = Math.max(1, Math.min(2, Number(maxConcurrency) || 2));
  await runBoundedConcurrency(tasks, safeConc);

  return {
    attempted: true,
    backdropUrl: resolvedUrl,
    checkedAt: now,
    failed: !resolvedUrl && hadError,
  };
}

/**
 * Busca sugestões externas baseadas nos gêneros e focos escolhidos no onboarding (Fase 5):
 * - Reutiliza TMDB /discover e AniList GraphQL com cache de 24 h (D4) e máx. 2 reqs simultâneas.
 * - Nunca chama OMDb e nunca retorna obras já presentes no catálogo.
 */
export async function fetchOnboardingGenreSuggestions(
  profile = null,
  existingItems = [],
  {
    tmdbApiKey = '',
    forceRefresh = false,
    allowStaleOffline = true,
    signal,
    fetchImpl = fetch,
    nowFn = Date.now,
    maxConcurrency = 2,
  } = {}
) {
  const safeFocus = normalizeViewerFocusList(
    profile?.viewerFocus ?? profile?.viewer_focus,
    profile?.readerFocus ?? profile?.reader_focus
  );
  const genres = migrateFavoriteGenresToObjects(profile?.favoriteGenres);

  const tmdbMovieGenres = Array.from(
    new Set(
      genres
        .filter((g) => g.group === 'filmes' && Number(g.tmdbGenreId) > 0)
        .map((g) => Number(g.tmdbGenreId))
    )
  );
  const tmdbTvGenres = Array.from(
    new Set(
      genres
        .filter((g) => g.group === 'series' && Number(g.tmdbGenreId) > 0)
        .map((g) => Number(g.tmdbGenreId))
    )
  );
  const anilistGenres = Array.from(
    new Set(
      genres
        .filter((g) => g.group === 'animes' && g.kind === 'genre' && g.anilistKey)
        .map((g) => String(g.anilistKey))
    )
  );
  const anilistTags = Array.from(
    new Set(
      genres
        .filter((g) => g.group === 'animes' && g.kind === 'tag' && g.anilistKey)
        .map((g) => String(g.anilistKey))
    )
  );

  const wantsAnime =
    safeFocus.some((f) => /anime/i.test(f)) ||
    anilistGenres.length > 0 ||
    anilistTags.length > 0;
  const wantsSeries =
    safeFocus.some((f) => /s[eé]rie/i.test(f)) || tmdbTvGenres.length > 0;
  const wantsMovies =
    safeFocus.some((f) => /filme|cinema/i.test(f)) || tmdbMovieGenres.length > 0 || !wantsAnime;

  const focusSig = safeFocus.join(',').toLowerCase();
  const genresSig = genres.map((g) => g.id).sort().join(',');
  const cacheKey = `home:discover:${focusSig}:${genresSig || 'default'}`;
  const now = nowFn();

  const cached = forceRefresh
    ? { hit: false, stale: false, data: null }
    : await getCachedEntry(CACHE_STORES.search, cacheKey, {
        now,
        allowStaleOffline,
      });

  const filterExistingOut = (rawCandidates = []) => {
    const existingIds = new Set();
    const existingTitles = new Set();
    (Array.isArray(existingItems) ? existingItems : []).forEach((w) => {
      if (!w) return;
      const tmdb = Number(w.ids?.tmdb || w.tmdbId);
      const ani = Number(w.ids?.anilist || w.anilistId);
      const mal = Number(w.ids?.mal || w.malId);
      const imdb = sanitizeImdbId(w.ids?.imdb || w.imdbId);
      if (Number.isInteger(tmdb) && tmdb > 0) existingIds.add(`tmdb:${tmdb}`);
      if (Number.isInteger(ani) && ani > 0) existingIds.add(`ani:${ani}`);
      if (Number.isInteger(mal) && mal > 0) existingIds.add(`mal:${mal}`);
      if (imdb) existingIds.add(`imdb:${imdb}`);
      const nt = normalizeTitleForDedup(w.title || '');
      const no = normalizeTitleForDedup(w.originalTitle || '');
      if (nt) existingTitles.add(nt);
      if (no) existingTitles.add(no);
    });

    return rawCandidates.filter((cand) => {
      if (!cand || !cand.title) return false;
      const tmdb = Number(cand.ids?.tmdb || cand.tmdbId);
      const ani = Number(cand.ids?.anilist || cand.anilistId);
      const mal = Number(cand.ids?.mal || cand.malId);
      const imdb = sanitizeImdbId(cand.ids?.imdb || cand.imdbId);
      if (Number.isInteger(tmdb) && existingIds.has(`tmdb:${tmdb}`)) return false;
      if (Number.isInteger(ani) && existingIds.has(`ani:${ani}`)) return false;
      if (Number.isInteger(mal) && existingIds.has(`mal:${mal}`)) return false;
      if (imdb && existingIds.has(`imdb:${imdb}`)) return false;
      const nt = normalizeTitleForDedup(cand.title);
      if (nt && existingTitles.has(nt)) return false;
      return true;
    });
  };

  if (cached.hit && !cached.stale && Array.isArray(cached.data)) {
    return {
      ok: true,
      fromCache: true,
      isOfflineCache: false,
      cacheDateLabel: cached.cacheDateLabel,
      results: filterExistingOut(cached.data),
      failedSources: [],
      partial: false,
      allFailed: false,
    };
  }

  const key = sanitizeApiKey(tmdbApiKey) || loadTmdbApiKey();
  const tasks = [];
  const collected = [];
  const failedSources = [];

  if (key && (wantsMovies || wantsSeries)) {
    if (wantsMovies && (tmdbMovieGenres.length > 0 || safeFocus.some((f) => /filme|cinema/i.test(f)))) {
      tasks.push(async () => {
        try {
          const genreParam =
            tmdbMovieGenres.length > 0
              ? `&with_genres=${encodeURIComponent(tmdbMovieGenres.slice(0, 3).join('|'))}`
              : '';
          const url = `${TMDB_API_BASE}/discover/movie?api_key=${encodeURIComponent(key)}&language=pt-BR&sort_by=popularity.desc&vote_count.gte=150${genreParam}`;
          const res = await fetchWithTimeout(url, { signal, nowFn }, API_TIMEOUT_MS, fetchImpl, 'tmdb');
          if (!res.ok) throw new Error(`TMDB HTTP ${res.status}`);
          const json = await res.json();
          const list = Array.isArray(json?.results) ? json.results.slice(0, 8) : [];
          list.forEach((m) => {
            if (!m?.title) return;
            const year = m.release_date ? Number(String(m.release_date).slice(0, 4)) : null;
            const poster = m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null;
            const backdrop = m.backdrop_path ? `${TMDB_BACKDROP_BASE}${m.backdrop_path}` : null;
            collected.push(
              applyCanonicalIdsToWork({
                id: `tmdb-movie-${m.id}`,
                tmdbId: m.id,
                tmdbMediaType: 'movie',
                title: m.title,
                originalTitle: m.original_title || m.title,
                workType: 'movie',
                releaseYear: Number.isFinite(year) ? year : null,
                coverUrl: poster,
                backdropUrl: backdrop,
                synopsis: String(m.overview || '').trim(),
                genres: [],
                externalRatings: {
                  ...createEmptyExternalRatings(),
                  tmdb: buildTmdbRating(m.vote_average, m.vote_count, nowFn()),
                },
                sourceBadge: 'TMDB',
                mergedSources: ['TMDB'],
                monogram: buildMonogram(m.title),
              })
            );
          });
        } catch {
          if (!failedSources.includes('tmdb')) failedSources.push('tmdb');
        }
      });
    }

    if (wantsSeries && (tmdbTvGenres.length > 0 || safeFocus.some((f) => /s[eé]rie/i.test(f)))) {
      tasks.push(async () => {
        try {
          const genreParam =
            tmdbTvGenres.length > 0
              ? `&with_genres=${encodeURIComponent(tmdbTvGenres.slice(0, 3).join('|'))}`
              : '';
          const url = `${TMDB_API_BASE}/discover/tv?api_key=${encodeURIComponent(key)}&language=pt-BR&sort_by=popularity.desc&vote_count.gte=120${genreParam}`;
          const res = await fetchWithTimeout(url, { signal, nowFn }, API_TIMEOUT_MS, fetchImpl, 'tmdb');
          if (!res.ok) throw new Error(`TMDB HTTP ${res.status}`);
          const json = await res.json();
          const list = Array.isArray(json?.results) ? json.results.slice(0, 8) : [];
          list.forEach((s) => {
            if (!s?.name) return;
            const year = s.first_air_date ? Number(String(s.first_air_date).slice(0, 4)) : null;
            const poster = s.poster_path ? `https://image.tmdb.org/t/p/w500${s.poster_path}` : null;
            const backdrop = s.backdrop_path ? `${TMDB_BACKDROP_BASE}${s.backdrop_path}` : null;
            collected.push(
              applyCanonicalIdsToWork({
                id: `tmdb-tv-${s.id}`,
                tmdbId: s.id,
                tmdbMediaType: 'tv',
                title: s.name,
                originalTitle: s.original_name || s.name,
                workType: 'series',
                releaseYear: Number.isFinite(year) ? year : null,
                coverUrl: poster,
                backdropUrl: backdrop,
                synopsis: String(s.overview || '').trim(),
                genres: [],
                externalRatings: {
                  ...createEmptyExternalRatings(),
                  tmdb: buildTmdbRating(s.vote_average, s.vote_count, nowFn()),
                },
                sourceBadge: 'TMDB',
                mergedSources: ['TMDB'],
                monogram: buildMonogram(s.name),
              })
            );
          });
        } catch {
          if (!failedSources.includes('tmdb')) failedSources.push('tmdb');
        }
      });
    }
  }

  if (wantsAnime) {
    tasks.push(async () => {
      try {
        const gql = `
          query ($genres: [String], $tags: [String]) {
            Page(page: 1, perPage: 10) {
              media(type: ANIME, sort: SCORE_DESC, isAdult: false, genre_in: $genres, tag_in: $tags) {
                id
                idMal
                type
                format
                status
                episodes
                duration
                seasonYear
                startDate { year }
                averageScore
                genres
                bannerImage
                description(asHtml: false)
                title { romaji english native }
                coverImage { extraLarge large medium }
                studios(isMain: true) { nodes { name } }
              }
            }
          }
        `;
        const variables = {
          genres: anilistGenres.length > 0 ? anilistGenres.slice(0, 4) : undefined,
          tags: anilistTags.length > 0 ? anilistTags.slice(0, 3) : undefined,
        };
        const res = await fetchWithTimeout(
          ANILIST_GRAPHQL_URL,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ query: gql, variables }),
            signal,
            nowFn,
          },
          API_TIMEOUT_MS,
          fetchImpl,
          'anilist'
        );
        if (!res.ok) throw new Error(`AniList HTTP ${res.status}`);
        const json = await res.json();
        const list = Array.isArray(json?.data?.Page?.media) ? json.data.Page.media : [];
        list.forEach((m) => {
          const item = normalizeAniListMedia(m);
          if (item) collected.push(item);
        });
      } catch {
        if (!failedSources.includes('anilist')) failedSources.push('anilist');
      }
    });
  }

  if (tasks.length === 0) {
    return {
      ok: true,
      fromCache: false,
      isOfflineCache: false,
      cacheDateLabel: '',
      results: [],
      failedSources: [],
      partial: false,
      allFailed: false,
    };
  }

  const safeConc = Math.max(1, Math.min(2, Number(maxConcurrency) || 2));
  await runBoundedConcurrency(tasks, safeConc);

  const deduplicated = deduplicateCinemaResults(collected);
  const allFailed = tasks.length > 0 && failedSources.length > 0 && deduplicated.length === 0;

  if (allFailed && cached.hit && allowStaleOffline && Array.isArray(cached.data)) {
    return {
      ok: true,
      fromCache: true,
      isOfflineCache: true,
      cacheDateLabel: cached.cacheDateLabel,
      results: filterExistingOut(cached.data),
      failedSources,
      partial: true,
      allFailed: false,
    };
  }

  if (deduplicated.length > 0) {
    await setCachedEntry(CACHE_STORES.search, cacheKey, deduplicated, {
      ttlMs: CACHE_TTL_MS.discovery,
      now: nowFn(),
    });
  }

  return {
    ok: !allFailed,
    fromCache: false,
    isOfflineCache: false,
    cacheDateLabel: '',
    results: filterExistingOut(deduplicated),
    failedSources,
    partial: failedSources.length > 0 && deduplicated.length > 0,
    allFailed,
  };
}

/**
 * Resolve e cacheia no IndexedDB (api_cache) pôsteres 2:3 reais (coverUrl),
 * sinopse e temporadas para sugestões curadas ("Sugestões rápidas para seu catálogo"
 * e "Sugestões para Você").
 */
export async function resolveCuratedSuggestions(
  candidates = [],
  {
    tmdbApiKey = '',
    signal,
    fetchImpl = fetch,
    nowFn = Date.now,
    maxConcurrency = 2,
    forceNetwork = false,
  } = {}
) {
  const list = Array.isArray(candidates) ? candidates.filter(Boolean) : [];
  if (list.length === 0) return [];

  const results = list.map((item) => ({ ...item }));
  const tasks = [];
  const cleanTmdbKey =
    tmdbApiKey === null ? '' : sanitizeApiKey(tmdbApiKey) || loadTmdbApiKey();

  for (let idx = 0; idx < results.length; idx += 1) {
    const item = results[idx];
    const cacheKey = `suggestion:v120:${item.id || normalizeTitleKey(item.title)}`;

    tasks.push(async () => {
      if (signal?.aborted) return;

      const cached = await getRelationalApiCache(cacheKey, {
        now: nowFn(),
        allowStaleOffline: true,
      }).catch(() => ({ hit: false }));

      if (cached?.hit && !cached.stale && cached.data?.coverUrl && !forceNetwork) {
        results[idx] = {
          ...item,
          ...cached.data,
          coverUrl: cached.data.coverUrl || item.coverUrl,
          synopsis: item.synopsis || cached.data.synopsis || '',
        };
        return;
      }

      const hasValidHttpsCover =
        typeof item.coverUrl === 'string' && /^https:\/\//i.test(item.coverUrl.trim());
      if (hasValidHttpsCover && !forceNetwork) {
        await putRelationalApiCache(
          cacheKey,
          {
            coverUrl: item.coverUrl.trim(),
            backdropUrl: item.backdropUrl || null,
            synopsis: item.synopsis || '',
            totalSeasons: item.totalSeasons || null,
            totalEpisodes: item.totalEpisodes || null,
            episodesPerSeason: item.episodesPerSeason || null,
          },
          { ttlMs: 30 * 24 * 60 * 60 * 1000, now: nowFn() }
        ).catch(() => {});
        return;
      }

      const patch = {};
      const queryTitle = String(item.originalTitle || item.title || '').trim();

      try {
        if (item.workType === 'anime') {
          const anilistId = Number(item.ids?.anilist || item.anilistId) || null;
          const gql = anilistId
            ? `query ($id: Int) { Media(id: $id, type: ANIME) { id idMal episodes bannerImage description(asHtml: false) coverImage { extraLarge large } } }`
            : `query ($search: String) { Media(search: $search, type: ANIME) { id idMal episodes bannerImage description(asHtml: false) coverImage { extraLarge large } } }`;
          const variables = anilistId ? { id: anilistId } : { search: queryTitle };
          const res = await fetchWithTimeout(
            ANILIST_GRAPHQL_URL,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
              body: JSON.stringify({ query: gql, variables }),
              signal,
              nowFn,
            },
            API_TIMEOUT_MS,
            fetchImpl,
            'anilist'
          );
          if (res.ok) {
            const json = await res.json();
            const media = json?.data?.Media;
            const cover = media?.coverImage?.extraLarge || media?.coverImage?.large || '';
            if (cover) patch.coverUrl = cover.replace(/^http:\/\//i, 'https://');
            if (media?.bannerImage) patch.backdropUrl = media.bannerImage.replace(/^http:\/\//i, 'https://');
            if (media?.description && !item.synopsis) {
              patch.synopsis = stripHtmlTags(media.description);
            }
            if (Number(media?.episodes) > 0 && !item.totalEpisodes) {
              patch.totalEpisodes = Number(media.episodes);
            }
          }
        } else if (item.workType === 'series') {
          const tvmazeId = Number(item.ids?.tvmaze || item.tvmazeId) || null;
          const imdbId = item.ids?.imdb || item.imdbId || '';
          let showJson = null;

          if (tvmazeId) {
            const r = await fetchWithTimeout(
              `${TVMAZE_SHOW_URL}/${tvmazeId}`,
              { signal, nowFn },
              API_TIMEOUT_MS,
              fetchImpl,
              'tvmaze'
            );
            if (r.ok) showJson = await r.json();
          } else if (imdbId) {
            const r = await fetchWithTimeout(
              `${TVMAZE_LOOKUP_URL}?imdb=${encodeURIComponent(imdbId)}`,
              { signal, nowFn },
              API_TIMEOUT_MS,
              fetchImpl,
              'tvmaze'
            );
            if (r.ok) showJson = await r.json();
          } else if (queryTitle) {
            const r = await fetchWithTimeout(
              `https://api.tvmaze.com/singlesearch/shows?q=${encodeURIComponent(queryTitle)}`,
              { signal, nowFn },
              API_TIMEOUT_MS,
              fetchImpl,
              'tvmaze'
            );
            if (r.ok) showJson = await r.json();
          }

          const cover = showJson?.image?.original || showJson?.image?.medium || '';
          if (cover) patch.coverUrl = cover.replace(/^http:\/\//i, 'https://');
          if (showJson?.summary && !item.synopsis) {
            patch.synopsis = stripHtmlTags(showJson.summary);
          }
          if (showJson?.id) {
            patch.tvmazeId = Number(showJson.id);
          }
        }

        // Fallback via TMDB ou IMDb Suggestion para filmes ou séries sem capa
        if (!patch.coverUrl) {
          const tmdbId = Number(item.ids?.tmdb || item.tmdbId) || null;
          if (tmdbId) {
            const endpoint = item.workType === 'series' ? 'tv' : 'movie';
            const outcome = await fetchTmdbViaProxyOrDirect(
              `${endpoint}/${tmdbId}`,
              { language: 'pt-BR' },
              { directApiKey: cleanTmdbKey, signal, nowFn, timeoutMs: API_TIMEOUT_MS, fetchImpl }
            );
            const r = outcome.res;
            if (!outcome.missingKey && r && r.ok) {
              const tmdbJson = await r.json();
              if (tmdbJson?.poster_path) {
                patch.coverUrl = `https://image.tmdb.org/t/p/w500${tmdbJson.poster_path}`;
              }
              if (tmdbJson?.backdrop_path) {
                patch.backdropUrl = `https://image.tmdb.org/t/p/w1280${tmdbJson.backdrop_path}`;
              }
              if (tmdbJson?.overview && !item.synopsis) {
                patch.synopsis = String(tmdbJson.overview).trim();
              }
            }
          }
        }

        if (!patch.coverUrl && queryTitle) {
          const cleanSlug = queryTitle
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
          if (cleanSlug) {
            const firstLetter = cleanSlug[0] || 'a';
            const r = await fetchWithTimeout(
              `${IMDB_SUGGESTION_BASE}/${firstLetter}/${encodeURIComponent(cleanSlug)}.json`,
              { signal, nowFn },
              API_TIMEOUT_MS,
              fetchImpl,
              'imdb'
            );
            if (r.ok) {
              const json = await r.json();
              const entries = Array.isArray(json?.d) ? json.d : [];
              const targetImdb = item.ids?.imdb || item.imdbId || '';
              const matched =
                entries.find((e) => targetImdb && e.id === targetImdb && e.i?.imageUrl) ||
                entries.find((e) => e.i?.imageUrl);
              if (matched?.i?.imageUrl) {
                patch.coverUrl = String(matched.i.imageUrl).replace(/^http:\/\//i, 'https://');
              }
            }
          }
        }
      } catch {
        // Falha silenciosa preservando item original ou cache offline
      }

      if (patch.coverUrl) {
        results[idx] = {
          ...item,
          ...patch,
        };
        await putRelationalApiCache(cacheKey, patch, {
          ttlMs: 30 * 24 * 60 * 60 * 1000,
          now: nowFn(),
        }).catch(() => {});
      } else if (cached?.hit && cached.data?.coverUrl) {
        results[idx] = {
          ...item,
          ...cached.data,
        };
      }
    });
  }

  const safeConc = Math.max(1, Math.min(2, Number(maxConcurrency) || 2));
  await runBoundedConcurrency(tasks, safeConc);
  return results;
}

export const BRAZIL_STREAMING_CATALOG = Object.freeze([
  { id: 'netflix', label: 'Netflix', pattern: /netflix/i },
  { id: 'crunchyroll', label: 'Crunchyroll', pattern: /crunchyroll/i },
  { id: 'prime-video', label: 'Prime Video', pattern: /amazon\s*prime|prime\s*video/i },
  { id: 'max', label: 'Max', pattern: /\b(hbo\s*max|max)\b/i },
  { id: 'disney-plus', label: 'Disney+', pattern: /disney\s*\+|disney\s*plus/i },
  { id: 'apple-tv-plus', label: 'Apple TV+', pattern: /apple\s*tv/i },
  { id: 'globoplay', label: 'Globoplay', pattern: /globoplay/i },
]);

export function normalizeBrazilStreamingProviders(
  tmdbBrBlock = null,
  externalLinksOrList = []
) {
  const rawNames = [];

  if (Array.isArray(tmdbBrBlock)) {
    tmdbBrBlock.forEach((entry) => {
      if (typeof entry === 'string') rawNames.push(entry);
      else if (entry?.provider_name || entry?.name || entry?.site) {
        rawNames.push(entry.provider_name || entry.name || entry.site);
      }
    });
  } else if (tmdbBrBlock && typeof tmdbBrBlock === 'object') {
    const pools = [
      ...(Array.isArray(tmdbBrBlock.flatrate) ? tmdbBrBlock.flatrate : []),
      ...(Array.isArray(tmdbBrBlock.ads) ? tmdbBrBlock.ads : []),
      ...(Array.isArray(tmdbBrBlock.free) ? tmdbBrBlock.free : []),
    ];
    pools.forEach((p) => {
      if (p?.provider_name) rawNames.push(p.provider_name);
    });
  }

  if (Array.isArray(externalLinksOrList)) {
    externalLinksOrList.forEach((lnk) => {
      if (typeof lnk === 'string') {
        rawNames.push(lnk);
      } else if (lnk && typeof lnk === 'object') {
        const isStreaming =
          !lnk.type || String(lnk.type).toUpperCase() === 'STREAMING';
        if (isStreaming && (lnk.site || lnk.name || lnk.provider_name)) {
          rawNames.push(lnk.site || lnk.name || lnk.provider_name);
        }
      }
    });
  }

  const matched = [];
  const seen = new Set();
  for (const raw of rawNames) {
    const clean = String(raw || '').trim();
    if (!clean) continue;
    const provider = BRAZIL_STREAMING_CATALOG.find((p) => p.pattern.test(clean));
    if (provider && !seen.has(provider.label)) {
      seen.add(provider.label);
      matched.push(provider.label);
    }
  }
  return matched;
}

export async function fetchBrazilStreamingProviders(
  work = {},
  { tmdbApiKey = '', fetchImpl = fetch, signal } = {}
) {
  if (!work || typeof work !== 'object') return [];
  const existing = normalizeBrazilStreamingProviders(
    work.streamingProvidersBR || [],
    work.externalLinks || []
  );

  const tmdbId = work.ids?.tmdb || work.tmdbId;
  const key = sanitizeApiKey(tmdbApiKey) || loadTmdbApiKey();
  if (!tmdbId) {
    return existing;
  }

  const type =
    work.tmdbMediaType === 'tv' ||
    work.workType === 'series' ||
    work.workType === 'anime'
      ? 'tv'
      : 'movie';
  try {
    const outcome = await fetchTmdbViaProxyOrDirect(
      `${type}/${encodeURIComponent(tmdbId)}/watch/providers`,
      {},
      { directApiKey: key, signal, timeoutMs: API_TIMEOUT_MS, fetchImpl }
    );
    if (outcome.missingKey || !outcome.res || !outcome.res.ok) return existing;
    const json = await outcome.res.json();
    const brProviders = normalizeBrazilStreamingProviders(
      json?.results?.BR || null,
      existing
    );
    return Array.from(new Set([...existing, ...brProviders]));
  } catch {
    return existing;
  }
}

export function formatWorkStructureBadge(work = {}) {
  if (!work || typeof work !== 'object') return '';
  if (work.workType === 'movie' || work.animeFormat === 'Filme') {
    const mins = Number(work.durationMinutes) || 0;
    if (mins <= 0) return 'Filme';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
  }

  const seasons = Math.max(1, Number(work.totalSeasons) || 1);
  const eps = Number(work.totalEpisodes) || 0;
  const rawStatus = String(
    work.animeStatus || work.showStatus || work.tmdbStatus || ''
  ).toLowerCase();
  const isOngoing =
    /releasing|running|returning|currently airing|em exibi/i.test(rawStatus);

  if (work.workType === 'anime' && seasons === 1 && eps > 0) {
    const formattedEps = eps >= 1000 ? eps.toLocaleString('pt-BR') : String(eps);
    if (isOngoing) {
      return `${formattedEps}+ Episódios · Em exibição`;
    }
    return `${formattedEps} Episódios`;
  }

  if (work.workType === 'anime' && eps === 0) {
    const relInfo = formatAnimeEpisodeCountLabel(work);
    if (relInfo.kind === 'released-so-far' && relInfo.label) {
      return isOngoing ? `${relInfo.label} · Em exibição` : relInfo.label;
    }
  }

  const parts = [];
  if (seasons > 1 || work.workType === 'series') {
    parts.push(`${seasons} ${seasons === 1 ? 'Temporada' : 'Temporadas'}`);
  }
  if (eps > 0) {
    const formattedEps = eps >= 1000 ? eps.toLocaleString('pt-BR') : String(eps);
    parts.push(`${formattedEps}${isOngoing ? '+' : ''} Episódios`);
  }
  if (isOngoing) {
    parts.push('Em exibição');
  }
  return parts.join(' · ');
}


export { getOmdbDailyUsage };
