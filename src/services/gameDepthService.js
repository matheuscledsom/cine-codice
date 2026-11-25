/**
 * Serviço de profundidade para Games (IGDB -> RAWG via proxy Cloudflare).
 * Nunca usa chaves VITE_ no cliente; degrada sem quebrar quando credenciais
 * não estão configuradas no servidor.
 */

import { getCachedEntry, setCachedEntry } from '../api/cacheDb.js';
import { CACHE_STORES, CACHE_TTL_MS } from '../api/limits.js';
import { parseIgdbGameMetadata, parseRawgGameMetadata } from '../lib/gameDepth.js';
import { fetchIgdbViaProxy, fetchRawgViaProxy } from './apiProxyClient.js';

const GAME_DEPTH_CACHE_TTL_MS = CACHE_TTL_MS.relations || 7 * 24 * 60 * 60 * 1000;

function normalizeKey(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export async function fetchIgdbGameDepth(
  work = {},
  {
    fetchImpl = fetch,
    nowFn = Date.now,
    signal = undefined,
    accessToken = '',
    supabaseClient = null,
    storage = null,
    forceProxy = null,
    isDev = undefined,
    idbFactory = null,
    forceRefresh = false,
  } = {}
) {
  const knownId = Number(work?.igdbId || work?.ids?.igdb);
  const title = String(work?.title || '').trim();
  const normTitle = normalizeKey(title);
  if (!(knownId > 0) && !normTitle) {
    return { ok: false, notConfigured: false, data: null };
  }

  const cacheKey = `igdb:depth:${knownId > 0 ? knownId : normTitle}`;
  if (!forceRefresh) {
    const cached = await getCachedEntry(CACHE_STORES.relations, cacheKey, {
      idbFactory,
      now: nowFn(),
    }).catch(() => null);
    if (cached?.hit && cached.data && !cached.expired) {
      return { ok: true, notConfigured: false, data: cached.data, fromCache: true };
    }
  }

  const proxyOpts = {
    fetchImpl,
    nowFn,
    signal,
    accessToken,
    supabaseClient,
    storage,
    forceProxy,
    ...(isDev !== undefined ? { isDev } : {}),
  };

  let rawGame = null;
  if (knownId > 0) {
    const detailOut = await fetchIgdbViaProxy(`games/${Math.floor(knownId)}`, {}, proxyOpts);
    if (detailOut.notConfigured) {
      return { ok: false, notConfigured: true, data: null, fromCache: false };
    }
    if (!detailOut.ok) {
      return { ok: false, notConfigured: false, data: null, fromCache: false };
    }
    rawGame = detailOut.data?.game || null;
  } else {
    const searchOut = await fetchIgdbViaProxy(
      'games',
      { search: title, limit: '5' },
      proxyOpts
    );
    if (searchOut.notConfigured) {
      return { ok: false, notConfigured: true, data: null, fromCache: false };
    }
    if (!searchOut.ok) {
      return { ok: false, notConfigured: false, data: null, fromCache: false };
    }
    const list = Array.isArray(searchOut.data?.results) ? searchOut.data.results : [];
    rawGame =
      list.find((g) => normalizeKey(g?.name) === normTitle) || list[0] || null;
  }

  if (!rawGame) {
    return { ok: false, notConfigured: false, data: null, fromCache: false };
  }

  const parsed = parseIgdbGameMetadata(rawGame);
  if (!parsed) {
    return { ok: false, notConfigured: false, data: null, fromCache: false };
  }

  await setCachedEntry(CACHE_STORES.relations, cacheKey, parsed, {
    ttlMs: GAME_DEPTH_CACHE_TTL_MS,
    idbFactory,
    now: nowFn(),
  }).catch(() => {});

  return {
    ok: true,
    notConfigured: false,
    data: parsed,
    fromCache: false,
  };
}

export async function fetchRawgGameDepth(
  work = {},
  {
    fetchImpl = fetch,
    nowFn = Date.now,
    signal = undefined,
    accessToken = '',
    supabaseClient = null,
    storage = null,
    forceProxy = null,
    isDev = undefined,
    idbFactory = null,
    forceRefresh = false,
  } = {}
) {
  const knownId = Number(work?.rawgId || work?.ids?.rawg);
  const title = String(work?.title || '').trim();
  const normTitle = normalizeKey(title);
  if (!(knownId > 0) && !normTitle) {
    return { ok: false, notConfigured: false, data: null };
  }

  const cacheKey = `rawg:depth:${knownId > 0 ? knownId : normTitle}`;
  if (!forceRefresh) {
    const cached = await getCachedEntry(CACHE_STORES.relations, cacheKey, {
      idbFactory,
      now: nowFn(),
    }).catch(() => null);
    if (cached?.hit && cached.data && !cached.expired) {
      return { ok: true, notConfigured: false, data: cached.data, fromCache: true };
    }
  }

  const proxyOpts = {
    fetchImpl,
    nowFn,
    signal,
    accessToken,
    supabaseClient,
    storage,
    forceProxy,
    ...(isDev !== undefined ? { isDev } : {}),
  };

  let targetId = knownId > 0 ? Math.floor(knownId) : null;

  if (!targetId) {
    const searchOut = await fetchRawgViaProxy(
      'games',
      { search: title, page_size: '5', search_precise: 'true' },
      proxyOpts
    );
    if (searchOut.notConfigured) {
      return { ok: false, notConfigured: true, data: null, fromCache: false };
    }
    if (!searchOut.ok) {
      return { ok: false, notConfigured: false, data: null, fromCache: false };
    }
    const list = Array.isArray(searchOut.data?.results) ? searchOut.data.results : [];
    const exact =
      list.find((g) => normalizeKey(g?.name) === normTitle) || list[0] || null;
    if (!exact?.id) {
      return { ok: false, notConfigured: false, data: null, fromCache: false };
    }
    targetId = Number(exact.id);
  }

  const detailOut = await fetchRawgViaProxy(`games/${targetId}`, {}, proxyOpts);
  if (detailOut.notConfigured) {
    return { ok: false, notConfigured: true, data: null, fromCache: false };
  }
  if (!detailOut.ok || !detailOut.data) {
    return { ok: false, notConfigured: false, data: null, fromCache: false };
  }

  const parsed = parseRawgGameMetadata(detailOut.data);
  if (!parsed) {
    return { ok: false, notConfigured: false, data: null, fromCache: false };
  }

  await setCachedEntry(CACHE_STORES.relations, cacheKey, parsed, {
    ttlMs: GAME_DEPTH_CACHE_TTL_MS,
    idbFactory,
    now: nowFn(),
  }).catch(() => {});

  return {
    ok: true,
    notConfigured: false,
    data: parsed,
    fromCache: false,
  };
}

export async function fetchGameDepthWithFallback(work = {}, options = {}) {
  const igdbRes = await fetchIgdbGameDepth(work, options);
  if (igdbRes.ok && igdbRes.data) {
    return { ok: true, source: 'igdb', data: igdbRes.data, notConfigured: false };
  }
  const rawgRes = await fetchRawgGameDepth(work, options);
  if (rawgRes.ok && rawgRes.data) {
    return { ok: true, source: 'rawg', data: rawgRes.data, notConfigured: false };
  }
  return {
    ok: false,
    source: null,
    data: null,
    notConfigured: Boolean(igdbRes.notConfigured && rawgRes.notConfigured),
  };
}

/**
 * Busca jogos reais de uma franquia ou coleção na IGDB (`/api/igdb/franchises` ou `collections`),
 * com fallback para RAWG `games/{rawgId}/game-series` quando disponível.
 * Nunca usa listas fixas no código.
 */
export async function fetchIgdbFranchiseGames(
  franchiseQueryOrObj = '',
  {
    franchiseId = null,
    collectionId = null,
    rawgId = null,
    fetchImpl = fetch,
    nowFn = Date.now,
    signal = undefined,
    accessToken = '',
    supabaseClient = null,
    storage = null,
    forceProxy = null,
    isDev = undefined,
    idbFactory = null,
    forceRefresh = false,
  } = {}
) {
  const queryName =
    typeof franchiseQueryOrObj === 'string'
      ? franchiseQueryOrObj.trim()
      : String(franchiseQueryOrObj?.franchiseName || franchiseQueryOrObj?.name || '').trim();
  const cleanFranchiseId = Number(franchiseId || franchiseQueryOrObj?.franchiseId) || null;
  const cleanCollectionId = Number(collectionId || franchiseQueryOrObj?.collectionId) || null;
  const cleanRawgId = Number(rawgId || franchiseQueryOrObj?.rawgId || franchiseQueryOrObj?.ids?.rawg) || null;
  const normQuery = normalizeKey(queryName);

  if (!normQuery && !cleanFranchiseId && !cleanCollectionId && !cleanRawgId) {
    return {
      available: false,
      source: null,
      franchiseName: queryName,
      games: [],
      notConfigured: false,
      fromCache: false,
    };
  }

  const cacheKey = `igdb:franchise:${cleanFranchiseId || cleanCollectionId || normQuery || cleanRawgId}`;
  if (!forceRefresh) {
    const cached = await getCachedEntry(CACHE_STORES.relations, cacheKey, {
      idbFactory,
      now: nowFn(),
    }).catch(() => null);
    if (cached?.hit && cached.data && !cached.expired) {
      return { ...cached.data, fromCache: true };
    }
  }

  const proxyOpts = {
    fetchImpl,
    nowFn,
    signal,
    accessToken,
    supabaseClient,
    storage,
    forceProxy,
    ...(isDev !== undefined ? { isDev } : {}),
  };

  let igdbNotConfigured = false;
  let igdbFranchise = null;

  try {
    if (cleanFranchiseId) {
      const out = await fetchIgdbViaProxy(`franchises/${Math.floor(cleanFranchiseId)}`, {}, proxyOpts);
      if (out.notConfigured) igdbNotConfigured = true;
      else if (out.ok) igdbFranchise = out.data?.franchise || null;
    } else if (cleanCollectionId) {
      const out = await fetchIgdbViaProxy(`collections/${Math.floor(cleanCollectionId)}`, {}, proxyOpts);
      if (out.notConfigured) igdbNotConfigured = true;
      else if (out.ok) igdbFranchise = out.data?.collection || null;
    } else if (queryName) {
      const out = await fetchIgdbViaProxy(
        'franchises',
        { search: queryName, limit: '5' },
        proxyOpts
      );
      if (out.notConfigured) {
        igdbNotConfigured = true;
      } else if (out.ok) {
        const rows = Array.isArray(out.data?.results) ? out.data.results : [];
        igdbFranchise =
          rows.find((f) => normalizeKey(f?.name) === normQuery) ||
          rows.find((f) => Array.isArray(f?.games) && f.games.length > 0) ||
          rows[0] ||
          null;
      }
    }
  } catch (err) {
    if (err?.name === 'AbortError' || signal?.aborted) throw err;
  }

  if (igdbFranchise && Array.isArray(igdbFranchise.games) && igdbFranchise.games.length > 0) {
    const resolvedName = String(igdbFranchise.name || queryName).trim();
    const seen = new Set();
    const games = [];
    for (const rawGame of igdbFranchise.games) {
      if (!rawGame || typeof rawGame !== 'object') continue;
      const parsed = parseIgdbGameMetadata(rawGame);
      if (!parsed || !parsed.title) continue;
      const dedupKey = parsed.igdbId ? `igdb:${parsed.igdbId}` : `t:${normalizeKey(parsed.title)}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      const editionType = parsed.editionType || 'Jogo';
      const franchiseTier =
        editionType === 'Coletânea'
          ? 'companion'
          : editionType !== 'Jogo'
            ? 'spinoff'
            : 'mainline';

      games.push({
        id: parsed.igdbId ? `igdb-${parsed.igdbId}` : `igdb-${normalizeKey(parsed.title)}`,
        domain: 'games',
        workType: editionType === 'DLC' ? 'dlc' : 'game',
        title: parsed.title,
        creator: parsed.developer || parsed.publisher || '',
        studio: parsed.developer || parsed.publisher || '',
        releaseYear: parsed.releaseYear || null,
        coverUrl: parsed.coverUrl || null,
        coverSources: parsed.coverUrl ? [parsed.coverUrl] : [],
        platforms: parsed.platforms || [],
        originalPlatforms: parsed.originalPlatforms || [],
        editionType,
        franchiseName: resolvedName,
        franchiseTier,
        igdbId: parsed.igdbId || null,
        parentGame: parsed.parentGame || null,
        versionParent: parsed.versionParent || null,
        ids: {
          ...(parsed.igdbId ? { igdb: parsed.igdbId } : {}),
        },
        source: 'igdb',
        sourceBadge: 'IGDB',
      });
    }

    games.sort((a, b) => {
      const yA = a.releaseYear ?? 9999;
      const yB = b.releaseYear ?? 9999;
      if (yA !== yB) return yA - yB;
      return a.title.localeCompare(b.title, 'pt-BR');
    });

    const payload = {
      available: true,
      source: 'IGDB',
      franchiseName: resolvedName,
      games,
      notConfigured: false,
      fromCache: false,
    };

    await setCachedEntry(CACHE_STORES.relations, cacheKey, payload, {
      ttlMs: GAME_DEPTH_CACHE_TTL_MS,
      idbFactory,
      now: nowFn(),
    }).catch(() => {});

    return payload;
  }

  // Fallback para RAWG game-series caso IGDB não esteja configurada ou não retorne a franquia
  if (cleanRawgId) {
    try {
      const rawgOut = await fetchRawgViaProxy(
        `games/${Math.floor(cleanRawgId)}/game-series`,
        { page_size: '40' },
        proxyOpts
      );
      if (rawgOut.ok && Array.isArray(rawgOut.data?.results) && rawgOut.data.results.length > 0) {
        const games = rawgOut.data.results
          .map((g) => {
            const parsed = parseRawgGameMetadata(g);
            if (!parsed?.title) return null;
            return {
              id: parsed.rawgId ? `rawg-${parsed.rawgId}` : `rawg-${normalizeKey(parsed.title)}`,
              domain: 'games',
              workType: 'game',
              title: parsed.title,
              creator: parsed.developer || '',
              releaseYear: parsed.releaseYear || null,
              coverUrl: parsed.coverUrl || null,
              platforms: parsed.platforms || [],
              editionType: parsed.editionType || 'Jogo',
              franchiseName: queryName,
              franchiseTier: parsed.editionType && parsed.editionType !== 'Jogo' ? 'spinoff' : 'mainline',
              rawgId: parsed.rawgId || null,
              ids: parsed.rawgId ? { rawg: parsed.rawgId } : {},
              source: 'rawg',
              sourceBadge: 'RAWG',
            };
          })
          .filter(Boolean)
          .sort((a, b) => (a.releaseYear ?? 9999) - (b.releaseYear ?? 9999));

        if (games.length > 0) {
          const payload = {
            available: true,
            source: 'RAWG',
            franchiseName: queryName,
            games,
            notConfigured: false,
            fromCache: false,
          };
          await setCachedEntry(CACHE_STORES.relations, cacheKey, payload, {
            ttlMs: GAME_DEPTH_CACHE_TTL_MS,
            idbFactory,
            now: nowFn(),
          }).catch(() => {});
          return payload;
        }
      }
    } catch (err) {
      if (err?.name === 'AbortError' || signal?.aborted) throw err;
    }
  }

  return {
    available: false,
    source: null,
    franchiseName: queryName,
    games: [],
    notConfigured: igdbNotConfigured,
    fromCache: false,
  };
}
