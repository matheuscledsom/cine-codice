import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, it } from 'node:test';

import { clearMemoryApiCacheForTests } from '../src/api/cacheDb.js';
import { resetApiClientStateForTests } from '../src/api/httpClient.js';
import {
  applyCriterionStarChange,
  applyManualStarRating,
  criterionStarsToValue10,
  criterionValue10ToStars,
  formatCriterionValue10,
} from '../src/lib/ratingModel.js';
import {
  DEFAULT_SOURCES_BY_FILTER,
  clearCinemaSearchCache,
  searchCinemaMedia,
} from '../src/services/cinemaApi.js';
import {
  detectCinemaExtraOrSpecial,
  getQuickSuggestionsForDomain,
  hasRealPosterUrl,
  orderCinemaSearchSources,
  prioritizeCinemaSearchCandidates,
} from '../src/services/multiDomainSearchService.js';
import {
  QUICK_GAME_COMPLETION_OPTIONS,
  QUICK_GAME_EDITION_OPTIONS,
  QUICK_GAME_PLATFORM_OPTIONS,
  buildQuickGamePlatformOptions,
  getQuickSheetLeanFields,
  shouldShowSynopsisExpandToggle,
} from '../src/utils/catalogDraftHelpers.js';

const ROOT_DIR = process.cwd();
const readSrc = (rel) => fs.readFileSync(path.join(ROOT_DIR, rel), 'utf8');

function delayedJson(payload, delayMs = 0, signal = null) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      reject(err);
      return;
    }
    const timer = setTimeout(() => {
      resolve({
        ok: true,
        status: 200,
        headers: new Map(),
        async json() {
          return payload;
        },
      });
    }, delayMs);
    signal?.addEventListener?.('abort', () => {
      clearTimeout(timer);
      const err = new Error('Aborted');
      err.name = 'AbortError';
      reject(err);
    });
  });
}

describe('OMNIPRISM v2.7.0 — Fase 1.1: Busca Cinema/Series TMDB-first, zero capas vazias e sinalizacao de extras', () => {
  beforeEach(() => {
    clearCinemaSearchCache();
    clearMemoryApiCacheForTests();
    resetApiClientStateForTests();
  });

  it('prioriza TMDB nas fontes de Cinema/Series e nao emite cartoes placeholder sem capa antes do TMDB responder', async () => {
    assert.equal(DEFAULT_SOURCES_BY_FILTER.all[0], 'tmdb');
    assert.equal(DEFAULT_SOURCES_BY_FILTER.movie[0], 'tmdb');
    assert.equal(DEFAULT_SOURCES_BY_FILTER.series[0], 'tmdb');

    assert.deepEqual(
      orderCinemaSearchSources(['tvmaze', 'wikidata', 'tmdb', 'imdb'], 'series'),
      ['tmdb', 'tvmaze', 'wikidata', 'imdb']
    );
    assert.deepEqual(
      orderCinemaSearchSources(['anilist', 'jikan', 'tmdb'], 'anime'),
      ['anilist', 'jikan', 'tmdb']
    );

    const cinemaSuggestions = getQuickSuggestionsForDomain('cinema');
    const bbSuggestion = cinemaSuggestions.find((s) => s.label === 'Breaking Bad');
    assert.ok(bbSuggestion);
    assert.equal(bbSuggestion.sources[0], 'tmdb');

    const partialFrames = [];
    const mockFetch = (url, opts) => {
      const u = String(url);
      if (u.includes('wikidata.org') && u.includes('wbsearchentities')) {
        return delayedJson(
          { search: [{ id: 'Q1079', label: 'Breaking Bad', description: 'American television series' }] },
          10,
          opts?.signal
        );
      }
      if (u.includes('wikidata.org') && u.includes('wbgetentities')) {
        return delayedJson(
          {
            entities: {
              Q1079: {
                id: 'Q1079',
                labels: { pt: { value: 'Breaking Bad' }, en: { value: 'Breaking Bad' } },
                descriptions: { pt: { value: 'série de televisão americana' } },
                claims: {
                  P31: [{ mainsnak: { datavalue: { value: { id: 'Q5398426' } } } }],
                  P577: [{ mainsnak: { datavalue: { value: { time: '+2008-01-20T00:00:00Z' } } } }],
                },
              },
            },
          },
          10,
          opts?.signal
        );
      }
      if (u.includes('/search/tv') || u.includes('api.themoviedb.org/3/search/tv')) {
        return delayedJson(
          {
            results: [
              {
                id: 1396,
                name: 'Breaking Bad',
                original_name: 'Breaking Bad',
                first_air_date: '2008-01-20',
                poster_path: '/ztkUQFLlC19CCMYHW9o1zWhJRNq.jpg',
                overview: 'Um professor de química descobre ter câncer terminal.',
                vote_average: 8.9,
                vote_count: 14000,
              },
              {
                id: 999901,
                name: 'Breaking Bad: Inside the Episode',
                original_name: 'Breaking Bad: Inside the Episode',
                first_air_date: '2013-08-11',
                poster_path: '/extra-inside.jpg',
                overview: 'Bastidores e entrevistas com o elenco.',
                vote_average: 7.5,
                vote_count: 80,
              },
            ],
          },
          60,
          opts?.signal
        );
      }
      if (u.includes('tvmaze.com')) {
        return delayedJson(
          [
            {
              show: {
                id: 5001,
                name: 'The Making of Breaking Bad',
                premiered: '2013-09-29',
                genres: ['Documentary'],
                image: { medium: 'https://static.tvmaze.com/making-of.jpg' },
              },
            },
          ],
          110,
          opts?.signal
        );
      }
      return delayedJson({ results: [] }, 20, opts?.signal);
    };

    const res = await searchCinemaMedia('Breaking Bad', {
      filter: 'series',
      sources: ['wikidata', 'tvmaze', 'tmdb'],
      tmdbApiKey: 'test-key-local',
      isDev: true,
      skipCache: true,
      fetchImpl: mockFetch,
      onPartialResults: (payload) => partialFrames.push(payload),
    });

    // Primeiro frame parcial ja deve chegar COM poster real do TMDB (sem flash de placeholder da Wikidata)
    assert.ok(partialFrames.length >= 1, 'Deve emitir ao menos um frame parcial');
    const firstFrame = partialFrames[0];
    assert.ok(firstFrame.results.length >= 1);
    assert.equal(
      firstFrame.results.every((item) => hasRealPosterUrl(item)),
      true,
      'Primeiro frame nao pode conter cartoes placeholder sem capa'
    );
    assert.equal(firstFrame.results[0].title, 'Breaking Bad');
    assert.match(firstFrame.results[0].coverUrl, /image\.tmdb\.org/);

    // Resultado final: obra principal primeiro, extras sinalizados abaixo
    assert.equal(res.results[0].title, 'Breaking Bad');
    assert.equal(res.results[0].isExtraOrSpecial, false);

    const inside = res.results.find((r) => /Inside the Episode/i.test(r.title));
    assert.ok(inside);
    assert.equal(inside.isExtraOrSpecial, true);
    assert.equal(inside.extraBadgeLabel, 'Extra');

    const makingOf = res.results.find((r) => /Making of/i.test(r.title));
    assert.ok(makingOf);
    assert.equal(makingOf.isExtraOrSpecial, true);
    assert.equal(makingOf.extraBadgeLabel, 'Extra · Bastidores');
  });

  it('classifica extras/especiais sem falso positivo em filmes e series principais', () => {
    assert.equal(detectCinemaExtraOrSpecial({ title: 'Breaking Bad' }).isExtra, false);
    assert.equal(detectCinemaExtraOrSpecial({ title: 'Blade Runner 2049' }).isExtra, false);
    assert.equal(detectCinemaExtraOrSpecial({ title: 'Special Ops: Lioness' }).isExtra, false);
    assert.equal(detectCinemaExtraOrSpecial({ title: 'A Viagem de Chihiro' }).isExtra, false);

    assert.equal(
      detectCinemaExtraOrSpecial({ title: 'House of the Dragon: Inside the Episode' }).isExtra,
      true
    );
    assert.equal(
      detectCinemaExtraOrSpecial({ title: 'The Making of Blade Runner' }).label,
      'Extra · Bastidores'
    );
    assert.equal(
      detectCinemaExtraOrSpecial({ title: 'Behind the Scenes: Dune' }).isExtra,
      true
    );
    assert.equal(
      detectCinemaExtraOrSpecial({ title: 'Friends: The Reunion Special' }).label,
      'Especial'
    );
    assert.equal(
      detectCinemaExtraOrSpecial({ title: 'Cowboy Bebop: Mish-Mash Blues', animeFormat: 'Especial' })
        .label,
      'Especial'
    );

    const ranked = prioritizeCinemaSearchCandidates(
      [
        { id: 'wd-1', title: 'Duna', coverUrl: null, sourceBadge: 'Wikidata' },
        {
          id: 'tmdb-extra',
          title: 'Duna: Making of',
          coverUrl: 'https://image.tmdb.org/t/p/w500/extra.jpg',
          sourceBadge: 'TMDB',
        },
        {
          id: 'tmdb-main',
          title: 'Duna',
          coverUrl: 'https://image.tmdb.org/t/p/w500/duna.jpg',
          sourceBadge: 'TMDB',
        },
      ],
      'Duna',
      { filter: 'movie' }
    );
    assert.equal(ranked[0].id, 'tmdb-main');
    assert.equal(ranked[1].id, 'tmdb-extra');
    assert.equal(ranked[1].isExtraOrSpecial, true);
    assert.equal(ranked[2].id, 'wd-1');

    const onlyPoster = prioritizeCinemaSearchCandidates(
      [{ id: 'wd-1', title: 'Duna', coverUrl: null }],
      'Duna',
      { onlyWithPoster: true }
    );
    assert.equal(onlyPoster.length, 0);
  });
});

describe('OMNIPRISM v2.7.0 — Fase 1.2: Folha Rapida de Catalogacao compacta (Games + Sinopse Ler mais)', () => {
  it('ativa chips compactos de Games em Jogando e Zerado, destacando plataforma original + opcoes rapidas', () => {
    const playing = getQuickSheetLeanFields('games', 'playing');
    assert.equal(playing.showQuickGameMetaChips, true);
    assert.equal(playing.askGamePlatform, true);
    assert.equal(playing.askGameEdition, true);

    const completed = getQuickSheetLeanFields('games', 'completed');
    assert.equal(completed.showQuickGameMetaChips, true);
    assert.equal(completed.askGameCompletionType, true);
    assert.equal(completed.askStarRating, true);

    const queued = getQuickSheetLeanFields('games', 'queued');
    assert.equal(queued.showQuickGameMetaChips, false);

    const platforms = buildQuickGamePlatformOptions({
      originalPlatforms: ['PS2'],
      platforms: ['PS2', 'PS3', 'PS4'],
    });
    assert.equal(platforms[0].label, 'PS2');
    assert.equal(platforms[0].isOriginal, true);

    const labels = platforms.map((p) => p.label);
    for (const quickPlat of QUICK_GAME_PLATFORM_OPTIONS) {
      assert.equal(labels.includes(quickPlat), true, `Deve conter opcao rapida ${quickPlat}`);
    }
    assert.equal(new Set(labels).size, labels.length, 'Nao pode duplicar plataformas');

    assert.deepEqual([...QUICK_GAME_EDITION_OPTIONS], ['Jogo', 'Remake', 'Remaster', 'Port', 'DLC']);
    assert.deepEqual(
      QUICK_GAME_COMPLETION_OPTIONS.map((o) => o.label),
      ['História Principal', 'Zerado', '100% / Platina', 'Multiplayer']
    );

    assert.equal(shouldShowSynopsisExpandToggle('Sinopse curta.'), false);
    assert.equal(
      shouldShowSynopsisExpandToggle(
        'Uma sinopse longa com detalhes suficientes sobre o mundo da obra, seus protagonistas e conflitos principais para ultrapassar facilmente duas linhas em telas mobile.'
      ),
      true
    );
  });

  it('wiring de AddScreen exibe badge discreto de Extra, chips compactos de Games e sinopse 2 linhas com Ler mais', () => {
    const addSrc = readSrc('src/screens/AddScreen.jsx');
    assert.match(addSrc, /data-testid="cinema-extra-badge"/);
    assert.match(addSrc, /data-testid="quick-sheet-synopsis-toggle"/);
    assert.match(addSrc, /Ler mais/);
    assert.match(addSrc, /Ler menos/);
    assert.match(addSrc, /data-testid="quick-sheet-game-chips"/);
    assert.match(addSrc, /data-testid="quick-sheet-game-edition"/);
    assert.match(addSrc, /data-testid="quick-sheet-game-completion"/);
    assert.match(addSrc, /buildQuickGamePlatformOptions/);
    assert.match(addSrc, /hasRealPosterUrl/);
  });
});

describe('OMNIPRISM v2.7.0 — Fase 1.3: Criterios em Mini-Estrelas (0.5 a 5.0) no StarRatingPicker', () => {
  it('converte com precisao mini-estrelas (0.5 a 5.0) <-> nota 0-10 mantendo 1 estrela = 20% e override manual', () => {
    assert.equal(criterionValue10ToStars(null), null);
    assert.equal(criterionValue10ToStars(0), 0);
    assert.equal(criterionValue10ToStars(1), 0.5);
    assert.equal(criterionValue10ToStars(5), 2.5);
    assert.equal(criterionValue10ToStars(8), 4.0);
    assert.equal(criterionValue10ToStars(9), 4.5);
    assert.equal(criterionValue10ToStars(10), 5.0);

    assert.equal(criterionStarsToValue10(null), null);
    assert.equal(criterionStarsToValue10(0.5), 1);
    assert.equal(criterionStarsToValue10(1.0), 2);
    assert.equal(criterionStarsToValue10(2.5), 5);
    assert.equal(criterionStarsToValue10(4.0), 8);
    assert.equal(criterionStarsToValue10(4.5), 9);
    assert.equal(criterionStarsToValue10(5.0), 10);

    assert.equal(formatCriterionValue10(null), '—');
    assert.equal(formatCriterionValue10(8), '8/10');
    assert.equal(formatCriterionValue10(7.5), '7.5/10');
    assert.equal(formatCriterionValue10(10), '10/10');

    // 1 criterio em 4.5 estrelas (= 9/10) -> media 4.5 estrelas (90/100); criterios em branco nao viram zero
    let state = applyCriterionStarChange({}, { domain: 'cinema', key: 'roteiro', stars: 4.5 });
    assert.equal(state.reviewCriteria.roteiro, 9);
    assert.equal(state.stars, 4.5);
    assert.equal(state.rating, 90);
    assert.equal(state.criteria.filledCount, 1);

    // Segundo criterio em 3.5 estrelas (= 7/10) -> media 8/10 = 4.0 estrelas (80/100)
    state = applyCriterionStarChange(state, { domain: 'cinema', key: 'direcao', stars: 3.5 });
    assert.equal(state.reviewCriteria.direcao, 7);
    assert.equal(state.criteria.average10, 8);
    assert.equal(state.stars, 4.0);
    assert.equal(state.rating, 80);

    // Override manual nas estrelas principais preservado ao ajustar mini-estrela de criterio
    state = applyManualStarRating(state, 5.0, { domain: 'cinema' });
    assert.equal(state.ratingManualOverride, true);
    state = applyCriterionStarChange(state, { domain: 'cinema', key: 'atuacoes', stars: 3.0 });
    assert.equal(state.stars, 5.0);
    assert.equal(state.rating, 100);
    assert.equal(state.criteria.filledCount, 3);

    // Limpar um criterio via stars: null remove apenas aquele criterio
    const cleared = applyCriterionStarChange(state, {
      domain: 'cinema',
      key: 'atuacoes',
      stars: null,
    });
    assert.equal(cleared.reviewCriteria.atuacoes, null);
    assert.equal(cleared.criteria.filledCount, 2);
  });

  it('substitui sliders range por mini-estrelas compactas com equivalente 0-10 em StarRatingPicker.jsx', () => {
    const pickerSrc = readSrc('src/components/StarRatingPicker.jsx');
    assert.equal(/type=["']range["']/i.test(pickerSrc), false, 'Sliders type="range" devem ser removidos');
    assert.match(pickerSrc, /data-testid="criteria-mini-stars-panel"/);
    assert.match(pickerSrc, /criterion-stars-/);
    assert.match(pickerSrc, /criterion-val10-/);
    assert.match(pickerSrc, /applyCriterionStarChange/);
    assert.match(pickerSrc, /formatCriterionValue10/);
  });
});
