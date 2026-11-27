import {
  buildSanitizedSteamAchievementsUrls,
  jsonResponse,
  methodNotAllowedResponse,
  proxyWithDefaultCache,
  readServerEnvConfig,
  verifySupabaseAuth,
} from '../_lib/proxyCore.js';

export async function handleSteamAchievementsProxyRequest(
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
  if (!cfg.steamWebApiKey) {
    return jsonResponse(
      {
        error: 'Steam Web API key não configurada no servidor.',
        notConfigured: true,
        configured: false,
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

  if (incomingUrl.searchParams.get('probe') === '1') {
    return jsonResponse(
      {
        ok: true,
        configured: true,
        provider: 'steamAchievements',
      },
      200
    );
  }

  const built = buildSanitizedSteamAchievementsUrls(
    incomingUrl.searchParams,
    cfg.steamWebApiKey
  );
  if (!built.ok) {
    return jsonResponse({ error: built.error }, built.status || 400);
  }

  return proxyWithDefaultCache({
    cacheUrl: built.cacheUrl,
    upstreamUrl: built.upstreamUrl,
    ttlSeconds: built.ttlSeconds,
    secretsToMask: [cfg.steamWebApiKey, cfg.supabaseAnonKey],
    shouldCacheBody: (bodyText) => {
      try {
        const parsed = JSON.parse(bodyText);
        if (parsed?.playerstats && parsed.playerstats.success === false) {
          return false;
        }
        return Boolean(parsed && typeof parsed === 'object');
      } catch {
        return false;
      }
    },
    fetchImpl,
    cacheOverride,
    timeoutMs,
    waitUntil: typeof waitUntil === 'function' ? waitUntil.bind(context) : null,
  });
}

export async function onRequest(context) {
  return handleSteamAchievementsProxyRequest(context);
}
