import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, it } from 'node:test';

import { APP_BUILD_VERSION } from '../src/config/versioning.js';
import {
  applyPwaUpdateSafely,
  checkForPwaUpdate,
  isRemoteVersionNewer,
} from '../src/lib/pwaUpdateChecker.js';
import { encodeCcodexBackup } from '../src/services/backupCryptoService.js';
import {
  BACKUP_ENVELOPE_FORMAT,
  LEGACY_NO_CHECKSUM_WARNING,
  clearLocalDeletedIds,
  clearMemorySnapshotsForTests,
  exportSignedBackupPayload,
  exportSignedCcodexPayload,
  inspectBackupPayload,
  listAutoSnapshots,
  readLocalDeletedIds,
  recordLocalDeletedIds,
  restoreSnapshotWithSafety,
  smartMergeBackup,
} from '../src/services/backupEngine.js';
import { normalizeRelationalWorkRecord } from '../src/services/relationalDb.js';
import {
  APP_BUILD_VERSION as VITE_APP_BUILD_VERSION,
  buildVersionManifestInfo,
} from '../vite.config.js';

const ROOT_DIR = process.cwd();

function readText(relPath) {
  return fs.readFileSync(path.resolve(ROOT_DIR, relPath), 'utf8');
}

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  };
}

describe('OMNIPRISM v2.6.0 — FASE 4: Backup Anti-Sobrescrita + .ccodex + Atualização PWA', () => {
  beforeEach(() => {
    clearMemorySnapshotsForTests();
  });

  it('1. Envelope omniprism-backup-v2: campos obrigatórios, SHA-256 + fallback FNV, zero segredos e obra manual com capa', async () => {
    const storage = createMemoryStorage();
    const manualCover = 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=';
    const rawDb = {
      items: [
        {
          id: 'manual-book-1',
          domain: 'reading',
          workType: 'book',
          title: 'Livro Independente BR',
          creator: 'Autora BR',
          status: 'completed',
          rating: 94,
          isManual: true,
          ids: { source: 'manual', id: 'manual-book-1' },
          coverUrl: manualCover,
          manualCoverDataUrl: manualCover,
          apiKey: 'secret-should-be-stripped',
          updatedAt: '2026-11-25T14:00:00.000Z',
          updated_at: '2026-11-25T14:00:00.000Z',
        },
        {
          id: 'game-1',
          domain: 'games',
          workType: 'game',
          title: 'Hollow Knight',
          status: 'completed',
          updatedAt: '2026-11-25T12:00:00.000Z',
        },
      ],
      profile: {
        displayName: 'Leitor Teste',
        tmdbKey: 'secret-tmdb-token',
        geminiKey: 'AIzaSecretShouldNeverExport',
        accessToken: 'jwt-should-never-export',
      },
    };

    const signed = await exportSignedBackupPayload(rawDb, { storage });
    assert.equal(signed.format, BACKUP_ENVELOPE_FORMAT);
    assert.equal(signed.format, 'omniprism-backup-v2');
    assert.ok(signed.schemaVersion);
    assert.ok(signed.exportedAt);
    assert.equal(signed.appVersion, APP_BUILD_VERSION);
    assert.ok(signed.deviceId.startsWith('dev-'));
    assert.deepEqual(signed.countsByDomain, {
      cinema: 0,
      reading: 1,
      games: 1,
      music: 0,
    });
    assert.equal(signed.checksum.algorithm, 'SHA-256');
    assert.ok(signed.checksum.digest.length >= 64);

    // Nunca inclui chaves ou tokens
    const serialized = JSON.stringify(signed);
    assert.equal(serialized.includes('secret-should-be-stripped'), false);
    assert.equal(serialized.includes('secret-tmdb-token'), false);
    assert.equal(serialized.includes('AIzaSecretShouldNeverExport'), false);
    assert.equal(serialized.includes('jwt-should-never-export'), false);

    // Inclui obra manual + capa comprimida
    const manualWork = signed.tables.works.find((w) => w.id === 'manual-book-1');
    assert.equal(manualWork.isManual, true);
    assert.equal(manualWork.manualCoverDataUrl, manualCover);

    // Validação de checksum íntegro e adulterado
    const validInspect = await inspectBackupPayload(serialized);
    assert.equal(validInspect.ok, true);
    assert.equal(validInspect.checksumStatus, 'valid');
    assert.equal(validInspect.envelopeFormat, 'omniprism-backup-v2');

    const tampered = { ...signed, exportedAt: '2099-01-01T00:00:00.000Z' };
    const tamperedInspect = await inspectBackupPayload(JSON.stringify(tampered));
    assert.equal(tamperedInspect.ok, true);
    assert.equal(tamperedInspect.checksumStatus, 'tampered');

    // Fallback FNV-1a-64 quando WebCrypto não disponível
    const fnvSigned = await exportSignedBackupPayload(rawDb, {
      storage,
      forceFnvFallback: true,
    });
    assert.equal(fnvSigned.checksum.algorithm, 'FNV-1a-64');
    const fnvInspect = await inspectBackupPayload(JSON.stringify(fnvSigned));
    assert.equal(fnvInspect.ok, true);
    assert.equal(fnvInspect.checksumStatus, 'valid');
    assert.equal(fnvInspect.checksumAlgorithm, 'FNV-1a-64');
  });

  it('2. Backup criptografado (.ccodex): exige senha primeiro, valida checksum DEPOIS de descriptografar e só então mostra resumo pré-importação', async () => {
    const storage = createMemoryStorage();
    const password = 'senha-super-segura-v260';

    const localWorkspace = {
      items: [
        {
          id: 'w-local-newer',
          domain: 'reading',
          workType: 'book',
          title: 'Duna',
          status: 'completed',
          rating: 96,
          notes: 'Nota atualizada hoje no aparelho.',
          updatedAt: '2026-11-25T18:00:00.000Z',
          updated_at: '2026-11-25T18:00:00.000Z',
        },
        {
          id: 'w-local-older',
          domain: 'games',
          workType: 'game',
          title: 'Celeste',
          status: 'playing',
          hoursPlayed: 4,
          updatedAt: '2026-11-10T10:00:00.000Z',
          updated_at: '2026-11-10T10:00:00.000Z',
        },
      ],
    };

    const incomingDb = {
      items: [
        {
          id: 'w-local-newer',
          domain: 'reading',
          workType: 'book',
          title: 'Duna',
          status: 'playing',
          rating: 70,
          updatedAt: '2026-11-01T10:00:00.000Z',
          updated_at: '2026-11-01T10:00:00.000Z',
        },
        {
          id: 'w-local-older',
          domain: 'games',
          workType: 'game',
          title: 'Celeste',
          status: 'completed',
          rating: 95,
          hoursPlayed: 18,
          updatedAt: '2026-11-24T20:00:00.000Z',
          updated_at: '2026-11-24T20:00:00.000Z',
        },
        {
          id: 'w-brand-new',
          domain: 'music',
          workType: 'album',
          title: 'Powerslave',
          creator: 'Iron Maiden',
          status: 'completed',
          updatedAt: '2026-11-24T12:00:00.000Z',
          updated_at: '2026-11-24T12:00:00.000Z',
        },
      ],
    };

    const encryptedEnvelope = await exportSignedCcodexPayload(incomingDb, {
      password,
      storage,
    });
    assert.equal(encryptedEnvelope.encrypted, true);

    // 1) Sem senha -> pede senha e NÃO exibe resumo nem checksum antes de descriptografar
    const lockedRes = await inspectBackupPayload(JSON.stringify(encryptedEnvelope), {
      currentWorkspace: localWorkspace,
    });
    assert.equal(lockedRes.ok, false);
    assert.equal(lockedRes.requiresPassword, true);
    assert.equal(lockedRes.mergePreview, undefined);
    assert.equal(lockedRes.checksumStatus, undefined);

    // 2) Senha errada -> recusa sem mostrar resumo
    const wrongPassRes = await inspectBackupPayload(JSON.stringify(encryptedEnvelope), {
      password: 'senha-errada',
      currentWorkspace: localWorkspace,
    });
    assert.equal(wrongPassRes.ok, false);
    assert.equal(wrongPassRes.invalidPassword, true);
    assert.equal(wrongPassRes.mergePreview, undefined);

    // 3) Senha correta -> descriptografa, valida checksum do conteúdo descriptografado e monta resumo pré-importação
    const unlockedRes = await inspectBackupPayload(JSON.stringify(encryptedEnvelope), {
      password,
      currentWorkspace: localWorkspace,
    });
    assert.equal(unlockedRes.ok, true);
    assert.equal(unlockedRes.encrypted, true);
    assert.equal(unlockedRes.checksumStatus, 'valid');
    assert.ok(unlockedRes.exportedAt);
    assert.equal(unlockedRes.mergePreview.newWorks, 1);
    assert.equal(unlockedRes.mergePreview.updatedWorks, 1);
    assert.equal(unlockedRes.mergePreview.protectedConflicts, 1);
    assert.equal(
      unlockedRes.mergePreview.label,
      '1 obras novas · 1 atualizações mais recentes · 1 conflitos protegidos'
    );

    // 4) Conteúdo adulterado dentro de um .ccodex criptografado -> detecta checksum tampered APÓS descriptografar
    const signedInner = await exportSignedBackupPayload(incomingDb, { storage });
    const tamperedInner = { ...signedInner, appVersion: '9.9.9-tampered' };
    const tamperedCcodex = await encodeCcodexBackup(tamperedInner, { password });
    const tamperedUnlocked = await inspectBackupPayload(JSON.stringify(tamperedCcodex), {
      password,
      currentWorkspace: localWorkspace,
    });
    assert.equal(tamperedUnlocked.ok, true);
    assert.equal(tamperedUnlocked.checksumStatus, 'tampered');
  });

  it('3. Backup legado sem cabeçalho/checksum: importável com aviso claro e proteção temporal aplicada', async () => {
    const legacyRawJson = JSON.stringify([
      {
        id: 'book-shared',
        domain: 'reading',
        workType: 'book',
        title: 'O Nome do Vento',
        creator: 'Patrick Rothfuss',
        status: 'queued',
        // Sem updatedAt / updated_at!
      },
      {
        id: 'book-legacy-new',
        domain: 'reading',
        workType: 'book',
        title: 'O Temor do Sábio',
        creator: 'Patrick Rothfuss',
        status: 'queued',
      },
    ]);

    const localWorkspace = {
      items: [
        {
          id: 'book-shared',
          domain: 'reading',
          workType: 'book',
          title: 'O Nome do Vento',
          creator: 'Patrick Rothfuss',
          status: 'completed',
          rating: 92,
          notes: 'Leitura concluída no aparelho.',
          updatedAt: '2026-11-25T10:00:00.000Z',
          updated_at: '2026-11-25T10:00:00.000Z',
        },
        {
          id: 'local-only-book',
          domain: 'reading',
          workType: 'book',
          title: 'A Casa das Sete Estações',
          status: 'completed',
          updatedAt: '2026-11-25T11:00:00.000Z',
          updated_at: '2026-11-25T11:00:00.000Z',
        },
      ],
    };

    const inspected = await inspectBackupPayload(legacyRawJson, {
      currentWorkspace: localWorkspace,
    });
    assert.equal(inspected.ok, true);
    assert.equal(inspected.checksumStatus, 'unsigned');
    assert.equal(inspected.isLegacyWithoutHeader, true);
    assert.equal(inspected.legacyWarning, LEGACY_NO_CHECKSUM_WARNING);
    assert.equal(
      inspected.legacyWarning,
      'Backup sem checksum (versão antiga) — proteção temporal aplicada'
    );
    // Obra sem updated_at no arquivo conta como mais antiga que a obra local com updated_at
    assert.equal(inspected.mergePreview.newWorks, 1);
    assert.equal(inspected.mergePreview.protectedConflicts, 1);

    const merged = smartMergeBackup({
      currentWorkspace: localWorkspace,
      incomingSnapshot: inspected.snapshot,
    });
    const sharedAfter = merged.workspace.items.find((w) => w.id === 'book-shared');
    assert.equal(sharedAfter.status, 'completed');
    assert.equal(sharedAfter.rating, 92);
    assert.equal(sharedAfter.notes, 'Leitura concluída no aparelho.');
    // Não apaga obra local ausente no backup legado
    assert.ok(merged.workspace.items.some((w) => w.id === 'local-only-book'));
    assert.ok(merged.workspace.items.some((w) => w.id === 'book-legacy-new'));
  });

  it('4. smartMergeBackup: match por external_ids, aviso de deletedIds, auto-snapshot obrigatório e Forçar substituição total', async () => {
    const currentWorkspace = {
      items: [
        {
          id: 'local-uuid-1',
          domain: 'cinema',
          workType: 'movie',
          title: 'Interestelar',
          ids: { tmdb: 157336 },
          tmdbId: 157336,
          status: 'completed',
          rating: 98,
          notes: 'Obra-prima absoluta.',
          updatedAt: '2026-11-25T16:00:00.000Z',
          updated_at: '2026-11-25T16:00:00.000Z',
        },
      ],
    };

    const incomingSnapshot = {
      items: [
        {
          // ID diferente, mas mesmo external_id (TMDB 157336) e timestamp MAIS ANTIGO
          id: 'other-device-uuid-9',
          domain: 'cinema',
          workType: 'movie',
          title: 'Interestelar',
          ids: { tmdb: 157336 },
          tmdbId: 157336,
          status: 'queued',
          rating: null,
          updatedAt: '2026-11-20T09:00:00.000Z',
          updated_at: '2026-11-20T09:00:00.000Z',
        },
        {
          // Obra que consta em deletedIds local
          id: 'deleted-work-77',
          domain: 'games',
          workType: 'game',
          title: 'Jogo Apagado Localmente',
          status: 'queued',
          updatedAt: '2026-11-22T09:00:00.000Z',
        },
      ],
    };

    // Match por external_ids protege registro mais recente e sinaliza deletedIds antes de reimportar
    const smart = smartMergeBackup({
      currentWorkspace,
      incomingSnapshot,
      deletedIds: ['deleted-work-77'],
    });
    assert.equal(smart.summary.protectedConflicts, 1);
    assert.equal(smart.summary.deletedConflictsCount, 1);
    assert.equal(smart.workspace.items.length, 1);
    assert.equal(smart.workspace.items[0].rating, 98);
    assert.equal(smart.workspace.items.some((w) => w.id === 'deleted-work-77'), false);

    // Com includeDeleted: true, usuário opta por reimportar obra apagada
    const smartInclude = smartMergeBackup({
      currentWorkspace,
      incomingSnapshot,
      deletedIds: ['deleted-work-77'],
      includeDeleted: true,
    });
    assert.equal(smartInclude.workspace.items.some((w) => w.id === 'deleted-work-77'), true);

    // "Forçar substituição total" sobrescreve tudo MAS grava auto-snapshot obrigatório antes!
    const forced = await restoreSnapshotWithSafety({
      currentWorkspace,
      incomingSnapshot,
      mode: 'replace',
    });
    assert.equal(forced.ok, true);
    assert.equal(forced.mode, 'replace');
    assert.equal(forced.snapshotSaved, true);
    assert.ok(forced.snapshotId);
    assert.equal(forced.workspace.items.length, 2);
    assert.equal(forced.workspace.items[0].id, 'other-device-uuid-9');
    const savedSnaps = await listAutoSnapshots();
    assert.ok(savedSnaps.some((s) => s.id === forced.snapshotId));
  });

  it('5. Escrita local atualiza updated_at (ISO) e rastreamento de deletedIds', () => {
    const rec = normalizeRelationalWorkRecord({
      id: 'w-iso-1',
      title: 'Chrono Trigger',
      domain: 'games',
    });
    assert.ok(rec.updatedAt);
    assert.equal(rec.updated_at, rec.updatedAt);
    assert.equal(Number.isNaN(Date.parse(rec.updated_at)), false);

    const storage = createMemoryStorage();
    recordLocalDeletedIds(['del-a', 'del-b'], storage);
    assert.deepEqual(readLocalDeletedIds(storage), ['del-a', 'del-b']);
    clearLocalDeletedIds(['del-a'], storage);
    assert.deepEqual(readLocalDeletedIds(storage), ['del-b']);

    const backlogSrc = readText('src/hooks/useBacklog.js');
    assert.ok(backlogSrc.includes('updated_at: nowIso'));
    assert.ok(backlogSrc.includes('recordLocalDeletedIds'));
  });

  it('6. version.json no build + verificador PWA (cache no-store, registration.update(), Atualizar agora sem tocar IndexedDB)', async () => {
    const manifest = buildVersionManifestInfo();
    assert.equal(manifest.version, VITE_APP_BUILD_VERSION);
    assert.equal(VITE_APP_BUILD_VERSION, APP_BUILD_VERSION);
    assert.equal(Number.isNaN(Date.parse(manifest.buildTime)), false);
    assert.ok(manifest.commit.length >= 3);

    assert.equal(
      isRemoteVersionNewer(
        { version: '2.6.0', commit: 'aaaa111', buildTime: '2026-11-25T10:00:00.000Z' },
        { version: '2.6.1', commit: 'bbbb222', buildTime: '2026-11-26T10:00:00.000Z' }
      ),
      true
    );
    assert.equal(
      isRemoteVersionNewer(
        { version: '2.6.0', commit: 'aaaa111', buildTime: '2026-11-25T10:00:00.000Z' },
        { version: '2.6.0', commit: 'aaaa111', buildTime: '2026-11-25T10:00:00.000Z' }
      ),
      false
    );

    let regUpdateCalls = 0;
    let lastFetchOpts = null;
    const upToDateRes = await checkForPwaUpdate({
      currentInfo: { version: '2.6.0', commit: 'abc1234', buildTime: '2026-11-25T10:00:00.000Z' },
      getRegistration: async () => ({
        waiting: null,
        update: async () => {
          regUpdateCalls += 1;
        },
      }),
      fetchImpl: async (url, opts) => {
        lastFetchOpts = { url, opts };
        return new Response(
          JSON.stringify({
            version: '2.6.0',
            commit: 'abc1234',
            buildTime: '2026-11-25T10:00:00.000Z',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      },
    });
    assert.equal(regUpdateCalls, 1);
    assert.equal(lastFetchOpts.url, '/version.json');
    assert.equal(lastFetchOpts.opts.cache, 'no-store');
    assert.equal(upToDateRes.status, 'up_to_date');
    assert.equal(upToDateRes.message, 'App atualizado');

    const newVerRes = await checkForPwaUpdate({
      currentInfo: { version: '2.6.0', commit: 'abc1234', buildTime: '2026-11-25T10:00:00.000Z' },
      getRegistration: async () => ({
        waiting: { postMessage: () => {} },
        update: async () => {},
      }),
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            version: '2.7.0',
            commit: 'def5678',
            buildTime: '2026-12-01T10:00:00.000Z',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        ),
    });
    assert.equal(newVerRes.status, 'update_available');
    assert.equal(newVerRes.updateAvailable, true);
    assert.equal(newVerRes.hasWaitingWorker, true);

    // Ativa SW em espera e recarrega SEM tocar no IndexedDB
    let postedMsg = null;
    let reloaded = false;
    const applyRes = await applyPwaUpdateSafely({
      registration: {
        waiting: {
          postMessage: (msg) => {
            postedMsg = msg;
          },
        },
      },
      applySwUpdateFn: null,
      reloadFn: () => {
        reloaded = true;
      },
    });
    assert.equal(applyRes.ok, true);
    assert.equal(applyRes.touchedIndexedDb, false);
    assert.deepEqual(postedMsg, { type: 'SKIP_WAITING' });
    assert.equal(reloaded, true);

    // Verificação estrutural de UI e cabeçalhos
    const modalSrc = readText('src/components/BackupRestoreModal.jsx');
    assert.ok(modalSrc.includes('Forçar substituição total'));
    assert.ok(modalSrc.includes('Confirmar substituição total (2/2)'));
    assert.ok(modalSrc.includes('Restaurar snapshot'));
    assert.ok(modalSrc.includes('Backup sem checksum (versão antiga) — proteção temporal aplicada'));

    const profileSrc = readText('src/screens/ProfileScreen.jsx');
    assert.ok(profileSrc.includes('Verificar atualização'));
    assert.ok(profileSrc.includes('Atualizar agora'));
    assert.ok(profileSrc.includes('App atualizado'));

    const bannerSrc = readText('src/components/PwaUpdateBanner.jsx');
    assert.ok(bannerSrc.includes('Atualizar agora'));

    const headersSrc = readText('public/_headers');
    assert.ok(headersSrc.includes('/version.json'));
  });
});
