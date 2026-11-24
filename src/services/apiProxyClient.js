/**
 * Cliente de proxy autenticado para TMDB (/api/tmdb/*), OMDb (/api/omdb)
 * e diagnóstico de servidor (/api/status).
 *
 * Regras (OmniPrism v2.3.3):
 * - Com sessão Supabase ativa (fora de DEV): chama /api/... com Bearer token,
 *   sem enviar api_key/apikey pelo cliente.
 * - Se o proxy falhar (401/404/5xx, resposta HTML ou erro de rede) ou não houver
 *   sessão: faz fallback transparente para a chamada direta com chave local
 *   (VITE_* apenas em desenvolvimento).
 * - Em desenvolvimento (import.meta.env.DEV), mantém exatamente o comportamento atual.
 * - Nunca registra nem devolve valores de chaves.
 */

import { apiRequest, ApiQuotaError, getResponseHeader } from '../api/httpClient.js';
import { API_TIMEOUT_MS } from '../api/limits.js';
import { getSupabaseClient } from './supabaseClient.js';

export const TMDB_DIRECT_API_BASE = 'https://api.themoviedb.org/3';
export const OMDB_DIRECT_API_BASE = 'https://www.omdbapi.com';

const ALLOWED_PROXY_TMDB_RE =
  /^(?:search\/(?:movie|tv|multi|collection)|(?:collection|keyword)\/\d+|(?:movie|tv|find)\/[a-zA-Z0-9_/-]+)$/;
const ALLOWED_PROXY_TMDB_DISCOVER_RE = /^discover\/(?:movie|tv)$/;
const TMDB_KEYWORDS_RE = /^\d+(?:[,|]\d+)*$/;
const SECRET_QUERY_KEY_RE = /^(api_?key|apikey|access_token|token|key)$/i;

export function isDevRuntime() {
  try {
    return Boolean(typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV);
  } catch {
    return false;
  }
}

export function shouldUseApiProxy({ forceProxy = null, isDev = isDevRuntime() } = {}) {
  if (forceProxy === true) return true;
  if (forceProxy === false) return false;
  if (isDev) return false;
  return true;
}

export function isProxySupportedTmdbPath(rawPath = '', params = null) {
  const clean = String(rawPath || '').trim().replace(/^\/+/, '');
  if (!clean || clean.includes('..') || clean.includes('//')) return false;
  if (ALLOWED_PROXY_TMDB_RE.test(clean)) return true;
  if (ALLOWED_PROXY_TMDB_DISCOVER_RE.test(clean)) {
    const rawKw =
      params instanceof URLSearchParams
        ? String(params.get('with_keywords') || '').trim()
        : String(params?.with_keywords || '').trim();
    return Boolean(rawKw && TMDB_KEYWORDS_RE.test(rawKw));
  }
  return false;
}

export async function getSupabaseAccessToken({
  accessToken = '',
  supabaseClient = null,
  storage = null,
} = {}) {
  const direct = String(accessToken || '').trim();
  if (direct) return direct;

  try {
    const sb = supabaseClient || getSupabaseClient({ storage });
    if (!sb || typeof sb.auth?.getSession !== 'function') return '';
    const { data, error } = await sb.auth.getSession();
    if (error) return '';
    return String(data?.session?.access_token || '').trim();
  } catch {
    return '';
  }
}

export function shouldFallbackFromProxyResponse(res) {
  if (!res) return true;
  const status = Number(res.status) || 0;
  if (status === 401 || status === 403 || status === 404 || status >= 500 || status === 0) {
    return true;
  }
  const contentType = String(getResponseHeader(res, 'content-type') || '').toLowerCase();
  if (contentType.includes('text/html')) {
    return true;
  }
  return false;
}

function buildQueryParams(params = {}, { stripSecrets = true } = {}) {
  const out = new URLSearchParams();
  if (!params) return out;
  const entries =
    params instanceof URLSearchParams ? Array.from(params.entries()) : Object.entries(params);
  for (const [k, v] of entries) {
    if (v === undefined || v === null || v === '') continue;
    if (stripSecrets && SECRET_QUERY_KEY_RE.test(k)) continue;
    out.set(k, String(v));
  }
  return out;
}

/**
 * Executa uma chamada TMDB priorizando `/api/tmdb/<path>` quando há sessão Supabase
 * (em produção) e caindo automaticamente para a chamada direta com `directApiKey`
 * caso o proxy falhe (401/404/5xx/HTML/rede) ou não haja sessão.
 */
export async function fetchTmdbViaProxyOrDirect(
  rawPath,
  params = {},
  {
    directApiKey = '',
    signal = undefined,
    fetchImpl = fetch,
    timeoutMs = API_TIMEOUT_MS,
    nowFn = Date.now,
    dedup = true,
    maxRetries = undefined,
    accessToken = '',
    supabaseClient = null,
    storage = null,
    forceProxy = null,
    isDev = isDevRuntime(),
  } = {}
) {
  const cleanPath = String(rawPath || '').trim().replace(/^\/+/, '');
  const cleanParams = buildQueryParams(params, { stripSecrets: true });
  const qs = cleanParams.toString();

  let proxyAttempted = false;
  let proxyStatus = null;

  if (
    isProxySupportedTmdbPath(cleanPath, cleanParams) &&
    shouldUseApiProxy({ forceProxy, isDev })
  ) {
    const token = await getSupabaseAccessToken({ accessToken, supabaseClient, storage });
    if (token) {
      proxyAttempted = true;
      const proxyUrl = `/api/tmdb/${cleanPath}${qs ? `?${qs}` : ''}`;
      try {
        const res = await apiRequest(proxyUrl, {
          provider: 'tmdb',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
          signal,
          fetchImpl,
          timeoutMs,
          nowFn,
          dedup,
          maxRetries: 0,
        });
        proxyStatus = res?.status ?? null;
        if (!shouldFallbackFromProxyResponse(res)) {
          return {
            ok: Boolean(res.ok),
            res,
            via: 'proxy',
            status: res.status,
            missingKey: false,
            proxyAttempted,
            proxyStatus,
          };
        }
      } catch (err) {
        if (err?.name === 'AbortError' || signal?.aborted) {
          throw err;
        }
        proxyStatus = err?.status ?? null;
      }
    }
  }

  const key = String(directApiKey || '').trim();
  if (!key) {
    return {
      ok: false,
      res: null,
      via: 'none',
      status: proxyStatus,
      missingKey: true,
      proxyAttempted,
      proxyStatus,
    };
  }

  const directParams = new URLSearchParams();
  directParams.set('api_key', key);
  for (const [k, v] of cleanParams.entries()) {
    directParams.set(k, v);
  }
  const directUrl = `${TMDB_DIRECT_API_BASE}/${cleanPath}?${directParams.toString()}`;
  const res = await apiRequest(directUrl, {
    provider: 'tmdb',
    signal,
    fetchImpl,
    timeoutMs,
    nowFn,
    dedup,
    ...(maxRetries !== undefined ? { maxRetries } : {}),
  });

  return {
    ok: Boolean(res.ok),
    res,
    via: 'direct',
    status: res.status,
    missingKey: false,
    proxyAttempted,
    proxyStatus,
  };
}

/**
 * Executa uma chamada OMDb priorizando `/api/omdb` quando há sessão Supabase
 * (em produção) e caindo automaticamente para a chamada direta com `directApiKey`
 * caso o proxy falhe (401/404/5xx/HTML/rede) ou não haja sessão.
 */
export async function fetchOmdbViaProxyOrDirect(
  params = {},
  {
    directApiKey = '',
    mode = 'auto',
    signal = undefined,
    fetchImpl = fetch,
    timeoutMs = API_TIMEOUT_MS,
    nowFn = Date.now,
    sleepFn = undefined,
    dedup = true,
    maxRetries = undefined,
    accessToken = '',
    supabaseClient = null,
    storage = null,
    forceProxy = null,
    isDev = isDevRuntime(),
  } = {}
) {
  const cleanParams = buildQueryParams(params, { stripSecrets: true });
  const qs = cleanParams.toString();

  let proxyAttempted = false;
  let proxyStatus = null;

  if (shouldUseApiProxy({ forceProxy, isDev })) {
    const token = await getSupabaseAccessToken({ accessToken, supabaseClient, storage });
    if (token) {
      proxyAttempted = true;
      const proxyUrl = `/api/omdb${qs ? `?${qs}` : ''}`;
      try {
        const res = await apiRequest(proxyUrl, {
          provider: 'omdb',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
          mode,
          signal,
          fetchImpl,
          timeoutMs,
          nowFn,
          sleepFn,
          dedup,
          maxRetries: 0,
        });
        proxyStatus = res?.status ?? null;
        if (!shouldFallbackFromProxyResponse(res)) {
          return {
            ok: Boolean(res.ok),
            res,
            via: 'proxy',
            status: res.status,
            missingKey: false,
            proxyAttempted,
            proxyStatus,
          };
        }
      } catch (err) {
        if (err instanceof ApiQuotaError || err?.name === 'AbortError' || signal?.aborted) {
          throw err;
        }
        proxyStatus = err?.status ?? null;
      }
    }
  }

  const key = String(directApiKey || '').trim();
  if (!key) {
    return {
      ok: false,
      res: null,
      via: 'none',
      status: proxyStatus,
      missingKey: true,
      proxyAttempted,
      proxyStatus,
    };
  }

  const directParams = new URLSearchParams();
  directParams.set('apikey', key);
  for (const [k, v] of cleanParams.entries()) {
    directParams.set(k, v);
  }
  const directUrl = `${OMDB_DIRECT_API_BASE}/?${directParams.toString()}`;
  const res = await apiRequest(directUrl, {
    provider: 'omdb',
    mode,
    signal,
    fetchImpl,
    timeoutMs,
    nowFn,
    sleepFn,
    dedup,
    ...(maxRetries !== undefined ? { maxRetries } : {}),
  });

  return {
    ok: Boolean(res.ok),
    res,
    via: 'direct',
    status: res.status,
    missingKey: false,
    proxyAttempted,
    proxyStatus,
  };
}

const ALLOWED_LASTFM_PROXY_METHODS = new Set(['artist.getTopTags', 'album.getTopTags']);

/**
 * Executa chamada Last.fm EXCLUSIVAMENTE via `/api/lastfm` (secret LASTFM_API_KEY no Cloudflare).
 * Nunca usa chaves VITE_ no cliente; degrada sem quebrar quando não configurado ou sem sessão.
 */
export async function fetchLastfmViaProxy(
  method,
  params = {},
  {
    signal = undefined,
    fetchImpl = fetch,
    timeoutMs = API_TIMEOUT_MS,
    nowFn = Date.now,
    dedup = true,
    accessToken = '',
    supabaseClient = null,
    storage = null,
    forceProxy = null,
    isDev = isDevRuntime(),
  } = {}
) {
  const cleanMethod = String(method || '').trim();
  if (!ALLOWED_LASTFM_PROXY_METHODS.has(cleanMethod)) {
    return {
      ok: false,
      res: null,
      via: 'none',
      status: 403,
      notConfigured: false,
      data: null,
    };
  }

  if (!shouldUseApiProxy({ forceProxy, isDev })) {
    return {
      ok: false,
      res: null,
      via: 'none',
      status: null,
      notConfigured: true,
      data: null,
    };
  }

  const token = await getSupabaseAccessToken({ accessToken, supabaseClient, storage });
  if (!token) {
    return {
      ok: false,
      res: null,
      via: 'none',
      status: 401,
      notConfigured: true,
      data: null,
    };
  }

  const cleanParams = buildQueryParams(params, { stripSecrets: true });
  cleanParams.set('method', cleanMethod);
  const proxyUrl = `/api/lastfm?${cleanParams.toString()}`;

  try {
    const res = await apiRequest(proxyUrl, {
      provider: 'lastfm',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      signal,
      fetchImpl,
      timeoutMs,
      nowFn,
      dedup,
      maxRetries: 0,
    });
    const status = Number(res?.status) || 0;
    const contentType = String(getResponseHeader(res, 'content-type') || '').toLowerCase();
    if (status === 503 || status === 404 || contentType.includes('text/html')) {
      return {
        ok: false,
        res,
        via: 'proxy',
        status,
        notConfigured: true,
        data: null,
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        res,
        via: 'proxy',
        status,
        notConfigured: false,
        data: null,
      };
    }
    const data = await res.json().catch(() => null);
    return {
      ok: Boolean(data && typeof data === 'object' && !data.error),
      res,
      via: 'proxy',
      status,
      notConfigured: false,
      data,
    };
  } catch (err) {
    if (err?.name === 'AbortError' || signal?.aborted) {
      throw err;
    }
    return {
      ok: false,
      res: null,
      via: 'none',
      status: err?.status ?? null,
      notConfigured: err?.status === 503,
      data: null,
    };
  }
}

const ALLOWED_RAWG_PROXY_RE = /^games(?:\/[a-zA-Z0-9-]+)?$/;

/**
 * Executa chamada RAWG EXCLUSIVAMENTE via `/api/rawg/games` ou `/api/rawg/games/{id}`
 * (secret RAWG_API_KEY apenas no Cloudflare). Nunca usa chaves VITE_ no cliente.
 * Degrada sem quebrar quando não configurado ou sem sessão.
 */
export async function fetchRawgViaProxy(
  rawPath = 'games',
  params = {},
  {
    signal = undefined,
    fetchImpl = fetch,
    timeoutMs = API_TIMEOUT_MS,
    nowFn = Date.now,
    dedup = true,
    accessToken = '',
    supabaseClient = null,
    storage = null,
    forceProxy = null,
    isDev = isDevRuntime(),
  } = {}
) {
  const cleanPath = String(rawPath || '').trim().replace(/^\/+/, '');
  if (!cleanPath || cleanPath.includes('..') || !ALLOWED_RAWG_PROXY_RE.test(cleanPath)) {
    return {
      ok: false,
      res: null,
      via: 'none',
      status: 403,
      notConfigured: false,
      data: null,
    };
  }

  if (!shouldUseApiProxy({ forceProxy, isDev })) {
    return {
      ok: false,
      res: null,
      via: 'none',
      status: null,
      notConfigured: true,
      data: null,
    };
  }

  const token = await getSupabaseAccessToken({ accessToken, supabaseClient, storage });
  if (!token) {
    return {
      ok: false,
      res: null,
      via: 'none',
      status: 401,
      notConfigured: true,
      data: null,
    };
  }

  const cleanParams = buildQueryParams(params, { stripSecrets: true });
  const qs = cleanParams.toString();
  const proxyUrl = `/api/rawg/${cleanPath}${qs ? `?${qs}` : ''}`;

  try {
    const res = await apiRequest(proxyUrl, {
      provider: 'rawg',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      signal,
      fetchImpl,
      timeoutMs,
      nowFn,
      dedup,
      maxRetries: 0,
    });
    const status = Number(res?.status) || 0;
    const contentType = String(getResponseHeader(res, 'content-type') || '').toLowerCase();
    if (status === 503 || status === 404 || contentType.includes('text/html')) {
      return {
        ok: false,
        res,
        via: 'proxy',
        status,
        notConfigured: true,
        data: null,
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        res,
        via: 'proxy',
        status,
        notConfigured: false,
        data: null,
      };
    }
    const data = await res.json().catch(() => null);
    return {
      ok: Boolean(data && typeof data === 'object'),
      res,
      via: 'proxy',
      status,
      notConfigured: false,
      data,
    };
  } catch (err) {
    if (err?.name === 'AbortError' || signal?.aborted) {
      throw err;
    }
    return {
      ok: false,
      res: null,
      via: 'none',
      status: err?.status ?? null,
      notConfigured: err?.status === 503,
      data: null,
    };
  }
}

/**
 * Consulta `GET /api/status` (autenticado) para saber quais provedores
 * possuem chaves configuradas no servidor Cloudflare (apenas booleanos).
 */
export async function fetchProxyStatus({
  accessToken = '',
  supabaseClient = null,
  storage = null,
  fetchImpl = fetch,
  timeoutMs = 5000,
  forceProxy = null,
  isDev = isDevRuntime(),
} = {}) {
  const emptyProviders = {
    tmdb: { configured: false },
    omdb: { configured: false },
    lastfm: { configured: false },
    rawg: { configured: false },
  };

  if (!shouldUseApiProxy({ forceProxy, isDev })) {
    return {
      ok: false,
      authenticated: false,
      reachable: false,
      devMode: Boolean(isDev),
      latencyMs: null,
      status: null,
      providers: emptyProviders,
    };
  }

  const token = await getSupabaseAccessToken({ accessToken, supabaseClient, storage });
  if (!token) {
    return {
      ok: false,
      authenticated: false,
      reachable: false,
      devMode: false,
      latencyMs: null,
      status: 401,
      providers: emptyProviders,
    };
  }

  const start = Date.now();
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const res = await fetchImpl('/api/status', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      ...(controller ? { signal: controller.signal } : {}),
    });
    const latencyMs = Math.max(0, Date.now() - start);

    if (!res || !res.ok || shouldFallbackFromProxyResponse(res)) {
      return {
        ok: false,
        authenticated: true,
        reachable: false,
        devMode: false,
        latencyMs,
        status: res?.status ?? null,
        providers: emptyProviders,
      };
    }

    const json = await res.json().catch(() => null);
    if (!json || typeof json !== 'object' || !json.providers) {
      return {
        ok: false,
        authenticated: true,
        reachable: false,
        devMode: false,
        latencyMs,
        status: res.status,
        providers: emptyProviders,
      };
    }

    return {
      ok: true,
      authenticated: true,
      reachable: true,
      devMode: false,
      latencyMs,
      status: res.status,
      providers: {
        tmdb: { configured: Boolean(json.providers?.tmdb?.configured) },
        omdb: { configured: Boolean(json.providers?.omdb?.configured) },
        lastfm: { configured: Boolean(json.providers?.lastfm?.configured) },
        rawg: { configured: Boolean(json.providers?.rawg?.configured) },
      },
    };
  } catch {
    return {
      ok: false,
      authenticated: true,
      reachable: false,
      devMode: false,
      latencyMs: Math.max(0, Date.now() - start),
      status: null,
      providers: emptyProviders,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
