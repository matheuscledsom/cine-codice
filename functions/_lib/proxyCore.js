/**
 * Núcleo compartilhado do proxy autenticado Cloudflare Pages Functions (OmniPrism v2.3.3).
 *
 * Garantias de segurança:
 * - Valida Bearer token do Supabase via SUPABASE_URL/auth/v1/user + header apikey.
 * - Não é proxy aberto: aplica allowlist estrita de rotas TMDB e parâmetros OMDb.
 * - Remove api_key/apikey/token enviados pelo cliente e injeta apenas chaves do ambiente.
 * - Usa caches.default com chave igual à URL sem segredos (10 min busca / 24h detalhes).
 * - Nunca registra nem devolve valores de chaves.
 */

export const TMDB_UPSTREAM_BASE = 'https://api.themoviedb.org/3';
export const OMDB_UPSTREAM_BASE = 'https://www.omdbapi.com/';
export const LASTFM_UPSTREAM_BASE = 'https://ws.audioscrobbler.com/2.0/';
export const RAWG_UPSTREAM_BASE = 'https://api.rawg.io/api';
export const IGDB_UPSTREAM_BASE = 'https://api.igdb.com/v4';
export const TWITCH_OAUTH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
export const STEAM_STORE_UPSTREAM_BASE = 'https://store.steampowered.com/api';
export const BRASILAPI_ISBN_UPSTREAM_BASE = 'https://brasilapi.com.br/api/isbn/v1';

export const SEARCH_CACHE_TTL_SECONDS = 600; // 10 minutos
export const DETAIL_CACHE_TTL_SECONDS = 86400; // 24 horas

const SECRET_PARAM_RE = /^(api_?key|apikey|access_token|token|key|sk|api_sig|client_secret)$/i;
const SAFE_SEGMENT_RE = /^[a-zA-Z0-9_-]+$/;
const SAFE_RAWG_ID_RE = /^[a-zA-Z0-9-]+$/;
const ALLOWED_RAWG_GAME_SUBPATHS = new Set(['additions', 'game-series', 'parent-games']);
const NUMERIC_ID_RE = /^\d+$/;
const TMDB_KEYWORDS_PARAM_RE = /^\d+(?:[,|]\d+)*$/;
const ALLOWED_TMDB_SEARCH_TARGETS = new Set(['movie', 'tv', 'multi', 'collection']);
const ALLOWED_TMDB_DISCOVER_TARGETS = new Set(['movie', 'tv']);
const ALLOWED_LASTFM_METHODS = new Map([
  ['artist.gettoptags', 'artist.getTopTags'],
  ['album.gettoptags', 'album.getTopTags'],
]);
const ALLOWED_LASTFM_PARAMS = new Map([
  ['artist', 'artist'],
  ['album', 'album'],
  ['autocorrect', 'autocorrect'],
  ['mbid', 'mbid'],
]);
const ALLOWED_RAWG_SEARCH_PARAMS = new Map([
  ['search', 'search'],
  ['page', 'page'],
  ['page_size', 'page_size'],
  ['platforms', 'platforms'],
  ['ordering', 'ordering'],
  ['search_precise', 'search_precise'],
  ['search_exact', 'search_exact'],
]);
const ALLOWED_OMDB_PARAMS = new Map([
  ['i', 'i'],
  ['t', 't'],
  ['s', 's'],
  ['type', 'type'],
  ['y', 'y'],
  ['plot', 'plot'],
  ['season', 'Season'],
  ['episode', 'Episode'],
  ['page', 'page'],
  ['r', 'r'],
]);

export function jsonResponse(body, status = 200, extraHeaders = {}) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Authorization',
    ...extraHeaders,
  });
  return new Response(JSON.stringify(body), { status, headers });
}

export function methodNotAllowedResponse() {
  return jsonResponse({ error: 'Método não permitido. Use GET.' }, 405, {
    Allow: 'GET',
  });
}

export function normalizeSupabaseBaseUrl(rawUrl) {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    const isLocalHttp =
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');
    if (parsed.protocol !== 'https:' && !isLocalHttp) return '';
    const cleanPath = parsed.pathname.replace(/\/auth\/v1\/?.*$/i, '').replace(/\/+$/, '');
    return `${parsed.origin}${cleanPath}`;
  } catch {
    return '';
  }
}

export function extractBearerToken(request) {
  const raw = request?.headers?.get?.('Authorization') || request?.headers?.get?.('authorization') || '';
  const match = String(raw).trim().match(/^Bearer\s+([^\s]+)$/i);
  return match ? match[1].trim() : '';
}

export function readServerEnvConfig(env = {}) {
  const supabaseUrl = normalizeSupabaseBaseUrl(
    env?.SUPABASE_URL || env?.VITE_SUPABASE_URL || ''
  );
  const supabaseAnonKey = String(
    env?.SUPABASE_ANON_KEY || env?.VITE_SUPABASE_ANON_KEY || ''
  ).trim();
  const tmdbApiKey = String(env?.TMDB_API_KEY || '').trim();
  const omdbApiKey = String(env?.OMDB_API_KEY || '').trim();
  const lastfmApiKey = String(env?.LASTFM_API_KEY || '').trim();
  const rawgApiKey = String(env?.RAWG_API_KEY || '').trim();
  const twitchClientId = String(env?.TWITCH_CLIENT_ID || '').trim();
  const twitchClientSecret = String(env?.TWITCH_CLIENT_SECRET || '').trim();

  return {
    supabaseUrl,
    supabaseAnonKey,
    tmdbApiKey,
    omdbApiKey,
    lastfmApiKey,
    rawgApiKey,
    twitchClientId,
    twitchClientSecret,
    providers: {
      tmdb: { configured: Boolean(tmdbApiKey) },
      omdb: { configured: Boolean(omdbApiKey) },
      lastfm: { configured: Boolean(lastfmApiKey) },
      rawg: { configured: Boolean(rawgApiKey) },
      igdb: { configured: Boolean(twitchClientId && twitchClientSecret) },
    },
  };
}

export function isAllowedSameOriginRequest(request) {
  try {
    const secFetchSite = String(request?.headers?.get?.('Sec-Fetch-Site') || '')
      .trim()
      .toLowerCase();
    if (secFetchSite === 'cross-site') {
      return false;
    }
    const originHeader = String(request?.headers?.get?.('Origin') || '').trim();
    if (!originHeader) return true;
    const reqUrl = new URL(request.url);
    const originUrl = new URL(originHeader);
    if (originUrl.origin === reqUrl.origin) return true;
    if (
      (originUrl.hostname === 'localhost' || originUrl.hostname === '127.0.0.1') &&
      (reqUrl.hostname === 'localhost' || reqUrl.hostname === '127.0.0.1')
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function maskSensitiveValues(rawText, secrets = []) {
  let out = String(rawText ?? '');
  if (!out) return out;
  out = out.replace(/((?:api_?key|apikey|access_token|token)=)([^&\s'"]+)/gi, '$1****');
  out = out.replace(/(Bearer\s+)([A-Za-z0-9._-]+)/gi, '$1****');
  for (const secret of Array.isArray(secrets) ? secrets : []) {
    const clean = String(secret || '').trim();
    if (clean.length >= 3) {
      out = out.split(clean).join('****');
      const encoded = encodeURIComponent(clean);
      if (encoded !== clean) {
        out = out.split(encoded).join('****');
      }
    }
  }
  return out;
}

export async function verifySupabaseAuth(request, env, { fetchImpl = fetch } = {}) {
  const token = extractBearerToken(request);
  if (!token) {
    return {
      ok: false,
      status: 401,
      error: 'Autenticação obrigatória: informe um Bearer token válido.',
    };
  }

  const cfg = readServerEnvConfig(env);
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    return {
      ok: false,
      status: 503,
      error: 'Configuração de autenticação Supabase ausente no servidor.',
    };
  }

  try {
    const authRes = await fetchImpl(`${cfg.supabaseUrl}/auth/v1/user`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: cfg.supabaseAnonKey,
        Accept: 'application/json',
      },
    });

    if (!authRes || !authRes.ok) {
      return {
        ok: false,
        status: 401,
        error: 'Sessão Supabase inválida ou expirada.',
      };
    }

    const user = await authRes.json().catch(() => null);
    if (!user || typeof user.id !== 'string' || !user.id.trim()) {
      return {
        ok: false,
        status: 401,
        error: 'Usuário Supabase inválido.',
      };
    }

    return {
      ok: true,
      status: 200,
      userId: user.id.trim(),
    };
  } catch {
    return {
      ok: false,
      status: 401,
      error: 'Não foi possível validar o token de sessão.',
    };
  }
}

export function validateTmdbPath(rawPathname = '', paramsPath = null, searchParams = null) {
  const pathname = String(rawPathname || '');
  const lowerRaw = pathname.toLowerCase();
  if (
    lowerRaw.includes('..') ||
    lowerRaw.includes('%2e') ||
    lowerRaw.includes('%2f') ||
    lowerRaw.includes('%5c') ||
    lowerRaw.includes('\\') ||
    lowerRaw.includes('@')
  ) {
    return { allowed: false, kind: null, ttlSeconds: 0, cleanPath: '' };
  }

  const strippedPrefix = pathname.replace(/^\/api\/tmdb\/?/i, '');
  if (!strippedPrefix || strippedPrefix.includes('//')) {
    return { allowed: false, kind: null, ttlSeconds: 0, cleanPath: '' };
  }

  let segments;
  if (Array.isArray(paramsPath) && paramsPath.length > 0) {
    segments = paramsPath.map((s) => String(s || '').trim());
  } else if (typeof paramsPath === 'string' && paramsPath.trim()) {
    segments = paramsPath.split('/').map((s) => s.trim());
  } else {
    segments = strippedPrefix.split('/').map((s) => s.trim());
  }

  if (segments.length === 0 || segments.some((seg) => !seg || !SAFE_SEGMENT_RE.test(seg))) {
    return { allowed: false, kind: null, ttlSeconds: 0, cleanPath: '' };
  }

  const [head, second] = segments;

  if (head === 'search') {
    if (segments.length === 2 && ALLOWED_TMDB_SEARCH_TARGETS.has(second)) {
      return {
        allowed: true,
        kind: 'search',
        ttlSeconds: SEARCH_CACHE_TTL_SECONDS,
        cleanPath: `${head}/${second}`,
      };
    }
    return { allowed: false, kind: null, ttlSeconds: 0, cleanPath: '' };
  }

  if (head === 'discover') {
    if (segments.length === 2 && ALLOWED_TMDB_DISCOVER_TARGETS.has(second)) {
      const rawKeywords =
        searchParams && typeof searchParams.get === 'function'
          ? String(searchParams.get('with_keywords') || '').trim()
          : '';
      if (rawKeywords && TMDB_KEYWORDS_PARAM_RE.test(rawKeywords)) {
        return {
          allowed: true,
          kind: 'search',
          ttlSeconds: SEARCH_CACHE_TTL_SECONDS,
          cleanPath: `${head}/${second}`,
        };
      }
    }
    return { allowed: false, kind: null, ttlSeconds: 0, cleanPath: '' };
  }

  if (head === 'collection' || head === 'keyword') {
    if (segments.length === 2 && NUMERIC_ID_RE.test(second)) {
      return {
        allowed: true,
        kind: 'detail',
        ttlSeconds: DETAIL_CACHE_TTL_SECONDS,
        cleanPath: `${head}/${second}`,
      };
    }
    return { allowed: false, kind: null, ttlSeconds: 0, cleanPath: '' };
  }

  if (head === 'find') {
    if (segments.length === 2) {
      return {
        allowed: true,
        kind: 'detail',
        ttlSeconds: DETAIL_CACHE_TTL_SECONDS,
        cleanPath: segments.join('/'),
      };
    }
    return { allowed: false, kind: null, ttlSeconds: 0, cleanPath: '' };
  }

  if (head === 'movie' || head === 'tv') {
    if (segments.length >= 2 && segments.length <= 6) {
      return {
        allowed: true,
        kind: 'detail',
        ttlSeconds: DETAIL_CACHE_TTL_SECONDS,
        cleanPath: segments.join('/'),
      };
    }
    return { allowed: false, kind: null, ttlSeconds: 0, cleanPath: '' };
  }

  return { allowed: false, kind: null, ttlSeconds: 0, cleanPath: '' };
}

export function buildSanitizedTmdbUrls(cleanPath, incomingSearchParams, tmdbApiKey) {
  const sanitized = new URLSearchParams();
  const entries = Array.from(incomingSearchParams.entries())
    .filter(([k]) => !SECRET_PARAM_RE.test(k))
    .sort(([a], [b]) => a.localeCompare(b));

  for (const [k, v] of entries) {
    sanitized.append(k, v);
  }

  const cacheQuery = sanitized.toString();
  const cacheUrl = `${TMDB_UPSTREAM_BASE}/${cleanPath}${cacheQuery ? `?${cacheQuery}` : ''}`;

  const upstreamParams = new URLSearchParams(sanitized);
  upstreamParams.set('api_key', tmdbApiKey);
  const upstreamUrl = `${TMDB_UPSTREAM_BASE}/${cleanPath}?${upstreamParams.toString()}`;

  return { cacheUrl, upstreamUrl };
}

export function buildSanitizedOmdbUrls(incomingSearchParams, omdbApiKey) {
  const sanitized = new URLSearchParams();
  const collected = [];

  for (const [rawKey, rawVal] of incomingSearchParams.entries()) {
    if (SECRET_PARAM_RE.test(rawKey)) continue;
    const canonical = ALLOWED_OMDB_PARAMS.get(String(rawKey).toLowerCase());
    if (!canonical) continue;
    const val = String(rawVal || '').trim();
    if (!val) continue;
    collected.push([canonical, val]);
  }

  collected.sort(([a], [b]) => a.localeCompare(b));
  for (const [k, v] of collected) {
    sanitized.set(k, v);
  }

  const hasLookup = sanitized.has('i') || sanitized.has('t') || sanitized.has('s');
  if (!hasLookup) {
    return {
      ok: false,
      error: 'Informe ao menos um parâmetro OMDb válido (i, t ou s).',
    };
  }

  const isSearch = sanitized.has('s');
  const ttlSeconds = isSearch ? SEARCH_CACHE_TTL_SECONDS : DETAIL_CACHE_TTL_SECONDS;
  const cacheUrl = `${OMDB_UPSTREAM_BASE}?${sanitized.toString()}`;

  const upstreamParams = new URLSearchParams(sanitized);
  upstreamParams.set('apikey', omdbApiKey);
  const upstreamUrl = `${OMDB_UPSTREAM_BASE}?${upstreamParams.toString()}`;

  return {
    ok: true,
    kind: isSearch ? 'search' : 'detail',
    ttlSeconds,
    cacheUrl,
    upstreamUrl,
  };
}

export function buildSanitizedLastfmUrls(incomingSearchParams, lastfmApiKey) {
  const rawMethod = String(incomingSearchParams?.get?.('method') || '').trim().toLowerCase();
  const canonicalMethod = ALLOWED_LASTFM_METHODS.get(rawMethod);
  if (!canonicalMethod) {
    return {
      ok: false,
      status: 403,
      error: 'Método Last.fm não permitido pelo proxy (use artist.getTopTags ou album.getTopTags).',
    };
  }

  const sanitized = new URLSearchParams();
  sanitized.set('method', canonicalMethod);
  const collected = [];

  for (const [rawKey, rawVal] of incomingSearchParams.entries()) {
    if (SECRET_PARAM_RE.test(rawKey)) continue;
    const canonical = ALLOWED_LASTFM_PARAMS.get(String(rawKey).toLowerCase());
    if (!canonical) continue;
    const val = String(rawVal || '').trim();
    if (!val) continue;
    collected.push([canonical, val]);
  }

  collected.sort(([a], [b]) => a.localeCompare(b));
  for (const [k, v] of collected) {
    sanitized.set(k, v);
  }
  sanitized.set('format', 'json');

  const hasArtist = sanitized.has('artist');
  const hasAlbum = sanitized.has('album');
  const hasMbid = sanitized.has('mbid');

  if (canonicalMethod === 'artist.getTopTags' && !hasArtist && !hasMbid) {
    return {
      ok: false,
      status: 400,
      error: 'Informe artist ou mbid para artist.getTopTags.',
    };
  }
  if (canonicalMethod === 'album.getTopTags' && !hasMbid && !(hasArtist && hasAlbum)) {
    return {
      ok: false,
      status: 400,
      error: 'Informe artist e album (ou mbid) para album.getTopTags.',
    };
  }

  const cacheUrl = `${LASTFM_UPSTREAM_BASE}?${sanitized.toString()}`;
  const upstreamParams = new URLSearchParams(sanitized);
  upstreamParams.set('api_key', lastfmApiKey);
  const upstreamUrl = `${LASTFM_UPSTREAM_BASE}?${upstreamParams.toString()}`;

  return {
    ok: true,
    status: 200,
    method: canonicalMethod,
    ttlSeconds: DETAIL_CACHE_TTL_SECONDS,
    cacheUrl,
    upstreamUrl,
  };
}

export function validateRawgPath(rawPathname = '', paramsPath = null) {
  const pathname = String(rawPathname || '');
  const lowerRaw = pathname.toLowerCase();
  if (
    lowerRaw.includes('..') ||
    lowerRaw.includes('%2e') ||
    lowerRaw.includes('%2f') ||
    lowerRaw.includes('%5c') ||
    lowerRaw.includes('\\') ||
    lowerRaw.includes('@')
  ) {
    return { allowed: false, kind: null, ttlSeconds: 0, cleanPath: '' };
  }

  const strippedPrefix = pathname.replace(/^\/api\/rawg\/?/i, '');
  if (!strippedPrefix || strippedPrefix.includes('//')) {
    return { allowed: false, kind: null, ttlSeconds: 0, cleanPath: '' };
  }

  let segments;
  if (Array.isArray(paramsPath) && paramsPath.length > 0) {
    segments = paramsPath.map((s) => String(s || '').trim());
  } else if (typeof paramsPath === 'string' && paramsPath.trim()) {
    segments = paramsPath.split('/').map((s) => s.trim());
  } else {
    segments = strippedPrefix.split('/').map((s) => s.trim());
  }

  if (segments.length === 0 || segments.some((seg) => !seg)) {
    return { allowed: false, kind: null, ttlSeconds: 0, cleanPath: '' };
  }

  const [head, second, third] = segments;
  if (head === 'games' && segments.length === 1) {
    return {
      allowed: true,
      kind: 'search',
      ttlSeconds: SEARCH_CACHE_TTL_SECONDS,
      cleanPath: 'games',
    };
  }

  if (head === 'games' && segments.length === 2 && SAFE_RAWG_ID_RE.test(second)) {
    return {
      allowed: true,
      kind: 'detail',
      ttlSeconds: DETAIL_CACHE_TTL_SECONDS,
      cleanPath: `games/${second}`,
    };
  }

  if (
    head === 'games' &&
    segments.length === 3 &&
    SAFE_RAWG_ID_RE.test(second) &&
    ALLOWED_RAWG_GAME_SUBPATHS.has(third)
  ) {
    return {
      allowed: true,
      kind: 'detail',
      ttlSeconds: DETAIL_CACHE_TTL_SECONDS,
      cleanPath: `games/${second}/${third}`,
    };
  }

  return { allowed: false, kind: null, ttlSeconds: 0, cleanPath: '' };
}

export function buildSanitizedRawgUrls(cleanPath, incomingSearchParams, rawgApiKey) {
  const sanitized = new URLSearchParams();
  const allowsSearchParams =
    cleanPath === 'games' ||
    cleanPath.endsWith('/additions') ||
    cleanPath.endsWith('/game-series') ||
    cleanPath.endsWith('/parent-games');
  if (allowsSearchParams && incomingSearchParams) {
    const collected = [];
    for (const [rawKey, rawVal] of incomingSearchParams.entries()) {
      if (SECRET_PARAM_RE.test(rawKey)) continue;
      const canonical = ALLOWED_RAWG_SEARCH_PARAMS.get(String(rawKey).toLowerCase());
      if (!canonical) continue;
      const val = String(rawVal || '').trim();
      if (!val) continue;
      collected.push([canonical, val]);
    }
    collected.sort(([a], [b]) => a.localeCompare(b));
    for (const [k, v] of collected) {
      sanitized.set(k, v);
    }
  }

  const cacheQuery = sanitized.toString();
  const cacheUrl = `${RAWG_UPSTREAM_BASE}/${cleanPath}${cacheQuery ? `?${cacheQuery}` : ''}`;

  const upstreamParams = new URLSearchParams(sanitized);
  upstreamParams.set('key', rawgApiKey);
  const upstreamUrl = `${RAWG_UPSTREAM_BASE}/${cleanPath}?${upstreamParams.toString()}`;

  return { cacheUrl, upstreamUrl };
}

export function resolveDefaultCache(cacheOverride = null) {
  if (cacheOverride && typeof cacheOverride.match === 'function') {
    return cacheOverride;
  }
  try {
    if (typeof caches !== 'undefined' && caches?.default && typeof caches.default.match === 'function') {
      return caches.default;
    }
  } catch {
    // Sem Cache API disponível no ambiente
  }
  return null;
}

export async function proxyWithDefaultCache({
  cacheUrl,
  upstreamUrl,
  ttlSeconds,
  secretsToMask = [],
  shouldCacheBody = null,
  fetchImpl = fetch,
  cacheOverride = null,
  waitUntil = null,
  timeoutMs = 8000,
}) {
  const cache = resolveDefaultCache(cacheOverride);
  const cacheKey = new Request(cacheUrl, { method: 'GET' });

  if (cache) {
    try {
      const cached = await cache.match(cacheKey);
      if (cached) {
        const body = await cached.text();
        return new Response(body, {
          status: cached.status,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': `private, max-age=${ttlSeconds}`,
            'X-Proxy-Cache': 'HIT',
            'X-Content-Type-Options': 'nosniff',
            Vary: 'Authorization',
          },
        });
      }
    } catch {
      // Continua para busca upstream se cache.match falhar
    }
  }

  let upstreamRes;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer =
    controller && Number(timeoutMs) > 0
      ? setTimeout(() => controller.abort(), Math.max(200, Number(timeoutMs)))
      : null;

  try {
    upstreamRes = await fetchImpl(upstreamUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      ...(controller ? { signal: controller.signal } : {}),
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      return jsonResponse({ error: 'Tempo limite excedido ao consultar provedor externo.' }, 504);
    }
    return jsonResponse({ error: 'Falha ao consultar provedor externo.' }, 502);
  } finally {
    if (timer) clearTimeout(timer);
  }

  const rawText = await upstreamRes.text().catch(() => '');
  const safeText = maskSensitiveValues(rawText, secretsToMask);

  if (!upstreamRes.ok) {
    return jsonResponse(
      {
        error: `Provedor externo retornou HTTP ${upstreamRes.status}.`,
        upstreamStatus: upstreamRes.status,
      },
      upstreamRes.status >= 400 && upstreamRes.status < 600 ? upstreamRes.status : 502
    );
  }

  const allowCache =
    typeof shouldCacheBody === 'function' ? Boolean(shouldCacheBody(safeText)) : true;

  if (cache && allowCache) {
    const cacheableResponse = new Response(safeText, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': `public, max-age=${ttlSeconds}`,
        'X-Content-Type-Options': 'nosniff',
      },
    });
    const putPromise = Promise.resolve(cache.put(cacheKey, cacheableResponse.clone())).catch(
      () => {}
    );
    if (typeof waitUntil === 'function') {
      waitUntil(putPromise);
    } else {
      await putPromise;
    }
  }

  return new Response(safeText, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': allowCache ? `private, max-age=${ttlSeconds}` : 'no-store',
      'X-Proxy-Cache': 'MISS',
      'X-Content-Type-Options': 'nosniff',
      Vary: 'Authorization',
    },
  });
}
