import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  DOMAIN_VOCABULARY,
  OMNIPRISM_DOMAINS,
  domainConfig,
  getDomainVocabulary,
  getStatusLabelForDomain,
  getStatusListForDomain,
} from '../src/config/domainConfig.js';
import {
  buildHomeInProgressStrip,
  buildHomeNextInQueue,
  buildHomeRecentlyCompleted,
} from '../src/lib/homeEngine.js';
import {
  computeDomainBreakdownMetrics,
  resolveProfileHeroBackdrop,
  resolveTop4Favorites,
} from '../src/lib/profileMetrics.js';
import {
  detectGameEditionType,
  getDisplayGenres,
  getDisplaySynopsis,
  isWikidataShortDescription,
  searchGamesWorks,
} from '../src/services/multiDomainSearchService.js';
import { mapCatalogRowToLocalWork, mapLocalWorkToCatalogRow } from '../src/services/omniSyncService.js';
import {
  buildQuickCatalogDraftWithStatus,
  computeAlbumTrackRatingPatch,
  computeDomainQuickActionPatch,
  getQuickCatalogConditionalFields,
  makeAlbumTrackKey,
} from '../src/utils/catalogDraftHelpers.js';

const readSrc = (rel) => fs.readFileSync(path.resolve(rel), 'utf8');

describe('OmniPrism v2.3.0 — Vocabulário por Domínio, Catalogação Rápida, Home & Perfil', () => {
  it('1. Dicionário de vocabulário por domínio: status corretos e zero rótulos de cinema fora de cinema', () => {
    const expectedStatuses = {
      cinema: {
        queued: 'Quero Ver',
        playing: 'Assistindo',
        rewatching: 'Reassistindo',
        paused: 'Pausado',
        completed: 'Concluído',
        dropped: 'Abandonado',
      },
      reading: {
        queued: 'Quero Ler',
        playing: 'Lendo',
        rewatching: 'Relendo',
        paused: 'Pausado',
        completed: 'Lido',
        dropped: 'Abandonado',
      },
      games: {
        queued: 'Quero Jogar',
        playing: 'Jogando',
        rewatching: 'Rejogando',
        paused: 'Pausado',
        completed: 'Zerado',
        dropped: 'Abandonado',
      },
      music: {
        queued: 'Quero Ouvir',
        playing: 'Ouvindo',
        rewatching: 'Reouvindo',
        paused: 'Pausado',
        completed: 'Ouvido',
        dropped: 'Abandonado',
      },
    };

    const internalIds = ['playing', 'rewatching', 'queued', 'paused', 'completed', 'dropped'];

    for (const [domain, expected] of Object.entries(expectedStatuses)) {
      const list = getStatusListForDomain(domain);
      assert.deepEqual(
        list.map((s) => s.id),
        internalIds,
        `IDs internos de status devem permanecer intactos para ${domain}`
      );
      for (const id of internalIds) {
        assert.equal(getStatusLabelForDomain(id, domain), expected[id]);
      }
    }

    // Nenhum rótulo exclusivo de cinema fora do domínio cinema
    const cinemaOnlyTerms = [
      'Quero Ver',
      'Assistindo',
      'Reassistindo',
      'Formato Audiovisual',
      'Buscar filme',
      'Cinéfilo',
    ];
    for (const nonCinema of ['reading', 'games', 'music']) {
      const vocab = getDomainVocabulary(nonCinema);
      const serialized = JSON.stringify(vocab);
      for (const term of cinemaOnlyTerms) {
        assert.equal(
          serialized.includes(term),
          false,
          `Domínio "${nonCinema}" não deve conter o termo de cinema "${term}"`
        );
      }
      assert.equal(vocab.workTypeLabel, 'Tipo');
    }

    // "Formato Audiovisual" existe apenas em cinema
    assert.equal(DOMAIN_VOCABULARY.cinema.workTypeLabel, 'Formato Audiovisual');

    // Abreviações curtas nas abas (Cinema, Livros, Games, Música)
    assert.deepEqual(
      OMNIPRISM_DOMAINS.map((d) => d.tabLabel),
      ['Cinema', 'Livros', 'Games', 'Música']
    );
  });

  it('2. Campos condicionais por status e ausência de preenchimento automático de páginas ao marcar Lido', () => {
    // Leitura: Lendo -> página atual; Lido -> nota + data de término + opt-in páginas
    const readingPlaying = getQuickCatalogConditionalFields('reading', 'playing');
    assert.equal(readingPlaying.showCurrentPage, true);
    assert.equal(readingPlaying.showRating, false);
    assert.equal(readingPlaying.showCompletedDate, false);

    const readingDone = getQuickCatalogConditionalFields('reading', 'completed');
    assert.equal(readingDone.showCurrentPage, false);
    assert.equal(readingDone.showRating, true);
    assert.equal(readingDone.showCompletedDate, true);
    assert.equal(readingDone.showConfirmFullPages, true);

    // Games: Jogando -> horas; Zerado -> nota + tipo de conclusão
    const gamesPlaying = getQuickCatalogConditionalFields('games', 'playing');
    assert.equal(gamesPlaying.showHours, true);
    assert.equal(gamesPlaying.showCompletionType, false);

    const gamesDone = getQuickCatalogConditionalFields('games', 'completed');
    assert.equal(gamesDone.showRating, true);
    assert.equal(gamesDone.showCompletionType, true);

    // Não preenche pagesRead = totalPages automaticamente ao mudar status para completed
    const bookDraft = {
      domain: 'reading',
      title: 'Duna',
      status: 'playing',
      pagesRead: 120,
      totalPages: 680,
    };
    const markedCompleted = buildQuickCatalogDraftWithStatus(bookDraft, 'completed');
    assert.equal(markedCompleted.status, 'completed');
    assert.equal(markedCompleted.pagesRead, 120);

    // Só preenche pagesRead = totalPages se o usuário confirmar explicitamente
    const confirmedCompleted = buildQuickCatalogDraftWithStatus(bookDraft, 'completed', {
      confirmFillTotalPages: true,
    });
    assert.equal(confirmedCompleted.pagesRead, 680);

    // Garante que useBacklog.js também não auto-preenche pagesRead = totalPages
    const backlogSrc = readSrc('src/hooks/useBacklog.js');
    assert.equal(
      /isCompleted\s*&&\s*totalPages\s*>\s*0\s*\?\s*totalPages/.test(backlogSrc),
      false,
      'useBacklog.js não deve preencher pagesRead = totalPages automaticamente'
    );
    assert.equal(
      /next\.status === 'completed'\s*&&\s*Number\(next\.totalPages\)\s*>\s*0\s*&&\s*!next\.pagesRead/.test(
        backlogSrc
      ),
      false,
      'applyStatusTransitionDefaults não deve auto-preencher pagesRead'
    );
  });

  it('3. Filtros de gêneros (máx 3, sem idioma estrangeiro em título PT) e sinopse (sem descrição curta Wikidata)', () => {
    const ptBook = {
      title: 'A Revolução dos Bichos',
      originalTitle: 'Animal Farm',
      genres: [
        'Ficção',
        'Sátira',
        'Literatura clássica',
        'Distopia',
        'Science fiction',
        'Political satire',
      ],
      synopsis:
        'A classic allegorical novella about farm animals who rebel against their human farmer in England.',
    };

    const shownGenres = getDisplayGenres(ptBook, { max: 3 });
    assert.equal(shownGenres.length, 3);
    assert.deepEqual(shownGenres, ['Ficção', 'Sátira', 'Literatura clássica']);
    // Dados brutos originais permanecem intactos
    assert.equal(ptBook.genres.length, 6);

    // Sinopse em inglês descartada na exibição quando título está em português (mas mantida no objeto)
    assert.equal(getDisplaySynopsis(ptBook), '');
    assert.ok(ptBook.synopsis.length > 20);

    // Descrições curtas da Wikidata ("videojogo de 2005") nunca são exibidas como sinopse
    assert.equal(isWikidataShortDescription('videojogo de 2005'), true);
    assert.equal(isWikidataShortDescription('2005 video game'), true);
    assert.equal(isWikidataShortDescription('filme de 2010'), true);
    assert.equal(
      getDisplaySynopsis({
        title: 'Shadow of the Colossus',
        synopsis: 'videojogo de 2005',
      }),
      ''
    );

    // Sinopse real em português é exibida normalmente
    const validPt = getDisplaySynopsis({
      title: 'Grande Sertão: Veredas',
      synopsis:
        'Romance brasileiro narrado por Riobaldo sobre suas travessias pelo sertão mineiro e os dilemas da existência.',
    });
    assert.ok(validPt.includes('Riobaldo'));
  });

  it('4. Interações rápidas por domínio (+10 págs, +1 cap, +30 min, +1 h, +1 audição, nota por faixa) todas com Desfazer', () => {
    const book = {
      id: 'b-1',
      domain: 'reading',
      title: 'O Hobbit',
      status: 'playing',
      pagesRead: 40,
      totalPages: 320,
      chaptersRead: 2,
    };
    const p10 = computeDomainQuickActionPatch(book, 'reading_pages');
    assert.equal(p10.patch.pagesRead, 50);
    assert.equal(p10.undoSnapshot.pagesRead, 40);

    const c1 = computeDomainQuickActionPatch(book, 'reading_chapter');
    assert.equal(c1.patch.chaptersRead, 3);
    assert.equal(c1.undoSnapshot.chaptersRead, 2);

    const game = {
      id: 'g-1',
      domain: 'games',
      title: 'Shadow of the Colossus',
      status: 'playing',
      hoursPlayed: 4,
    };
    const g30 = computeDomainQuickActionPatch(game, 'games_30m');
    assert.equal(g30.patch.hoursPlayed, 4.5);
    assert.equal(g30.undoSnapshot.hoursPlayed, 4);

    const g1h = computeDomainQuickActionPatch(game, 'games_1h');
    assert.equal(g1h.patch.hoursPlayed, 5);
    assert.equal(g1h.undoSnapshot.hoursPlayed, 4);

    const album = {
      id: 'm-1',
      domain: 'music',
      workType: 'album',
      title: 'Metallica',
      status: 'playing',
      listenCount: 3,
      tracks: [
        { number: 1, title: 'Enter Sandman' },
        { number: 2, title: 'Sad But True' },
      ],
      trackRatings: {},
    };
    const mListen = computeDomainQuickActionPatch(album, 'music_listen');
    assert.equal(mListen.patch.listenCount, 4);
    assert.equal(mListen.undoSnapshot.listenCount, 3);

    const trackKey = makeAlbumTrackKey(album.tracks[1], 1);
    const rated = computeAlbumTrackRatingPatch(album, album.tracks[1], 1, 10);
    assert.equal(rated.patch.trackRatings[trackKey], 10);
    assert.deepEqual(rated.undoSnapshot.trackRatings, {});

    // Persistência de trackRatings no payload de sync do Supabase (progress_data JSONB sem mudar schema)
    const row = mapLocalWorkToCatalogRow(
      { ...album, ...rated.patch },
      'user-test-1'
    );
    assert.equal(row.progress_data.track_ratings[trackKey], 10);
    const restored = mapCatalogRowToLocalWork(row);
    assert.equal(restored.trackRatings[trackKey], 10);
  });

  it('5. Home cross-domain ("Em andamento", "Próximos da fila", "Concluídos recentemente") e remoção do bloco duplicado', () => {
    const items = [
      {
        id: 'c1',
        domain: 'cinema',
        workType: 'series',
        title: 'Dark',
        status: 'playing',
        currentSeason: 1,
        currentEpisode: 3,
        totalEpisodes: 26,
        updatedAt: '2026-11-23T12:00:00Z',
      },
      {
        id: 'r1',
        domain: 'reading',
        workType: 'book',
        title: 'Duna',
        status: 'playing',
        pagesRead: 100,
        totalPages: 500,
        updatedAt: '2026-11-23T13:00:00Z',
      },
      {
        id: 'g1',
        domain: 'games',
        workType: 'game',
        title: 'Hades',
        status: 'playing',
        hoursPlayed: 12,
        updatedAt: '2026-11-23T11:00:00Z',
      },
      {
        id: 'm1',
        domain: 'music',
        workType: 'album',
        title: 'Master of Puppets',
        status: 'playing',
        listenCount: 5,
        updatedAt: '2026-11-23T10:00:00Z',
      },
      { id: 'cq1', domain: 'cinema', title: 'Arrival', status: 'queued' },
      { id: 'cq2', domain: 'cinema', title: 'Interstellar', status: 'queued' },
      { id: 'rq1', domain: 'reading', title: 'Fundação', status: 'queued' },
      { id: 'gq1', domain: 'games', title: 'Hollow Knight', status: 'queued' },
      { id: 'mq1', domain: 'music', title: 'Ride the Lightning', status: 'queued' },
      { id: 'd1', domain: 'cinema', title: 'D1', status: 'completed', completedDate: '2026-11-01' },
      { id: 'd2', domain: 'reading', title: 'D2', status: 'completed', completedDate: '2026-11-02' },
      { id: 'd3', domain: 'games', title: 'D3', status: 'completed', completedDate: '2026-11-03' },
      { id: 'd4', domain: 'music', title: 'D4', status: 'completed', completedDate: '2026-11-04' },
      { id: 'd5', domain: 'cinema', title: 'D5', status: 'completed', completedDate: '2026-11-05' },
      { id: 'd6', domain: 'reading', title: 'D6', status: 'completed', completedDate: '2026-11-06' },
    ];

    const stripAll = buildHomeInProgressStrip(items, { domainFilter: 'all' });
    assert.equal(stripAll.length, 4);
    assert.deepEqual(
      stripAll.find((e) => e.domain === 'reading').quickActions.map((a) => a.label),
      ['+10 págs', '+1 cap']
    );
    assert.deepEqual(
      stripAll.find((e) => e.domain === 'games').quickActions.map((a) => a.label),
      ['+30 min', '+1 h']
    );
    assert.deepEqual(
      stripAll.find((e) => e.domain === 'music').quickActions.map((a) => a.label),
      ['+1 audição']
    );

    const stripGames = buildHomeInProgressStrip(items, { domainFilter: 'games' });
    assert.equal(stripGames.length, 1);
    assert.equal(stripGames[0].work.id, 'g1');

    // Próximos da fila: 1 sugestão por domínio em modo 'all'
    const nextQueue = buildHomeNextInQueue(items, { domainFilter: 'all' });
    assert.equal(nextQueue.length, 4);
    assert.deepEqual(
      nextQueue.map((q) => q.domain),
      ['cinema', 'reading', 'games', 'music']
    );

    // Concluídos recentemente: últimos 5 de qualquer domínio
    const recentDone = buildHomeRecentlyCompleted(items, { domainFilter: 'all', limit: 5 });
    assert.equal(recentDone.length, 5);
    assert.equal(recentDone[0].work.id, 'd6');
    assert.equal(recentDone[4].work.id, 'd2');

    // HomeScreen.jsx removeu bloco duplicado, Sessão de Cinéfilo, streak e Temas & Aparência
    const homeSrc = readSrc('src/screens/HomeScreen.jsx');
    assert.equal(/Sessão de Cinéfilo/i.test(homeSrc), false);
    assert.equal(/dias seguidos/i.test(homeSrc), false);
    assert.equal(/Temas &amp; Aparência|Temas & Aparência/i.test(homeSrc), false);
    const rouletteMatches = homeSrc.match(/setRouletteOpen\(true\)/g) || [];
    assert.equal(
      rouletteMatches.length,
      1,
      'Botão de sortear da fila deve aparecer apenas UMA vez na Home'
    );
  });

  it('6. Perfil neutro ("Meu arquivo"), Temas & Aparência movido para o Perfil, banner não preso a cinema e Favoritos por domínio', () => {
    assert.equal(domainConfig.ui.profile.displayName, 'Meu arquivo');
    assert.equal(/Cinéfilo/i.test(domainConfig.ui.profile.displayName), false);

    const profileSrc = readSrc('src/screens/ProfileScreen.jsx');
    assert.match(profileSrc, /Temas &amp; Aparência/);
    assert.match(profileSrc, /Meu arquivo/);
    assert.equal(/Cinéfilo/.test(profileSrc), false);

    // Banner dinâmico aceita coverUrl de livro/game/álbum no domínio ativo
    const items = [
      {
        id: 'b-active',
        domain: 'reading',
        title: 'Memórias Póstumas',
        status: 'playing',
        coverUrl: 'https://covers.openlibrary.org/b/id/123-L.jpg',
        favoriteRank: 1,
      },
      {
        id: 'g-fav',
        domain: 'games',
        title: 'Shadow of the Colossus',
        status: 'completed',
        favoriteRank: 1,
      },
    ];
    const bookBanner = resolveProfileHeroBackdrop(items, 'reading');
    assert.equal(bookBanner.workId, 'b-active');
    assert.equal(bookBanner.statusLabel, 'Lendo');
    assert.equal(bookBanner.isCoverFallback, true);

    // Sem item ativo em música -> fallback para gradiente do tema (null)
    assert.equal(resolveProfileHeroBackdrop(items, 'music'), null);

    // Top 4 isolado por domínio
    const readingFavs = resolveTop4Favorites(items, 'reading');
    const gamesFavs = resolveTop4Favorites(items, 'games');
    assert.equal(readingFavs[0].work?.id, 'b-active');
    assert.equal(gamesFavs[0].work?.id, 'g-fav');
    assert.equal(resolveTop4Favorites(items, 'music')[0].work, null);

    // Resumo dos 4 domínios retorna total e concluídas para cada domínio
    const breakdown = computeDomainBreakdownMetrics(items);
    assert.equal(breakdown.length, 4);
    assert.equal(breakdown.find((d) => d.domainId === 'games')?.completedWorks, 1);
    assert.equal(breakdown.find((d) => d.domainId === 'reading')?.totalWorks, 1);
  });

  it('7. Correções pontuais: Shadow of the Colossus (2018) = Remake, ListScreen sem 3 fileiras empilhadas e Build só em Mais detalhes', async () => {
    // Regra de obra derivada da Wikidata -> Remake (e não Remaster), mantendo Remaster se fonte disser explicitamente
    assert.equal(
      detectGameEditionType({
        title: 'Shadow of the Colossus',
        description: 'jogo eletrônico de 2018',
        isDerivativeWork: true,
      }),
      'Remake'
    );
    assert.equal(
      detectGameEditionType({
        title: 'The Last of Us Remastered',
        description: 'remaster de 2014',
        isDerivativeWork: true,
      }),
      'Remaster'
    );

    // Simula resposta Wikidata real com P4969 ligando Shadow of the Colossus (2005) -> (2018)
    const mockFetch = async (url) => {
      const str = String(url);
      if (str.includes('wbsearchentities')) {
        return {
          ok: true,
          json: async () => ({
            search: [
              { id: 'Q846542', label: 'Shadow of the Colossus', description: 'videojogo de 2005' },
              { id: 'Q30325335', label: 'Shadow of the Colossus', description: 'videojogo de 2018' },
            ],
          }),
        };
      }
      if (str.includes('wbgetentities')) {
        return {
          ok: true,
          json: async () => ({
            entities: {
              Q846542: {
                id: 'Q846542',
                labels: { pt: { value: 'Shadow of the Colossus' } },
                descriptions: { pt: { value: 'videojogo de 2005' } },
                claims: {
                  P31: [{ mainsnak: { datavalue: { value: { id: 'Q7889' } } } }],
                  P577: [{ mainsnak: { datavalue: { value: { time: '+2005-10-18T00:00:00Z' } } } }],
                  P400: [{ mainsnak: { datavalue: { value: { id: 'Q10680' } } } }],
                  P4969: [{ mainsnak: { datavalue: { value: { id: 'Q30325335' } } } }],
                },
              },
              Q30325335: {
                id: 'Q30325335',
                labels: { pt: { value: 'Shadow of the Colossus' } },
                descriptions: { pt: { value: 'videojogo de 2018' } },
                claims: {
                  P31: [{ mainsnak: { datavalue: { value: { id: 'Q7889' } } } }],
                  P577: [{ mainsnak: { datavalue: { value: { time: '+2018-02-06T00:00:00Z' } } } }],
                  P400: [{ mainsnak: { datavalue: { value: { id: 'Q5014725' } } } }],
                  P144: [{ mainsnak: { datavalue: { value: { id: 'Q846542' } } } }],
                },
              },
            },
          }),
        };
      }
      return { ok: true, json: async () => [] };
    };

    const res = await searchGamesWorks('Shadow of the Colossus', {
      fetchImpl: mockFetch,
      timeoutMs: 3000,
    });
    const remake2018 = res.results.find((r) => r.releaseYear === 2018);
    assert.ok(remake2018, 'Deve retornar entrada de 2018');
    assert.equal(remake2018.editionType, 'Remake');

    // ListScreen.jsx: sem a fileira intermediária de formato, usa vocabulário do domínio e os 4 botões têm title + aria-label
    const listSrc = readSrc('src/screens/ListScreen.jsx');
    assert.equal(listSrc.includes('aria-label="Filtrar catálogo por formato"'), false);
    assert.equal(listSrc.includes('Buscar filme, diretor, anime, saga'), false);
    assert.match(listSrc, /getStatusListForDomain\(selectedDomain\)/);
    assert.match(listSrc, /title=\{selectionMode \?/);
    assert.match(listSrc, /aria-label=\{listVocab\.rouletteTitle\}/);

    // Campo "Build / Personagem / Time" só aparece dentro de "Mais detalhes" na ficha (nunca na folha rápida do AddScreen nem no WorkCard)
    const addSrc = readSrc('src/screens/AddScreen.jsx');
    const cardSrc = readSrc('src/components/WorkCard.jsx');
    const detailSrc = readSrc('src/components/WorkDetailPage.jsx');
    assert.equal(addSrc.includes('Build / Personagem / Time'), false);
    assert.equal(cardSrc.includes('buildOrCharacter'), false);
    assert.match(detailSrc, /\{moreDetailsOpen && \([\s\S]*Build \/ Personagem \/ Time/);
    assert.match(detailSrc, /\{editMoreDetailsOpen && \([\s\S]*Build \/ Personagem \/ Time/);
  });
});
