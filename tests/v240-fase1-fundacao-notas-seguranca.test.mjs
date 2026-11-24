import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, it } from 'node:test';

import {
  PRE_SCHEMA_MIGRATION_BACKUP_KEY,
  RELATIONAL_DB_VERSION,
  RELATIONAL_SCHEMA_VERSION_KEY,
} from '../src/api/limits.js';
import {
  clearLocalErrorLog,
  formatLocalErrorLogForCopy,
  getLocalErrorLog,
  recordLocalError,
  sanitizeErrorMessage,
} from '../src/lib/errorLogger.js';
import {
  DOMAIN_RATING_CRITERIA,
  LIFE_WORK_LABEL,
  applyCriterionChange,
  applyLifeWorkToggle,
  applyManualStarRating,
  calculateCriteriaRating,
  formatRatingSummary,
  gameRating11ToInternal,
  getCriteriaForDomain,
  internalToGameRating11,
  normalizeCriteria5,
  resolveLifeWorkFlag,
  resolveWorkRatingState,
  roundToHalfStar,
  score100ToStars,
  starsToScore100,
} from '../src/lib/ratingModel.js';
import {
  buildEmergencyBackupFromStorage,
  clearMemorySnapshotsForTests,
  listAutoSnapshots,
  restoreSnapshotWithSafety,
  saveAutoSnapshot,
  verifyAutoSnapshotIntegrity,
} from '../src/services/backupEngine.js';
import {
  mapCatalogRowToLocalWork,
  mapLocalWorkToCatalogRow,
} from '../src/services/omniSyncService.js';
import {
  clearRelationalMemoryForTests,
  getAllRelationalWorks,
  readStoredRelationalSchemaVersion,
  runRelationalSchemaMigrations,
} from '../src/services/relationalDb.js';

const ROOT_DIR = process.cwd();

function createMemoryStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

function walkFiles(dir, matcher) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full, matcher));
    } else if (matcher.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('OMNIPRISM v2.4.0 — Fase 1.1: IndexedDB versionado, migracoes aditivas e snapshot pre-mesclagem', () => {
  beforeEach(() => {
    clearRelationalMemoryForTests();
    clearMemorySnapshotsForTests();
  });

  it('migra fixtures antigas (v1.0/v1.1/v2.2/v2.3) de forma aditiva com snapshot automatico previo e idempotencia', async () => {
    const storage = createMemoryStorage();
    // Fixture mista simulando obras antigas de diferentes versões do Cine Códice / OmniPrism
    const legacyFixtures = [
      {
        // Fixture v1.0 (sem domain, sem ids estruturados, campo legado customizado)
        id: 'legacy-v1-movie',
        title: 'Blade Runner 2049',
        workType: 'movie',
        status: 'completed',
        rating: 92,
        director: 'Denis Villeneuve',
        customLegacyField: 'preservar-intacto',
      },
      {
        // Fixture v2.2 Games com nota 11 (Obra da vida) sem campo rating 0..100
        id: 'legacy-v22-game',
        title: 'Shadow of the Colossus',
        domain: 'games',
        workType: 'game',
        status: 'completed',
        gameRating11: 11,
        platform: 'PS2',
        platforms: ['PS2', 'PS4'],
      },
      {
        // Fixture v2.3 Música com trackRatings
        id: 'legacy-v23-music',
        title: 'Master of Puppets',
        domain: 'music',
        workType: 'album',
        status: 'completed',
        rating: 90,
        trackRatings: { '1': 10, '2': 9.5 },
      },
    ];

    const firstRun = await runRelationalSchemaMigrations({
      items: legacyFixtures,
      storage,
      saveSnapshotFn: saveAutoSnapshot,
      verifySnapshotFn: verifyAutoSnapshotIntegrity,
    });

    assert.equal(firstRun.ok, true);
    assert.equal(firstRun.migrated, true);
    assert.equal(firstRun.aborted, false);
    assert.equal(firstRun.fromVersion, 0);
    assert.equal(firstRun.toVersion, RELATIONAL_DB_VERSION);
    assert.equal(firstRun.snapshotSaved, true);
    assert.ok(firstRun.snapshotId);

    // Confirma snapshot gravado no IndexedDB/memória de snapshots E em localStorage
    const snapshots = await listAutoSnapshots();
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0].reason, 'pre-schema-migration');
    assert.ok(storage.getItem(PRE_SCHEMA_MIGRATION_BACKUP_KEY));
    assert.equal(readStoredRelationalSchemaVersion(storage), RELATIONAL_DB_VERSION);

    // Confirma migração estritamente aditiva sem perda de campos antigos
    const migratedWorks = await getAllRelationalWorks();
    const movie = migratedWorks.find((w) => w.id === 'legacy-v1-movie');
    assert.equal(movie.domain, 'cinema');
    assert.equal(movie.rating, 92);
    assert.equal(movie.customLegacyField, 'preservar-intacto');

    const game = migratedWorks.find((w) => w.id === 'legacy-v22-game');
    assert.equal(game.domain, 'games');
    assert.equal(game.lifeWork, true);
    assert.equal(game.rating, 100);
    assert.equal(game.gameRating11, 11);

    const album = migratedWorks.find((w) => w.id === 'legacy-v23-music');
    assert.equal(album.trackRatings['1'], 10);

    // Idempotência: segunda execução não remigra nem duplica snapshots
    const secondRun = await runRelationalSchemaMigrations({
      items: migratedWorks,
      storage,
      saveSnapshotFn: saveAutoSnapshot,
      verifySnapshotFn: verifyAutoSnapshotIntegrity,
    });
    assert.equal(secondRun.ok, true);
    assert.equal(secondRun.alreadyUpToDate, true);
    assert.equal(secondRun.migrated, false);
    assert.equal((await listAutoSnapshots()).length, 1);
  });

  it('aborta migracao mantendo dados originais intactos quando o snapshot previo falha', async () => {
    const storage = createMemoryStorage();
    const res = await runRelationalSchemaMigrations({
      items: [{ id: 'w-safe', title: 'Obra Intacta', workType: 'movie', status: 'queued' }],
      storage,
      saveSnapshotFn: async () => {
        throw new Error('QuotaExceededError');
      },
    });
    assert.equal(res.ok, false);
    assert.equal(res.aborted, true);
    assert.equal(storage.getItem(RELATIONAL_SCHEMA_VERSION_KEY), null);
  });

  it('cria snapshot automatico ANTES de restaurar backup no modo Mesclar e no modo Substituir', async () => {
    const currentWorkspace = {
      items: [
        { id: 'w-local', title: 'Duna', domain: 'reading', workType: 'book', status: 'playing', updatedAt: '2026-11-20T10:00:00.000Z' },
      ],
      profile: { displayName: 'Leitor Local' },
      posts: [],
      readingSessions: [],
      collections: [],
      episodeEvaluations: [],
    };
    const incomingSnapshot = {
      items: [
        { id: 'w-incoming', title: 'Interstellar', domain: 'cinema', workType: 'movie', status: 'completed', rating: 90, updatedAt: '2026-11-22T10:00:00.000Z' },
      ],
      profile: { displayName: 'Leitor Backup' },
      posts: [],
      readingSessions: [],
      collections: [],
      episodeEvaluations: [],
    };

    const mergedRes = await restoreSnapshotWithSafety({
      currentWorkspace,
      incomingSnapshot,
      mode: 'merge',
      saveSnapshotFn: saveAutoSnapshot,
    });

    assert.equal(mergedRes.ok, true);
    assert.equal(mergedRes.mode, 'merge');
    assert.equal(mergedRes.snapshotSaved, true);
    assert.equal(mergedRes.snapshotReason, 'pre-restore-merge');
    assert.equal(mergedRes.workspace.items.length, 2);

    const snapsAfterMerge = await listAutoSnapshots();
    assert.equal(snapsAfterMerge.length, 1);
    assert.equal(snapsAfterMerge[0].reason, 'pre-restore-merge');
    assert.equal(snapsAfterMerge[0].counts.works, 1);

    const replaceRes = await restoreSnapshotWithSafety({
      currentWorkspace: mergedRes.workspace,
      incomingSnapshot,
      mode: 'replace',
      saveSnapshotFn: saveAutoSnapshot,
    });
    assert.equal(replaceRes.ok, true);
    assert.equal(replaceRes.mode, 'replace');
    assert.equal(replaceRes.snapshotSaved, true);
    assert.equal(replaceRes.snapshotReason, 'pre-restore-replace');
    assert.equal(replaceRes.workspace.items.length, 1);
    assert.equal((await listAutoSnapshots()).length, 2);
  });
});

describe('OMNIPRISM v2.4.0 — Fase 1.2: Modelo Unico de Nota (5 Estrelas + Obra da Vida + 5 Criterios)', () => {
  it('converte com precisao entre escala interna 0..100 e 5 estrelas com meia estrela (0.5..5.0)', () => {
    assert.equal(score100ToStars(null), null);
    assert.equal(score100ToStars(undefined), null);
    assert.equal(score100ToStars(''), null);
    assert.equal(score100ToStars(0), 0);
    assert.equal(score100ToStars(1), 0.5);
    assert.equal(score100ToStars(10), 0.5);
    assert.equal(score100ToStars(20), 1.0);
    assert.equal(score100ToStars(70), 3.5);
    assert.equal(score100ToStars(72), 3.5);
    assert.equal(score100ToStars(75), 4.0);
    assert.equal(score100ToStars(88), 4.5);
    assert.equal(score100ToStars(90), 4.5);
    assert.equal(score100ToStars(100), 5.0);
    assert.equal(score100ToStars(130), 5.0);

    assert.equal(starsToScore100(null), null);
    assert.equal(starsToScore100(0), 0);
    assert.equal(starsToScore100(0.5), 10);
    assert.equal(starsToScore100(3.5), 70);
    assert.equal(starsToScore100(4.5), 90);
    assert.equal(starsToScore100(5.0), 100);
    assert.equal(roundToHalfStar(3.74), 3.5);
    assert.equal(roundToHalfStar(3.75), 4.0);
  });

  it('mantem retrocompatibilidade total entre Obra da vida (progress_data.lifeWork) e o antigo 11 de Games', () => {
    const conv11 = gameRating11ToInternal(11);
    assert.deepEqual(conv11, { score100: 100, stars: 5, lifeWork: true });
    assert.equal(internalToGameRating11(100, true), 11);
    assert.equal(internalToGameRating11(85, false), 8.5);
    assert.equal(resolveLifeWorkFlag({ gameRating11: 11 }), true);
    assert.equal(resolveLifeWorkFlag({ progress_data: { lifeWork: true } }), true);
    assert.equal(resolveLifeWorkFlag({ rating: 100 }), false);

    // Round-trip completo em catalog_works (Supabase progress_data)
    const row = mapLocalWorkToCatalogRow(
      {
        id: 'game-11',
        domain: 'games',
        workType: 'game',
        title: 'Outer Wilds',
        status: 'completed',
        rating: 100,
        lifeWork: true,
        gameRating11: 11,
        franchiseTier: 'mainline',
      },
      'user-1'
    );
    assert.equal(row.progress_data.lifeWork, true);
    assert.equal(row.progress_data.game_rating_11, 11);
    assert.equal(row.progress_data.franchiseTier, 'mainline');

    const hydrated = mapCatalogRowToLocalWork(row);
    assert.equal(hydrated.lifeWork, true);
    assert.equal(hydrated.gameRating11, 11);
    assert.equal(hydrated.rating, 100);
    assert.equal(hydrated.franchiseTier, 'mainline');
    assert.match(formatRatingSummary(hydrated), new RegExp(LIFE_WORK_LABEL));
  });

  it('define exatamente 5 criterios (20% / 1 estrela cada) para os 4 dominios e NUNCA trata ausente como zero', () => {
    for (const domain of ['cinema', 'reading', 'games', 'music']) {
      const list = getCriteriaForDomain(domain);
      assert.equal(list.length, 5, `Dominio ${domain} deve ter 5 criterios`);
      assert.equal(
        list.reduce((acc, c) => acc + c.weightPercent, 0),
        100
      );
      assert.equal(DOMAIN_RATING_CRITERIA[domain].length, 5);
    }

    // Todos ausentes -> null (nunca 0)
    const emptyCalc = calculateCriteriaRating(
      { roteiro: null, direcao: undefined, atuacoes: '', fotografia: '  ', impacto: NaN },
      'cinema'
    );
    assert.equal(emptyCalc.filledCount, 0);
    assert.equal(emptyCalc.average10, null);
    assert.equal(emptyCalc.suggestedStars, null);
    assert.equal(emptyCalc.suggestedScore100, null);

    // Apenas 1 criterio preenchido com 10 -> media 10 -> 5.0 estrelas (os 4 ausentes NAO viram zero)
    const oneFilled = calculateCriteriaRating({ roteiro: 10 }, 'cinema');
    assert.equal(oneFilled.filledCount, 1);
    assert.equal(oneFilled.average10, 10);
    assert.equal(oneFilled.suggestedStars, 5.0);
    assert.equal(oneFilled.suggestedScore100, 100);

    // Zero explicito ENTRA na media, ausentes NAO entram
    const explicitZero = calculateCriteriaRating({ gameplay: 10, narrativa: 0, arte: null }, 'games');
    assert.equal(explicitZero.filledCount, 2);
    assert.equal(explicitZero.average10, 5);
    assert.equal(explicitZero.suggestedStars, 2.5);
    assert.equal(explicitZero.suggestedScore100, 50);

    // Todos preenchidos com 0 explicito -> 0 estrelas / 0 interno (diferente de null)
    const allZero = calculateCriteriaRating({ composicao: 0, producao: 0 }, 'music');
    assert.equal(allZero.filledCount, 2);
    assert.equal(allZero.average10, 0);
    assert.equal(allZero.suggestedStars, 0);
    assert.equal(allZero.suggestedScore100, 0);

    // Normalizacao bloqueia boolean/objetos como ausente
    const norm = normalizeCriteria5({ narrativa: false, escrita: true, personagens: 8, ritmo: 7 }, 'reading');
    assert.equal(norm.narrativa, null);
    assert.equal(norm.escrita, null);
    assert.equal(norm.personagens, 8);
    assert.equal(norm.ritmo, 7);
    assert.equal(norm.impacto, null);
  });

  it('permite sobrescrever a estrela manualmente a qualquer momento sem perder criterios nem reverter automaticamente', () => {
    // Passo 1: preenche 2 criterios em Leitura -> media 8 -> 4.0 estrelas automaticas
    let state = applyCriterionChange({}, { domain: 'reading', key: 'narrativa', value: 9 });
    state = applyCriterionChange(state, { domain: 'reading', key: 'escrita', value: 7 });
    assert.equal(state.stars, 4.0);
    assert.equal(state.rating, 80);
    assert.equal(state.ratingManualOverride, false);

    // Passo 2: usuario sobrescreve manualmente para 4.5 estrelas (90)
    state = applyManualStarRating(state, 4.5, { domain: 'reading' });
    assert.equal(state.stars, 4.5);
    assert.equal(state.rating, 90);
    assert.equal(state.ratingManualOverride, true);
    assert.equal(state.reviewCriteria.narrativa, 9);
    assert.equal(state.reviewCriteria.escrita, 7);

    // Passo 3: usuario ajusta terceiro criterio -> sugestao muda para 3.5, mas override manual 4.5 permanece respeitado
    state = applyCriterionChange(state, { domain: 'reading', key: 'ritmo', value: 5 });
    assert.equal(state.criteria.suggestedStars, 3.5);
    assert.equal(state.stars, 4.5);
    assert.equal(state.rating, 90);
    assert.equal(state.ratingManualOverride, true);

    // Passo 4: marca Obra da vida sem perder a nota
    const withLife = applyLifeWorkToggle(state, true, { domain: 'reading' });
    assert.equal(withLife.lifeWork, true);
    assert.equal(withLife.rating, 90);

    // Legacy default fica sinalizado como nao confirmado
    const legacyState = resolveWorkRatingState({
      domain: 'cinema',
      rating: 80,
      ratingSource: 'legacy-default',
    });
    assert.equal(legacyState.isLegacyDefault, true);
    assert.equal(legacyState.hasConfirmedRating, false);
  });
});

describe('OMNIPRISM v2.4.0 — Fase 1.3 & 1.4: Seguranca, Error Boundary Global e Rascunhos RLS', () => {
  it('garante zero innerHTML/dangerouslySetInnerHTML e rel="noopener noreferrer" em todos os target="_blank"', () => {
    const srcFiles = walkFiles(path.join(ROOT_DIR, 'src'), /\.(js|jsx)$/);
    for (const file of srcFiles) {
      const text = fs.readFileSync(file, 'utf8');
      assert.equal(/dangerouslySetInnerHTML|\binnerHTML\b|\bouterHTML\b/.test(text), false, file);
      const blankMatches = [...text.matchAll(/target=["']_blank["']([\s\S]{0,160})/g)];
      for (const m of blankMatches) {
        assert.match(
          m[0],
          /rel=["'][^"']*noopener[^"']*noreferrer[^"']*["']/,
          `Link target="_blank" sem rel="noopener noreferrer" em ${file}`
        );
      }
    }

    // Headers de segurança
    const headersText = fs.readFileSync(path.join(ROOT_DIR, 'public/_headers'), 'utf8');
    assert.match(headersText, /X-Content-Type-Options:\s*nosniff/i);
    assert.match(headersText, /X-Frame-Options:\s*SAMEORIGIN/i);
    assert.match(headersText, /Strict-Transport-Security:/i);
    assert.match(headersText, /Content-Security-Policy:/i);

    // Documentação de segurança existente
    const secDoc = fs.readFileSync(path.join(ROOT_DIR, 'docs/SEGURANCA.md'), 'utf8');
    assert.match(secDoc, /Auditoria de Segurança/i);
    assert.match(secDoc, /noopener noreferrer/i);
  });

  it('envolve a raiz com Error Boundary global, exporta backup de emergencia e sanitiza log local de 50 erros', () => {
    const mainSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/main.jsx'), 'utf8');
    const ebSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/components/ErrorBoundary.jsx'), 'utf8');
    assert.match(mainSrc, /<ErrorBoundary\s+isGlobal/);
    assert.match(ebSrc, /Exportar backup/);
    assert.match(ebSrc, /downloadEmergencyBackupFromStorage/);

    const storage = createMemoryStorage();
    storage.setItem(
      'cine_codice_backlog_v1',
      JSON.stringify([{ id: 'em-1', title: 'Solaris', workType: 'movie', status: 'completed', rating: 90 }])
    );
    const emergencyDb = buildEmergencyBackupFromStorage(storage);
    assert.equal(emergencyDb.tables.works.length, 1);
    assert.equal(emergencyDb.tables.works[0].title, 'Solaris');

    clearLocalErrorLog({ storage });
    for (let i = 1; i <= 55; i += 1) {
      recordLocalError(`Erro ${i} com apikey=secret12345 e Bearer tok_abc`, {
        source: 'test',
        storage,
      });
    }
    const entries = getLocalErrorLog({ storage });
    assert.equal(entries.length, 50);
    assert.doesNotMatch(entries[0].message, /secret12345|tok_abc/);
    assert.match(sanitizeErrorMessage('url?api_key=XYZ123'), /\[REDACTED\]/);
    assert.match(formatLocalErrorLogForCopy(entries), /Erro 55/);
  });

  it('gera rascunhos SQL locais de RLS marcados no topo e verify_rls.sql estritamente somente leitura', () => {
    const migPath = path.join(ROOT_DIR, 'supabase/migrations/20261124_rls_catalog_works.sql');
    const verifyPath = path.join(ROOT_DIR, 'supabase/verify_rls.sql');
    const migSql = fs.readFileSync(migPath, 'utf8');
    const verifySql = fs.readFileSync(verifyPath, 'utf8');

    assert.match(migSql.slice(0, 260), /RASCUNHO:\s*revisar antes de aplicar/i);
    assert.match(migSql, /ENABLE ROW LEVEL SECURITY/i);
    assert.match(migSql, /public\.catalog_works/i);
    assert.match(migSql, /auth\.uid\(\)\s*=\s*user_id/i);
    assert.match(migSql, /bucket_id\s*=\s*'covers'/i);

    assert.match(verifySql.slice(0, 260), /RASCUNHO:\s*revisar antes de aplicar/i);
    // Remove comentários SQL antes de verificar que não há comandos de escrita
    const verifyNoComments = verifySql.replace(/--.*$/gm, '');
    assert.equal(
      /\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE|GRANT|REVOKE)\b/i.test(verifyNoComments),
      false,
      'supabase/verify_rls.sql deve ser estritamente somente leitura'
    );
    assert.match(verifyNoComments, /\bSELECT\b/i);
  });
});
