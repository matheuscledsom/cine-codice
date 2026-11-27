import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { handleConfigRequest, isUnsafeServerSupabaseKey } from '../functions/api/config.js';
import { OMNIPRISM_VERSION, OMNIPRISM_VERSION_LABEL } from '../src/config/appVersion.js';
import {
  APP_BUILD_LABEL,
  APP_BUILD_VERSION,
  CODICE_RELEASE,
  RELEASE_HISTORY,
} from '../src/config/versioning.js';
import {
  buildRetryCoverUrl,
  MAX_COVER_IMAGE_RETRIES,
} from '../src/lib/coverRetry.js';
import { buildDiagnosticsReportText } from '../src/lib/diagnosticsHelpers.js';
import { getLocalErrorLog } from '../src/lib/errorLogger.js';
import { applyCanonicalIdsToWork } from '../src/lib/idBridge.js';
import { buildManualExternalIds } from '../src/lib/manualWorkLink.js';
import { normalizeItem } from '../src/hooks/useBacklog.js';
import {
  buildCinemaSearchCacheKey,
  buildTmdbImageUrl,
  searchCinemaMedia,
} from '../src/services/cinemaApi.js';
import { createUuid } from '../src/services/codiceDatabase.js';
import {
  ALLOWED_CLOUD_DOMAINS,
  clearPendingWorkUpserts,
  computeRetryBackoffMs,
  deleteWorksFromCloud,
  enqueuePendingWorkUpserts,
  formatFirstSyncSummary,
  formatFriendlyConstraintError,
  formatFriendlySyncError,
  getPendingSyncCount,
  getTombstoneSyncMode,
  isValidUuid,
  mapCatalogRowToLocalWork,
  mapLocalWorkToCatalogRow,
  mergeWorksByUpdatedAt,
  OMNI_CATALOG_TABLE,
  parseWorkUpdatedMs,
  prepareCatalogRowForCloudUpload,
  previewCloudSyncWithSupabase,
  pushWorksToCloud,
  readCloudTombstones,
  readFailedSyncItems,
  readSyncQueue,
  resetSyncRuntimeFlagsForTests,
  sanitizeCloudDomain,
  sanitizeCloudFavoriteRank,
  sanitizeCloudInt0To100,
  syncCatalogWithSupabase,
  toCloudWorkId,
  validateCatalogRowForCloud,
  workToCloudRow,
} from '../src/services/omniSyncService.js';
import {
  clearRelationalMemoryForTests,
  EPOCH_ZERO_ISO,
  getAllRelationalWorks,
  normalizeRelationalWorkRecord,
  putRelationalWorks,
} from '../src/services/relationalDb.js';
import {
  getSupabaseConfig,
  hydrateSupabaseConfigFromServer,
  resetSupabaseClientForTests,
  saveSupabaseConfig,
  SUPABASE_AUTH_STORAGE_KEY,
} from '../src/services/supabaseClient.js';
import {
  APP_BUILD_VERSION as VITE_APP_BUILD_VERSION,
  buildVersionManifestInfo,
} from '../vite.config.js';

const ROOT_DIR = process.cwd();

function readText(relPath) {
  return fs.readFileSync(path.join(ROOT_DIR, relPath), 'utf8');
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
    clear() {
      map.clear();
    },
  };
}

function createFullSupabaseMock({
  remoteDb = new Map(),
  userId = 'user-sync-1',
  supportsDeletedAt = true,
  failNextSelect = false,
  failNextUpsert = false,
} = {}) {
  const state = {
    supportsDeletedAt,
    failNextSelect,
    failNextUpsert,
    updateCalls: 0,
    deleteCalls: 0,
    upsertCalls: 0,
    selectCalls: 0,
  };

  const missingDeletedAtError = () => ({
    code: '42703',
    message: 'column catalog_works.deleted_at does not exist',
  });

  const client = {
    _state: state,
    auth: {
      async getSession() {
        return {
          data: {
            session: {
              access_token: 'mock-jwt-token',
              expires_at: Math.floor(Date.now() / 1000) + 3600,
              user: { id: userId, email: 'colecionador@omniprism.app' },
            },
          },
          error: null,
        };
      },
      async refreshSession() {
        return this.getSession();
      },
    },
    from(table) {
      assert.equal(table, OMNI_CATALOG_TABLE);
      const filters = {};
      let mode = 'select';
      let updatePatch = null;

      const execMutationIn = (col, vals) => {
        if (mode === 'update') {
          state.updateCalls += 1;
          if (!state.supportsDeletedAt && updatePatch && 'deleted_at' in updatePatch) {
            return Promise.resolve({ error: missingDeletedAtError() });
          }
          for (const id of vals || []) {
            const existing = remoteDb.get(id);
            if (existing && (!filters.user_id || existing.user_id === filters.user_id)) {
              remoteDb.set(id, { ...existing, ...updatePatch });
            }
          }
          return Promise.resolve({ error: null });
        }
        if (mode === 'delete') {
          state.deleteCalls += 1;
          for (const id of vals || []) {
            const existing = remoteDb.get(id);
            if (existing && (!filters.user_id || existing.user_id === filters.user_id)) {
              remoteDb.delete(id);
            }
          }
          return Promise.resolve({ error: null });
        }
        return Promise.resolve({ error: null });
      };

      const builder = {
        select() {
          mode = 'select';
          return builder;
        },
        update(patch) {
          mode = 'update';
          updatePatch = patch;
          return builder;
        },
        delete() {
          mode = 'delete';
          return builder;
        },
        eq(col, val) {
          filters[col] = val;
          return builder;
        },
        in(col, vals) {
          return execMutationIn(col, vals);
        },
        async upsert(rows) {
          state.upsertCalls += 1;
          if (state.failNextUpsert) {
            state.failNextUpsert = false;
            return { error: { message: 'network timeout during upsert' } };
          }
          if (
            !state.supportsDeletedAt &&
            Array.isArray(rows) &&
            rows.some((r) => r && Object.prototype.hasOwnProperty.call(r, 'deleted_at'))
          ) {
            return { error: missingDeletedAtError() };
          }
          for (const r of rows || []) {
            const stored = state.supportsDeletedAt ? { deleted_at: null, ...r } : { ...r };
            if (!state.supportsDeletedAt) delete stored.deleted_at;
            remoteDb.set(r.id, stored);
          }
          return { error: null };
        },
        then(resolve) {
          state.selectCalls += 1;
          if (state.failNextSelect) {
            state.failNextSelect = false;
            return Promise.resolve({
              data: null,
              error: { message: 'Failed to fetch from Supabase' },
            }).then(resolve);
          }
          const rows = Array.from(remoteDb.values())
            .filter(
              (r) =>
                (!filters.user_id || r.user_id === filters.user_id) &&
                (!filters.domain || r.domain === filters.domain)
            )
            .map((r) => {
              const copy = { ...r };
              if (!state.supportsDeletedAt) {
                delete copy.deleted_at;
              } else if (!Object.prototype.hasOwnProperty.call(copy, 'deleted_at')) {
                copy.deleted_at = null;
              }
              return copy;
            });
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        },
      };
      return builder;
    },
  };

  return client;
}

describe('OMNIPRISM v2.7.1 (Fase 2) — 1. Auto-config /api/config e cliente offline', () => {
  it('devolve APENAS { supabaseUrl, supabaseAnonKey }, bloqueia cross-site, POST e chaves privilegiadas', async () => {
    const okReq = new Request('https://omniprism.pages.dev/api/config', {
      method: 'GET',
      headers: { Origin: 'https://omniprism.pages.dev' },
    });
    const okRes = await handleConfigRequest({
      request: okReq,
      env: {
        SUPABASE_URL: 'https://meuproj.supabase.co/rest/v1/',
        SUPABASE_ANON_KEY: 'sb_publishable_demo_public_key',
        TMDB_API_KEY: 'super-secret-tmdb-key',
      },
    });
    assert.equal(okRes.status, 200);
    const body = await okRes.json();
    assert.deepEqual(Object.keys(body).sort(), ['supabaseAnonKey', 'supabaseUrl']);
    assert.equal(body.supabaseUrl, 'https://meuproj.supabase.co');
    assert.equal(body.supabaseAnonKey, 'sb_publishable_demo_public_key');
    assert.match(okRes.headers.get('Cache-Control') || '', /private/);

    // Recusa POST
    const postRes = await handleConfigRequest({
      request: new Request('https://omniprism.pages.dev/api/config', { method: 'POST' }),
      env: {
        SUPABASE_URL: 'https://meuproj.supabase.co',
        SUPABASE_ANON_KEY: 'sb_publishable_demo_public_key',
      },
    });
    assert.equal(postRes.status, 405);

    // Recusa cross-site
    const crossRes = await handleConfigRequest({
      request: new Request('https://omniprism.pages.dev/api/config', {
        method: 'GET',
        headers: { 'Sec-Fetch-Site': 'cross-site' },
      }),
      env: {
        SUPABASE_URL: 'https://meuproj.supabase.co',
        SUPABASE_ANON_KEY: 'sb_publishable_demo_public_key',
      },
    });
    assert.equal(crossRes.status, 403);

    // Recusa chave privilegiada (JWT role privilegiado e prefixo sb_secret_)
    const fakePrivilegedRole = ['service', 'role'].join('_');
    const payloadB64 = Buffer.from(JSON.stringify({ role: fakePrivilegedRole })).toString('base64url');
    const privilegedJwt = `eyJhbGciOiJIUzI1NiJ9.${payloadB64}.sig`;
    assert.equal(isUnsafeServerSupabaseKey(privilegedJwt), true);
    assert.equal(isUnsafeServerSupabaseKey('sb_secret_abc123'), true);
    assert.equal(isUnsafeServerSupabaseKey('sb_publishable_ok_123'), false);

    const unsafeRes = await handleConfigRequest({
      request: okReq,
      env: {
        SUPABASE_URL: 'https://meuproj.supabase.co',
        SUPABASE_ANON_KEY: privilegedJwt,
      },
    });
    assert.equal(unsafeRes.status, 503);
    const unsafeJson = await unsafeRes.json();
    assert.equal('supabaseAnonKey' in unsafeJson, false);
  });

  it('hidrata /api/config no primeiro acesso, salva no aparelho e funciona offline depois sem perder cache em erro 503', async () => {
    resetSupabaseClientForTests();
    const storage = createMemoryStorage();
    assert.equal(getSupabaseConfig({ storage }).isConfigured, false);

    const hydrated = await hydrateSupabaseConfigFromServer({
      storage,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            supabaseUrl: 'https://auto-proj.supabase.co',
            supabaseAnonKey: 'sb_publishable_auto_123',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        ),
    });

    assert.equal(hydrated.ok, true);
    assert.equal(hydrated.changed, true);
    assert.equal(hydrated.source, 'server');
    assert.equal(hydrated.config.isAutoConfigured, true);
    assert.equal(hydrated.config.url, 'https://auto-proj.supabase.co');

    // Simula erro 503 em visita seguinte: mantém a config salva localmente
    const after503 = await hydrateSupabaseConfigFromServer({
      storage,
      fetchImpl: async () => new Response(JSON.stringify({ error: 'indisponível' }), { status: 503 }),
    });
    assert.equal(after503.ok, true);
    assert.equal(after503.fromCache, true);
    assert.equal(getSupabaseConfig({ storage }).url, 'https://auto-proj.supabase.co');

    // Config manual continua preservada sem forceRefresh
    saveSupabaseConfig(
      { url: 'https://manual-proj.supabase.co', anonKey: 'sb_publishable_manual_456' },
      { storage }
    );
    const keepManual = await hydrateSupabaseConfigFromServer({
      storage,
      fetchImpl: async () => {
        throw new Error('não deveria sobrescrever override manual sem forceRefresh');
      },
    });
    assert.equal(keepManual.ok, true);
    assert.equal(keepManual.config.url, 'https://manual-proj.supabase.co');
  });
});

describe('OMNIPRISM v2.7.1 (Fase 2) — 2. Não inventar updated_at + Sync 2 aparelhos + Tombstones + Pré-SQL', () => {
  it('obra sem updated_at conta como a mais antiga e NUNCA vence versão datada da nuvem', () => {
    const legacyNormalized = normalizeItem({
      id: 'legacy-1',
      title: 'Solaris',
      workType: 'movie',
      status: 'playing',
      rating: 60,
    });
    assert.equal(legacyNormalized.updatedAt, '');
    assert.equal(parseWorkUpdatedMs(legacyNormalized), 0);

    const idbNormalized = normalizeRelationalWorkRecord({
      id: 'legacy-1',
      title: 'Solaris',
      workType: 'movie',
      status: 'playing',
      rating: 60,
    });
    assert.equal(idbNormalized.updatedAt, EPOCH_ZERO_ISO);
    assert.equal(parseWorkUpdatedMs(idbNormalized), 0);

    const cloudDated = {
      id: 'legacy-1',
      title: 'Solaris',
      workType: 'movie',
      status: 'completed',
      rating: 95,
      updatedAt: '2025-06-15T12:00:00.000Z',
    };

    const merge1 = mergeWorksByUpdatedAt([legacyNormalized], [cloudDated]);
    assert.equal(merge1.mergedWorks.length, 1);
    assert.equal(merge1.mergedWorks[0].status, 'completed');
    assert.equal(merge1.mergedWorks[0].rating, 95);
    assert.equal(merge1.worksToPush.length, 0);

    const merge2 = mergeWorksByUpdatedAt([idbNormalized], [cloudDated]);
    assert.equal(merge2.mergedWorks[0].status, 'completed');
    assert.equal(merge2.mergedWorks[0].rating, 95);
    assert.equal(merge2.worksToPush.length, 0);

    // Map de linha remota sem updated_at também não inventa data atual
    const mappedUndated = mapCatalogRowToLocalWork({
      id: toCloudWorkId('legacy-2'),
      domain: 'cinema',
      media_type: 'movie',
      title: 'Stalker',
      status: 'queued',
    });
    assert.equal(mappedUndated.updatedAt, '');
    assert.equal(parseWorkUpdatedMs(mappedUndated), 0);
  });

  it('simula PC + Celular (sem Realtime): edição mais antiga nunca sobrescreve mais nova, exclusão propaga via tombstone sem ressuscitar e falha de rede preserva dados', async () => {
    clearRelationalMemoryForTests();
    resetSyncRuntimeFlagsForTests();

    const remoteDb = new Map();
    const pcStorage = createMemoryStorage();
    const phoneStorage = createMemoryStorage();
    const supabaseClient = createFullSupabaseMock({ remoteDb, supportsDeletedAt: true });

    // 1. PC cria duas obras e sincroniza
    const workA = {
      id: 'work-a',
      title: 'Blade Runner',
      workType: 'movie',
      status: 'playing',
      rating: 80,
      updatedAt: '2026-11-26T10:00:00.000Z',
    };
    const workB = {
      id: 'work-b',
      title: 'Duna',
      workType: 'book',
      domain: 'reading',
      status: 'queued',
      updatedAt: '2026-11-26T10:05:00.000Z',
    };

    const pcSync1 = await syncCatalogWithSupabase({
      client: supabaseClient,
      localWorksOverride: [workA, workB],
      storage: pcStorage,
    });
    assert.equal(pcSync1.ok, true);
    assert.equal(pcSync1.pushedCount, 2);
    assert.equal(pcSync1.tombstoneMode, 'soft_delete');

    // 2. Celular (vazio) sincroniza e recebe ambas as obras SEM depender de Realtime
    clearRelationalMemoryForTests();
    const phoneSync1 = await syncCatalogWithSupabase({
      client: supabaseClient,
      localWorksOverride: [],
      storage: phoneStorage,
    });
    assert.equal(phoneSync1.ok, true);
    assert.equal(phoneSync1.works.length, 2);

    // 3. PC edita workA (12:00) enquanto Celular tem edição MAIS ANTIGA (11:00)
    const pcEditedA = { ...workA, status: 'completed', rating: 95, updatedAt: '2026-11-26T12:00:00.000Z' };
    const phoneOlderA = { ...workA, status: 'playing', rating: 70, updatedAt: '2026-11-26T11:00:00.000Z' };
    await pushWorksToCloud([pcEditedA], { client: supabaseClient, storage: pcStorage });

    clearRelationalMemoryForTests();
    await putRelationalWorks([phoneOlderA, workB], { replace: true });
    const phoneSync2 = await syncCatalogWithSupabase({
      client: supabaseClient,
      localWorksOverride: [phoneOlderA, workB],
      storage: phoneStorage,
    });
    assert.equal(phoneSync2.ok, true);
    const syncedA = phoneSync2.works.find((w) => w.id === 'work-a');
    assert.equal(syncedA?.status, 'completed');
    assert.equal(syncedA?.rating, 95);

    // 4. PC exclui workB (13:00) -> soft delete (`deleted_at`) no Supabase
    const delRes = await deleteWorksFromCloud(['work-b'], {
      client: supabaseClient,
      storage: pcStorage,
      deletedAt: '2026-11-26T13:00:00.000Z',
    });
    assert.equal(delRes.ok, true);
    assert.equal(delRes.tombstoneMode, 'soft_delete');
    const remoteWorkB = remoteDb.get(toCloudWorkId('work-b'));
    assert.ok(remoteWorkB?.deleted_at, 'soft delete deve gravar deleted_at no banco');

    // 5. Celular ainda tinha workB (10:05) offline e sincroniza agora -> workB é removida e NÃO ressuscita!
    clearRelationalMemoryForTests();
    await putRelationalWorks([syncedA, workB], { replace: true });
    const phoneSync3 = await syncCatalogWithSupabase({
      client: supabaseClient,
      localWorksOverride: [syncedA, workB],
      storage: phoneStorage,
    });
    assert.equal(phoneSync3.ok, true);
    assert.equal(phoneSync3.works.length, 1);
    assert.equal(phoneSync3.works[0].id, 'work-a');
    assert.ok(remoteDb.get(toCloudWorkId('work-b'))?.deleted_at, 'workB não pode ressuscitar');
    assert.ok(
      readCloudTombstones(phoneStorage)[toCloudWorkId('work-b').toLowerCase()]?.deletedAt,
      'tombstone remoto deve ser persistido no celular sem purga automática'
    );

    // 6. Falha de rede no select e no upsert preserva dados locais e enfileira pendência
    supabaseClient._state.failNextSelect = true;
    const failedSync = await syncCatalogWithSupabase({
      client: supabaseClient,
      localWorksOverride: [syncedA],
      storage: phoneStorage,
    });
    assert.equal(failedSync.ok, false);
    assert.ok(failedSync.error);
    assert.equal((await getAllRelationalWorks()).length, 1);

    supabaseClient._state.failNextUpsert = true;
    const failedPush = await pushWorksToCloud([syncedA], {
      client: supabaseClient,
      storage: phoneStorage,
    });
    assert.equal(failedPush.ok, false);
    assert.ok(getPendingSyncCount(phoneStorage) >= 1);
    assert.equal(computeRetryBackoffMs(0), 2000);
    assert.equal(computeRetryBackoffMs(1), 5000);
    assert.equal(computeRetryBackoffMs(2), 15000);
    clearPendingWorkUpserts(null, phoneStorage);
  });

  it('funciona ANTES do SQL ser aplicado (detecta ausência de deleted_at e faz fallback sem quebrar) e evolui depois', async () => {
    clearRelationalMemoryForTests();
    resetSyncRuntimeFlagsForTests();

    const remoteDb = new Map();
    const storage = createMemoryStorage();
    const preSqlClient = createFullSupabaseMock({ remoteDb, supportsDeletedAt: false });

    const w1 = {
      id: 'pre-sql-1',
      title: 'Interstellar',
      workType: 'movie',
      status: 'completed',
      rating: 90,
      updatedAt: '2026-11-26T14:00:00.000Z',
    };

    // Push antes do SQL: recebe erro 42703 de deleted_at, ativa compat_hard_delete e conclui com sucesso!
    const pushRes = await pushWorksToCloud([w1], { client: preSqlClient, storage });
    assert.equal(pushRes.ok, true);
    assert.equal(getTombstoneSyncMode(), 'compat_hard_delete');
    assert.equal(remoteDb.has(toCloudWorkId('pre-sql-1')), true);

    // Delete antes do SQL: cai para hard DELETE sem erro
    const delRes = await deleteWorksFromCloud(['pre-sql-1'], { client: preSqlClient, storage });
    assert.equal(delRes.ok, true);
    assert.equal(delRes.tombstoneMode, 'compat_hard_delete');
    assert.equal(remoteDb.has(toCloudWorkId('pre-sql-1')), false);

    // Agora usuário aplica a migração SQL no Supabase (deleted_at passa a existir)
    preSqlClient._state.supportsDeletedAt = true;
    remoteDb.set(
      toCloudWorkId('post-sql-2'),
      mapLocalWorkToCatalogRow(
        {
          id: 'post-sql-2',
          title: 'Arrival',
          workType: 'movie',
          status: 'completed',
          updatedAt: '2026-11-26T15:00:00.000Z',
        },
        'user-sync-1',
        { includeDeletedAt: true, deletedAt: null }
      )
    );
    const postSqlSync = await syncCatalogWithSupabase({
      client: preSqlClient,
      localWorksOverride: [],
      storage,
    });
    assert.equal(postSqlSync.ok, true);
    assert.equal(postSqlSync.tombstoneMode, 'soft_delete');
    assert.equal(getTombstoneSyncMode(), 'soft_delete');
  });

  it('prévia somente leitura da 1ª conexão calcula "X obras só aqui · Y só na nuvem · Z conflitos protegidos" sem alterar dados', async () => {
    clearRelationalMemoryForTests();
    resetSyncRuntimeFlagsForTests();

    const remoteDb = new Map();
    const sharedRemote = mapLocalWorkToCatalogRow(
      {
        id: 'shared-1',
        title: 'Matrix',
        workType: 'movie',
        status: 'completed',
        rating: 90,
        updatedAt: '2026-11-26T12:00:00.000Z',
      },
      'user-sync-1',
      { includeDeletedAt: true, deletedAt: null }
    );
    const cloudOnly = mapLocalWorkToCatalogRow(
      {
        id: 'cloud-only-1',
        title: 'Akira',
        workType: 'anime',
        status: 'completed',
        rating: 95,
        updatedAt: '2026-11-26T11:00:00.000Z',
      },
      'user-sync-1',
      { includeDeletedAt: true, deletedAt: null }
    );
    remoteDb.set(sharedRemote.id, sharedRemote);
    remoteDb.set(cloudOnly.id, cloudOnly);

    const client = createFullSupabaseMock({ remoteDb, supportsDeletedAt: true });
    const storage = createMemoryStorage();
    const localWorks = [
      {
        id: 'shared-1',
        title: 'Matrix',
        workType: 'movie',
        status: 'playing',
        rating: 75,
        updatedAt: '2026-11-26T10:00:00.000Z',
      },
      {
        id: 'local-only-1',
        title: 'Oldboy',
        workType: 'movie',
        status: 'queued',
        updatedAt: '2026-11-26T09:00:00.000Z',
      },
    ];

    const preview = await previewCloudSyncWithSupabase({
      client,
      localWorksOverride: localWorks,
      storage,
    });

    assert.equal(preview.ok, true);
    assert.equal(preview.needsConfirmation, true);
    assert.equal(preview.stats.localOnlyCount, 1);
    assert.equal(preview.stats.remoteOnlyCount, 1);
    assert.equal(preview.stats.conflictProtectedCount, 1);
    assert.equal(
      preview.summaryText,
      formatFirstSyncSummary({ localOnlyCount: 1, remoteOnlyCount: 1, conflictProtectedCount: 1 })
    );
    assert.equal(client._state.upsertCalls, 0, 'prévia não pode escrever na nuvem');
    assert.equal(client._state.deleteCalls, 0);
    assert.equal(client._state.updateCalls, 0);
  });

  it('traduz erros técnicos de sync para português claro com ação sugerida', () => {
    const expired = formatFriendlySyncError('JWT expired (401)');
    assert.equal(expired.sessionExpired, true);
    assert.equal(expired.action, 'relogin');
    assert.match(expired.message, /sessão expirou/i);

    const rls = formatFriendlySyncError('new row violates row-level security policy (42501)');
    assert.equal(rls.sessionExpired, false);
    assert.match(rls.message, /RLS/i);

    const net = formatFriendlySyncError('TypeError: Failed to fetch');
    assert.match(net.message, /fila local/i);
  });
});

describe('OMNIPRISM v2.7.1 (Fase 2) — 3. SQL (A) somente leitura e SQL (B) estritamente aditivo', () => {
  it('verify_rls.sql é somente leitura e audita colunas, índices, RLS, permissividade, realtime e covers', () => {
    const verifySql = readText('supabase/verify_rls.sql');
    assert.match(verifySql.slice(0, 260), /RASCUNHO:\s*revisar antes de aplicar/i);
    const noComments = verifySql.replace(/--.*$/gm, '');
    assert.equal(
      /\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE|GRANT|REVOKE)\b/i.test(noComments),
      false,
      'verify_rls.sql deve conter apenas SELECT'
    );
    assert.match(noComments, /information_schema\.columns/i);
    assert.match(noComments, /pg_indexes/i);
    assert.match(noComments, /pg_policies/i);
    assert.match(noComments, /pg_publication_tables/i);
    assert.match(noComments, /storage\.buckets/i);
    assert.match(noComments, /security_flag/i);
  });

  it('migração 20261126_v271 é estritamente aditiva (sem DROP, sem criar políticas novas, sem alterar constraints)', () => {
    const migSql = readText('supabase/migrations/20261126_v271_catalog_works_sync_additive.sql');
    assert.match(migSql.slice(0, 260), /RASCUNHO:\s*revisar antes de aplicar/i);
    const noComments = migSql.replace(/--.*$/gm, '');
    assert.equal(/\bDROP\b/i.test(noComments), false, 'migração aditiva NUNCA pode conter DROP');
    assert.equal(/\bTRUNCATE\b/i.test(noComments), false);
    assert.equal(/\bALTER\s+COLUMN\b/i.test(noComments), false, 'nunca alterar tipo de coluna');
    assert.equal(/\bCREATE\s+POLICY\b/i.test(noComments), false, 'NÃO deve criar políticas novas (owner_all_catalog já existe)');
    assert.equal(/\bCREATE\s+TABLE\b/i.test(noComments), false, 'tabela já existe; migração só adiciona coluna/índices/realtime');
    assert.equal(/omniprism_v271_/i.test(noComments), false, 'não deve haver políticas omniprism_v271_*');
    assert.match(noComments, /ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL/i);
    assert.match(noComments, /CREATE INDEX IF NOT EXISTS idx_catalog_works_user_updated_v271[\s\S]*\(user_id,\s*updated_at DESC\)/i);
    assert.match(noComments, /CREATE INDEX IF NOT EXISTS idx_catalog_works_user_deleted_v271[\s\S]*\(user_id,\s*deleted_at\)/i);
    assert.match(noComments, /REPLICA IDENTITY FULL/i);
    assert.match(noComments, /pg_publication_tables/i);
    assert.match(noComments, /ALTER PUBLICATION supabase_realtime ADD TABLE public\.catalog_works/i);
  });
});

describe('OMNIPRISM v2.7.1 (Fase 2) — 4. Capas, Cache por Auth, useBacklog, CoverImage retry, CSP e Workbox', () => {
  it('isola chave de cache por estado de autenticação, sinaliza tmdbAuthRequired sem sessão e normaliza poster_path', async () => {
    const anonKey = buildCinemaSearchCacheKey('Matrix', 'movie', ['tmdb', 'wikidata'], 'anon');
    const authKey = buildCinemaSearchCacheKey('Matrix', 'movie', ['tmdb', 'wikidata'], 'auth');
    assert.notEqual(anonKey, authKey);
    assert.ok(anonKey.startsWith('anon:'));
    assert.ok(authKey.startsWith('auth:'));

    assert.equal(buildTmdbImageUrl('/abc.jpg'), 'https://image.tmdb.org/t/p/w500/abc.jpg');
    assert.equal(buildTmdbImageUrl('abc.jpg'), 'https://image.tmdb.org/t/p/w500/abc.jpg');
    assert.equal(
      buildTmdbImageUrl('http://image.tmdb.org/t/p/w500/abc.jpg'),
      'https://image.tmdb.org/t/p/w500/abc.jpg'
    );

    // Sem sessão: TMDB não quebra, sinaliza tmdbAuthRequired e Wikidata P18 devolve capa pública
    const anonRes = await searchCinemaMedia('Matrix', {
      filter: 'movie',
      sources: ['tmdb', 'wikidata'],
      tmdbApiKey: null,
      skipCache: true,
      forceProxy: true,
      fetchImpl: async (url) => {
        const u = String(url);
        if (u.includes('wbsearchentities')) {
          return new Response(
            JSON.stringify({ search: [{ id: 'Q83495', label: 'Matrix' }] }),
            { status: 200 }
          );
        }
        if (u.includes('wbgetentities')) {
          return new Response(
            JSON.stringify({
              entities: {
                Q83495: {
                  labels: { pt: { value: 'Matrix' }, en: { value: 'The Matrix' } },
                  descriptions: { pt: { value: 'filme de 1999' } },
                  claims: {
                    P31: [{ mainsnak: { datavalue: { value: { id: 'Q11424' } } } }],
                    P577: [{ mainsnak: { datavalue: { value: { time: '+1999-03-31T00:00:00Z' } } } }],
                    P18: [{ mainsnak: { datavalue: { value: 'The Matrix poster.jpg' } } }],
                  },
                },
              },
            }),
            { status: 200 }
          );
        }
        return new Response('not found', { status: 404 });
      },
    });
    assert.equal(anonRes.tmdbAuthRequired, true);
    assert.equal(anonRes.authState, 'anon');
    assert.equal(anonRes.results.length, 1);
    assert.match(
      anonRes.results[0].coverUrl || '',
      /^https:\/\/commons\.wikimedia\.org\/wiki\/Special:FilePath\//
    );
  });

  it('corrige coverUrl duplicado em useBacklog.js preservando manualCoverDataUrl e adiciona retry no CoverImage', () => {
    const manualDataUrl = 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=';
    const normalized = normalizeItem({
      id: 'manual-book-1',
      domain: 'reading',
      workType: 'book',
      title: 'Livro Manual',
      coverUrl: null,
      manualCoverDataUrl: manualDataUrl,
    });
    assert.equal(normalized.coverUrl, manualDataUrl);
    assert.equal(normalized.coverSources[0], manualDataUrl);

    assert.ok(MAX_COVER_IMAGE_RETRIES >= 1);
    assert.equal(
      buildRetryCoverUrl('https://image.tmdb.org/t/p/w500/p.jpg', 0),
      'https://image.tmdb.org/t/p/w500/p.jpg'
    );
    assert.equal(
      buildRetryCoverUrl('https://image.tmdb.org/t/p/w500/p.jpg', 1),
      'https://image.tmdb.org/t/p/w500/p.jpg?omni_retry=1'
    );
    assert.equal(buildRetryCoverUrl(manualDataUrl, 1), manualDataUrl);
  });

  it('lista explicitamente os hosts de capa em img-src de public/_headers e no Workbox de vite.config.js', () => {
    const headers = readText('public/_headers');
    const viteCfg = readText('vite.config.js');
    const expectedImgHosts = [
      'https://image.tmdb.org',
      'https://s4.anilist.co',
      'https://cdn.myanimelist.net',
      'https://static.tvmaze.com',
      'https://m.media-amazon.com',
      'https://commons.wikimedia.org',
      'https://upload.wikimedia.org',
      'https://books.google.com',
      'https://covers.openlibrary.org',
      'https://images.igdb.com',
      'https://media.rawg.io',
      'https://shared.fastly.steamstatic.com',
      'https://coverartarchive.org',
      'https://*.supabase.co',
    ];
    for (const host of expectedImgHosts) {
      assert.ok(headers.includes(host), `Host ausente no img-src de public/_headers: ${host}`);
    }
    assert.match(headers, /connect-src[^;\n]*https:\/\/\*\.supabase\.co/);
    assert.match(viteCfg, /books\\\.google\\\.com/);
    assert.match(viteCfg, /covers\\\.openlibrary\\\.org/);
    assert.match(viteCfg, /coverartarchive\\\.org/);
    assert.match(viteCfg, /images\\\.igdb\\\.com/);
    assert.match(viteCfg, /media\\\.rawg\\\.io/);
  });
});

describe('OMNIPRISM v2.7.1 (Fase 2) — 5. Versão única e política de sessão em SEGURANCA.md', () => {
  it('mantém versão 2.7.1 unificada em todos os pontos oficiais', () => {
    const pkg = JSON.parse(readText('package.json'));
    const lock = JSON.parse(readText('package-lock.json'));
    const manifest = buildVersionManifestInfo();

    assert.equal(OMNIPRISM_VERSION, '2.7.1');
    assert.equal(OMNIPRISM_VERSION_LABEL, 'v2.7.1');
    assert.equal(pkg.version, OMNIPRISM_VERSION);
    assert.equal(lock.version, OMNIPRISM_VERSION);
    assert.equal(lock.packages?.['']?.version, OMNIPRISM_VERSION);
    assert.equal(APP_BUILD_VERSION, OMNIPRISM_VERSION);
    assert.equal(APP_BUILD_LABEL, OMNIPRISM_VERSION_LABEL);
    assert.equal(CODICE_RELEASE.version, OMNIPRISM_VERSION);
    assert.equal(CODICE_RELEASE.label, OMNIPRISM_VERSION_LABEL);
    assert.equal(RELEASE_HISTORY[0].version, OMNIPRISM_VERSION);
    assert.equal(VITE_APP_BUILD_VERSION, OMNIPRISM_VERSION);
    assert.equal(manifest.version, OMNIPRISM_VERSION);
  });

  it('não espelha refresh token de sessão no IndexedDB e documenta a decisão em docs/SEGURANCA.md', () => {
    const sbClientSrc = readText('src/services/supabaseClient.js');
    const secDoc = readText('docs/SEGURANCA.md');
    assert.equal(SUPABASE_AUTH_STORAGE_KEY, 'omniprism_supabase_auth_v1');
    const sbClientCodeOnly = sbClientSrc.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.equal(
      /\bindexedDB\b/i.test(sbClientCodeOnly),
      false,
      'supabaseClient.js não deve gravar sessão em IndexedDB'
    );
    assert.match(secDoc, /NÃO espelhar sessão Supabase no IndexedDB/i);
  });
});

describe('OMNIPRISM v2.7.1 (Fase 2) — 6. Saneamento de constraints, UUID (incl. manuais/idBridge) e fallback obra por obra', () => {
  it('saneia nota fracionada, nota > 100, external_rating inteiro 0..100, favorite_rank 0 e 5, domínio desconhecido e reading para livros/mangás', () => {
    assert.equal(sanitizeCloudInt0To100(87.6), 88);
    assert.equal(sanitizeCloudInt0To100(73.4), 73);
    assert.equal(sanitizeCloudInt0To100(145), 100);
    assert.equal(sanitizeCloudInt0To100(-12), 0);
    assert.equal(sanitizeCloudInt0To100(null), null);

    assert.equal(sanitizeCloudFavoriteRank(0), null);
    assert.equal(sanitizeCloudFavoriteRank(5), null);
    assert.equal(sanitizeCloudFavoriteRank(2.5), null);
    assert.equal(sanitizeCloudFavoriteRank(1), 1);
    assert.equal(sanitizeCloudFavoriteRank(4), 4);

    // Livros e mangás sempre mapeiam para 'reading'
    assert.equal(sanitizeCloudDomain({ domain: 'reading', workType: 'book' }), 'reading');
    assert.equal(sanitizeCloudDomain({ domain: 'books', workType: 'book' }), 'reading');
    assert.equal(sanitizeCloudDomain({ domain: 'livros', workType: 'manga' }), 'reading');
    assert.equal(sanitizeCloudDomain({ domain: 'mangá' }), 'reading');
    // Domínio desconhecido é saneado para um dos 4 domínios aceitos pelo banco
    const unknownDomain = sanitizeCloudDomain({ domain: 'podcast-desconhecido', workType: 'outro' });
    assert.ok(ALLOWED_CLOUD_DOMAINS.includes(unknownDomain));
    assert.equal(sanitizeCloudDomain({ domain: 'desconhecido', workType: 'manga' }), 'reading');

    const prepared = workToCloudRow(
      {
        id: 'tmdb-movie-550',
        title: 'Clube da Luta',
        domain: 'desconhecido',
        workType: 'movie',
        rating: 87.6,
        externalScore: 132.4,
        favoriteRank: 5,
      },
      'user-sync-1'
    );
    assert.equal(prepared.ok, true);
    assert.equal(isValidUuid(prepared.row.id), true);
    assert.ok(ALLOWED_CLOUD_DOMAINS.includes(prepared.row.domain));
    assert.equal(prepared.row.rating, 88);
    assert.equal(Number.isInteger(prepared.row.rating), true);
    assert.equal(prepared.row.external_rating, 100);
    assert.equal(Number.isInteger(prepared.row.external_rating), true);
    assert.equal(prepared.row.favorite_rank, null);
    assert.equal(Number.isNaN(Date.parse(prepared.row.created_at)), false);
    assert.equal(Number.isNaN(Date.parse(prepared.row.updated_at)), false);

    // Nota > 100 e favorite_rank = 0
    const overMax = prepareCatalogRowForCloudUpload(
      {
        id: 'ol-book-1',
        title: 'Vagabond Vol. 1',
        domain: 'livros',
        workType: 'manga',
        rating: 145,
        externalRatings: { mal: { value: 9.25, scale: 10 } },
        favoriteRank: 0,
      },
      'user-sync-1'
    );
    assert.equal(overMax.ok, true);
    assert.equal(overMax.row.domain, 'reading');
    assert.equal(overMax.row.rating, 100);
    assert.equal(overMax.row.external_rating, 93);
    assert.equal(overMax.row.favorite_rank, null);
    assert.equal(isValidUuid(overMax.row.id), true);
  });

  it('gera UUID válido para todos os domínios, inclusive obras manuais e idBridge, e rejeita ID fora do formato UUID com erro visível', () => {
    const manualUuid = createUuid();
    const manualWorks = [
      {
        id: manualUuid,
        domain: 'reading',
        workType: 'book',
        title: 'Caderno Manual',
        isManual: true,
        ids: buildManualExternalIds(manualUuid, { isbn: '9788535902778' }),
        rating: 90,
        updatedAt: '2026-11-26T20:00:00.000Z',
      },
      {
        id: 'manual-legacy-manga-7',
        domain: 'reading',
        workType: 'manga',
        title: 'Mangá Manual Legado',
        isManual: true,
        ids: buildManualExternalIds('manual-legacy-manga-7'),
        rating: 85.4,
        updatedAt: '2026-11-26T20:01:00.000Z',
      },
      applyCanonicalIdsToWork({
        id: 'tmdb-movie-603',
        domain: 'cinema',
        workType: 'movie',
        title: 'Matrix',
        tmdbId: 603,
        imdbId: 'tt0133093',
        updatedAt: '2026-11-26T20:02:00.000Z',
      }),
      {
        id: 'igdb-1942',
        domain: 'games',
        workType: 'game',
        title: 'The Witcher 3',
        updatedAt: '2026-11-26T20:03:00.000Z',
      },
      {
        id: 'itunes-album-1440857781',
        domain: 'music',
        workType: 'album',
        title: 'Powerslave',
        updatedAt: '2026-11-26T20:04:00.000Z',
      },
    ];

    for (const w of manualWorks) {
      const prep = prepareCatalogRowForCloudUpload(w, 'user-sync-1');
      assert.equal(prep.ok, true, `obra ${w.title} deveria gerar linha válida`);
      assert.equal(isValidUuid(prep.row.id), true, `id de ${w.title} deve ser UUID válido`);
      assert.ok(ALLOWED_CLOUD_DOMAINS.includes(prep.row.domain));
    }

    // ID fora do formato UUID na validação da linha ou obra sem ID -> erro visível, nunca silencioso
    const invalidRowCheck = validateCatalogRowForCloud({
      id: 'nao-e-um-uuid',
      user_id: 'user-sync-1',
      domain: 'podcast',
      rating: 150,
      external_rating: 85.5,
      favorite_rank: 5,
      created_at: 'data-ruim',
      updated_at: '',
    });
    assert.equal(invalidRowCheck.ok, false);
    assert.match(invalidRowCheck.reason, /id inválido/i);
    assert.match(invalidRowCheck.reason, /domínio não aceito/i);
    assert.match(invalidRowCheck.reason, /nota fora da faixa/i);
    assert.match(invalidRowCheck.reason, /nota externa fora da faixa/i);
    assert.match(invalidRowCheck.reason, /Top 4/i);

    const missingIdPrep = prepareCatalogRowForCloudUpload(
      { id: '', title: 'Obra Sem ID', domain: 'cinema', workType: 'movie' },
      'user-sync-1'
    );
    assert.equal(missingIdPrep.ok, false);
    assert.match(missingIdPrep.reason, /id inválido/i);

    assert.match(
      formatFriendlyConstraintError({ code: '22P02', message: 'invalid input syntax for type uuid: "abc"' }),
      /id inválido/i
    );
    assert.match(
      formatFriendlyConstraintError({ code: '23514', message: 'violates check constraint "catalog_works_rating_check"' }),
      /nota fora da faixa/i
    );
    assert.match(
      formatFriendlyConstraintError({ code: '23514', message: 'violates check constraint "catalog_works_domain_check"' }),
      /domínio não aceito/i
    );
  });

  it('lote com uma obra inválida NÃO descarta o lote: sobe as válidas, mantém só a inválida na fila e registra motivo no Diagnóstico', async () => {
    clearRelationalMemoryForTests();
    resetSyncRuntimeFlagsForTests();

    const remoteDb = new Map();
    const storage = createMemoryStorage();

    // Caso A: obra com ID ausente no meio de um lote com 2 obras válidas -> 2 válidas sobem, 1 fica registrada com erro
    const clientA = createFullSupabaseMock({ remoteDb, supportsDeletedAt: true });
    const good1 = {
      id: 'batch-good-1',
      title: 'Duna',
      domain: 'reading',
      workType: 'book',
      rating: 94.6,
      updatedAt: '2026-11-26T21:00:00.000Z',
    };
    const badNoId = {
      id: '',
      title: 'Obra Corrompida Sem ID',
      domain: 'cinema',
      workType: 'movie',
      updatedAt: '2026-11-26T21:01:00.000Z',
    };
    const good2 = {
      id: 'batch-good-2',
      title: 'Hollow Knight',
      domain: 'games',
      workType: 'game',
      rating: 110,
      updatedAt: '2026-11-26T21:02:00.000Z',
    };

    const resA = await pushWorksToCloud([good1, badNoId, good2], {
      client: clientA,
      storage,
    });
    assert.equal(resA.ok, false);
    assert.equal(resA.partialSuccess, true);
    assert.equal(resA.count, 2);
    assert.equal(remoteDb.has(toCloudWorkId('batch-good-1')), true);
    assert.equal(remoteDb.has(toCloudWorkId('batch-good-2')), true);
    assert.equal(remoteDb.get(toCloudWorkId('batch-good-1')).rating, 95);
    assert.equal(remoteDb.get(toCloudWorkId('batch-good-2')).rating, 100);
    assert.equal(resA.failedWorks.length, 1);
    assert.equal(resA.failedWorks[0].title, 'Obra Corrompida Sem ID');
    assert.match(resA.failedWorks[0].reason, /id inválido/i);

    // Caso B: banco rejeita um lote inteiro por causa de 1 obra específica -> tenta obra por obra, sobe as outras 2 e mantém só a que falhou na fila/Diagnóstico
    const remoteDbB = new Map();
    const storageB = createMemoryStorage();
    const poisonCloudId = toCloudWorkId('poison-work-2');

    const batchRejectClient = {
      auth: {
        async getSession() {
          return {
            data: {
              session: {
                access_token: 'tok',
                expires_at: Math.floor(Date.now() / 1000) + 3600,
                user: { id: 'user-sync-1', email: 'u@example.com' },
              },
            },
            error: null,
          };
        },
      },
      from(table) {
        assert.equal(table, OMNI_CATALOG_TABLE);
        return {
          async upsert(rows) {
            if (rows.some((r) => r.id === poisonCloudId)) {
              return {
                error: {
                  code: '23514',
                  message: 'new row violates check constraint "catalog_works_rating_check"',
                },
              };
            }
            for (const r of rows) {
              remoteDbB.set(r.id, r);
            }
            return { error: null };
          },
        };
      },
    };

    const okWork1 = {
      id: 'ok-work-1',
      title: 'Blade Runner',
      domain: 'cinema',
      workType: 'movie',
      rating: 92,
      updatedAt: '2026-11-26T22:00:00.000Z',
    };
    const poisonWork = {
      id: 'poison-work-2',
      title: 'Obra Rejeitada Pelo Banco',
      domain: 'cinema',
      workType: 'movie',
      rating: 80,
      updatedAt: '2026-11-26T22:01:00.000Z',
    };
    const okWork3 = {
      id: 'ok-work-3',
      title: 'Clube da Esquina',
      domain: 'music',
      workType: 'album',
      rating: 98,
      updatedAt: '2026-11-26T22:02:00.000Z',
    };

    const resB = await pushWorksToCloud([okWork1, poisonWork, okWork3], {
      client: batchRejectClient,
      storage: storageB,
    });

    assert.equal(resB.ok, false);
    assert.equal(resB.partialSuccess, true);
    assert.equal(resB.count, 2, 'as 2 obras válidas devem subir mesmo quando o lote falha');
    assert.equal(remoteDbB.has(toCloudWorkId('ok-work-1')), true);
    assert.equal(remoteDbB.has(toCloudWorkId('ok-work-3')), true);
    assert.equal(remoteDbB.has(poisonCloudId), false);

    // Somente a obra que falhou permanece na fila e aparece no Diagnóstico com motivo em português
    const queueB = readSyncQueue(storageB);
    assert.deepEqual(queueB.pendingUpsertIds, ['poison-work-2']);
    const failedItemsB = readFailedSyncItems(storageB);
    assert.equal(failedItemsB.length, 1);
    assert.equal(failedItemsB[0].title, 'Obra Rejeitada Pelo Banco');
    assert.match(failedItemsB[0].reason, /nota fora da faixa/i);

    const errLogsB = getLocalErrorLog({ storage: storageB });
    assert.ok(
      errLogsB.some((e) => e.message.includes('Obra Rejeitada Pelo Banco')),
      'falha deve ser registrada no log local do Diagnóstico'
    );

    const diagText = buildDiagnosticsReportText({
      release: CODICE_RELEASE,
      failedSyncItems: failedItemsB,
      errorLog: errLogsB,
    });
    assert.match(diagText, /Obra Rejeitada Pelo Banco/);
    assert.match(diagText, /nota fora da faixa/i);
  });

  it('round-trip de IDs não-UUID (4 domínios + manual): sobe com UUID determinístico, volta no pull e é reconhecida como a MESMA obra sem duplicar', async () => {
    clearRelationalMemoryForTests();
    resetSyncRuntimeFlagsForTests();

    const remoteDb = new Map();
    const pcStorage = createMemoryStorage();
    const client = createFullSupabaseMock({ remoteDb, supportsDeletedAt: true });

    const localNonUuidWorks = [
      {
        id: 'tmdb-movie-550',
        title: 'Fight Club',
        domain: 'cinema',
        workType: 'movie',
        status: 'completed',
        rating: 92,
        updatedAt: '2026-11-26T18:00:00.000Z',
      },
      {
        id: 'openlibrary-OL99W',
        title: 'O Processo',
        domain: 'reading',
        workType: 'book',
        status: 'playing',
        pagesRead: 80,
        totalPages: 240,
        updatedAt: '2026-11-26T18:01:00.000Z',
      },
      {
        id: 'igdb-1942',
        title: 'The Witcher 3',
        domain: 'games',
        workType: 'game',
        status: 'completed',
        rating: 96,
        updatedAt: '2026-11-26T18:02:00.000Z',
      },
      {
        id: 'itunes-album-1440857781',
        title: 'Powerslave',
        domain: 'music',
        workType: 'album',
        status: 'completed',
        rating: 95,
        updatedAt: '2026-11-26T18:03:00.000Z',
      },
      {
        id: 'manual-legacy-42',
        title: 'Caderno Antigo Manual',
        domain: 'reading',
        workType: 'book',
        isManual: true,
        ids: buildManualExternalIds('manual-legacy-42'),
        status: 'queued',
        updatedAt: '2026-11-26T18:04:00.000Z',
      },
    ];

    // Confirma que nenhum ID local inicial é UUID
    for (const w of localNonUuidWorks) {
      assert.equal(isValidUuid(w.id), false);
    }

    // Sync 1: push inicial converte cada ID não-UUID em UUID determinístico válido
    const sync1 = await syncCatalogWithSupabase({
      client,
      localWorksOverride: localNonUuidWorks,
      storage: pcStorage,
    });
    assert.equal(sync1.ok, true);
    assert.equal(sync1.pushedCount, 5);
    assert.equal(sync1.works.length, 5);
    assert.equal(remoteDb.size, 5);

    for (const w of localNonUuidWorks) {
      const expectedUuid = toCloudWorkId(w.id);
      assert.equal(isValidUuid(expectedUuid), true);
      assert.equal(remoteDb.has(expectedUuid), true, `UUID determinístico de ${w.id} deve estar no remoto`);
      assert.equal(remoteDb.get(expectedUuid).id, expectedUuid);
    }

    // Sync 2: novo pull/sync imediato passando os mesmos itens locais originais (sem cloudId) -> ZERO duplicação e ZERO re-push
    const sync2 = await syncCatalogWithSupabase({
      client,
      localWorksOverride: localNonUuidWorks,
      storage: pcStorage,
    });
    assert.equal(sync2.ok, true);
    assert.equal(sync2.works.length, 5, 'pull subsequente NÃO pode duplicar obras com ID não-UUID');
    assert.equal(sync2.pushedCount, 0, 'não deve reenviar obras já sincronizadas');
    assert.equal(remoteDb.size, 5);

    // Sync 3: outro aparelho renomeia "Fight Club" -> "Clube da Luta" (mais novo) E simula linha remota sem progress_data.localId
    const fightClubUuid = toCloudWorkId('tmdb-movie-550');
    const existingRemoteRow = remoteDb.get(fightClubUuid);
    const updatedProgressData = { ...(existingRemoteRow.progress_data || {}) };
    delete updatedProgressData.localId;
    remoteDb.set(fightClubUuid, {
      ...existingRemoteRow,
      title: 'Clube da Luta',
      rating: 98,
      progress_data: updatedProgressData,
      updated_at: '2026-11-26T20:00:00.000Z',
    });

    const sync3 = await syncCatalogWithSupabase({
      client,
      localWorksOverride: localNonUuidWorks,
      storage: pcStorage,
    });
    assert.equal(sync3.ok, true);
    assert.equal(sync3.works.length, 5, 'mesmo com título alterado e sem localId remoto, deve reconhecer como a MESMA obra sem duplicar');
    assert.equal(sync3.pushedCount, 0);
    assert.equal(remoteDb.size, 5);
    const mergedFightClub = sync3.works.find(
      (w) => w.id === 'tmdb-movie-550' || w.cloudId === fightClubUuid
    );
    assert.equal(mergedFightClub?.id, 'tmdb-movie-550', 'preserva o ID local original');
    assert.equal(mergedFightClub?.cloudId, fightClubUuid);
    assert.equal(mergedFightClub?.title, 'Clube da Luta');
    assert.equal(mergedFightClub?.rating, 98);
  });
});
