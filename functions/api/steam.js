import {
  DETAIL_CACHE_TTL_SECONDS,
  SEARCH_CACHE_TTL_SECONDS,
  STEAM_STORE_UPSTREAM_BASE,
  isAllowedSameOriginRequest,
  jsonResponse,
  methodNotAllowedResponse,
  proxyWithDefaultCache,
} from '../_lib/proxyCore.js';

export async function handleSteamProxyRequest(
  context,
  { fetchImpl = fetch, cacheOverride = null } = {}
) {
  const { request, waitUntil } = context || {};
  if (request?.method !== 'GET') {
    return methodNotAllowedResponse();
  }

  if (!isAllowedSameOriginRequest(request)) {
    return jsonResponse({ error: 'Origem não autorizada para proxy Steam.' }, 403);
  }

  let incomingUrl;
  try {
    incomingUrl = new URL(request.url);
  } catch {
    return jsonResponse({ error: 'URL de requisição inválida.' }, 400);
  }

  const appidRaw = String(incomingUrl.searchParams.get('appid') || '').trim();
  const termRaw = String(
    incomingUrl.searchParams.get('term') || incomingUrl.searchParams.get('search') || ''
  ).trim();

  if (appidRaw) {
    if (!/^\d+$/.test(appidRaw)) {
      return jsonResponse({ error: 'appid Steam inválido.' }, 400);
    }
    const qs = new URLSearchParams({
      appids: appidRaw,
      l: 'portuguese',
      cc: 'br',
    }).toString();
    const upstreamUrl = `${STEAM_STORE_UPSTREAM_BASE}/appdetails?${qs}`;
    return proxyWithDefaultCache({
      cacheUrl: upstreamUrl,
      upstreamUrl,
      ttlSeconds: DETAIL_CACHE_TTL_SECONDS,
      fetchImpl,
      cacheOverride,
      waitUntil: typeof waitUntil === 'function' ? waitUntil.bind(context) : null,
    });
  }

  if (!termRaw) {
    return jsonResponse({ error: 'Informe term ou appid para consultar a Steam Store.' }, 400);
  }

  const qs = new URLSearchParams({
    term: termRaw.slice(0, 120),
    l: 'portuguese',
    cc: 'br',
  }).toString();
  const upstreamUrl = `${STEAM_STORE_UPSTREAM_BASE}/storesearch/?${qs}`;

  return proxyWithDefaultCache({
    cacheUrl: upstreamUrl,
    upstreamUrl,
    ttlSeconds: SEARCH_CACHE_TTL_SECONDS,
    fetchImpl,
    cacheOverride,
    waitUntil: typeof waitUntil === 'function' ? waitUntil.bind(context) : null,
  });
}

export async function onRequest(context) {
  return handleSteamProxyRequest(context);
}
