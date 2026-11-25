import {
  buildSanitizedGoogleBooksUrls,
  jsonResponse,
  methodNotAllowedResponse,
  proxyWithDefaultCache,
  readServerEnvConfig,
  verifySupabaseAuth,
} from '../_lib/proxyCore.js';

export async function handleGoogleBooksProxyRequest(
  context,
  { fetchImpl = fetch, cacheOverride = null, timeoutMs = 8000 } = {}
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
  if (!cfg.googleBooksApiKey) {
    return jsonResponse(
      {
        error: 'Google Books API key não configurada no servidor.',
        notConfigured: true,
      },
      503
    );
  }

  let incomingUrl;
  try {
    incomingUrl = new URL(request.url);
  } catch {
    return jsonResponse({ error: 'URL de requisição inválida.' }, 400);
  }

  const built = buildSanitizedGoogleBooksUrls(incomingUrl.searchParams, cfg.googleBooksApiKey);
  if (!built.ok) {
    return jsonResponse({ error: built.error }, 400);
  }

  return proxyWithDefaultCache({
    cacheUrl: built.cacheUrl,
    upstreamUrl: built.upstreamUrl,
    ttlSeconds: built.ttlSeconds,
    secretsToMask: [cfg.googleBooksApiKey, cfg.supabaseAnonKey],
    fetchImpl,
    cacheOverride,
    timeoutMs,
    waitUntil: typeof waitUntil === 'function' ? waitUntil.bind(context) : null,
  });
}

export async function onRequest(context) {
  return handleGoogleBooksProxyRequest(context);
}
