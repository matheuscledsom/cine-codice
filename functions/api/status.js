import {
  jsonResponse,
  methodNotAllowedResponse,
  readServerEnvConfig,
  verifySupabaseAuth,
} from '../_lib/proxyCore.js';

export async function handleStatusRequest(context, { fetchImpl = fetch } = {}) {
  const { request, env } = context || {};
  if (request?.method !== 'GET') {
    return methodNotAllowedResponse();
  }

  const auth = await verifySupabaseAuth(request, env, { fetchImpl });
  if (!auth.ok) {
    return jsonResponse({ error: auth.error }, auth.status);
  }

  const cfg = readServerEnvConfig(env);
  return jsonResponse(
    {
      ok: true,
      providers: {
        tmdb: { configured: Boolean(cfg.providers.tmdb.configured) },
        omdb: { configured: Boolean(cfg.providers.omdb.configured) },
        lastfm: { configured: Boolean(cfg.providers.lastfm.configured) },
      },
    },
    200
  );
}

export async function onRequest(context) {
  return handleStatusRequest(context);
}
