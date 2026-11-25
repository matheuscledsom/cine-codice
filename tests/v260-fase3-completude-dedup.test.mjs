import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, it } from 'node:test';

import { handleGoogleBooksProxyRequest } from '../functions/api/googlebooks.js';
import { handleStatusRequest } from '../functions/api/status.js';
import { clearMemoryApiCacheForTests } from '../src/api/cacheDb.js';
import { resetApiClientStateForTests } from '../src/api/httpClient.js';
import { buildEditionLinkPatch } from '../src/lib/bookEditions.js';
import {
  buildEntityCompletenessPanelModel,
  computeEntityCompleteness,
  getManualEntityMeta,
  saveManualEntityMeta,
} from '../src/lib/entityHelpers.js';
import { buildDomainFranchiseModel } from '../src/lib/franchiseTier.js';
import {
  categorizeMusicBrainzReleaseGroups,
  computeDiscographyCompleteness,
} from '../src/lib/musicDepth.js';
import { buildMusicHierarchy } from '../src/lib/musicHierarchy.js';
import {
  fetchBrasilApiIsbnViaProxyOrDirect,
  fetchGoogleBooksViaProxyOrDirect,
} from '../src/services/apiProxyClient.js';
import { probeApiSource } from '../src/services/apiStatusService.js';
import { buildUnifiedFranchiseModel } from '../src/services/franchiseService.js';
import { fetchIgdbFranchiseGames } from '../src/services/gameDepthService.js';
import { searchReadingWorks } from '../src/services/multiDomainSearchService.js';
import { fetchMusicBrainzArtistFullDiscography } from '../src/services/musicDepthService.js';
import { resetProviderRegistryForTests } from '../src/services/providerRegistry.js';
import {
  buildWorkDeduplicationKey,
  detectCatalogDuplicates,
  groupCatalogEditionsByPrimary,
  mergeDuplicateWorksManual,
} from '../src/services/relationalDb.js';

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

describe('OMNIPRISM v2.6.0 — FASE 3: Ajustes Proxy/CSP + Completude + Deduplicação Manual', () => {
  beforeEach(() => {
    clearMemoryApiCacheForTests();
    resetApiClientStateForTests();
    resetProviderRegistryForTests();
  });

  it('1. Ajuste CSP: public/_headers remove brasilapi.com.br de connect-src e prod usa apenas /api/isbn', async () => {
    const headersFile = readText('public/_headers');
    const connectSrcLine = headersFile.match(/connect-src[^;]+/)?.[0] || '';
    assert.equal(connectSrcLine.includes('brasilapi.com.br'), false);

    const called = [];
    const out = await fetchBrasilApiIsbnViaProxyOrDirect('9788535914849', {
      forceProxy: true,
      isDev: false,
      fetchImpl: async (url) => {
        called.push(String(url));
        return makeJsonResponse({ title: 'Teste', isbn: '9788535914849' }, 200);
      },
    });
    assert.equal(out.ok, true);
    assert.equal(out.via, 'proxy');
    assert.equal(called.some((u) => u.includes('brasilapi.com.br')), false);
    assert.ok(called.some((u) => u.startsWith('/api/isbn/9788535914849')));
  });

  it('2. Ajuste Google Books opcional (/api/googlebooks): exige JWT Supabase, usa GOOGLE_BOOKS_API_KEY quando existe e cai para modo público sem erro quando ausente', async () => {
    const baseEnv = {
      SUPABASE_URL: 'https://demo-proj.supabase.co',
      SUPABASE_ANON_KEY: 'anon-public-demo-key',
      GOOGLE_BOOKS_API_KEY: 'gb-secret-server-only-9911',
    };

    const authMockFetch = async (url, opts) => {
      const urlStr = String(url);
      if (urlStr.includes('/auth/v1/user')) {
        if (opts?.headers?.Authorization === 'Bearer valid-jwt') {
          return makeJsonResponse({ id: 'user-1' }, 200);
        }
        return makeJsonResponse({ error: 'unauthorized' }, 401);
      }
      if (urlStr.startsWith('https://www.googleapis.com/books/v1/volumes')) {
        return makeJsonResponse({
          items: [
            {
              id: 'gb-keyed-1',
              volumeInfo: {
                title: 'Grande Sertão: Veredas',
                authors: ['João Guimarães Rosa'],
                publishedDate: '1956',
                language: 'pt',
                pageCount: 608,
              },
              accessInfo: { country: 'BR' },
            },
          ],
        });
      }
      return makeJsonResponse({}, 404);
    };

    // Sem JWT -> 401
    const unauth = await handleGoogleBooksProxyRequest(
      {
        request: new Request('https://omniprism.pages.dev/api/googlebooks?q=sertao'),
        env: baseEnv,
      },
      { fetchImpl: authMockFetch }
    );
    assert.equal(unauth.status, 401);

    // Sem GOOGLE_BOOKS_API_KEY -> 503 notConfigured: true e /api/status false
    const noKeyRes = await handleGoogleBooksProxyRequest(
      {
        request: new Request('https://omniprism.pages.dev/api/googlebooks?q=sertao', {
          headers: { Authorization: 'Bearer valid-jwt' },
        }),
        env: { ...baseEnv, GOOGLE_BOOKS_API_KEY: '' },
      },
      { fetchImpl: authMockFetch }
    );
    assert.equal(noKeyRes.status, 503);
    const noKeyJson = await noKeyRes.json();
    assert.equal(noKeyJson.notConfigured, true);

    const statusWithKey = await handleStatusRequest(
      {
        request: new Request('https://omniprism.pages.dev/api/status', {
          headers: { Authorization: 'Bearer valid-jwt' },
        }),
        env: baseEnv,
      },
      { fetchImpl: authMockFetch }
    );
    const statusJson = await statusWithKey.json();
    assert.equal(statusJson.providers.googleBooks.configured, true);
    assert.equal(JSON.stringify(statusJson).includes(baseEnv.GOOGLE_BOOKS_API_KEY), false);

    // Com GOOGLE_BOOKS_API_KEY -> injeta key apenas no upstream e cacheia sem expor segredo
    const seenUpstreamUrls = [];
    const seenCacheUrls = [];
    const cacheStore = new Map();
    const cacheOverride = {
      match: async (req) => cacheStore.get(req.url) || null,
      put: async (req, res) => {
        seenCacheUrls.push(req.url);
        cacheStore.set(req.url, res);
      },
    };
    const keyedRes = await handleGoogleBooksProxyRequest(
      {
        request: new Request(
          'https://omniprism.pages.dev/api/googlebooks?q=sertao&langRestrict=pt&key=evil-client-key',
          { headers: { Authorization: 'Bearer valid-jwt' } }
        ),
        env: baseEnv,
      },
      {
        fetchImpl: async (url, opts) => {
          seenUpstreamUrls.push(String(url));
          return authMockFetch(url, opts);
        },
        cacheOverride,
      }
    );
    assert.equal(keyedRes.status, 200);
    assert.ok(seenUpstreamUrls.some((u) => u.includes(`key=${baseEnv.GOOGLE_BOOKS_API_KEY}`)));
    assert.equal(seenUpstreamUrls.some((u) => u.includes('evil-client-key')), false);
    assert.equal(seenCacheUrls.some((u) => u.includes(baseEnv.GOOGLE_BOOKS_API_KEY)), false);

    // Cliente COM chave configurada no proxy -> usa /api/googlebooks
    const clientProxyCalls = [];
    const keyedClientOut = await fetchGoogleBooksViaProxyOrDirect(
      { q: 'sertao', langRestrict: 'pt' },
      {
        forceProxy: true,
        isDev: false,
        accessToken: 'valid-jwt',
        fetchImpl: async (url, opts) => {
          clientProxyCalls.push({ url: String(url), auth: opts?.headers?.Authorization });
          return makeJsonResponse({ items: [{ id: 'gb-1', volumeInfo: { title: 'Grande Sertão' } }] }, 200);
        },
      }
    );
    assert.equal(keyedClientOut.ok, true);
    assert.equal(keyedClientOut.via, 'proxy');
    assert.ok(clientProxyCalls[0].url.startsWith('/api/googlebooks?'));
    assert.equal(clientProxyCalls[0].auth, 'Bearer valid-jwt');

    // Cliente SEM chave (proxy devolve 503) -> cai silenciosamente para API pública sem erro visível
    const fallbackUrls = [];
    const readingFallback = await searchReadingWorks('Grande Sertão', {
      forceProxy: true,
      isDev: false,
      accessToken: 'valid-jwt',
      skipCache: true,
      fetchImpl: async (url) => {
        const u = String(url);
        fallbackUrls.push(u);
        if (u.startsWith('/api/googlebooks')) {
          return makeJsonResponse({ notConfigured: true }, 503);
        }
        if (u.includes('googleapis.com/books/v1/volumes')) {
          return makeJsonResponse({
            items: [
              {
                id: 'gb-pub-1',
                volumeInfo: {
                  title: 'Grande Sertão: Veredas',
                  authors: ['João Guimarães Rosa'],
                  language: 'pt',
                  publishedDate: '1956',
                },
                accessInfo: { country: 'BR' },
              },
            ],
          });
        }
        return makeJsonResponse({ docs: [] });
      },
    });
    assert.equal(readingFallback.ok, true);
    assert.equal(readingFallback.results[0].title, 'Grande Sertão: Veredas');
    assert.ok(fallbackUrls.some((u) => u.startsWith('/api/googlebooks')));
    assert.ok(fallbackUrls.some((u) => u.includes('googleapis.com/books/v1/volumes')));

    // Painel Status das APIs testa os dois cenários (proxy ativo vs modo público)
    const probeKeyed = await probeApiSource('googleBooks', {
      forceProxy: true,
      isDev: false,
      accessToken: 'valid-jwt',
      fetchImpl: async () => makeJsonResponse({ items: [] }, 200),
    });
    assert.equal(probeKeyed.ok, true);
    assert.equal(probeKeyed.via, 'proxy');
    assert.match(probeKeyed.message, /servidor/i);

    const probePublic = await probeApiSource('googleBooks', {
      forceProxy: true,
      isDev: false,
      accessToken: 'valid-jwt',
      fetchImpl: async (url) => {
        if (String(url).startsWith('/api/googlebooks')) {
          return makeJsonResponse({ notConfigured: true }, 503);
        }
        return makeJsonResponse({ items: [] }, 200);
      },
    });
    assert.equal(probePublic.ok, true);
    assert.equal(probePublic.via, 'direct');
    assert.match(probePublic.message, /público/i);
  });

  it('3. Completude de Autor (caso de teste Rick Riordan + Autor Manual) sem listas fixas no código', () => {
    // Garante que nenhuma lista fixa de casos de teste existe no código-fonte
    for (const rel of [
      'src/lib/entityHelpers.js',
      'src/lib/franchiseTier.js',
      'src/lib/musicDepth.js',
      'src/services/gameDepthService.js',
    ]) {
      const code = readText(rel);
      assert.equal(/rick\s+riordan|iron\s+maiden|legend\s+of\s+zelda/i.test(code), false);
    }

    const localCatalog = [
      {
        id: 'pj-1',
        domain: 'reading',
        workType: 'book',
        title: 'O Ladrão de Raios',
        creator: 'Rick Riordan',
        franchiseName: 'Percy Jackson e os Olimpianos',
        seriesVolume: 'Vol. 1',
        releaseYear: 2005,
        status: 'completed',
      },
      {
        id: 'pj-2',
        domain: 'reading',
        workType: 'book',
        title: 'O Mar de Monstros',
        creator: 'Rick Riordan',
        franchiseName: 'Percy Jackson e os Olimpianos',
        seriesVolume: 'Vol. 2',
        releaseYear: 2006,
        status: 'completed',
      },
      {
        id: 'pj-2-reprint',
        domain: 'reading',
        workType: 'book',
        title: 'O Mar de Monstros (Edição Ilustrada)',
        creator: 'Rick Riordan',
        franchiseName: 'Percy Jackson e os Olimpianos',
        editionOf: 'pj-2',
        releaseYear: 2019,
        status: 'completed',
      },
      {
        id: 'pj-5',
        domain: 'reading',
        workType: 'book',
        title: 'O Último Olimpiano',
        creator: 'Rick Riordan',
        franchiseName: 'Percy Jackson e os Olimpianos',
        seriesVolume: 'Vol. 5',
        releaseYear: 2009,
        status: 'in_progress',
      },
    ];

    const externalFromApi = [
      {
        id: 'ol-pj-3',
        domain: 'reading',
        workType: 'book',
        title: 'A Maldição do Titã',
        creator: 'Rick Riordan',
        franchiseName: 'Percy Jackson e os Olimpianos',
        seriesVolume: 'Vol. 3',
        releaseYear: 2007,
      },
      {
        id: 'ol-pj-4',
        domain: 'reading',
        workType: 'book',
        title: 'A Batalha do Labirinto',
        creator: 'Rick Riordan',
        franchiseName: 'Percy Jackson e os Olimpianos',
        seriesVolume: 'Vol. 4',
        releaseYear: 2008,
      },
      {
        id: 'ol-guia-1',
        domain: 'reading',
        workType: 'book',
        title: 'Guia Definitivo do Acampamento Meio-Sangue',
        creator: 'Rick Riordan',
        franchiseTier: 'companion',
        releaseYear: 2010,
      },
    ];

    // Total desconhecido -> "total aberto", sem inventar %
    const openModel = buildEntityCompletenessPanelModel({
      entity: { name: 'Rick Riordan', domain: 'reading', role: 'author' },
      localWorks: localCatalog,
      externalWorks: externalFromApi,
      sourceLabel: 'Open Library',
      sourceIsComplete: false,
    });
    assert.equal(openModel.completeness.mainline.isOpenEnded, true);
    assert.equal(openModel.completeness.mainline.pct, null);
    assert.equal(openModel.completeness.mainline.displayLabel, '2 concluídos · total aberto');
    // Reimpressão editionOf ficou agrupada sob pj-2 e não inflou contagem
    const pj2Entry = openModel.allItems.find((e) => e.id === 'pj-2');
    assert.equal(pj2Entry.editions.length, 1);
    assert.equal(openModel.completedItems.length, 2);
    assert.equal(openModel.inCatalogItems.length, 1);
    assert.equal(openModel.missingItems.length, 3);
    assert.ok(openModel.groups.some((g) => g.label === 'Percy Jackson e os Olimpianos'));
    assert.ok(openModel.groups.some((g) => g.label === 'Guias & Extras'));

    // Com total definido pelo usuário -> mostra "Linha Principal X / Y · Z%" e "Universo Completo A / B · C%"
    const storage = createMemoryStorage();
    const meta = saveManualEntityMeta(
      { name: 'Rick Riordan', domain: 'reading', role: 'author' },
      { mainSeriesTotal: 5, universeTotal: 6, seriesName: 'Percy Jackson e os Olimpianos' },
      { storage }
    );
    const closedModel = buildEntityCompletenessPanelModel({
      entity: { name: 'Rick Riordan', domain: 'reading', role: 'author' },
      localWorks: localCatalog,
      externalWorks: externalFromApi,
      manualMeta: meta,
    });
    assert.equal(closedModel.completeness.mainline.displayLabel, 'Linha Principal 2 / 5 · 40%');
    assert.equal(closedModel.completeness.universe.displayLabel, 'Universo Completo 2 / 6 · 33%');
  });

  it('4. Completude de Banda (caso de teste Iron Maiden via MusicBrainz + Banda Manual): Estúdio vs Ao Vivo/EPs', async () => {
    const mbFetch = async (url) => {
      const u = String(url);
      if (u.includes('/ws/2/artist')) {
        return makeJsonResponse({
          artists: [{ id: 'mb-iron-maiden', name: 'Iron Maiden' }],
        });
      }
      if (u.includes('/ws/2/release-group')) {
        return makeJsonResponse({
          'release-groups': [
            { id: 'rg-1', title: 'Iron Maiden', 'primary-type': 'Album', 'secondary-types': [], 'first-release-date': '1980-04-14' },
            { id: 'rg-2', title: 'The Number of the Beast', 'primary-type': 'Album', 'secondary-types': [], 'first-release-date': '1982-03-22' },
            { id: 'rg-3', title: 'Powerslave', 'primary-type': 'Album', 'secondary-types': [], 'first-release-date': '1984-09-03' },
            { id: 'rg-4', title: 'Somewhere in Time', 'primary-type': 'Album', 'secondary-types': [], 'first-release-date': '1986-09-29' },
            { id: 'rg-live-1', title: 'Live After Death', 'primary-type': 'Album', 'secondary-types': ['Live'], 'first-release-date': '1985-10-14' },
            { id: 'rg-ep-1', title: 'Maiden Japan', 'primary-type': 'EP', 'secondary-types': [], 'first-release-date': '1981-09-14' },
          ],
        });
      }
      return makeJsonResponse({}, 404);
    };

    const fullDiscog = await fetchMusicBrainzArtistFullDiscography('Iron Maiden', {
      fetchImpl: mbFetch,
      sleepFn: async () => {},
    });
    assert.equal(fullDiscog.available, true);
    assert.equal(fullDiscog.albums.length, 4);
    assert.equal(fullDiscog.allReleases.length, 6);

    const categorized = categorizeMusicBrainzReleaseGroups(fullDiscog.allReleases);
    assert.ok(categorized.some((r) => r.releaseCategory === 'live' && r.title === 'Live After Death'));
    assert.ok(categorized.some((r) => r.releaseCategory === 'ep_single' && r.title === 'Maiden Japan'));

    const localMusic = [
      { id: 'im-1', domain: 'music', workType: 'album', creator: 'Iron Maiden', title: 'The Number of the Beast', releaseYear: 1982, status: 'completed' },
      { id: 'im-2', domain: 'music', workType: 'album', creator: 'Iron Maiden', title: 'Powerslave', releaseYear: 1984, status: 'completed' },
      { id: 'im-live', domain: 'music', workType: 'live_show', creator: 'Iron Maiden', title: 'Live After Death', releaseYear: 1985, status: 'completed' },
    ];

    const panel = buildEntityCompletenessPanelModel({
      entity: { name: 'Iron Maiden', domain: 'music', role: 'artist' },
      localWorks: localMusic,
      externalWorks: fullDiscog.allReleases,
      sourceLabel: 'MusicBrainz',
      sourceIsComplete: true,
    });

    assert.equal(panel.completeness.mainline.displayLabel, 'Linha Principal 2 / 4 · 50%');
    assert.equal(panel.completeness.universe.displayLabel, 'Universo Completo 3 / 6 · 50%');
    assert.deepEqual(
      panel.groups.map((g) => g.label),
      ['Álbuns de Estúdio', 'Ao Vivo', 'EPs & Singles']
    );
    assert.equal(panel.missingItems.length, 3);
    assert.ok(panel.missingItems.some((m) => m.title === 'Somewhere in Time'));

    // Banda manual sem MusicBrainz: total aberto até usuário definir total manual
    const storage = createMemoryStorage();
    const manualBandWorks = [
      { id: 'indie-1', domain: 'music', workType: 'album', creator: 'Banda Indie BR', title: 'Disco Um', status: 'completed', isManual: true },
    ];
    const openBand = computeDiscographyCompleteness({ catalogReleases: manualBandWorks, mbStudioAlbums: null });
    assert.equal(openBand.pct, null);
    assert.equal(openBand.mainlineLabel, '1 concluídos · total aberto');

    const savedBandMeta = saveManualEntityMeta(
      { name: 'Banda Indie BR', domain: 'music', role: 'artist' },
      { mainSeriesTotal: 4 },
      { storage }
    );
    const loadedBandMeta = getManualEntityMeta({ name: 'Banda Indie BR', domain: 'music', role: 'artist' }, { storage });
    assert.equal(loadedBandMeta.mainSeriesTotal, 4);
    const closedBandHierarchy = buildMusicHierarchy(manualBandWorks, {
      manualTotalsByArtist: { 'banda indie br': savedBandMeta },
    });
    assert.equal(closedBandHierarchy.artists[0].completeness.mode, 'manual-total');
    assert.equal(closedBandHierarchy.artists[0].completeness.mainlineLabel, 'Linha Principal 1 / 4 · 25%');
  });

  it('5. Completude de Franquia de Games (caso de teste Zelda via IGDB) e Universo Cinema (TMDB vs aberto)', async () => {
    const igdbFranchiseFetch = async (url) => {
      if (String(url).includes('/api/igdb/franchises')) {
        return makeJsonResponse({
          ok: true,
          source: 'igdb',
          results: [
            {
              id: 596,
              name: 'The Legend of Zelda',
              games: [
                { id: 1022, name: 'The Legend of Zelda', first_release_date: 509328000, game_type: { id: 0, type: 'Main Game' } },
                { id: 1029, name: 'The Legend of Zelda: Ocarina of Time', first_release_date: 911606400, game_type: { id: 0, type: 'Main Game' } },
                { id: 7346, name: 'The Legend of Zelda: Breath of the Wild', first_release_date: 1488499200, game_type: { id: 0, type: 'Main Game' } },
                { id: 119388, name: 'The Legend of Zelda: Tears of the Kingdom', first_release_date: 1683849600, game_type: { id: 0, type: 'Main Game' } },
                { id: 115289, name: "The Legend of Zelda: Link's Awakening", first_release_date: 1568937600, game_type: { id: 8, type: 'Remake' } },
              ],
            },
          ],
        });
      }
      return makeJsonResponse({}, 404);
    };

    const zeldaRes = await fetchIgdbFranchiseGames('The Legend of Zelda', {
      forceProxy: true,
      isDev: false,
      accessToken: 'valid-jwt',
      fetchImpl: igdbFranchiseFetch,
    });
    assert.equal(zeldaRes.available, true);
    assert.equal(zeldaRes.source, 'IGDB');
    assert.equal(zeldaRes.games.length, 5);

    const localGames = [
      {
        id: 'z-oot',
        domain: 'games',
        workType: 'game',
        title: 'The Legend of Zelda: Ocarina of Time',
        igdbId: 1029,
        ids: { igdb: 1029 },
        franchiseName: 'The Legend of Zelda',
        editionType: 'Jogo',
        status: 'completed',
      },
      {
        id: 'z-botw',
        domain: 'games',
        workType: 'game',
        title: 'The Legend of Zelda: Breath of the Wild',
        igdbId: 7346,
        ids: { igdb: 7346 },
        franchiseName: 'The Legend of Zelda',
        editionType: 'Jogo',
        status: 'in_progress',
      },
    ];

    const zeldaModel = buildDomainFranchiseModel(localGames[0], localGames, {
      remoteEntries: zeldaRes.games,
      sourceLabel: 'IGDB',
      sourceIsComplete: true,
    });
    assert.equal(zeldaModel.scopeProgress.mainline.displayLabel, 'Linha Principal 1 / 4 · 25%');
    assert.equal(zeldaModel.scopeProgress.universe.displayLabel, 'Universo Completo 1 / 5 · 20%');
    const missingZelda = zeldaModel.entries.filter((e) => !e.isCataloged);
    assert.equal(missingZelda.length, 3);
    assert.ok(missingZelda.some((e) => e.title.includes('Tears of the Kingdom')));

    // Cinema sem coleção externa nem total manual -> total aberto
    const soloMovie = {
      id: 'm1',
      domain: 'cinema',
      workType: 'movie',
      title: 'Filme Independente',
      franchiseName: 'Trilogia Sem Coleção',
      status: 'completed',
    };
    const openCinema = buildUnifiedFranchiseModel(soloMovie, [soloMovie], [], {
      sourceIsComplete: false,
    });
    assert.equal(openCinema.scopeProgress.mainline.isOpenEnded, true);
    assert.equal(openCinema.scopeProgress.mainline.displayLabel, '1 concluídos · total aberto');
  });

  it('6. Deduplicação Manual (caso real "O Último Olimpiano" + obra manual + editionOf preservado + Mesclar com Desfazer)', () => {
    const manualRecord = {
      id: 'olimp-manual-1',
      domain: 'reading',
      workType: 'book',
      title: 'O Último Olimpiano',
      creator: 'Rick Riordan',
      author: 'Rick Riordan',
      releaseYear: 2009,
      status: 'completed',
      rating100: 96,
      score10: 9.6,
      verdict: 'masterpiece',
      criteriaScores: { ritmo: 10, personagens: 10, escrita: 9 },
      pagesRead: 384,
      notes: 'Melhor desfecho da saga Percy Jackson!',
      quotes: [{ id: 'q1', text: 'A profecia finalmente se cumpre.' }],
      isManual: true,
      ids: { source: 'manual', id: 'olimp-manual-1' },
      updatedAt: '2026-11-24T15:00:00.000Z',
    };

    const apiRecord = {
      id: 'olimp-api-2',
      domain: 'reading',
      workType: 'book',
      title: 'O Ultimo Olimpiano',
      creator: 'Rick Riordan',
      author: 'Rick Riordan',
      releaseYear: 2010,
      totalPages: 384,
      status: 'queued',
      coverUrl: 'https://books.example.com/ultimo-olimpiano.jpg',
      isbnOrDoi: '9788598078908',
      ids: { googleBooks: 'gb-olimp-5', isbn: '9788598078908' },
      synopsis: 'Sinopse oficial do quinto livro.',
      notes: 'Edição capa dura.',
      updatedAt: '2026-11-22T10:00:00.000Z',
    };

    const reprintEdition = {
      id: 'olimp-ed-3',
      domain: 'reading',
      workType: 'book',
      title: 'O Último Olimpiano',
      creator: 'Rick Riordan',
      releaseYear: 2023,
      editionOf: 'olimp-manual-1',
      status: 'queued',
    };

    // Chave composta inclui título normalizado + autor + external_ids
    const keyApi = buildWorkDeduplicationKey(apiRecord);
    assert.equal(keyApi.normalizedTitle, 'o ultimo olimpiano');
    assert.equal(keyApi.normalizedCreator, 'rick riordan');
    assert.equal(keyApi.externalIds.isbn, '9788598078908');

    // Reimpressão vinculada via `editionOf` fica sob a obra principal e NÃO dispara duplicata falsa
    const groupedEditions = groupCatalogEditionsByPrimary([
      manualRecord,
      reprintEdition,
    ]);
    assert.equal(groupedEditions.primaryWorks.length, 1);
    assert.equal(groupedEditions.editionsByPrimaryId.get('olimp-manual-1').length, 1);

    // Detecção encontra apenas os 2 registros duplicados reais (exclui a edição `editionOf`)
    const report = detectCatalogDuplicates([manualRecord, apiRecord, reprintEdition]);
    assert.equal(report.count, 1);
    assert.equal(report.groups[0].items.length, 2);
    assert.equal(report.groups[0].recommendedPrimaryId, 'olimp-manual-1');

    // Jogos com edições diferentes (Jogo vs Remake) NÃO são falsos positivos
    const gamesNoDup = detectCatalogDuplicates([
      { id: 'g1', domain: 'games', title: 'Resident Evil 4', creator: 'Capcom', editionType: 'Jogo', releaseYear: 2005 },
      { id: 'g2', domain: 'games', title: 'Resident Evil 4', creator: 'Capcom', editionType: 'Remake', releaseYear: 2023 },
    ]);
    assert.equal(gamesNoDup.count, 0);

    // Mesclagem estritamente MANUAL preserva nota, critérios, progresso, comentários, capa e mescla external_ids
    const mergeOut = mergeDuplicateWorksManual(manualRecord, apiRecord);
    assert.ok(mergeOut);
    assert.equal(mergeOut.removedWorkId, 'olimp-api-2');
    assert.equal(mergeOut.mergedWork.rating100, 96);
    assert.deepEqual(mergeOut.mergedWork.criteriaScores, { ritmo: 10, personagens: 10, escrita: 9 });
    assert.equal(mergeOut.mergedWork.status, 'completed');
    assert.equal(mergeOut.mergedWork.pagesRead, 384);
    assert.equal(mergeOut.mergedWork.totalPages, 384);
    assert.match(mergeOut.mergedWork.notes, /Melhor desfecho/);
    assert.match(mergeOut.mergedWork.notes, /Edição capa dura/);
    assert.equal(mergeOut.mergedWork.coverUrl, 'https://books.example.com/ultimo-olimpiano.jpg');
    assert.equal(mergeOut.mergedWork.ids.googleBooks, 'gb-olimp-5');
    assert.equal(mergeOut.mergedWork.ids.linkedFromManualId, 'olimp-manual-1');
    assert.equal(mergeOut.mergedWork.isManual, false);
    assert.equal(mergeOut.undoPrimarySnapshot.isManual, true);
    assert.equal(mergeOut.undoRemovedSnapshot.id, 'olimp-api-2');

    // Opção alternativa: vincular como editionOf em vez de mesclar
    const edPatch = buildEditionLinkPatch(apiRecord, manualRecord.id, [manualRecord, apiRecord]);
    assert.equal(edPatch.editionOf, 'olimp-manual-1');
    const afterEditionLink = detectCatalogDuplicates([
      manualRecord,
      { ...apiRecord, ...edPatch },
    ]);
    assert.equal(afterEditionLink.count, 0);
  });

  it('7. UI Fase 3: EntitySheetModal, FranchiseRadarPanel, MusicDiscographyView e ListScreen reutilizam entityHelpers e oferecem + Catalogar / Possíveis duplicatas', () => {
    const entityModal = readText('src/components/EntitySheetModal.jsx');
    assert.ok(entityModal.includes('buildEntityCompletenessPanelModel'));
    assert.ok(entityModal.includes('+ Catalogar'));

    const franchisePanel = readText('src/components/FranchiseRadarPanel.jsx');
    assert.ok(franchisePanel.includes('fetchIgdbFranchiseGames'));
    assert.ok(franchisePanel.includes('saveManualEntityMeta'));
    assert.ok(franchisePanel.includes('+ Catalogar'));

    const musicView = readText('src/components/MusicDiscographyView.jsx');
    assert.ok(musicView.includes('fetchMusicBrainzArtistFullDiscography'));
    assert.ok(musicView.includes('saveManualEntityMeta'));
    assert.ok(musicView.includes('+ Catalogar'));

    const listScreen = readText('src/screens/ListScreen.jsx');
    assert.ok(listScreen.includes('detectCatalogDuplicates'));
    assert.ok(listScreen.includes('mergeDuplicateWorksManual'));
    assert.ok(listScreen.includes('Possíveis duplicatas'));
    assert.ok(listScreen.includes('Mesclar registros'));
    assert.ok(listScreen.includes('Desfazer'));

    // Reutilização obrigatória de computeEntityCompleteness em vez de lógica duplicada
    assert.ok(readText('src/lib/franchiseTier.js').includes('computeEntityCompleteness'));
    assert.ok(readText('src/lib/musicDepth.js').includes('computeEntityCompleteness'));
    assert.equal(typeof computeEntityCompleteness, 'function');
  });
});
