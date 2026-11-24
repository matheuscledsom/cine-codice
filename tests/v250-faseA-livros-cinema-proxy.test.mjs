import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { handleTmdbProxyRequest } from '../functions/api/tmdb/[[path]].js';
import {
  formatAnimeEpisodeCountLabel,
  resolveAnimeEpisodeReleaseInfo,
} from '../src/lib/animeEpisodes.js';
import {
  applyEditionUpdatePreservingBase,
  buildEditionLinkPatch,
  computeAuthorStatsWithEditions,
  findEditionsOfWork,
  getEditionBaseWorkId,
  isBookEdition,
  resolveBaseWorkForEdition,
} from '../src/lib/bookEditions.js';
import { findCatalogWorksForEntity } from '../src/lib/entityHelpers.js';
import {
  FRANCHISE_TIER_OPTIONS,
  UNCLASSIFIED_FRANCHISE_TIER,
  buildDomainFranchiseModel,
  computeFranchiseScopeProgress,
  inferFranchiseTier,
  normalizeFranchiseTier,
} from '../src/lib/franchiseTier.js';
import { formatWorkStructureBadge } from '../src/services/cinemaApi.js';
import {
  buildUniverseSuggestionsModel,
  fetchTmdbCollectionParts,
  fetchTmdbKeywordDetail,
  fetchTmdbUniverseSuggestionsByKeyword,
  searchTmdbCollections,
} from '../src/services/franchiseService.js';
import {
  mapCatalogRowToLocalWork,
  mapLocalWorkToCatalogRow,
} from '../src/services/omniSyncService.js';

const ROOT_DIR = path.resolve(process.cwd());
const readSrc = (rel) => fs.readFileSync(path.join(ROOT_DIR, rel), 'utf8');

function makeJsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function createMockCache() {
  const store = new Map();
  return {
    operations: [],
    async match(req) {
      const key = typeof req === 'string' ? req : req.url;
      this.operations.push({ op: 'match', key });
      const hit = store.get(key);
      return hit ? hit.clone() : undefined;
    },
    async put(req, res) {
      const key = typeof req === 'string' ? req : req.url;
      this.operations.push({
        op: 'put',
        key,
        cacheControl: res.headers.get('Cache-Control'),
      });
      store.set(key, res.clone());
    },
  };
}

describe('OMNIPRISM v2.5.0 Fase A — 1. Proxy TMDB (novas rotas permitidas e seguranca)', () => {
  const env = {
    SUPABASE_URL: 'https://demo.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key-demo',
    TMDB_API_KEY: 'tmdb-server-secret-v250',
  };

  it('permite collection/{id}, search/collection, keyword/{id} e discover/{movie|tv} SOMENTE com with_keywords', async () => {
    const upstreamUrls = [];
    const cache = createMockCache();

    const fetchMock = async (url, opts) => {
      const str = String(url);
      if (str.includes('/auth/v1/user')) {
        return opts?.headers?.Authorization === 'Bearer jwt-ok'
          ? makeJsonResponse({ id: 'user-1' }, 200)
          : makeJsonResponse({ error: 'unauthorized' }, 401);
      }
      upstreamUrls.push(str);
      if (str.includes('/collection/10?')) {
        return makeJsonResponse({ id: 10, name: 'Star Wars Collection', parts: [] }, 200);
      }
      if (str.includes('/search/collection?')) {
        return makeJsonResponse({ results: [{ id: 10, name: 'Star Wars Collection' }] }, 200);
      }
      if (str.includes('/keyword/180547?')) {
        return makeJsonResponse({ id: 180547, name: 'marvel cinematic universe' }, 200);
      }
      if (str.includes('/discover/movie?') || str.includes('/discover/tv?')) {
        return makeJsonResponse({ results: [{ id: 1726, title: 'Iron Man' }] }, 200);
      }
      return makeJsonResponse({}, 404);
    };

    // Bloqueia discover sem with_keywords -> 403
    for (const badUrl of [
      'https://app.pages.dev/api/tmdb/discover/movie?sort_by=popularity.desc',
      'https://app.pages.dev/api/tmdb/discover/tv?page=1',
      'https://app.pages.dev/api/tmdb/discover/movie?with_keywords=',
      'https://app.pages.dev/api/tmdb/discover/movie?with_keywords=abc',
      'https://app.pages.dev/api/tmdb/collection/not-a-number',
      'https://app.pages.dev/api/tmdb/keyword/not-a-number',
    ]) {
      const res = await handleTmdbProxyRequest(
        {
          request: new Request(badUrl, { headers: { Authorization: 'Bearer jwt-ok' } }),
          env,
        },
        { fetchImpl: fetchMock, cacheOverride: cache }
      );
      assert.equal(res.status, 403, `Esperava 403 para ${badUrl}`);
    }

    // Bloqueia POST -> 405
    const postRes = await handleTmdbProxyRequest(
      {
        request: new Request('https://app.pages.dev/api/tmdb/collection/10', {
          method: 'POST',
          headers: { Authorization: 'Bearer jwt-ok' },
        }),
        env,
        params: { path: ['collection', '10'] },
      },
      { fetchImpl: fetchMock, cacheOverride: cache }
    );
    assert.equal(postRes.status, 405);

    // Bloqueia sem auth -> 401
    const noAuth = await handleTmdbProxyRequest(
      {
        request: new Request('https://app.pages.dev/api/tmdb/collection/10'),
        env,
        params: { path: ['collection', '10'] },
      },
      { fetchImpl: fetchMock, cacheOverride: cache }
    );
    assert.equal(noAuth.status, 401);

    // Rotas permitidas removem api_key/key do cliente e injetam chave do servidor
    const allowedCases = [
      {
        url: 'https://app.pages.dev/api/tmdb/collection/10?api_key=EVIL&language=pt-BR',
        path: ['collection', '10'],
        expectedTtl: 'public, max-age=86400',
      },
      {
        url: 'https://app.pages.dev/api/tmdb/search/collection?key=EVIL2&query=Star+Wars',
        path: ['search', 'collection'],
        expectedTtl: 'public, max-age=600',
      },
      {
        url: 'https://app.pages.dev/api/tmdb/keyword/180547?apikey=EVIL3',
        path: ['keyword', '180547'],
        expectedTtl: 'public, max-age=86400',
      },
      {
        url: 'https://app.pages.dev/api/tmdb/discover/movie?with_keywords=180547&api_key=EVIL4',
        path: ['discover', 'movie'],
        expectedTtl: 'public, max-age=600',
      },
      {
        url: 'https://app.pages.dev/api/tmdb/discover/tv?with_keywords=180547,9715',
        path: ['discover', 'tv'],
        expectedTtl: 'public, max-age=600',
      },
    ];

    for (const c of allowedCases) {
      const res = await handleTmdbProxyRequest(
        {
          request: new Request(c.url, { headers: { Authorization: 'Bearer jwt-ok' } }),
          env,
          params: { path: c.path },
        },
        { fetchImpl: fetchMock, cacheOverride: cache }
      );
      assert.equal(res.status, 200, `Esperava 200 para ${c.url}`);
    }

    assert.equal(upstreamUrls.length, 5);
    for (const up of upstreamUrls) {
      assert.equal(up.includes('EVIL'), false);
      assert.equal(up.includes(`api_key=${env.TMDB_API_KEY}`), true);
    }

    const putOps = cache.operations.filter((o) => o.op === 'put');
    assert.equal(putOps.length, 5);
    allowedCases.forEach((c, idx) => {
      assert.equal(putOps[idx].cacheControl, c.expectedTtl);
      assert.equal(putOps[idx].key.includes(env.TMDB_API_KEY), false);
    });
  });
});

describe('OMNIPRISM v2.5.0 Fase A — 2. Livros: relacao separada editionOf sem usar edition em franchiseTier', () => {
  it('rejeita edition em franchiseTier, conta edicao nas estatisticas do autor e nunca altera progresso da obra base', () => {
    assert.equal(normalizeFranchiseTier('edition'), '');
    assert.equal(
      FRANCHISE_TIER_OPTIONS.some((o) => o.id === 'edition'),
      false
    );

    const baseBook = {
      id: 'book-duna-base',
      domain: 'reading',
      workType: 'book',
      title: 'Duna',
      creator: 'Frank Herbert',
      franchiseName: 'Crônicas de Duna',
      status: 'playing',
      pagesRead: 120,
      totalPages: 680,
      progress: 18,
    };

    const collectorEdition = {
      id: 'book-duna-capa-dura',
      domain: 'reading',
      workType: 'book',
      title: 'Duna (Edição de Colecionador)',
      creator: 'Frank Herbert',
      franchiseName: 'Crônicas de Duna',
      bookFormat: 'Capa dura',
      status: 'playing',
      pagesRead: 40,
      totalPages: 720,
      progress: 6,
    };

    const sequelBook = {
      id: 'book-duna-2',
      domain: 'reading',
      workType: 'book',
      title: 'Messias de Duna',
      creator: 'Frank Herbert',
      franchiseName: 'Crônicas de Duna',
      status: 'queued',
      pagesRead: 0,
      totalPages: 270,
    };

    // Bloqueia auto-vinculo
    assert.equal(buildEditionLinkPatch(collectorEdition, collectorEdition.id), null);

    // Vincula edicao a obra base
    const linkPatch = buildEditionLinkPatch(collectorEdition, baseBook.id, [
      baseBook,
      collectorEdition,
      sequelBook,
    ]);
    assert.equal(linkPatch.editionOf, baseBook.id);

    const linkedCatalog = applyEditionUpdatePreservingBase(
      [baseBook, collectorEdition, sequelBook],
      collectorEdition.id,
      linkPatch
    );
    const linkedEd = linkedCatalog.find((w) => w.id === collectorEdition.id);
    assert.equal(isBookEdition(linkedEd), true);
    assert.equal(getEditionBaseWorkId(linkedEd), baseBook.id);
    assert.equal(resolveBaseWorkForEdition(linkedEd, linkedCatalog)?.id, baseBook.id);
    assert.equal(findEditionsOfWork(baseBook.id, linkedCatalog).length, 1);

    // Bloqueia ciclo inverso (obra base nao pode virar edicao da propria edicao)
    assert.equal(buildEditionLinkPatch(baseBook, linkedEd.id, linkedCatalog), null);

    // Concluir a edicao NUNCA altera o progresso da obra base
    const afterCompletingEdition = applyEditionUpdatePreservingBase(
      linkedCatalog,
      collectorEdition.id,
      { status: 'completed', pagesRead: 720, progress: 100 }
    );
    const baseAfter = afterCompletingEdition.find((w) => w.id === baseBook.id);
    assert.equal(baseAfter.status, 'playing');
    assert.equal(baseAfter.pagesRead, 120);
    assert.equal(baseAfter.progress, 18);

    // Edicao CONTA nas estatisticas do autor
    const authorStats = computeAuthorStatsWithEditions(
      afterCompletingEdition,
      'Frank Herbert'
    );
    assert.equal(authorStats.totalWorks, 3);
    assert.equal(authorStats.baseWorksCount, 2);
    assert.equal(authorStats.editionsCount, 1);
    assert.equal(authorStats.completedWorks, 1);

    const entityStats = findCatalogWorksForEntity(afterCompletingEdition, {
      name: 'Frank Herbert',
      role: 'author',
    });
    assert.equal(entityStats.stats.total, 3);

    // Edicao NAO infla nem altera progresso da serie/franquia da obra base
    const franchiseModel = buildDomainFranchiseModel(baseAfter, afterCompletingEdition);
    assert.ok(franchiseModel);
    assert.equal(franchiseModel.scopeProgress.mainline.total, 2);
    assert.equal(franchiseModel.scopeProgress.mainline.completed, 0);

    // Round-trip sync Supabase preserva editionOf
    const row = mapLocalWorkToCatalogRow(linkedEd, 'user-1');
    assert.equal(row.progress_data.editionOf, baseBook.id);
    const hydrated = mapCatalogRowToLocalWork(row);
    assert.equal(hydrated.editionOf, baseBook.id);
  });
});

describe('OMNIPRISM v2.5.0 Fase A — 3. Anime: nextAiringEpisode.episode - 1 com fonte e data', () => {
  it('usa nextAiringEpisode.episode - 1 como lancados ate agora sem inventar total quando episodes e vazio', () => {
    const ongoing = resolveAnimeEpisodeReleaseInfo(
      {
        episodes: null,
        status: 'RELEASING',
        nextAiringEpisode: { episode: 24, airingAt: 1795478400 },
      },
      { source: 'AniList', fetchedAt: '2026-11-24T19:00:00.000Z' }
    );

    assert.equal(ongoing.totalEpisodes, null);
    assert.equal(ongoing.releasedEpisodesCount, 23);
    assert.equal(ongoing.releasedEpisodesSource, 'AniList');
    assert.equal(ongoing.releasedEpisodesFetchedAt, '2026-11-24T19:00:00.000Z');

    const formatted = formatAnimeEpisodeCountLabel({
      workType: 'anime',
      animeStatus: 'RELEASING',
      ...ongoing,
    });
    assert.equal(formatted.kind, 'released-so-far');
    assert.equal(formatted.count, 23);
    assert.equal(formatted.label, '23 lançados até agora (AniList, 24/11/2026)');

    const badge = formatWorkStructureBadge({
      workType: 'anime',
      animeStatus: 'RELEASING',
      ...ongoing,
    });
    assert.match(badge, /23 lançados até agora \(AniList, 24\/11\/2026\)/);
    assert.match(badge, /Em exibição/);

    // Quando a fonte informa total, preserva total sem inventar
    const finished = resolveAnimeEpisodeReleaseInfo(
      { episodes: 12, status: 'FINISHED', nextAiringEpisode: null },
      { source: 'AniList', fetchedAt: '2026-11-24T19:00:00.000Z' }
    );
    assert.equal(finished.totalEpisodes, 12);
    assert.equal(finished.releasedEpisodesCount, null);

    // Sem episodes nem nextAiringEpisode -> tudo null, zero numero inventado
    const unknown = resolveAnimeEpisodeReleaseInfo({ episodes: null, nextAiringEpisode: null });
    assert.equal(unknown.totalEpisodes, null);
    assert.equal(unknown.releasedEpisodesCount, null);
    assert.equal(formatAnimeEpisodeCountLabel({ workType: 'anime' }).label, '');
  });
});

describe('OMNIPRISM v2.5.0 Fase A — 4. Universos: TMDB collection + keyword/discover como sugestoes nao classificadas', () => {
  it('busca collection via proxy e devolve keyword/discover como sugestoes unclassified ate o usuario confirmar', async () => {
    const calledUrls = [];
    const fetchMock = async (url) => {
      const str = String(url);
      calledUrls.push(str);
      if (str.includes('/api/tmdb/collection/86311')) {
        return makeJsonResponse({
          id: 86311,
          parts: [
            { id: 24428, title: 'Os Vingadores', release_date: '2012-04-25' },
            { id: 99861, title: 'Vingadores: Era de Ultron', release_date: '2015-04-22' },
          ],
        });
      }
      if (str.includes('/api/tmdb/search/collection')) {
        return makeJsonResponse({
          results: [{ id: 86311, name: 'The Avengers Collection' }],
        });
      }
      if (str.includes('/api/tmdb/keyword/180547')) {
        return makeJsonResponse({ id: 180547, name: 'marvel cinematic universe' });
      }
      if (str.includes('/api/tmdb/discover/movie')) {
        return makeJsonResponse({
          results: [
            { id: 1726, title: 'Homem de Ferro', release_date: '2008-04-30' },
            { id: 24428, title: 'Os Vingadores', release_date: '2012-04-25' },
          ],
        });
      }
      if (str.includes('/api/tmdb/discover/tv')) {
        return makeJsonResponse({
          results: [{ id: 85271, name: 'WandaVision', first_air_date: '2021-01-15' }],
        });
      }
      return makeJsonResponse({}, 404);
    };

    const proxyOpts = {
      fetchImpl: fetchMock,
      accessToken: 'jwt-valid',
      forceProxy: true,
      isDev: false,
    };

    const parts = await fetchTmdbCollectionParts(86311, proxyOpts);
    assert.equal(parts.length, 2);

    const cols = await searchTmdbCollections('Avengers', proxyOpts);
    assert.equal(cols.length, 1);

    const kw = await fetchTmdbKeywordDetail(180547, proxyOpts);
    assert.equal(kw.name, 'marvel cinematic universe');

    const discovered = await fetchTmdbUniverseSuggestionsByKeyword(180547, proxyOpts);
    assert.equal(discovered.keyword.name, 'marvel cinematic universe');
    assert.equal(discovered.suggestions.length, 3);

    // Nenhuma sugestao e classificada automaticamente como mainline ou spinoff
    for (const s of discovered.suggestions) {
      assert.equal(s.isUniverseSuggestion, true);
      assert.equal(s.franchiseTier, UNCLASSIFIED_FRANCHISE_TIER);
      assert.equal(s.tierConfirmedByUser, false);
      assert.equal(inferFranchiseTier(s), UNCLASSIFIED_FRANCHISE_TIER);
    }

    // Cruza com catalogo local: item confirmado pelo usuario reflete mainline, o restante segue unclassified
    const localCatalog = [
      {
        id: 'local-ironman',
        domain: 'cinema',
        workType: 'movie',
        tmdbId: 1726,
        title: 'Homem de Ferro',
        status: 'completed',
        franchiseTier: 'mainline',
      },
      {
        id: 'local-wanda',
        domain: 'cinema',
        workType: 'series',
        tmdbId: 85271,
        title: 'WandaVision',
        status: 'completed',
      },
    ];
    const model = buildUniverseSuggestionsModel(discovered.suggestions, localCatalog);
    assert.equal(model.find((m) => m.tmdbId === 1726).franchiseTier, 'mainline');
    assert.equal(model.find((m) => m.tmdbId === 1726).tierConfirmedByUser, true);
    assert.equal(model.find((m) => m.tmdbId === 85271).franchiseTier, 'unclassified');
    assert.equal(model.find((m) => m.tmdbId === 24428).franchiseTier, 'unclassified');

    // Progresso de escopo NAO mistura unclassified dentro de mainline
    const scope = computeFranchiseScopeProgress(model, 'cinema');
    assert.equal(scope.mainline.total, 1);
    assert.equal(scope.mainline.completed, 1);
    assert.equal(scope.unclassified.total, 2);

    // Garante wiring na UI
    const radarSrc = readSrc('src/components/FranchiseRadarPanel.jsx');
    assert.match(radarSrc, /tmdb-universe-suggestions/);
    assert.match(radarSrc, /UNCLASSIFIED_FRANCHISE_TIER/);

    const detailSrc = readSrc('src/components/WorkDetailPage.jsx');
    assert.match(detailSrc, /book-editions-relation/);
    assert.match(detailSrc, /buildEditionLinkPatch/);
    assert.match(detailSrc, /formatAnimeEpisodeCountLabel/);
  });
});
