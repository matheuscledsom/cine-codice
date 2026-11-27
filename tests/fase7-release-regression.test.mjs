import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  buildAniListRating,
  buildExternalRatingsViewModel,
  buildMalRating,
  buildTmdbRating,
  getPresentExternalRatingBadges,
  parseOmdbRatings,
} from '../src/lib/ratings.js';
import { CODICE_RELEASE, RELEASE_HISTORY } from '../src/config/versioning.js';
import {
  exportSignedBackupPayload,
  inspectBackupPayload,
  loadEmergencyMirror,
  saveEmergencyMirror,
} from '../src/services/backupEngine.js';
import { buildCodiceDatabase } from '../src/services/codiceDatabase.js';
import { findFranchiseForItem } from '../src/services/franchiseEngine.js';

const ROOT = process.cwd();

function readText(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

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

describe('Fase 7 — Regressão Final v1.1.0 · Lumière', () => {
  it('Filme x Franquia: oculta com 1 obra e calcula média sem nota atual nem legacy-default com 2+ obras', () => {
    const soloFilm = {
      id: 'film-solo',
      title: 'Amélie',
      workType: 'movie',
      status: 'completed',
      rating: 95,
      ratingSource: 'manual',
      inBacklog: true,
    };
    assert.equal(findFranchiseForItem(soloFilm, [soloFilm]), null);

    const duna1 = {
      id: 'duna-1',
      title: 'Duna',
      workType: 'movie',
      status: 'completed',
      rating: 90,
      ratingSource: 'manual',
      belongsToCollection: { id: 726871, name: 'Coleção Duna' },
      releaseYear: 2021,
      inBacklog: true,
    };
    const duna2Unrated = {
      id: 'duna-2',
      title: 'Duna: Parte Dois',
      workType: 'movie',
      status: 'playing',
      rating: null,
      ratingSource: null,
      belongsToCollection: { id: 726871, name: 'Coleção Duna' },
      releaseYear: 2024,
      inBacklog: true,
    };
    const duna3Legacy = {
      id: 'duna-3',
      title: 'Duna: Messias',
      workType: 'movie',
      status: 'completed',
      rating: 80,
      ratingSource: 'legacy-default',
      belongsToCollection: { id: 726871, name: 'Coleção Duna' },
      releaseYear: 2026,
      inBacklog: true,
    };

    const summary = findFranchiseForItem(duna2Unrated, [duna1, duna2Unrated, duna3Legacy]);
    assert.ok(summary, 'Franquia com 2+ obras deve retornar resumo');
    assert.equal(summary.totalCount, 3);
    assert.equal(summary.completedCount, 2);
    // Média da franquia deve considerar apenas Duna (90 manual), excluindo atual sem nota e Duna 3 legacy-default
    assert.equal(summary.stats.ratedCount, 1);
    assert.equal(summary.stats.franchiseAverageRating, 90);
    assert.equal(summary.stats.hasComparative, false);
    assert.equal(summary.stats.currentRank, null);
    assert.equal(summary.stats.breakdown.movies.total, 3);
    assert.equal(summary.stats.breakdown.movies.completed, 2);
  });

  it('Notas externas: omite exatamente cada fonte individualmente ausente sem fabricar nota ou "N/A"', () => {
    const fetchedAt = new Date(2026, 10, 22, 10, 0, 0).getTime();
    const fullRatings = {
      ...parseOmdbRatings(
        {
          imdbRating: '8.7',
          imdbVotes: '900,000',
          Metascore: '74',
          Ratings: [{ Source: 'Rotten Tomatoes', Value: '91%' }],
        },
        fetchedAt
      ),
      tmdb: buildTmdbRating(8.1, 3200, fetchedAt),
      anilist: buildAniListRating(86, fetchedAt),
      mal: buildMalRating(8.64, fetchedAt),
    };

    const keys = ['imdb', 'rottenTomatoes', 'metacritic', 'tmdb', 'anilist', 'mal'];
    for (const omittedKey of keys) {
      const partial = { ...fullRatings, [omittedKey]: null };
      const badges = getPresentExternalRatingBadges(partial);
      assert.equal(badges.length, 5, `Faltando ${omittedKey} deve retornar exatamente 5 selos`);
      assert.equal(
        badges.some((b) => b.id === omittedKey),
        false,
        `Fonte ausente ${omittedKey} não pode aparecer`
      );
      assert.equal(
        badges.some((b) => /N\/A/i.test(b.displayText || '')),
        false,
        `Nunca deve exibir "N/A" quando ${omittedKey} falta`
      );

      const vm = buildExternalRatingsViewModel(
        { workType: 'movie', externalRatings: partial },
        { omdbMissingKey: false }
      );
      assert.equal(
        vm.badges.some((b) => b.id === omittedKey),
        false
      );
    }

    const allMissingVm = buildExternalRatingsViewModel(
      { workType: 'movie', externalRatings: {} },
      { omdbMissingKey: true, hasAttempted: true }
    );
    assert.equal(allMissingVm.state, 'empty');
    assert.equal(allMissingVm.omdbMissingKey, true);
    assert.equal(allMissingVm.badges.length, 0);
  });

  it('Nota 80 nunca é criada automaticamente ao concluir/cadastrar e R10 preserva campos da Fase 5', async () => {
    const useBacklogSrc = readText('src/hooks/useBacklog.js');
    const addScreenSrc = readText('src/screens/AddScreen.jsx');
    assert.match(useBacklogSrc, /merged\.rating\s*=\s*null;\s*\n\s*merged\.ratingSource\s*=\s*null;/);
    assert.equal(/rating:\s*80/.test(addScreenSrc), false);

    const db = buildCodiceDatabase({
      items: [
        {
          id: 'w-r10',
          title: 'Perfect Days',
          workType: 'movie',
          status: 'completed',
          rating: null,
          ratingSource: null,
          favoriteScene: 'Dirigindo pela ponte ao nascer do sol ouvindo Nina Simone',
          backdropUrl: 'https://image.tmdb.org/t/p/w1280/perfect-days.jpg',
          backdropCheckedAt: 1732200000000,
          franchiseLinks: [{ targetWorkId: 'w-2', title: 'Tokyo Stories', relationType: 'SPIN_OFF' }],
        },
      ],
      profile: {
        displayName: 'Espectador',
        viewerFocus: ['cinema'],
        favoriteGenres: [{ group: 'Filmes', id: '18', label: 'Drama', tmdbGenreId: 18 }],
      },
      posts: [],
      readingSessions: [],
      episodeEvaluations: [
        {
          workId: 's-1',
          season: 1,
          episode: 2,
          rating: 90,
          tag: 'Ritmo',
          reaction: 'Excelente direção',
          updatedAt: '2026-11-22T12:00:00Z',
        },
      ],
    });

    assert.equal(db.tables.reviews.length, 0);
    assert.equal(
      db.tables.works[0].favoriteScene,
      'Dirigindo pela ponte ao nascer do sol ouvindo Nina Simone'
    );
    assert.equal(
      db.tables.works[0].backdropUrl,
      'https://image.tmdb.org/t/p/w1280/perfect-days.jpg'
    );
    assert.equal(db.tables.works[0].backdropCheckedAt, 1732200000000);

    const signed = await exportSignedBackupPayload(db);
    const inspected = await inspectBackupPayload(JSON.stringify(signed));
    assert.equal(inspected.ok, true);
    assert.equal(inspected.checksumStatus, 'valid');
    assert.equal(inspected.snapshot.items[0].rating, null);
    assert.equal(
      inspected.snapshot.items[0].favoriteScene,
      'Dirigindo pela ponte ao nascer do sol ouvindo Nina Simone'
    );
    assert.equal(inspected.snapshot.items[0].backdropCheckedAt, 1732200000000);
    assert.equal(inspected.snapshot.episodeEvaluations.length, 1);

    const origLS = globalThis.localStorage;
    globalThis.localStorage = createMemoryStorage();
    try {
      const savedOk = saveEmergencyMirror({
        items: inspected.snapshot.items,
        profile: inspected.snapshot.profile,
        posts: inspected.snapshot.posts,
        readingSessions: inspected.snapshot.readingSessions,
        episodeEvaluations: inspected.snapshot.episodeEvaluations,
      });
      assert.equal(savedOk, true);
      const restored = loadEmergencyMirror();
      assert.equal(restored.ok, true);
      assert.equal(
        restored.items[0].favoriteScene,
        'Dirigindo pela ponte ao nascer do sol ouvindo Nina Simone'
      );
      assert.equal(restored.items[0].backdropCheckedAt, 1732200000000);
      assert.equal(restored.items[0].rating ?? null, null);
    } finally {
      globalThis.localStorage = origLS;
    }
  });

  it('Versão atual (2.7.2) está consistente em todos os arquivos oficiais mantendo histórico 1.0.0/1.1.0/1.2.0/1.3.0/2.3.3 e protocolo WS', () => {
    const pkg = JSON.parse(readText('package.json'));
    const lock = JSON.parse(readText('package-lock.json'));
    assert.equal(pkg.name, 'omniprism');
    assert.equal(pkg.version, '2.7.2');
    assert.equal(lock.version, '2.7.2');
    assert.equal(lock.packages?.['']?.version, '2.7.2');

    assert.equal(CODICE_RELEASE.version, '2.7.2');
    assert.equal(CODICE_RELEASE.label, 'v2.7.2');
    assert.equal(CODICE_RELEASE.label.includes('Lumière'), false);
    assert.ok(RELEASE_HISTORY.some((r) => r.version === '2.7.2'));
    assert.ok(RELEASE_HISTORY.some((r) => r.version === '2.3.3'));
    assert.ok(RELEASE_HISTORY.some((r) => r.version === '1.3.0'));
    assert.ok(RELEASE_HISTORY.some((r) => r.version === '1.2.0'));
    assert.ok(RELEASE_HISTORY.some((r) => r.version === '1.1.0'));
    assert.ok(RELEASE_HISTORY.some((r) => r.version === '1.0.0'));

    const readme = readText('README.md');
    assert.match(readme, /OMDb/);
    assert.match(readme, /SOCIAL_ENABLED = false/);

    const changelog = readText('CHANGELOG.md');
    assert.match(changelog, /## \[v2\.4\.0\]/);
    assert.match(changelog, /## \[v2\.3\.3\]/);
    assert.match(changelog, /## \[v1\.3\.0 · Lumière\]/);
    assert.match(changelog, /## \[v1\.2\.0 · Lumière\]/);
    assert.match(changelog, /## \[v1\.1\.0 · Lumière\]/);
    assert.match(changelog, /## \[v1\.0\.0 · Lumière\]/);
    assert.match(changelog, /## \[v5\.0\.0 · Alexandria\]/);
    assert.match(changelog, /## \[v3\.0\.0\]/);

    // Protocolo Phoenix/Supabase WebSocket permanece 1.0.0 (não confundir com versão do app)
    const backendSrc = readText('src/services/codiceBackend.js');
    assert.match(backendSrc, /vsn:\s*'1\.0\.0'/);
  });
});
