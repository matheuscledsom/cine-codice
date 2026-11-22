import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, it } from 'node:test';

import {
  clearMemoryApiCacheForTests,
  getAllEpisodeEvaluations,
  importEpisodeEvaluations,
  saveEpisodeEvaluation,
} from '../src/api/cacheDb.js';
import { findForbiddenEmojisOrSymbols } from '../src/lib/emojiCheck.js';
import {
  extractFavoriteGenreLabels,
  migrateFavoriteGenresToObjects,
} from '../src/lib/genreCatalog.js';
import {
  CURRENT_MIGRATION_VERSION,
  classifyLegacyRatingSource,
  executeAtomicWorkspaceMigration,
  migrateProfileData,
  migrateWorkItem,
  needsWorkspaceMigration,
} from '../src/lib/migrations.js';
import {
  compareUserRatingWithPublic,
  isConfirmedUserRating,
  parseOmdbRatings,
} from '../src/lib/ratings.js';
import {
  exportSignedBackupPayload,
  inspectBackupPayload,
  mergeSnapshots,
  saveAutoSnapshot,
  verifyAutoSnapshotIntegrity,
} from '../src/services/backupEngine.js';
import {
  CODICE_SCHEMA_VERSION,
  buildCodiceDatabase,
  hydrateAppSnapshotFromDatabase,
  parseAndValidateBackupText,
} from '../src/services/codiceDatabase.js';
import { buildWrappedSummary } from '../src/utils/wrappedStats.js';

function createLegacyWorkWithAuto80() {
  return {
    id: 'w-legacy-80',
    title: 'Stalker',
    workType: 'movie',
    status: 'completed',
    rating: 80,
    reviewCriteria: null,
    notes: '',
    tmdbId: 1398,
    imdbId: 'tt0079944',
    genres: ['Ficção Científica', 'Drama'],
    tags: ['clássico', 'tarkovsky'],
  };
}

function createLegacyWorkWithReal80() {
  return {
    id: 'w-real-80',
    title: 'Cure',
    workType: 'movie',
    status: 'completed',
    rating: 80,
    reviewCriteria: {
      roteiro: 80,
      direcao: 85,
      atuacao: 75,
      ritmo: 80,
    },
    notes: 'Suspense atmosférico hipnótico.',
    tmdbId: 36095,
    genres: ['Suspense & Thriller'],
  };
}

function createLegacyProfile() {
  return {
    id: 'local-primary',
    displayName: 'Matheus',
    handle: '@matheus#1234',
    readerFocus: 'Maratonista de Séries',
    favoriteGenres: ['Drama', 'Noir', 'Shonen', 'Giallo Italiano'],
    annualGoal: 36,
    preferredFormat: 'Blu-ray 4K',
    preferredCriteria: ['Roteiro & Ritmo'],
  };
}

describe('Fase 1B — Migração v1.0.0 -> v1.1.0 e Regras R8/R10', () => {
  beforeEach(() => {
    clearMemoryApiCacheForTests();
  });

  it('classifica corretamente rating 80 sem critérios (legacy-default) vs com critérios (manual)', () => {
    const legacyAuto = createLegacyWorkWithAuto80();
    const real80 = createLegacyWorkWithReal80();
    const unratedCompleted = {
      id: 'w-unrated',
      title: 'Solaris',
      workType: 'movie',
      status: 'completed',
      rating: null,
      reviewCriteria: null,
    };

    assert.equal(classifyLegacyRatingSource(legacyAuto), 'legacy-default');
    assert.equal(classifyLegacyRatingSource(real80), 'manual');
    assert.equal(classifyLegacyRatingSource(unratedCompleted), null);

    const migratedAuto = migrateWorkItem(legacyAuto);
    const migratedReal = migrateWorkItem(real80);
    const migratedUnrated = migrateWorkItem(unratedCompleted);

    assert.equal(migratedAuto.rating, 80);
    assert.equal(migratedAuto.ratingSource, 'legacy-default');
    assert.equal(migratedAuto.ids.tmdb, 1398);
    assert.equal(migratedAuto.ids.imdb, 'tt0079944');
    assert.equal(migratedAuto.tmdbId, 1398);
    assert.equal(migratedAuto.imdbId, 'tt0079944');

    assert.equal(migratedReal.rating, 80);
    assert.equal(migratedReal.ratingSource, 'manual');

    assert.equal(migratedUnrated.rating, null);
    assert.equal(migratedUnrated.ratingSource, null);
  });

  it('migra perfil legado preservando campos antigos (R8), convertendo viewerFocus[] e favoriteGenres em objetos', () => {
    const legacyProfile = createLegacyProfile();
    const migrated = migrateProfileData(legacyProfile);

    assert.deepEqual(migrated.viewerFocus, ['Maratonista de Séries']);
    assert.equal(migrated.readerFocus, 'Maratonista de Séries');
    assert.equal(migrated.annualGoal, 36);
    assert.equal(migrated.preferredFormat, 'Blu-ray 4K');
    assert.equal(migrated.profileSchemaVersion, 3);

    assert.equal(Array.isArray(migrated.favoriteGenres), true);
    assert.equal(migrated.favoriteGenres.length, 4);
    assert.deepEqual(
      migrated.favoriteGenres.map((g) => [g.group, g.label]),
      [
        ['cinema', 'Drama'],
        ['cinema', 'Noir'],
        ['animes', 'Shonen'],
        ['outros', 'Giallo Italiano'],
      ]
    );

    // Subsequente extração mantém compatibilidade textual
    assert.deepEqual(extractFavoriteGenreLabels(migrated.favoriteGenres), [
      'Drama',
      'Noir',
      'Shonen',
      'Giallo Italiano',
    ]);
  });

  it('é estritamente idempotente ao rodar migração mais de uma vez e mantém confirmação manual', () => {
    const rawWork = createLegacyWorkWithAuto80();
    const first = migrateWorkItem(rawWork);
    const second = migrateWorkItem(first);
    assert.deepEqual(second, first);

    const confirmed = migrateWorkItem({ ...first, ratingSource: 'manual' });
    const confirmedTwice = migrateWorkItem(confirmed);
    assert.equal(confirmedTwice.ratingSource, 'manual');

    const profileFirst = migrateProfileData(createLegacyProfile());
    const profileSecond = migrateProfileData(profileFirst);
    assert.deepEqual(profileSecond, profileFirst);

    assert.equal(
      needsWorkspaceMigration(
        { items: [second], profile: profileSecond },
        CURRENT_MIGRATION_VERSION
      ),
      false
    );
  });

  it('exclui ratingSource legacy-default das médias, comparações públicas e Wrapped', () => {
    const legacy80 = migrateWorkItem(createLegacyWorkWithAuto80());
    const real90 = migrateWorkItem({
      id: 'w-90',
      title: 'Espelho',
      workType: 'movie',
      status: 'completed',
      completedDate: '2026-05-10',
      completedYear: 2026,
      rating: 90,
      reviewCriteria: { roteiro: 90 },
    });

    assert.equal(isConfirmedUserRating(legacy80), false);
    assert.equal(isConfirmedUserRating(real90), true);

    const externalRatings = parseOmdbRatings({
      imdbRating: '8.1',
      imdbVotes: '140,000',
      Metascore: 'N/A',
      Ratings: [{ Source: 'Rotten Tomatoes', Value: '100%' }],
    });
    assert.equal(
      compareUserRatingWithPublic(legacy80.rating, externalRatings, legacy80.ratingSource),
      null
    );
    const comparedReal = compareUserRatingWithPublic(
      real90.rating,
      externalRatings,
      real90.ratingSource
    );
    assert.equal(comparedReal.userScore100, 90);

    const summary = buildWrappedSummary({
      items: [
        { ...legacy80, completedDate: '2026-03-01', completedYear: 2026 },
        real90,
      ],
      period: 'year',
      targetYear: 2026,
    });
    assert.equal(summary.completedCount, 2);
    assert.equal(summary.avgRating, 90);
  });
});

describe('Fase 1B — Snapshot pré-migração, leitura de volta e atomicidade (Regras Extras 1 e 2)', () => {
  it('Regra Extra 1: grava e relê snapshot antes de migrar; se snapshot ou releitura falhar, aborta sem tocar nos dados originais', async () => {
    const originalWorkspace = {
      items: [createLegacyWorkWithAuto80()],
      profile: createLegacyProfile(),
    };
    const originalSnapshotStr = JSON.stringify(originalWorkspace);

    let committed = false;

    // Caso 1A: falha ao salvar snapshot
    const failSaveResult = await executeAtomicWorkspaceMigration({
      rawWorkspace: originalWorkspace,
      storedMigrationVersion: 0,
      saveSnapshotFn: async () => {
        throw new Error('QuotaExceededError');
      },
      verifySnapshotFn: async () => ({ ok: true }),
      commitFn: async () => {
        committed = true;
      },
    });
    assert.equal(failSaveResult.status, 'snapshot-failed');
    assert.equal(failSaveResult.aborted, true);
    assert.equal(committed, false);
    assert.match(failSaveResult.warning, /intact/i);
    assert.equal(JSON.stringify(failSaveResult.workspace), originalSnapshotStr);

    // Caso 1B: gravação aparenta sucesso, mas releitura falha (checksum/ausente)
    const failReadbackResult = await executeAtomicWorkspaceMigration({
      rawWorkspace: originalWorkspace,
      storedMigrationVersion: 0,
      saveSnapshotFn: saveAutoSnapshot,
      verifySnapshotFn: async (snapshotId, expected) => {
        // Verifica primeiro que o verify real funciona
        const realCheck = await verifyAutoSnapshotIntegrity(snapshotId, expected);
        assert.equal(realCheck.ok, true);
        // Agora simula falha na verificação de releitura
        return { ok: false, reason: 'Checksum SHA-256 adulterado na releitura.' };
      },
      commitFn: async () => {
        committed = true;
      },
    });
    assert.equal(failReadbackResult.status, 'snapshot-failed');
    assert.equal(failReadbackResult.aborted, true);
    assert.equal(committed, false);
    assert.equal(JSON.stringify(failReadbackResult.workspace), originalSnapshotStr);

    // Caso 1C: snapshot + releitura reais validam -> migração prossegue e confirma commit
    const okResult = await executeAtomicWorkspaceMigration({
      rawWorkspace: originalWorkspace,
      storedMigrationVersion: 0,
      saveSnapshotFn: saveAutoSnapshot,
      verifySnapshotFn: verifyAutoSnapshotIntegrity,
      commitFn: async () => {
        committed = true;
      },
    });
    assert.equal(okResult.status, 'migrated');
    assert.equal(okResult.aborted, false);
    assert.equal(committed, true);
    assert.equal(okResult.workspace.items[0].ratingSource, 'legacy-default');
    assert.deepEqual(okResult.workspace.profile.viewerFocus, ['Maratonista de Séries']);
    // Dados de entrada não foram mutados in-place
    assert.equal(JSON.stringify(originalWorkspace), originalSnapshotStr);
  });

  it('Regra Extra 2: erro no meio da migração mantém dados originais intactos (tudo ou nada)', async () => {
    const storeState = {
      backlog: [
        createLegacyWorkWithAuto80(),
        createLegacyWorkWithReal80(),
      ],
      profile: createLegacyProfile(),
      migrationVersion: 0,
    };
    const beforeStr = JSON.stringify(storeState);

    const midErrorResult = await executeAtomicWorkspaceMigration({
      rawWorkspace: { items: storeState.backlog, profile: storeState.profile },
      storedMigrationVersion: storeState.migrationVersion,
      saveSnapshotFn: saveAutoSnapshot,
      verifySnapshotFn: verifyAutoSnapshotIntegrity,
      simulateMidErrorFn: ({ index }) => {
        if (index === 0) {
          throw new Error('Falha simulada após o primeiro item');
        }
      },
      commitFn: async (migrated) => {
        storeState.backlog = migrated.items;
        storeState.profile = migrated.profile;
        storeState.migrationVersion = CURRENT_MIGRATION_VERSION;
      },
    });

    assert.equal(midErrorResult.status, 'migration-failed');
    assert.equal(midErrorResult.aborted, true);
    assert.equal(JSON.stringify(storeState), beforeStr);
    assert.equal(midErrorResult.workspace.items.length, 2);
    assert.equal(midErrorResult.workspace.items[0].ratingSource, undefined);
  });
});

describe('Fase 1B — Backups v1.0.0 e Ida-e-Volta R10 completo', () => {
  beforeEach(() => {
    clearMemoryApiCacheForTests();
  });

  it('preserva episodeEvaluations, tags, franchiseLinks, ratingSource, viewerFocus e favoriteGenres no backup assinado', async () => {
    await saveEpisodeEvaluation({
      workId: 'w-series-1',
      season: 2,
      episode: 5,
      rating: 95,
      tag: 'Obra-Prima',
      reaction: 'Final inesquecível de temporada.',
    });
    const savedEvals = await getAllEpisodeEvaluations();
    assert.equal(savedEvals.length, 1);

    const profile = migrateProfileData({
      displayName: 'Curadora',
      handle: '@curadora#0001',
      viewerFocus: ['Cinéfilo Curador', 'Animes'],
      favoriteGenres: migrateFavoriteGenresToObjects(['Drama', 'Isekai']),
      annualGoal: 40,
      preferredFormat: 'Cinema / Sala',
    });

    const item = migrateWorkItem({
      id: 'w-series-1',
      title: 'Dark',
      workType: 'series',
      status: 'playing',
      tmdbId: 70523,
      imdbId: 'tt5753856',
      rating: 90,
      ratingSource: 'manual',
      tags: ['viagem-no-tempo', 'alemã'],
      franchiseLinks: [
        {
          targetWorkId: 'w-series-2',
          title: '1899',
          workType: 'series',
          relationType: 'SPIN_OFF',
          tmdbId: 90669,
        },
      ],
      externalRatings: parseOmdbRatings({ imdbRating: '8.7', Ratings: [] }),
    });

    const db = buildCodiceDatabase({
      items: [item],
      profile,
      episodeEvaluations: savedEvals,
    });
    assert.equal(db.schemaVersion, CODICE_SCHEMA_VERSION);

    const signed = await exportSignedBackupPayload(db);
    const inspected = await inspectBackupPayload(JSON.stringify(signed));
    assert.equal(inspected.ok, true);
    assert.equal(inspected.checksumStatus, 'valid');
    assert.equal(inspected.counts.episodeEvaluations, 1);

    clearMemoryApiCacheForTests();
    const restoredViaParser = parseAndValidateBackupText(JSON.stringify(signed));
    assert.equal(restoredViaParser.ok, true);
    assert.equal(restoredViaParser.episodeEvaluations.length, 1);
    assert.equal(restoredViaParser.episodeEvaluations[0].tag, 'Obra-Prima');
    assert.equal(restoredViaParser.episodeEvaluations[0].reaction, 'Final inesquecível de temporada.');

    await importEpisodeEvaluations(restoredViaParser.episodeEvaluations);
    const reimportedEvals = await getAllEpisodeEvaluations();
    assert.equal(reimportedEvals.length, 1);

    const restoredItem = restoredViaParser.items[0];
    assert.equal(restoredItem.ids.imdb, 'tt5753856');
    assert.equal(restoredItem.ratingSource, 'manual');
    assert.deepEqual(restoredItem.tags, ['viagem-no-tempo', 'alemã']);
    assert.equal(restoredItem.franchiseLinks.length, 1);
    assert.equal(restoredItem.franchiseLinks[0].relationType, 'SPIN_OFF');

    const restoredProfile = restoredViaParser.profile;
    assert.deepEqual(restoredProfile.viewerFocus, ['Cinéfilo Curador', 'Animes']);
    assert.equal(restoredProfile.annualGoal, 40);
    assert.equal(restoredProfile.favoriteGenres[1].id, 'animes-isekai');

    // Testa também mergeSnapshots preservando episodeEvaluations
    const merged = mergeSnapshots(
      { items: [], episodeEvaluations: [] },
      restoredViaParser
    );
    assert.equal(merged.episodeEvaluations.length, 1);
  });

  it('lê e migra um backup JSON exportado na v1.0.0 sem perdas', () => {
    const v1BackupPayload = {
      schemaVersion: '1.0-cine-codice',
      tables: {
        user_profile: createLegacyProfile(),
        works: [
          createLegacyWorkWithAuto80(),
          createLegacyWorkWithReal80(),
        ],
        authors: [],
        reading_sessions: [],
        quotes_notes: [],
        reviews: [],
        journal_entries: [],
      },
      metadata: { collections: [] },
    };

    const parsed = parseAndValidateBackupText(JSON.stringify(v1BackupPayload));
    assert.equal(parsed.ok, true);
    assert.equal(parsed.detectedSchemaVersion, 4);
    assert.equal(parsed.db.schemaVersion, CODICE_SCHEMA_VERSION);
    assert.equal(parsed.items.length, 2);

    const hydratedAuto = parsed.items.find((w) => w.id === 'w-legacy-80');
    const hydratedReal = parsed.items.find((w) => w.id === 'w-real-80');
    assert.equal(hydratedAuto.ratingSource, 'legacy-default');
    assert.equal(hydratedReal.ratingSource, 'manual');
    assert.equal(hydratedAuto.ids.tmdb, 1398);

    const migrated = hydrateAppSnapshotFromDatabase(parsed.db);
    assert.deepEqual(migrated.profile.viewerFocus, ['Maratonista de Séries']);
    assert.equal(migrated.profile.annualGoal, 36);
    assert.equal(migrated.profile.favoriteGenres[3].group, 'outros');
  });
});

describe('Fase 1B — Validações R1 (Emojis e Símbolos) e Ausência de Nota 80 Automática', () => {
  it('R1: permite © ® ™ e bloqueia emojis pictográficos e símbolos ★ ✓ ✕', () => {
    assert.equal(
      findForbiddenEmojisOrSymbols('Cine C\u00F3dice \u00A9 2026 \u00AE \u2122').length,
      0
    );
    assert.equal(findForbiddenEmojisOrSymbols('Nota 10 \u2605').length, 1);
    assert.equal(findForbiddenEmojisOrSymbols('Conclu\u00EDdo \u2713').length, 1);
    assert.equal(findForbiddenEmojisOrSymbols('Fechar \u2715').length, 1);
    assert.equal(findForbiddenEmojisOrSymbols('Claquete \uD83C\uDFAC').length, 1);
  });

  it('garante que useBacklog.js e AddScreen.jsx não criam nota 80 automática em novos registros', () => {
    const useBacklogSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/hooks/useBacklog.js'),
      'utf8'
    );
    const addScreenSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/screens/AddScreen.jsx'),
      'utf8'
    );

    assert.equal(/createDefaultReviewCriteria\s*\(\s*[^)]*80/.test(useBacklogSrc), false);
    assert.equal(/newItem\.rating\s*\?\?\s*80/.test(useBacklogSrc), false);
    assert.equal(/createDefaultReviewCriteria/.test(addScreenSrc), false);
  });
});
