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
