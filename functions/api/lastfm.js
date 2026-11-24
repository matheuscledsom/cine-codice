import {
  buildSanitizedLastfmUrls,
  jsonResponse,
  methodNotAllowedResponse,
  proxyWithDefaultCache,
  readServerEnvConfig,
  verifySupabaseAuth,
} from '../_lib/proxyCore.js';

function isCacheableLastfmPayload(rawBody) {
  try {
    const parsed = JSON.parse(rawBody);
    if (parsed && typeof parsed.error === 'number') {
      return false;
    }
    return Boolean(parsed && typeof parsed === 'object');
  } catch {
    return false;
  }
}

export async function handleLastfmProxyRequest(
  context,
  { fetchImpl = fetch, cacheOverride = null } = {}
) {
  const { request, env, waitUntil } = context || {};
  if (request?.method !== 'GET') {
    return methodNotAllowedResponse();
  }

  const auth = await verifySupabaseAuth(request, env, { fetchImpl });
  if (!auth.ok) {
    return jsonResponse({ error: auth.error }, auth.status);
  }

  let incomingUrl;
  try {
    incomingUrl = new URL(request.url);
  } catch {
    return jsonResponse({ error: 'URL de requisição inválida.' }, 400);
  }

  const cfg = readServerEnvConfig(env);
  if (!cfg.lastfmApiKey) {
    return jsonResponse(
      { error: 'Last.fm não configurado no servidor.', configured: false },
      503
    );
  }

  const built = buildSanitizedLastfmUrls(incomingUrl.searchParams, cfg.lastfmApiKey);
  if (!built.ok) {
    return jsonResponse({ error: built.error }, built.status || 400);
  }

  return proxyWithDefaultCache({
    cacheUrl: built.cacheUrl,
    upstreamUrl: built.upstreamUrl,
    ttlSeconds: built.ttlSeconds,
    secretsToMask: [cfg.lastfmApiKey, cfg.supabaseAnonKey],
    shouldCacheBody: isCacheableLastfmPayload,
    fetchImpl,
    cacheOverride,
    waitUntil: typeof waitUntil === 'function' ? waitUntil.bind(context) : null,
  });
}

export async function onRequest(context) {
  return handleLastfmProxyRequest(context);
}
