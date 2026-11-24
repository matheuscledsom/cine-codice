import {
  buildSanitizedRawgUrls,
  jsonResponse,
  methodNotAllowedResponse,
  proxyWithDefaultCache,
  readServerEnvConfig,
  validateRawgPath,
  verifySupabaseAuth,
} from '../../_lib/proxyCore.js';

export async function handleRawgProxyRequest(
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

  const validation = validateRawgPath(incomingUrl.pathname, params?.path);
  if (!validation.allowed) {
    return jsonResponse({ error: 'Endpoint RAWG não permitido pelo proxy.' }, 403);
  }

  const cfg = readServerEnvConfig(env);
  if (!cfg.rawgApiKey) {
    return jsonResponse(
      { error: 'RAWG não configurado no servidor.', configured: false },
      503
    );
  }

  const { cacheUrl, upstreamUrl } = buildSanitizedRawgUrls(
    validation.cleanPath,
    incomingUrl.searchParams,
    cfg.rawgApiKey
  );

  return proxyWithDefaultCache({
    cacheUrl,
    upstreamUrl,
    ttlSeconds: validation.ttlSeconds,
    secretsToMask: [cfg.rawgApiKey, cfg.supabaseAnonKey],
    fetchImpl,
    cacheOverride,
    waitUntil: typeof waitUntil === 'function' ? waitUntil.bind(context) : null,
  });
}

export async function onRequest(context) {
  return handleRawgProxyRequest(context);
}
