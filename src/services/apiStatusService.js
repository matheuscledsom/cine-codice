/**
 * Serviço de diagnóstico "Status das APIs" para os 4 domínios do OmniPrism.
 *
 * - Mede disponibilidade e tempo de resposta (ms) de cada fonte de metadados.
 * - Consulta `GET /api/status` (quando autenticado) para exibir apenas booleanos
 *   "configurado no servidor" para TMDB e OMDb.
 * - Nunca lê para exibição, registra nem retorna valores de chaves de API.
 */

import { ApiQuotaError, maskSecretsInText } from '../api/httpClient.js';
import {
  fetchBrasilApiIsbnViaProxyOrDirect,
  fetchGoogleBooksViaProxyOrDirect,
  fetchIgdbViaProxy,
  fetchLastfmViaProxy,
  fetchOmdbViaProxyOrDirect,
  fetchProxyStatus,
  fetchRawgViaProxy,
  fetchRetroAchievementsViaProxy,
  fetchSteamAchievementsViaProxy,
  fetchSteamViaProxyOrDirect,
  fetchTmdbViaProxyOrDirect,
} from './apiProxyClient.js';
import { loadOmdbApiKey, loadTmdbApiKey } from './cinemaApi.js';

export const API_STATUS_TIMEOUT_MS = 6500;

export const API_STATUS_SOURCES = Object.freeze([
  {
    id: 'tmdb',
    label: 'TMDB',
    domainId: 'cinema',
    domainLabel: 'Cinema',
    host: 'api.themoviedb.org',
    supportsServerProxy: true,
    probeType: 'tmdb',
  },
  {
    id: 'omdb',
    label: 'OMDb',
    domainId: 'cinema',
    domainLabel: 'Cinema',
    host: 'www.omdbapi.com',
    supportsServerProxy: true,
    probeType: 'omdb',
  },
  {
    id: 'anilist',
    label: 'AniList',
    domainId: 'cinema',
    domainLabel: 'Cinema',
    host: 'graphql.anilist.co',
    supportsServerProxy: false,
    probeType: 'anilist',
    url: 'https://graphql.anilist.co',
  },
  {
    id: 'jikan',
    label: 'Jikan (MAL)',
    domainId: 'cinema',
    domainLabel: 'Cinema',
    host: 'api.jikan.moe',
    supportsServerProxy: false,
    probeType: 'get',
    url: 'https://api.jikan.moe/v4/anime?q=akira&limit=1',
  },
  {
    id: 'tvmaze',
    label: 'TVmaze',
    domainId: 'cinema',
    domainLabel: 'Cinema',
    host: 'api.tvmaze.com',
    supportsServerProxy: false,
    probeType: 'get',
    url: 'https://api.tvmaze.com/search/shows?q=dark',
  },
  {
    id: 'imdb',
    label: 'IMDb',
    domainId: 'cinema',
    domainLabel: 'Cinema',
    host: 'v3.sg.media-imdb.com',
    supportsServerProxy: false,
    probeType: 'get',
    url: 'https://v3.sg.media-imdb.com/suggestion/m/matrix.json',
  },
  {
    id: 'wikidata',
    label: 'Wikidata',
    domainId: 'games',
    domainLabel: 'Cinema / Games',
    host: 'www.wikidata.org',
    supportsServerProxy: false,
    probeType: 'get',
    url: 'https://www.wikidata.org/w/api.php?action=wbsearchentities&search=matrix&language=en&limit=1&format=json&origin=*',
  },
  {
    id: 'internetArchive',
    label: 'Internet Archive',
    domainId: 'cinema',
    domainLabel: 'Cinema',
    host: 'archive.org',
    supportsServerProxy: false,
    probeType: 'get',
    url: 'https://archive.org/advancedsearch.php?q=mediatype%3Amovies&rows=1&output=json',
  },
  {
    id: 'googleBooks',
    label: 'Google Books',
    domainId: 'reading',
    domainLabel: 'Leitura',
    host: 'www.googleapis.com',
    supportsServerProxy: true,
    serverOnlySecret: false,
    optionalServerKey: true,
    probeType: 'googleBooks',
    url: 'https://www.googleapis.com/books/v1/volumes?q=duna&maxResults=1',
  },
  {
    id: 'openlibrary',
    label: 'Open Library',
    domainId: 'reading',
    domainLabel: 'Leitura',
    host: 'openlibrary.org',
    supportsServerProxy: false,
    probeType: 'get',
    url: 'https://openlibrary.org/search.json?q=duna&limit=1&fields=key,title',
  },
  {
    id: 'brasilApi',
    label: 'BrasilAPI (ISBN)',
    domainId: 'reading',
    domainLabel: 'Leitura',
    host: 'brasilapi.com.br',
    supportsServerProxy: true,
    serverOnlySecret: false,
    probeType: 'brasilapi',
  },
  {
    id: 'igdb',
    label: 'IGDB',
    domainId: 'games',
    domainLabel: 'Games',
    host: 'api.igdb.com',
    supportsServerProxy: true,
    serverOnlySecret: true,
    probeType: 'igdb',
  },
  {
    id: 'rawg',
    label: 'RAWG',
    domainId: 'games',
    domainLabel: 'Games',
    host: 'api.rawg.io',
    supportsServerProxy: true,
    serverOnlySecret: true,
    probeType: 'rawg',
  },
  {
    id: 'steam',
    label: 'Steam Store',
    domainId: 'games',
    domainLabel: 'Games',
    host: 'store.steampowered.com',
    supportsServerProxy: true,
    serverOnlySecret: false,
    probeType: 'steam',
  },
  {
    id: 'steamAchievements',
    label: 'Steam Conquistas',
    domainId: 'games',
    domainLabel: 'Games',
    host: 'api.steampowered.com',
    supportsServerProxy: true,
    serverOnlySecret: true,
    probeType: 'steamAchievements',
  },
  {
    id: 'retroachievements',
    label: 'RetroAchievements',
    domainId: 'games',
    domainLabel: 'Games',
    host: 'retroachievements.org',
    supportsServerProxy: true,
    serverOnlySecret: true,
    probeType: 'retroachievements',
  },
  {
    id: 'itunes',
    label: 'iTunes',
    domainId: 'music',
    domainLabel: 'Música',
    host: 'itunes.apple.com',
    supportsServerProxy: false,
    probeType: 'get',
    url: 'https://itunes.apple.com/search?term=metallica&entity=album&limit=1',
  },
  {
    id: 'musicbrainz',
    label: 'MusicBrainz',
    domainId: 'music',
    domainLabel: 'Música',
    host: 'musicbrainz.org',
    supportsServerProxy: false,
    probeType: 'get',
    url: 'https://musicbrainz.org/ws/2/release-group?query=metallica&fmt=json&limit=1',
  },
  {
    id: 'lastfm',
    label: 'Last.fm',
    domainId: 'music',
    domainLabel: 'Música',
    host: 'ws.audioscrobbler.com',
    supportsServerProxy: true,
    serverOnlySecret: true,
    probeType: 'lastfm',
  },
]);

export async function loadServerApiStatus(options = {}) {
  const res = await fetchProxyStatus(options);
  return {
    ok: Boolean(res.ok),
    authenticated: Boolean(res.authenticated),
    reachable: Boolean(res.reachable),
    devMode: Boolean(res.devMode),
    latencyMs: res.latencyMs ?? null,
    providers: {
      tmdb: { configured: Boolean(res.providers?.tmdb?.configured) },
      omdb: { configured: Boolean(res.providers?.omdb?.configured) },
      lastfm: { configured: Boolean(res.providers?.lastfm?.configured) },
      rawg: { configured: Boolean(res.providers?.rawg?.configured) },
      igdb: { configured: Boolean(res.providers?.igdb?.configured) },
      googleBooks: { configured: Boolean(res.providers?.googleBooks?.configured) },
      steamAchievements: { configured: Boolean(res.providers?.steamAchievements?.configured) },
      retroachievements: { configured: Boolean(res.providers?.retroachievements?.configured) },
    },
  };
}

async function probeWithTimeout(url, fetchOptions, { fetchImpl = fetch, timeoutMs = API_STATUS_TIMEOUT_MS } = {}) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    return await fetchImpl(url, {
      ...fetchOptions,
      ...(controller ? { signal: controller.signal } : {}),
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function probeApiSource(
  sourceId,
  {
    fetchImpl = fetch,
    timeoutMs = API_STATUS_TIMEOUT_MS,
    accessToken = '',
    supabaseClient = null,
    storage = null,
    forceProxy = null,
    isDev = undefined,
    nowFn = Date.now,
    tmdbApiKey = undefined,
    omdbApiKey = undefined,
  } = {}
) {
  const meta = API_STATUS_SOURCES.find((s) => s.id === sourceId);
  if (!meta) {
    return {
      id: String(sourceId || ''),
      ok: false,
      state: 'error',
      status: null,
      latencyMs: 0,
      via: 'none',
      message: 'Fonte desconhecida.',
      checkedAt: nowFn(),
    };
  }

  const start = nowFn();

  if (meta.probeType === 'tmdb') {
    const localKey = tmdbApiKey !== undefined ? String(tmdbApiKey || '').trim() : loadTmdbApiKey();
    try {
      const outcome = await fetchTmdbViaProxyOrDirect(
        'movie/603',
        { language: 'pt-BR' },
        {
          directApiKey: localKey,
          dedup: false,
          maxRetries: 0,
          timeoutMs,
          fetchImpl,
          nowFn,
          accessToken,
          supabaseClient,
          storage,
          forceProxy,
          ...(isDev !== undefined ? { isDev } : {}),
        }
      );
      const latencyMs = Math.max(0, nowFn() - start);
      if (outcome.missingKey || !outcome.res) {
        return {
          id: meta.id,
          ok: false,
          state: 'missing_key',
          status: outcome.proxyStatus ?? null,
          latencyMs,
          via: 'none',
          message: 'Sem proxy autenticado e sem chave local.',
          checkedAt: nowFn(),
        };
      }
      if (!outcome.res.ok) {
        return {
          id: meta.id,
          ok: false,
          state: 'error',
          status: outcome.res.status,
          latencyMs,
          via: outcome.via,
          message:
            outcome.res.status === 401
              ? 'Credencial recusada (HTTP 401).'
              : `Indisponível (HTTP ${outcome.res.status}).`,
          checkedAt: nowFn(),
        };
      }
      return {
        id: meta.id,
        ok: true,
        state: 'online',
        status: outcome.res.status,
        latencyMs,
        via: outcome.via,
        message: outcome.via === 'proxy' ? 'Online via servidor' : 'Online via chave local',
        checkedAt: nowFn(),
      };
    } catch {
      return {
        id: meta.id,
        ok: false,
        state: 'error',
        status: null,
        latencyMs: Math.max(0, nowFn() - start),
        via: 'none',
        message: 'Falha de conexão ou tempo limite excedido.',
        checkedAt: nowFn(),
      };
    }
  }

  if (meta.probeType === 'omdb') {
    const localKey = omdbApiKey !== undefined ? String(omdbApiKey || '').trim() : loadOmdbApiKey();
    try {
      const outcome = await fetchOmdbViaProxyOrDirect(
        { i: 'tt0133093' },
        {
          directApiKey: localKey,
          mode: 'manual',
          dedup: false,
          maxRetries: 0,
          timeoutMs,
          fetchImpl,
          nowFn,
          accessToken,
          supabaseClient,
          storage,
          forceProxy,
          ...(isDev !== undefined ? { isDev } : {}),
        }
      );
      const latencyMs = Math.max(0, nowFn() - start);
      if (outcome.missingKey || !outcome.res) {
        return {
          id: meta.id,
          ok: false,
          state: 'missing_key',
          status: outcome.proxyStatus ?? null,
          latencyMs,
          via: 'none',
          message: 'Sem proxy autenticado e sem chave local.',
          checkedAt: nowFn(),
        };
      }
      const json = await outcome.res.json().catch(() => null);
      if (!outcome.res.ok || json?.Response === 'False') {
        const rawErr = json?.Error || `HTTP ${outcome.res.status}`;
        return {
          id: meta.id,
          ok: false,
          state: 'error',
          status: outcome.res.status,
          latencyMs,
          via: outcome.via,
          message: maskSecretsInText(rawErr, [localKey]),
          checkedAt: nowFn(),
        };
      }
      return {
        id: meta.id,
        ok: true,
        state: 'online',
        status: outcome.res.status,
        latencyMs,
        via: outcome.via,
        message: outcome.via === 'proxy' ? 'Online via servidor' : 'Online via chave local',
        checkedAt: nowFn(),
      };
    } catch (err) {
      return {
        id: meta.id,
        ok: false,
        state: 'error',
        status: null,
        latencyMs: Math.max(0, nowFn() - start),
        via: 'none',
        message:
          err instanceof ApiQuotaError
            ? maskSecretsInText(err.message, [localKey])
            : 'Falha de conexão ou tempo limite excedido.',
        checkedAt: nowFn(),
      };
    }
  }

  if (meta.probeType === 'lastfm') {
    try {
      const outcome = await fetchLastfmViaProxy(
        'artist.getTopTags',
        { artist: 'Radiohead' },
        {
          dedup: false,
          timeoutMs,
          fetchImpl,
          nowFn,
          accessToken,
          supabaseClient,
          storage,
          forceProxy,
          ...(isDev !== undefined ? { isDev } : {}),
        }
      );
      const latencyMs = Math.max(0, nowFn() - start);
      if (outcome.notConfigured || outcome.status === 503) {
        return {
          id: meta.id,
          ok: false,
          state: 'not_configured',
          status: outcome.status ?? null,
          latencyMs,
          via: outcome.via,
          message: 'Não configurado no servidor.',
          checkedAt: nowFn(),
        };
      }
      if (!outcome.ok) {
        return {
          id: meta.id,
          ok: false,
          state: 'error',
          status: outcome.status ?? null,
          latencyMs,
          via: outcome.via,
          message: outcome.status
            ? `Indisponível (HTTP ${outcome.status}).`
            : 'Falha ao consultar Last.fm via servidor.',
          checkedAt: nowFn(),
        };
      }
      return {
        id: meta.id,
        ok: true,
        state: 'online',
        status: outcome.status || 200,
        latencyMs,
        via: 'proxy',
        message: 'Online via servidor',
        checkedAt: nowFn(),
      };
    } catch {
      return {
        id: meta.id,
        ok: false,
        state: 'error',
        status: null,
        latencyMs: Math.max(0, nowFn() - start),
        via: 'none',
        message: 'Falha de conexão ou tempo limite excedido.',
        checkedAt: nowFn(),
      };
    }
  }

  if (meta.probeType === 'igdb') {
    try {
      const outcome = await fetchIgdbViaProxy(
        'games',
        { search: 'portal', limit: '1', probe: '1' },
        {
          dedup: false,
          timeoutMs,
          fetchImpl,
          nowFn,
          accessToken,
          supabaseClient,
          storage,
          forceProxy,
          ...(isDev !== undefined ? { isDev } : {}),
        }
      );
      const latencyMs = Math.max(0, nowFn() - start);
      if (outcome.notConfigured || outcome.status === 503) {
        return {
          id: meta.id,
          ok: false,
          state: 'not_configured',
          status: outcome.status ?? null,
          latencyMs,
          via: outcome.via,
          message: 'Sem chave no servidor (TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET).',
          checkedAt: nowFn(),
        };
      }
      if (!outcome.ok) {
        return {
          id: meta.id,
          ok: false,
          state: 'error',
          status: outcome.status ?? null,
          latencyMs,
          via: outcome.via,
          message: outcome.status
            ? `Indisponível (HTTP ${outcome.status}).`
            : 'Falha ao consultar IGDB via servidor.',
          checkedAt: nowFn(),
        };
      }
      return {
        id: meta.id,
        ok: true,
        state: 'online',
        status: outcome.status || 200,
        latencyMs,
        via: 'proxy',
        message: 'Online via servidor',
        checkedAt: nowFn(),
      };
    } catch {
      return {
        id: meta.id,
        ok: false,
        state: 'error',
        status: null,
        latencyMs: Math.max(0, nowFn() - start),
        via: 'none',
        message: 'Falha de conexão ou tempo limite excedido.',
        checkedAt: nowFn(),
      };
    }
  }

  if (meta.probeType === 'steam') {
    try {
      const outcome = await fetchSteamViaProxyOrDirect(
        { term: 'portal' },
        {
          dedup: false,
          timeoutMs,
          fetchImpl,
          nowFn,
          forceProxy,
          ...(isDev !== undefined ? { isDev } : {}),
        }
      );
      const latencyMs = Math.max(0, nowFn() - start);
      if (!outcome.ok) {
        return {
          id: meta.id,
          ok: false,
          state: 'error',
          status: outcome.status ?? null,
          latencyMs,
          via: outcome.via,
          message: outcome.status
            ? `Indisponível (HTTP ${outcome.status}).`
            : 'Falha ao consultar Steam Store.',
          checkedAt: nowFn(),
        };
      }
      return {
        id: meta.id,
        ok: true,
        state: 'online',
        status: outcome.status || 200,
        latencyMs,
        via: outcome.via,
        message: outcome.via === 'proxy' ? 'Online via servidor' : 'Online',
        checkedAt: nowFn(),
      };
    } catch {
      return {
        id: meta.id,
        ok: false,
        state: 'error',
        status: null,
        latencyMs: Math.max(0, nowFn() - start),
        via: 'none',
        message: 'Falha de conexão ou tempo limite excedido.',
        checkedAt: nowFn(),
      };
    }
  }

  if (meta.probeType === 'steamAchievements') {
    try {
      const outcome = await fetchSteamAchievementsViaProxy(
        { probe: '1' },
        {
          dedup: false,
          timeoutMs,
          fetchImpl,
          nowFn,
          accessToken,
          supabaseClient,
          storage,
          forceProxy,
          ...(isDev !== undefined ? { isDev } : {}),
        }
      );
      const latencyMs = Math.max(0, nowFn() - start);
      if (outcome.notConfigured || outcome.status === 503) {
        return {
          id: meta.id,
          ok: false,
          state: 'not_configured',
          status: outcome.status ?? null,
          latencyMs,
          via: outcome.via,
          message: outcome.authRequired
            ? 'Entre na sua conta para verificar o proxy Steam no servidor.'
            : 'Sem chave no servidor (STEAM_WEB_API_KEY).',
          checkedAt: nowFn(),
        };
      }
      if (!outcome.ok) {
        return {
          id: meta.id,
          ok: false,
          state: 'error',
          status: outcome.status ?? null,
          latencyMs,
          via: outcome.via,
          message: outcome.status
            ? `Indisponível (HTTP ${outcome.status}).`
            : 'Falha ao consultar Steam Conquistas via servidor.',
          checkedAt: nowFn(),
        };
      }
      return {
        id: meta.id,
        ok: true,
        state: 'online',
        status: outcome.status || 200,
        latencyMs,
        via: 'proxy',
        message: 'Online via servidor',
        checkedAt: nowFn(),
      };
    } catch {
      return {
        id: meta.id,
        ok: false,
        state: 'error',
        status: null,
        latencyMs: Math.max(0, nowFn() - start),
        via: 'none',
        message: 'Falha de conexão ou tempo limite excedido.',
        checkedAt: nowFn(),
      };
    }
  }

  if (meta.probeType === 'retroachievements') {
    try {
      const outcome = await fetchRetroAchievementsViaProxy(
        { probe: '1' },
        {
          dedup: false,
          timeoutMs,
          fetchImpl,
          nowFn,
          accessToken,
          supabaseClient,
          storage,
          forceProxy,
          ...(isDev !== undefined ? { isDev } : {}),
        }
      );
      const latencyMs = Math.max(0, nowFn() - start);
      if (outcome.notConfigured || outcome.status === 503) {
        return {
          id: meta.id,
          ok: false,
          state: 'not_configured',
          status: outcome.status ?? null,
          latencyMs,
          via: outcome.via,
          message: outcome.authRequired
            ? 'Entre na sua conta para verificar o proxy RetroAchievements no servidor.'
            : 'Sem chave no servidor (RETROACHIEVEMENTS_API_KEY).',
          checkedAt: nowFn(),
        };
      }
      if (!outcome.ok) {
        return {
          id: meta.id,
          ok: false,
          state: 'error',
          status: outcome.status ?? null,
          latencyMs,
          via: outcome.via,
          message: outcome.status
            ? `Indisponível (HTTP ${outcome.status}).`
            : 'Falha ao consultar RetroAchievements via servidor.',
          checkedAt: nowFn(),
        };
      }
      return {
        id: meta.id,
        ok: true,
        state: 'online',
        status: outcome.status || 200,
        latencyMs,
        via: 'proxy',
        message: 'Online via servidor',
        checkedAt: nowFn(),
      };
    } catch {
      return {
        id: meta.id,
        ok: false,
        state: 'error',
        status: null,
        latencyMs: Math.max(0, nowFn() - start),
        via: 'none',
        message: 'Falha de conexão ou tempo limite excedido.',
        checkedAt: nowFn(),
      };
    }
  }

  if (meta.probeType === 'rawg') {
    try {
      const outcome = await fetchRawgViaProxy(
        'games',
        { search: 'portal', page_size: '1' },
        {
          dedup: false,
          timeoutMs,
          fetchImpl,
          nowFn,
          accessToken,
          supabaseClient,
          storage,
          forceProxy,
          ...(isDev !== undefined ? { isDev } : {}),
        }
      );
      const latencyMs = Math.max(0, nowFn() - start);
      if (outcome.notConfigured || outcome.status === 503) {
        return {
          id: meta.id,
          ok: false,
          state: 'not_configured',
          status: outcome.status ?? null,
          latencyMs,
          via: outcome.via,
          message: 'Não configurado no servidor.',
          checkedAt: nowFn(),
        };
      }
      if (!outcome.ok) {
        return {
          id: meta.id,
          ok: false,
          state: 'error',
          status: outcome.status ?? null,
          latencyMs,
          via: outcome.via,
          message: outcome.status
            ? `Indisponível (HTTP ${outcome.status}).`
            : 'Falha ao consultar RAWG via servidor.',
          checkedAt: nowFn(),
        };
      }
      return {
        id: meta.id,
        ok: true,
        state: 'online',
        status: outcome.status || 200,
        latencyMs,
        via: 'proxy',
        message: 'Online via servidor',
        checkedAt: nowFn(),
      };
    } catch {
      return {
        id: meta.id,
        ok: false,
        state: 'error',
        status: null,
        latencyMs: Math.max(0, nowFn() - start),
        via: 'none',
        message: 'Falha de conexão ou tempo limite excedido.',
        checkedAt: nowFn(),
      };
    }
  }

  if (meta.probeType === 'googleBooks') {
    try {
      const outcome = await fetchGoogleBooksViaProxyOrDirect(
        { q: 'duna', maxResults: '1' },
        {
          dedup: false,
          timeoutMs,
          fetchImpl,
          nowFn,
          accessToken,
          supabaseClient,
          storage,
          forceProxy,
          ...(isDev !== undefined ? { isDev } : {}),
        }
      );
      const latencyMs = Math.max(0, nowFn() - start);
      if (outcome.ok) {
        return {
          id: meta.id,
          ok: true,
          state: 'online',
          status: outcome.status || 200,
          latencyMs,
          via: outcome.via,
          message:
            outcome.via === 'proxy'
              ? 'Online via servidor (chave ativa)'
              : 'Online (público · chave opcional não configurada)',
          checkedAt: nowFn(),
        };
      }
      if (outcome.status === 429) {
        return {
          id: meta.id,
          ok: false,
          state: 'not_configured',
          status: 429,
          latencyMs,
          via: outcome.via,
          message: 'Cota pública atingida (configure GOOGLE_BOOKS_API_KEY opcional no servidor).',
          checkedAt: nowFn(),
        };
      }
      return {
        id: meta.id,
        ok: false,
        state: 'error',
        status: outcome.status ?? null,
        latencyMs,
        via: outcome.via,
        message: outcome.status
          ? `Indisponível (HTTP ${outcome.status}).`
          : 'Falha ao consultar Google Books.',
        checkedAt: nowFn(),
      };
    } catch {
      return {
        id: meta.id,
        ok: false,
        state: 'error',
        status: null,
        latencyMs: Math.max(0, nowFn() - start),
        via: 'none',
        message: 'Falha de conexão ou tempo limite excedido.',
        checkedAt: nowFn(),
      };
    }
  }

  if (meta.probeType === 'brasilapi') {
    try {
      const outcome = await fetchBrasilApiIsbnViaProxyOrDirect('9788535914849', {
        dedup: false,
        timeoutMs,
        fetchImpl,
        nowFn,
        forceProxy,
        ...(isDev !== undefined ? { isDev } : {}),
      });
      const latencyMs = Math.max(0, nowFn() - start);
      if (!outcome.ok) {
        return {
          id: meta.id,
          ok: false,
          state: 'error',
          status: outcome.status ?? null,
          latencyMs,
          via: outcome.via,
          message: outcome.status
            ? `Indisponível (HTTP ${outcome.status}).`
            : 'Falha ao consultar BrasilAPI (ISBN).',
          checkedAt: nowFn(),
        };
      }
      return {
        id: meta.id,
        ok: true,
        state: 'online',
        status: outcome.status || 200,
        latencyMs,
        via: outcome.via,
        message: outcome.via === 'proxy' ? 'Online via servidor' : 'Online',
        checkedAt: nowFn(),
      };
    } catch {
      return {
        id: meta.id,
        ok: false,
        state: 'error',
        status: null,
        latencyMs: Math.max(0, nowFn() - start),
        via: 'none',
        message: 'Falha de conexão ou tempo limite excedido.',
        checkedAt: nowFn(),
      };
    }
  }

  try {
    const fetchOptions =
      meta.probeType === 'anilist'
        ? {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({
              query: 'query { Page(page: 1, perPage: 1) { media(type: ANIME) { id } } }',
            }),
          }
        : {
            method: 'GET',
            headers: {
              Accept: 'application/json',
            },
          };

    const res = await probeWithTimeout(meta.url, fetchOptions, { fetchImpl, timeoutMs });
    const latencyMs = Math.max(0, nowFn() - start);
    if (!res || !res.ok) {
      return {
        id: meta.id,
        ok: false,
        state: 'error',
        status: res?.status ?? null,
        latencyMs,
        via: 'direct',
        message: res?.status ? `Indisponível (HTTP ${res.status}).` : 'Sem resposta da fonte.',
        checkedAt: nowFn(),
      };
    }
    return {
      id: meta.id,
      ok: true,
      state: 'online',
      status: res.status,
      latencyMs,
      via: 'direct',
      message: 'Online',
      checkedAt: nowFn(),
    };
  } catch {
    return {
      id: meta.id,
      ok: false,
      state: 'error',
      status: null,
      latencyMs: Math.max(0, nowFn() - start),
      via: 'direct',
      message: 'Bloqueado por rede/CORS ou tempo limite excedido.',
      checkedAt: nowFn(),
    };
  }
}

export async function probeAllApiSources(options = {}) {
  const results = {};
  for (const source of API_STATUS_SOURCES) {
    results[source.id] = await probeApiSource(source.id, options);
  }
  return results;
}
