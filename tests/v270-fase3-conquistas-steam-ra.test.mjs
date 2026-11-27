import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { handleRetroAchievementsProxyRequest } from '../functions/api/retroachievements.js';
import { handleStatusRequest } from '../functions/api/status.js';
import { handleSteamAchievementsProxyRequest } from '../functions/api/steam-achievements.js';
import { resetApiClientStateForTests } from '../src/api/httpClient.js';
import { findForbiddenEmojisOrSymbols } from '../src/lib/emojiCheck.js';
import {
  buildAchievementsSyncPatch,
  formatAchievementsSourceLabel,
  formatGameAchievementsSummary,
  parseRetroAchievementsResponse,
  parseSteamAchievementsResponse,
  parseSteamOwnedGamesResponse,
} from '../src/lib/gameDepth.js';
import {
  API_STATUS_SOURCES,
  loadServerApiStatus,
  probeApiSource,
} from '../src/services/apiStatusService.js';
import {
  loadAchievementSyncHandles,
  saveAchievementSyncHandles,
  syncRetroAchievementsGame,
  syncSteamGameAchievements,
} from '../src/services/gameDepthService.js';
import {
  mapCatalogRowToLocalWork,
  mapLocalWorkToCatalogRow,
} from '../src/services/omniSyncService.js';
import {
  resetProviderRegistryForTests,
  setProviderEnabled,
} from '../src/services/providerRegistry.js';

const ROOT_DIR = process.cwd();

function readText(relPath) {
  return fs.readFileSync(path.resolve(ROOT_DIR, relPath), 'utf8');
}

function makeJsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  });
}

function createMockCloudflareCache() {
  const store = new Map();
  const operations = [];
  return {
    store,
    operations,
    async match(request) {
      const key = typeof request === 'string' ? request : request.url;
      operations.push({ op: 'match', key });
      const entry = store.get(key);
      return entry ? entry.clone() : undefined;
    },
    async put(request, response) {
      const key = typeof request === 'string' ? request : request.url;
      operations.push({
        op: 'put',
        key,
        cacheControl: response.headers.get('Cache-Control'),
      });
      store.set(key, response.clone());
    },
  };
}

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  };
}

function listFilesRecursive(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(full));
    else if (/\.(js|jsx|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('OMNIPRISM v2.7.0 Fase 3 — Sincronização de Conquistas (Steam + RetroAchievements + Offline)', () => {
  const baseEnv = {
    SUPABASE_URL: 'https://demo-proj.supabase.co',
    SUPABASE_ANON_KEY: 'anon-public-key-demo',
    STEAM_WEB_API_KEY: 'steam-server-secret-8899',
    RETROACHIEVEMENTS_API_KEY: 'ra-server-secret-4455',
  };

  it('1. CSP connect-src inclui api.steampowered.com e retroachievements.org, sem chaves VITE_ no cliente', () => {
    const headersText = readText('public/_headers');
    const cspMatch = headersText.match(/Content-Security-Policy:\s*(.+)/i);
    assert.ok(cspMatch);
    const connectDirective = cspMatch[1]
      .split(';')
      .map((d) => d.trim())
      .find((d) => /^connect-src\b/i.test(d));
    assert.ok(connectDirective);
    assert.equal(connectDirective.includes('https://api.steampowered.com'), true);
    assert.equal(connectDirective.includes('https://retroachievements.org'), true);
    assert.equal(connectDirective.includes('brasilapi.com.br'), false);

    for (const file of listFilesRecursive(path.resolve(ROOT_DIR, 'src'))) {
      const text = fs.readFileSync(file, 'utf8');
      assert.equal(
        /VITE_STEAM_WEB_API_KEY|VITE_RETROACHIEVEMENTS_API_KEY/.test(text),
        false,
        `Variável VITE_ proibida encontrada em ${path.relative(ROOT_DIR, file)}`
      );
    }
  });

  it('2. Proxy Steam (/api/steam-achievements): JWT obrigatório, 503 sem chave, GetPlayerAchievements + GetOwnedGames e cache sem segredo', async () => {
    const cache = createMockCloudflareCache();
    const upstreamUrls = [];

    const fetchMock = async (url, opts) => {
      const s = String(url);
      if (s.includes('/auth/v1/user')) {
        if (opts?.headers?.Authorization === 'Bearer jwt-ok') {
          return makeJsonResponse({ id: 'user-steam-1' }, 200);
        }
        return makeJsonResponse({ error: 'unauthorized' }, 401);
      }
      upstreamUrls.push(s);
      if (s.includes('ISteamUserStats/GetPlayerAchievements')) {
        return makeJsonResponse({
          playerstats: {
            steamID: '76561198000000001',
            gameName: 'Portal 2',
            success: true,
            achievements: [
              { apiname: 'ACH_1', achieved: 1 },
              { apiname: 'ACH_2', achieved: 1 },
              { apiname: 'ACH_3', achieved: 0 },
            ],
          },
        });
      }
      if (s.includes('IPlayerService/GetOwnedGames')) {
        return makeJsonResponse({
          response: {
            game_count: 2,
            games: [
              { appid: 620, name: 'Portal 2', playtime_forever: 720 },
              { appid: 400, name: 'Portal', playtime_forever: 240 },
            ],
          },
        });
      }
      return makeJsonResponse({ error: 'not found' }, 404);
    };

    // 405 em POST
    const rPost = await handleSteamAchievementsProxyRequest(
      {
        request: new Request('https://app.pages.dev/api/steam-achievements', {
          method: 'POST',
          headers: { Authorization: 'Bearer jwt-ok' },
        }),
        env: baseEnv,
      },
      { fetchImpl: fetchMock, cacheOverride: cache }
    );
    assert.equal(rPost.status, 405);

    // 401 sem Authorization
    const rNoAuth = await handleSteamAchievementsProxyRequest(
      {
        request: new Request(
          'https://app.pages.dev/api/steam-achievements?steamId=76561198000000001&appId=620'
        ),
        env: baseEnv,
      },
      { fetchImpl: fetchMock, cacheOverride: cache }
    );
    assert.equal(rNoAuth.status, 401);

    // 503 sem STEAM_WEB_API_KEY
    const rNoKey = await handleSteamAchievementsProxyRequest(
      {
        request: new Request('https://app.pages.dev/api/steam-achievements?probe=1', {
          headers: { Authorization: 'Bearer jwt-ok' },
        }),
        env: { ...baseEnv, STEAM_WEB_API_KEY: '' },
      },
      { fetchImpl: fetchMock, cacheOverride: cache }
    );
    assert.equal(rNoKey.status, 503);
    const noKeyJson = await rNoKey.json();
    assert.equal(noKeyJson.notConfigured, true);

    // probe=1 com chave -> 200 sem vazar chave
    const rProbe = await handleSteamAchievementsProxyRequest(
      {
        request: new Request('https://app.pages.dev/api/steam-achievements?probe=1', {
          headers: { Authorization: 'Bearer jwt-ok' },
        }),
        env: baseEnv,
      },
      { fetchImpl: fetchMock, cacheOverride: cache }
    );
    assert.equal(rProbe.status, 200);
    const probeText = await rProbe.text();
    assert.equal(probeText.includes(baseEnv.STEAM_WEB_API_KEY), false);

    // Ação não permitida -> 403; steamId inválido -> 400
    const rForbidden = await handleSteamAchievementsProxyRequest(
      {
        request: new Request(
          'https://app.pages.dev/api/steam-achievements?action=ban&steamId=76561198000000001&appId=620',
          { headers: { Authorization: 'Bearer jwt-ok' } }
        ),
        env: baseEnv,
      },
      { fetchImpl: fetchMock, cacheOverride: cache }
    );
    assert.equal(rForbidden.status, 403);

    const rBadId = await handleSteamAchievementsProxyRequest(
      {
        request: new Request(
          'https://app.pages.dev/api/steam-achievements?steamId=abc&appId=620',
          { headers: { Authorization: 'Bearer jwt-ok' } }
        ),
        env: baseEnv,
      },
      { fetchImpl: fetchMock, cacheOverride: cache }
    );
    assert.equal(rBadId.status, 400);

    // GetPlayerAchievements remove key do cliente, injeta STEAM_WEB_API_KEY e cacheia sem segredo
    const rAch1 = await handleSteamAchievementsProxyRequest(
      {
        request: new Request(
          'https://app.pages.dev/api/steam-achievements?action=achievements&steamId=76561198000000001&appId=620&key=CLIENT_EVIL',
          { headers: { Authorization: 'Bearer jwt-ok' } }
        ),
        env: baseEnv,
      },
      { fetchImpl: fetchMock, cacheOverride: cache }
    );
    assert.equal(rAch1.status, 200);
    assert.equal(rAch1.headers.get('X-Proxy-Cache'), 'MISS');
    assert.equal(upstreamUrls.length, 1);
    assert.equal(upstreamUrls[0].includes('CLIENT_EVIL'), false);
    assert.equal(upstreamUrls[0].includes(`key=${baseEnv.STEAM_WEB_API_KEY}`), true);

    const puts = cache.operations.filter((o) => o.op === 'put');
    assert.equal(puts.length, 1);
    assert.equal(puts[0].key.includes(baseEnv.STEAM_WEB_API_KEY), false);
    assert.equal(puts[0].key.includes('key='), false);

    // 2a chamada -> cache HIT
    const rAch2 = await handleSteamAchievementsProxyRequest(
      {
        request: new Request(
          'https://app.pages.dev/api/steam-achievements?steamId=76561198000000001&appId=620',
          { headers: { Authorization: 'Bearer jwt-ok' } }
        ),
        env: baseEnv,
      },
      { fetchImpl: fetchMock, cacheOverride: cache }
    );
    assert.equal(rAch2.status, 200);
    assert.equal(rAch2.headers.get('X-Proxy-Cache'), 'HIT');
    assert.equal(upstreamUrls.length, 1);

    // GetOwnedGames
    const rOwned = await handleSteamAchievementsProxyRequest(
      {
        request: new Request(
          'https://app.pages.dev/api/steam-achievements?action=owned_games&steamId=76561198000000001',
          { headers: { Authorization: 'Bearer jwt-ok' } }
        ),
        env: baseEnv,
      },
      { fetchImpl: fetchMock, cacheOverride: cache }
    );
    assert.equal(rOwned.status, 200);
    assert.equal(upstreamUrls.length, 2);
    assert.equal(upstreamUrls[1].includes('IPlayerService/GetOwnedGames/v0001/'), true);
    assert.equal(upstreamUrls[1].includes(`key=${baseEnv.STEAM_WEB_API_KEY}`), true);
  });

  it('3. Proxy RetroAchievements (/api/retroachievements): JWT obrigatório, 503 sem chave, remove y do cliente e cacheia sem segredo', async () => {
    const cache = createMockCloudflareCache();
    const upstreamUrls = [];

    const fetchMock = async (url, opts) => {
      const s = String(url);
      if (s.includes('/auth/v1/user')) {
        if (opts?.headers?.Authorization === 'Bearer jwt-ok') {
          return makeJsonResponse({ id: 'user-ra-1' }, 200);
        }
        return makeJsonResponse({ error: 'unauthorized' }, 401);
      }
      upstreamUrls.push(s);
      if (s.includes('API_GetGameInfoAndUserProgress.php')) {
        return makeJsonResponse({
          ID: 14402,
          Title: 'Shadow of the Colossus',
          ConsoleName: 'PlayStation 2',
          NumAchievements: 40,
          NumAwardedToUser: 28,
          NumAwardedToUserHardcore: 30,
        });
      }
      return makeJsonResponse({ error: 'not found' }, 404);
    };

    // 405 POST, 401 sem token, 503 sem chave
    const rPost = await handleRetroAchievementsProxyRequest(
      {
        request: new Request('https://app.pages.dev/api/retroachievements', {
          method: 'POST',
          headers: { Authorization: 'Bearer jwt-ok' },
        }),
        env: baseEnv,
      },
      { fetchImpl: fetchMock, cacheOverride: cache }
    );
    assert.equal(rPost.status, 405);

    const rNoAuth = await handleRetroAchievementsProxyRequest(
      {
        request: new Request(
          'https://app.pages.dev/api/retroachievements?username=retrofan&gameId=14402'
        ),
        env: baseEnv,
      },
      { fetchImpl: fetchMock, cacheOverride: cache }
    );
    assert.equal(rNoAuth.status, 401);

    const rNoKey = await handleRetroAchievementsProxyRequest(
      {
        request: new Request('https://app.pages.dev/api/retroachievements?probe=1', {
          headers: { Authorization: 'Bearer jwt-ok' },
        }),
        env: { ...baseEnv, RETROACHIEVEMENTS_API_KEY: '' },
      },
      { fetchImpl: fetchMock, cacheOverride: cache }
    );
    assert.equal(rNoKey.status, 503);

    // Parâmetros inválidos -> 400
    const rBadUser = await handleRetroAchievementsProxyRequest(
      {
        request: new Request(
          'https://app.pages.dev/api/retroachievements?username=../hack&gameId=14402',
          { headers: { Authorization: 'Bearer jwt-ok' } }
        ),
        env: baseEnv,
      },
      { fetchImpl: fetchMock, cacheOverride: cache }
    );
    assert.equal(rBadUser.status, 400);

    // Chamada válida remove y do cliente, injeta RETROACHIEVEMENTS_API_KEY e cacheia sem y
    const r1 = await handleRetroAchievementsProxyRequest(
      {
        request: new Request(
          'https://app.pages.dev/api/retroachievements?username=retro_hero&gameId=14402&y=CLIENT_FAKE&api_key=EVIL',
          { headers: { Authorization: 'Bearer jwt-ok' } }
        ),
        env: baseEnv,
      },
      { fetchImpl: fetchMock, cacheOverride: cache }
    );
    assert.equal(r1.status, 200);
    assert.equal(r1.headers.get('X-Proxy-Cache'), 'MISS');
    assert.equal(upstreamUrls.length, 1);
    assert.equal(upstreamUrls[0].includes('CLIENT_FAKE'), false);
    assert.equal(upstreamUrls[0].includes('EVIL'), false);
    assert.equal(upstreamUrls[0].includes(`y=${baseEnv.RETROACHIEVEMENTS_API_KEY}`), true);
    assert.equal(upstreamUrls[0].includes('g=14402'), true);
    assert.equal(upstreamUrls[0].includes('u=retro_hero'), true);

    const puts = cache.operations.filter((o) => o.op === 'put');
    assert.equal(puts.length, 1);
    assert.equal(puts[0].key.includes(baseEnv.RETROACHIEVEMENTS_API_KEY), false);
    assert.equal(puts[0].key.includes('y='), false);

    // 2a chamada -> HIT
    const r2 = await handleRetroAchievementsProxyRequest(
      {
        request: new Request(
          'https://app.pages.dev/api/retroachievements?username=retro_hero&gameId=14402',
          { headers: { Authorization: 'Bearer jwt-ok' } }
        ),
        env: baseEnv,
      },
      { fetchImpl: fetchMock, cacheOverride: cache }
    );
    assert.equal(r2.status, 200);
    assert.equal(r2.headers.get('X-Proxy-Cache'), 'HIT');
    assert.equal(upstreamUrls.length, 1);

    // GET /api/status expõe booleanos sem vazar segredos
    const statusRes = await handleStatusRequest(
      {
        request: new Request('https://app.pages.dev/api/status', {
          headers: { Authorization: 'Bearer jwt-ok' },
        }),
        env: baseEnv,
      },
      { fetchImpl: fetchMock }
    );
    assert.equal(statusRes.status, 200);
    const statusText = await statusRes.text();
    assert.equal(statusText.includes(baseEnv.STEAM_WEB_API_KEY), false);
    assert.equal(statusText.includes(baseEnv.RETROACHIEVEMENTS_API_KEY), false);
    const statusJson = JSON.parse(statusText);
    assert.equal(statusJson.providers.steamAchievements.configured, true);
    assert.equal(statusJson.providers.retroachievements.configured, true);
  });

  it('4. Painel Status das APIs e sondas incluem Steam Conquistas e RetroAchievements com Sem chave e switch Ativa/Desativada', async () => {
    resetApiClientStateForTests();
    assert.equal(API_STATUS_SOURCES.some((s) => s.id === 'steamAchievements'), true);
    assert.equal(API_STATUS_SOURCES.some((s) => s.id === 'retroachievements'), true);

    const statusLoaded = await loadServerApiStatus({
      accessToken: 'jwt-ok',
      forceProxy: true,
      isDev: false,
      fetchImpl: async () =>
        makeJsonResponse({
          ok: true,
          providers: {
            tmdb: { configured: true },
            omdb: { configured: false },
            lastfm: { configured: false },
            rawg: { configured: false },
            igdb: { configured: false },
            googleBooks: { configured: false },
            steamAchievements: { configured: true },
            retroachievements: { configured: false },
          },
        }),
    });
    assert.equal(statusLoaded.providers.steamAchievements.configured, true);
    assert.equal(statusLoaded.providers.retroachievements.configured, false);

    const steamNotCfg = await probeApiSource('steamAchievements', {
      accessToken: 'jwt-ok',
      forceProxy: true,
      isDev: false,
      fetchImpl: async () => makeJsonResponse({ notConfigured: true }, 503),
    });
    assert.equal(steamNotCfg.state, 'not_configured');

    const raOnline = await probeApiSource('retroachievements', {
      accessToken: 'jwt-ok',
      forceProxy: true,
      isDev: false,
      fetchImpl: async () => makeJsonResponse({ ok: true, configured: true }, 200),
    });
    assert.equal(raOnline.ok, true);
    assert.equal(raOnline.state, 'online');

    const panelSrc = readText('src/components/ApiStatusPanel.jsx');
    assert.equal(/<input\b/i.test(panelSrc), false);
    assert.match(panelSrc, /steamAchievements/);
    assert.match(panelSrc, /retroachievements/);
    assert.match(panelSrc, /Sem chave/);
    assert.match(panelSrc, /Ativa/);
    assert.match(panelSrc, /Desativada/);
  });

  it('5. Sincronização cliente (Steam + RetroAchievements), patch não-destrutivo (preserva notas/comentários), sync Supabase e WorkDetailPage', async () => {
    resetApiClientStateForTests();
    const storage = createMemoryStorage();
    resetProviderRegistryForTests({ storage });

    // Parsers puros
    const parsedSteam = parseSteamAchievementsResponse(
      {
        playerstats: {
          gameName: 'Hades',
          success: true,
          achievements: [
            { apiname: 'A1', achieved: 1 },
            { apiname: 'A2', achieved: 1 },
            { apiname: 'A3', achieved: 0 },
            { apiname: 'A4', achieved: 1 },
          ],
        },
      },
      { nowIso: '2026-11-26T22:00:00.000Z' }
    );
    assert.equal(parsedSteam.ok, true);
    assert.deepEqual(parsedSteam.achievements, {
      source: 'steam',
      unlocked: 3,
      total: 4,
      updated_at: '2026-11-26T22:00:00.000Z',
    });
    assert.equal(formatGameAchievementsSummary(parsedSteam.achievements)?.label, '3 / 4 (75%)');
    assert.equal(formatAchievementsSourceLabel('steam'), 'Steam');
    assert.equal(formatAchievementsSourceLabel('retroachievements'), 'RetroAchievements');

    const ownedMatch = parseSteamOwnedGamesResponse(
      {
        response: {
          games: [
            { appid: 1145360, name: 'Hades', playtime_forever: 3600 },
            { appid: 620, name: 'Portal 2', playtime_forever: 600 },
          ],
        },
      },
      { titleHint: 'Hades' }
    );
    assert.equal(ownedMatch.matchedGame?.appId, 1145360);

    const parsedRa = parseRetroAchievementsResponse(
      {
        ID: 14402,
        Title: 'Shadow of the Colossus',
        ConsoleName: 'PlayStation 2',
        NumAchievements: 40,
        NumAwardedToUser: 22,
        NumAwardedToUserHardcore: 25,
      },
      { nowIso: '2026-11-26T22:05:00.000Z' }
    );
    assert.equal(parsedRa.ok, true);
    assert.deepEqual(parsedRa.achievements, {
      source: 'retroachievements',
      unlocked: 25,
      total: 40,
      updated_at: '2026-11-26T22:05:00.000Z',
    });

    // Handles públicos salvos sem segredos
    saveAchievementSyncHandles(
      { steamId: '76561198000000001', retroachievementsUsername: 'retro_hero' },
      { storage }
    );
    assert.deepEqual(loadAchievementSyncHandles({ storage }), {
      steamId: '76561198000000001',
      retroachievementsUsername: 'retro_hero',
    });

    // syncSteamGameAchievements com resolução automática via GetOwnedGames
    const seenUrls = [];
    let steamClock = Date.parse('2026-11-26T22:10:00.000Z');
    const steamRes = await syncSteamGameAchievements(
      { steamId: '76561198000000001', gameTitle: 'Hades' },
      {
        storage,
        accessToken: 'jwt-ok',
        forceProxy: true,
        isDev: false,
        nowFn: () => {
          steamClock += 500;
          return steamClock;
        },
        fetchImpl: async (url) => {
          const s = String(url);
          seenUrls.push(s);
          if (s.includes('action=owned_games')) {
            return makeJsonResponse({
              response: { games: [{ appid: 1145360, name: 'Hades', playtime_forever: 2400 }] },
            });
          }
          if (s.includes('action=achievements') && s.includes('appId=1145360')) {
            return makeJsonResponse({
              playerstats: {
                gameName: 'Hades',
                success: true,
                achievements: [
                  { apiname: 'A', achieved: 1 },
                  { apiname: 'B', achieved: 1 },
                ],
              },
            });
          }
          return makeJsonResponse({}, 404);
        },
      }
    );
    assert.equal(steamRes.ok, true);
    assert.equal(steamRes.resolvedAppId, 1145360);
    assert.equal(steamRes.achievements.source, 'steam');
    assert.equal(steamRes.achievements.unlocked, 2);
    assert.equal(steamRes.achievements.total, 2);
    assert.ok(steamRes.achievements.updated_at);
    assert.equal(seenUrls.length, 2);

    // Switch Desativada impede sincronização
    setProviderEnabled('steamAchievements', false, { storage });
    const disabledSteam = await syncSteamGameAchievements(
      { steamId: '76561198000000001', appId: '1145360' },
      { storage, accessToken: 'jwt-ok', forceProxy: true, isDev: false }
    );
    assert.equal(disabledSteam.ok, false);
    assert.equal(disabledSteam.disabled, true);
    setProviderEnabled('steamAchievements', true, { storage });

    // syncRetroAchievementsGame
    const raRes = await syncRetroAchievementsGame(
      { username: 'retro_hero', gameId: '14402' },
      {
        storage,
        accessToken: 'jwt-ok',
        forceProxy: true,
        isDev: false,
        nowFn: () => Date.parse('2026-11-26T22:12:00.000Z'),
        fetchImpl: async (url) => {
          assert.ok(String(url).startsWith('/api/retroachievements?'));
          return makeJsonResponse({
            ID: 14402,
            Title: 'Shadow of the Colossus',
            ConsoleName: 'PlayStation 2',
            NumAchievements: 40,
            NumAwardedToUserHardcore: 32,
          });
        },
      }
    );
    assert.equal(raRes.ok, true);
    assert.equal(raRes.achievements.source, 'retroachievements');
    assert.equal(raRes.achievements.unlocked, 32);
    assert.equal(raRes.achievements.total, 40);

    // Patch não-destrutivo preserva notas, comentários, citações, avaliação e ids antigos
    const existingGame = {
      id: 'g-sotc-ps2',
      domain: 'games',
      workType: 'game',
      title: 'Shadow of the Colossus',
      rating: 100,
      notes: 'Minha crítica pessoal que nunca deve ser apagada.',
      favoriteScene: 'Queda do quinto colosso',
      quotes: [{ id: 'q1', text: 'Dormin' }],
      ids: { igdb: 1234, rawg: 5678 },
      updatedAt: '2026-11-26T20:00:00.000Z',
    };
    const patch = buildAchievementsSyncPatch(existingGame, raRes.achievements, {
      retroachievementsGameId: '14402',
    });
    assert.equal('notes' in patch, false);
    assert.equal('rating' in patch, false);
    assert.equal('quotes' in patch, false);
    assert.equal('favoriteScene' in patch, false);
    assert.equal(patch.ids.igdb, 1234);
    assert.equal(patch.ids.rawg, 5678);
    assert.equal(patch.ids.retroachievements, 14402);

    const mergedGame = { ...existingGame, ...patch };
    assert.equal(mergedGame.notes, existingGame.notes);
    assert.equal(mergedGame.rating, 100);
    assert.deepEqual(mergedGame.quotes, existingGame.quotes);

    // Round-trip Supabase (catalog_works) preserva ids.retroachievements e achievements
    const cloudRow = mapLocalWorkToCatalogRow(mergedGame, 'user-1');
    assert.equal(cloudRow.external_ids.retroachievements, 14402);
    assert.deepEqual(cloudRow.progress_data.achievements, raRes.achievements);
    const localBack = mapCatalogRowToLocalWork(cloudRow);
    assert.equal(localBack.ids.retroachievements, 14402);
    assert.deepEqual(localBack.achievements, raRes.achievements);
    assert.equal(localBack.notes, existingGame.notes);

    // WorkDetailPage mantém zero <input>/<textarea>/<select> em modo leitura, zero <table> e zero emojis
    const detailSrc = readText('src/components/WorkDetailPage.jsx');
    const splitMarker = '{isEditDrawerOpen && (';
    const [readModePart] = detailSrc.split(splitMarker);
    assert.equal(/<input\b|<textarea\b|<select\b/.test(readModePart), false);
    assert.equal(/<table\b/i.test(detailSrc), false);
    assert.deepEqual(findForbiddenEmojisOrSymbols(detailSrc), []);
    assert.match(detailSrc, /Manual \/ Console Offline/);
    assert.match(detailSrc, /RetroAchievements/);
    assert.match(detailSrc, /Sincronizar conquistas/);
  });
});
