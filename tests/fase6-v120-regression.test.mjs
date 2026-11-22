import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import { PRE_V12_BACKUP_KEY, RELATIONAL_DB_NAME } from '../src/api/limits.js';
import { CODICE_RELEASE, RELEASE_HISTORY } from '../src/config/versioning.js';
import {
  buildHomeLocalRails,
  selectHeroPresentation,
} from '../src/lib/homeEngine.js';
import {
  PROFILE_AVATAR_EMBLEMS,
  resolveTop4Favorites,
} from '../src/lib/profileMetrics.js';
import { computeSpectatorMetrics } from '../src/lib/statsEngine.js';
import {
  exportSignedBackupPayload,
  inspectBackupPayload,
  loadEmergencyMirror,
  saveEmergencyMirror,
} from '../src/services/backupEngine.js';
import { enrichSeriesAndAnimeSeasons } from '../src/services/cinemaApi.js';
import {
  buildCodiceDatabase,
  hydrateAppSnapshotFromDatabase,
} from '../src/services/codiceDatabase.js';
import {
  clearRelationalMemoryForTests,
  getAllRelationalWorks,
  getRelationalApiCache,
  getSeasonProgressByWork,
  migrateLegacyToRelationalDb,
  putRelationalApiCache,
} from '../src/services/relationalDb.js';
import {
  advanceEpisodeProgress,
  createExpandedSeasonPatch,
} from '../src/utils/backlogHelpers.js';
import { buildPrefilledCatalogDraft } from '../src/utils/genreMapper.js';

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem(k) {
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      map.set(k, String(v));
    },
    removeItem(k) {
      map.delete(k);
    },
  };
}

describe('FASE 6 (v1.2.0) — Regressão Completa End-to-End · Cine Códice v1.2.0 Lumière', () => {
  beforeEach(() => {
    clearRelationalMemoryForTests();
  });

  it('(a) Catalogação consecutiva de 2 obras isola 100% os rascunhos sem vazamento de sinopse ou IDs', () => {
    const firstCandidate = {
      id: 'cand-chihiro',
      title: 'A Viagem de Chihiro',
      originalTitle: 'Sen to Chihiro no Kamikakushi',
      workType: 'anime',
      releaseYear: 2001,
      anilistId: 199,
      synopsis: 'Chihiro entra em um mundo governado por deuses, bruxas e espíritos.',
      genres: ['Animação', 'Fantasia'],
    };

    const draft1 = buildPrefilledCatalogDraft(firstCandidate, null);
    assert.equal(
      draft1.synopsis,
      'Chihiro entra em um mundo governado por deuses, bruxas e espíritos.'
    );
    assert.equal(
      draft1.overview,
      'Chihiro entra em um mundo governado por deuses, bruxas e espíritos.'
    );

    const secondCandidate = {
      id: 'cand-spn',
      title: 'Sobrenatural',
      originalTitle: 'Supernatural',
      workType: 'series',
      releaseYear: 2005,
      imdbId: 'tt0460681',
      tvmazeId: 19,
      synopsis: '', // candidato vindo de fonte rápida sem sinopse ainda
      genres: ['Fantasia', 'Terror & Horror'],
    };

    const draft2 = buildPrefilledCatalogDraft(secondCandidate, null);
    assert.notEqual(draft2.id, draft1.id);
    assert.equal(draft2.synopsis, '');
    assert.equal(draft2.overview, '');
    assert.equal(draft2.anilistId, null);
    assert.equal(draft2.imdbId, 'tt0460681');
  });

  it('(b) Série e anime populam totalSeasons automaticamente e destravam progressão T1 -> T2 -> T3', async () => {
    const spnWork = {
      id: 'work-spn',
      title: 'Sobrenatural',
      originalTitle: 'Supernatural',
      workType: 'series',
      releaseYear: 2005,
      imdbId: 'tt0460681',
      totalSeasons: 1,
    };

    const mockFetch = async (url) => {
      const u = String(url);
      if (u.includes('/lookup/shows?imdb=tt0460681')) {
        return {
          ok: true,
          status: 200,
          headers: new Map(),
          async json() {
            return { id: 19, name: 'Supernatural' };
          },
        };
      }
      if (u.includes('/shows/19/seasons')) {
        return {
          ok: true,
          status: 200,
          headers: new Map(),
          async json() {
            return Array.from({ length: 15 }, (_, idx) => ({
              number: idx + 1,
              episodeOrder: 22,
            }));
          },
        };
      }
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        async json() {
          return [];
        },
      };
    };

    const enriched = await enrichSeriesAndAnimeSeasons(spnWork, {
      fetchImpl: mockFetch,
    });
    assert.equal(enriched.totalSeasons, 15);
    assert.equal(enriched.totalEpisodes, 330);
    assert.equal(enriched.episodesPerSeason.length, 15);

    // Avança de T1 para T2 e T3 e depois expande + Nova Temporada
    const serieWithSeasons = {
      ...spnWork,
      ...enriched,
      currentSeason: 1,
      currentEpisode: 22,
    };
    const p2 = advanceEpisodeProgress(serieWithSeasons, {
      addSeasons: 1,
      allowExpandSeasons: true,
    });
    assert.equal(p2.currentSeason, 2);

    const p3 = advanceEpisodeProgress({ ...serieWithSeasons, ...p2 }, {
      addSeasons: 1,
      allowExpandSeasons: true,
    });
    assert.equal(p3.currentSeason, 3);

    const expanded = createExpandedSeasonPatch({ ...serieWithSeasons, ...p3 }, 20);
    assert.equal(expanded.totalSeasons, 16);
    assert.equal(expanded.currentSeason, 16);
  });

  it('(c) Home com 1 obra ativa não duplica no trilho Continuar Assistindo e não mostra 0% falso', () => {
    const activeSeries = {
      id: 'active-spn',
      title: 'Sobrenatural',
      workType: 'series',
      status: 'playing',
      currentSeason: 1,
      currentEpisode: 2,
      totalSeasons: 15,
      totalEpisodes: null,
      updatedAt: '2026-11-22T12:00:00Z',
    };

    const hero = selectHeroPresentation([activeSeries]);
    assert.equal(hero.state, 'active');
    assert.equal(hero.hasKnownTotal, false);
    assert.equal(hero.progressPct, null);
    assert.equal(hero.progressLabel, 'T1 · Ep. 2 assistidos');

    const rails = buildHomeLocalRails({ items: [activeSeries] });
    assert.equal(rails.continueWatching.length, 0);
  });

  it('(d) Vitrine Top 4 Favoritos (favoriteRank 1..4) e avatar local (256x256 / 8 emblemas) persistem corretamente', async () => {
    await putRelationalApiCache('profile:local_avatar_v120', {
      avatarUrl: 'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/vz0AAA=',
      avatarIcon: 'Clapperboard',
    });

    const cachedAvatar = await getRelationalApiCache('profile:local_avatar_v120');
    assert.equal(cachedAvatar.hit, true);
    assert.equal(cachedAvatar.data.avatarIcon, 'Clapperboard');
    assert.equal(PROFILE_AVATAR_EMBLEMS.length, 8);

    const works = [
      { id: 'fav-1', title: 'A Viagem de Chihiro', favoriteRank: 1 },
      { id: 'fav-2', title: 'Blade Runner 2049', favoriteRank: 2 },
      { id: 'fav-4', title: 'Cowboy Bebop', favoriteRank: 4 },
    ];
    const top4 = resolveTop4Favorites(works);
    assert.equal(top4[0].work?.id, 'fav-1');
    assert.equal(top4[1].work?.id, 'fav-2');
    assert.equal(top4[2].work, null);
    assert.equal(top4[3].work?.id, 'fav-4');
  });

  it('(e) Migração IndexedDB relacional (5 stores + snapshot prévio) e ida-e-volta completa no Backup JSON e LZW (R10)', async () => {
    const storage = createMemoryStorage();
    const origLS = globalThis.localStorage;
    globalThis.localStorage = storage;

    try {
      const legacyItems = [
        {
          id: 'rel-1',
          title: 'Ruptura',
          originalTitle: 'Severance',
          workType: 'series',
          status: 'playing',
          releaseYear: 2022,
          totalSeasons: 2,
          totalEpisodes: 19,
          episodesPerSeason: [9, 10],
          currentSeason: 1,
          currentEpisode: 4,
          episodeDurationMinutes: 50,
          synopsis: 'Memórias divididas entre vida pessoal e trabalho.',
          atmosphere: ['Tenso', 'Sombrio'],
          favoriteRank: 1,
          favoriteScene: 'O corredor branco infinito.',
          watchedEpisodes: {
            'S1:E1': 'watched',
            'S1:E2': 'watched',
            'S1:E3': 'watched',
            'S1:E4': 'watched',
          },
        },
      ];

      const migRes = await migrateLegacyToRelationalDb({
        items: legacyItems,
        sessions: [{ id: 'sess-1', itemId: 'rel-1', date: '2026-11-22', minutesRead: 50 }],
        episodeEvaluations: [{ workId: 'rel-1', season: 1, episode: 1, rating: 90 }],
        storage,
      });

      assert.equal(migRes.ok, true);
      assert.equal(Boolean(storage.getItem(PRE_V12_BACKUP_KEY)), true);
      assert.equal(RELATIONAL_DB_NAME, 'cine_codice_relational_v2');

      const relWorks = await getAllRelationalWorks();
      assert.equal(relWorks.length, 1);
      assert.equal(relWorks[0].favoriteRank, 1);
      assert.equal(relWorks[0].overview, 'Memórias divididas entre vida pessoal e trabalho.');

      const relSeasons = await getSeasonProgressByWork('rel-1');
      assert.equal(relSeasons.length, 2);

      // Ida e volta R10: Banco Relacional JSON + Assinatura SHA-256 + Espelho LZW
      const db = buildCodiceDatabase({
        items: legacyItems,
        profile: { displayName: 'Cinéfilo', avatarIcon: 'Film' },
        posts: [],
        readingSessions: [{ id: 'sess-1', itemId: 'rel-1', date: '2026-11-22', minutesRead: 50 }],
      });
      const unpackedDb = hydrateAppSnapshotFromDatabase(db);
      assert.equal(unpackedDb.items.length, 1);
      assert.equal(unpackedDb.items[0].favoriteRank, 1);
      assert.equal(unpackedDb.items[0].overview, 'Memórias divididas entre vida pessoal e trabalho.');

      const signed = await exportSignedBackupPayload(db);
      const verified = await inspectBackupPayload(signed);
      assert.equal(verified.ok, true);
      assert.equal(verified.checksumStatus, 'valid');
      assert.equal(verified.snapshot.items[0].favoriteRank, 1);

      saveEmergencyMirror({ items: legacyItems });
      const mirror = loadEmergencyMirror();
      assert.equal(mirror.items[0].favoriteRank, 1);

      // Métricas acumuladas sem porcentagem de cobrança
      const metrics = computeSpectatorMetrics(legacyItems);
      assert.equal(metrics.episodesWatched, 4);
      assert.equal(metrics.watchedMinutes, 200);
    } finally {
      globalThis.localStorage = origLS;
    }
  });

  it('(f) Ausência total dos 10 arquivos sociais removidos e consistência da versão 1.2.0 · Lumière', () => {
    const deletedSocialFiles = [
      'src/components/social/CommunityScreen.jsx',
      'src/components/social/ProfileWall.jsx',
      'src/components/social/DirectChatDrawer.jsx',
      'src/components/social/UserProfileModal.jsx',
      'src/components/social/FriendProfileCardModal.jsx',
      'src/components/social/ShareProfileCardModal.jsx',
      'src/components/social/ActivityFeed.jsx',
      'src/components/auth/AuthModal.jsx',
      'src/components/BuddyReadPanel.jsx',
      'src/services/buddyReadService.js',
    ];
    for (const rel of deletedSocialFiles) {
      assert.equal(fs.existsSync(path.resolve(rel)), false);
    }

    assert.equal(CODICE_RELEASE.version, '1.2.0');
    assert.equal(CODICE_RELEASE.label, 'v1.2.0 · Lumière');
    assert.equal(RELEASE_HISTORY[0].version, '1.2.0');
  });
});
