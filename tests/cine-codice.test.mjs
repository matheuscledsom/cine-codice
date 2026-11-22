import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, it } from 'node:test';

import {
  buildGeneratedPosterDataUri,
  generateEditorialPosterSvg,
} from '../src/graphics/posterGenerator.js';
import {
  EMERGENCY_MIRROR_KEY,
  exportSignedBackupPayload,
  inspectBackupPayload,
  loadEmergencyMirror,
  saveEmergencyMirror,
} from '../src/services/backupEngine.js';
import {
  clearCinemaSearchCache,
  searchCinemaMedia,
} from '../src/services/cinemaApi.js';
import { buildCodiceDatabase } from '../src/services/codiceDatabase.js';
import {
  DNA_DIMENSIONS,
  computeWeightedDnaRating,
  createDefaultReaderDna,
} from '../src/services/dnaScoring.js';
import {
  analyzeFranchises,
  buildMissingFranchiseEntryDraft,
} from '../src/services/franchiseEngine.js';
import {
  decodePublicProfileCard,
  encodePublicProfileCard,
  sanitizePlainText,
} from '../src/services/peerProfileShare.js';
import {
  advanceEpisodeProgress,
  advanceMovieSeconds,
  calculateEpisodicProgress,
  calculateMovieProgress,
  formatFlexibleProgressMetric,
  formatSecondsToHms,
  getWatchedMinutes,
  parseTimeInputToSeconds,
} from '../src/utils/backlogHelpers.js';
import { parseCatalogImport } from '../src/utils/catalogImporters.js';
import { buildWatchPickerPool } from '../src/utils/readingCheckIn.js';

function createMemoryStorage() {
  const store = new Map();
  return {
    getItem(k) {
      return store.has(k) ? store.get(k) : null;
    },
    setItem(k, v) {
      store.set(String(k), String(v));
    },
    removeItem(k) {
      store.delete(String(k));
    },
    clear() {
      store.clear();
    },
    get _rawMap() {
      return store;
    },
  };
}

globalThis.localStorage = createMemoryStorage();

beforeEach(() => {
  globalThis.localStorage.clear();
  clearCinemaSearchCache();
});

describe('Cine Códice — Agregador Multi-Fonte (cinemaApi.js)', () => {
  it('isola falha de 1 API, deduplica por título + ano e usa cache local', async () => {
    let fetchCalls = 0;

    const mockFetch = async (url) => {
      fetchCalls += 1;
      const strUrl = String(url);

      if (strUrl.includes('graphql.anilist.co')) {
        throw new Error('AniList offline timeout');
      }

      if (strUrl.includes('api.jikan.moe')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                mal_id: 1,
                title: 'Cowboy Bebop',
                title_english: 'Cowboy Bebop',
                year: 1998,
                episodes: 26,
                duration: '24 min per ep',
                type: 'TV',
                studios: [{ name: 'Sunrise' }],
                genres: [{ name: 'Sci-Fi' }, { name: 'Action' }],
                images: { jpg: { large_image_url: 'https://img.example/bebop-mal.jpg' } },
                synopsis: 'Caçadores de recompensas no espaço.',
              },
            ],
          }),
        };
      }

      if (strUrl.includes('api.tvmaze.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              show: {
                id: 82,
                name: 'Cowboy Bebop',
                premiered: '1998-04-03',
                averageRuntime: 25,
                type: 'Animation',
                language: 'Japanese',
                genres: ['Action', 'Science-Fiction'],
                network: { name: 'TV Tokyo' },
                externals: { imdb: 'tt0213338' },
                summary: '<p>Live anime series from TVmaze.</p>',
                image: { original: 'https://img.example/bebop-tvmaze.jpg' },
              },
            },
            {
              show: {
                id: 99,
                name: 'Andor',
                premiered: '2022-09-21',
                averageRuntime: 48,
                type: 'Scripted',
                language: 'English',
                genres: ['Drama', 'Science-Fiction'],
                webChannel: { name: 'Disney+' },
                externals: { imdb: 'tt9253284' },
                summary: '<p>Rebelião contra o Império.</p>',
                image: { original: 'https://img.example/andor.jpg' },
              },
            },
          ],
        };
      }

      return { ok: true, status: 200, json: async () => ({}) };
    };

    const res1 = await searchCinemaMedia('Cowboy Bebop', {
      filter: 'all',
      sources: ['anilist', 'jikan', 'tvmaze'],
      fetchImpl: mockFetch,
    });

    assert.equal(res1.partialFailure, true);
    assert.deepEqual(res1.failedSources, ['anilist']);
    assert.equal(res1.allFailed, false);
    assert.equal(res1.fromCache, false);

    // Cowboy Bebop (1998) de Jikan e TVmaze deduplicado em 1 entrada mesclada + Andor
    assert.equal(res1.results.length, 2);
    const bebop = res1.results.find((r) => /cowboy bebop/i.test(r.title));
    assert.ok(bebop);
    assert.ok(bebop.mergedSources.includes('MAL'));
    assert.ok(bebop.mergedSources.includes('TVmaze'));

    const callsBeforeCache = fetchCalls;
    const resCached = await searchCinemaMedia('Cowboy Bebop', {
      filter: 'all',
      sources: ['anilist', 'jikan', 'tvmaze'],
      fetchImpl: mockFetch,
    });

    assert.equal(resCached.fromCache, true);
    assert.equal(fetchCalls, callsBeforeCache);
  });
});

describe('Cine Códice — Progresso Tátil de Filmes, Séries e Animes', () => {
  it('calcula minutagem HH:MM:SS, +15/+30 min e contagem de Rewatch para filmes', () => {
    assert.equal(formatSecondsToHms(4460), '01:14:20');
    assert.equal(parseTimeInputToSeconds('01:14:20'), 4460);
    assert.equal(calculateMovieProgress(4460, 8880), 50);

    const movie = {
      id: 'm1',
      title: 'Blade Runner 2049',
      workType: 'movie',
      status: 'playing',
      durationMinutes: 164,
      totalSeconds: 164 * 60,
      currentSeconds: 60 * 60,
      rewatchCount: 1,
    };

    const plus15 = advanceMovieSeconds(movie, 15);
    assert.equal(plus15.currentSeconds, 75 * 60);
    assert.equal(formatFlexibleProgressMetric({ ...movie, ...plus15 }), '01:15:00 / 02:44:00');

    const plus30 = advanceMovieSeconds({ ...movie, currentSeconds: plus15.currentSeconds }, 30);
    assert.equal(plus30.currentSeconds, 105 * 60);

    // 105 min ativos + 1 rewatch anterior de 164 min = 269 min assistidos
    assert.equal(getWatchedMinutes({ ...movie, currentSeconds: plus30.currentSeconds }), 269);
  });

  it('avança episódios (+1 Ep, +3 Eps, +1 Temp) e ignora fillers no percentual quando configurado', () => {
    const anime = {
      id: 'a1',
      title: 'Fullmetal Alchemist: Brotherhood',
      workType: 'anime',
      status: 'playing',
      totalSeasons: 2,
      totalEpisodes: 24,
      episodesPerSeason: [12, 12],
      currentSeason: 1,
      currentEpisode: 3,
      watchedEpisodes: { '1:1': 'watched', '1:2': 'watched', '1:3': 'watched' },
      fillerEpisodes: ['1:5', '1:6', '1:7', '1:8'],
      ignoreFillersInProgress: true,
    };

    // Com 4 fillers ignorados (denominador 20), 3 eps = 15%
    assert.equal(calculateEpisodicProgress(anime), 15);

    const step1 = advanceEpisodeProgress(anime, { addEpisodes: 1 });
    assert.equal(step1.currentEpisode, 4);
    assert.equal(step1.watchedEpisodes['1:4'], 'watched');

    const step3 = advanceEpisodeProgress({ ...anime, ...step1 }, { addEpisodes: 3 });
    assert.equal(step3.currentEpisode, 7);

    const stepSeason = advanceEpisodeProgress(
      { ...anime, currentSeason: 1, currentEpisode: 4, watchedEpisodes: { '1:1': 'watched' } },
      { addSeasons: 1 }
    );
    assert.equal(stepSeason.currentSeason, 2);
    assert.equal(stepSeason.watchedEpisodes['1:12'], 'watched');
  });
});

describe('Cine Códice — Radar de Franquias & Ordem Cronológica', () => {
  it('agrupa sequências/prequels/OVAs e cria rascunho em 1 toque para faltantes', () => {
    const items = [
      {
        id: 'eva-1',
        title: 'Neon Genesis Evangelion',
        franchiseName: 'Evangelion',
        releaseYear: 1995,
        workType: 'anime',
        status: 'completed',
        director: 'Hideaki Anno',
        inBacklog: true,
        franchiseRelations: [
          {
            relationType: 'SEQUEL',
            format: 'MOVIE',
            title: 'The End of Evangelion',
            releaseYear: 1997,
            anilistId: 32,
          },
        ],
      },
    ];

    const franchises = analyzeFranchises(items);
    assert.equal(franchises.length, 1);
    assert.equal(franchises[0].totalCount, 2);
    assert.equal(franchises[0].completedCount, 1);
    assert.equal(franchises[0].completionPct, 50);
    assert.equal(franchises[0].nextMissingEntry.title, 'The End of Evangelion');

    const draft = buildMissingFranchiseEntryDraft(franchises[0], franchises[0].nextMissingEntry);
    assert.equal(draft.title, 'The End of Evangelion');
    assert.equal(draft.workType, 'movie');
    assert.equal(draft.status, 'queued');
  });
});

describe('Cine Códice — DNA do Espectador (8 Dimensões) & Roleta por Tempo', () => {
  it('calcula nota determinística ponderada pelos 8 pesos do DNA', () => {
    assert.equal(DNA_DIMENSIONS.length, 8);

    const dna = createDefaultReaderDna();
    dna.weights.soundtrackSound = 100;
    dna.weights.directionVisuals = 100;
    dna.weights.screenplayPace = 20;

    const scores = {
      screenplayPace: 40,
      directionVisuals: 95,
      charactersActing: 80,
      soundtrackSound: 100,
      worldbuildingAtmosphere: 80,
      tensionTwists: 80,
      originality: 80,
      impactRewatch: 80,
    };

    const weighted = computeWeightedDnaRating(scores, dna);
    const neutral = computeWeightedDnaRating(scores, createDefaultReaderDna());
    assert.ok(weighted > neutral);
    assert.ok(weighted >= 0 && weighted <= 100);
  });

  it('filtra Roleta por duração disponível (25 min, 50 min, 2h+)', () => {
    const queuedPool = [
      { id: 'q1', title: 'Bocchi the Rock!', workType: 'anime', episodeDurationMinutes: 24, status: 'queued', inBacklog: true },
      { id: 'q2', title: 'Severance', workType: 'series', episodeDurationMinutes: 50, status: 'queued', inBacklog: true },
      { id: 'q3', title: 'Oppenheimer', workType: 'movie', durationMinutes: 180, status: 'queued', inBacklog: true },
    ];

    assert.deepEqual(
      buildWatchPickerPool({ items: queuedPool, filter: '25min' }).map((i) => i.id),
      ['q1']
    );
    assert.deepEqual(
      buildWatchPickerPool({ items: queuedPool, filter: '50min' }).map((i) => i.id),
      ['q2']
    );
    assert.deepEqual(
      buildWatchPickerPool({ items: queuedPool, filter: '2h+' }).map((i) => i.id),
      ['q3']
    );
  });
});

describe('Cine Códice — Importador CSV (Letterboxd / IMDb / MAL)', () => {
  it('importa Letterboxd CSV e detecta títulos já existentes no acervo', () => {
    const csv = [
      'Date,Name,Year,Letterboxd URI,Rating,Rewatch',
      '2026-05-01,Parasita,2019,https://boxd.it/1,5,Yes',
      '2026-05-02,Duna: Parte 2,2024,https://boxd.it/2,4.5,No',
    ].join('\n');

    const res = parseCatalogImport({
      text: csv,
      existingItems: [{ id: '1', title: 'Parasita', releaseYear: 2019 }],
    });

    assert.equal(res.format, 'letterboxd');
    assert.equal(res.records.length, 2);
    assert.equal(res.duplicateCount, 1);
    assert.equal(res.newCount, 1);
    assert.equal(res.records[0].isDuplicate, true);
    assert.equal(res.records[0].rating, 100);
    assert.equal(res.records[0].rewatchCount, 1);
    assert.equal(res.records[1].isDuplicate, false);
    assert.equal(res.records[1].rating, 90);
  });
});

describe('Cine Códice — Segurança XSS, CSP e Espelho de Emergência sem Base64', () => {
  it('sanitiza HTML/XSS, bloqueia segredos em ?card= e confere headers CSP', () => {
    assert.equal(
      sanitizePlainText('<script>alert(1)</script>Clube da <b>Luta</b>'),
      'alert(1) Clube da Luta'
    );
    assert.equal(
      sanitizePlainText('javascript:alert(1) Plano sequência'),
      'alert(1) Plano sequência'
    );

    const token = encodePublicProfileCard({
      profile: {
        handle: '@cine_tester',
        displayName: '<b>Cine</b> Tester',
        bio: 'Curadoria cinema',
      },
      items: [{ id: 'f1', title: 'Cidade de Deus', status: 'completed', rating: 98, inBacklog: true }],
    });

    const decoded = decodePublicProfileCard(token);
    assert.equal(decoded.ok, true);
    assert.equal(decoded.card.displayName, 'Cine Tester');

    const headersPath = path.resolve(process.cwd(), 'public/_headers');
    const headersText = fs.readFileSync(headersPath, 'utf8');
    assert.match(headersText, /default-src 'self'/);
    assert.match(headersText, /object-src 'none'/);
    assert.match(headersText, /https:\/\/graphql\.anilist\.co/);
    assert.match(headersText, /https:\/\/api\.tvmaze\.com/);
    assert.match(headersText, /https:\/\/api\.themoviedb\.org/);
  });

  it('grava espelho LZW sem Base64 data: URLs e valida assinatura SHA-256 do backup', async () => {
    const items = [
      {
        id: 'w1',
        title: 'A Viagem de Chihiro',
        director: 'Hayao Miyazaki',
        workType: 'anime',
        status: 'completed',
        coverUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        inBacklog: true,
      },
    ];

    const saved = saveEmergencyMirror({ items });
    assert.equal(saved, true);

    const rawStored = globalThis.localStorage.getItem(EMERGENCY_MIRROR_KEY);
    assert.ok(rawStored);
    assert.equal(rawStored.includes('data:image/'), false);

    const loaded = loadEmergencyMirror();
    assert.equal(loaded.ok, true);
    assert.equal(loaded.items.length, 1);
    assert.equal(loaded.items[0].coverUrl, undefined);

    const db = buildCodiceDatabase({ items });
    const signed = await exportSignedBackupPayload(db);
    assert.equal(signed.checksum.algorithm, 'SHA-256');
    assert.ok(signed.checksum.digest);

    const verified = await inspectBackupPayload(JSON.stringify(signed));
    assert.equal(verified.ok, true);
    assert.equal(verified.checksumStatus, 'valid');
    assert.equal(verified.computedDigest, verified.declaredDigest);

    const tampered = { ...signed, db: { ...signed.db, schemaVersion: 'tampered' } };
    const tamperedCheck = await inspectBackupPayload(JSON.stringify(tampered));
    assert.equal(tamperedCheck.checksumStatus, 'tampered');
  });
});

describe('Cine Códice — Diretrizes Visuais & Integridade sem IA/Emojis', () => {
  it('gera pôster tipográfico 2:3 determinístico sem IA e garante zero emojis em src/', () => {
    const svg = generateEditorialPosterSvg({
      title: 'Solaris',
      director: 'Andrei Tarkovsky',
      releaseYear: 1972,
      workType: 'movie',
    });
    assert.match(svg, /viewBox="0 0 200 300"/);
    assert.match(svg, /FILME · 1972/);
    assert.match(svg, /Solaris/);
    assert.match(svg, /Andrei Tarkovsky/);

    const uri = buildGeneratedPosterDataUri({ title: 'Solaris' });
    assert.match(uri, /^data:image\/svg\+xml/);

    const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
    const walkDir = (dirPath) => {
      for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if (/\.(js|jsx|ts|tsx|css)$/i.test(entry.name)) {
          const content = fs.readFileSync(fullPath, 'utf8');
          assert.equal(
            emojiRegex.test(content),
            false,
            `Emoji detectado em arquivo proibido: ${fullPath}`
          );
        }
      }
    };

    walkDir(path.resolve(process.cwd(), 'src'));
  });
});
