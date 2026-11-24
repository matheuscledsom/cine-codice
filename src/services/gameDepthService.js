/**
 * Serviço RAWG via proxy autenticado Cloudflare (`/api/rawg/games` e `/api/rawg/games/{id}`).
 * Nunca usa chaves VITE_ no cliente; degrada sem quebrar quando RAWG_API_KEY
 * não está configurada no servidor.
 */

import { getCachedEntry, setCachedEntry } from '../api/cacheDb.js';
import { CACHE_STORES, CACHE_TTL_MS } from '../api/limits.js';
import { parseRawgGameMetadata } from '../lib/gameDepth.js';
import { fetchRawgViaProxy } from './apiProxyClient.js';

const RAWG_CACHE_TTL_MS = CACHE_TTL_MS.relations || 7 * 24 * 60 * 60 * 1000;

function normalizeKey(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
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
    ttlMs: RAWG_CACHE_TTL_MS,
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
