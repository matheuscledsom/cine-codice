import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, it } from 'node:test';

import {
  clearMemoryApiCacheForTests,
  deleteEpisodeEvaluation,
  getEpisodeEvaluationsForWork,
  makeEpisodeEvalKey,
  saveEpisodeEvaluation,
} from '../src/api/cacheDb.js';
import { resetApiClientStateForTests } from '../src/api/httpClient.js';
import {
  EPISODE_TAGS,
  VIRTUALIZE_EPISODE_THRESHOLD,
  buildEpisodeBarChartModel,
  computeEpisodeStats,
  computeVirtualEpisodeWindow,
  formatNextAiringBadge,
  needsManualRatingOverwriteConfirm,
} from '../src/lib/episodeStats.js';
import {
  clearCinemaSearchCache,
  fetchJikanEpisodes,
  fetchOmdbSeasonEpisodes,
  fetchTmdbEpisodeGroupDetails,
  fetchTmdbEpisodeGroups,
  fetchTmdbSeasonDetails,
} from '../src/services/cinemaApi.js';
import {
  FRANCHISE_GRAPH_MAX_DEPTH,
  FRANCHISE_GRAPH_MAX_NODES,
  computeFranchiseStats,
  findFranchiseForItem,
  traverseFranchiseGraph,
} from '../src/services/franchiseEngine.js';

function createJsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(),
    async json() {
      return payload;
    },
  };
}

function createFakeIdbFactory({ failPutWithQuota = false } = {}) {
  const stores = new Map([
    ['apiCache', new Map()],
    ['episodes', new Map()],
    ['episodeEvaluations', new Map()],
    ['snapshots', new Map()],
  ]);

  const makeReq = (run) => {
    const req = { result: undefined, error: null, onsuccess: null, onerror: null };
    queueMicrotask(() => {
      try {
        const res = run();
        req.result = res;
        req.onsuccess?.({ target: req });
      } catch (err) {
        req.error = err;
        req.onerror?.({ target: req });
      }
    });
    return req;
  };

  return {
    open() {
      const openReq = {
        result: null,
        error: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
      };
      const db = {
        objectStoreNames: {
          contains: (name) => stores.has(name),
        },
        createObjectStore: (name) => {
          if (!stores.has(name)) stores.set(name, new Map());
          return {};
        },
        close() {},
        transaction(storeName) {
          const map = stores.get(storeName) || new Map();
          const tx = {
            oncomplete: null,
            onerror: null,
            error: null,
            objectStore() {
              return {
                get(key) {
                  return makeReq(() => map.get(key));
                },
                getAll() {
                  return makeReq(() => Array.from(map.values()));
                },
                put(value) {
                  if (failPutWithQuota) {
                    const req = { result: undefined, error: null, onsuccess: null, onerror: null };
                    queueMicrotask(() => {
                      const quotaErr = new Error('Storage quota exceeded');
                      quotaErr.name = 'QuotaExceededError';
                      req.error = quotaErr;
                      tx.error = quotaErr;
                      req.onerror?.({ target: req });
                      tx.onerror?.({ target: tx });
                    });
                    return req;
                  }
                  const key = value?.evalKey ?? value?.cacheKey ?? value?.id;
                  return makeReq(() => {
                    map.set(key, value);
                    queueMicrotask(() => tx.oncomplete?.());
                    return key;
                  });
                },
                delete(key) {
                  return makeReq(() => {
                    map.delete(key);
                    queueMicrotask(() => tx.oncomplete?.());
                    return undefined;
                  });
                },
                clear() {
                  return makeReq(() => {
                    map.clear();
                    queueMicrotask(() => tx.oncomplete?.());
                    return undefined;
                  });
                },
              };
            },
          };
          return tx;
        },
      };
      queueMicrotask(() => {
        openReq.result = db;
        openReq.onsuccess?.({ target: openReq });
      });
      return openReq;
    },
  };
}

describe('Fase 4 — Episódios, Estatísticas, Regra Extra 3, Gráfico, Virtualização e Franquias', () => {
  beforeEach(() => {
    clearCinemaSearchCache();
    clearMemoryApiCacheForTests();
    resetApiClientStateForTests();
  });

  it('computeEpisodeStats calcula corretamente 0, 1, 2 e >= 3 avaliações e empates por ordem de exibição', () => {
    const empty = computeEpisodeStats([], 12);
    assert.equal(empty.evaluatedCount, 0);
    assert.equal(empty.countLabel, '0 de 12 avaliados');
    assert.equal(empty.averageRating100, null);
    assert.deepEqual(empty.topEpisodes, []);
    assert.equal(empty.worstEpisode, null);
    assert.equal(empty.canApplyAverageToSeries, false);

    const one = computeEpisodeStats([{ workId: 'w1', season: 1, episode: 4, rating: 90 }], 12);
    assert.equal(one.evaluatedCount, 1);
    assert.equal(one.countLabel, '1 de 12 avaliados');
    assert.equal(one.topEpisodes.length, 1);
    assert.equal(one.worstEpisode, null);
    assert.equal(one.canApplyAverageToSeries, false);

    const two = computeEpisodeStats(
      [
        { workId: 'w1', season: 1, episode: 2, rating: 95 },
        { workId: 'w1', season: 1, episode: 1, rating: 70 },
        { workId: 'w1', season: 1, episode: 3, tag: 'Filler', reaction: 'Sem nota ainda' },
      ],
      12
    );
    assert.equal(two.evaluatedCount, 2);
    assert.equal(two.topEpisodes.length, 2);
    assert.equal(two.worstEpisode?.episode, 1);
    assert.equal(two.canApplyAverageToSeries, false);

    const many = computeEpisodeStats(
      [
        { workId: 'w1', season: 2, episode: 1, rating: 95 },
        { workId: 'w1', season: 1, episode: 5, rating: 95 },
        { workId: 'w1', season: 1, episode: 1, rating: 95 },
        { workId: 'w1', season: 1, episode: 9, rating: 85 },
        { workId: 'w1', season: 2, episode: 3, rating: 60 },
      ],
      24
    );
    assert.equal(many.evaluatedCount, 5);
    assert.equal(many.canApplyAverageToSeries, true);
    assert.deepEqual(
      many.topEpisodes.map((ep) => `${ep.season}:${ep.episode}`),
      ['1:1', '1:5', '2:1']
    );
    assert.equal(`${many.worstEpisode.season}:${many.worstEpisode.episode}`, '2:3');
    assert.deepEqual(EPISODE_TAGS, ['Obra-prima', 'Filler', 'Virada de Chave', 'Final Épico']);
  });

  it('needsManualRatingOverwriteConfirm protege nota manual confirmada mas libera legacy-default', () => {
    assert.equal(
      needsManualRatingOverwriteConfirm({ rating: 80, ratingSource: 'legacy-default' }),
      false
    );
    assert.equal(needsManualRatingOverwriteConfirm({ rating: null, ratingSource: 'manual' }), false);
    assert.equal(needsManualRatingOverwriteConfirm({ rating: 85, ratingSource: 'manual' }), true);
  });

  it('buildEpisodeBarChartModel e computeVirtualEpisodeWindow lidam com barras tracejadas e > 100 episódios', () => {
    const evalMap = new Map([
      ['1:1', { workId: 'w1', season: 1, episode: 1, rating: 85, tag: 'Virada de Chave' }],
      ['1:3', { workId: 'w1', season: 1, episode: 3, rating: 100, tag: 'Obra-prima' }],
    ]);
    const chart = buildEpisodeBarChartModel(
      [
        { number: 1, title: 'Piloto' },
        { number: 2, title: 'Segundo' },
        { number: 3, title: 'Clímax' },
      ],
      evalMap,
      1
    );
    assert.equal(chart.length, 3);
    assert.equal(chart[0].rating10, '8.5');
    assert.equal(chart[0].isMissing, false);
    assert.equal(chart[1].isMissing, true);
    assert.equal(chart[1].rating10, null);
    assert.equal(chart[2].rating10, '10');

    const smallWindow = computeVirtualEpisodeWindow({
      totalCount: VIRTUALIZE_EPISODE_THRESHOLD,
      scrollTop: 500,
    });
    assert.equal(smallWindow.virtualized, false);
    assert.equal(smallWindow.startIndex, 0);
    assert.equal(smallWindow.endIndex, VIRTUALIZE_EPISODE_THRESHOLD - 1);

    const hugeWindow = computeVirtualEpisodeWindow({
      totalCount: 250,
      scrollTop: 4600,
      viewportHeight: 420,
      itemHeight: 96,
      overscan: 3,
    });
    assert.equal(hugeWindow.virtualized, true);
    assert.ok(hugeWindow.startIndex > 30);
    assert.ok(hugeWindow.endIndex < 100);
    assert.ok(hugeWindow.paddingTop > 0);
    assert.ok(hugeWindow.paddingBottom > 0);
  });

  it('formatNextAiringBadge formata próximo episódio em AniList/TVmaze/TMDB e oculta quando finalizada', () => {
    const tvmazeBadge = formatNextAiringBadge({
      status: 'watching',
      showStatus: 'Running',
      nextEpisode: { number: 5, airdate: '2026-08-19' },
    });
    assert.equal(tvmazeBadge?.text, 'Ep. 5 em 19/08');

    const tmdbBadge = formatNextAiringBadge({
      status: 'watching',
      tmdbStatus: 'Returning Series',
      nextEpisodeToAir: { episode_number: 7, air_date: '2026-09-03' },
    });
    assert.equal(tmdbBadge?.text, 'Ep. 7 em 03/09');

    const airingSec = Math.floor(new Date(2026, 10, 25, 14, 0, 0).getTime() / 1000);
    const anilistBadge = formatNextAiringBadge({
      status: 'watching',
      animeStatus: 'RELEASING',
      nextAiringEpisode: { episode: 12, airingAt: airingSec },
    });
    assert.equal(anilistBadge?.text, 'Ep. 12 em 25/11');

    assert.equal(
      formatNextAiringBadge({
        status: 'completed',
        showStatus: 'Running',
        nextEpisode: { number: 5, airdate: '2026-08-19' },
      }),
      null
    );
    assert.equal(
      formatNextAiringBadge({
        status: 'watching',
        animeStatus: 'FINISHED',
        nextAiringEpisode: { episode: 12, airingAt: airingSec },
      }),
      null
    );
    assert.equal(
      formatNextAiringBadge({
        status: 'watching',
        showStatus: 'Ended',
        nextEpisode: { number: 5, airdate: '2026-08-19' },
      }),
      null
    );
  });

  it('Regra Extra 3: saveEpisodeEvaluation nunca falha em silêncio quando IndexedDB está ausente ou estoura cota', async () => {
    const noIdb = await saveEpisodeEvaluation(
      { workId: 'work-no-idb', season: 1, episode: 2, rating: 90, tag: 'Obra-prima', reaction: 'Memorável' },
      { idbFactory: null }
    );
    assert.equal(noIdb.persisted, false);
    assert.equal(noIdb.provisional, true);
    assert.ok(noIdb.persistenceWarning && noIdb.persistenceWarning.length > 20);

    const listMem = await getEpisodeEvaluationsForWork('work-no-idb', { idbFactory: null });
    assert.equal(listMem.length, 1);
    assert.equal(listMem[0].provisional, true);

    const quotaIdb = createFakeIdbFactory({ failPutWithQuota: true });
    const quotaRes = await saveEpisodeEvaluation(
      { workId: 'work-quota', season: 2, episode: 1, rating: 75, tag: 'Filler' },
      { idbFactory: quotaIdb }
    );
    assert.equal(quotaRes.persisted, false);
    assert.equal(quotaRes.provisional, true);
    assert.match(quotaRes.persistenceWarning || '', /cota|espaço|armazenamento/i);

    const okIdb = createFakeIdbFactory({ failPutWithQuota: false });
    const okRes = await saveEpisodeEvaluation(
      { workId: 'work-ok', season: 1, episode: 3, rating: 95, tag: 'Final Épico' },
      { idbFactory: okIdb }
    );
    assert.equal(okRes.persisted, true);
    assert.equal(okRes.provisional, false);
    assert.equal(okRes.persistenceWarning, null);
    assert.equal(okRes.evalKey, makeEpisodeEvalKey('work-ok', 1, 3));

    const deleted = await deleteEpisodeEvaluation('work-ok', 1, 3, { idbFactory: okIdb });
    assert.equal(deleted.persisted, true);
    const afterDelete = await getEpisodeEvaluationsForWork('work-ok', { idbFactory: okIdb });
    assert.equal(afterDelete.length, 0);

    const epTabSrc = fs.readFileSync(
      path.resolve('src/components/EpisodeListTab.jsx'),
      'utf8'
    );
    assert.match(epTabSrc, /role="alert"/);
    assert.match(epTabSrc, /Provisório \(não salvo\)/);
  });

  it('APIs de temporada (OMDb, TMDB e Jikan) normalizam N/A, preservam filler apenas como sugestão e usam cache', async () => {
    let calls = 0;
    const fetchMock = async (url) => {
      calls += 1;
      const u = String(url);
      if (u.includes('omdbapi.com')) {
        return createJsonResponse({
          Response: 'True',
          Season: '1',
          Episodes: [
            { Title: 'Pilot', Released: '2008-01-20', Episode: '1', imdbRating: '9.0', imdbID: 'tt0959621' },
            { Title: 'N/A', Released: 'N/A', Episode: '2', imdbRating: 'N/A', imdbID: 'tt0959622' },
          ],
        });
      }
      if (u.includes('/tv/1396/season/1')) {
        return createJsonResponse({
          id: 3572,
          season_number: 1,
          name: 'Temporada 1',
          episodes: [
            { episode_number: 1, name: 'Pilot', overview: 'Um começo intenso.', vote_average: 8.8, runtime: 58, air_date: '2008-01-20' },
          ],
        });
      }
      if (u.includes('/tv/1396/episode_groups')) {
        return createJsonResponse({
          results: [{ id: 'grp1', name: 'Arco Principal', type: 6, episode_count: 7, group_count: 1 }],
        });
      }
      if (u.includes('/tv/episode_group/grp1')) {
        return createJsonResponse({
          id: 'grp1',
          name: 'Arco Principal',
          groups: [{ id: 'g1', name: 'Início', order: 1, episodes: [{ season_number: 1, episode_number: 1, name: 'Pilot' }] }],
        });
      }
      if (u.includes('api.jikan.moe/v4/anime/20/episodes')) {
        return createJsonResponse({
          data: [
            { mal_id: 1, title: 'Enter!', filler: false, recap: false, score: 4.5 },
            { mal_id: 26, title: 'Recap/Filler', filler: true, recap: false, score: 2.9 },
          ],
          pagination: { has_next_page: false },
        });
      }
      throw new Error(`Unexpected URL: ${u}`);
    };

    const omdbRes = await fetchOmdbSeasonEpisodes('tt0903747', 1, {
      apiKey: 'OMDB_TEST_KEY',
      fetchImpl: fetchMock,
    });
    assert.equal(omdbRes.episodes.length, 2);
    assert.equal(omdbRes.episodes[0].imdbRating, 9.0);
    assert.equal(omdbRes.episodes[1].title, null);
    assert.equal(omdbRes.episodes[1].imdbRating, null);
    assert.equal(omdbRes.episodes[1].released, null);

    const omdbCached = await fetchOmdbSeasonEpisodes('tt0903747', 1, {
      apiKey: 'OMDB_TEST_KEY',
      fetchImpl: fetchMock,
    });
    assert.equal(omdbCached.fromCache, true);
    assert.equal(calls, 1);

    const tmdbSeason = await fetchTmdbSeasonDetails(1396, 1, {
      apiKey: 'TMDB_TEST_KEY',
      fetchImpl: fetchMock,
    });
    assert.equal(tmdbSeason.episodes[0].rating, 8.8);

    const tmdbGroups = await fetchTmdbEpisodeGroups(1396, {
      apiKey: 'TMDB_TEST_KEY',
      fetchImpl: fetchMock,
    });
    assert.equal(tmdbGroups.groups.length, 1);
    const groupDetail = await fetchTmdbEpisodeGroupDetails('grp1', {
      apiKey: 'TMDB_TEST_KEY',
      fetchImpl: fetchMock,
    });
    assert.equal(groupDetail.arcs[0].name, 'Início');

    const jikanRes = await fetchJikanEpisodes(20, { page: 1, fetchImpl: fetchMock });
    assert.equal(jikanRes.episodes[1].filler, true);
  });

  it('Franquia: ciclos não travam, profundidade <= 3, limite <= 60 nós, legacy-default excluído e breakdown por formato', () => {
    // 1) Obra única: comparativo fica oculto
    const solo = {
      id: 'solo1',
      title: 'Obra Única',
      workType: 'movie',
      status: 'completed',
      rating: 90,
      ratingSource: 'manual',
    };
    const soloStats = computeFranchiseStats([{ id: 'solo1', item: solo, isCataloged: true, isCompleted: true, entryKind: 'Filme' }], solo);
    assert.equal(soloStats.hasComparative, false);

    // 2) Ciclos A <-> B e A -> B -> C -> A + ratingSource: 'legacy-default' excluído da média
    const nodeA = {
      id: 'a',
      title: 'Parte 1',
      workType: 'movie',
      status: 'completed',
      rating: 92,
      ratingSource: 'manual',
      belongsToCollection: { id: 10, name: 'Trilogia Teste' },
      franchiseLinks: [{ targetWorkId: 'b', title: 'Parte 2', workType: 'movie', relationType: 'SEQUEL' }],
    };
    const nodeB = {
      id: 'b',
      title: 'Parte 2',
      workType: 'movie',
      status: 'completed',
      rating: 80,
      ratingSource: 'legacy-default',
      belongsToCollection: { id: 10, name: 'Trilogia Teste' },
      franchiseLinks: [
        { targetWorkId: 'a', title: 'Parte 1', workType: 'movie', relationType: 'PREQUEL' },
        { targetWorkId: 'c', title: 'Spin-off X', workType: 'series', relationType: 'SPIN_OFF' },
      ],
    };
    const nodeC = {
      id: 'c',
      title: 'Spin-off X',
      status: 'watching',
      workType: 'series',
      rating: 78,
      ratingSource: 'manual',
      franchiseLinks: [{ targetWorkId: 'a', title: 'Parte 1', relationType: 'SIDE_STORY' }],
    };

    const graphNodes = traverseFranchiseGraph(nodeA, [nodeA, nodeB, nodeC]);
    assert.equal(graphNodes.length, 3);

    const franchise = findFranchiseForItem(nodeA, [nodeA, nodeB, nodeC]);
    assert.ok(franchise);
    assert.equal(franchise.stats.hasComparative, true);
    assert.equal(franchise.stats.ratedCount, 2); // legacy-default 80 em B foi excluído!
    assert.equal(franchise.stats.franchiseAverageRating, 85); // (92 + 78) / 2
    assert.equal(franchise.stats.rankLabel, '#1 de 2');
    assert.equal(franchise.stats.breakdown.movies.completed, 2);
    assert.equal(franchise.stats.breakdown.spinOffs.total, 1);

    // 3) Limite de profundidade <= 3
    const chain = [];
    for (let i = 0; i < 6; i += 1) {
      chain.push({
        id: `depth-${i}`,
        title: `Entrada ${i}`,
        franchiseLinks: i < 5 ? [{ targetWorkId: `depth-${i + 1}`, relationType: 'SEQUEL' }] : [],
      });
    }
    const boundedDepth = traverseFranchiseGraph(chain[0], chain);
    assert.equal(FRANCHISE_GRAPH_MAX_DEPTH, 3);
    assert.equal(boundedDepth.length, 4); // profundidade 0, 1, 2, 3

    // 4) Limite de nós <= 60
    const hub = {
      id: 'hub',
      title: 'Hub Universo',
      franchiseLinks: Array.from({ length: 85 }, (_, i) => ({
        targetWorkId: `leaf-${i}`,
        title: `Derivado ${i}`,
        relationType: 'SPIN_OFF',
      })),
    };
    const leaves = Array.from({ length: 85 }, (_, i) => ({ id: `leaf-${i}`, title: `Derivado ${i}` }));
    const boundedNodes = traverseFranchiseGraph(hub, [hub, ...leaves]);
    assert.equal(FRANCHISE_GRAPH_MAX_NODES, 60);
    assert.equal(boundedNodes.length, 60);
  });

  it('Regras de UI: ListScreen limita descoberta por diretor a 6 títulos e não contém emojis ou símbolos proibidos', () => {
    const listSrc = fs.readFileSync(path.resolve('src/screens/ListScreen.jsx'), 'utf8');
    assert.match(listSrc, /\.slice\(0,\s*6\)/);

    const files = [
      'src/lib/episodeStats.js',
      'src/components/EpisodeListTab.jsx',
      'src/components/FranchiseRadarPanel.jsx',
      'src/components/ItemDetailSheet.jsx',
      'src/screens/ListScreen.jsx',
    ];
    for (const rel of files) {
      const content = fs.readFileSync(path.resolve(rel), 'utf8');
      assert.equal(/[★✓✕]/u.test(content), false, `Símbolo proibido encontrado em ${rel}`);
    }
  });
});
