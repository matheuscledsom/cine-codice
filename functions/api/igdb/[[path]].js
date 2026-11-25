import {
  IGDB_GAME_FIELDS,
  enrichIgdbGamesWithTimeToBeat,
  queryIgdbUpstream,
  runCachedIgdbJson,
  sanitizeApicalypseSearchText,
  validateIgdbProxyPath,
} from '../../_lib/igdbCore.js';
import {
  IGDB_UPSTREAM_BASE,
  jsonResponse,
  methodNotAllowedResponse,
  readServerEnvConfig,
  verifySupabaseAuth,
} from '../../_lib/proxyCore.js';

export async function handleIgdbProxyRequest(
  context,
  { fetchImpl = fetch, cacheOverride = null, nowFn = Date.now, sleepFn = undefined } = {}
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

  const validation = validateIgdbProxyPath(incomingUrl.pathname, params?.path);
  if (!validation.allowed) {
    return jsonResponse({ error: 'Endpoint IGDB não permitido pelo proxy.' }, 403);
  }

  const cfg = readServerEnvConfig(env);
  if (!cfg.twitchClientId || !cfg.twitchClientSecret) {
    return jsonResponse(
      { error: 'IGDB não configurado no servidor.', configured: false },
      503
    );
  }

  const upstreamOpts = {
    fetchImpl,
    nowFn,
    ...(sleepFn ? { sleepFn } : {}),
  };

  try {
    if (validation.route === 'games_search') {
      const searchRaw = incomingUrl.searchParams.get('search') || incomingUrl.searchParams.get('q') || '';
      const cleanSearch = sanitizeApicalypseSearchText(searchRaw);
      const isProbe = incomingUrl.searchParams.get('probe') === '1';
      if (!cleanSearch && !isProbe) {
        return jsonResponse({ error: 'Informe o parâmetro search para consultar a IGDB.' }, 400);
      }
      const limit = Math.max(1, Math.min(20, Number(incomingUrl.searchParams.get('limit')) || 12));
      const effectiveSearch = cleanSearch || 'Portal';
      const effectiveLimit = isProbe ? 1 : limit;
      const cacheUrl = `${IGDB_UPSTREAM_BASE}/games?search=${encodeURIComponent(effectiveSearch)}&limit=${effectiveLimit}`;

      return await runCachedIgdbJson({
        cacheUrl,
        ttlSeconds: validation.ttlSeconds,
        cacheOverride,
        waitUntil: typeof waitUntil === 'function' ? waitUntil.bind(context) : null,
        computeFn: async () => {
          const games = await queryIgdbUpstream(
            'games',
            `search "${effectiveSearch}"; fields ${IGDB_GAME_FIELDS}; limit ${effectiveLimit};`,
            cfg,
            upstreamOpts
          );
          const enriched = isProbe
            ? games
            : await enrichIgdbGamesWithTimeToBeat(games, cfg, upstreamOpts);
          return {
            ok: true,
            source: 'igdb',
            results: Array.isArray(enriched) ? enriched : [],
          };
        },
      });
    }

    if (validation.route === 'game_detail') {
      const cacheUrl = `${IGDB_UPSTREAM_BASE}/games/${validation.id}`;
      return await runCachedIgdbJson({
        cacheUrl,
        ttlSeconds: validation.ttlSeconds,
        cacheOverride,
        waitUntil: typeof waitUntil === 'function' ? waitUntil.bind(context) : null,
        computeFn: async () => {
          const games = await queryIgdbUpstream(
            'games',
            `fields ${IGDB_GAME_FIELDS}; where id = ${validation.id}; limit 1;`,
            cfg,
            upstreamOpts
          );
          const enriched = await enrichIgdbGamesWithTimeToBeat(games, cfg, upstreamOpts);
          return {
            ok: true,
            source: 'igdb',
            game: Array.isArray(enriched) && enriched[0] ? enriched[0] : null,
          };
        },
      });
    }

    if (validation.route === 'franchises_search') {
      const cleanSearch = sanitizeApicalypseSearchText(
        incomingUrl.searchParams.get('search') || incomingUrl.searchParams.get('q') || ''
      );
      if (!cleanSearch) {
        return jsonResponse({ error: 'Informe search para buscar franquias.' }, 400);
      }
      const limit = Math.max(1, Math.min(10, Number(incomingUrl.searchParams.get('limit')) || 5));
      const cacheUrl = `${IGDB_UPSTREAM_BASE}/franchises?search=${encodeURIComponent(cleanSearch)}&limit=${limit}`;

      return await runCachedIgdbJson({
        cacheUrl,
        ttlSeconds: validation.ttlSeconds,
        cacheOverride,
        waitUntil: typeof waitUntil === 'function' ? waitUntil.bind(context) : null,
        computeFn: async () => {
          const franchises = await queryIgdbUpstream(
            'franchises',
            `search "${cleanSearch}"; fields id,name,slug,games.id,games.name,games.first_release_date,games.game_type.*,games.cover.image_id,games.platforms.name,games.platforms.abbreviation,games.parent_game,games.version_parent; limit ${limit};`,
            cfg,
            upstreamOpts
          );
          return {
            ok: true,
            source: 'igdb',
            results: Array.isArray(franchises) ? franchises : [],
          };
        },
      });
    }

    if (validation.route === 'franchise_detail' || validation.route === 'collection_detail') {
      const endpoint =
        validation.route === 'franchise_detail' ? 'franchises' : 'collections';
      const cacheUrl = `${IGDB_UPSTREAM_BASE}/${endpoint}/${validation.id}`;

      return await runCachedIgdbJson({
        cacheUrl,
        ttlSeconds: validation.ttlSeconds,
        cacheOverride,
        waitUntil: typeof waitUntil === 'function' ? waitUntil.bind(context) : null,
        computeFn: async () => {
          const rows = await queryIgdbUpstream(
            endpoint,
            `fields id,name,slug,games.id,games.name,games.first_release_date,games.game_type.*,games.cover.image_id,games.platforms.name,games.platforms.abbreviation,games.parent_game,games.version_parent; where id = ${validation.id}; limit 1;`,
            cfg,
            upstreamOpts
          );
          return {
            ok: true,
            source: 'igdb',
            [endpoint === 'franchises' ? 'franchise' : 'collection']:
              Array.isArray(rows) && rows[0] ? rows[0] : null,
          };
        },
      });
    }

    return jsonResponse({ error: 'Rota IGDB inválida.' }, 400);
  } catch (err) {
    const status = Number(err?.status);
    return jsonResponse(
      {
        error: status ? `IGDB retornou HTTP ${status}.` : 'Falha ao consultar IGDB.',
        upstreamStatus: status || 502,
      },
      status >= 400 && status < 600 ? status : 502
    );
  }
}

export async function onRequest(context) {
  return handleIgdbProxyRequest(context);
}
