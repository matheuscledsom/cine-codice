import { getTodayLocalISO } from '../utils/backlogHelpers.js';
import { normalizeCollectionList } from '../utils/collections.js';
import {
  decodeCcodexOrJsonBackup,
  encodeCcodexBackup,
  isCcodexEnvelope,
  stripBase64MediaFromWorks,
} from './backupCryptoService.js';
import {
  buildCodiceDatabase,
  createUuid,
  hydrateAppSnapshotFromDatabase,
  migrateDatabase,
  triggerFileDownload,
  validateReferentialIntegrity,
} from './codiceDatabase.js';

export const AUTO_SNAPSHOT_DB_NAME = 'cine_codice_auto_snapshots_v1';
export const AUTO_SNAPSHOT_STORE_NAME = 'snapshots';
export const MAX_AUTO_SNAPSHOTS = 5;
export const EMERGENCY_MIRROR_KEY = 'cine_codice_emergency_mirror_v1';
export const LAST_BACKUP_EXPORT_KEY = 'cine_codice_last_backup_exported_at';
export const FIRST_ACTIVITY_SEEN_KEY = 'cine_codice_first_activity_seen_at';
export const BACKUP_REMINDER_DAYS = 7;

const memorySnapshotStore = new Map();

function hasIndexedDb() {
  return typeof indexedDB !== 'undefined';
}

export function clearMemorySnapshotsForTests() {
  memorySnapshotStore.clear();
}

export function stripChecksumEnvelope(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }
  const rest = { ...payload };
  delete rest.checksum;
  return rest;
}

export async function computeSha256Hex(rawText) {
  const input = String(rawText ?? '');
  const encoder = new TextEncoder();
  const data = encoder.encode(input);

  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle?.digest) {
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
    const bytes = new Uint8Array(hashBuffer);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < data.length; i += 1) {
    h1 = Math.imul(h1 ^ data[i], 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (data[i] + i), 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

export async function exportSignedBackupPayload(db) {
  const sanitizedInput = stripBase64MediaFromWorks(db);
  const baseDb = stripBase64MediaFromWorks(migrateDatabase(sanitizedInput));
  const canonicalJson = JSON.stringify(stripChecksumEnvelope(baseDb));
  const digest = await computeSha256Hex(canonicalJson);

  return {
    ...baseDb,
    checksum: {
      algorithm: 'SHA-256',
      digest,
      signedAt: new Date().toISOString(),
    },
  };
}

export function countDatabaseEntities(db, snapshot) {
  const tables = db?.tables || {};
  const worksCount = (tables.works || snapshot?.items || []).length;
  const quotesFromWorks = (snapshot?.items || []).reduce(
    (sum, item) => sum + (Array.isArray(item.quotes) ? item.quotes.length : 0),
    0
  );
  const quotesCount = Array.isArray(tables.quotes_notes)
    ? tables.quotes_notes.length
    : quotesFromWorks;

  return {
    works: worksCount,
    authors: Array.isArray(tables.authors) ? tables.authors.length : 0,
    quotes: quotesCount,
    reviews: Array.isArray(tables.reviews) ? tables.reviews.length : 0,
    journalEntries: Array.isArray(tables.journal_entries)
      ? tables.journal_entries.length
      : (snapshot?.posts || []).length,
    readingSessions: Array.isArray(tables.reading_sessions)
      ? tables.reading_sessions.length
      : (snapshot?.readingSessions || []).length,
    episodeEvaluations: Array.isArray(tables.episode_evaluations)
      ? tables.episode_evaluations.length
      : (snapshot?.episodeEvaluations || []).length,
  };
}

export async function exportSignedCcodexPayload(db, { password = '' } = {}) {
  const signedJson = await exportSignedBackupPayload(db);
  return encodeCcodexBackup(signedJson, { password });
}

export async function inspectBackupPayload(rawText, options = {}) {
  try {
    const initialParsed =
      typeof rawText === 'string' ? JSON.parse(rawText) : rawText;

    let parsed = initialParsed;
    let backupContainerFormat = 'legacy-json';
    let wasEncrypted = false;
    let compressionStats = null;

    if (isCcodexEnvelope(initialParsed)) {
      const decoded = await decodeCcodexOrJsonBackup(initialParsed, {
        password: options?.password || '',
      });
      if (!decoded.ok) {
        return {
          ok: false,
          requiresPassword: Boolean(decoded.requiresPassword),
          invalidPassword: Boolean(decoded.invalidPassword),
          encrypted: Boolean(decoded.encrypted),
          format: decoded.format || 'ccodex-v1',
          error: decoded.error || 'Falha ao ler arquivo .ccodex.',
        };
      }
      parsed = decoded.payload;
      backupContainerFormat = decoded.format;
      wasEncrypted = decoded.encrypted;
      compressionStats = {
        uncompressedBytes: decoded.uncompressedBytes,
        compressedBytes: decoded.compressedBytes,
      };
    }

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      (!Array.isArray(parsed) &&
        !Array.isArray(parsed.items) &&
        !(parsed.tables && typeof parsed.tables === 'object'))
    ) {
      return {
        ok: false,
        error: 'Arquivo JSON inválido ou incompatível com o OmniPrism.',
      };
    }

    const declaredDigest = parsed?.checksum?.digest
      ? String(parsed.checksum.digest).toLowerCase().trim()
      : '';
    let checksumStatus = 'unsigned';
    let computedDigest = '';

    if (declaredDigest) {
      const canonical = JSON.stringify(stripChecksumEnvelope(parsed));
      computedDigest = (await computeSha256Hex(canonical)).toLowerCase();
      checksumStatus = computedDigest === declaredDigest ? 'valid' : 'tampered';
    } else {
      const dbTemp = migrateDatabase(parsed);
      computedDigest = await computeSha256Hex(
        JSON.stringify(stripChecksumEnvelope(dbTemp))
      );
    }

    const db = migrateDatabase(parsed);
    const integrity = validateReferentialIntegrity(db);
    const snapshot = hydrateAppSnapshotFromDatabase(db);
    const counts = countDatabaseEntities(db, snapshot);

    return {
      ok: true,
      format: backupContainerFormat,
      encrypted: wasEncrypted,
      compressionStats,
      checksumStatus,
      declaredDigest,
      computedDigest,
      integrity,
      counts,
      detectedSchemaVersion: parsed?.schemaVersion || '1.0',
      schemaVersion: db.schemaVersion,
      db,
      snapshot,
    };
  } catch {
    return {
      ok: false,
      error: 'Não foi possível ler o JSON selecionado. Verifique se o arquivo está íntegro.',
    };
  }
}

function mergeQuotesArrays(currentQuotes = [], incomingQuotes = []) {
  const map = new Map();
  for (const q of currentQuotes) {
    if (!q?.text) continue;
    const key = String(q.id || q.text.trim().toLowerCase());
    map.set(key, q);
  }
  for (const q of incomingQuotes) {
    if (!q?.text) continue;
    const key = String(q.id || q.text.trim().toLowerCase());
    const existing = map.get(key);
    if (!existing) {
      map.set(key, q);
    } else {
      const incomingTime = Date.parse(q.updatedAt || q.createdAt || '') || 0;
      const existingTime =
        Date.parse(existing.updatedAt || existing.createdAt || '') || 0;
      map.set(key, incomingTime > existingTime ? q : existing);
    }
  }
  return Array.from(map.values());
}

export function mergeSnapshots(currentSnapshot = {}, incomingSnapshot = {}) {
  const currentItems = Array.isArray(currentSnapshot.items)
    ? currentSnapshot.items
    : [];
  const incomingItems = Array.isArray(incomingSnapshot.items)
    ? incomingSnapshot.items
    : [];

  const itemMap = new Map();
  for (const item of currentItems) {
    if (item?.id) itemMap.set(String(item.id), item);
  }

  for (const incoming of incomingItems) {
    if (!incoming?.id) continue;
    const key = String(incoming.id);
    const existing = itemMap.get(key);
    if (!existing) {
      itemMap.set(key, incoming);
    } else {
      const existingUpdated = Date.parse(existing.updatedAt || existing.createdAt || '') || 0;
      const incomingUpdated = Date.parse(incoming.updatedAt || incoming.createdAt || '') || 0;
      const primary = incomingUpdated > existingUpdated ? incoming : existing;
      const secondary = primary === incoming ? existing : incoming;
      itemMap.set(key, {
        ...secondary,
        ...primary,
        quotes: mergeQuotesArrays(existing.quotes, incoming.quotes),
      });
    }
  }

  const mergeById = (currList = [], incList = []) => {
    const map = new Map();
    for (const row of currList) {
      if (row?.id) map.set(String(row.id), row);
    }
    for (const row of incList) {
      if (!row?.id) continue;
      const key = String(row.id);
      const existing = map.get(key);
      if (!existing) {
        map.set(key, row);
      } else {
        const incT = Date.parse(row.updatedAt || row.createdAt || '') || 0;
        const curT = Date.parse(existing.updatedAt || existing.createdAt || '') || 0;
        if (incT > curT) map.set(key, row);
      }
    }
    return Array.from(map.values());
  };

  const currProfile = currentSnapshot.profile || {};
  const incProfile = incomingSnapshot.profile || {};
  const mergedProfile = {
    ...incProfile,
    ...currProfile,
    displayName: currProfile.displayName || incProfile.displayName,
    bio: currProfile.bio || incProfile.bio || '',
    avatarUrl: currProfile.avatarUrl || incProfile.avatarUrl || '',
    coverUrl: currProfile.coverUrl || incProfile.coverUrl || '',
  };

  const currStreak = currentSnapshot.streak || { count: 0, lastDate: null, history: [], dailyLogs: {} };
  const incStreak = incomingSnapshot.streak || { count: 0, lastDate: null, history: [], dailyLogs: {} };
  const mergedHistory = Array.from(
    new Set([...(currStreak.history || []), ...(incStreak.history || [])])
  ).sort();
  const mergedDailyLogs = {
    ...(incStreak.dailyLogs && typeof incStreak.dailyLogs === 'object' ? incStreak.dailyLogs : {}),
    ...(currStreak.dailyLogs && typeof currStreak.dailyLogs === 'object' ? currStreak.dailyLogs : {}),
  };
  const latestLastDate =
    [currStreak.lastDate, incStreak.lastDate].filter(Boolean).sort().pop() || null;

  const currEvalList = Array.isArray(currentSnapshot.episodeEvaluations)
    ? currentSnapshot.episodeEvaluations
    : [];
  const incEvalList = Array.isArray(incomingSnapshot.episodeEvaluations)
    ? incomingSnapshot.episodeEvaluations
    : [];
  const evalMap = new Map();
  const buildEvalKey = (r) =>
    r?.evalKey || (r?.workId ? `${r.workId}:s${Number(r.season) || 1}:e${Number(r.episode) || 1}` : null);
  for (const row of currEvalList) {
    const k = buildEvalKey(row);
    if (k) evalMap.set(k, row);
  }
  for (const row of incEvalList) {
    const k = buildEvalKey(row);
    if (!k) continue;
    const existing = evalMap.get(k);
    if (!existing) {
      evalMap.set(k, row);
    } else {
      const incT = Date.parse(row.updatedAt || '') || 0;
      const curT = Date.parse(existing.updatedAt || '') || 0;
      if (incT > curT) evalMap.set(k, row);
    }
  }

  return {
    items: Array.from(itemMap.values()),
    posts: mergeById(currentSnapshot.posts, incomingSnapshot.posts),
    readingSessions: mergeById(
      currentSnapshot.readingSessions,
      incomingSnapshot.readingSessions
    ),
    collections: normalizeCollectionList([
      ...(currentSnapshot.collections || []),
      ...(incomingSnapshot.collections || []),
    ]),
    episodeEvaluations: Array.from(evalMap.values()),
    profile: mergedProfile,
    streak: {
      count: Math.max(Number(currStreak.count) || 0, Number(incStreak.count) || 0),
      lastDate: latestLastDate,
      history: mergedHistory,
      dailyLogs: mergedDailyLogs,
    },
  };
}

function openSnapshotDb() {
  return new Promise((resolve, reject) => {
    if (!hasIndexedDb()) {
      reject(new Error('IndexedDB indisponível.'));
      return;
    }
    const req = indexedDB.open(AUTO_SNAPSHOT_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(AUTO_SNAPSHOT_STORE_NAME)) {
        db.createObjectStore(AUTO_SNAPSHOT_STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Erro ao abrir snapshots'));
  });
}

async function readAllSnapshotsRaw() {
  if (!hasIndexedDb()) {
    return Array.from(memorySnapshotStore.values());
  }
  try {
    const db = await openSnapshotDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(AUTO_SNAPSHOT_STORE_NAME, 'readonly');
      const req = tx.objectStore(AUTO_SNAPSHOT_STORE_NAME).getAll();
      req.onsuccess = () => {
        db.close();
        resolve(Array.isArray(req.result) ? req.result : []);
      };
      req.onerror = () => {
        db.close();
        resolve([]);
      };
    });
  } catch {
    return [];
  }
}

export async function listAutoSnapshots() {
  const list = await readAllSnapshotsRaw();
  return list
    .filter((entry) => entry && entry.id && entry.payload)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, MAX_AUTO_SNAPSHOTS);
}

function stripTimestampsForContentHash(obj) {
  if (Array.isArray(obj)) return obj.map(stripTimestampsForContentHash);
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'createdAt' || k === 'updatedAt' || k === 'exportedAt' || k === 'signedAt') {
      continue;
    }
    out[k] = stripTimestampsForContentHash(v);
  }
  return out;
}

export async function saveAutoSnapshot(
  workspaceData = {},
  { reason = 'auto', label = '', force = false } = {}
) {
  const db =
    workspaceData?.tables && workspaceData?.schemaVersion
      ? migrateDatabase(workspaceData)
      : buildCodiceDatabase({
          items: workspaceData.items || [],
          profile: workspaceData.profile || null,
          posts: workspaceData.posts || [],
          streak: workspaceData.streak || null,
          readingSessions: workspaceData.readingSessions || [],
          collections: workspaceData.collections || [],
          episodeEvaluations: workspaceData.episodeEvaluations || [],
        });

  const snapshot = hydrateAppSnapshotFromDatabase(db);
  const counts = countDatabaseEntities(db, snapshot);
  const signedPayload = await exportSignedBackupPayload(db);

  const contentHash = await computeSha256Hex(
    JSON.stringify({
      tables: stripTimestampsForContentHash(db.tables),
      streak: db.metadata?.streak || null,
    })
  );

  const existing = await listAutoSnapshots();
  if (!force && existing.length > 0 && existing[0].contentHash === contentHash) {
    return { saved: false, deduplicated: true, snapshot: existing[0] };
  }

  const createdAt = new Date().toISOString();
  const record = {
    id: `snap_${Date.now()}_${createUuid().slice(0, 8)}`,
    reason,
    label:
      label ||
      (reason === 'manual' ? 'Ponto de restauração manual' : 'Auto-snapshot automático'),
    createdAt,
    schemaVersion: signedPayload.schemaVersion,
    digest: signedPayload.checksum.digest,
    contentHash,
    counts,
    payload: signedPayload,
  };

  if (!hasIndexedDb()) {
    memorySnapshotStore.set(record.id, record);
    const ordered = await listAutoSnapshots();
    const keepIds = new Set(ordered.map((r) => r.id));
    for (const k of Array.from(memorySnapshotStore.keys())) {
      if (!keepIds.has(k)) memorySnapshotStore.delete(k);
    }
    return { saved: true, deduplicated: false, snapshot: record };
  }

  const idb = await openSnapshotDb();
  const allAfter = [...existing, record]
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const toDelete = allAfter.slice(MAX_AUTO_SNAPSHOTS).map((r) => r.id);

  await new Promise((resolve, reject) => {
    const tx = idb.transaction(AUTO_SNAPSHOT_STORE_NAME, 'readwrite');
    const store = tx.objectStore(AUTO_SNAPSHOT_STORE_NAME);
    store.put(record);
    for (const oldId of toDelete) {
      store.delete(oldId);
    }
    tx.oncomplete = () => {
      idb.close();
      resolve();
    };
    tx.onerror = () => {
      idb.close();
      reject(tx.error || new Error('Erro ao gravar auto-snapshot'));
    };
    tx.onabort = () => {
      idb.close();
      reject(tx.error || new Error('Gravação de auto-snapshot abortada'));
    };
  });

  return { saved: true, deduplicated: false, snapshot: record };
}

/**
 * Lê um snapshot gravado de volta diretamente do storage (IndexedDB ou store em testes)
 * e confirma existência, digest SHA-256 válido e consistência das contagens (Regra extra 1).
 */
export async function verifyAutoSnapshotIntegrity(snapshotId, expectedWorkspace = null) {
  if (!snapshotId) {
    return { ok: false, reason: 'Identificador do snapshot ausente.' };
  }

  let found = null;
  if (!hasIndexedDb()) {
    found = memorySnapshotStore.get(snapshotId) || null;
  } else {
    try {
      const db = await openSnapshotDb();
      found = await new Promise((resolve) => {
        const tx = db.transaction(AUTO_SNAPSHOT_STORE_NAME, 'readonly');
        const req = tx.objectStore(AUTO_SNAPSHOT_STORE_NAME).get(snapshotId);
        req.onsuccess = () => {
          try { db.close(); } catch { /* silencioso */ }
          resolve(req.result || null);
        };
        req.onerror = () => {
          try { db.close(); } catch { /* silencioso */ }
          resolve(null);
        };
      });
    } catch {
      return { ok: false, reason: 'Não foi possível reler o snapshot no IndexedDB.' };
    }
  }

  if (!found?.payload) {
    return { ok: false, reason: 'Snapshot não encontrado ao tentar relê-lo.' };
  }

  const verified = await inspectBackupPayload(JSON.stringify(found.payload));
  if (!verified.ok) {
    return { ok: false, reason: verified.error || 'Payload do snapshot inválido.' };
  }
  if (verified.checksumStatus !== 'valid') {
    return { ok: false, reason: 'Checksum SHA-256 do snapshot divergente.' };
  }
  if (expectedWorkspace && Array.isArray(expectedWorkspace.items)) {
    if (verified.counts.works !== expectedWorkspace.items.length) {
      return {
        ok: false,
        reason: `Contagem divergente no snapshot (${verified.counts.works} vs ${expectedWorkspace.items.length}).`,
      };
    }
  }

  return { ok: true, snapshot: found, verified };
}

export async function deleteAutoSnapshot(snapshotId) {
  if (!snapshotId) return;
  if (!hasIndexedDb()) {
    memorySnapshotStore.delete(snapshotId);
    return;
  }
  try {
    const db = await openSnapshotDb();
    await new Promise((resolve) => {
      const tx = db.transaction(AUTO_SNAPSHOT_STORE_NAME, 'readwrite');
      tx.objectStore(AUTO_SNAPSHOT_STORE_NAME).delete(snapshotId);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    });
  } catch {
    // Silencioso
  }
}

function bytesToBase64(uint8Bytes) {
  let binary = '';
  for (let i = 0; i < uint8Bytes.length; i += 1) {
    binary += String.fromCharCode(uint8Bytes[i]);
  }
  if (typeof btoa === 'function') return btoa(binary);
  return Buffer.from(uint8Bytes).toString('base64');
}

function base64ToBytes(b64) {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) {
      bytes[i] = bin.charCodeAt(i);
    }
    return bytes;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

export function compressMirrorText(plainText) {
  const utf8 = new TextEncoder().encode(String(plainText ?? ''));
  if (utf8.length === 0) return 'CM1:';

  const dict = new Map();
  for (let i = 0; i < 256; i += 1) {
    dict.set(String.fromCharCode(i), i);
  }

  let nextCode = 256;
  let phrase = String.fromCharCode(utf8[0]);
  const codes = [];

  for (let i = 1; i < utf8.length; i += 1) {
    const ch = String.fromCharCode(utf8[i]);
    const combined = phrase + ch;
    if (dict.has(combined)) {
      phrase = combined;
    } else {
      codes.push(dict.get(phrase));
      if (nextCode < 4096) {
        dict.set(combined, nextCode);
        nextCode += 1;
      }
      phrase = ch;
    }
  }
  codes.push(dict.get(phrase));

  const packed = [];
  for (let i = 0; i < codes.length; i += 2) {
    const c1 = codes[i];
    const c2 = i + 1 < codes.length ? codes[i + 1] : null;
    if (c2 === null) {
      packed.push((c1 >> 4) & 0xff, ((c1 & 0x0f) << 4) & 0xff);
    } else {
      packed.push(
        (c1 >> 4) & 0xff,
        ((c1 & 0x0f) << 4) | ((c2 >> 8) & 0x0f),
        c2 & 0xff
      );
    }
  }

  const out = new Uint8Array(1 + packed.length);
  out[0] = codes.length % 2;
  out.set(packed, 1);
  return `CM1:${bytesToBase64(out)}`;
}

export function decompressMirrorText(encoded) {
  const raw = String(encoded ?? '').trim();
  if (!raw) return '';
  if (!raw.startsWith('CM1:')) return raw;
  const body = raw.slice(4);
  if (!body) return '';

  const bytes = base64ToBytes(body);
  const hasOddTail = bytes[0] === 1;
  const codes = [];

  for (let i = 1; i < bytes.length; ) {
    const remaining = bytes.length - i;
    if (remaining === 2 && hasOddTail) {
      codes.push((bytes[i] << 4) | (bytes[i + 1] >> 4));
      break;
    }
    if (remaining < 3) break;
    const c1 = (bytes[i] << 4) | (bytes[i + 1] >> 4);
    const c2 = ((bytes[i + 1] & 0x0f) << 8) | bytes[i + 2];
    codes.push(c1, c2);
    i += 3;
  }

  if (codes.length === 0) return '';

  const dict = [];
  for (let i = 0; i < 256; i += 1) {
    dict[i] = String.fromCharCode(i);
  }

  let nextCode = 256;
  let prevPhrase = dict[codes[0]];
  let result = prevPhrase;

  for (let i = 1; i < codes.length; i += 1) {
    const code = codes[i];
    let entry;
    if (dict[code] !== undefined) {
      entry = dict[code];
    } else if (code === nextCode) {
      entry = prevPhrase + prevPhrase[0];
    } else {
      throw new Error('Espelho de emergência corrompido.');
    }
    result += entry;
    if (nextCode < 4096) {
      dict[nextCode] = prevPhrase + entry[0];
      nextCode += 1;
    }
    prevPhrase = entry;
  }

  const outBytes = new Uint8Array(result.length);
  for (let i = 0; i < result.length; i += 1) {
    outBytes[i] = result.charCodeAt(i);
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(outBytes);
}

const MIRROR_ITEM_ALLOWED_KEYS = [
  'id',
  'title',
  'originalTitle',
  'director',
  'studio',
  'cast',
  'workType',
  'status',
  'format',
  'audioFormat',
  'animeFormat',
  'durationMinutes',
  'totalSeconds',
  'currentSeconds',
  'episodeDurationMinutes',
  'currentSeason',
  'totalSeasons',
  'currentEpisode',
  'totalEpisodes',
  'episodesPerSeason',
  'watchedEpisodes',
  'fillerEpisodes',
  'storyArcs',
  'ignoreFillersInProgress',
  'rewatchCount',
  'progress',
  'progressPercent',
  'rating',
  'verdict',
  'reviewCriteria',
  'recommended',
  'isFavorite',
  'isWishlist',
  'isPlatinum',
  'inBacklog',
  'collectionIds',
  'genres',
  'primaryGenre',
  'subgenres',
  'tropes',
  'atmosphere',
  'releaseYear',
  'language',
  'franchiseName',
  'chronologicalOrder',
  'tmdbMediaType',
  'tmdbStatus',
  'belongsToCollection',
  'ids',
  'backdropUrl',
  'backdropCheckedAt',
  'favoriteScene',
  'favoriteRank',
  'externalRatings',
  'ratingSource',
  'franchiseRelations',
  'franchiseLinks',
  'animeFormat',
  'animeStatus',
  'anilistId',
  'malId',
  'tvmazeId',
  'tmdbId',
  'imdbId',
  'sourceBadge',
  'openAccessUrl',
  'notes',
  'synopsis',
  'overview',
  'moods',
  'quotes',
  'checkpoint',
  'hype',
  'dropReason',
  'startDate',
  'completedDate',
  'completedYear',
  'dropDate',
  'tags',
  'coverUrl',
  'coverSources',
  'monogram',
  'updatedAt',
  'createdAt',
];

function stripDataUrls(value) {
  if (typeof value === 'string') {
    return /^data:/i.test(value.trim()) ? '' : value;
  }
  if (Array.isArray(value)) {
    return value
      .map(stripDataUrls)
      .filter((entry) => entry !== '' && entry !== null && entry !== undefined);
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const clean = stripDataUrls(v);
      if (clean !== '' && clean !== null && clean !== undefined) {
        out[k] = clean;
      }
    }
    return Object.keys(out).length > 0 ? out : null;
  }
  return value;
}

function compactMirrorItem(item) {
  if (!item || typeof item !== 'object') return null;
  const out = {};
  MIRROR_ITEM_ALLOWED_KEYS.forEach((key) => {
    let val = item[key];
    if (key === 'coverUrl' || key === 'coverSources') {
      val = stripDataUrls(val);
    }
    if (val === null || val === undefined || val === '' || val === false) return;
    if (Array.isArray(val) && val.length === 0) return;
    if (typeof val === 'object' && !Array.isArray(val) && Object.keys(val).length === 0) return;
    out[key] = val;
  });
  return out.id && out.title ? out : null;
}

export async function requestPersistentStorage() {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage) {
      return { supported: false, persisted: false };
    }
    const alreadyPersisted =
      typeof navigator.storage.persisted === 'function'
        ? await navigator.storage.persisted()
        : false;
    if (alreadyPersisted) {
      return { supported: true, persisted: true };
    }
    if (typeof navigator.storage.persist === 'function') {
      const granted = await navigator.storage.persist();
      return { supported: true, persisted: Boolean(granted) };
    }
    return { supported: false, persisted: false };
  } catch {
    return { supported: false, persisted: false };
  }
}

function compactMirrorProfile(profile) {
  if (!profile || typeof profile !== 'object') return null;
  const clean = stripDataUrls({
    id: profile.id || null,
    displayName: profile.displayName || '',
    handle: profile.handle || '',
    avatarInitials: profile.avatarInitials || '',
    bio: profile.bio || '',
    viewerFocus: Array.isArray(profile.viewerFocus) ? profile.viewerFocus : [],
    readerFocus: profile.readerFocus || '',
    favoriteGenres: Array.isArray(profile.favoriteGenres) ? profile.favoriteGenres : [],
    preferredCriteria: Array.isArray(profile.preferredCriteria) ? profile.preferredCriteria : [],
    preferredAtmosphere: profile.preferredAtmosphere || '',
    readerDna: profile.readerDna || null,
    onboardingCompleted: Boolean(profile.onboardingCompleted),
    annualGoal: Number(profile.annualGoal) || 24,
    preferredFormat: profile.preferredFormat || 'Streaming',
    privacyLevel: profile.privacyLevel || 'private',
    gamificationEnabled:
      profile.gamificationEnabled !== undefined ? Boolean(profile.gamificationEnabled) : true,
    calmMode: Boolean(profile.calmMode),
  });
  return clean && typeof clean === 'object' ? clean : null;
}

function compactMirrorEpisodeEvaluations(list = []) {
  if (!Array.isArray(list) || list.length === 0) return [];
  return list
    .filter((ev) => ev && ev.workId)
    .map((ev) => ({
      evalKey: ev.evalKey || `${ev.workId}:${ev.season || 1}:${ev.episode || 1}`,
      workId: String(ev.workId),
      season: Math.max(1, Math.round(Number(ev.season) || 1)),
      episode: Math.max(1, Math.round(Number(ev.episode) || 1)),
      rating:
        ev.rating !== null && ev.rating !== undefined && ev.rating !== ''
          ? Math.max(0, Math.min(100, Math.round(Number(ev.rating))))
          : null,
      tag: ev.tag || null,
      reaction: String(ev.reaction || '').slice(0, 280),
      updatedAt: ev.updatedAt || null,
    }));
}

export function saveEmergencyMirror({
  items = [],
  profile = null,
  collections = [],
  streak = null,
  readingSessions = [],
  episodeEvaluations = [],
  updatedAt = null,
} = {}) {
  try {
    if (typeof localStorage === 'undefined') return false;
    const compactItems = (Array.isArray(items) ? items : [])
      .map(compactMirrorItem)
      .filter(Boolean);

    const payload = {
      v: 2,
      updatedAt: updatedAt || new Date().toISOString(),
      items: compactItems,
      profile: compactMirrorProfile(profile),
      collections: normalizeCollectionList(collections),
      streak:
        streak && typeof streak === 'object'
          ? {
              count: Math.max(0, Number(streak.count) || 0),
              lastDate: streak.lastDate || null,
              history: Array.isArray(streak.history) ? streak.history.slice(-365) : [],
              dailyLogs:
                streak.dailyLogs && typeof streak.dailyLogs === 'object'
                  ? streak.dailyLogs
                  : {},
            }
          : null,
      readingSessions: Array.isArray(readingSessions)
        ? readingSessions.slice(0, 200)
        : [],
      episodeEvaluations: compactMirrorEpisodeEvaluations(episodeEvaluations),
    };

    const encoded = compressMirrorText(JSON.stringify(payload));
    localStorage.setItem(EMERGENCY_MIRROR_KEY, encoded);

    if (!localStorage.getItem(FIRST_ACTIVITY_SEEN_KEY) && compactItems.length > 0) {
      localStorage.setItem(FIRST_ACTIVITY_SEEN_KEY, String(Date.now()));
    }
    return true;
  } catch {
    return false;
  }
}

export function loadEmergencyMirror() {
  try {
    if (typeof localStorage === 'undefined') {
      return { ok: false, items: [], profile: null, episodeEvaluations: [] };
    }
    const raw = localStorage.getItem(EMERGENCY_MIRROR_KEY);
    if (!raw) return { ok: false, items: [], profile: null, episodeEvaluations: [] };
    const jsonText = decompressMirrorText(raw);
    if (!jsonText) return { ok: false, items: [], profile: null, episodeEvaluations: [] };
    const parsed = JSON.parse(jsonText);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.items)) {
      return { ok: false, items: [], profile: null, episodeEvaluations: [] };
    }

    return {
      ok: true,
      updatedAt: parsed.updatedAt || null,
      items: parsed.items,
      profile: parsed.profile || null,
      collections: normalizeCollectionList(parsed.collections),
      streak: parsed.streak || null,
      readingSessions: Array.isArray(parsed.readingSessions)
        ? parsed.readingSessions
        : [],
      episodeEvaluations: Array.isArray(parsed.episodeEvaluations)
        ? parsed.episodeEvaluations
        : [],
    };
  } catch {
    return { ok: false, items: [], profile: null, episodeEvaluations: [] };
  }
}

export function recordBackupExportTimestamp(nowMs = Date.now()) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(LAST_BACKUP_EXPORT_KEY, String(nowMs));
  } catch {
    // Silencioso
  }
}

export function getBackupReminderStatus({
  nowMs = Date.now(),
  itemCount = 0,
  itemsCount = 0,
  reminderDays = BACKUP_REMINDER_DAYS,
} = {}) {
  if ((itemCount || itemsCount) <= 0) {
    return { shouldRemind: false, daysWithoutBackup: 0 };
  }
  try {
    if (typeof localStorage === 'undefined') {
      return { shouldRemind: false, daysWithoutBackup: 0 };
    }
    const lastExportMs = Number(localStorage.getItem(LAST_BACKUP_EXPORT_KEY)) || 0;
    const firstSeenMs = Number(localStorage.getItem(FIRST_ACTIVITY_SEEN_KEY)) || 0;
    const anchorMs = lastExportMs || firstSeenMs;
    if (!anchorMs) {
      localStorage.setItem(FIRST_ACTIVITY_SEEN_KEY, String(nowMs));
      return { shouldRemind: false, daysWithoutBackup: 0 };
    }
    const diffDays = Math.floor((nowMs - anchorMs) / 86400000);
    return {
      shouldRemind: diffDays >= reminderDays,
      daysWithoutBackup: Math.max(0, diffDays),
    };
  } catch {
    return { shouldRemind: false, daysWithoutBackup: 0 };
  }
}

export async function shareOrDownloadSignedBackup(db) {
  const signed = await exportSignedBackupPayload(db);
  const jsonText = JSON.stringify(signed, null, 2);
  const stamp = getTodayLocalISO();
  const filename = `cine-codice-backup-${stamp}.json`;

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function' && typeof File !== 'undefined') {
    try {
      const file = new File([jsonText], filename, { type: 'application/json' });
      if (!navigator.canShare || navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: 'Backup OmniPrism',
          text: 'Cópia de segurança assinada com SHA-256 do OmniPrism.',
          files: [file],
        });
        recordBackupExportTimestamp();
        return { method: 'share', filename, digest: signed.checksum.digest };
      }
    } catch (err) {
      if (err?.name === 'AbortError') {
        return { method: 'cancelled', filename, digest: signed.checksum.digest };
      }
    }
  }

  triggerFileDownload(jsonText, filename, 'application/json;charset=utf-8');
  recordBackupExportTimestamp();
  return { method: 'download', filename, digest: signed.checksum.digest };
}
