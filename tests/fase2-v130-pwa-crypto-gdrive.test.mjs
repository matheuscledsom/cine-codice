import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  CCODEX_FORMAT_VERSION,
  PBKDF2_ITERATIONS,
  compressGzipBytes,
  decodeCcodexOrJsonBackup,
  decompressGzipBytes,
  encodeCcodexBackup,
  stripBase64MediaFromWorks,
} from '../src/services/backupCryptoService.js';
import {
  exportSignedBackupPayload,
  exportSignedCcodexPayload,
  inspectBackupPayload,
} from '../src/services/backupEngine.js';
import { buildCodiceDatabase } from '../src/services/codiceDatabase.js';
import {
  restoreLatestBackupFromGoogleDrive,
  uploadBackupToGoogleDrive,
} from '../src/services/googleDriveBackup.js';

const sampleWorkspace = {
  items: [
    {
      id: 'work-1',
      title: 'Interestelar',
      creator: 'Christopher Nolan',
      workType: 'movie',
      status: 'completed',
      rating: 96,
      durationMinutes: 169,
      watchedMinutes: 169,
      coverUrl: 'https://image.tmdb.org/t/p/w500/interstellar.jpg',
    },
    {
      id: 'work-2',
      title: 'One Piece',
      creator: 'Eiichiro Oda',
      workType: 'anime',
      status: 'watching',
      rating: 98,
      currentEpisode: 1015,
      totalEpisodes: 1122,
      coverUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA',
    },
  ],
  profile: {
    displayName: 'Curador Lumière',
    handle: '@curador',
  },
};

test('Fase 2 (v1.3.0): GZIP nativo comprime JSON e restaura .ccodex sem perda', async () => {
  const repeatedJson = JSON.stringify({
    items: Array.from({ length: 40 }, (_, i) => ({
      ...sampleWorkspace.items[0],
      id: `work-${i + 1}`,
    })),
  });
  const compressed = await compressGzipBytes(repeatedJson);
  assert.ok(
    compressed.byteLength < repeatedJson.length * 0.4,
    `Esperava compressão significativa, obteve ${compressed.byteLength} vs ${repeatedJson.length}`
  );
  const decompressed = await decompressGzipBytes(compressed);
  assert.equal(decompressed, repeatedJson);

  const db = buildCodiceDatabase(sampleWorkspace);
  const envelope = await exportSignedCcodexPayload(db);
  assert.equal(envelope.format, CCODEX_FORMAT_VERSION);
  assert.equal(envelope.encrypted, false);
  assert.equal(envelope.compression, 'gzip');

  const inspected = await inspectBackupPayload(JSON.stringify(envelope));
  assert.equal(inspected.ok, true);
  assert.equal(inspected.format, CCODEX_FORMAT_VERSION);
  assert.equal(inspected.checksumStatus, 'valid');
  assert.equal(inspected.counts.works, 2);
});

test('Fase 2 (v1.3.0): Criptografia PBKDF2 (150k) + AES-GCM 256-bit protege e autentica .ccodex', async () => {
  const db = buildCodiceDatabase(sampleWorkspace);
  const encryptedEnvelope = await exportSignedCcodexPayload(db, {
    password: 'SenhaForteLumiere!2026',
  });

  assert.equal(encryptedEnvelope.format, CCODEX_FORMAT_VERSION);
  assert.equal(encryptedEnvelope.encrypted, true);
  assert.equal(encryptedEnvelope.kdf, 'PBKDF2-SHA256');
  assert.equal(encryptedEnvelope.iterations, PBKDF2_ITERATIONS);
  assert.equal(encryptedEnvelope.cipher, 'AES-256-GCM');
  assert.ok(encryptedEnvelope.salt.length > 10);
  assert.ok(encryptedEnvelope.iv.length > 10);

  // Sem senha -> exige senha
  const withoutPass = await inspectBackupPayload(JSON.stringify(encryptedEnvelope));
  assert.equal(withoutPass.ok, false);
  assert.equal(withoutPass.requiresPassword, true);

  // Senha errada -> falha autenticação AES-GCM
  const wrongPass = await inspectBackupPayload(JSON.stringify(encryptedEnvelope), {
    password: 'SenhaErrada123',
  });
  assert.equal(wrongPass.ok, false);
  assert.equal(wrongPass.invalidPassword, true);

  // Senha correta -> restaura catálogo íntegro com SHA-256 válido
  const unlocked = await inspectBackupPayload(JSON.stringify(encryptedEnvelope), {
    password: 'SenhaForteLumiere!2026',
  });
  assert.equal(unlocked.ok, true);
  assert.equal(unlocked.encrypted, true);
  assert.equal(unlocked.checksumStatus, 'valid');
  assert.equal(unlocked.counts.works, 2);
});

test('Fase 2 (v1.3.0): Retrocompatibilidade com backups .json antigos e limpeza de Base64 em pôsteres', async () => {
  const cleaned = stripBase64MediaFromWorks(sampleWorkspace);
  assert.equal(
    cleaned.items[0].coverUrl,
    'https://image.tmdb.org/t/p/w500/interstellar.jpg'
  );
  assert.equal(cleaned.items[1].coverUrl, '');

  const db = buildCodiceDatabase(cleaned);
  const legacySignedJson = await exportSignedBackupPayload(db);
  const decodedLegacy = await decodeCcodexOrJsonBackup(
    JSON.stringify(legacySignedJson)
  );
  assert.equal(decodedLegacy.ok, true);
  assert.equal(decodedLegacy.format, 'legacy-json');

  const inspectedLegacy = await inspectBackupPayload(
    JSON.stringify(legacySignedJson)
  );
  assert.equal(inspectedLegacy.ok, true);
  assert.equal(inspectedLegacy.format, 'legacy-json');
  assert.equal(inspectedLegacy.counts.works, 2);
});

test('Fase 2 (v1.3.0): Google Drive upload e restauração client-side (.ccodex)', async () => {
  const envelope = await encodeCcodexBackup(sampleWorkspace, {
    password: 'DriveSecretPassword',
  });
  let uploadedBody = '';

  const mockFetch = async (url, options = {}) => {
    const urlStr = String(url);
    if (urlStr.includes('/upload/drive/v3/files')) {
      uploadedBody = options.body;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'gdrive-file-123',
          name: 'cine-codice-latest.ccodex',
          modifiedTime: '2026-11-22T17:00:00Z',
        }),
      };
    }
    if (urlStr.includes('alt=media')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify(envelope),
      };
    }
    if (urlStr.includes('/drive/v3/files')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          files: [
            {
              id: 'gdrive-file-123',
              name: 'cine-codice-latest.ccodex',
              modifiedTime: '2026-11-22T17:00:00Z',
            },
          ],
        }),
      };
    }
    throw new Error(`URL inesperada: ${urlStr}`);
  };

  const uploaded = await uploadBackupToGoogleDrive(envelope, {
    accessToken: 'ya29.mock-token',
    fetchImpl: mockFetch,
  });
  assert.equal(uploaded.id, 'gdrive-file-123');
  assert.ok(uploadedBody.includes('appDataFolder'));

  const restored = await restoreLatestBackupFromGoogleDrive({
    accessToken: 'ya29.mock-token',
    fetchImpl: mockFetch,
  });
  assert.equal(restored.file.id, 'gdrive-file-123');

  const decoded = await decodeCcodexOrJsonBackup(restored.rawContent, {
    password: 'DriveSecretPassword',
  });
  assert.equal(decoded.ok, true);
  assert.equal(decoded.payload.items.length, 2);
});

test('Fase 2 (v1.3.0): PWA manifest.webmanifest standalone + shortcuts e cache LRU 80 MB', () => {
  const manifestRaw = fs.readFileSync(
    path.resolve('public/manifest.webmanifest'),
    'utf8'
  );
  const manifest = JSON.parse(manifestRaw);
  assert.equal(manifest.display, 'standalone');
  assert.ok(Array.isArray(manifest.shortcuts) && manifest.shortcuts.length >= 2);
  assert.ok(
    manifest.icons.some((icon) => icon.purpose === 'maskable'),
    'Manifest deve incluir ícone maskable para Android/PC'
  );

  const viteConfigRaw = fs.readFileSync(path.resolve('vite.config.js'), 'utf8');
  assert.ok(viteConfigRaw.includes('PWA_IMAGE_CACHE_BUDGET_MB = 80'));
  assert.ok(viteConfigRaw.includes('cine-codice-posters-lru-80mb'));
});
