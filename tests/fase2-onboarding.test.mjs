import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  GENRE_GROUPS_META,
  extractFavoriteGenreLabels,
  getOrderedGenreGroups,
  getStructuredGenresByGroup,
  migrateFavoriteGenresToObjects,
  toggleStructuredGenre,
  toggleViewerFocusInList,
} from '../src/lib/genreCatalog.js';
import { migrateProfileData } from '../src/lib/migrations.js';
import { buildSpectatorTasteProfile } from '../src/services/recommendationEngine.js';

describe('Fase 2 — Onboarding Multi-Foco, Grupos de Gêneros & Migração', () => {
  it('permite seleção múltipla de focos com estado vazio bloqueante no onboarding e mín. 1 no drawer', () => {
    let focuses = ['Cinéfilo Curador'];
    focuses = toggleViewerFocusInList(focuses, 'Curador de Animes', { allowEmpty: true });
    assert.deepEqual(focuses, ['Cinéfilo Curador', 'Curador de Animes']);

    focuses = toggleViewerFocusInList(focuses, 'Cinéfilo Curador', { allowEmpty: true });
    assert.deepEqual(focuses, ['Curador de Animes']);

    // Desmarcar o último no onboarding deixa vazio (para bloquear botão Avançar)
    focuses = toggleViewerFocusInList(focuses, 'Curador de Animes', { allowEmpty: true });
    assert.deepEqual(focuses, []);

    // No drawer de configurações (allowEmpty: false), o último foco é mantido
    const lockedFocus = toggleViewerFocusInList(['Maratonista de Séries'], 'Maratonista de Séries', {
      allowEmpty: false,
    });
    assert.deepEqual(lockedFocus, ['Maratonista de Séries']);
  });

  it('ordena os 3 grupos fixos colocando os focos escolhidos primeiro', () => {
    assert.deepEqual(
      GENRE_GROUPS_META.map((g) => g.id),
      ['cinema', 'series', 'animes']
    );

    assert.deepEqual(
      getOrderedGenreGroups(['Curador de Animes']).map((g) => g.id),
      ['animes', 'cinema', 'series']
    );

    assert.deepEqual(
      getOrderedGenreGroups(['Maratonista de Séries', 'Curador de Animes']).map((g) => g.id),
      ['series', 'animes', 'cinema']
    );

    assert.deepEqual(
      getOrderedGenreGroups(['Espectador Casual']).map((g) => g.id),
      ['cinema', 'series', 'animes']
    );
  });

  it('separa gêneros de anime (genre) de tags exclusivas de anime (tag: Shonen, Seinen, Isekai, Mecha)', () => {
    const cinema = getStructuredGenresByGroup('cinema');
    const series = getStructuredGenresByGroup('series');
    const animes = getStructuredGenresByGroup('animes');

    assert.equal(cinema.tags.length, 0);
    assert.equal(series.tags.length, 0);
    assert.ok(cinema.genres.every((g) => g.group === 'cinema' && Number.isFinite(g.tmdbGenreId)));
    assert.ok(series.genres.every((g) => g.group === 'series' && Number.isFinite(g.tmdbGenreId)));

    assert.ok(animes.genres.some((g) => g.label === 'Slice of Life' && g.kind === 'genre' && g.anilistKey));
    const tagLabels = animes.tags.map((t) => t.label);
    assert.deepEqual(tagLabels, ['Shonen', 'Seinen', 'Isekai', 'Mecha']);
    assert.ok(animes.tags.every((t) => t.group === 'animes' && t.kind === 'tag' && t.anilistKey));
  });

  it('alterna objetos de gênero de grupos distintos independentemente e preserva "outros" migrados', () => {
    const migrated = migrateFavoriteGenresToObjects(['Drama', 'Policial Nórdico']);
    assert.equal(migrated.length, 2);
    assert.equal(migrated[0].id, 'cinema-drama');
    assert.equal(migrated[1].group, 'outros');
    assert.equal(migrated[1].label, 'Policial Nórdico');

    const seriesDrama = getStructuredGenresByGroup('series').genres.find((g) => g.label === 'Drama');
    const withSeriesDrama = toggleStructuredGenre(migrated, seriesDrama);
    assert.equal(withSeriesDrama.length, 3);
    assert.ok(withSeriesDrama.some((g) => g.id === 'cinema-drama'));
    assert.ok(withSeriesDrama.some((g) => g.id === 'series-drama'));
    assert.ok(withSeriesDrama.some((g) => g.id === 'outros-policial-nordico'));

    // Remover cinema-drama preserva series-drama e outros
    const withoutCinemaDrama = toggleStructuredGenre(withSeriesDrama, migrated[0]);
    assert.equal(withoutCinemaDrama.length, 2);
    assert.deepEqual(extractFavoriteGenreLabels(withoutCinemaDrama), ['Policial Nórdico', 'Drama']);
  });

  it('preserva onboardingCompleted, annualGoal e preferredFormat salvos sem reexibir onboarding', () => {
    const existing = migrateProfileData({
      displayName: 'Ana',
      readerFocus: 'Cinéfilo Curador',
      annualGoal: 50,
      preferredFormat: 'Cinema',
      favoriteGenres: ['Noir', 'Cineclube Europeu'],
      onboardingCompleted: true,
    });

    assert.equal(existing.onboardingCompleted, true);
    assert.equal(existing.annualGoal, 50);
    assert.equal(existing.preferredFormat, 'Cinema');
    assert.deepEqual(existing.viewerFocus, ['Cinéfilo Curador']);
    assert.equal(existing.readerFocus, 'Cinéfilo Curador');
    assert.deepEqual(
      existing.favoriteGenres.map((g) => [g.group, g.label]),
      [
        ['cinema', 'Noir'],
        ['outros', 'Cineclube Europeu'],
      ]
    );
  });

  it('consumidores (recommendationEngine) lêem todo o array viewerFocus e objetos de favoriteGenres', () => {
    const animeSecondFocus = {
      viewerFocus: ['Cinéfilo Curador', 'Curador de Animes'],
      readerFocus: 'Cinéfilo Curador',
      favoriteGenres: [
        { group: 'cinema', id: 'cinema-drama', label: 'Drama', tmdbGenreId: 18 },
        { group: 'animes', kind: 'tag', id: 'animes-seinen', label: 'Seinen', anilistKey: 'Seinen' },
      ],
    };

    const taste = buildSpectatorTasteProfile([], animeSecondFocus);
    assert.deepEqual(taste.viewerFocus, ['Cinéfilo Curador', 'Curador de Animes']);
    assert.equal(taste.readerFocus, 'cinefilo curador');
    assert.equal(taste.allowsAnime, true);
    assert.ok(taste.onboardingGenres.has('seinen'));
  });

  it('remove controles de Meta Anual e Onde você mais assiste da UI (Onboarding, Drawer e Home)', () => {
    const onboardingSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/OnboardingFlow.jsx'),
      'utf8'
    );
    const drawerSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/ProfileSettingsDrawer.jsx'),
      'utf8'
    );
    const homeSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/screens/HomeScreen.jsx'),
      'utf8'
    );

    assert.equal(/Meta anual|annualGoal|Onde você mais assiste|preferredFormat/.test(onboardingSrc), false);
    assert.equal(/Meta anual|annualGoal|Onde você mais assiste|preferredFormat/.test(drawerSrc), false);
    assert.equal(/annualGoal|annualGoalTitle|annualGoalPct/.test(homeSrc), false);

    assert.match(onboardingSrc, /Qual é o seu foco\?/);
    assert.match(onboardingSrc, /aria-pressed=/);
    assert.match(onboardingSrc, /getOrderedGenreGroups/);
    assert.match(drawerSrc, /viewerFocus/);
  });
});
