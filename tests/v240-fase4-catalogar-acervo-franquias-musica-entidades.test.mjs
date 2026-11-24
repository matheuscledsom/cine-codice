import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  extractWorkEntities,
  findCatalogWorksForEntity,
} from '../src/lib/entityHelpers.js';
import {
  FRANCHISE_TIER_OPTIONS,
  computeFranchiseScopeProgress,
  inferFranchiseTier,
} from '../src/lib/franchiseTier.js';
import {
  MUSIC_SCOPE_OPTIONS,
  buildMusicHierarchy,
  classifyMusicReleaseScope,
} from '../src/lib/musicHierarchy.js';
import { buildUnifiedFranchiseModel } from '../src/services/franchiseService.js';
import {
  computeAlbumTrackRatingPatch,
  findCatalogDuplicate,
  getQuickSheetLeanFields,
  makeAlbumTrackKey,
} from '../src/utils/catalogDraftHelpers.js';

const ROOT_DIR = path.resolve(process.cwd());
const readSrc = (rel) => fs.readFileSync(path.join(ROOT_DIR, rel), 'utf8');

describe('OMNIPRISM v2.4.0 — Fase 4.1: Catalogar search-first, folha enxuta e duplicatas', () => {
  it('mantem folha rapida enxuta sem pre-selecao, fila sem perguntas e campos condicionais por dominio', () => {
    const unselected = getQuickSheetLeanFields('cinema', '');
    assert.equal(unselected.statusSelected, false);
    assert.equal(unselected.askGamePlatform, false);
    assert.equal(unselected.askCurrentPage, false);
    assert.equal(unselected.askStarRating, false);
    assert.equal(unselected.showConfirmFullPages, false);

    // Fila ("Quero...") nao pergunta nada em nenhum dominio
    for (const dom of ['cinema', 'reading', 'games', 'music']) {
      const queued = getQuickSheetLeanFields(dom, 'queued');
      assert.equal(queued.statusSelected, true);
      assert.equal(queued.askGamePlatform, false);
      assert.equal(queued.askCurrentPage, false);
      assert.equal(queued.askStarRating, false);
      assert.equal(queued.showConfirmFullPages, false);
    }

    // Games em andamento pergunta plataforma
    const gamesPlaying = getQuickSheetLeanFields('games', 'playing');
    assert.equal(gamesPlaying.askGamePlatform, true);
    assert.equal(gamesPlaying.askCurrentPage, false);
    assert.equal(gamesPlaying.askStarRating, false);

    // Leitura em andamento ("Lendo") pergunta pagina atual
    const readingPlaying = getQuickSheetLeanFields('reading', 'playing');
    assert.equal(readingPlaying.askCurrentPage, true);
    assert.equal(readingPlaying.askGamePlatform, false);
    assert.equal(readingPlaying.askStarRating, false);

    // Concluido em qualquer dominio exibe seletor de 5 estrelas
    for (const dom of ['cinema', 'reading', 'games', 'music']) {
      const done = getQuickSheetLeanFields(dom, 'completed');
      assert.equal(done.askStarRating, true);
      assert.equal(done.askGamePlatform, false);
      assert.equal(done.askCurrentPage, false);
      assert.equal(done.showConfirmFullPages, dom === 'reading');
    }
  });

  it('detecta duplicatas por external_ids ou titulo+ano sem falso positivo entre Original e Remake ou faixa e album', () => {
    const existing = [
      {
        id: 'w-cinema-1',
        domain: 'cinema',
        workType: 'movie',
        title: 'Duna',
        releaseYear: 2021,
        tmdbId: 438631,
        imdbId: 'tt1160419',
      },
      {
        id: 'w-game-orig',
        domain: 'games',
        workType: 'game',
        title: 'Shadow of the Colossus',
        releaseYear: 2005,
        editionType: 'Original',
      },
      {
        id: 'w-music-album',
        domain: 'music',
        workType: 'album',
        title: 'Random Access Memories',
        releaseYear: 2013,
      },
    ];

    const dupByExternalId = findCatalogDuplicate(
      { title: 'Dune: Part One', releaseYear: 2021, tmdbId: 438631 },
      existing
    );
    assert.ok(dupByExternalId);
    assert.equal(dupByExternalId.reason, 'external_id');
    assert.equal(dupByExternalId.match.id, 'w-cinema-1');

    const dupByTitleYear = findCatalogDuplicate(
      { domain: 'cinema', workType: 'movie', title: 'duna', releaseYear: 2021 },
      existing
    );
    assert.ok(dupByTitleYear);
    assert.equal(dupByTitleYear.reason, 'title_year');

    const remakeNotDup = findCatalogDuplicate(
      {
        domain: 'games',
        workType: 'game',
        title: 'Shadow of the Colossus',
        releaseYear: 2018,
        editionType: 'Remake',
      },
      existing
    );
    assert.equal(remakeNotDup, null);

    const trackVsAlbumNotDup = findCatalogDuplicate(
      {
        domain: 'music',
        workType: 'track',
        title: 'Random Access Memories',
        releaseYear: 2013,
      },
      existing
    );
    assert.equal(trackVsAlbumNotDup, null);
  });

  it('wiring de AddScreen tem foco automatico, grade de capas, cadastro manual discreto, alerta de duplicata e StarRatingPicker', () => {
    const addSrc = readSrc('src/screens/AddScreen.jsx');
    assert.match(addSrc, /searchInputRef/);
    assert.match(addSrc, /data-testid="search-results-cover-grid"/);
    assert.match(addSrc, /data-testid="manual-catalog-link"/);
    assert.match(addSrc, /data-testid="duplicate-warning-banner"/);
    assert.match(addSrc, /getQuickSheetLeanFields/);
    assert.match(addSrc, /findCatalogDuplicate/);
    assert.match(addSrc, /Onde você está jogando\?/);
    assert.match(addSrc, /Outra plataforma/);
    assert.match(addSrc, /<StarRatingPicker/);
  });
});

describe('OMNIPRISM v2.4.0 — Fase 4.2: Franquias & Escopos (Linha Principal vs Universo Completo)', () => {
  it('classifica mainline, spinoff e companion e separa 3/5 livros principais de 4/9 no universo completo', () => {
    assert.deepEqual(
      FRANCHISE_TIER_OPTIONS.map((o) => o.id),
      ['mainline', 'spinoff', 'companion']
    );

    const saga = [
      { id: 'b1', domain: 'reading', title: 'O Nome do Vento', status: 'completed', franchiseName: 'Crônica do Matador do Rei' },
      { id: 'b2', domain: 'reading', title: 'O Temor do Sábio', status: 'completed', franchiseName: 'Crônica do Matador do Rei' },
      { id: 'b3', domain: 'reading', title: 'As Portas de Pedra', status: 'completed', franchiseName: 'Crônica do Matador do Rei' },
      { id: 'b4', domain: 'reading', title: 'Volume 4', status: 'queued', franchiseName: 'Crônica do Matador do Rei' },
      { id: 'b5', domain: 'reading', title: 'Volume 5', status: 'queued', franchiseName: 'Crônica do Matador do Rei' },
      {
        id: 'sp1',
        domain: 'reading',
        title: 'A Música do Silêncio',
        status: 'completed',
        franchiseName: 'Crônica do Matador do Rei',
        progress_data: { franchiseTier: 'spinoff' },
      },
      {
        id: 'sp2',
        domain: 'reading',
        title: 'Spin-off Contos do Arco',
        status: 'queued',
        franchiseName: 'Crônica do Matador do Rei',
      },
      {
        id: 'c1',
        domain: 'reading',
        title: 'Entrevista Especial com o Autor',
        status: 'queued',
        franchiseName: 'Crônica do Matador do Rei',
      },
      {
        id: 'c2',
        domain: 'reading',
        title: 'Guia Ilustrado do Universo',
        status: 'queued',
        franchiseName: 'Crônica do Matador do Rei',
      },
    ];

    assert.equal(inferFranchiseTier(saga[0]), 'mainline');
    assert.equal(inferFranchiseTier(saga[5]), 'spinoff');
    assert.equal(inferFranchiseTier(saga[6]), 'spinoff');
    assert.equal(inferFranchiseTier(saga[7]), 'companion');
    assert.equal(inferFranchiseTier(saga[8]), 'companion');

    const progress = computeFranchiseScopeProgress(saga, 'reading');
    assert.equal(progress.mainline.completed, 3);
    assert.equal(progress.mainline.total, 5);
    assert.equal(progress.mainline.pct, 60);
    assert.equal(progress.mainline.label, '3/5 livros');

    assert.equal(progress.universe.completed, 4);
    assert.equal(progress.universe.total, 9);
    assert.equal(progress.universe.label, '4/9');
  });

  it('buildUnifiedFranchiseModel suporta Livros, Games e Cinema com scopeProgress transparente', () => {
    const gamesCatalog = [
      { id: 'g1', domain: 'games', workType: 'game', title: 'The Witcher 1', releaseYear: 2007, status: 'completed', franchiseName: 'The Witcher' },
      { id: 'g2', domain: 'games', workType: 'game', title: 'The Witcher 3: Wild Hunt', releaseYear: 2015, status: 'completed', franchiseName: 'The Witcher' },
      { id: 'g3', domain: 'games', workType: 'dlc', title: 'The Witcher 3: Blood and Wine', releaseYear: 2016, status: 'queued', franchiseName: 'The Witcher' },
      { id: 'g4', domain: 'games', workType: 'game', title: 'The Witcher Artbook & Guide', releaseYear: 2015, status: 'queued', franchiseName: 'The Witcher' },
    ];

    const model = buildUnifiedFranchiseModel(gamesCatalog[1], gamesCatalog);
    assert.ok(model);
    assert.equal(model.sagaName, 'The Witcher');
    assert.equal(model.scopeProgress.mainline.completed, 2);
    assert.equal(model.scopeProgress.mainline.total, 2);
    assert.equal(model.scopeProgress.universe.completed, 2);
    assert.equal(model.scopeProgress.universe.total, 4);

    const panelSrc = readSrc('src/components/FranchiseRadarPanel.jsx');
    assert.match(panelSrc, /Linha Principal/);
    assert.match(panelSrc, /Universo Completo/);
    assert.match(panelSrc, /buildUnifiedFranchiseModel/);
  });
});

describe('OMNIPRISM v2.4.0 — Fase 4.3: Hierarquia Musical SOUND', () => {
  it('agrupa Banda -> Discografia -> Albuns/EPs/Singles -> Faixas separando escopos e notas por faixa', () => {
    assert.deepEqual(
      MUSIC_SCOPE_OPTIONS.map((o) => o.id),
      ['all', 'studio', 'eps_singles', 'live_compilations']
    );

    const musicCatalog = [
      {
        id: 'm1',
        domain: 'music',
        workType: 'album',
        title: 'OK Computer',
        creator: 'Radiohead',
        releaseYear: 1997,
        status: 'completed',
        rating: 100,
        tracks: [
          { number: 1, title: 'Airbag', durationMs: 284000 },
          { number: 2, title: 'Paranoid Android', durationMs: 383000 },
        ],
        trackRatings: {
          [makeAlbumTrackKey({ number: 1, title: 'Airbag' }, 0)]: 9,
          [makeAlbumTrackKey({ number: 2, title: 'Paranoid Android' }, 1)]: 10,
        },
      },
      {
        id: 'm2',
        domain: 'music',
        workType: 'ep_single',
        title: 'Airbag / How Am I Driving?',
        creator: 'Radiohead',
        releaseYear: 1998,
        status: 'queued',
      },
      {
        id: 'm3',
        domain: 'music',
        workType: 'live_show',
        title: 'I Might Be Wrong: Live Recordings',
        creator: 'Radiohead',
        releaseYear: 2001,
        status: 'completed',
      },
    ];

    assert.equal(classifyMusicReleaseScope(musicCatalog[0]), 'studio');
    assert.equal(classifyMusicReleaseScope(musicCatalog[1]), 'eps_singles');
    assert.equal(classifyMusicReleaseScope(musicCatalog[2]), 'live_compilations');

    const full = buildMusicHierarchy(musicCatalog, { scope: 'all' });
    assert.equal(full.artists.length, 1);
    const rh = full.artists[0];
    assert.equal(rh.artistName, 'Radiohead');
    assert.equal(rh.activeProgress.completed, 2);
    assert.equal(rh.activeProgress.total, 3);
    assert.equal(rh.releases[0].tracks.length, 2);
    assert.equal(rh.releases[0].tracks[1].rating10, 10);
    assert.equal(rh.releases[0].averageTrackRating10, 9.5);

    // Avaliacao individual por faixa gera patch + snapshot de Desfazer
    const trackPatch = computeAlbumTrackRatingPatch(
      musicCatalog[0],
      musicCatalog[0].tracks[0],
      0,
      10
    );
    assert.equal(trackPatch.patch.trackRatings[makeAlbumTrackKey(musicCatalog[0].tracks[0], 0)], 10);
    assert.equal(
      trackPatch.undoSnapshot.trackRatings[makeAlbumTrackKey(musicCatalog[0].tracks[0], 0)],
      9
    );

    const studioOnly = buildMusicHierarchy(musicCatalog, { scope: 'studio' });
    assert.equal(studioOnly.artists[0].releases.length, 1);
    assert.equal(studioOnly.artists[0].activeProgress.completed, 1);
    assert.equal(studioOnly.artists[0].activeProgress.total, 1);

    const listSrc = readSrc('src/screens/ListScreen.jsx');
    assert.match(listSrc, /MusicDiscographyView/);
    assert.match(listSrc, /id:\s*'discography'/);
  });
});

describe('OMNIPRISM v2.4.0 — Fase 4.4 & 4.5: Pagina de Entidade e Acervo Limpo com Desfazer em Lote', () => {
  it('extrai entidades clicaveis (Autor, Diretor, Elenco, Estudio, Banda) e localiza obras locais', () => {
    const cinemaWork = {
      id: 'c1',
      domain: 'cinema',
      workType: 'movie',
      title: 'A Chegada',
      director: 'Denis Villeneuve',
      studio: 'Paramount Pictures',
      cast: 'Amy Adams, Jeremy Renner',
      releaseYear: 2016,
      status: 'completed',
      rating: 90,
    };
    const bookWork = {
      id: 'r1',
      domain: 'reading',
      workType: 'book',
      title: 'A Mão Esquerda da Escuridão',
      creator: 'Ursula K. Le Guin',
      studio: 'Aleph',
      releaseYear: 1969,
      status: 'completed',
      rating: 100,
    };
    const musicWork = {
      id: 's1',
      domain: 'music',
      workType: 'album',
      title: 'In Rainbows',
      creator: 'Radiohead',
      releaseYear: 2007,
      status: 'completed',
      rating: 95,
    };

    const cinemaEntities = extractWorkEntities(cinemaWork);
    assert.ok(cinemaEntities.some((e) => e.role === 'director' && e.name === 'Denis Villeneuve'));
    assert.ok(cinemaEntities.some((e) => e.role === 'studio' && e.name === 'Paramount Pictures'));
    assert.ok(cinemaEntities.some((e) => e.role === 'actor' && e.name === 'Amy Adams'));

    const readingEntities = extractWorkEntities(bookWork);
    assert.ok(readingEntities.some((e) => e.role === 'author' && e.name === 'Ursula K. Le Guin'));

    const musicEntities = extractWorkEntities(musicWork);
    assert.ok(musicEntities.some((e) => e.role === 'artist' && e.name === 'Radiohead'));

    const found = findCatalogWorksForEntity([cinemaWork, bookWork, musicWork], {
      name: 'Denis Villeneuve',
      role: 'director',
    });
    assert.equal(found.works.length, 1);
    assert.equal(found.stats.completed, 1);
    assert.equal(found.stats.averageStars, 4.5);

    const detailSrc = readSrc('src/components/WorkDetailPage.jsx');
    assert.match(detailSrc, /data-testid="work-clickable-entities"/);
    assert.match(detailSrc, /<EntitySheetModal/);

    const entityModalSrc = readSrc('src/components/EntitySheetModal.jsx');
    assert.match(entityModalSrc, /AbortController/);
    assert.match(entityModalSrc, /findCatalogWorksForEntity/);
  });

  it('mantem Acervo com folha unica Filtrar, StarRatingDisplay na lista e Desfazer nas operacoes em lote', () => {
    const listSrc = readSrc('src/screens/ListScreen.jsx');
    assert.match(listSrc, /data-testid="list-filter-button"/);
    assert.match(listSrc, /title="Filtrar"/);
    assert.match(listSrc, /<StarRatingDisplay/);

    // Todas as 3 operacoes em lote (status, colecao, exclusao) oferecem Desfazer
    const undoMatches = listSrc.match(/label:\s*'Desfazer'/g) || [];
    assert.ok(
      undoMatches.length >= 3,
      `Esperado Desfazer em status, colecao e exclusao em lote; encontrado ${undoMatches.length}`
    );
  });
});
