import { catalogItems } from '../data/mockData.js';
import {
  mapCategoriesToGenreAndSubgenres,
  normalizeLanguageLabel,
} from '../utils/genreMapper.js';

const ANILIST_GRAPHQL_URL = 'https://graphql.anilist.co';
const JIKAN_ANIME_URL = 'https://api.jikan.moe/v4/anime';
const TVMAZE_SEARCH_URL = 'https://api.tvmaze.com/search/shows';
const TVMAZE_SHOW_URL = 'https://api.tvmaze.com/shows';
const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const IMDB_SUGGESTION_BASE = 'https://v3.sg.media-imdb.com/suggestion';
const WIKIDATA_API_URL = 'https://www.wikidata.org/w/api.php';
const INTERNET_ARCHIVE_SEARCH_URL = 'https://archive.org/advancedsearch.php';

export const TMDB_KEY_STORAGE = 'cine_codice_tmdb_key_v1';
export const CINEMA_SOURCES_STORAGE_KEY = 'cine_codice_active_sources_v1';
const SEARCH_CACHE_KEY = 'cine_codice_search_cache_v1';
const IDB_SEARCH_CACHE_DB = 'cine_codice_search_cache_idb_v1';
const IDB_SEARCH_CACHE_STORE = 'queries';

const MEMORY_CACHE_TTL_MS = 15 * 60 * 1000;
const IDB_SEARCH_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 80;
export const API_TIMEOUT_MS = 8000;
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
    // Fallback para env
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
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_SEARCH_CACHE_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_SEARCH_CACHE_STORE)) {
          db.createObjectStore(IDB_SEARCH_CACHE_STORE, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function getIdbCachedSearch(key) {
  const db = await openSearchCacheIdb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_SEARCH_CACHE_STORE, 'readonly');
      const req = tx.objectStore(IDB_SEARCH_CACHE_STORE).get(key);
      req.onsuccess = () => {
        const rec = req.result;
        db.close();
        if (!rec || Date.now() - Number(rec.timestamp || 0) >= IDB_SEARCH_CACHE_TTL_MS) {
          resolve(null);
          return;
        }
        resolve(rec);
      };
      req.onerror = () => {
        db.close();
        resolve(null);
      };
    } catch {
      resolve(null);
    }
  });
}

export async function setIdbCachedSearch(key, payload) {
  const db = await openSearchCacheIdb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_SEARCH_CACHE_STORE, 'readwrite');
      tx.objectStore(IDB_SEARCH_CACHE_STORE).put({
        key,
        ...payload,
        timestamp: Date.now(),
      });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      resolve();
    }
  });
}

async function fetchWithTimeout(url, options = {}, timeoutMs = API_TIMEOUT_MS, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const externalSignal = options.signal;
  const onAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    return await fetchImpl(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener('abort', onAbort);
  }
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

  return {
    id: `anilist-${media.id}`,
    anilistId: media.id,
    malId: media.idMal || null,
    title,
    originalTitle,
    director: studio,
    studio,
    workType: 'anime',
    animeFormat,
    releaseYear: year,
    totalSeasons: 1,
    totalEpisodes: Number(media.episodes) > 0 ? Number(media.episodes) : null,
    episodeDurationMinutes: Number(media.duration) > 0 ? Number(media.duration) : 24,
    durationMinutes: Number(media.duration) > 0 ? Number(media.duration) : null,
    totalSeconds:
      animeFormat === 'Filme' && Number(media.duration) > 0
        ? Number(media.duration) * 60
        : null,
    genres,
    synopsis: stripHtmlTags(media.description || ''),
    coverUrl,
    coverCandidates: [coverUrl].filter(Boolean),
    franchiseRelations: relations,
    externalScore: media.averageScore || null,
    sourceBadge: 'AniList',
    mergedSources: ['AniList'],
    monogram: buildMonogram(title),
  };
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
          episodes
          duration
          seasonYear
          startDate { year }
          averageScore
          genres
          description(asHtml: false)
          coverImage { extraLarge large medium }
          studios(isMain: true) { nodes { name } }
          relations {
            edges {
              relationType
              node {
                id
                idMal
                type
                format
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
    fetchImpl
  );

  if (!res.ok) throw new Error(`AniList HTTP ${res.status}`);
  const json = await res.json();
  const list = json?.data?.Page?.media || [];
  return list.map(normalizeAniListMedia).filter(Boolean);
}

async function searchJikan(query, { signal, fetchImpl = fetch, timeoutMs = API_TIMEOUT_MS } = {}) {
  const url = `${JIKAN_ANIME_URL}?q=${encodeURIComponent(query)}&limit=${MAX_RESULTS_PER_SOURCE}&sfw=true`;
  const res = await fetchWithTimeout(url, { signal }, timeoutMs, fetchImpl);
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

      return {
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
        sourceBadge: 'MAL',
        mergedSources: ['MAL'],
        monogram: buildMonogram(title),
      };
    })
    .filter(Boolean);
}

async function searchTvMaze(query, { signal, fetchImpl = fetch, timeoutMs = API_TIMEOUT_MS } = {}) {
  const url = `${TVMAZE_SEARCH_URL}?q=${encodeURIComponent(query)}`;
  const res = await fetchWithTimeout(url, { signal }, timeoutMs, fetchImpl);
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

      return {
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
      };
    })
    .filter(Boolean);
}

export async function fetchTvMazeShowDetails(
  tvmazeId,
  { signal, fetchImpl = fetch, timeoutMs = API_TIMEOUT_MS } = {}
) {
  if (!tvmazeId) return null;
  try {
    const [seasonsRes, episodesRes] = await Promise.all([
      fetchWithTimeout(`${TVMAZE_SHOW_URL}/${tvmazeId}/seasons`, { signal }, timeoutMs, fetchImpl),
      fetchWithTimeout(`${TVMAZE_SHOW_URL}/${tvmazeId}/episodes`, { signal }, timeoutMs, fetchImpl),
    ]);
    const seasons = seasonsRes.ok ? await seasonsRes.json() : [];
    const episodes = episodesRes.ok ? await episodesRes.json() : [];
    if (!Array.isArray(episodes) || episodes.length === 0) return null;

    const bySeason = new Map();
    const episodeList = [];
    let durationSum = 0;
    let durationCount = 0;

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
      });
    });

    const maxSeason = Math.max(
      Array.isArray(seasons) ? seasons.length : 0,
      ...Array.from(bySeason.keys()),
      1
    );
    const episodesPerSeason = [];
    for (let s = 1; s <= maxSeason; s += 1) {
      episodesPerSeason.push(bySeason.get(s) || 1);
    }

    return {
      totalSeasons: maxSeason,
      totalEpisodes: episodes.length,
      episodesPerSeason,
      episodeList,
      episodeDurationMinutes: durationCount > 0 ? Math.round(durationSum / durationCount) : null,
    };
  } catch {
    return null;
  }
}

async function searchTmdb(
  query,
  { filter = 'all', apiKey = '', signal, fetchImpl = fetch, timeoutMs = API_TIMEOUT_MS } = {}
) {
  const key = sanitizeApiKey(apiKey) || loadTmdbApiKey();
  if (!key) return [];

  const endpoint =
    filter === 'movie'
      ? `${TMDB_API_BASE}/search/movie`
      : filter === 'series'
        ? `${TMDB_API_BASE}/search/tv`
        : `${TMDB_API_BASE}/search/multi`;

  const url = `${endpoint}?api_key=${encodeURIComponent(key)}&language=pt-BR&include_adult=false&query=${encodeURIComponent(query)}`;
  const res = await fetchWithTimeout(url, { signal }, timeoutMs, fetchImpl);
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
      const isAnime =
        Array.isArray(r.genre_ids) &&
        r.genre_ids.includes(16) &&
        (r.original_language === 'ja' || (Array.isArray(r.origin_country) && r.origin_country.includes('JP')));
      const workType = isAnime ? 'anime' : mType === 'tv' ? 'series' : 'movie';
      const rawGenres = (Array.isArray(r.genre_ids) ? r.genre_ids : [])
        .map((gid) => TMDB_GENRE_MAP[gid])
        .filter(Boolean);
      const coverUrl = r.poster_path ? `https://image.tmdb.org/t/p/w500${r.poster_path}` : null;

      return {
        id: `tmdb-${mType}-${r.id}`,
        tmdbId: r.id,
        tmdbMediaType: mType,
        title,
        originalTitle,
        workType,
        releaseYear: Number.isFinite(year) ? year : null,
        genres: mapCategoriesToGenreAndSubgenres(rawGenres, { workType }).genres,
        language: normalizeLanguageLabel(r.original_language || ''),
        synopsis: String(r.overview || '').trim(),
        coverUrl,
        coverCandidates: [coverUrl].filter(Boolean),
        externalScore: r.vote_average ? Math.round(r.vote_average * 10) : null,
        sourceBadge: 'TMDB',
        mergedSources: ['TMDB'],
        monogram: buildMonogram(title),
      };
    })
    .filter(Boolean);
}

export async function fetchTmdbDetails(
  tmdbId,
  mediaType = 'movie',
  { apiKey = '', signal, fetchImpl = fetch, timeoutMs = API_TIMEOUT_MS } = {}
) {
  const key = sanitizeApiKey(apiKey) || loadTmdbApiKey();
  if (!key || !tmdbId) return null;
  const type = mediaType === 'tv' ? 'tv' : 'movie';
  try {
    const url = `${TMDB_API_BASE}/${type}/${encodeURIComponent(tmdbId)}?api_key=${encodeURIComponent(key)}&language=pt-BR&append_to_response=credits`;
    const res = await fetchWithTimeout(url, { signal }, timeoutMs, fetchImpl);
    if (!res.ok) return null;
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

    if (type === 'movie') {
      const runtime = Number(d.runtime) || null;
      return {
        durationMinutes: runtime,
        totalSeconds: runtime ? runtime * 60 : null,
        director: directors.join(', ') || studios,
        studio: studios,
        cast,
        franchiseName: d.belongs_to_collection?.name?.replace(/\s*Collection$/i, '').trim() || '',
        synopsis: String(d.overview || '').trim(),
      };
    }

    const epRun = Array.isArray(d.episode_run_time) && d.episode_run_time[0]
      ? Number(d.episode_run_time[0])
      : null;
    const validSeasons = Array.isArray(d.seasons)
      ? d.seasons.filter((s) => Number(s.season_number) > 0)
      : [];
    const episodesPerSeason = validSeasons.map((s) => Math.max(1, Number(s.episode_count) || 1));

    return {
      totalSeasons: Number(d.number_of_seasons) || validSeasons.length || 1,
      totalEpisodes: Number(d.number_of_episodes) || null,
      episodesPerSeason,
      episodeDurationMinutes: epRun || 45,
      director: creators.join(', ') || studios,
      studio: studios,
      cast,
      synopsis: String(d.overview || '').trim(),
    };
  } catch {
    return null;
  }
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
  const res = await fetchWithTimeout(url, { signal }, timeoutMs, fetchImpl);
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
      return {
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
      };
    });
}

async function searchWikidataCinema(
  query,
  { signal, fetchImpl = fetch, timeoutMs = API_TIMEOUT_MS } = {}
) {
  const searchUrl = `${WIKIDATA_API_URL}?action=wbsearchentities&search=${encodeURIComponent(query)}&language=pt&uselang=pt&format=json&origin=*&limit=6`;
  const res = await fetchWithTimeout(searchUrl, { signal }, timeoutMs, fetchImpl);
  if (!res.ok) throw new Error(`Wikidata HTTP ${res.status}`);
  const searchJson = await res.json();
  const candidates = Array.isArray(searchJson?.search) ? searchJson.search : [];
  if (candidates.length === 0) return [];

  const ids = candidates.map((c) => c.id).join('|');
  const entityUrl = `${WIKIDATA_API_URL}?action=wbgetentities&ids=${encodeURIComponent(ids)}&props=labels|descriptions|claims&languages=pt|en|ja&format=json&origin=*`;
  const entityRes = await fetchWithTimeout(entityUrl, { signal }, timeoutMs, fetchImpl);
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
  const res = await fetchWithTimeout(url, { signal }, timeoutMs, fetchImpl);
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

  return {
    ...incoming,
    ...primary,
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
    anilistId: primary.anilistId || incoming.anilistId || null,
    malId: primary.malId || incoming.malId || null,
    tvmazeId: primary.tvmazeId || incoming.tvmazeId || null,
    tmdbId: primary.tmdbId || incoming.tmdbId || null,
    tmdbMediaType: primary.tmdbMediaType || incoming.tmdbMediaType || null,
    imdbId: primary.imdbId || incoming.imdbId || '',
    openAccessUrl: primary.openAccessUrl || incoming.openAccessUrl || '',
    franchiseRelations:
      Array.isArray(primary.franchiseRelations) && primary.franchiseRelations.length > 0
        ? primary.franchiseRelations
        : incoming.franchiseRelations || [],
    genres,
    synopsis: longerSynopsis || '',
    coverUrl: coverCandidates[0] || null,
    coverCandidates,
    sourceBadge: primary.sourceBadge || mergedSources[0],
    mergedSources,
  };
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
      const merged = mergeTwoCandidates(existing, item);
      byExactKey.set(existingKey, merged);
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
    tmdb: () => searchTmdb(cleanQuery, { filter, apiKey: tmdbApiKey, signal, fetchImpl, timeoutMs }),
    imdb: () => searchImdbSuggestion(cleanQuery, { signal, fetchImpl, timeoutMs }),
    wikidata: () => searchWikidataCinema(cleanQuery, { signal, fetchImpl, timeoutMs }),
    internetArchive: () => searchInternetArchiveMovies(cleanQuery, { signal, fetchImpl, timeoutMs }),
  };

  const runners = activeSources
    .filter((id) => typeof sourceFetchers[id] === 'function')
    .map((id) => ({ id, promise: sourceFetchers[id]() }));

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

  const filteredByType =
    filter === 'all'
      ? collected
      : collected.filter((item) => {
          if (filter === 'anime') return item.workType === 'anime';
          if (filter === 'series') return item.workType === 'series' || item.workType === 'anime';
          return item.workType === 'movie';
        });

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

export async function enrichCinemaCandidate(
  candidate,
  { tmdbApiKey = '', signal, fetchImpl = fetch } = {}
) {
  if (!candidate) return candidate;
  let enriched = { ...candidate };

  if (enriched.tvmazeId) {
    const tvDetails = await fetchTvMazeShowDetails(enriched.tvmazeId, { signal, fetchImpl });
    if (tvDetails) {
      enriched = {
        ...enriched,
        totalSeasons: tvDetails.totalSeasons,
        totalEpisodes: tvDetails.totalEpisodes,
        episodesPerSeason: tvDetails.episodesPerSeason,
        episodeList: tvDetails.episodeList,
        episodeDurationMinutes: tvDetails.episodeDurationMinutes || enriched.episodeDurationMinutes,
      };
    }
  }

  if (enriched.tmdbId) {
    const tmdbDetails = await fetchTmdbDetails(
      enriched.tmdbId,
      enriched.tmdbMediaType || (enriched.workType === 'movie' ? 'movie' : 'tv'),
      { apiKey: tmdbApiKey, signal, fetchImpl }
    );
    if (tmdbDetails) {
      enriched = {
        ...enriched,
        ...tmdbDetails,
        director: enriched.director || tmdbDetails.director || '',
        synopsis:
          String(tmdbDetails.synopsis || '').length > String(enriched.synopsis || '').length
            ? tmdbDetails.synopsis
            : enriched.synopsis,
      };
    }
  }

  return enriched;
}

export async function testTmdbConnection(apiKey = '', { fetchImpl = fetch } = {}) {
  const key = sanitizeApiKey(apiKey) || loadTmdbApiKey();
  if (!key) {
    return {
      ok: false,
      errorMessage: 'Informe uma chave de API TMDB v3 para testar.',
    };
  }
  const start = Date.now();
  try {
    const res = await fetchWithTimeout(
      `${TMDB_API_BASE}/configuration?api_key=${encodeURIComponent(key)}`,
      {},
      6000,
      fetchImpl
    );
    const latencyMs = Date.now() - start;
    if (!res.ok) {
      return {
        ok: false,
        errorMessage: res.status === 401 ? 'Chave TMDB inválida ou expirada.' : `Erro HTTP ${res.status}`,
      };
    }
    return { ok: true, latencyMs, model: 'TMDB API v3' };
  } catch {
    return {
      ok: false,
      errorMessage: 'Não foi possível conectar ao TMDB agora.',
    };
  }
}
