import {
  buildSanitizedOmdbUrls,
  jsonResponse,
  methodNotAllowedResponse,
  proxyWithDefaultCache,
  readServerEnvConfig,
  verifySupabaseAuth,
} from '../_lib/proxyCore.js';

function isCacheableOmdbPayload(rawBody) {
  try {
    const parsed = JSON.parse(rawBody);
    if (parsed?.Response === 'False') {
      const err = String(parsed?.Error || '').toLowerCase();
      if (err.includes('invalid api key') || err.includes('limit') || err.includes('no api key')) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export async function handleOmdbProxyRequest(
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

  const cfg = readServerEnvConfig(env);
  if (!cfg.omdbApiKey) {
    return jsonResponse({ error: 'OMDb não configurado no servidor.' }, 503);
  }

  let incomingUrl;
  try {
    incomingUrl = new URL(request.url);
  } catch {
    return jsonResponse({ error: 'URL de requisição inválida.' }, 400);
  }

  const built = buildSanitizedOmdbUrls(incomingUrl.searchParams, cfg.omdbApiKey);
  if (!built.ok) {
    return jsonResponse({ error: built.error }, 400);
  }

  return proxyWithDefaultCache({
    cacheUrl: built.cacheUrl,
    upstreamUrl: built.upstreamUrl,
    ttlSeconds: built.ttlSeconds,
    secretsToMask: [cfg.omdbApiKey, cfg.supabaseAnonKey],
    shouldCacheBody: isCacheableOmdbPayload,
    fetchImpl,
    cacheOverride,
    waitUntil: typeof waitUntil === 'function' ? waitUntil.bind(context) : null,
  });
}

export async function onRequest(context) {
  return handleOmdbProxyRequest(context);
}
