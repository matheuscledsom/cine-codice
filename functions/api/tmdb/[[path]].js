import {
  buildSanitizedTmdbUrls,
  jsonResponse,
  methodNotAllowedResponse,
  proxyWithDefaultCache,
  readServerEnvConfig,
  validateTmdbPath,
  verifySupabaseAuth,
} from '../../_lib/proxyCore.js';

export async function handleTmdbProxyRequest(
  context,
  { fetchImpl = fetch, cacheOverride = null } = {}
) {
  const { request, env, params, waitUntil } = context || {};
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

  const validation = validateTmdbPath(incomingUrl.pathname, params?.path);
  if (!validation.allowed) {
    return jsonResponse({ error: 'Endpoint TMDB não permitido pelo proxy.' }, 403);
  }

  const cfg = readServerEnvConfig(env);
  if (!cfg.tmdbApiKey) {
    return jsonResponse({ error: 'TMDB não configurado no servidor.' }, 503);
  }

  const { cacheUrl, upstreamUrl } = buildSanitizedTmdbUrls(
    validation.cleanPath,
    incomingUrl.searchParams,
    cfg.tmdbApiKey
  );

  return proxyWithDefaultCache({
    cacheUrl,
    upstreamUrl,
    ttlSeconds: validation.ttlSeconds,
    secretsToMask: [cfg.tmdbApiKey, cfg.supabaseAnonKey],
    fetchImpl,
    cacheOverride,
    waitUntil: typeof waitUntil === 'function' ? waitUntil.bind(context) : null,
  });
}

export async function onRequest(context) {
  return handleTmdbProxyRequest(context);
}
