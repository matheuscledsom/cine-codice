import { domainConfig, inferDomainFromWork } from '../config/domainConfig.js';
import { APP_BUILD_VERSION } from '../config/versioning.js';
import { migrateProfileData, migrateWorkItem } from '../lib/migrations.js';
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
import { computeWorkCompletenessScore } from './relationalDb.js';

export const BACKUP_ENVELOPE_FORMAT = 'omniprism-backup-v2';
export const DEVICE_ID_STORAGE_KEY = 'omniprism_device_id_v1';
export const LOCAL_DELETED_IDS_STORAGE_KEY = 'omniprism_local_deleted_ids_v1';
export const LEGACY_NO_CHECKSUM_WARNING =
  'Backup sem checksum (versão antiga) — proteção temporal aplicada';
export const AUTO_SNAPSHOT_DB_NAME = 'cine_codice_auto_snapshots_v1';
export const AUTO_SNAPSHOT_STORE_NAME = 'snapshots';
export const MAX_AUTO_SNAPSHOTS = 5;
export const EMERGENCY_MIRROR_KEY = 'cine_codice_emergency_mirror_v1';
export const LAST_BACKUP_EXPORT_KEY = 'cine_codice_last_backup_exported_at';
export const FIRST_ACTIVITY_SEEN_KEY = 'cine_codice_first_activity_seen_at';
export const BACKUP_REMINDER_DAYS = 7;

const BACKUP_SECRET_KEY_RE =
  /^(api_?key|apikey|tmdb_?key|omdb_?key|gemini_?key|groq_?key|openrouter_?key|rawg_?key|lastfm_?key|google_?books_?key|twitch_?client_?(?:id|secret)|access_?token|refresh_?token|auth_?token|bearer_?token|token|secret|password|authorization|service_?role|supabase_?anon_?key)$/i;

const memorySnapshotStore = new Map();

function hasIndexedDb() {
  return typeof indexedDB !== 'undefined';
}

export function clearMemorySnapshotsForTests() {
  memorySnapshotStore.clear();
}

export function readLocalDeletedIds(
  storage = typeof localStorage !== 'undefined' ? localStorage : null
) {
  if (!storage || typeof storage.getItem !== 'function') return [];
  try {
    const raw = storage.getItem(LOCAL_DELETED_IDS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

export function recordLocalDeletedIds(
  ids = [],
  storage = typeof localStorage !== 'undefined' ? localStorage : null
) {
  const incoming = (Array.isArray(ids) ? ids : [ids])
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  if (incoming.length === 0) return readLocalDeletedIds(storage);
  const merged = Array.from(new Set([...readLocalDeletedIds(storage), ...incoming])).slice(-1000);
  if (storage && typeof storage.setItem === 'function') {
    try {
      storage.setItem(LOCAL_DELETED_IDS_STORAGE_KEY, JSON.stringify(merged));
    } catch {
      // Ignora erro de cota
    }
  }
  return merged;
}

export function clearLocalDeletedIds(
  ids = [],
  storage = typeof localStorage !== 'undefined' ? localStorage : null
) {
  const toClear = new Set(
    (Array.isArray(ids) ? ids : [ids]).map((id) => String(id || '').trim()).filter(Boolean)
  );
  if (toClear.size === 0) return readLocalDeletedIds(storage);
  const next = readLocalDeletedIds(storage).filter((id) => !toClear.has(id));
  if (storage && typeof storage.setItem === 'function') {
    try {
      storage.setItem(LOCAL_DELETED_IDS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignora erro de cota
    }
  }
  return next;
}

export function getOrCreateDeviceId(
  storage = typeof localStorage !== 'undefined' ? localStorage : null
) {
  if (storage && typeof storage.getItem === 'function') {
    try {
      const existing = String(storage.getItem(DEVICE_ID_STORAGE_KEY) || '').trim();
      if (existing) return existing;
      const fresh = `dev-${createUuid()}`;
      storage.setItem(DEVICE_ID_STORAGE_KEY, fresh);
      return fresh;
    } catch {
      // Fallback em memória sem storage
    }
  }
  return `dev-${createUuid()}`;
}

/**
 * Remove recursivamente quaisquer chaves de API, segredos ou tokens antes de assinar/exportar o backup.
 */
export function stripSecretsFromBackupPayload(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stripSecretsFromBackupPayload(item));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const clean = {};
  for (const [key, val] of Object.entries(value)) {
    if (BACKUP_SECRET_KEY_RE.test(key)) continue;
    clean[key] = stripSecretsFromBackupPayload(val);
  }
  return clean;
}

export function computeCountsByDomain(works = []) {
  const counts = { cinema: 0, reading: 0, games: 0, music: 0 };
  for (const w of Array.isArray(works) ? works : []) {
    if (!w || w.inBacklog === false) continue;
    const dom = inferDomainFromWork(w);
    if (Object.prototype.hasOwnProperty.call(counts, dom)) {
      counts[dom] += 1;
    } else {
      counts.cinema += 1;
    }
  }
  return counts;
}

export function stripChecksumEnvelope(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }
  const rest = { ...payload };
  delete rest.checksum;
  return rest;
}

export function computeFnv64Hex(rawText) {
  const input = String(rawText ?? '');
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < data.length; i += 1) {
    h1 = Math.imul(h1 ^ data[i], 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (data[i] + i), 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

export async function computeSha256Hex(rawText, { forceFnvFallback = false } = {}) {
  const input = String(rawText ?? '');
  if (!forceFnvFallback && typeof globalThis !== 'undefined' && globalThis.crypto?.subtle?.digest) {
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
    const bytes = new Uint8Array(hashBuffer);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return computeFnv64Hex(input);
}

export async function computeBackupChecksum(rawText, { forceFnvFallback = false } = {}) {
  const canUseSha256 =
    !forceFnvFallback && typeof globalThis !== 'undefined' && Boolean(globalThis.crypto?.subtle?.digest);
  const digest = await computeSha256Hex(rawText, { forceFnvFallback: !canUseSha256 });
  return {
    algorithm: canUseSha256 ? 'SHA-256' : 'FNV-1a-64',
    digest,
  };
}

export async function exportSignedBackupPayload(
  db,
  {
    storage = typeof localStorage !== 'undefined' ? localStorage : null,
    appVersion = APP_BUILD_VERSION,
    deviceId = null,
    exportedAt = null,
    forceFnvFallback = false,
  } = {}
) {
  const secretFreeInput = stripSecretsFromBackupPayload(db);
  const sanitizedInput = stripBase64MediaFromWorks(secretFreeInput, {
    preserveCompressedManualCovers: true,
  });
  const baseDb = stripSecretsFromBackupPayload(
    stripBase64MediaFromWorks(migrateDatabase(sanitizedInput), {
      preserveCompressedManualCovers: true,
    })
  );
  const resolvedExportedAt = exportedAt || new Date().toISOString();
  const resolvedDeviceId = deviceId || getOrCreateDeviceId(storage);
  const countsByDomain = computeCountsByDomain(baseDb?.tables?.works || []);

  const envelopePayload = {
    format: BACKUP_ENVELOPE_FORMAT,
    schemaVersion: baseDb.schemaVersion,
    exportedAt: resolvedExportedAt,
    appVersion,
    deviceId: resolvedDeviceId,
    countsByDomain,
    ...baseDb,
  };

  const canonicalJson = JSON.stringify(stripChecksumEnvelope(envelopePayload));
  const checksumInfo = await computeBackupChecksum(canonicalJson, { forceFnvFallback });

  return {
    ...envelopePayload,
    checksum: {
      algorithm: checksumInfo.algorithm,
      digest: checksumInfo.digest,
      signedAt: resolvedExportedAt,
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

export async function exportSignedCcodexPayload(
  db,
  { password = '', storage, appVersion = APP_BUILD_VERSION, deviceId = null, exportedAt = null } = {}
) {
  const signedJson = await exportSignedBackupPayload(db, {
    storage,
    appVersion,
    deviceId,
    exportedAt,
  });
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

    // Valida checksum do conteúdo DEPOIS de descriptografar (.ccodex) ou parsear (.json)
    const declaredDigest = parsed?.checksum?.digest
      ? String(parsed.checksum.digest).toLowerCase().trim()
      : '';
    const declaredAlgorithm = String(parsed?.checksum?.algorithm || 'SHA-256').trim();
    let checksumStatus = 'unsigned';
    let computedDigest = '';

    if (declaredDigest) {
      const canonical = JSON.stringify(stripChecksumEnvelope(parsed));
      const useFnv = /fnv/i.test(declaredAlgorithm);
      computedDigest = (
        await computeSha256Hex(canonical, { forceFnvFallback: useFnv })
      ).toLowerCase();
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
    const envelopeFormat =
      typeof parsed?.format === 'string' && parsed.format.trim() ? parsed.format.trim() : null;
    const isLegacyWithoutHeader = !declaredDigest && envelopeFormat !== BACKUP_ENVELOPE_FORMAT;
    const legacyWarning =
      checksumStatus === 'unsigned' ? LEGACY_NO_CHECKSUM_WARNING : '';
    const exportedAt =
      parsed?.exportedAt ||
      parsed?.checksum?.signedAt ||
      parsed?.metadata?.exportedAt ||
      null;
    const appVersion = parsed?.appVersion || null;
    const deviceId = parsed?.deviceId || null;
    const countsByDomain =
      parsed?.countsByDomain && typeof parsed.countsByDomain === 'object'
        ? parsed.countsByDomain
        : computeCountsByDomain(snapshot?.items || []);

    let mergePreview = null;
    if (options?.currentWorkspace && typeof options.currentWorkspace === 'object') {
      mergePreview = smartMergeBackup({
        currentWorkspace: options.currentWorkspace,
        incomingSnapshot: snapshot,
        deletedIds: Array.isArray(options.deletedIds) ? options.deletedIds : [],
        forceReplace: false,
        includeDeleted: Boolean(options.includeDeleted),
      }).summary;
    }

    return {
      ok: true,
      format: backupContainerFormat,
      envelopeFormat,
      exportedAt,
      appVersion,
      deviceId,
      countsByDomain,
      encrypted: wasEncrypted,
      compressionStats,
      checksumStatus,
      checksumAlgorithm: declaredDigest ? declaredAlgorithm : null,
      isLegacyWithoutHeader,
      legacyWarning,
      declaredDigest,
      computedDigest,
      integrity,
      counts,
      detectedSchemaVersion: parsed?.schemaVersion || '1.0',
      schemaVersion: db.schemaVersion,
      mergePreview,
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

function collectBackupWorkIdentityKeys(work = {}) {
  const keys = [];
  if (work?.id) keys.push(`id:${String(work.id).trim().toLowerCase()}`);
  if (work?.cloudId) keys.push(`id:${String(work.cloudId).trim().toLowerCase()}`);

  const domain = inferDomainFromWork(work);
  const ids = work?.ids && typeof work.ids === 'object' ? work.ids : {};
  const extPairs = [
    ['tmdb', work.tmdbId || ids.tmdb],
    ['imdb', work.imdbId || ids.imdb],
    ['anilist', work.anilistId || ids.anilist],
    ['mal', work.malId || ids.mal],
    ['tvmaze', work.tvmazeId || ids.tvmaze],
    ['igdb', work.igdbId || ids.igdb],
    ['rawg', work.rawgId || ids.rawg],
    ['steam', work.steamAppId || ids.steam],
    ['isbn', work.isbnOrDoi || work.isbn || ids.isbn],
    ['googleBooks', ids.googleBooks],
    ['ol', ids.ol],
    ['musicbrainz', work.musicBrainzId || ids.musicbrainz],
    ['manual', ids.source === 'manual' ? ids.id || work.id : ids.linkedFromManualId],
  ];
  for (const [k, v] of extPairs) {
    const clean = String(v || '').trim().toLowerCase();
    if (clean) keys.push(`ext:${domain}:${k}:${clean}`);
  }
  return keys;
}

function resolveWorkUpdatedMs(work = {}) {
  if (!work || typeof work !== 'object' || work._missingUpdatedAt === true) return null;
  const raw = work.updated_at ?? work.updatedAt ?? null;
  if (!raw) return null;
  const parsed = Date.parse(String(raw));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function cleanInternalMergeFlags(work = {}) {
  if (!work || typeof work !== 'object') return work;
  const copy = { ...work };
  delete copy._missingUpdatedAt;
  return copy;
}

/**
 * Mesclagem inteligente anti-sobrescrita (OMNIPRISM v2.6.0 — Fase 4).
 *
 * Regras:
 * - Compara cada obra por `id` ou `external_ids` usando `updated_at` e nível de preenchimento.
 * - Registro mais antigo no arquivo NUNCA sobrescreve um mais recente no aparelho (exceto com `forceReplace: true`).
 * - Obra sem `updated_at` no arquivo conta como mais antiga que obra local com `updated_at`, sem apagar nada.
 * - Se a obra consta em `deletedIds` local, sinaliza em `summary.deletedConflicts` antes de reimportar.
 */
export function smartMergeBackup({
  currentWorkspace = {},
  incomingSnapshot = {},
  deletedIds = [],
  forceReplace = false,
  includeDeleted = false,
} = {}) {
  const currentItems = Array.isArray(currentWorkspace.items) ? currentWorkspace.items : [];
  const incomingItems = Array.isArray(incomingSnapshot.items) ? incomingSnapshot.items : [];
  const deletedSet = new Set(
    (Array.isArray(deletedIds) ? deletedIds : [])
      .map((id) => String(id || '').trim().toLowerCase())
      .filter(Boolean)
  );

  let newWorks = 0;
  let updatedWorks = 0;
  let protectedConflicts = 0;
  let unchangedWorks = 0;
  const conflicts = [];
  const deletedConflicts = [];

  let mergedItems = [];

  if (forceReplace) {
    mergedItems = incomingItems
      .filter((w) => w && w.id)
      .map((w) => {
        const clean = cleanInternalMergeFlags(w);
        const ts = clean.updatedAt || clean.updated_at || new Date().toISOString();
        return { ...clean, updatedAt: ts, updated_at: ts };
      });
    newWorks = mergedItems.length;
  } else {
    const itemMap = new Map();
    const keyIndex = new Map();

    const registerLocal = (canonicalId, work) => {
      itemMap.set(canonicalId, work);
      for (const k of collectBackupWorkIdentityKeys(work)) {
        keyIndex.set(k, canonicalId);
      }
    };

    for (const item of currentItems) {
      if (!item?.id) continue;
      registerLocal(String(item.id), item);
    }

    for (const incoming of incomingItems) {
      if (!incoming || (!incoming.id && !incoming.title)) continue;
      const incomingId = String(incoming.id || createUuid());
      const incomingIdLow = incomingId.toLowerCase();
      const incomingCloudLow = incoming.cloudId
        ? String(incoming.cloudId).trim().toLowerCase()
        : '';

      const isDeletedLocally =
        deletedSet.has(incomingIdLow) || (incomingCloudLow && deletedSet.has(incomingCloudLow));

      const incomingKeys = collectBackupWorkIdentityKeys({ ...incoming, id: incomingId });
      let matchedCanonicalId = null;
      for (const k of incomingKeys) {
        if (keyIndex.has(k)) {
          matchedCanonicalId = keyIndex.get(k);
          break;
        }
      }

      if (isDeletedLocally && !matchedCanonicalId) {
        deletedConflicts.push({
          id: incomingId,
          title: incoming.title || 'Obra sem título',
          domain: inferDomainFromWork(incoming),
          reason: 'deleted_locally',
        });
        if (!includeDeleted) {
          continue;
        }
      }

      if (!matchedCanonicalId) {
        const cleanInc = cleanInternalMergeFlags({ ...incoming, id: incomingId });
        const ts = cleanInc.updatedAt || cleanInc.updated_at || new Date().toISOString();
        registerLocal(incomingId, { ...cleanInc, updatedAt: ts, updated_at: ts });
        newWorks += 1;
        continue;
      }

      const existing = itemMap.get(matchedCanonicalId);
      const localMs = resolveWorkUpdatedMs(existing);
      const incomingMs = resolveWorkUpdatedMs(incoming);
      const localScore = computeWorkCompletenessScore(existing);
      const incomingScore = computeWorkCompletenessScore(incoming);

      // Decide vencedor com proteção anti-sobrescrita rigorosa
      let incomingWins = false;
      let conflictReason = null;

      if (incomingMs === null && localMs !== null) {
        // Obra sem updated_at no arquivo conta como mais antiga que obra local com updated_at
        incomingWins = false;
        conflictReason = 'missing_incoming_timestamp';
      } else if (incomingMs !== null && localMs !== null) {
        if (incomingMs > localMs) {
          incomingWins = true;
        } else if (incomingMs < localMs) {
          incomingWins = false;
          conflictReason = 'older_incoming_timestamp';
        } else if (incomingScore > localScore) {
          incomingWins = true;
        } else if (localScore > incomingScore) {
          incomingWins = false;
          conflictReason = 'local_more_complete';
        } else {
          unchangedWorks += 1;
          continue;
        }
      } else if (incomingMs !== null && localMs === null) {
        if (incomingScore >= localScore) {
          incomingWins = true;
        } else {
          incomingWins = false;
          conflictReason = 'local_more_complete';
        }
      } else {
        // Ambos sem timestamp -> preserva o registro mais completo
        if (incomingScore > localScore) {
          incomingWins = true;
        } else if (localScore > incomingScore) {
          incomingWins = false;
          conflictReason = 'local_more_complete';
        } else {
          unchangedWorks += 1;
          continue;
        }
      }

      if (incomingWins) {
        const cleanInc = cleanInternalMergeFlags(incoming);
        const nextTs =
          cleanInc.updatedAt ||
          cleanInc.updated_at ||
          existing.updatedAt ||
          new Date().toISOString();
        const preservedManualCover =
          cleanInc.manualCoverDataUrl || existing.manualCoverDataUrl || undefined;
        const winner = {
          ...existing,
          ...cleanInc,
          id: existing.id,
          ...(preservedManualCover ? { manualCoverDataUrl: preservedManualCover } : {}),
          coverUrl: cleanInc.coverUrl || existing.coverUrl || preservedManualCover || null,
          quotes: mergeQuotesArrays(existing.quotes, cleanInc.quotes),
          updatedAt: nextTs,
          updated_at: nextTs,
        };
        registerLocal(matchedCanonicalId, winner);
        updatedWorks += 1;
      } else {
        // Protegido: mantém dados locais mais recentes/completos intactos (apenas unifica citações)
        const protectedLocal = {
          ...existing,
          quotes: mergeQuotesArrays(existing.quotes, incoming.quotes),
        };
        registerLocal(matchedCanonicalId, protectedLocal);
        protectedConflicts += 1;
        conflicts.push({
          id: existing.id,
          title: existing.title || incoming.title || 'Obra sem título',
          reason: conflictReason || 'older_incoming_timestamp',
          localUpdatedAt: existing.updatedAt || existing.updated_at || null,
          incomingUpdatedAt: incoming._missingUpdatedAt
            ? null
            : incoming.updatedAt || incoming.updated_at || null,
        });
      }
    }

    mergedItems = Array.from(itemMap.values());
  }

  const mergeById = (currList = [], incList = []) => {
    if (forceReplace) return Array.isArray(incList) ? incList : [];
    const map = new Map();
    for (const row of Array.isArray(currList) ? currList : []) {
      if (row?.id) map.set(String(row.id), row);
    }
    for (const row of Array.isArray(incList) ? incList : []) {
      if (!row?.id) continue;
      const key = String(row.id);
      const existing = map.get(key);
      if (!existing) {
        map.set(key, row);
      } else {
        const incT = Date.parse(row.updatedAt || row.updated_at || row.createdAt || '') || 0;
        const curT = Date.parse(existing.updatedAt || existing.updated_at || existing.createdAt || '') || 0;
        if (incT > curT) map.set(key, row);
      }
    }
    return Array.from(map.values());
  };

  const currProfile = currentWorkspace.profile || {};
  const incProfile = incomingSnapshot.profile || {};
  const mergedProfile = forceReplace
    ? incomingSnapshot.profile
    : {
        ...incProfile,
        ...currProfile,
        displayName: currProfile.displayName || incProfile.displayName,
        bio: currProfile.bio || incProfile.bio || '',
        avatarUrl: currProfile.avatarUrl || incProfile.avatarUrl || '',
        coverUrl: currProfile.coverUrl || incProfile.coverUrl || '',
      };

  const currStreak = currentWorkspace.streak || { count: 0, lastDate: null, history: [], dailyLogs: {} };
  const incStreak = incomingSnapshot.streak || { count: 0, lastDate: null, history: [], dailyLogs: {} };
  const mergedStreak = forceReplace
    ? incStreak
    : {
        count: Math.max(Number(currStreak.count) || 0, Number(incStreak.count) || 0),
        lastDate: [currStreak.lastDate, incStreak.lastDate].filter(Boolean).sort().pop() || null,
        history: Array.from(new Set([...(currStreak.history || []), ...(incStreak.history || [])])).sort(),
        dailyLogs: {
          ...(incStreak.dailyLogs && typeof incStreak.dailyLogs === 'object' ? incStreak.dailyLogs : {}),
          ...(currStreak.dailyLogs && typeof currStreak.dailyLogs === 'object' ? currStreak.dailyLogs : {}),
        },
      };

  const currEvalList = Array.isArray(currentWorkspace.episodeEvaluations)
    ? currentWorkspace.episodeEvaluations
    : [];
  const incEvalList = Array.isArray(incomingSnapshot.episodeEvaluations)
    ? incomingSnapshot.episodeEvaluations
    : [];
  const evalMap = new Map();
  const buildEvalKey = (r) =>
    r?.evalKey || (r?.workId ? `${r.workId}:s${Number(r.season) || 1}:e${Number(r.episode) || 1}` : null);
  for (const row of forceReplace ? [] : currEvalList) {
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
    workspace: {
      items: mergedItems,
      posts: mergeById(currentWorkspace.posts, incomingSnapshot.posts),
      readingSessions: mergeById(
        currentWorkspace.readingSessions,
        incomingSnapshot.readingSessions
      ),
      collections: forceReplace
        ? normalizeCollectionList(incomingSnapshot.collections || [])
        : normalizeCollectionList([
            ...(currentWorkspace.collections || []),
            ...(incomingSnapshot.collections || []),
          ]),
      episodeEvaluations: Array.from(evalMap.values()),
      profile: mergedProfile,
      streak: mergedStreak,
    },
    summary: {
      newWorks,
      updatedWorks,
      protectedConflicts,
      unchangedWorks,
      deletedConflictsCount: deletedConflicts.length,
      deletedConflicts,
      conflicts,
      forceReplace: Boolean(forceReplace),
      label: `${newWorks} obras novas · ${updatedWorks} atualizações mais recentes · ${protectedConflicts} conflitos protegidos`,
    },
  };
}

export function mergeSnapshots(currentSnapshot = {}, incomingSnapshot = {}, options = {}) {
  return smartMergeBackup({
    currentWorkspace: currentSnapshot,
    incomingSnapshot,
    deletedIds: options?.deletedIds || [],
    forceReplace: false,
    includeDeleted: Boolean(options?.includeDeleted),
  }).workspace;
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
  'reviewCriteria5',
  'ratingManualOverride',
  'lifeWork',
  'franchiseTier',
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

/**
 * Restaura um snapshot (modo 'merge' ou 'replace') criando SEMPRE um auto-snapshot
 * de segurança prévio antes de alterar o estado atual do usuário (v2.4.0 Fase 1.1).
 */
export async function restoreSnapshotWithSafety({
  currentWorkspace = {},
  incomingSnapshot = null,
  mode = 'merge',
  deletedIds = [],
  includeDeleted = false,
  saveSnapshotFn = saveAutoSnapshot,
} = {}) {
  if (!incomingSnapshot || typeof incomingSnapshot !== 'object') {
    return { ok: false, error: 'Snapshot de restauração ausente ou inválido.' };
  }

  const cleanMode = mode === 'replace' ? 'replace' : 'merge';
  const snapshotReason = cleanMode === 'replace' ? 'pre-restore-replace' : 'pre-restore-merge';
  const snapshotLabel =
    cleanMode === 'replace'
      ? 'Pré-restauração automática (Forçar substituição total)'
      : 'Pré-restauração automática (Mesclar inteligente)';

  let snapshotSaved = false;
  let snapshotId = null;
  if (typeof saveSnapshotFn === 'function') {
    try {
      const snapRes = await saveSnapshotFn(currentWorkspace, {
        reason: snapshotReason,
        label: snapshotLabel,
        force: true,
      });
      snapshotId = snapRes?.snapshot?.id || null;
      snapshotSaved = Boolean(snapshotId || snapRes?.saved);
    } catch {
      snapshotSaved = false;
    }
  }

  const mergeOutcome = smartMergeBackup({
    currentWorkspace,
    incomingSnapshot,
    deletedIds,
    forceReplace: cleanMode === 'replace',
    includeDeleted,
  });
  const baseResult = mergeOutcome.workspace;

  const migratedItems = (baseResult.items || []).map((entry) => migrateWorkItem(entry));
  const migratedProfile = baseResult.profile
    ? migrateProfileData(baseResult.profile)
    : baseResult.profile;

  return {
    ok: true,
    mode: cleanMode,
    snapshotSaved,
    snapshotId,
    snapshotReason,
    summary: mergeOutcome.summary,
    workspace: {
      ...baseResult,
      items: migratedItems,
      profile: migratedProfile,
    },
  };
}

/**
 * Monta um backup JSON diretamente do localStorage para o Error Boundary global,
 * funcionando mesmo se o estado React ou IndexedDB estiverem indisponíveis.
 */
export function buildEmergencyBackupFromStorage(
  storage = typeof localStorage !== 'undefined' ? localStorage : null
) {
  const safeReadJson = (key, fallback) => {
    if (!storage || typeof storage.getItem !== 'function') return fallback;
    try {
      const raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  };

  const relationalDb = safeReadJson('cine_codice_relational_db_v1', null);
  const rawItems = safeReadJson(domainConfig.storageKey, []);
  const items = Array.isArray(rawItems)
    ? rawItems
    : Array.isArray(relationalDb?.tables?.works)
      ? hydrateAppSnapshotFromDatabase(relationalDb).items
      : [];
  const profile = safeReadJson(domainConfig.profileStorageKey, null);
  const posts = safeReadJson(domainConfig.postsStorageKey, []);
  const streak = safeReadJson(domainConfig.streakStorageKey, null);
  const readingSessions = safeReadJson('cine_codice_reading_sessions_v1', []);
  const collections = safeReadJson('cine_codice_collections_v1', []);

  return buildCodiceDatabase({
    items,
    profile,
    posts: Array.isArray(posts) ? posts : [],
    streak,
    readingSessions: Array.isArray(readingSessions) ? readingSessions : [],
    collections: Array.isArray(collections) ? collections : [],
  });
}

export async function downloadEmergencyBackupFromStorage(
  storage = typeof localStorage !== 'undefined' ? localStorage : null
) {
  const db = buildEmergencyBackupFromStorage(storage);
  const signed = await exportSignedBackupPayload(db);
  const jsonText = JSON.stringify(signed, null, 2);
  const stamp = getTodayLocalISO();
  const filename = `omniprism-emergency-backup-${stamp}.json`;
  triggerFileDownload(jsonText, filename, 'application/json;charset=utf-8');
  return {
    ok: true,
    filename,
    worksCount: Array.isArray(db?.tables?.works) ? db.tables.works.length : 0,
    digest: signed?.checksum?.digest || '',
  };
}
