/**
 * Serviço de profundidade para Games (IGDB -> RAWG via proxy Cloudflare).
 * Nunca usa chaves VITE_ no cliente; degrada sem quebrar quando credenciais
 * não estão configuradas no servidor.
 */

import { getCachedEntry, setCachedEntry } from '../api/cacheDb.js';
import { CACHE_STORES, CACHE_TTL_MS } from '../api/limits.js';
import {
  buildAchievementsSyncPatch,
  parseIgdbGameMetadata,
  parseRawgGameMetadata,
  parseRetroAchievementsResponse,
  parseSteamAchievementsResponse,
  parseSteamOwnedGamesResponse,
} from '../lib/gameDepth.js';
import {
  fetchIgdbViaProxy,
  fetchRawgViaProxy,
  fetchRetroAchievementsViaProxy,
  fetchSteamAchievementsViaProxy,
} from './apiProxyClient.js';
import { isProviderEnabled } from './providerRegistry.js';

export const ACHIEVEMENT_SYNC_HANDLES_STORAGE_KEY = 'omniprism_achievement_handles_v1';

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

export function sanitizeSteamIdInput(raw) {
  const digits = String(raw || '')
    .trim()
    .replace(/\s+/g, '');
  return /^\d{5,20}$/.test(digits) ? digits : '';
}

export function sanitizeNumericGameIdInput(raw) {
  const digits = String(raw || '')
    .trim()
    .replace(/\s+/g, '');
  return /^\d+$/.test(digits) ? digits : '';
}

export function sanitizeRetroAchievementsUsername(raw) {
  const clean = String(raw || '').trim();
  return /^[a-zA-Z0-9_-]{2,40}$/.test(clean) ? clean : '';
}

function resolveHandlesStorage(customStorage = null) {
  if (customStorage) return customStorage;
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    // Sem acesso a localStorage
  }
  return null;
}

/**
 * Carrega apenas identificadores públicos (SteamID64 / usuário RetroAchievements) para reuso
 * entre jogos. Nunca armazena chaves ou tokens de API.
 */
export function loadAchievementSyncHandles({ storage = null } = {}) {
  const store = resolveHandlesStorage(storage);
  if (!store || typeof store.getItem !== 'function') {
    return { steamId: '', retroachievementsUsername: '' };
  }
  try {
    const raw = store.getItem(ACHIEVEMENT_SYNC_HANDLES_STORAGE_KEY);
    if (!raw) return { steamId: '', retroachievementsUsername: '' };
    const parsed = JSON.parse(raw);
    return {
      steamId: sanitizeSteamIdInput(parsed?.steamId),
      retroachievementsUsername: sanitizeRetroAchievementsUsername(
        parsed?.retroachievementsUsername
      ),
    };
  } catch {
    return { steamId: '', retroachievementsUsername: '' };
  }
}

export function saveAchievementSyncHandles(
  { steamId, retroachievementsUsername } = {},
  { storage = null } = {}
) {
  const prev = loadAchievementSyncHandles({ storage });
  const next = {
    steamId: steamId !== undefined ? sanitizeSteamIdInput(steamId) : prev.steamId,
    retroachievementsUsername:
      retroachievementsUsername !== undefined
        ? sanitizeRetroAchievementsUsername(retroachievementsUsername)
        : prev.retroachievementsUsername,
  };
  const store = resolveHandlesStorage(storage);
  if (store && typeof store.setItem === 'function') {
    try {
      store.setItem(ACHIEVEMENT_SYNC_HANDLES_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Silencioso em quota
    }
  }
  return next;
}

/**
 * Sincroniza conquistas de um jogo na Steam via proxy Cloudflare `/api/steam-achievements`
 * (`STEAM_WEB_API_KEY` apenas no servidor). Se `appId` não for informado, tenta localizar
 * o jogo na biblioteca do usuário via `GetOwnedGames` pelo título.
 */
export async function syncSteamGameAchievements(
  { steamId = '', appId = '', gameTitle = '' } = {},
  {
    fetchImpl = fetch,
    nowFn = Date.now,
    signal = undefined,
    accessToken = '',
    supabaseClient = null,
    storage = null,
    forceProxy = null,
    isDev = undefined,
  } = {}
) {
  if (!isProviderEnabled('steamAchievements', { storage })) {
    return {
      ok: false,
      disabled: true,
      notConfigured: false,
      authRequired: false,
      resolvedAppId: null,
      gameName: '',
      achievements: null,
      error: 'Steam Conquistas está desativada em Status das APIs.',
    };
  }

  const cleanSteamId = sanitizeSteamIdInput(steamId);
  if (!cleanSteamId) {
    return {
      ok: false,
      disabled: false,
      notConfigured: false,
      authRequired: false,
      resolvedAppId: null,
      gameName: '',
      achievements: null,
      error: 'Informe um SteamID64 numérico válido para sincronizar.',
    };
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

  let cleanAppId = sanitizeNumericGameIdInput(appId);

  if (!cleanAppId && String(gameTitle || '').trim()) {
    const ownedOut = await fetchSteamAchievementsViaProxy(
      { action: 'owned_games', steamId: cleanSteamId },
      proxyOpts
    );
    if (ownedOut.notConfigured || ownedOut.status === 503) {
      return {
        ok: false,
        disabled: false,
        notConfigured: true,
        authRequired: Boolean(ownedOut.authRequired),
        resolvedAppId: null,
        gameName: '',
        achievements: null,
        error: ownedOut.authRequired
          ? 'Entre na sua conta para sincronizar conquistas via servidor.'
          : 'Sem chave no servidor (configure STEAM_WEB_API_KEY no Cloudflare).',
      };
    }
    if (ownedOut.ok && ownedOut.data) {
      const parsedOwned = parseSteamOwnedGamesResponse(ownedOut.data, { titleHint: gameTitle });
      if (parsedOwned.matchedGame?.appId) {
        cleanAppId = String(parsedOwned.matchedGame.appId);
      }
    }
  }

  if (!cleanAppId) {
    return {
      ok: false,
      disabled: false,
      notConfigured: false,
      authRequired: false,
      resolvedAppId: null,
      gameName: '',
      achievements: null,
      error: 'Informe o AppID Steam do jogo (não encontrado automaticamente na biblioteca).',
    };
  }

  const out = await fetchSteamAchievementsViaProxy(
    { action: 'achievements', steamId: cleanSteamId, appId: cleanAppId },
    proxyOpts
  );

  if (out.notConfigured || out.status === 503) {
    return {
      ok: false,
      disabled: false,
      notConfigured: true,
      authRequired: Boolean(out.authRequired),
      resolvedAppId: Number(cleanAppId),
      gameName: '',
      achievements: null,
      error: out.authRequired
        ? 'Entre na sua conta para sincronizar conquistas via servidor.'
        : 'Sem chave no servidor (configure STEAM_WEB_API_KEY no Cloudflare).',
    };
  }

  if (!out.ok) {
    if (out.data?.playerstats) {
      const parsedErr = parseSteamAchievementsResponse(out.data, {
        nowIso: new Date(nowFn()).toISOString(),
      });
      return {
        ok: false,
        disabled: false,
        notConfigured: false,
        authRequired: out.status === 401,
        resolvedAppId: Number(cleanAppId),
        gameName: parsedErr.gameName,
        achievements: null,
        error: parsedErr.error,
      };
    }
    return {
      ok: false,
      disabled: false,
      notConfigured: false,
      authRequired: out.status === 401,
      resolvedAppId: Number(cleanAppId),
      gameName: '',
      achievements: null,
      error:
        out.status === 403
          ? 'Perfil Steam privado. Torne os detalhes de jogos públicos na Steam para sincronizar.'
          : out.status === 400
            ? 'Jogo sem conquistas públicas na Steam ou AppID/SteamID inválido.'
            : out.timedOut
              ? 'Tempo limite excedido ao consultar Steam.'
              : 'Não foi possível sincronizar conquistas Steam agora.',
    };
  }

  const parsed = parseSteamAchievementsResponse(out.data, {
    nowIso: new Date(nowFn()).toISOString(),
  });
  return {
    ok: parsed.ok,
    disabled: false,
    notConfigured: false,
    authRequired: false,
    resolvedAppId: Number(cleanAppId),
    gameName: parsed.gameName,
    achievements: parsed.achievements,
    error: parsed.error,
  };
}

/**
 * Sincroniza conquistas de emuladores via proxy Cloudflare `/api/retroachievements`
 * (`RETROACHIEVEMENTS_API_KEY` apenas no servidor).
 */
export async function syncRetroAchievementsGame(
  { username = '', gameId = '' } = {},
  {
    fetchImpl = fetch,
    nowFn = Date.now,
    signal = undefined,
    accessToken = '',
    supabaseClient = null,
    storage = null,
    forceProxy = null,
    isDev = undefined,
  } = {}
) {
  if (!isProviderEnabled('retroachievements', { storage })) {
    return {
      ok: false,
      disabled: true,
      notConfigured: false,
      authRequired: false,
      gameTitle: '',
      consoleName: '',
      achievements: null,
      error: 'RetroAchievements está desativada em Status das APIs.',
    };
  }

  const cleanUser = sanitizeRetroAchievementsUsername(username);
  if (!cleanUser) {
    return {
      ok: false,
      disabled: false,
      notConfigured: false,
      authRequired: false,
      gameTitle: '',
      consoleName: '',
      achievements: null,
      error: 'Informe um usuário válido do RetroAchievements.',
    };
  }

  const cleanGameId = sanitizeNumericGameIdInput(gameId);
  if (!cleanGameId) {
    return {
      ok: false,
      disabled: false,
      notConfigured: false,
      authRequired: false,
      gameTitle: '',
      consoleName: '',
      achievements: null,
      error: 'Informe o Game ID numérico do RetroAchievements.',
    };
  }

  const out = await fetchRetroAchievementsViaProxy(
    { username: cleanUser, gameId: cleanGameId },
    {
      fetchImpl,
      nowFn,
      signal,
      accessToken,
      supabaseClient,
      storage,
      forceProxy,
      ...(isDev !== undefined ? { isDev } : {}),
    }
  );

  if (out.notConfigured || out.status === 503) {
    return {
      ok: false,
      disabled: false,
      notConfigured: true,
      authRequired: Boolean(out.authRequired),
      gameTitle: '',
      consoleName: '',
      achievements: null,
      error: out.authRequired
        ? 'Entre na sua conta para sincronizar conquistas via servidor.'
        : 'Sem chave no servidor (configure RETROACHIEVEMENTS_API_KEY no Cloudflare).',
    };
  }

  if (!out.ok) {
    return {
      ok: false,
      disabled: false,
      notConfigured: false,
      authRequired: out.status === 401,
      gameTitle: '',
      consoleName: '',
      achievements: null,
      error:
        out.status === 404
          ? 'Jogo ou usuário não encontrado no RetroAchievements.'
          : out.timedOut
            ? 'Tempo limite excedido ao consultar RetroAchievements.'
            : 'Não foi possível sincronizar conquistas do RetroAchievements agora.',
    };
  }

  const parsed = parseRetroAchievementsResponse(out.data, {
    nowIso: new Date(nowFn()).toISOString(),
  });
  return {
    ok: parsed.ok,
    disabled: false,
    notConfigured: false,
    authRequired: false,
    gameTitle: parsed.gameTitle,
    consoleName: parsed.consoleName,
    achievements: parsed.achievements,
    error: parsed.error,
  };
}

export { buildAchievementsSyncPatch };
