import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { formatCatalogCardFormatBadge } from '../src/utils/backlogHelpers.js';
import {
  formatWorkStructureBadge,
  normalizeBrazilStreamingProviders,
} from '../src/services/cinemaApi.js';
import {
  buildDeterministicFranchiseOrUniverseModel,
  filterStrictlyCanonicalRelations,
} from '../src/services/franchiseService.js';

test('Fase 4 (v1.3.0): Filmes usam "Franquia & Sequências" com progresso exato (4/5 filmes · 80% concluído)', () => {
  const movieCatalog = [
    {
      id: 'm-1',
      title: 'John Wick',
      workType: 'movie',
      status: 'completed',
      rating: 90,
      ratingSource: 'manual',
      releaseYear: 2014,
      belongsToCollection: { id: 404609, name: 'John Wick Collection' },
    },
    {
      id: 'm-2',
      title: 'John Wick: Um Novo Dia Para Matar',
      workType: 'movie',
      status: 'completed',
      rating: 88,
      ratingSource: 'manual',
      releaseYear: 2017,
      belongsToCollection: { id: 404609, name: 'John Wick Collection' },
    },
    {
      id: 'm-3',
      title: 'John Wick 3: Parabellum',
      workType: 'movie',
      status: 'completed',
      rating: 91,
      ratingSource: 'manual',
      releaseYear: 2019,
      belongsToCollection: { id: 404609, name: 'John Wick Collection' },
    },
    {
      id: 'm-4',
      title: 'John Wick 4: Baba Yaga',
      workType: 'movie',
      status: 'completed',
      rating: 95,
      ratingSource: 'manual',
      releaseYear: 2023,
      belongsToCollection: { id: 404609, name: 'John Wick Collection' },
    },
  ];

  const remoteParts = [
    ...movieCatalog.map((m, i) => ({
      tmdbId: 200 + i,
      title: m.title,
      releaseYear: m.releaseYear,
    })),
    {
      tmdbId: 205,
      title: 'Ballerina',
      releaseYear: 2025,
    },
  ];

  const model = buildDeterministicFranchiseOrUniverseModel(
    movieCatalog[0],
    movieCatalog,
    remoteParts
  );

  assert.equal(model.mode, 'movie-franchise');
  assert.equal(model.sectionTitle, 'Franquia & Sequências');
  assert.equal(model.progressHeader, '4/5 filmes · 80% concluído');
  assert.equal(model.entries.length, 5);
  assert.equal(model.entries[0].catalogState, 'completed');
  assert.equal(model.entries[0].userRating, 90);
  assert.equal(model.entries[4].catalogState, 'uncataloged');
  assert.equal(model.entries[4].catalogStateLabel, 'Não catalogado');
});

test('Fase 4 (v1.3.0): Séries e Animes usam "Obras do Mesmo Universo" filtrando ruídos CHARACTER/OTHER e agrupando em Série Principal, Filmes e OVAs / Especiais', () => {
  const rawRelations = [
    { relationType: 'SEQUEL', title: 'Attack on Titan Season 2', format: 'TV', releaseYear: 2017 },
    { relationType: 'SEQUEL', title: 'Attack on Titan Season 3', format: 'TV', releaseYear: 2018 },
    { relationType: 'SIDE_STORY', title: 'Attack on Titan: No Regrets', format: 'OVA', releaseYear: 2014 },
    { relationType: 'SPIN_OFF', title: 'Attack on Titan: Chronicle', format: 'MOVIE', releaseYear: 2020 },
    { relationType: 'PARENT', title: 'Attack on Titan: Lost Girls', format: 'OVA', releaseYear: 2017 },
    { relationType: 'CHARACTER', title: 'Chibi Crossover Commercial', format: 'SPECIAL', releaseYear: 2015 },
    { relationType: 'OTHER', title: 'Random Merch Promo', format: 'ONA', releaseYear: 2016 },
  ];

  const filtered = filterStrictlyCanonicalRelations(rawRelations);
  assert.equal(filtered.length, 5);
  assert.equal(
    filtered.some((r) => r.relationType === 'CHARACTER' || r.relationType === 'OTHER'),
    false
  );

  const aotMain = {
    id: 'aot-1',
    title: 'Attack on Titan',
    workType: 'anime',
    status: 'completed',
    releaseYear: 2013,
    franchiseRelations: rawRelations,
  };

  const catalog = [
    aotMain,
    { id: 'aot-2', title: 'Attack on Titan Season 2', workType: 'anime', status: 'completed', releaseYear: 2017 },
    { id: 'aot-3', title: 'Attack on Titan Season 3', workType: 'anime', status: 'completed', releaseYear: 2018 },
    { id: 'aot-ova1', title: 'Attack on Titan: No Regrets', workType: 'anime', animeFormat: 'OVA', status: 'completed', releaseYear: 2014 },
    { id: 'aot-mov1', title: 'Attack on Titan: Chronicle', workType: 'movie', status: 'completed', releaseYear: 2020 },
  ];

  const model = buildDeterministicFranchiseOrUniverseModel(aotMain, catalog);
  assert.equal(model.mode, 'series-universe');
  assert.equal(model.sectionTitle, 'Obras do Mesmo Universo');
  assert.equal(model.progressHeader, '5/6 obras · 83% do universo');
  assert.equal(model.groups.length, 3);
  assert.equal(model.groups[0].label, 'Série Principal');
  assert.equal(model.groups[1].label, 'Filmes');
  assert.equal(model.groups[2].label, 'OVAs / Especiais');
});

test('Fase 4 (v1.3.0): Onde Assistir no Brasil (Streaming BR) e Badge de Estrutura antes de salvar', () => {
  const providers = normalizeBrazilStreamingProviders(
    {
      flatrate: [
        { provider_name: 'Netflix' },
        { provider_name: 'Amazon Prime Video' },
        { provider_name: 'HBO Max' },
      ],
    },
    [
      { site: 'Crunchyroll', type: 'STREAMING' },
      { site: 'Disney Plus', type: 'STREAMING' },
      { site: 'Globoplay', type: 'STREAMING' },
      { site: 'Twitter', type: 'SOCIAL' },
    ]
  );

  assert.deepEqual(providers, [
    'Netflix',
    'Prime Video',
    'Max',
    'Crunchyroll',
    'Disney+',
    'Globoplay',
  ]);

  assert.equal(
    formatWorkStructureBadge({
      workType: 'series',
      totalSeasons: 15,
      totalEpisodes: 327,
      showStatus: 'Ended',
    }),
    '15 Temporadas · 327 Episódios'
  );

  assert.equal(
    formatWorkStructureBadge({
      workType: 'anime',
      totalSeasons: 1,
      totalEpisodes: 1122,
      animeStatus: 'RELEASING',
    }),
    '1.122+ Episódios · Em exibição'
  );
});

test('Fase 4 (v1.3.0): Distinção Visual no Catálogo (Filme · 2h 28m, Série · T1 E12, Anime · DUB/LEG)', () => {
  const movieBadge = formatCatalogCardFormatBadge({
    workType: 'movie',
    durationMinutes: 148,
  });
  assert.equal(movieBadge.label, 'Filme · 2h 28m');

  const seriesBadge = formatCatalogCardFormatBadge({
    workType: 'series',
    currentSeason: 1,
    currentEpisode: 12,
  });
  assert.equal(seriesBadge.label, 'Série · T1 E12');

  const animeDub = formatCatalogCardFormatBadge({
    workType: 'anime',
    audioFormat: 'Dublado PT-BR',
  });
  assert.equal(animeDub.label, 'Anime · DUB');

  const animeLeg = formatCatalogCardFormatBadge({
    workType: 'anime',
    audioFormat: 'Legendado',
  });
  assert.equal(animeLeg.label, 'Anime · LEG');

  const addSrc = fs.readFileSync(path.resolve('src/screens/AddScreen.jsx'), 'utf8');
  const detailSrc = fs.readFileSync(
    path.resolve('src/components/WorkDetailPage.jsx'),
    'utf8'
  );
  assert.ok(addSrc.includes('getDisplayGenres'));
  assert.ok(detailSrc.includes('TechnicalAtmosphereSection'));
});
