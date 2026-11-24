/**
 * Constantes centralizadas de limites de taxa, timeouts e TTL de cache (D4).
 * Módulo puro em .js sem dependência de React ou DOM (D7).
 */

export const API_TIMEOUT_MS = 8000;
export const DEFAULT_MAX_RETRIES = 2;
export const RETRY_BASE_DELAY_MS = 400;
export const MAX_RETRY_AFTER_MS = 60_000;

export const OMDB_KEY_STORAGE = 'cine_codice_omdb_key_v1';
export const OMDB_DAILY_COUNTER_STORAGE_KEY = 'cine_codice_omdb_daily_counter_v1';

export const PROVIDER_LIMITS = Object.freeze({
  anilist: Object.freeze({
    id: 'anilist',
    label: 'AniList',
    maxRequests: 30,
    windowMs: 60_000,
    minIntervalMs: 350,
    respectRateLimitHeaders: true,
    dailyLimit: null,
    autoStopRatio: null,
  }),
  jikan: Object.freeze({
    id: 'jikan',
    label: 'Jikan (MAL)',
    maxRequestsPerSec: 3,
    secWindowMs: 1000,
    maxRequests: 60,
    windowMs: 60_000,
    minIntervalMs: 350,
    respectRateLimitHeaders: false,
    dailyLimit: null,
    autoStopRatio: null,
  }),
  omdb: Object.freeze({
    id: 'omdb',
    label: 'OMDb',
    maxRequests: 20,
    windowMs: 10_000,
    minIntervalMs: 100,
    respectRateLimitHeaders: false,
    dailyLimit: 1000,
    autoStopRatio: 0.9,
  }),
  tvmaze: Object.freeze({
    id: 'tvmaze',
    label: 'TVmaze',
    maxRequests: 20,
    windowMs: 10_000,
    minIntervalMs: 120,
    respectRateLimitHeaders: false,
    dailyLimit: null,
    autoStopRatio: null,
  }),
  tmdb: Object.freeze({
    id: 'tmdb',
    label: 'TMDB',
    maxRequests: 35,
    windowMs: 10_000,
    minIntervalMs: 60,
    respectRateLimitHeaders: false,
    dailyLimit: null,
    autoStopRatio: null,
  }),
  imdb: Object.freeze({
    id: 'imdb',
    label: 'IMDb Suggestion',
    maxRequests: 15,
    windowMs: 10_000,
    minIntervalMs: 120,
    respectRateLimitHeaders: false,
    dailyLimit: null,
    autoStopRatio: null,
  }),
  wikidata: Object.freeze({
    id: 'wikidata',
    label: 'Wikidata',
    maxRequests: 15,
    windowMs: 10_000,
    minIntervalMs: 120,
    respectRateLimitHeaders: false,
    dailyLimit: null,
    autoStopRatio: null,
  }),
  internetArchive: Object.freeze({
    id: 'internetArchive',
    label: 'Internet Archive',
    maxRequests: 15,
    windowMs: 10_000,
    minIntervalMs: 120,
    respectRateLimitHeaders: false,
    dailyLimit: null,
    autoStopRatio: null,
  }),
  musicbrainz: Object.freeze({
    id: 'musicbrainz',
    label: 'MusicBrainz',
    maxRequestsPerSec: 1,
    secWindowMs: 1000,
    maxRequests: 60,
    windowMs: 60_000,
    minIntervalMs: 1000,
    respectRateLimitHeaders: false,
    dailyLimit: null,
    autoStopRatio: null,
  }),
  lastfm: Object.freeze({
    id: 'lastfm',
    label: 'Last.fm',
    maxRequests: 15,
    windowMs: 10_000,
    minIntervalMs: 250,
    respectRateLimitHeaders: false,
    dailyLimit: null,
    autoStopRatio: null,
  }),
});

export const CACHE_DB_NAME = 'cine_codice_api_cache_v1';
export const CACHE_SCHEMA_VERSION = 1;

export const CACHE_STORES = Object.freeze({
  ratings: 'ratings',
  episodes: 'episodes',
  relations: 'relations',
  search: 'search',
});

export const DURABLE_STORES = Object.freeze({
  episodeEvaluations: 'episodeEvaluations',
});

export const CACHE_TTL_MS = Object.freeze({
  ratings: 7 * 24 * 60 * 60 * 1000,
  episodesOngoing: 12 * 60 * 60 * 1000,
  episodesFinished: 30 * 24 * 60 * 60 * 1000,
  relations: 7 * 24 * 60 * 60 * 1000,
  discovery: 24 * 60 * 60 * 1000,
  search: 10 * 60 * 1000,
});

export const BACKDROP_RETRY_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

export const MAX_MEMORY_CACHE_ENTRIES_PER_STORE = 300;

export const RELATIONAL_DB_NAME = 'cine_codice_relational_v2';
export const RELATIONAL_DB_VERSION = 2;
export const PRE_V12_BACKUP_KEY = 'cine_codice_backup_pre_v1_2';
export const RELATIONAL_MIGRATED_KEY = 'cine_codice_relational_v2_migrated';
export const RELATIONAL_SCHEMA_VERSION_KEY = 'omniprism_relational_schema_version_v1';
export const PRE_SCHEMA_MIGRATION_BACKUP_KEY = 'omniprism_backup_pre_schema_migration_v1';

export const RELATIONAL_STORES = Object.freeze({
  works: 'works',
  seasonProgress: 'season_progress',
  episodeReviews: 'episode_reviews',
  sessionsLog: 'sessions_log',
  apiCache: 'api_cache',
});
