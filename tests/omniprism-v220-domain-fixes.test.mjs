import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  GAME_EDITION_TYPES,
  GAME_PLATFORMS,
  GAME_PLATFORM_UNSET_LABEL,
  getMediaTypesForDomain,
} from '../src/config/domainConfig.js';
import {
  formatTrackDuration,
  rankMusicCandidates,
  searchGamesWorks,
  searchMusicWorks,
  searchReadingWorks,
} from '../src/services/multiDomainSearchService.js';
import {
  mapCatalogRowToLocalWork,
  mapLocalWorkToCatalogRow,
  mergeWorksByUpdatedAt,
} from '../src/services/omniSyncService.js';
import {
  computeStrictCompletionProgress,
  formatCatalogCardFormatBadge,
  formatFlexibleProgressMetric,
} from '../src/utils/backlogHelpers.js';
import {
  computeDomainStatsMetrics,
  computeGlobalOmniMetrics,
} from '../src/utils/profileMetrics.js';
import { buildWrappedSummary } from '../src/utils/wrappedStats.js';

describe('OmniPrism v2.2.0 — Correções de Música, Games, Leitura PT-BR e Métricas por Domínio', () => {
  it('(a) Música: filtros completos, busca paralela song+album, priorização de original (Metallica 1991 > covers 2021) e fallback silencioso do MusicBrainz', async () => {
    // 1. Verifica todos os tipos de mídia / filtros da aba Música
    const musicTypes = getMediaTypesForDomain('music');
    assert.deepEqual(
      musicTypes.map((t) => t.pluralLabel),
      ['Faixas', 'Álbuns', 'EPs / Singles', 'Artistas / Bandas', 'Shows Ao Vivo']
    );

    const calledUrls = [];
    const mockMusicFetch = async (url) => {
      calledUrls.push(url);
      if (url.includes('musicbrainz.org')) {
        // Simula timeout / oscilação do MusicBrainz
        throw new Error('AbortError: timeout');
      }
      if (url.includes('entity=song')) {
        return {
          ok: true,
          async json() {
            return {
              results: [
                {
                  wrapperType: 'track',
                  trackId: 9001,
                  collectionId: 5001,
                  trackName: 'Sad But True',
                  collectionName: 'The Metallica Blacklist',
                  artistName: 'Jason Isbell and the 400 Unit',
                  releaseDate: '2021-09-10T07:00:00Z',
                  primaryGenreName: 'Rock',
                  trackTimeMillis: 328000,
                  artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/blacklist/100x100bb.jpg',
                },
                {
                  wrapperType: 'track',
                  trackId: 9002,
                  collectionId: 5002,
                  trackName: 'Sad But True (Acoustic Cover)',
                  collectionName: 'Metal Acoustic Covers 2021',
                  artistName: 'Acoustic Tribute Band',
                  releaseDate: '2021-05-01T07:00:00Z',
                  primaryGenreName: 'Acoustic',
                  trackTimeMillis: 290000,
                  artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/cover/100x100bb.jpg',
                },
                {
                  wrapperType: 'track',
                  trackId: 9003,
                  collectionId: 5003,
                  trackName: 'Sad But True',
                  collectionName: 'Metallica',
                  artistName: 'Metallica',
                  releaseDate: '1991-08-12T07:00:00Z',
                  primaryGenreName: 'Metal',
                  trackNumber: 2,
                  trackTimeMillis: 324700,
                  artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/metallica/100x100bb.jpg',
                },
              ],
            };
          },
        };
      }
      if (url.includes('entity=album')) {
        return {
          ok: true,
          async json() {
            return {
              results: [
                {
                  collectionId: 5003,
                  collectionName: 'Metallica',
                  artistName: 'Metallica',
                  releaseDate: '1991-08-12T07:00:00Z',
                  primaryGenreName: 'Metal',
                  trackCount: 12,
                  artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/metallica/100x100bb.jpg',
                },
              ],
            };
          },
        };
      }
      return { ok: true, async json() { return { results: [] }; } };
    };

    const res = await searchMusicWorks('Sad but true', {
      fetchImpl: mockMusicFetch,
      mediaTypeFilter: 'all',
    });

    // Consultas paralelas song + album no iTunes
    assert.ok(calledUrls.some((u) => u.includes('itunes.apple.com/search') && u.includes('entity=song')));
    assert.ok(calledUrls.some((u) => u.includes('itunes.apple.com/search') && u.includes('entity=album')));

    // Fallback silencioso: MusicBrainz falhou, mas iTunes retornou resultados válidos -> partialFailure === false
    assert.equal(res.ok, true);
    assert.equal(res.partialFailure, false);
    assert.deepEqual(res.usedSources, ['iTunes']);
    assert.deepEqual(res.silentFallbackSources, ['MusicBrainz']);
    assert.match(res.sourceStatusHint, /iTunes/);

    // Gravação original do Metallica (1991) deve vir em #1 antes dos covers de 2021
    assert.equal(res.results[0].workType, 'track');
    assert.equal(res.results[0].title, 'Sad But True');
    assert.equal(res.results[0].creator, 'Metallica');
    assert.equal(res.results[0].releaseYear, 1991);
    assert.equal(res.results[0].albumName, 'Metallica');
    assert.equal(res.results[0].durationLabel, formatTrackDuration(324700));

    // Mesmo quando outro artista não tem "Cover" no título, gravação original mais antiga vence
    const rankedOnlyTracks = rankMusicCandidates(
      [
        { title: 'Sad But True', creator: 'Sam Fender', albumName: 'Single', releaseYear: 2021, workType: 'track' },
        { title: 'Sad But True', creator: 'Metallica', albumName: 'Metallica', releaseYear: 1991, workType: 'track' },
      ],
      'Sad But True',
      'track'
    );
    assert.equal(rankedOnlyTracks[0].creator, 'Metallica');
    assert.equal(rankedOnlyTracks[0].releaseYear, 1991);

    // Round-trip Supabase de Faixa individual com albumName, durationMs e trackRating10
    const trackRow = mapLocalWorkToCatalogRow(
      {
        id: 'track-sad-but-true',
        domain: 'music',
        workType: 'track',
        title: 'Sad But True',
        creator: 'Metallica',
        albumName: 'Metallica',
        durationMs: 324700,
        releaseYear: 1991,
        trackRating10: 9.5,
        rating: 95,
        ratingSource: 'manual',
        status: 'completed',
      },
      'user-v220'
    );
    assert.equal(trackRow.media_type, 'track');
    assert.equal(trackRow.progress_data.album_name, 'Metallica');
    assert.equal(trackRow.progress_data.duration_ms, 324700);
    assert.equal(trackRow.progress_data.track_rating_10, 9.5);
    const back = mapCatalogRowToLocalWork(trackRow);
    assert.equal(back.workType, 'track');
    assert.equal(back.albumName, 'Metallica');
    assert.equal(back.trackRating10, 9.5);
  });

  it('(b) Games: nunca inventa PC/Steam na Wikidata, extrai plataformas reais, separa Jogo vs Remake e persiste nota 0–11', async () => {
    assert.deepEqual(GAME_PLATFORMS, [
      'PS1', 'PS2', 'PS3', 'PS4', 'PS5', 'PSP', 'SNES', 'GBA', 'DS', '3DS', 'Switch', 'PC', 'Mobile',
    ]);
    assert.deepEqual(GAME_EDITION_TYPES, ['Jogo', 'Remake', 'Remaster', 'Port', 'Coletânea', 'DLC']);

    const mockSotcFetch = async (url) => {
      if (url.includes('/api/igdb') || url.includes('/api/rawg') || url.includes('/api/steam')) {
        return { ok: false, status: 503, async json() { return { error: 'unconfigured' }; } };
      }
      if (url.includes('action=wbsearchentities')) {
        return {
          ok: true,
          async json() {
            return {
              search: [
                {
                  id: 'Q748096',
                  label: 'Shadow of the Colossus',
                  description: 'videojogo de 2005',
                },
                {
                  id: 'Q999999',
                  label: 'Shadow Mystery Console Game',
                  description: 'jogo eletrônico sem plataforma cadastrada',
                },
              ],
            };
          },
        };
      }
      if (url.includes('action=wbgetentities') && url.includes('Q748096')) {
        return {
          ok: true,
          async json() {
            return {
              entities: {
                Q748096: {
                  id: 'Q748096',
                  labels: { en: { value: 'Shadow of the Colossus' } },
                  descriptions: { pt: { value: 'videojogo de 2005' } },
                  claims: {
                    P31: [{ mainsnak: { datavalue: { value: { id: 'Q7889' } } } }],
                    P400: [
                      { mainsnak: { datavalue: { value: { id: 'Q10680' } } } }, // PS2
                      { mainsnak: { datavalue: { value: { id: 'Q10683' } } } }, // PS3
                    ],
                    P577: [{ mainsnak: { datavalue: { value: { time: '+2005-10-18T00:00:00Z' } } } }],
                    P178: [{ mainsnak: { datavalue: { value: { id: 'Q1054203' } } } }],
                    P4969: [{ mainsnak: { datavalue: { value: { id: 'Q30252703' } } } }], // Remake 2018
                  },
                },
                Q999999: {
                  id: 'Q999999',
                  labels: { en: { value: 'Shadow Mystery Console Game' } },
                  descriptions: { pt: { value: 'jogo eletrônico' } },
                  claims: {
                    P31: [{ mainsnak: { datavalue: { value: { id: 'Q7889' } } } }],
                  },
                },
              },
            };
          },
        };
      }
      if (url.includes('action=wbgetentities') && url.includes('Q30252703')) {
        return {
          ok: true,
          async json() {
            return {
              entities: {
                Q30252703: {
                  id: 'Q30252703',
                  labels: { en: { value: 'Shadow of the Colossus' } },
                  descriptions: { pt: { value: 'remake de videojogo de 2018 para PS4' } },
                  claims: {
                    P31: [{ mainsnak: { datavalue: { value: { id: 'Q4393107' } } } }], // video game remake
                    P400: [{ mainsnak: { datavalue: { value: { id: 'Q5014725' } } } }], // PS4
                    P577: [{ mainsnak: { datavalue: { value: { time: '+2018-02-06T00:00:00Z' } } } }],
                    P178: [{ mainsnak: { datavalue: { value: { id: 'Q4929785' } } } }],
                  },
                },
              },
            };
          },
        };
      }
      if (url.includes('props=labels')) {
        return {
          ok: true,
          async json() {
            return {
              entities: {
                Q1054203: { labels: { en: { value: 'Team Ico' } } },
                Q4929785: { labels: { en: { value: 'Bluepoint Games' } } },
              },
            };
          },
        };
      }
      return { ok: true, async json() { return {}; } };
    };

    const gamesRes = await searchGamesWorks('Shadow of the Colossus', {
      fetchImpl: mockSotcFetch,
    });
    assert.equal(gamesRes.ok, true);

    const original = gamesRes.results.find(
      (g) => g.title === 'Shadow of the Colossus' && g.editionType === 'Jogo'
    );
    const remake = gamesRes.results.find(
      (g) => g.title === 'Shadow of the Colossus' && g.editionType === 'Remake'
    );
    const noPlatform = gamesRes.results.find((g) => g.title === 'Shadow Mystery Console Game');

    assert.ok(original, 'Deve retornar o jogo base (2005)');
    assert.equal(original.releaseYear, 2005);
    assert.deepEqual(original.platforms, ['PS2', 'PS3']);
    assert.equal(original.platform, 'PS2');
    assert.equal(original.storeOrLauncher, '');
    assert.equal(original.creator, 'Team Ico');

    assert.ok(remake, 'Deve retornar separadamente o Remake (2018)');
    assert.equal(remake.releaseYear, 2018);
    assert.deepEqual(remake.platforms, ['PS4']);
    assert.equal(remake.platform, 'PS4');
    assert.equal(remake.creator, 'Bluepoint Games');

    // Quando API não informa plataforma, nunca inventa PC/Steam
    assert.ok(noPlatform);
    assert.equal(noPlatform.platform, '');
    assert.deepEqual(noPlatform.platforms, []);
    assert.equal(noPlatform.storeOrLauncher, '');
    assert.equal(noPlatform.platformDisplayLabel, GAME_PLATFORM_UNSET_LABEL);
    assert.equal(formatCatalogCardFormatBadge(noPlatform).label.includes('PC'), false);
    assert.equal(formatCatalogCardFormatBadge(noPlatform).label.includes(GAME_PLATFORM_UNSET_LABEL), true);

    // Original e Remake coexistem sem colidir no merge Supabase e preservam nota 11 + justificativa
    const origWork = {
      id: 'sotc-2005',
      domain: 'games',
      workType: 'game',
      title: 'Shadow of the Colossus',
      platform: 'PS2',
      platforms: ['PS2', 'PS3'],
      editionType: 'Original',
      releaseYear: 2005,
      gameRating11: 11,
      rating: 100,
      ratingSource: 'manual',
      masterpieceJustification: 'Atmosfera silenciosa e direção artística insuperáveis.',
      status: 'completed',
      updatedAt: '2026-11-23T22:00:00Z',
    };
    const remakeWork = {
      id: 'sotc-2018',
      domain: 'games',
      workType: 'game',
      title: 'Shadow of the Colossus',
      platform: 'PS4',
      platforms: ['PS4'],
      editionType: 'Remake',
      releaseYear: 2018,
      gameRating11: 10,
      rating: 100,
      ratingSource: 'manual',
      status: 'completed',
      updatedAt: '2026-11-23T22:05:00Z',
    };

    const row = mapLocalWorkToCatalogRow(origWork, 'user-v220');
    assert.equal(row.progress_data.edition_type, 'Jogo');
    assert.equal(row.progress_data.game_rating_11, 11);
    assert.equal(
      row.progress_data.masterpiece_justification,
      'Atmosfera silenciosa e direção artística insuperáveis.'
    );
    const back = mapCatalogRowToLocalWork(row);
    assert.equal(back.platform, 'PS2');
    assert.equal(back.gameRating11, 11);
    assert.equal(back.editionType, 'Jogo');

    const { mergedWorks } = mergeWorksByUpdatedAt([origWork], [remakeWork]);
    assert.equal(mergedWorks.length, 2, 'Original e Remake devem coexistir separadamente no catálogo');
  });

  it('(c) Leitura: prioriza edições em Português (langRestrict=pt e language=por) preservando originalTitle e corrige duplo X', async () => {
    const calledUrls = [];
    const mockKafkaFetch = async (url) => {
      calledUrls.push(url);
      if (url.includes('openlibrary.org') && url.includes('language=por')) {
        return {
          ok: true,
          async json() {
            return {
              docs: [
                {
                  key: '/works/OL1W',
                  title: 'Die Verwandlung',
                  author_name: ['Franz Kafka'],
                  first_publish_year: 1915,
                  number_of_pages_median: 96,
                  cover_i: 111,
                  language: ['por', 'ger'],
                  editions: {
                    docs: [
                      {
                        key: '/books/OL1M',
                        title: 'A Metamorfose',
                        language: ['por'],
                        cover_i: 112,
                      },
                    ],
                  },
                },
                {
                  key: '/works/OL2W',
                  title: '海辺のカフカ',
                  author_name: ['Haruki Murakami'],
                  first_publish_year: 2002,
                  language: ['jpn', 'por'],
                },
              ],
            };
          },
        };
      }
      if (url.includes('googleapis.com/books') && url.includes('langRestrict=pt')) {
        return {
          ok: true,
          async json() {
            return {
              items: [
                {
                  id: 'gb-pt-1',
                  volumeInfo: {
                    title: 'O Processo',
                    authors: ['Franz Kafka'],
                    language: 'pt',
                    publishedDate: '1925',
                    pageCount: 256,
                    description: 'Clássico de Franz Kafka em português.',
                    imageLinks: { thumbnail: 'http://books.google.com/processo.jpg' },
                  },
                },
              ],
            };
          },
        };
      }
      if (url.includes('googleapis.com/books')) {
        return {
          ok: true,
          async json() {
            return {
              items: [
                {
                  id: 'gb-orig-1',
                  volumeInfo: {
                    title: 'Der Proceß',
                    authors: ['Franz Kafka'],
                    language: 'de',
                    publishedDate: '1925',
                    pageCount: 256,
                    imageLinks: { large: 'https://books.google.com/processo-hd.jpg' },
                  },
                },
                {
                  id: 'gb-orig-2',
                  volumeInfo: {
                    title: 'Metamorphosis',
                    authors: ['Franz Kafka'],
                    language: 'en',
                    publishedDate: '1915',
                  },
                },
              ],
            };
          },
        };
      }
      return { ok: true, async json() { return { docs: [] }; } };
    };

    const res = await searchReadingWorks('kafka', { fetchImpl: mockKafkaFetch });

    assert.ok(calledUrls.some((u) => u.includes('googleapis.com/books') && u.includes('langRestrict=pt')));
    assert.ok(calledUrls.some((u) => u.includes('openlibrary.org/search.json') && u.includes('language=por')));

    assert.equal(res.ok, true);
    assert.ok(res.results.length >= 2);

    // Top resultados devem ser em Português, NUNCA japonês (海辺のカフカ) ou alemão (Der Proceß)
    const top2Titles = res.results.slice(0, 2).map((r) => r.title);
    assert.ok(top2Titles.includes('A Metamorfose'));
    assert.ok(top2Titles.includes('O Processo'));
    assert.equal(/[\u3040-\u9fff]/.test(res.results[0].title), false);

    // Preserva título original como subtítulo
    const metamorfose = res.results.find((r) => r.title === 'A Metamorfose');
    assert.equal(metamorfose.originalTitle, 'Die Verwandlung');

    const processo = res.results.find((r) => r.title === 'O Processo');
    assert.equal(processo.originalTitle, 'Der Proceß');

    // Garante correção do duplo botão X em input[type="search"]
    const indexCss = fs.readFileSync(path.resolve('src/index.css'), 'utf8');
    const addScreenSrc = fs.readFileSync(path.resolve('src/screens/AddScreen.jsx'), 'utf8');
    assert.match(indexCss, /::-webkit-search-cancel-button/);
    assert.match(addScreenSrc, /\[&::-webkit-search-cancel-button\]:hidden/);
  });

  it('(d) Métricas dinâmicas por domínio e regra matemática estrita (sem 0% inventado e média apenas com rating > 0)', () => {
    const mixedItems = [
      // Cinema
      {
        id: 'c1',
        domain: 'cinema',
        workType: 'series',
        title: 'One Piece',
        director: 'Eiichiro Oda',
        status: 'playing',
        currentEpisode: 42,
        totalEpisodes: null, // total desconhecido -> Progresso aberto!
        episodeDurationMinutes: 24,
        rating: null,
        genres: ['Aventura'],
      },
      {
        id: 'c2',
        domain: 'cinema',
        workType: 'movie',
        title: 'Stalker',
        director: 'Andrei Tarkovsky',
        status: 'completed',
        durationMinutes: 162,
        rating: 96,
        ratingSource: 'manual',
        genres: ['Ficção Científica'],
      },
      // Leitura
      {
        id: 'r1',
        domain: 'reading',
        workType: 'book',
        title: 'A Metamorfose',
        originalTitle: 'Die Verwandlung',
        creator: 'Franz Kafka',
        bookFormat: 'Físico',
        pagesRead: 96,
        totalPages: 96,
        chaptersRead: 3,
        status: 'completed',
        rating: 92,
        ratingSource: 'manual',
        genres: ['Clássico'],
      },
      {
        id: 'r2',
        domain: 'reading',
        workType: 'manga',
        title: 'Vagabond',
        creator: 'Takehiko Inoue',
        bookFormat: 'Físico',
        pagesRead: 350,
        totalPages: null, // total desconhecido -> Progresso aberto!
        chaptersRead: 25,
        status: 'playing',
        rating: 0, // rating 0 NÃO deve puxar a média para baixo!
        ratingSource: 'manual',
        genres: ['Seinen'],
      },
      // Games
      {
        id: 'g1',
        domain: 'games',
        workType: 'game',
        title: 'Shadow of the Colossus',
        franchiseName: 'Team Ico',
        platform: 'PS2',
        editionType: 'Original',
        hoursPlayed: 18,
        completionType: '100% / Platina',
        status: 'completed',
        gameRating11: 11,
        rating: 100,
        ratingSource: 'manual',
        genres: ['Ação-Aventura'],
      },
      {
        id: 'g2',
        domain: 'games',
        workType: 'game',
        title: 'Hollow Knight',
        franchiseName: 'Hollow Knight',
        platform: 'PC',
        editionType: 'Original',
        hoursPlayed: 42,
        completionType: 'História Principal',
        status: 'completed',
        gameRating11: 9,
        rating: 90,
        ratingSource: 'manual',
        genres: ['Metroidvania'],
      },
      {
        id: 'g3',
        domain: 'games',
        workType: 'game',
        title: 'Chrono Trigger',
        platform: '', // sem plataforma -> "Plataforma a definir"
        hoursPlayed: 5,
        status: 'playing',
        rating: null,
        genres: ['RPG'],
      },
      // Música
      {
        id: 'm1',
        domain: 'music',
        workType: 'track',
        title: 'Sad But True',
        albumName: 'Metallica',
        creator: 'Metallica',
        subgenre: 'Heavy Metal',
        releaseFormat: 'Faixa Individual',
        listenCount: 18,
        status: 'completed',
        trackRating10: 10,
        rating: 100,
        ratingSource: 'manual',
        genres: ['Metal'],
      },
      {
        id: 'm2',
        domain: 'music',
        workType: 'album',
        title: 'Powerslave',
        creator: 'Iron Maiden',
        subgenre: 'Heavy Metal',
        releaseFormat: 'Álbum de Estúdio',
        listenCount: 7,
        status: 'completed',
        rating: 90,
        ratingSource: 'manual',
        genres: ['Metal'],
      },
    ];

    // Regra estrita: progresso sem total conhecido nunca inventa %
    const strictSeries = computeStrictCompletionProgress(mixedItems[0]);
    assert.equal(strictSeries.percent, null);
    assert.equal(strictSeries.isOpenProgress, true);
    assert.match(strictSeries.label, /Progresso aberto/);

    const strictManga = computeStrictCompletionProgress(mixedItems[3]);
    assert.equal(strictManga.percent, null);
    assert.equal(strictManga.isOpenProgress, true);
    assert.match(formatFlexibleProgressMetric(mixedItems[3]), /Progresso aberto/);

    // Leitura: média ignora Vagabond (rating: 0) e calcula só sobre A Metamorfose (92)
    const readingStats = computeDomainStatsMetrics(mixedItems, 'reading');
    assert.equal(readingStats.pagesRead, 446);
    assert.equal(readingStats.chaptersRead, 28);
    assert.equal(readingStats.completedCount, 1);
    assert.equal(readingStats.avgRatingValue, 92);
    assert.equal(readingStats.avgRating, '92/100');
    assert.equal(readingStats.openProgressCount, 1);
    assert.equal(readingStats.kpis[0].label, 'Páginas Lidas');
    assert.equal(readingStats.ranking.primaryTabLabel, 'Autores');

    // Games: escala 0–11 (média de 11 e 9 = 10/11, ignorando g3 sem nota), plataformas reais + "Plataforma a definir"
    const gamesStats = computeDomainStatsMetrics(mixedItems, 'games');
    assert.equal(gamesStats.hoursPlayed, 65);
    assert.equal(gamesStats.completedCount, 2);
    assert.equal(gamesStats.hundredPercentCount, 1);
    assert.equal(gamesStats.masterpiece11Count, 1);
    assert.equal(gamesStats.avgRating11, 10);
    assert.equal(gamesStats.avgRating, '10/11');
    assert.equal(gamesStats.kpis[3].label, 'Média Geral (0–11)');
    assert.ok(gamesStats.platformDistribution.some((p) => p.label === 'PS2'));
    assert.ok(gamesStats.platformDistribution.some((p) => p.label === GAME_PLATFORM_UNSET_LABEL));

    // Música: álbuns & faixas, escutas, discografias exploradas e média real
    const musicStats = computeDomainStatsMetrics(mixedItems, 'music');
    assert.equal(musicStats.totalCount, 2);
    assert.equal(musicStats.tracksCount, 1);
    assert.equal(musicStats.albumsCount, 1);
    assert.equal(musicStats.totalListens, 25);
    assert.equal(musicStats.uniqueArtistsCount, 2);
    assert.equal(musicStats.avgRatingValue, 95);
    assert.equal(musicStats.kpis[0].label, 'Álbuns & Faixas Catalogadas');
    assert.equal(musicStats.ranking.primaryTabLabel, 'Artistas & Bandas');

    // Visão Global OmniPrism
    const globalStats = computeGlobalOmniMetrics(mixedItems);
    assert.equal(globalStats.totalCount, 9);
    assert.equal(globalStats.ratedCount, 6); // ignora c1 (null), r2 (0) e g3 (null)
    assert.equal(globalStats.breakdown.length, 4);

    // Omni Wrapped por domínio
    const gamesWrapped = buildWrappedSummary({
      items: mixedItems,
      period: 'all',
      domain: 'games',
    });
    assert.match(gamesWrapped.brandTitle, /OMNI WRAPPED · GAMES/);
    assert.equal(gamesWrapped.avgRatingDisplay, '10/11');
    assert.equal(gamesWrapped.hoursPlayed, 65);

    const readingWrapped = buildWrappedSummary({
      items: mixedItems,
      period: 'all',
      domain: 'reading',
    });
    assert.match(readingWrapped.brandTitle, /OMNI WRAPPED · LEITURA/);
    assert.equal(readingWrapped.pagesRead, 446);

    // Verifica conexão de StatsScreen ao activeDomain e Omni Wrapped em App.jsx
    const statsSrc = fs.readFileSync(path.resolve('src/screens/StatsScreen.jsx'), 'utf8');
    const appSrc = fs.readFileSync(path.resolve('src/App.jsx'), 'utf8');
    assert.match(statsSrc, /Visão Global OmniPrism/);
    assert.match(statsSrc, /Omni Wrapped \(PNG\)/);
    assert.match(statsSrc, /computeDomainStatsMetrics/);
    assert.match(appSrc, /<StatsScreen[\s\S]*activeDomain=\{activeDomain\}/);
  });
});
