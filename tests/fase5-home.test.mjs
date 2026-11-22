import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, it } from 'node:test';

import { clearMemoryApiCacheForTests } from '../src/api/cacheDb.js';
import { resetApiClientStateForTests } from '../src/api/httpClient.js';
import {
  BACKDROP_RETRY_COOLDOWN_MS,
  HERO_QUICK_MINUTES_STEP,
  MAX_FAVORITE_SCENE_CHARS,
  MAX_SESSION_PILLS,
  buildCompactStreakChip,
  buildHomeLocalRails,
  buildHomeSessionPills,
  computeHeroAdvancePlan,
  resolveHeroVisual,
  selectHeroPresentation,
  shouldBackfillHeroBackdrop,
} from '../src/lib/homeEngine.js';
import {
  backfillWorkHeroBackdrop,
  clearCinemaSearchCache,
  fetchOnboardingGenreSuggestions,
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

describe('Fase 5 — Home (Hero 4 estados, Backfill 30d, Pílulas, Trilhos, Descoberta 24h e Layout)', () => {
  beforeEach(() => {
    clearCinemaSearchCache();
    clearMemoryApiCacheForTests();
    resetApiClientStateForTests();
  });

  it('selectHeroPresentation e resolveHeroVisual cobrem os 4 estados do Hero e hierarquia de imagem', () => {
    // (d) loading
    const loadingHero = selectHeroPresentation([], { loading: true });
    assert.equal(loadingHero.state, 'loading');

    // (c) acervo vazio
    const emptyHero = selectHeroPresentation([]);
    assert.equal(emptyHero.state, 'empty');
    assert.equal(emptyHero.work, null);

    // (b) sem obra em andamento -> destaque da fila Quero Ver por maior hype
    const queuedLow = {
      id: 'q1',
      title: 'Filme Calmo',
      status: 'queued',
      workType: 'movie',
      hype: 'low',
      updatedAt: '2026-11-20T10:00:00Z',
    };
    const queuedUrgent = {
      id: 'q2',
      title: 'Filme Prioritário',
      status: 'queued',
      workType: 'movie',
      hype: 'urgent',
      updatedAt: '2026-11-18T10:00:00Z',
    };
    const queuedHero = selectHeroPresentation([queuedLow, queuedUrgent]);
    assert.equal(queuedHero.state, 'queued');
    assert.equal(queuedHero.work.id, 'q2');

    // (a) obra mais recente em playing ou rewatching vence queued
    const olderPlaying = {
      id: 'p1',
      title: 'Série Antiga',
      status: 'playing',
      workType: 'series',
      totalEpisodes: 10,
      currentEpisode: 3,
      updatedAt: '2026-11-19T10:00:00Z',
    };
    const newerRewatch = {
      id: 'p2',
      title: 'Anime Recente',
      status: 'rewatching',
      workType: 'anime',
      totalEpisodes: 24,
      currentEpisode: 8,
      backdropUrl: 'https://s4.anilist.co/banner/p2.jpg',
      coverUrl: 'https://s4.anilist.co/cover/p2.jpg',
      updatedAt: '2026-11-21T12:00:00Z',
    };
    const activeHero = selectHeroPresentation([queuedUrgent, olderPlaying, newerRewatch]);
    assert.equal(activeHero.state, 'active');
    assert.equal(activeHero.work.id, 'p2');

    // Hierarquia visual: backdropUrl > blurred-cover > theme-gradient
    assert.equal(resolveHeroVisual(newerRewatch).mode, 'backdrop');
    assert.equal(
      resolveHeroVisual({ id: 'c1', coverUrl: 'https://cdn.example/c.jpg' }).mode,
      'blurred-cover'
    );
    assert.equal(resolveHeroVisual({ id: 'g1' }).mode, 'theme-gradient');
  });

  it('Regra Extra 2: backfillWorkHeroBackdrop nunca chama OMDb, usa fila máx 2 e memoriza falha por 30 dias', async () => {
    const now = 1_700_000_000_000;
    const movieNoBackdrop = {
      id: 'm1',
      title: 'Blade Runner',
      workType: 'movie',
      tmdbId: 78,
      imdbId: 'tt0083658',
      ids: { tmdb: 78, imdb: 'tt0083658' },
    };
    assert.equal(shouldBackfillHeroBackdrop(movieNoBackdrop, now), true);

    const calledUrls = [];
    const failFetch = async (url) => {
      calledUrls.push(String(url));
      return createJsonResponse({ status_message: 'Not found' }, 404);
    };

    const resFail = await backfillWorkHeroBackdrop(movieNoBackdrop, {
      tmdbApiKey: 'TMDB_TEST_KEY',
      fetchImpl: failFetch,
      nowFn: () => now,
    });
    assert.equal(resFail.attempted, true);
    assert.equal(resFail.backdropUrl, null);
    assert.equal(resFail.checkedAt, now);
    assert.equal(calledUrls.some((u) => u.includes('omdbapi')), false);

    // Após falha memorizada em backdropCheckedAt, fica 30 dias sem repetir busca
    const stamped = { ...movieNoBackdrop, backdropCheckedAt: resFail.checkedAt };
    assert.equal(shouldBackfillHeroBackdrop(stamped, now + 5 * 86400_000), false);
    const skippedRes = await backfillWorkHeroBackdrop(stamped, {
      tmdbApiKey: 'TMDB_TEST_KEY',
      fetchImpl: failFetch,
      nowFn: () => now + 5 * 86400_000,
    });
    assert.equal(skippedRes.attempted, false);
    assert.equal(skippedRes.skippedCooldown, true);
    assert.equal(calledUrls.length, 1);

    // Após 30 dias pode tentar novamente e gravar backdropUrl se encontrado
    const afterCooldown = now + BACKDROP_RETRY_COOLDOWN_MS + 1000;
    assert.equal(shouldBackfillHeroBackdrop(stamped, afterCooldown), true);
    const okRes = await backfillWorkHeroBackdrop(stamped, {
      tmdbApiKey: 'TMDB_TEST_KEY',
      fetchImpl: async (url) => {
        calledUrls.push(String(url));
        return createJsonResponse({
          id: 78,
          backdrop_path: '/blade-backdrop.jpg',
          vote_average: 8.1,
          vote_count: 15000,
        });
      },
      nowFn: () => afterCooldown,
    });
    assert.equal(okRes.attempted, true);
    assert.match(okRes.backdropUrl || '', /w1280\/blade-backdrop\.jpg/);
    assert.equal(calledUrls.some((u) => u.includes('omdbapi')), false);
  });

  it('computeHeroAdvancePlan respeita +1 Ep (confirma ao atingir/passar total) e +20 min sem passar da duração', () => {
    assert.equal(HERO_QUICK_MINUTES_STEP, 20);

    const seriesNearEnd = {
      id: 's1',
      title: 'Minissérie',
      workType: 'series',
      status: 'playing',
      totalSeasons: 1,
      totalEpisodes: 6,
      currentSeason: 1,
      currentEpisode: 5,
    };
    const epPlan = computeHeroAdvancePlan(seriesNearEnd);
    assert.equal(epPlan.kind, 'episode');
    assert.equal(epPlan.requiresCompletionConfirm, true);
    assert.equal(epPlan.passesTotal, false);

    const seriesAtTotal = { ...seriesNearEnd, currentEpisode: 6 };
    const passPlan = computeHeroAdvancePlan(seriesAtTotal);
    assert.equal(passPlan.requiresCompletionConfirm, true);
    assert.equal(passPlan.passesTotal, true);

    // Filme com 90 min (5400s), faltando só 8 min (currentSeconds: 4920): +20 min trava em 5400s!
    const movieNearEnd = {
      id: 'm1',
      title: 'Curta',
      workType: 'movie',
      status: 'playing',
      durationMinutes: 90,
      totalSeconds: 5400,
      currentSeconds: 4920,
    };
    const minPlan = computeHeroAdvancePlan(movieNearEnd);
    assert.equal(minPlan.kind, 'minutes');
    assert.equal(minPlan.nextSeconds, 5400);
    assert.equal(minPlan.addMinutes, 8);
    assert.equal(minPlan.reachesDuration, true);
  });

  it('Pílulas (máx. 12 + ver todas) e trilhos locais omitem vazios, separam sagas >= 2 e excluem legacy-default', () => {
    const manyWorks = Array.from({ length: 15 }, (_, idx) => ({
      id: `w-${idx}`,
      title: `Obra ${idx}`,
      workType: idx % 2 === 0 ? 'series' : 'movie',
      status: idx < 5 ? 'playing' : 'queued',
      totalEpisodes: idx % 2 === 0 ? 12 : null,
      currentEpisode: idx % 2 === 0 ? 2 : 0,
      durationMinutes: idx % 2 === 0 ? null : 110,
      updatedAt: `2026-11-${String(22 - idx).padStart(2, '0')}T12:00:00Z`,
    }));

    const pillPack = buildHomeSessionPills(manyWorks, { maxCount: MAX_SESSION_PILLS });
    assert.equal(MAX_SESSION_PILLS, 12);
    assert.equal(pillPack.pills.length, 12);
    assert.equal(pillPack.totalCount, 15);
    assert.equal(pillPack.hasMore, true);
    assert.equal(pillPack.pills[0].id, 'w-0');

    const heroActive = {
      id: 'hero-top',
      title: 'Duna',
      workType: 'movie',
      status: 'playing',
      updatedAt: '2026-11-22T15:00:00Z',
    };
    const soloSagaWork = {
      id: 'solo',
      title: 'Matrix',
      workType: 'movie',
      status: 'playing',
      rating: 80,
      ratingSource: 'legacy-default',
      belongsToCollection: { id: 999, name: 'Solo' },
      favoriteScene: 'Escolha entre a pílula azul e a vermelha.',
      updatedAt: '2026-11-21T15:00:00Z',
    };
    // Com apenas 1 obra ativa, ela vai só para o Hero e não duplica em Continuar Assistindo
    const singleRails = buildHomeLocalRails({ items: [soloSagaWork] });
    assert.equal(singleRails.continueWatching.length, 0);

    // Com >= 2 obras ativas, a 1ª fica no Hero e a 2ª entra em Continuar Assistindo
    const rails = buildHomeLocalRails({ items: [heroActive, soloSagaWork] });
    assert.equal(rails.continueWatching.length, 1);
    assert.equal(rails.continueWatching[0].id, 'solo');
    assert.equal(rails.continueWatching[0].confirmedRating, null); // legacy-default omitida!
    assert.equal(rails.franchises.length, 0); // saga com 1 obra não entra na Home!
    assert.equal(rails.highlights.length >= 1, true);
    assert.equal(rails.highlights[0].quoteText, 'Escolha entre a pílula azul e a vermelha.');
    assert.equal(MAX_FAVORITE_SCENE_CHARS, 200);
  });

  it('fetchOnboardingGenreSuggestions usa TMDB discover + AniList (cache 24h), exclui acervo e nunca chama OMDb', async () => {
    const profile = {
      viewerFocus: ['Filmes', 'Animes'],
      favoriteGenres: [
        { group: 'filmes', id: 'filmes-ficcao', label: 'Ficção Científica', tmdbGenreId: 878 },
        { group: 'animes', id: 'animes-mecha', label: 'Mecha', kind: 'tag', anilistKey: 'Mecha' },
      ],
    };
    const existing = [
      { id: 'ex1', title: 'Obra Já Catalogada', tmdbId: 555, ids: { tmdb: 555 } },
    ];

    let activeCount = 0;
    let maxActiveCount = 0;
    const calledUrls = [];

    const fetchMock = async (url) => {
      activeCount += 1;
      maxActiveCount = Math.max(maxActiveCount, activeCount);
      calledUrls.push(String(url));
      try {
        await new Promise((r) => setTimeout(r, 15));
        const u = String(url);
        if (u.includes('/discover/movie')) {
          return createJsonResponse({
            results: [
              { id: 555, title: 'Obra Já Catalogada', vote_average: 8.5, vote_count: 5000 },
              { id: 777, title: 'Duna: Parte Dois', original_title: 'Dune: Part Two', release_date: '2024-02-27', poster_path: '/duna.jpg', backdrop_path: '/duna-bg.jpg', vote_average: 8.3, vote_count: 4200 },
            ],
          });
        }
        if (u.includes('graphql.anilist.co')) {
          return createJsonResponse({
            data: {
              Page: {
                media: [
                  {
                    id: 30,
                    idMal: 30,
                    type: 'ANIME',
                    format: 'TV',
                    status: 'FINISHED',
                    episodes: 26,
                    duration: 24,
                    seasonYear: 1995,
                    averageScore: 85,
                    genres: ['Mecha', 'Drama'],
                    bannerImage: 'https://s4.anilist.co/eva-banner.jpg',
                    title: { romaji: 'Neon Genesis Evangelion', english: 'Neon Genesis Evangelion' },
                    coverImage: { large: 'https://s4.anilist.co/eva-cover.jpg' },
                    studios: { nodes: [{ name: 'Gainax' }] },
                  },
                ],
              },
            },
          });
        }
        throw new Error(`Unexpected URL: ${u}`);
      } finally {
        activeCount -= 1;
      }
    };

    const res = await fetchOnboardingGenreSuggestions(profile, existing, {
      tmdbApiKey: 'TMDB_TEST_KEY',
      fetchImpl: fetchMock,
    });
    assert.equal(res.ok, true);
    assert.equal(maxActiveCount <= 2, true);
    assert.equal(calledUrls.some((u) => u.includes('omdbapi')), false);
    assert.equal(res.results.some((r) => r.tmdbId === 555), false); // já no acervo excluído!
    assert.equal(res.results.length, 2);

    // Segunda chamada usa cache de 24h (0 requisições novas)
    const callsBefore = calledUrls.length;
    const resCached = await fetchOnboardingGenreSuggestions(profile, existing, {
      tmdbApiKey: 'TMDB_TEST_KEY',
      fetchImpl: fetchMock,
    });
    assert.equal(resCached.fromCache, true);
    assert.equal(calledUrls.length, callsBefore);
  });

  it('HomeScreen, App e HomeRail atendem R1, R3 (scrim >= 70%), R4 (>= 44px), R7 (Sessão) e safe-area em 360px', () => {
    const homeSrc = fs.readFileSync(path.resolve('src/screens/HomeScreen.jsx'), 'utf8');
    const railSrc = fs.readFileSync(path.resolve('src/components/HomeRail.jsx'), 'utf8');
    const recSrc = fs.readFileSync(path.resolve('src/components/RecommendationsSection.jsx'), 'utf8');
    const appSrc = fs.readFileSync(path.resolve('src/App.jsx'), 'utf8');

    // R1 sem emojis nem símbolos proibidos
    for (const [name, src] of [
      ['HomeScreen.jsx', homeSrc],
      ['HomeRail.jsx', railSrc],
      ['RecommendationsSection.jsx', recSrc],
    ]) {
      assert.equal(/[★✓✕]/u.test(src), false, `Símbolo proibido em ${name}`);
    }

    // Hero estado vazio sem border-dashed + 1 botão "Catalogar Primeira Obra"
    assert.equal(homeSrc.includes('border-dashed'), false);
    assert.match(homeSrc, /Catalogar Primeira Obra/);

    // Scrim >= 70% de opacidade sobre imagem do Hero
    assert.match(homeSrc, /rgba\(10,\s*12,\s*16,\s*0\.7[0-9]/);

    // Alvos >= 44px e pílulas circulares 56px (h-14 w-14)
    assert.match(homeSrc, /h-14 w-14/);
    assert.match(railSrc, /IntersectionObserver/);

    // Sem "Registrar Leitura Hoje" (R7) na Home
    const streakChip = buildCompactStreakChip({ streakCount: 3, loggedToday: false });
    assert.equal(streakChip.ctaLabel, 'Registrar Sessão Hoje');
    assert.equal(/Registrar Leitura Hoje/i.test(homeSrc), false);

    // Convivência de safe-area e 360px no alerta fixo de localStorage + <main> (Regra Extra 3)
    assert.match(appSrc, /env\(safe-area-inset-top\)/);
    assert.match(appSrc, /env\(safe-area-inset-bottom\)/);
    assert.match(appSrc, /data-testid="storage-quota-alert"/);
    assert.match(appSrc, /duration:\s*6000/);
  });
});
