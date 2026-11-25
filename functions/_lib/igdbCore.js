/**
 * Núcleo do proxy IGDB v4 via Cloudflare Pages Functions.
 *
 * - Credenciais Twitch (`TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`) apenas no servidor.
 * - Cache em memória do token OAuth com renovação automática antes da expiração e em HTTP 401.
 * - Fila serializada com janela deslizante de no máximo 4 requisições por segundo.
 * - Usa os campos atuais da IGDB API v4 (`game_type.*`, `game_time_to_beats`, `version_parent`, `parent_game`, etc.).
 */

import {
  DETAIL_CACHE_TTL_SECONDS,
  IGDB_UPSTREAM_BASE,
  SEARCH_CACHE_TTL_SECONDS,
  TWITCH_OAUTH_TOKEN_URL,
  maskSensitiveValues,
  resolveDefaultCache,
} from './proxyCore.js';

export const IGDB_MAX_REQUESTS_PER_SEC = 4;
export const IGDB_RATE_WINDOW_MS = 1000;
const TOKEN_EXPIRY_BUFFER_MS = 60_000;

let tokenCache = null; // { clientId, accessToken, expiresAtMs }
let inFlightToken = null;

const rateState = {
  queueTail: Promise.resolve(),
  timestamps: [],
};

function defaultSleep(ms) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function resetIgdbServerStateForTests() {
  tokenCache = null;
  inFlightToken = null;
  rateState.queueTail = Promise.resolve();
  rateState.timestamps = [];
}

export function getIgdbTokenCacheSnapshotForTests() {
  return tokenCache ? { ...tokenCache } : null;
}

export function sanitizeApicalypseSearchText(raw = '') {
  return String(raw || '')
    .replace(/[\r\n\t\0;]+/g, ' ')
    .replace(/\\/g, ' ')
    .replace(/"/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

export const IGDB_GAME_FIELDS = [
  'id',
  'name',
  'slug',
  'summary',
  'first_release_date',
  'game_type.*',
  'parent_game.id',
  'parent_game.name',
  'parent_game.first_release_date',
  'version_parent.id',
  'version_parent.name',
  'version_parent.first_release_date',
  'cover.image_id',
  'platforms.id',
  'platforms.name',
  'platforms.abbreviation',
  'release_dates.platform.id',
  'release_dates.platform.name',
  'release_dates.platform.abbreviation',
  'release_dates.date',
  'release_dates.y',
  'involved_companies.developer',
  'involved_companies.publisher',
  'involved_companies.company.name',
  'franchises.id',
  'franchises.name',
  'collections.id',
  'collections.name',
  'remakes',
  'remasters',
  'ports',
  'expansions',
  'dlcs',
  'bundles',
].join(',');

export async function getTwitchOAuthToken(
  { twitchClientId, twitchClientSecret },
  { fetchImpl = fetch, nowFn = Date.now, forceRefresh = false } = {}
) {
  const clientId = String(twitchClientId || '').trim();
  const clientSecret = String(twitchClientSecret || '').trim();
  if (!clientId || !clientSecret) {
    throw new Error('TWITCH_CREDENTIALS_MISSING');
  }

  const now = nowFn();
  if (
    !forceRefresh &&
    tokenCache &&
    tokenCache.clientId === clientId &&
    tokenCache.accessToken &&
    now < tokenCache.expiresAtMs - TOKEN_EXPIRY_BUFFER_MS
  ) {
    return tokenCache.accessToken;
  }

  if (inFlightToken) {
    return inFlightToken;
  }

  inFlightToken = (async () => {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    });

    const res = await fetchImpl(`${TWITCH_OAUTH_TOKEN_URL}?${body.toString()}`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });

    if (!res || !res.ok) {
      const status = res?.status || 502;
      const err = new Error(`Twitch OAuth HTTP ${status}`);
      err.status = status;
      throw err;
    }

    const json = await res.json().catch(() => null);
    const accessToken = String(json?.access_token || '').trim();
    if (!accessToken) {
      throw new Error('Twitch OAuth token ausente na resposta.');
    }

    const expiresInSec = Math.max(120, Number(json?.expires_in) || 3600);
    tokenCache = {
      clientId,
      accessToken,
      expiresAtMs: nowFn() + expiresInSec * 1000,
    };
    return accessToken;
  })();

  try {
    return await inFlightToken;
  } finally {
    inFlightToken = null;
  }
}

export function enqueueIgdbRateLimited(
  taskFn,
  { nowFn = Date.now, sleepFn = defaultSleep } = {}
) {
  const runPromise = rateState.queueTail.then(async () => {
    let guard = 0;
    while (guard < 32) {
      guard += 1;
      const now = nowFn();
      rateState.timestamps = rateState.timestamps.filter(
        (ts) => now - ts < IGDB_RATE_WINDOW_MS
      );
      if (rateState.timestamps.length < IGDB_MAX_REQUESTS_PER_SEC) {
        break;
      }
      const oldest = rateState.timestamps[0];
      const waitMs = Math.max(10, oldest + IGDB_RATE_WINDOW_MS - now + 5);
      await sleepFn(waitMs);
    }
    rateState.timestamps.push(nowFn());
    return taskFn();
  });

  rateState.queueTail = runPromise.catch(() => {});
  return runPromise;
}

export async function queryIgdbUpstream(
  endpoint,
  apicalypseBody,
  cfg,
  { fetchImpl = fetch, nowFn = Date.now, sleepFn = defaultSleep } = {}
) {
  const cleanEndpoint = String(endpoint || '').replace(/^\/+/, '');
  const url = `${IGDB_UPSTREAM_BASE}/${cleanEndpoint}`;

  const attemptCall = async (forceRefreshToken = false) => {
    const accessToken = await getTwitchOAuthToken(cfg, {
      fetchImpl,
      nowFn,
      forceRefresh: forceRefreshToken,
    });

    const res = await enqueueIgdbRateLimited(
      () =>
        fetchImpl(url, {
          method: 'POST',
          headers: {
            'Client-ID': cfg.twitchClientId,
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
            'Content-Type': 'text/plain',
          },
          body: apicalypseBody,
        }),
      { nowFn, sleepFn }
    );

    return { res, accessToken };
  };

  let { res, accessToken } = await attemptCall(false);
  if (res?.status === 401) {
    tokenCache = null;
    ({ res, accessToken } = await attemptCall(true));
  }

  if (res?.status === 429) {
    await sleepFn(300);
    ({ res, accessToken } = await attemptCall(false));
  }

  const rawText = await res?.text?.().catch(() => '') ?? '';
  const safeText = maskSensitiveValues(rawText, [
    cfg.twitchClientId,
    cfg.twitchClientSecret,
    accessToken,
    cfg.supabaseAnonKey,
  ]);

  if (!res || !res.ok) {
    const err = new Error(`IGDB HTTP ${res?.status || 502}`);
    err.status = res?.status || 502;
    err.safeBody = safeText;
    throw err;
  }

  try {
    return JSON.parse(safeText || '[]');
  } catch {
    return [];
  }
}

export async function enrichIgdbGamesWithTimeToBeat(
  games = [],
  cfg,
  { fetchImpl = fetch, nowFn = Date.now, sleepFn = defaultSleep } = {}
) {
  const list = Array.isArray(games) ? games : [];
  const ids = Array.from(
    new Set(
      list
        .map((g) => Number(g?.id))
        .filter((id) => Number.isInteger(id) && id > 0)
    )
  ).slice(0, 20);

  if (ids.length === 0) return list;

  try {
    const ttbRows = await queryIgdbUpstream(
      'game_time_to_beats',
      `fields game_id,hastily,normally,completely,count; where game_id = (${ids.join(',')}); limit ${ids.length};`,
      cfg,
      { fetchImpl, nowFn, sleepFn }
    );

    const ttbByGameId = new Map();
    for (const row of Array.isArray(ttbRows) ? ttbRows : []) {
      const gid = Number(row?.game_id);
      if (Number.isInteger(gid) && gid > 0) {
        ttbByGameId.set(gid, {
          game_id: gid,
          hastily: Number(row.hastily) > 0 ? Number(row.hastily) : null,
          normally: Number(row.normally) > 0 ? Number(row.normally) : null,
          completely: Number(row.completely) > 0 ? Number(row.completely) : null,
          count: Number(row.count) > 0 ? Number(row.count) : null,
        });
      }
    }

    return list.map((g) => ({
      ...g,
      time_to_beat: ttbByGameId.get(Number(g?.id)) || null,
    }));
  } catch {
    // Falha no tempo médio não deve descartar os jogos encontrados
    return list;
  }
}

export function validateIgdbProxyPath(rawPathname = '', paramsPath = null) {
  const pathname = String(rawPathname || '');
  const lower = pathname.toLowerCase();
  if (
    lower.includes('..') ||
    lower.includes('%2e') ||
    lower.includes('%2f') ||
    lower.includes('%5c') ||
    lower.includes('\\')
  ) {
    return { allowed: false };
  }

  const stripped = pathname.replace(/^\/api\/igdb\/?/i, '');
  let segments;
  if (Array.isArray(paramsPath) && paramsPath.length > 0) {
    segments = paramsPath.map((s) => String(s || '').trim());
  } else if (typeof paramsPath === 'string' && paramsPath.trim()) {
    segments = paramsPath.split('/').map((s) => s.trim());
  } else {
    segments = stripped.split('/').map((s) => s.trim());
  }

  if (segments.length === 0 || segments.some((s) => !s)) {
    return { allowed: false };
  }

  const [head, second] = segments;
  if (head === 'games' && segments.length === 1) {
    return { allowed: true, route: 'games_search', ttlSeconds: SEARCH_CACHE_TTL_SECONDS };
  }
  if (head === 'games' && segments.length === 2 && /^\d+$/.test(second)) {
    return {
      allowed: true,
      route: 'game_detail',
      id: Number(second),
      ttlSeconds: DETAIL_CACHE_TTL_SECONDS,
    };
  }
  if (head === 'franchises' && segments.length === 1) {
    return {
      allowed: true,
      route: 'franchises_search',
      ttlSeconds: SEARCH_CACHE_TTL_SECONDS,
    };
  }
  if (head === 'franchises' && segments.length === 2 && /^\d+$/.test(second)) {
    return {
      allowed: true,
      route: 'franchise_detail',
      id: Number(second),
      ttlSeconds: DETAIL_CACHE_TTL_SECONDS,
    };
  }
  if (head === 'collections' && segments.length === 2 && /^\d+$/.test(second)) {
    return {
      allowed: true,
      route: 'collection_detail',
      id: Number(second),
      ttlSeconds: DETAIL_CACHE_TTL_SECONDS,
    };
  }

  return { allowed: false };
}

export async function runCachedIgdbJson({
  cacheUrl,
  ttlSeconds,
  computeFn,
  cacheOverride = null,
  waitUntil = null,
}) {
  const cache = resolveDefaultCache(cacheOverride);
  const cacheKey = new Request(cacheUrl, { method: 'GET' });

  if (cache) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit) {
        const body = await hit.text();
        return new Response(body, {
          status: hit.status,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': `private, max-age=${ttlSeconds}`,
            'X-Proxy-Cache': 'HIT',
            'X-Content-Type-Options': 'nosniff',
          },
        });
      }
    } catch {
      // Segue para consulta upstream
    }
  }

  const payload = await computeFn();
  const bodyStr = JSON.stringify(payload);

  if (cache) {
    const cacheable = new Response(bodyStr, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': `public, max-age=${ttlSeconds}`,
        'X-Content-Type-Options': 'nosniff',
      },
    });
    const putPromise = Promise.resolve(cache.put(cacheKey, cacheable.clone())).catch(() => {});
    if (typeof waitUntil === 'function') {
      waitUntil(putPromise);
    } else {
      await putPromise;
    }
  }

  return new Response(bodyStr, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `private, max-age=${ttlSeconds}`,
      'X-Proxy-Cache': 'MISS',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
