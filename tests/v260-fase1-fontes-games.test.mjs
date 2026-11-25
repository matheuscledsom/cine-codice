import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, it } from 'node:test';

import { handleIgdbProxyRequest } from '../functions/api/igdb/[[path]].js';
import { handleStatusRequest } from '../functions/api/status.js';
import { handleSteamProxyRequest } from '../functions/api/steam.js';
import {
  IGDB_GAME_FIELDS,
  IGDB_MAX_REQUESTS_PER_SEC,
  enqueueIgdbRateLimited,
  getIgdbTokenCacheSnapshotForTests,
  queryIgdbUpstream,
  resetIgdbServerStateForTests,
} from '../functions/_lib/igdbCore.js';
import { clearMemoryApiCacheForTests } from '../src/api/cacheDb.js';
import { resetApiClientStateForTests } from '../src/api/httpClient.js';
import {
  GAME_COMPLETION_TYPES,
  GAME_EDITION_TYPES,
  GAME_STORES_LAUNCHERS,
  getWorkTypeLabel,
  normalizeGameEditionType,
} from '../src/config/domainConfig.js';
import {
  formatGameAchievementsSummary,
  formatGameCampaignTime,
  normalizeAchievementsModel,
  parseIgdbGameMetadata,
  resolveIgdbEditionType,
} from '../src/lib/gameDepth.js';
import { API_STATUS_SOURCES } from '../src/services/apiStatusService.js';
import { buildCodiceDatabase, generateCatalogMarkdown } from '../src/services/codiceDatabase.js';
import { fetchGameDepthWithFallback } from '../src/services/gameDepthService.js';
import {
  detectGameEditionType,
  searchGamesWorks,
} from '../src/services/multiDomainSearchService.js';
import {
  mapCatalogRowToLocalWork,
  mapLocalWorkToCatalogRow,
} from '../src/services/omniSyncService.js';
import {
  CIRCUIT_BREAKER_COOLDOWN_MS,
  DEFAULT_DOMAIN_PROVIDERS,
  executeDomainProviderChain,
  getCircuitBreakerState,
  getDomainProviders,
  moveProviderPriority,
  resetProviderRegistryForTests,
  setProviderEnabled,
} from '../src/services/providerRegistry.js';
import { getQuickSheetLeanFields } from '../src/utils/catalogDraftHelpers.js';

const ROOT_DIR = process.cwd();

function readText(relPath) {
  return fs.readFileSync(path.resolve(ROOT_DIR, relPath), 'utf8');
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

function makeJsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

describe('OMNIPRISM v2.6.0 — FASE 1: Hierarquia de Fontes + Games Reais', () => {
  beforeEach(() => {
    clearMemoryApiCacheForTests();
    resetApiClientStateForTests();
    resetProviderRegistryForTests();
    resetIgdbServerStateForTests();
  });

  it('1. Provider Registry: fallback em erro, timeout, zero resultados, gap-fill por campo, skip e circuit breaker (3 falhas -> 5 min)', async () => {
    assert.deepEqual(
      DEFAULT_DOMAIN_PROVIDERS.games.map((p) => p.id),
      ['igdb', 'rawg', 'steam', 'wikidata']
    );
    assert.equal(CIRCUIT_BREAKER_COOLDOWN_MS, 5 * 60 * 1000);

    const storage = createMemoryStorage();
    const customProviders = [
      { id: 'srcError', label: 'ErrSource', domain: 'games', priority: 1, timeoutMs: 80, requiresKey: false },
      { id: 'srcTimeout', label: 'SlowSource', domain: 'games', priority: 2, timeoutMs: 60, requiresKey: false },
      { id: 'srcZero', label: 'EmptySource', domain: 'games', priority: 3, timeoutMs: 80, requiresKey: false },
      { id: 'srcMissingKey', label: 'NoKeySource', domain: 'games', priority: 4, timeoutMs: 80, requiresKey: true },
      { id: 'srcPrimary', label: 'PrimarySource', domain: 'games', priority: 5, timeoutMs: 80, requiresKey: false },
      { id: 'srcCover', label: 'CoverSource', domain: 'games', priority: 6, timeoutMs: 80, requiresKey: false },
    ];

    const calls = [];
    const chain = await executeDomainProviderChain({
      domain: 'games',
      query: 'Chrono Trigger',
      providers: customProviders,
      storage,
      skipCache: true,
      gapFillFields: ['coverUrl'],
      relevanceFilter: (item) => /chrono/i.test(item.title),
      executeProvider: async (prov, { signal }) => {
        calls.push(prov.id);
        if (prov.id === 'srcError') {
          return { ok: false, error: 'HTTP 500', results: [] };
        }
        if (prov.id === 'srcTimeout') {
          return new Promise((_, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')));
          });
        }
        if (prov.id === 'srcZero') {
          return { ok: true, results: [{ id: 'unrelated', title: 'Mario Kart' }] };
        }
        if (prov.id === 'srcMissingKey') {
          return { ok: false, notConfigured: true, results: [] };
        }
        if (prov.id === 'srcPrimary') {
          return {
            ok: true,
            results: [{ id: 'ct-1', title: 'Chrono Trigger', releaseYear: 1995, coverUrl: null }],
          };
        }
        if (prov.id === 'srcCover') {
          return {
            ok: true,
            results: [{ id: 'ct-c', title: 'Chrono Trigger', coverUrl: 'https://img.example/ct.jpg' }],
          };
        }
        return { ok: true, results: [] };
      },
    });

    assert.equal(chain.ok, true);
    assert.deepEqual(calls, ['srcError', 'srcTimeout', 'srcZero', 'srcMissingKey', 'srcPrimary', 'srcCover']);
    assert.equal(chain.results.length, 1);
    assert.equal(chain.results[0].source, 'srcPrimary');
    assert.equal(chain.results[0].coverUrl, 'https://img.example/ct.jpg');
    assert.deepEqual(chain.results[0].enrichedFrom, ['srcCover']);

    // Desativar fonte + reordenar persiste no storage e pula na execução real da cadeia
    setProviderEnabled('srcError', false, { storage });
    const reordered = moveProviderPriority('games', 'wikidata', 'up', { storage });
    assert.equal(reordered[2].id, 'wikidata');

    const callsAfterDisable = [];
    const chainDisabled = await executeDomainProviderChain({
      domain: 'games',
      query: 'Chrono Cross',
      providers: [
        { id: 'srcError', label: 'ErrSource', domain: 'games', priority: 1, timeoutMs: 80, requiresKey: false },
        { id: 'srcPrimary', label: 'PrimarySource', domain: 'games', priority: 2, timeoutMs: 80, requiresKey: false },
      ],
      storage,
      skipCache: true,
      executeProvider: async (prov) => {
        callsAfterDisable.push(prov.id);
        return { ok: true, results: [{ id: 'cc-1', title: 'Chrono Cross' }] };
      },
    });
    assert.equal(chainDisabled.ok, true);
    assert.deepEqual(callsAfterDisable, ['srcPrimary']);
    assert.equal(
      chainDisabled.skippedSources.some((s) => s.id === 'srcError' && s.reason === 'disabled'),
      true
    );

    // Circuit breaker: 3 falhas seguidas pausam por 5 min e voltam após cooldown
    let nowMs = 1_000_000;
    const flakyProv = [{ id: 'flaky', label: 'Flaky', domain: 'games', priority: 1, timeoutMs: 80 }];
    let execCount = 0;
    for (let i = 0; i < 3; i += 1) {
      await executeDomainProviderChain({
        domain: 'games',
        query: `q-${i}`,
        providers: flakyProv,
        skipCache: true,
        nowFn: () => nowMs,
        executeProvider: async () => {
          execCount += 1;
          return { ok: false, error: 'down', results: [] };
        },
      });
    }
    assert.equal(execCount, 3);
    assert.equal(getCircuitBreakerState('flaky', { nowFn: () => nowMs }).isOpen, true);

    const skippedDuringCooldown = await executeDomainProviderChain({
      domain: 'games',
      query: 'q-during',
      providers: flakyProv,
      skipCache: true,
      nowFn: () => nowMs + 60_000,
      executeProvider: async () => {
        execCount += 1;
        return { ok: true, results: [] };
      },
    });
    assert.equal(execCount, 3, 'Circuit breaker aberto deve pular sem chamar o provedor');
    assert.equal(skippedDuringCooldown.skippedSources[0].reason, 'circuit_open');

    // Após 5 min reabre
    nowMs += CIRCUIT_BREAKER_COOLDOWN_MS + 1000;
    assert.equal(getCircuitBreakerState('flaky', { nowFn: () => nowMs }).isOpen, false);
    const recovered = await executeDomainProviderChain({
      domain: 'games',
      query: 'q-after',
      providers: flakyProv,
      skipCache: true,
      nowFn: () => nowMs,
      executeProvider: async () => {
        execCount += 1;
        return { ok: true, results: [{ id: 'ok-1', title: 'Hades' }] };
      },
    });
    assert.equal(execCount, 4);
    assert.equal(recovered.ok, true);
    assert.equal(getCircuitBreakerState('flaky', { nowFn: () => nowMs }).consecutiveFailures, 0);
  });

  it('2. Proxy IGDB: 503 sem Twitch creds, OAuth cache + renovação em 401, fila <= 4 req/s, campos v4 e zero vazamento', async () => {
    // Campos v4 atuais: usa game_type.* e NUNCA deprecated category
    assert.equal(IGDB_GAME_FIELDS.includes('game_type.*'), true);
    assert.equal(/\bcategory\b/.test(IGDB_GAME_FIELDS), false);
    assert.equal(IGDB_MAX_REQUESTS_PER_SEC, 4);

    const authBaseEnv = {
      SUPABASE_URL: 'https://demo-proj.supabase.co',
      SUPABASE_ANON_KEY: 'anon-public-demo-key',
    };
    const authFetch = async (url, init) => {
      if (String(url).includes('/auth/v1/user')) {
        return init?.headers?.Authorization === 'Bearer valid-jwt'
          ? makeJsonResponse({ id: 'u-1' }, 200)
          : makeJsonResponse({ error: 'invalid_jwt' }, 401);
      }
      return makeJsonResponse({}, 404);
    };

    // 401 quando sem Bearer token Supabase (igual aos demais proxies autenticados)
    const unauthRes = await handleIgdbProxyRequest(
      {
        request: new Request('https://omniprism.pages.dev/api/igdb/games?search=Zelda'),
        env: authBaseEnv,
      },
      { fetchImpl: authFetch }
    );
    assert.equal(unauthRes.status, 401);

    // 503 quando autenticado mas TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET ausentes
    const unconfiguredRes = await handleIgdbProxyRequest(
      {
        request: new Request('https://omniprism.pages.dev/api/igdb/games?search=Zelda', {
          headers: { Authorization: 'Bearer valid-jwt' },
        }),
        env: authBaseEnv,
      },
      { fetchImpl: authFetch }
    );
    assert.equal(unconfiguredRes.status, 503);
    assert.deepEqual(await unconfiguredRes.json(), {
      error: 'IGDB não configurado no servidor.',
      configured: false,
    });

    // Sem segredos ou variáveis VITE_ de Twitch no código do cliente
    const srcAll = [
      readText('src/services/apiProxyClient.js'),
      readText('src/services/apiStatusService.js'),
      readText('src/components/ApiStatusPanel.jsx'),
    ].join('\n');
    assert.equal(/import\.meta\.env\.VITE_TWITCH/i.test(srcAll), false);
    assert.equal(srcAll.includes('VITE_TWITCH'), false);
    assert.equal(srcAll.includes('Client-Secret'), false);
    assert.equal(/['"]Client-ID['"]/.test(srcAll), false);

    // OAuth cache + renovação automática após HTTP 401
    let nowMs = 10_000_000;
    let oauthCalls = 0;
    let igdbCalls = 0;
    const mockFetch = async (url, init) => {
      const sUrl = String(url);
      if (sUrl.includes('/auth/v1/user')) {
        return makeJsonResponse({ id: 'u-1' }, 200);
      }
      if (sUrl.startsWith('https://id.twitch.tv/oauth2/token')) {
        oauthCalls += 1;
        return makeJsonResponse({ access_token: `tok-${oauthCalls}`, expires_in: 3600 });
      }
      if (sUrl.startsWith('https://api.igdb.com/v4/games')) {
        igdbCalls += 1;
        const auth = init?.headers?.Authorization;
        // Força 401 na 2a chamada IGDB para testar renovação de token
        if (igdbCalls === 2 && auth === 'Bearer tok-1') {
          return makeJsonResponse({ message: 'Unauthorized' }, 401);
        }
        return makeJsonResponse([
          {
            id: 1942,
            name: 'The Witcher 3: Wild Hunt',
            game_type: { id: 0, type: 'Main Game' },
            first_release_date: 1431993600,
            cover: { image_id: 'co1wyy' },
            involved_companies: [
              { developer: true, publisher: false, company: { name: 'CD PROJEKT RED' } },
            ],
            platforms: [{ name: 'PC (Microsoft Windows)' }, { name: 'PlayStation 4' }],
            release_dates: [
              { platform: { name: 'PC (Microsoft Windows)' }, date: 1431993600 },
              { platform: { name: 'PlayStation 4' }, date: 1431993600 },
              { platform: { name: 'Nintendo Switch' }, date: 1571097600 },
            ],
            franchises: [{ id: 62, name: 'The Witcher' }],
          },
        ]);
      }
      if (sUrl.startsWith('https://api.igdb.com/v4/game_time_to_beats')) {
        return makeJsonResponse([
          { game_id: 1942, hastily: 108000, normally: 185400, completely: 622800, count: 400 },
        ]);
      }
      return makeJsonResponse({}, 404);
    };

    const proxyEnv = {
      ...authBaseEnv,
      TWITCH_CLIENT_ID: 'secret-twitch-id-999',
      TWITCH_CLIENT_SECRET: 'secret-twitch-sec-999',
    };

    const firstRes = await handleIgdbProxyRequest(
      {
        request: new Request('https://omniprism.pages.dev/api/igdb/games?search=Witcher', {
          headers: { Authorization: 'Bearer valid-jwt' },
        }),
        env: proxyEnv,
      },
      { fetchImpl: mockFetch, nowFn: () => nowMs, sleepFn: async () => {} }
    );
    assert.equal(firstRes.status, 200);
    const body1 = await firstRes.text();
    assert.equal(body1.includes(proxyEnv.TWITCH_CLIENT_ID), false);
    assert.equal(body1.includes(proxyEnv.TWITCH_CLIENT_SECRET), false);
    assert.equal(body1.includes('tok-1'), false);
    const json1 = JSON.parse(body1);
    assert.equal(json1.results[0].time_to_beat.normally, 185400);
    assert.equal(oauthCalls, 1);

    // 2a chamada usa cache OAuth (nao chama Twitch novamente)
    await queryIgdbUpstream('games', 'search "Witcher"; limit 1;', {
      twitchClientId: proxyEnv.TWITCH_CLIENT_ID,
      twitchClientSecret: proxyEnv.TWITCH_CLIENT_SECRET,
    }, { fetchImpl: mockFetch, nowFn: () => nowMs, sleepFn: async () => {} });
    // igdbCalls === 2 recebeu 401 e renovou automaticamente para tok-2!
    assert.equal(oauthCalls, 2);
    assert.equal(getIgdbTokenCacheSnapshotForTests()?.accessToken, 'tok-2');

    // Fila de no máximo 4 req/s
    resetIgdbServerStateForTests();
    let clock = 5_000_000;
    const sleeps = [];
    await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        enqueueIgdbRateLimited(async () => n, {
          nowFn: () => clock,
          sleepFn: async (ms) => {
            sleeps.push(ms);
            clock += ms;
          },
        })
      )
    );
    assert.ok(sleeps.length >= 1, '5a requisição no mesmo segundo deve aguardar na fila <= 4 req/s');

    // GET /api/status expõe igdb.configured como booleano sem vazar credenciais
    const statusRes = await handleStatusRequest(
      {
        request: new Request('https://omniprism.pages.dev/api/status', {
          headers: { Authorization: 'Bearer jwt' },
        }),
        env: { ...proxyEnv, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon' },
      },
      {
        fetchImpl: async () => makeJsonResponse({ id: 'u1' }),
      }
    );
    const statusJson = await statusRes.json();
    assert.equal(statusJson.providers.igdb.configured, true);
  });

  it('3. Games Real: IGDB -> RAWG -> Steam -> Wikidata, sem CheapShark/FreeToGame, edição canônica e zero FILME', async () => {
    assert.deepEqual(GAME_EDITION_TYPES, [
      'Jogo',
      'Remake',
      'Remaster',
      'Port',
      'Coletânea',
      'DLC',
    ]);
    assert.equal(normalizeGameEditionType('Qualquer Coisa Desconhecida'), 'Jogo');
    assert.equal(normalizeGameEditionType('Original'), 'Jogo');
    assert.equal(
      resolveIgdbEditionType({ name: 'Resident Evil 4', game_type: { id: 8, type: 'Remake' } }),
      'Remake'
    );
    assert.equal(
      resolveIgdbEditionType({ name: 'Unlisted Experimental', game_type: { id: 99, type: 'Other' } }),
      'Jogo'
    );
    assert.equal(detectGameEditionType({ title: 'Portal' }), 'Jogo');
    assert.equal(detectGameEditionType({ title: 'Bioshock The Collection' }), 'Coletânea');

    // CheapShark e FreeToGame removidos da busca e do painel de APIs
    const searchSrc = readText('src/services/multiDomainSearchService.js');
    assert.equal(searchSrc.includes('cheapshark.com'), false);
    assert.equal(searchSrc.includes('freetogame.com'), false);
    assert.equal(API_STATUS_SOURCES.some((s) => s.id === 'cheapshark' || s.id === 'freetogame'), false);
    assert.equal(API_STATUS_SOURCES.some((s) => s.id === 'igdb'), true);
    assert.equal(API_STATUS_SOURCES.some((s) => s.id === 'steam'), true);

    // IGDB parsing completo (capa, dev, ano, todas plataformas, originais, parent/version, tempo)
    const parsedIgdb = parseIgdbGameMetadata({
      id: 7346,
      name: 'The Legend of Zelda: Breath of the Wild',
      game_type: { id: 0, type: 'Main Game' },
      first_release_date: 1488499200,
      cover: { image_id: 'co3p2d' },
      involved_companies: [{ developer: true, company: { name: 'Nintendo EPD' } }],
      platforms: [{ name: 'Wii U' }, { name: 'Nintendo Switch' }],
      release_dates: [
        { platform: { name: 'Wii U' }, date: 1488499200 },
        { platform: { name: 'Nintendo Switch' }, date: 1488499200 },
      ],
      franchises: [{ id: 596, name: 'The Legend of Zelda' }],
      time_to_beat: { normally: 180000, completely: 684000 },
    });
    assert.equal(parsedIgdb.coverUrl, 'https://images.igdb.com/igdb/image/upload/t_cover_big/co3p2d.jpg');
    assert.deepEqual(parsedIgdb.platforms, ['Wii U', 'Switch']);
    assert.deepEqual(parsedIgdb.originalPlatforms, ['Wii U', 'Switch']);
    assert.equal(parsedIgdb.editionType, 'Jogo');
    assert.equal(parsedIgdb.campaignTimeHours, 50);
    assert.equal(parsedIgdb.completion100Hours, 190);
    assert.equal(parsedIgdb.franchiseName, 'The Legend of Zelda');

    // Steam Store proxy valida parâmetros e consulta upstream
    const badSteam = await handleSteamProxyRequest({
      request: new Request('https://omniprism.pages.dev/api/steam?appid=abc', {
        headers: { Host: 'omniprism.pages.dev' },
      }),
    });
    assert.equal(badSteam.status, 400);

    // Wikidata: aceita somente instância de jogo e NUNCA rotula como Filme
    const wdFilmMock = async (url) => {
      if (url.includes('/api/igdb') || url.includes('/api/rawg') || url.includes('/api/steam')) {
        return makeJsonResponse({ notConfigured: true }, 503);
      }
      if (url.includes('action=wbsearchentities')) {
        return makeJsonResponse({
          search: [
            { id: 'Q9991', label: 'Halo', description: 'filme de ficção científica' },
            { id: 'Q1001', label: 'Halo: Combat Evolved', description: 'videojogo de 2001' },
          ],
        });
      }
      if (url.includes('action=wbgetentities')) {
        return makeJsonResponse({
          entities: {
            Q9991: {
              id: 'Q9991',
              labels: { pt: { value: 'Halo' } },
              descriptions: { pt: { value: 'filme de ação' } },
              claims: { P31: [{ mainsnak: { datavalue: { value: { id: 'Q11424' } } } }] },
            },
            Q1001: {
              id: 'Q1001',
              labels: { en: { value: 'Halo: Combat Evolved' } },
              descriptions: { pt: { value: 'videojogo de tiro de 2001' } },
              claims: {
                P31: [{ mainsnak: { datavalue: { value: { id: 'Q7889' } } } }],
                P577: [{ mainsnak: { datavalue: { value: { time: '+2001-11-15T00:00:00Z' } } } }],
              },
            },
          },
        });
      }
      return makeJsonResponse({});
    };

    const wdRes = await searchGamesWorks('Halo', { fetchImpl: wdFilmMock });
    assert.equal(wdRes.ok, true);
    assert.equal(wdRes.results.length, 1);
    assert.equal(wdRes.results[0].title, 'Halo: Combat Evolved');
    assert.equal(wdRes.results[0].workType, 'game');
    assert.equal(wdRes.results[0].editionType, 'Jogo');
    assert.notEqual(getWorkTypeLabel(wdRes.results[0], 'games'), 'Filme');

    // Fallback ponta a ponta em zero resultados na IGDB -> RAWG sem chave -> Steam Store
    resetProviderRegistryForTests();
    const zeroFallbackRes = await searchGamesWorks('Celeste', {
      accessToken: 'valid-jwt',
      forceProxy: true,
      isDev: false,
      skipCache: true,
      fetchImpl: async (url) => {
        if (String(url).includes('/api/igdb/games')) {
          return makeJsonResponse({ ok: true, results: [] });
        }
        if (String(url).includes('/api/rawg/games')) {
          return makeJsonResponse({ configured: false }, 503);
        }
        if (String(url).includes('/api/steam') && String(url).includes('term=')) {
          return makeJsonResponse({
            items: [{ id: 504230, name: 'Celeste', tiny_image: 'https://cdn.example/cel.jpg' }],
          });
        }
        if (String(url).includes('/api/steam') && String(url).includes('appid=504230')) {
          return makeJsonResponse({
            504230: {
              success: true,
              data: { type: 'game', developers: ['Maddy Makes Games'], release_date: { date: '25 Jan, 2018' } },
            },
          });
        }
        return makeJsonResponse({ search: [] });
      },
    });
    assert.equal(zeroFallbackRes.ok, true);
    assert.equal(zeroFallbackRes.results[0].title, 'Celeste');
    assert.equal(zeroFallbackRes.results[0].source, 'steam');

    // generateCatalogMarkdown jamais rotula jogo como Filme
    const db = buildCodiceDatabase({
      items: [
        {
          id: 'g-halo',
          domain: 'games',
          workType: 'game',
          title: 'Halo: Combat Evolved',
          editionType: 'Jogo',
          releaseYear: 2001,
          status: 'completed',
        },
      ],
    });
    const md = generateCatalogMarkdown(db);
    assert.equal(md.includes('Filme'), false);
    assert.equal(md.includes('Jogo'), true);

    // fetchGameDepthWithFallback prioriza IGDB e cai para RAWG sem falha
    const depthRes = await fetchGameDepthWithFallback(
      { domain: 'games', title: 'Hollow Knight', igdbId: 14593 },
      {
        accessToken: 'valid-jwt',
        forceProxy: true,
        isDev: false,
        fetchImpl: async (url) => {
          if (String(url).includes('/api/igdb/games/14593')) {
            return makeJsonResponse({
              ok: true,
              game: {
                id: 14593,
                name: 'Hollow Knight',
                game_type: { id: 0, type: 'Main Game' },
                time_to_beat: { normally: 97200, completely: 216000 },
              },
            });
          }
          return makeJsonResponse({}, 404);
        },
      }
    );
    assert.equal(depthRes.ok, true);
    assert.equal(depthRes.source, 'igdb');
    assert.equal(depthRes.data.campaignTimeHours, 27);
    assert.equal(depthRes.data.completion100Hours, 60);
    const campaignLabel = formatGameCampaignTime(depthRes.data);
    assert.equal(campaignLabel.isFromIgdb, true);
  });

  it('4. UI Games, Local / Offline, Troféus/Conquistas { source, unlocked, total, updated_at } e Atribuição IGDB/RAWG', () => {
    assert.equal(GAME_STORES_LAUNCHERS.includes('Local / Offline'), true);
    assert.deepEqual(GAME_COMPLETION_TYPES, [
      'História Principal',
      'Zerado',
      '100% / Platina',
      'Multiplayer / Ranked',
      'Sem fim convencional',
    ]);

    const playingLean = getQuickSheetLeanFields('games', 'playing');
    assert.equal(playingLean.askGamePlatform, true);
    assert.equal(playingLean.askGameEdition, true);
    assert.equal(playingLean.askGameCompletionType, false);

    const completedLean = getQuickSheetLeanFields('games', 'completed');
    assert.equal(completedLean.askGamePlatform, false);
    assert.equal(completedLean.askGameCompletionType, true);
    assert.equal(completedLean.askStarRating, true);

    const ach = normalizeAchievementsModel({
      source: 'manual',
      unlocked: 32,
      total: 50,
      updated_at: '2026-11-25T10:00:00.000Z',
    });
    assert.deepEqual(ach, {
      source: 'manual',
      unlocked: 32,
      total: 50,
      updated_at: '2026-11-25T10:00:00.000Z',
    });
    assert.equal(formatGameAchievementsSummary(ach)?.label, '32 / 50 (64%)');

    // Sync Supabase preserva achievements, storeOrLauncher Local / Offline, igdb/rawg IDs e editionType
    const work = {
      id: 'g-ps4-offline',
      domain: 'games',
      workType: 'game',
      title: 'Bloodborne',
      platform: 'PS4',
      originalPlatforms: ['PS4'],
      editionType: 'Jogo',
      storeOrLauncher: 'Local / Offline',
      igdbId: 7334,
      rawgId: 3387,
      achievements: ach,
      status: 'playing',
      updatedAt: '2026-11-25T12:00:00.000Z',
    };
    const cloudRow = mapLocalWorkToCatalogRow(work, 'user-1');
    assert.equal(cloudRow.external_ids.igdb, 7334);
    assert.equal(cloudRow.external_ids.rawg, 3387);
    assert.equal(cloudRow.progress_data.store_or_launcher, 'Local / Offline');
    assert.deepEqual(cloudRow.progress_data.achievements, ach);

    const localBack = mapCatalogRowToLocalWork(cloudRow);
    assert.equal(localBack.igdbId, 7334);
    assert.equal(localBack.rawgId, 3387);
    assert.equal(localBack.storeOrLauncher, 'Local / Offline');
    assert.deepEqual(localBack.achievements, ach);
    assert.deepEqual(localBack.originalPlatforms, ['PS4']);

    // ApiStatusPanel sem campos de chave e com switch + atribuição IGDB.com / RAWG na UI
    const statusPanelSrc = readText('src/components/ApiStatusPanel.jsx');
    assert.equal(/<input\b/i.test(statusPanelSrc), false, 'ApiStatusPanel não pode conter campo de chave');
    assert.match(statusPanelSrc, /Ativa/);
    assert.match(statusPanelSrc, /Desativada/);
    assert.match(statusPanelSrc, /Sem chave/);

    const addSrc = readText('src/screens/AddScreen.jsx');
    const detailSrc = readText('src/components/WorkDetailPage.jsx');
    const creditsSrc = readText('src/components/AboutCreditsModal.jsx');
    assert.match(addSrc, /GAME_ATTRIBUTION_LINKS\.igdb/);
    assert.match(addSrc, /GAME_ATTRIBUTION_LINKS\.rawg/);
    assert.match(detailSrc, /GAME_ATTRIBUTION_LINKS\.igdb/);
    assert.match(detailSrc, /GAME_ATTRIBUTION_LINKS\.rawg/);
    assert.match(creditsSrc, /GAME_ATTRIBUTION_LINKS\.igdb/);
    assert.match(creditsSrc, /GAME_ATTRIBUTION_LINKS\.rawg/);
  });
});
