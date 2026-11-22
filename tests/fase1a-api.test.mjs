import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, it } from 'node:test';

import {
  buildAniListAliasQuery,
  enqueueAniListMediaById,
  fetchAniListBatchByIds,
} from '../src/api/anilistBatch.js';
import {
  clearMemoryApiCacheForTests,
  evictOldestCacheEntries,
  formatCacheDatePt,
  getCachedEntry,
  getEpisodeEvaluationsForWork,
  getEpisodesTtlMs,
  normalizeSafeCacheKey,
  saveEpisodeEvaluation,
  setCachedEntry,
} from '../src/api/cacheDb.js';
import {
  apiRequest,
  ApiQuotaError,
  ApiRateLimitError,
  ApiTimeoutError,
  getOmdbDailyUsage,
  maskSecretsInText,
  parseRetryAfterMs,
  resetApiClientStateForTests,
  setOmdbDailyUsageForTests,
  stripApiKeysFromUrl,
} from '../src/api/httpClient.js';
import {
  CACHE_STORES,
  CACHE_TTL_MS,
} from '../src/api/limits.js';
import {
  applyCanonicalIdsToWork,
  normalizeIdsBlock,
  resolveIdBridge,
} from '../src/lib/idBridge.js';
import {
  buildAniListRating,
  buildMalRating,
  buildTmdbRating,
  compareUserRatingWithPublic,
  episodeScore10To100,
  formatEpisodeRating10,
  getPresentExternalRatingBadges,
  normalizeScoreTo100,
  parseOmdbRatings,
  snapEpisodeRatingStep5,
} from '../src/lib/ratings.js';
import {
  clearCinemaSearchCache,
  fetchJikanEpisodes,
  fetchOmdbByImdbId,
  lookupTvMazeByImdb,
  saveOmdbApiKey,
  searchCinemaMedia,
  testOmdbConnection,
} from '../src/services/cinemaApi.js';

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem(k) {
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      map.set(String(k), String(v));
    },
    removeItem(k) {
      map.delete(String(k));
    },
    clear() {
      map.clear();
    },
  };
}

globalThis.localStorage = createMemoryStorage();

function createMockClock(startMs = 1_700_000_000_000) {
  let now = startMs;
  const sleeps = [];
  return {
    nowFn: () => now,
    sleepFn: async (ms) => {
      const dur = Math.max(0, Number(ms) || 0);
      sleeps.push(dur);
      now += dur;
    },
    advance: (ms) => {
      now += ms;
    },
    sleeps,
  };
}

beforeEach(() => {
  globalThis.localStorage.clear();
  clearCinemaSearchCache();
  clearMemoryApiCacheForTests();
  resetApiClientStateForTests();
});

describe('Fase 1A — Fila HTTP, limites, 429, timeout e deduplicação (D4)', () => {
  it('respeita Retry-After em HTTP 429 e faz retry com backoff até responder', async () => {
    const clock = createMockClock();
    let calls = 0;

    const mockFetch = async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: false,
          status: 429,
          headers: { 'Retry-After': '2' },
          json: async () => ({}),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: {},
        json: async () => ({ Response: 'True', imdbRating: '8.7' }),
      };
    };

    const res = await apiRequest('https://www.omdbapi.com/?i=tt0133093', {
      provider: 'omdb',
      fetchImpl: mockFetch,
      nowFn: clock.nowFn,
      sleepFn: clock.sleepFn,
      dedup: false,
    });

    assert.equal(res.status, 200);
    assert.equal(calls, 2);
    assert.ok(clock.sleeps.some((ms) => ms === 2000));

    // HTTP-date em Retry-After também é interpretado corretamente
    const httpDate = new Date(clock.nowFn() + 5000).toUTCString();
    assert.equal(parseRetryAfterMs(httpDate, clock.nowFn()), 5000);
  });

  it('lança ApiRateLimitError quando esgota retries em HTTP 429', async () => {
    const clock = createMockClock();
    let calls = 0;

    const mockFetch = async () => {
      calls += 1;
      return {
        ok: false,
        status: 429,
        headers: { 'retry-after': '1' },
      };
    };

    await assert.rejects(
      () =>
        apiRequest('https://api.jikan.moe/v4/anime?q=test', {
          provider: 'jikan',
          maxRetries: 1,
          fetchImpl: mockFetch,
          nowFn: clock.nowFn,
          sleepFn: clock.sleepFn,
          dedup: false,
        }),
      (err) => err instanceof ApiRateLimitError && err.code === 'HTTP_429'
    );
    assert.equal(calls, 2);
  });

  it('respeita limite da Jikan (3/s e 60/min) e headers X-RateLimit-* da AniList', async () => {
    const clock = createMockClock();
    const jikanTimestamps = [];

    const mockFetch = async (url) => {
      if (String(url).includes('jikan')) {
        jikanTimestamps.push(clock.nowFn());
        return { ok: true, status: 200, headers: {}, json: async () => ({ data: [] }) };
      }
      if (jikanTimestamps.length === 0 && String(url).includes('anilist')) {
        return {
          ok: true,
          status: 200,
          headers: {
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.floor(clock.nowFn() / 1000) + 12),
          },
          json: async () => ({ data: {} }),
        };
      }
      return { ok: true, status: 200, headers: {}, json: async () => ({ data: {} }) };
    };

    const jikanCalls = Array.from({ length: 5 }, (_, idx) =>
      apiRequest(`https://api.jikan.moe/v4/anime/${idx + 1}/episodes`, {
        provider: 'jikan',
        fetchImpl: mockFetch,
        nowFn: clock.nowFn,
        sleepFn: clock.sleepFn,
      })
    );
    await Promise.all(jikanCalls);

    assert.equal(jikanTimestamps.length, 5);
    for (let i = 0; i < jikanTimestamps.length; i += 1) {
      const inOneSec = jikanTimestamps.filter(
        (t) => t >= jikanTimestamps[i] && t < jikanTimestamps[i] + 1000
      );
      assert.ok(inOneSec.length <= 3, `Excedeu 3 req/s na Jikan: ${inOneSec.length}`);
    }

    // AniList com X-RateLimit-Remaining: 0 pausa a próxima chamada na fila até o reset
    resetApiClientStateForTests();
    const aniClock = createMockClock(2_000_000_000_000);
    const aniTimes = [];
    const aniFetch = async () => {
      aniTimes.push(aniClock.nowFn());
      if (aniTimes.length === 1) {
        return {
          ok: true,
          status: 200,
          headers: {
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': '10',
          },
          json: async () => ({ data: {} }),
        };
      }
      return { ok: true, status: 200, headers: {}, json: async () => ({ data: {} }) };
    };

    await apiRequest('https://graphql.anilist.co', {
      provider: 'anilist',
      method: 'POST',
      body: 'q1',
      fetchImpl: aniFetch,
      nowFn: aniClock.nowFn,
      sleepFn: aniClock.sleepFn,
    });
    await apiRequest('https://graphql.anilist.co', {
      provider: 'anilist',
      method: 'POST',
      body: 'q2',
      fetchImpl: aniFetch,
      nowFn: aniClock.nowFn,
      sleepFn: aniClock.sleepFn,
    });

    assert.ok(aniTimes[1] - aniTimes[0] >= 10_000);
  });

  it('para chamadas automáticas da OMDb aos 90% da cota diária (900/1000)', async () => {
    setOmdbDailyUsageForTests(900);
    const usage = getOmdbDailyUsage();
    assert.equal(usage.autoStopped, true);

    let fetchCalled = false;
    await assert.rejects(
      () =>
        apiRequest('https://www.omdbapi.com/?i=tt0133093', {
          provider: 'omdb',
          mode: 'auto',
          fetchImpl: async () => {
            fetchCalled = true;
            return { ok: true, status: 200 };
          },
        }),
      (err) => err instanceof ApiQuotaError && err.code === 'OMDB_AUTO_QUOTA_REACHED'
    );
    assert.equal(fetchCalled, false);
  });

  it('aborta requisição lenta no timeout com AbortController e lança ApiTimeoutError', async () => {
    const clock = createMockClock();
    let abortedCount = 0;

    const slowFetch = (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          abortedCount += 1;
          const err = new Error('Aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });

    await assert.rejects(
      () =>
        apiRequest('https://api.tvmaze.com/shows/1', {
          provider: 'tvmaze',
          timeoutMs: 60,
          maxRetries: 1,
          fetchImpl: slowFetch,
          nowFn: clock.nowFn,
          sleepFn: clock.sleepFn,
        }),
      (err) => err instanceof ApiTimeoutError && err.code === 'API_TIMEOUT'
    );
    assert.equal(abortedCount, 2);
  });

  it('deduplica chamadas simultâneas em andamento (in-flight) e agrupa AniList com aliases', async () => {
    let singleUrlFetchCount = 0;
    const mockFetch = async () => {
      singleUrlFetchCount += 1;
      await new Promise((r) => setTimeout(r, 15));
      return new Response(JSON.stringify({ ok: true, n: singleUrlFetchCount }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const [r1, r2] = await Promise.all([
      apiRequest('https://api.tvmaze.com/shows/82', { provider: 'tvmaze', fetchImpl: mockFetch }),
      apiRequest('https://api.tvmaze.com/shows/82', { provider: 'tvmaze', fetchImpl: mockFetch }),
    ]);

    assert.equal(singleUrlFetchCount, 1);
    const j1 = await r1.json();
    const j2 = await r2.json();
    assert.deepEqual(j1, j2);

    // AniList GraphQL Batch com aliases
    const built = buildAniListAliasQuery([21, 5114, 1, 21]);
    assert.equal(built.ids.length, 3);
    assert.match(built.query, /m_0: Media\(id: \$id_0, type: ANIME\)/);
    assert.match(built.query, /m_1: Media\(id: \$id_1, type: ANIME\)/);
    assert.match(built.query, /m_2: Media\(id: \$id_2, type: ANIME\)/);

    let batchFetchCalls = 0;
    const batchFetch = async (_url, opts) => {
      batchFetchCalls += 1;
      const body = JSON.parse(opts.body);
      assert.match(body.query, /m_0: Media/);
      return {
        ok: true,
        status: 200,
        headers: {},
        json: async () => ({
          data: {
            m_0: { id: 21, idMal: 21, title: { romaji: 'One Piece' } },
            m_1: { id: 5114, idMal: 5114, title: { english: 'Fullmetal Alchemist: Brotherhood' } },
          },
        }),
      };
    };

    const [a1, a2] = await Promise.all([
      enqueueAniListMediaById(21, { fetchImpl: batchFetch }),
      enqueueAniListMediaById(5114, { fetchImpl: batchFetch }),
    ]);
    assert.equal(batchFetchCalls, 1);
    assert.equal(a1.id, 21);
    assert.equal(a2.idMal, 5114);

    const directMap = await fetchAniListBatchByIds([21, 5114], { fetchImpl: batchFetch });
    assert.equal(directMap.get(21)?.id, 21);
  });
});

describe('Fase 1A — Cache IndexedDB, TTL, Offline e Cota Cheia (D4)', () => {
  it('respeita TTL, serve cache expirado em offline com "dados de DD/MM" e descarta antigos sem apagar avaliações', async () => {
    const t0 = new Date(2026, 10, 10, 12, 0, 0).getTime(); // 10/11/2026
    assert.equal(formatCacheDatePt(t0), 'dados de 10/11');

    assert.equal(getEpisodesTtlMs('Running'), CACHE_TTL_MS.episodesOngoing);
    assert.equal(getEpisodesTtlMs('Ended'), CACHE_TTL_MS.episodesFinished);

    await setCachedEntry(CACHE_STORES.ratings, 'omdb:tt0133093', { imdb: 8.7 }, { ttlMs: 1000, now: t0 });

    const fresh = await getCachedEntry(CACHE_STORES.ratings, 'omdb:tt0133093', { now: t0 + 500 });
    assert.equal(fresh.hit, true);
    assert.equal(fresh.stale, false);

    const expiredOnline = await getCachedEntry(CACHE_STORES.ratings, 'omdb:tt0133093', {
      now: t0 + 2000,
      allowStaleOffline: false,
    });
    assert.equal(expiredOnline.hit, false);
    assert.equal(expiredOnline.expired, true);

    const expiredOffline = await getCachedEntry(CACHE_STORES.ratings, 'omdb:tt0133093', {
      now: t0 + 2000,
      allowStaleOffline: true,
    });
    assert.equal(expiredOffline.hit, true);
    assert.equal(expiredOffline.stale, true);
    assert.equal(expiredOffline.cacheDateLabel, 'dados de 10/11');

    // Avaliação durável de episódio NÃO pode sumir quando ocorre eviction por cota cheia
    await saveEpisodeEvaluation({
      workId: 'anime-bebop',
      season: 1,
      episode: 5,
      rating: 95,
      tag: 'Obra-prima',
      reaction: 'Cena da catedral.',
    });

    await setCachedEntry(CACHE_STORES.search, 'q1', { a: 1 }, { now: t0 });
    await setCachedEntry(CACHE_STORES.search, 'q2', { a: 2 }, { now: t0 + 10 });

    let quotaFailures = 0;
    await setCachedEntry(
      CACHE_STORES.search,
      'q3',
      { a: 3 },
      {
        now: t0 + 20,
        onQuotaTestHook: async () => {
          if (quotaFailures === 0) {
            quotaFailures += 1;
            const err = new Error('Quota exceeded');
            err.name = 'QuotaExceededError';
            throw err;
          }
        },
      }
    );

    const evals = await getEpisodeEvaluationsForWork('anime-bebop');
    assert.equal(evals.length, 1);
    assert.equal(evals[0].rating, 95);

    const q1After = await getCachedEntry(CACHE_STORES.search, 'q1', { now: t0 + 20 });
    assert.equal(q1After.hit, false);
    const evictedMore = await evictOldestCacheEntries();
    assert.ok(evictedMore >= 1);
  });
});

describe('Fase 1A — OMDb, Chave Ausente, Campo Ausente e Normalização de Notas (D3 / D5)', () => {
  it('retorna MISSING_KEY sem quebrar nem chamar rede quando não há chave da OMDb', async () => {
    let called = false;
    const res = await fetchOmdbByImdbId('tt0133093', {
      fetchImpl: async () => {
        called = true;
        return { ok: true, status: 200 };
      },
    });
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'MISSING_KEY');
    assert.equal(res.ratings, null);
    assert.equal(called, false);
  });

  it('trata campo ausente ou N/A como null e nunca inventa nota nem retorna "N/A"', async () => {
    const emptyParsed = parseOmdbRatings({
      Response: 'True',
      imdbRating: 'N/A',
      imdbVotes: 'N/A',
      Metascore: 'N/A',
      Ratings: [],
    });
    assert.deepEqual(emptyParsed, { imdb: null, rottenTomatoes: null, metacritic: null });

    saveOmdbApiKey('demo-omdb-key-for-test');
    const clock = createMockClock();
    const omdbRes = await fetchOmdbByImdbId('tt0133093', {
      nowFn: clock.nowFn,
      sleepFn: clock.sleepFn,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: {},
        json: async () => ({
          Response: 'True',
          imdbID: 'tt0133093',
          imdbRating: '8.7',
          imdbVotes: '2,012,345',
          Metascore: '73',
          Ratings: [
            { Source: 'Internet Movie Database', Value: '8.7/10' },
            { Source: 'Rotten Tomatoes', Value: '88%' },
            { Source: 'Metacritic', Value: '73/100' },
          ],
        }),
      }),
    });

    assert.equal(omdbRes.ok, true);
    assert.equal(omdbRes.ratings.imdb.value, 8.7);
    assert.equal(omdbRes.ratings.imdb.votes, 2012345);
    assert.equal(omdbRes.ratings.rottenTomatoes.value, 88);
    assert.equal(omdbRes.ratings.metacritic.value, 73);
  });

  it('normaliza notas para 0–100, gera selos sem ausentes e calcula diferença com sinal', () => {
    assert.equal(normalizeScoreTo100(8.9, 10), 89);
    assert.equal(normalizeScoreTo100(94, 100), 94);
    assert.equal(normalizeScoreTo100(null, 10), null);

    const ratings = {
      imdb: { value: 8.9, scale: 10, votes: 150000, fetchedAt: 1000 },
      rottenTomatoes: null,
      metacritic: { value: 71, scale: 100, fetchedAt: 1000 },
      tmdb: buildTmdbRating(7.8, 1200, 1000),
      anilist: buildAniListRating(88, 1000),
      mal: buildMalRating(8.72, 1000),
    };

    const badges = getPresentExternalRatingBadges(ratings);
    assert.equal(badges.length, 5);
    assert.equal(badges.some((b) => b.id === 'rottenTomatoes'), false);
    assert.equal(badges.find((b) => b.id === 'imdb')?.displayText, 'IMDb 8.9');
    assert.equal(badges.find((b) => b.id === 'mal')?.displayText, 'MAL 8.72');

    // Média externa de {89, 71, 78, 88, 87} = 413 / 5 = 82.6 -> 83
    const cmpAbove = compareUserRatingWithPublic(95, ratings, 'manual');
    assert.equal(cmpAbove.deltaText, '+12');

    const cmpBelow = compareUserRatingWithPublic(75, ratings, 'manual');
    assert.equal(cmpBelow.deltaText, '-8');

    // legacy-default e null nunca entram no comparativo
    assert.equal(compareUserRatingWithPublic(80, ratings, 'legacy-default'), null);
    assert.equal(compareUserRatingWithPublic(null, ratings, 'manual'), null);

    // Episódio: interna 0–100 em passos de 5, exibida 0–10
    assert.equal(snapEpisodeRatingStep5(83), 85);
    assert.equal(episodeScore10To100(8.5), 85);
    assert.equal(formatEpisodeRating10(85), '8.5');
    assert.equal(formatEpisodeRating10(90), '9');
  });
});

describe('Fase 1A — Ponte de IDs (D1 / D2) e Headers CSP', () => {
  it('resolve ponte TMDB -> IMDb -> TVmaze e confirma anime sem adivinhar por título solto', async () => {
    const legacyWork = applyCanonicalIdsToWork({
      title: 'Breaking Bad',
      workType: 'series',
      tmdbId: 1396,
      tmdbMediaType: 'tv',
    });
    assert.deepEqual(normalizeIdsBlock(legacyWork), {
      tmdb: 1396,
      imdb: null,
      tvmaze: null,
      anilist: null,
      mal: null,
    });

    const bridged = await resolveIdBridge(legacyWork, {
      fetchTmdbExternalIds: async (id) => (id === 1396 ? { imdbId: 'tt0903747' } : null),
      lookupTvMazeByImdb: async (imdb) =>
        imdb === 'tt0903747' ? { tvmazeId: 169 } : null,
    });

    assert.equal(bridged.ids.imdb, 'tt0903747');
    assert.equal(bridged.ids.tvmaze, 169);
    assert.equal(bridged.imdbId, 'tt0903747');
    assert.equal(bridged.tvmazeId, 169);

    // Obra sem adaptadores ou elos não inventa IDs
    const unresolved = await resolveIdBridge({ title: 'Filme Desconhecido', workType: 'movie' }, {});
    assert.deepEqual(unresolved.ids, {
      tmdb: null,
      imdb: null,
      tvmaze: null,
      anilist: null,
      mal: null,
    });

    // Regra D1 de detecção de anime: TMDB Animação + JP confirmado por AniList
    const animeRes = await resolveIdBridge(
      {
        title: 'Frieren',
        workType: 'series',
        tmdbId: 209867,
        tmdbMediaType: 'tv',
        hasTmdbAnimationGenre: true,
        originCountry: ['JP'],
        releaseYear: 2023,
      },
      {
        confirmAnimeOnAniList: async () => ({ anilistId: 154587, malId: 52991 }),
      }
    );
    assert.equal(animeRes.workType, 'anime');
    assert.equal(animeRes.ids.anilist, 154587);
    assert.equal(animeRes.ids.mal, 52991);

    // Lookup TVmaze real (404 seguro) e Jikan episódios com flag filler
    const tv404 = await lookupTvMazeByImdb('tt9999999', {
      fetchImpl: async () => ({ ok: false, status: 404, headers: {} }),
    });
    assert.equal(tv404, null);

    const jikanEps = await fetchJikanEpisodes(1, {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: {},
        json: async () => ({
          pagination: { has_next_page: false, last_visible_page: 1 },
          data: [
            { mal_id: 1, title: 'Asteroid Blues', score: 4.5, filler: false, recap: false },
            { mal_id: 2, title: 'Stray Dog Strut', score: 4.2, filler: true, recap: false },
          ],
        }),
      }),
    });
    assert.equal(jikanEps.episodes.length, 2);
    assert.equal(jikanEps.episodes[1].filler, true);
  });

  it('garante domínios da OMDb e hosts de imagens TMDB/AniList no CSP de public/_headers', () => {
    const headersPath = path.resolve(process.cwd(), 'public/_headers');
    const txt = fs.readFileSync(headersPath, 'utf8');
    assert.match(txt, /https:\/\/www\.omdbapi\.com/);
    assert.match(txt, /https:\/\/api\.themoviedb\.org/);
    assert.match(txt, /https:\/\/graphql\.anilist\.co/);
    assert.match(txt, /https:\/\/api\.jikan\.moe/);
    assert.match(txt, /https:\/\/api\.tvmaze\.com/);
    assert.match(txt, /https:\/\/www\.wikidata\.org/);
    assert.match(txt, /https:\/\/image\.tmdb\.org/);
    assert.match(txt, /https:\/\/s4\.anilist\.co/);
  });

  it('remove apikey/api_key das chaves de cache e mascara chaves em mensagens de erro', async () => {
    const omdbSecret = 'demo-omdb-secret-9911';
    const tmdbSecret = 'demo-tmdb-secret-8822';

    assert.equal(
      stripApiKeysFromUrl(`https://www.omdbapi.com/?apikey=${omdbSecret}&i=tt0133093`),
      'https://www.omdbapi.com/?i=tt0133093'
    );
    assert.equal(
      stripApiKeysFromUrl(`https://api.themoviedb.org/3/movie/603?api_key=${tmdbSecret}&language=pt-BR`),
      'https://api.themoviedb.org/3/movie/603?language=pt-BR'
    );
    assert.equal(
      normalizeSafeCacheKey(`https://www.omdbapi.com/?apikey=${omdbSecret}&i=tt0133093`),
      'https://www.omdbapi.com/?i=tt0133093'
    );

    const saved = await setCachedEntry(
      CACHE_STORES.ratings,
      `https://www.omdbapi.com/?apikey=${omdbSecret}&i=tt0133093`,
      { imdb: { value: 8.7 } }
    );
    assert.equal(saved.record.cacheKey.includes(omdbSecret), false);
    assert.equal(saved.record.cacheKey.includes('apikey='), false);

    // Busca TMDB no cache local não armazena valor da chave em nenhuma chave do localStorage
    await searchCinemaMedia('Matrix', {
      filter: 'movie',
      sources: ['tmdb'],
      tmdbApiKey: tmdbSecret,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: {},
        json: async () => ({
          results: [{ id: 603, media_type: 'movie', title: 'Matrix', release_date: '1999-03-31' }],
        }),
      }),
    });
    const searchCacheRaw = globalThis.localStorage.getItem('cine_codice_search_cache_v1') || '';
    assert.equal(searchCacheRaw.includes(tmdbSecret), false);
    assert.equal(searchCacheRaw.includes('api_key='), false);

    // Mensagens de erro com eco de URL mascaram apikey= e api_key=
    const echoedError = maskSecretsInText(
      `Falha ao consultar https://www.omdbapi.com/?apikey=${omdbSecret}&i=tt0133093 e api_key=${tmdbSecret}`,
      [omdbSecret, tmdbSecret]
    );
    assert.equal(echoedError.includes(omdbSecret), false);
    assert.equal(echoedError.includes(tmdbSecret), false);
    assert.match(echoedError, /apikey=\*{4}/);
    assert.match(echoedError, /api_key=\*{4}/);

    await assert.rejects(
      () =>
        apiRequest(`https://api.themoviedb.org/3/movie/603?api_key=${tmdbSecret}`, {
          provider: 'tmdb',
          maxRetries: 0,
          fetchImpl: async (u) => {
            throw new Error(`Network failed at ${u}`);
          },
        }),
      (err) => {
        assert.equal(err.message.includes(tmdbSecret), false);
        assert.match(err.message, /api_key=\*{4}/);
        return true;
      }
    );

    const connRes = await testOmdbConnection(omdbSecret, {
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        headers: {},
        json: async () => ({ Response: 'False', Error: `Invalid API key: ${omdbSecret}` }),
      }),
    });
    assert.equal(connRes.ok, false);
    assert.equal(connRes.errorMessage.includes(omdbSecret), false);
  });

  it('continua funcionando sem erro quando IndexedDB falha (modo privado ou cota zero)', async () => {
    const brokenIdbFactory = {
      open() {
        const err = new Error('Private mode forbids IndexedDB');
        err.name = 'SecurityError';
        throw err;
      },
    };

    const cachedMiss = await getCachedEntry(CACHE_STORES.ratings, 'omdb:tt0133093', {
      idbFactory: brokenIdbFactory,
    });
    assert.equal(cachedMiss.hit, false);

    const savedInMem = await setCachedEntry(
      CACHE_STORES.ratings,
      'omdb:tt0133093',
      { imdb: 8.7 },
      { idbFactory: brokenIdbFactory }
    );
    assert.equal(savedInMem.saved, true);

    const quotaZeroSave = await setCachedEntry(
      CACHE_STORES.ratings,
      'omdb:tt0111161',
      { imdb: 9.3 },
      {
        idbFactory: brokenIdbFactory,
        onQuotaTestHook: async () => {
          const err = new Error('Quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        },
      }
    );
    assert.equal(quotaZeroSave.saved, false);
    assert.equal(quotaZeroSave.quotaFailed, true);

    // Simula globalThis.indexedDB lançando SecurityError durante busca + OMDb completa
    const prevIdb = globalThis.indexedDB;
    globalThis.indexedDB = brokenIdbFactory;
    try {
      const searchRes = await searchCinemaMedia('Cowboy Bebop', {
        filter: 'anime',
        sources: ['jikan'],
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          headers: {},
          json: async () => ({
            data: [
              { mal_id: 1, title: 'Cowboy Bebop', year: 1998, episodes: 26, type: 'TV' },
            ],
          }),
        }),
      });
      assert.equal(searchRes.results.length, 1);

      saveOmdbApiKey('demo-omdb-key-idb-test');
      const omdbRes = await fetchOmdbByImdbId('tt0213338', {
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          headers: {},
          json: async () => ({
            Response: 'True',
            imdbRating: '8.9',
            imdbVotes: '140,000',
            Ratings: [],
          }),
        }),
      });
      assert.equal(omdbRes.ok, true);
      assert.equal(omdbRes.ratings.imdb.value, 8.9);
    } finally {
      globalThis.indexedDB = prevIdb;
    }
  });
});
