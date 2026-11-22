import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, it } from 'node:test';

import {
  clearMemoryApiCacheForTests,
} from '../src/api/cacheDb.js';
import {
  resetApiClientStateForTests,
  runBoundedConcurrency,
} from '../src/api/httpClient.js';
import {
  buildAniListRating,
  buildExternalRatingsViewModel,
  buildMalRating,
  buildTmdbRating,
  getPresentExternalRatingBadges,
  parseOmdbRatings,
} from '../src/lib/ratings.js';
import {
  clearCinemaSearchCache,
  enrichWorkWithExternalRatings,
} from '../src/services/cinemaApi.js';

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

describe('Fase 3 — Enriquecimento, Concorrência <= 2, Backdrops e Notas Externas', () => {
  beforeEach(() => {
    clearCinemaSearchCache();
    clearMemoryApiCacheForTests();
    resetApiClientStateForTests();
  });

  it('runBoundedConcurrency e enrichWorkWithExternalRatings nunca excedem 2 requisições simultâneas', async () => {
    let activeWorkers = 0;
    let maxWorkers = 0;
    const tasks = Array.from({ length: 6 }, (_, i) => async () => {
      activeWorkers += 1;
      maxWorkers = Math.max(maxWorkers, activeWorkers);
      await new Promise((r) => setTimeout(r, 15));
      activeWorkers -= 1;
      return i;
    });
    const out = await runBoundedConcurrency(tasks, 2);
    assert.deepEqual(out, [0, 1, 2, 3, 4, 5]);
    assert.equal(maxWorkers <= 2, true);

    // Simula série com TMDB + TVmaze + AniList/OMDb/Jikan garantindo maxInFlight <= 2
    let inFlight = 0;
    let peakInFlight = 0;
    const seenUrls = [];

    const mockFetch = async (url) => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      seenUrls.push(String(url));
      await new Promise((r) => setTimeout(r, 20));
      try {
        if (String(url).includes('api.themoviedb.org/3/tv/70523')) {
          return createJsonResponse({
            id: 70523,
            backdrop_path: '/dark_w1280.jpg',
            vote_average: 8.4,
            vote_count: 6800,
            overview: 'Mistério temporal em Winden.',
            number_of_seasons: 3,
            number_of_episodes: 26,
            episode_run_time: [55],
            seasons: [
              { season_number: 1, episode_count: 10 },
              { season_number: 2, episode_count: 8 },
              { season_number: 3, episode_count: 8 },
            ],
            external_ids: { imdb_id: 'tt5753856' },
            status: 'Ended',
            origin_country: ['DE'],
          });
        }
        if (String(url).includes('api.tvmaze.com/shows/17861/seasons')) {
          return createJsonResponse([{ number: 1 }, { number: 2 }, { number: 3 }]);
        }
        if (String(url).includes('api.tvmaze.com/shows/17861/episodes')) {
          return createJsonResponse([
            { season: 1, number: 1, name: 'Secrets', runtime: 51 },
          ]);
        }
        if (String(url).includes('api.tvmaze.com/shows/17861?embed=nextepisode')) {
          return createJsonResponse({ id: 17861, status: 'Ended' });
        }
        if (String(url).includes('omdbapi.com')) {
          return createJsonResponse({
            Response: 'True',
            imdbRating: '8.7',
            imdbVotes: '450,000',
            Metascore: 'N/A',
            Ratings: [
              { Source: 'Internet Movie Database', Value: '8.7/10' },
              { Source: 'Rotten Tomatoes', Value: '95%' },
            ],
          });
        }
        return createJsonResponse({}, 404);
      } finally {
        inFlight -= 1;
      }
    };

    const res = await enrichWorkWithExternalRatings(
      {
        id: 'w-dark',
        title: 'Dark',
        workType: 'series',
        tmdbId: 70523,
        tvmazeId: 17861,
        tmdbMediaType: 'tv',
      },
      {
        tmdbApiKey: 'test_tmdb_key',
        omdbApiKey: 'test_omdb_key',
        fetchImpl: mockFetch,
        maxConcurrency: 2,
      }
    );

    assert.equal(peakInFlight <= 2, true, `Pico de requisições simultâneas excedeu 2: ${peakInFlight}`);
    assert.equal(res.work.backdropUrl, 'https://image.tmdb.org/t/p/w1280/dark_w1280.jpg');
    assert.equal(res.work.ids.imdb, 'tt5753856');
    assert.equal(res.work.imdbId, 'tt5753856');
    assert.equal(res.work.externalRatings.tmdb.value, 8.4);
    assert.equal(res.work.externalRatings.imdb.value, 8.7);
    assert.equal(res.work.externalRatings.rottenTomatoes.value, 95);
    assert.equal(res.work.externalRatings.metacritic, null);
    assert.equal(res.meta.omdbMissingKey, false);
  });

  it('OMDb sem chave devolve MISSING_KEY, não chama omdbapi.com e mantém TMDB + backdrop funcionando', async () => {
    const calledHosts = [];
    const mockFetch = async (url) => {
      calledHosts.push(new URL(url).hostname);
      if (String(url).includes('api.themoviedb.org/3/movie/1398')) {
        return createJsonResponse({
          id: 1398,
          backdrop_path: '/stalker_backdrop.jpg',
          vote_average: 8.15,
          vote_count: 2300,
          runtime: 162,
          overview: 'Na Zona, um guia conduz dois homens.',
          belongs_to_collection: null,
          external_ids: { imdb_id: 'tt0079944' },
          status: 'Released',
        });
      }
      throw new Error(`Host inesperado chamado sem chave: ${url}`);
    };

    const res = await enrichWorkWithExternalRatings(
      {
        id: 'w-stalker',
        title: 'Stalker',
        workType: 'movie',
        tmdbId: 1398,
        tmdbMediaType: 'movie',
      },
      {
        tmdbApiKey: 'test_tmdb_key',
        omdbApiKey: null, // força OMDb sem chave
        fetchImpl: mockFetch,
      }
    );

    assert.equal(calledHosts.includes('www.omdbapi.com'), false);
    assert.equal(res.meta.omdbMissingKey, true);
    assert.equal(res.meta.omdbStatus, 'MISSING_KEY');
    assert.equal(res.work.backdropUrl, 'https://image.tmdb.org/t/p/w1280/stalker_backdrop.jpg');
    assert.equal(res.work.externalRatings.tmdb.value, 8.2);
    assert.equal(res.work.externalRatings.imdb, null);
    assert.equal(res.work.externalRatings.rottenTomatoes, null);
    assert.equal(res.work.externalRatings.metacritic, null);

    const vm = buildExternalRatingsViewModel(res.work, res.meta);
    assert.equal(vm.state, 'partial');
    assert.equal(vm.omdbMissingKey, true);
    assert.deepEqual(
      vm.badges.map((b) => b.displayText),
      ['TMDB 8.2']
    );
  });

  it('enriquece anime via AniList (bannerImage + AniList%) e Jikan (MAL) isolando falha parcial da Jikan', async () => {
    // 1. Anime completo (AniList + Jikan OK)
    const fetchAllOk = async (url) => {
      if (String(url).includes('graphql.anilist.co')) {
        return createJsonResponse({
          data: {
            m_0: {
              id: 20,
              idMal: 20,
              type: 'ANIME',
              format: 'TV',
              status: 'FINISHED',
              episodes: 220,
              duration: 23,
              seasonYear: 2002,
              averageScore: 88,
              genres: ['Action', 'Adventure'],
              bannerImage: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/20.jpg',
              description: 'Ninja da Aldeia da Folha.',
              title: { romaji: 'Naruto', english: 'Naruto' },
              coverImage: { extraLarge: 'https://s4.anilist.co/file/20.jpg' },
              studios: { nodes: [{ name: 'Pierrot' }] },
              relations: { edges: [] },
            },
          },
        });
      }
      if (String(url).includes('api.jikan.moe/v4/anime/20')) {
        return createJsonResponse({
          data: {
            mal_id: 20,
            score: 8.72,
            episodes: 220,
          },
        });
      }
      return createJsonResponse({}, 404);
    };

    const fullAnime = await enrichWorkWithExternalRatings(
      {
        id: 'w-naruto',
        title: 'Naruto',
        workType: 'anime',
        anilistId: 20,
      },
      { fetchImpl: fetchAllOk }
    );

    assert.equal(
      fullAnime.work.backdropUrl,
      'https://s4.anilist.co/file/anilistcdn/media/anime/banner/20.jpg'
    );
    assert.equal(fullAnime.work.ids.mal, 20);
    assert.equal(fullAnime.work.externalRatings.anilist.value, 88);
    assert.equal(fullAnime.work.externalRatings.mal.value, 8.72);
    assert.deepEqual(
      getPresentExternalRatingBadges(fullAnime.work.externalRatings).map((b) => b.displayText),
      ['AniList 88%', 'MAL 8.72']
    );

    // 2. Falha isolada da Jikan -> AniList ainda fica visível com estado parcial
    clearMemoryApiCacheForTests();
    const fetchJikanFail = async (url, init) => {
      if (String(url).includes('api.jikan.moe')) {
        throw new Error('Jikan offline');
      }
      return fetchAllOk(url, init);
    };

    const partialAnime = await enrichWorkWithExternalRatings(
      {
        id: 'w-naruto-2',
        title: 'Naruto',
        workType: 'anime',
        anilistId: 20,
        malId: 20,
      },
      { fetchImpl: fetchJikanFail }
    );
    assert.equal(partialAnime.work.externalRatings.anilist.value, 88);
    assert.equal(partialAnime.work.externalRatings.mal, null);
    assert.deepEqual(partialAnime.meta.failedSources, ['mal']);
    assert.equal(partialAnime.meta.partial, true);
  });

  it('cobre todas as combinações de selos presentes/ausentes, 5 estados D6 e "Sua Nota vs. Público"', () => {
    const fetchedAt = new Date(2026, 10, 22, 12, 0, 0).getTime(); // 22/11/2026
    const allSixSources = {
      ...parseOmdbRatings(
        {
          imdbRating: '8.9',
          imdbVotes: '1,200,000',
          Metascore: '71',
          Ratings: [{ Source: 'Rotten Tomatoes', Value: '94%' }],
        },
        fetchedAt
      ),
      tmdb: buildTmdbRating(7.8, 4500, fetchedAt),
      anilist: buildAniListRating(88, fetchedAt),
      mal: buildMalRating(8.72, fetchedAt),
    };

    const allBadges = getPresentExternalRatingBadges(allSixSources);
    assert.deepEqual(
      allBadges.map((b) => b.displayText),
      ['IMDb 8.9', 'RT 94%', 'Metacritic 71', 'TMDB 7.8', 'AniList 88%', 'MAL 8.72']
    );
    assert.ok(allBadges.every((b) => b.fetchedDateLabel === '22/11'));

    // Estado 1: Carregando com skeleton individual por fonte faltante
    const loadingVm = buildExternalRatingsViewModel(
      {
        workType: 'movie',
        tmdbId: 10,
        rating: 92,
        ratingSource: 'manual',
        externalRatings: { tmdb: buildTmdbRating(7.8, 100, fetchedAt) },
      },
      { loading: true }
    );
    assert.equal(loadingVm.state, 'partial');
    assert.deepEqual(
      loadingVm.skeletonSourceIds.map((s) => s.id),
      ['imdb', 'rottenTomatoes', 'metacritic']
    );
    assert.equal(loadingVm.comparison.deltaText, '+14');
    assert.match(loadingVm.comparison.alignmentText, /\+14 pts acima do público/);

    // Estado 2: Loading 100% vazio -> todos os 4 skeletons individuais para filme
    const pureLoadingVm = buildExternalRatingsViewModel(
      { workType: 'movie', tmdbId: 10 },
      { loading: true }
    );
    assert.equal(pureLoadingVm.state, 'loading');
    assert.equal(pureLoadingVm.skeletonSourceIds.length, 4);

    // Estado 3: Offline com cache -> exibe data "22/11"
    const offlineVm = buildExternalRatingsViewModel(
      { workType: 'movie', tmdbId: 10, externalRatings: allSixSources },
      { isOfflineCache: true, cacheDateLabel: '22/11' }
    );
    assert.equal(offlineVm.state, 'offline');
    assert.equal(offlineVm.cacheDateLabel, '22/11');

    // Estado 4: Erro completo (0 selos + falha)
    const errorVm = buildExternalRatingsViewModel(
      { workType: 'movie', tmdbId: 10 },
      { failedSources: ['tmdb', 'omdb'], hasAttempted: true }
    );
    assert.equal(errorVm.state, 'error');

    // Estado 5: Vazio (sem IDs nem notas)
    const emptyVm = buildExternalRatingsViewModel(
      { workType: 'movie' },
      { hasAttempted: true }
    );
    assert.equal(emptyVm.state, 'empty');

    // "Sua Nota vs. Público" oculto quando legacy-default ou sem nota ou sem fontes
    const legacyVm = buildExternalRatingsViewModel({
      workType: 'movie',
      rating: 80,
      ratingSource: 'legacy-default',
      externalRatings: { imdb: allSixSources.imdb },
    });
    assert.equal(legacyVm.comparison, null);

    const belowPublicVm = buildExternalRatingsViewModel({
      workType: 'movie',
      rating: 70,
      ratingSource: 'manual',
      externalRatings: { tmdb: buildTmdbRating(7.8, 500, fetchedAt) }, // publicAvg = 78
    });
    assert.equal(belowPublicVm.comparison.deltaText, '-8');
    assert.match(belowPublicVm.comparison.alignmentText, /-8 pts abaixo do público/);
  });

  it('cards de busca em AddScreen exibem apenas notas da busca (sem chamadas extras por card)', () => {
    const addSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/screens/AddScreen.jsx'),
      'utf8'
    );
    assert.match(addSrc, /getPresentExternalRatingBadges\s*\(\s*candidate\.externalRatings\s*\)/);
    assert.match(addSrc, /enrichWorkWithExternalRatings/);
  });
});
