import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import { catalogItems } from '../src/data/mockData.js';
import {
  buildHomeLocalRails,
  formatHonestHeroProgressLabel,
  hasKnownWorkTotal,
  selectHeroPresentation,
} from '../src/lib/homeEngine.js';
import { resolveCuratedSuggestions } from '../src/services/cinemaApi.js';
import {
  clearRelationalMemoryForTests,
  getRelationalApiCache,
} from '../src/services/relationalDb.js';

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

describe('FASE 3 (v1.2.0) — Pôsteres Reais nas Sugestões & Home Sem Duplicação', () => {
  beforeEach(() => {
    clearRelationalMemoryForTests();
  });

  it('Home sem duplicação: quando há apenas 1 obra em andamento, ela fica exclusivamente no Hero e não duplica em Continuar Assistindo', () => {
    const supernatural = {
      id: 'spn-1',
      title: 'Sobrenatural',
      originalTitle: 'Supernatural',
      workType: 'series',
      status: 'playing',
      currentSeason: 1,
      currentEpisode: 2,
      totalSeasons: 15,
      totalEpisodes: null,
      coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/445/1114097.jpg',
      updatedAt: '2026-11-22T15:00:00Z',
    };

    const hero = selectHeroPresentation([supernatural]);
    assert.equal(hero.state, 'active');
    assert.equal(hero.work.id, 'spn-1');

    const railsSingle = buildHomeLocalRails({ items: [supernatural] });
    assert.equal(
      railsSingle.continueWatching.length,
      0,
      'Trilho Continuar Assistindo deve ficar vazio quando a única obra ativa já está no Hero'
    );

    const secondActive = {
      id: 'dark-2',
      title: 'Dark',
      workType: 'series',
      status: 'playing',
      currentSeason: 2,
      currentEpisode: 4,
      totalSeasons: 3,
      totalEpisodes: 26,
      coverUrl: 'https://static.tvmaze.com/uploads/images/original_untouched/260/651233.jpg',
      updatedAt: '2026-11-21T15:00:00Z',
    };

    const railsMulti = buildHomeLocalRails({ items: [supernatural, secondActive] });
    assert.equal(railsMulti.continueWatching.length, 1);
    assert.equal(railsMulti.continueWatching[0].id, 'dark-2');
    assert.equal(
      railsMulti.continueWatching[0].work.coverUrl,
      'https://static.tvmaze.com/uploads/images/original_untouched/260/651233.jpg'
    );
  });

  it('Progresso honesto no Hero: oculta 0% falso quando série/anime não tem totalEpisodes conhecido e exibe T{S} · Ep. {E} assistidos', () => {
    const ongoingSeries = {
      id: 'spn-1',
      title: 'Sobrenatural',
      workType: 'series',
      status: 'playing',
      currentSeason: 1,
      currentEpisode: 2,
      totalSeasons: 15,
      totalEpisodes: null,
    };

    assert.equal(hasKnownWorkTotal(ongoingSeries), false);
    assert.equal(formatHonestHeroProgressLabel(ongoingSeries), 'T1 · Ep. 2 assistidos');

    const hero = selectHeroPresentation([ongoingSeries]);
    assert.equal(hero.hasKnownTotal, false);
    assert.equal(hero.progressPct, null);
    assert.equal(hero.progressLabel, 'T1 · Ep. 2 assistidos');

    const knownTotalSeries = {
      ...ongoingSeries,
      totalEpisodes: 20,
      currentEpisode: 5,
    };
    const heroKnown = selectHeroPresentation([knownTotalSeries]);
    assert.equal(heroKnown.hasKnownTotal, true);
    assert.equal(heroKnown.progressPct, 25);
  });

  it('resolveCuratedSuggestions busca e cacheia no IndexedDB (api_cache) pôsteres 2:3 reais para anime, série e filme', async () => {
    const candidates = [
      {
        id: 'test-anime-bebop',
        title: 'Cowboy Bebop',
        workType: 'anime',
        anilistId: 1,
      },
      {
        id: 'test-series-severance',
        title: 'Ruptura',
        originalTitle: 'Severance',
        workType: 'series',
        tvmazeId: 44933,
      },
      {
        id: 'test-movie-br2049',
        title: 'Blade Runner 2049',
        workType: 'movie',
        imdbId: 'tt1856101',
      },
    ];

    const mockFetch = async (url) => {
      const u = String(url);
      if (u.includes('graphql.anilist.co')) {
        return createJsonResponse({
          data: {
            Media: {
              id: 1,
              idMal: 1,
              episodes: 26,
              bannerImage: 'https://s4.anilist.co/bebop-banner.jpg',
              description: 'Caçadores de recompensas espaciais.',
              coverImage: {
                extraLarge: 'https://s4.anilist.co/bebop-poster-2x3.jpg',
              },
            },
          },
        });
      }
      if (u.includes('api.tvmaze.com/shows/44933')) {
        return createJsonResponse({
          id: 44933,
          name: 'Severance',
          summary: '<p>Memórias divididas no trabalho.</p>',
          image: {
            original: 'https://static.tvmaze.com/severance-poster-2x3.jpg',
          },
        });
      }
      if (u.includes('v3.sg.media-imdb.com/suggestion')) {
        return createJsonResponse({
          d: [
            {
              id: 'tt1856101',
              l: 'Blade Runner 2049',
              i: {
                imageUrl: 'https://m.media-amazon.com/images/M/br2049-poster-2x3.jpg',
              },
            },
          ],
        });
      }
      return createJsonResponse({}, 404);
    };

    const resolved = await resolveCuratedSuggestions(candidates, {
      fetchImpl: mockFetch,
      forceNetwork: true,
    });

    assert.equal(resolved.length, 3);
    assert.equal(resolved[0].coverUrl, 'https://s4.anilist.co/bebop-poster-2x3.jpg');
    assert.equal(resolved[1].coverUrl, 'https://static.tvmaze.com/severance-poster-2x3.jpg');
    assert.equal(resolved[2].coverUrl, 'https://m.media-amazon.com/images/M/br2049-poster-2x3.jpg');

    // Verifica que todas as 3 capas foram gravadas na store api_cache do IndexedDB relacional
    const cache0 = await getRelationalApiCache('suggestion:v120:test-anime-bebop');
    const cache1 = await getRelationalApiCache('suggestion:v120:test-series-severance');
    const cache2 = await getRelationalApiCache('suggestion:v120:test-movie-br2049');
    assert.equal(cache0.hit, true);
    assert.equal(cache0.data.coverUrl, 'https://s4.anilist.co/bebop-poster-2x3.jpg');
    assert.equal(cache1.hit, true);
    assert.equal(cache2.hit, true);
  });

  it('catalogItems curados possuem coverUrl HTTPS real, IDs canônicos e sinopse, e CoverImage usa skeleton antes do fallback tipográfico', () => {
    assert.equal(catalogItems.length >= 8, true);
    for (const item of catalogItems) {
      assert.match(item.coverUrl || '', /^https:\/\//);
      assert.equal(Boolean(item.synopsis && item.synopsis.length > 20), true);
    }

    const coverImgSrc = fs.readFileSync(
      path.resolve('src/components/CoverImage.jsx'),
      'utf8'
    );
    assert.match(coverImgSrc, /hasPendingExternalSource/);
    assert.match(coverImgSrc, /animate-pulse/);
  });
});
