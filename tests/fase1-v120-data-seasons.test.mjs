import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, it } from 'node:test';

import { clearMemoryApiCacheForTests } from '../src/api/cacheDb.js';
import { resetApiClientStateForTests } from '../src/api/httpClient.js';
import { PRE_V12_BACKUP_KEY, RELATIONAL_STORES } from '../src/api/limits.js';
import {
  clearCinemaSearchCache,
  deduplicateCinemaResults,
  enrichSeriesAndAnimeSeasons,
} from '../src/services/cinemaApi.js';
import {
  clearRelationalMemoryForTests,
  getAllRelationalSessions,
  getAllRelationalWorks,
  getApiCacheEntry,
  getEpisodeReviewsByWork,
  getSeasonProgressByWork,
  migrateLegacyToRelationalDb,
  openRelationalDb,
  purgeExpiredApiCache,
  setApiCacheEntry,
} from '../src/services/relationalDb.js';
import {
  advanceEpisodeProgress,
  createExpandedSeasonPatch,
} from '../src/utils/backlogHelpers.js';
import {
  autoMapAtmosphereAndTags,
  buildPrefilledCatalogDraft,
} from '../src/utils/genreMapper.js';

function createMemoryStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}

function createSchemaSpyIdbFactory() {
  const createdStores = [];
  const fakeFactory = {
    open(name, version) {
      const req = { result: null, onupgradeneeded: null, onsuccess: null, onerror: null };
      queueMicrotask(() => {
        const storesMap = new Map();
        const db = {
          name,
          version,
          objectStoreNames: {
            contains: (n) => storesMap.has(n),
          },
          createObjectStore(storeName, opts) {
            const indexes = [];
            const meta = { storeName, keyPath: opts?.keyPath, indexes };
            createdStores.push(meta);
            storesMap.set(storeName, meta);
            return {
              createIndex(idxName, idxKeyPath) {
                indexes.push({ idxName, idxKeyPath });
              },
            };
          },
          close() {},
          transaction() {
            throw new Error('use memory fallback after schema spy');
          },
        };
        req.result = db;
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
  return { fakeFactory, createdStores };
}

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

describe('Fase 1 (v1.2.0) — IndexedDB Relacional, Isolamento de Sinopse, Temporadas & Auto-Tagging', () => {
  beforeEach(() => {
    clearRelationalMemoryForTests();
    clearCinemaSearchCache();
    clearMemoryApiCacheForTests();
    resetApiClientStateForTests();
  });

  it('define exatamente as 5 stores relacionais no IndexedDB com seus índices esperados', async () => {
    const { fakeFactory, createdStores } = createSchemaSpyIdbFactory();
    const db = await openRelationalDb(fakeFactory);
    assert.ok(db);

    const names = createdStores.map((s) => s.storeName);
    assert.deepEqual(names, [
      RELATIONAL_STORES.works,
      RELATIONAL_STORES.seasonProgress,
      RELATIONAL_STORES.episodeReviews,
      RELATIONAL_STORES.sessionsLog,
      RELATIONAL_STORES.apiCache,
    ]);

    const worksMeta = createdStores.find((s) => s.storeName === 'works');
    assert.equal(worksMeta.keyPath, 'id');
    assert.deepEqual(
      worksMeta.indexes.map((i) => i.idxName),
      ['by_status', 'by_format', 'by_franchise', 'by_updatedAt', 'by_favoriteRank']
    );

    const seasonMeta = createdStores.find((s) => s.storeName === 'season_progress');
    assert.deepEqual(seasonMeta.keyPath, ['workId', 'seasonNumber']);
    assert.equal(seasonMeta.indexes[0].idxName, 'by_workId');

    const epReviewMeta = createdStores.find((s) => s.storeName === 'episode_reviews');
    assert.deepEqual(epReviewMeta.keyPath, ['workId', 'seasonNumber', 'episodeNumber']);

    const sessionsMeta = createdStores.find((s) => s.storeName === 'sessions_log');
    assert.equal(sessionsMeta.keyPath, 'id');
    assert.deepEqual(
      sessionsMeta.indexes.map((i) => i.idxName),
      ['by_workId', 'by_date']
    );

    const apiCacheMeta = createdStores.find((s) => s.storeName === 'api_cache');
    assert.equal(apiCacheMeta.keyPath, 'cacheKey');
    assert.equal(apiCacheMeta.indexes[0].idxName, 'by_expiresAt');
  });

  it('migra v1.1 -> IndexedDB relacional v1.2 com snapshot prévio obrigatório e idempotência', async () => {
    const storage = createMemoryStorage();
    const legacyItems = [
      {
        id: 'spn-1',
        title: 'Supernatural',
        workType: 'series',
        status: 'playing',
        totalSeasons: 15,
        totalEpisodes: 327,
        currentSeason: 2,
        currentEpisode: 25,
        watchedEpisodes: { '1:1': 'watched', '2:1': 'watched' },
        synopsis: 'Dois irmãos caçam criaturas sobrenaturais.',
        atmosphere: ['Sombrio', 'Tenso'],
        tags: ['Sobrenatural'],
        favoriteRank: 1,
      },
    ];
    const legacySessions = [
      { id: 's-1', workId: 'spn-1', date: '2026-11-20', minutes: 45, episodesCount: 1 },
    ];
    const legacyEvals = [
      { workId: 'spn-1', season: 1, episode: 1, rating: 90, tag: 'Clímax', reaction: 'Piloto ótimo' },
    ];

    const res1 = await migrateLegacyToRelationalDb({
      items: legacyItems,
      sessions: legacySessions,
      episodeEvaluations: legacyEvals,
      storage,
    });
    assert.equal(res1.ok, true);
    assert.equal(res1.snapshotSaved, true);

    const snapRaw = storage.getItem(PRE_V12_BACKUP_KEY);
    assert.ok(snapRaw);
    const snap = JSON.parse(snapRaw);
    assert.equal(snap.itemsCount, 1);
    assert.equal(snap.items[0].title, 'Supernatural');

    const works = await getAllRelationalWorks();
    assert.equal(works.length, 1);
    assert.equal(works[0].overview, 'Dois irmãos caçam criaturas sobrenaturais.');
    assert.equal(works[0].favoriteRank, 1);

    const seasons = await getSeasonProgressByWork('spn-1');
    assert.equal(seasons.length, 15);
    assert.deepEqual(seasons[0].watchedEpisodes, [1]);

    const reviews = await getEpisodeReviewsByWork('spn-1');
    assert.equal(reviews.length, 1);
    assert.equal(reviews[0].rating, 90);

    const sessions = await getAllRelationalSessions();
    assert.equal(sessions.length, 1);

    // Segunda execução sem force retorna alreadyMigrated = true sem duplicar
    const res2 = await migrateLegacyToRelationalDb({
      items: legacyItems,
      sessions: legacySessions,
      episodeEvaluations: legacyEvals,
      storage,
    });
    assert.equal(res2.alreadyMigrated, true);
    assert.equal((await getAllRelationalWorks()).length, 1);

    // Testa api_cache TTL e purga de expirados (sem expor chaves)
    await setApiCacheEntry('tmdb:tv:1622?api_key=SECRET123', { seasons: 15 }, { ttlMs: 5000, now: 1000 });
    const hit = await getApiCacheEntry('tmdb:tv:1622', { now: 2000 });
    assert.equal(hit.hit, true);
    assert.equal(hit.data.seasons, 15);
    await purgeExpiredApiCache({ now: 10000 });
    assert.equal((await getApiCacheEntry('tmdb:tv:1622', { now: 10000 })).hit, false);
  });

  it('isola completamente rascunhos consecutivos impedindo vazamento de sinopse e dedup falsa', () => {
    const cowboy = buildPrefilledCatalogDraft({
      id: 'anilist-1',
      title: 'Cowboy Bebop',
      workType: 'anime',
      director: 'Shinichiro Watanabe',
      studio: 'Sunrise',
      releaseYear: 1998,
      genres: ['Sci-Fi', 'Action'],
      synopsis: 'Caçadores de recompensa espaciais em 2071 na nave Bebop.',
      atmosphere: ['Nostálgico'],
      tropes: ['Noir'],
    });
    assert.equal(cowboy.synopsis, 'Caçadores de recompensa espaciais em 2071 na nave Bebop.');
    assert.equal(cowboy.overview, cowboy.synopsis);

    // Simula mutação posterior no primeiro rascunho
    cowboy.tropes.push('Mutado');

    // Segundo rascunho sem sinopse prévia deve começar estritamente limpo
    const supernatural = buildPrefilledCatalogDraft({
      id: 'tvmaze-19',
      title: 'Supernatural',
      workType: 'series',
      studio: 'The CW',
      releaseYear: 2005,
      genres: ['Drama', 'Mystery', 'Horror'],
      synopsis: '',
    });

    assert.equal(supernatural.synopsis, '');
    assert.equal(supernatural.overview, '');
    assert.equal(supernatural.director, 'The CW');
    assert.equal(supernatural.tropes.includes('Mutado'), false);
    assert.equal(supernatural.tropes.includes('Noir'), false);

    // Auto-tagging gera atmosfera e temas para Supernatural
    assert.ok(supernatural.atmosphere.includes('Sombrio'));
    assert.ok(supernatural.atmosphere.includes('Tenso'));
    assert.ok(supernatural.tropes.includes('Terror'));
    assert.ok(supernatural.tropes.includes('Mistério Investigativo'));

    // Deduplicação não funde duas obras com IDs externos conflitantes
    const deduped = deduplicateCinemaResults([
      { id: 'a1', title: 'Ghost in the Shell', workType: 'anime', anilistId: 43, synopsis: 'Filme 1995' },
      { id: 'a2', title: 'Ghost in the Shell', workType: 'anime', anilistId: 9999, synopsis: 'Remake distinto' },
    ]);
    assert.equal(deduped.length, 2);
  });

  it('busca automaticamente temporadas de séries (TVmaze sem chave) e animes (AniList sequências) e destrava T1->T2->T3', async () => {
    const fetchMock = async (url) => {
      const s = String(url);
      if (s.includes('api.tvmaze.com/search/shows')) {
        return createJsonResponse([
          { show: { id: 19, name: 'Supernatural', premiered: '2005-09-13', externals: { imdb: 'tt0460681' } } },
        ]);
      }
      if (s.includes('api.tvmaze.com/shows/19/seasons')) {
        return createJsonResponse([
          { id: 1, number: 1, episodeOrder: 22 },
          { id: 2, number: 2, episodeOrder: 22 },
          { id: 3, number: 3, episodeOrder: 16 },
        ]);
      }
      if (s.includes('api.tvmaze.com/shows/19/episodes')) {
        return createJsonResponse([]); // testa preenchimento mesmo se /episodes vier vazio usando /seasons
      }
      if (s.includes('api.tvmaze.com/shows/19?embed=nextepisode')) {
        return createJsonResponse({ id: 19, status: 'Ended' });
      }
      throw new Error(`Unexpected URL ${s}`);
    };

    const spnSeasons = await enrichSeriesAndAnimeSeasons(
      {
        title: 'Supernatural',
        workType: 'series',
        releaseYear: 2005,
        totalSeasons: 1,
      },
      { fetchImpl: fetchMock }
    );
    assert.ok(spnSeasons);
    assert.equal(spnSeasons.tvmazeId, 19);
    assert.equal(spnSeasons.totalSeasons, 3);
    assert.deepEqual(spnSeasons.episodesPerSeason, [22, 22, 16]);
    assert.equal(spnSeasons.totalEpisodes, 60);

    // Destrava +1 Temp e + Nova Temp sem limite artificial
    let state = {
      workType: 'series',
      totalSeasons: 1,
      currentSeason: 1,
      currentEpisode: 2,
      episodesPerSeason: [22],
      watchedEpisodes: { '1:1': 'watched', '1:2': 'watched' },
    };
    const adv2 = advanceEpisodeProgress(state, { addSeasons: 1, allowExpandSeasons: true });
    assert.equal(adv2.currentSeason, 2);
    assert.equal(adv2.totalSeasons, 2);

    const added3 = createExpandedSeasonPatch({ ...state, ...adv2 }, 16);
    assert.equal(added3.totalSeasons, 3);
    assert.equal(added3.currentSeason, 3);
    assert.deepEqual(added3.episodesPerSeason, [22, 22, 16]);

    // Garante remoção do limite rígido de 24 temporadas e isolamento com key na UI
    const tactileSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/TactileStatusFields.jsx'), 'utf8');
    const epTabSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/EpisodeListTab.jsx'), 'utf8');
    const addSrc = fs.readFileSync(path.join(process.cwd(), 'src/screens/AddScreen.jsx'), 'utf8');
    assert.equal(/Math\.min\(totalSeasons,\s*24\)/.test(tactileSrc), false);
    assert.equal(/Math\.min\(totalSeasons,\s*24\)/.test(epTabSrc), false);
    assert.match(addSrc, /key=\{`draft-drawer-\$\{draftItem\.id\}`\}/);
  });

  it('autoMapAtmosphereAndTags mapeia gêneros e sinopse para atmosferas e tags sem precisar grade vazia', () => {
    const mapped = autoMapAtmosphereAndTags({
      genres: ['Drama', 'Terror', 'Fantasia'],
      keywords: ['supernatural', 'demons'],
      synopsis: 'Irmãos investigam casos ocultos e mistérios pelas estradas.',
      workType: 'series',
    });
    assert.ok(mapped.atmosphere.includes('Sombrio'));
    assert.ok(mapped.tropes.includes('Terror'));
    assert.ok(mapped.tropes.includes('Sobrenatural'));
    assert.ok(mapped.tropes.includes('Fantasia'));
  });
});
