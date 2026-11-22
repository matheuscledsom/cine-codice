/**
 * Motor puro e atômico de migração de dados da v1.0.0 → v1.1.0 (R8 / R10 / D2 / D7).
 *
 * Regras extras aplicadas:
 * 1) Grava snapshot automático antes de migrar, lê o snapshot de volta para confirmar integridade
 *    e aborta mantendo os dados originais intactos caso o snapshot falhe.
 * 2) Execução "tudo ou nada": qualquer falha no meio da migração descarta mudanças parciais.
 */

import { migrateFavoriteGenresToObjects } from './genreCatalog.js';
import { applyCanonicalIdsToWork, CANONICAL_ID_KEYS } from './idBridge.js';
import { createEmptyExternalRatings, normalizeExternalRatings } from './ratings.js';

export const CURRENT_MIGRATION_VERSION = 2;
export const MIGRATION_VERSION_KEY = 'cine_codice_migration_version_v1';

const VALID_RATING_SOURCES = new Set(['manual', 'episodes', 'legacy-default']);

function deepCloneSafe(value) {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(deepCloneSafe);
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = deepCloneSafe(v);
  }
  return out;
}

export function hasMeaningfulReviewCriteria(reviewCriteria) {
  if (!reviewCriteria || typeof reviewCriteria !== 'object' || Array.isArray(reviewCriteria)) {
    return false;
  }
  const entries = Object.values(reviewCriteria);
  if (entries.length === 0) return false;
  return entries.some((v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)));
}

/**
 * Classifica `ratingSource` retroativamente sem apagar notas antigas:
 * - Já classificado ('manual' | 'episodes' | 'legacy-default') -> mantém idempotente.
 * - Sem nota -> null.
 * - rating === 80 SEM reviewCriteria e SEM resenha (notes) -> 'legacy-default'.
 * - Demais notas válidas -> 'manual'.
 */
export function classifyLegacyRatingSource(rawItem) {
  if (!rawItem || typeof rawItem !== 'object') return null;
  if (VALID_RATING_SOURCES.has(rawItem.ratingSource)) {
    return rawItem.ratingSource;
  }
  if (rawItem.rating === null || rawItem.rating === undefined || rawItem.rating === '') {
    return null;
  }
  const numRating = Number(rawItem.rating);
  if (!Number.isFinite(numRating)) return null;

  const hasCriteria = hasMeaningfulReviewCriteria(rawItem.reviewCriteria);
  const hasNotes = Boolean(String(rawItem.notes || '').trim());

  if (Math.round(numRating) === 80 && !hasCriteria && !hasNotes) {
    return 'legacy-default';
  }
  return 'manual';
}

function normalizeFranchiseLinks(rawLinks) {
  if (!Array.isArray(rawLinks)) return [];
  return rawLinks
    .filter((l) => l && (l.targetWorkId || l.title || l.tmdbId || l.anilistId))
    .map((l) => ({
      targetWorkId: l.targetWorkId ? String(l.targetWorkId) : null,
      title: String(l.title || '').trim(),
      workType: l.workType || 'series',
      relationType: String(l.relationType || 'SEQUEL').toUpperCase(),
      tmdbId: Number(l.tmdbId) || null,
      anilistId: Number(l.anilistId) || null,
    }));
}

export function migrateWorkItem(rawItem) {
  if (!rawItem || typeof rawItem !== 'object') return rawItem;
  const clone = deepCloneSafe(rawItem);
  const withIds = applyCanonicalIdsToWork(clone);
  const ratingSource = classifyLegacyRatingSource(clone);
  const externalRatings = clone.externalRatings
    ? normalizeExternalRatings(clone.externalRatings)
    : createEmptyExternalRatings();

  return {
    ...withIds,
    ratingSource,
    externalRatings,
    backdropUrl: clone.backdropUrl || null,
    franchiseLinks: normalizeFranchiseLinks(clone.franchiseLinks),
  };
}

export function normalizeViewerFocusList(rawFocus, legacyFocus) {
  const candidates = [];
  if (Array.isArray(rawFocus)) {
    candidates.push(...rawFocus);
  } else if (typeof rawFocus === 'string' && rawFocus.trim()) {
    candidates.push(...rawFocus.split(/[,;]/));
  }
  if (candidates.length === 0 && typeof legacyFocus === 'string' && legacyFocus.trim()) {
    candidates.push(...legacyFocus.split(/[,;]/));
  }

  const cleaned = Array.from(
    new Set(candidates.map((v) => String(v || '').trim()).filter(Boolean))
  );
  return cleaned.length > 0 ? cleaned : ['Cinéfilo Curador'];
}

export function migrateProfileData(rawProfile) {
  if (!rawProfile || typeof rawProfile !== 'object') {
    return {
      viewerFocus: ['Cinéfilo Curador'],
      readerFocus: 'Cinéfilo Curador',
      favoriteGenres: [],
      profileSchemaVersion: 3,
    };
  }
  const clone = deepCloneSafe(rawProfile);
  const viewerFocus = normalizeViewerFocusList(
    clone.viewerFocus ?? clone.viewer_focus,
    clone.readerFocus ?? clone.reader_focus
  );
  const favoriteGenres = migrateFavoriteGenresToObjects(
    clone.favoriteGenres ?? clone.favorite_genres
  );

  // R8: mantém campos antigos (annualGoal, preferredFormat) no objeto sem apagá-los.
  return {
    ...clone,
    viewerFocus,
    readerFocus: viewerFocus[0] || clone.readerFocus || 'Cinéfilo Curador',
    favoriteGenres,
    profileSchemaVersion: 3,
  };
}

function itemHasCanonicalIds(item) {
  if (!item?.ids || typeof item.ids !== 'object') return false;
  return CANONICAL_ID_KEYS.every((k) => Object.prototype.hasOwnProperty.call(item.ids, k));
}

export function needsWorkspaceMigration(workspace = {}, storedMigrationVersion = 0) {
  if (Number(storedMigrationVersion) < CURRENT_MIGRATION_VERSION) {
    return true;
  }
  const items = Array.isArray(workspace.items) ? workspace.items : [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    if (!itemHasCanonicalIds(item)) return true;
    if (
      item.rating !== null &&
      item.rating !== undefined &&
      item.rating !== '' &&
      !VALID_RATING_SOURCES.has(item.ratingSource)
    ) {
      return true;
    }
  }
  const profile = workspace.profile;
  if (profile && typeof profile === 'object') {
    if (!Array.isArray(profile.viewerFocus) || profile.viewerFocus.length === 0) {
      return true;
    }
    if (
      Array.isArray(profile.favoriteGenres) &&
      profile.favoriteGenres.some((g) => typeof g === 'string')
    ) {
      return true;
    }
  }
  return false;
}

export function migrateWorkspacePure(rawWorkspace = {}, { simulateMidErrorFn = null } = {}) {
  const safeInput = deepCloneSafe(rawWorkspace || {});
  const sourceItems = Array.isArray(safeInput.items) ? safeInput.items : [];

  const nextItems = [];
  for (let i = 0; i < sourceItems.length; i += 1) {
    nextItems.push(migrateWorkItem(sourceItems[i]));
    if (typeof simulateMidErrorFn === 'function') {
      simulateMidErrorFn({ index: i, processedCount: nextItems.length, partialItems: nextItems });
    }
  }

  const nextProfile = safeInput.profile ? migrateProfileData(safeInput.profile) : null;

  return {
    ...safeInput,
    items: nextItems,
    ...(nextProfile ? { profile: nextProfile } : {}),
    migrationVersion: CURRENT_MIGRATION_VERSION,
  };
}

/**
 * Orquestra migração segura conforme regras extras 1 e 2:
 * - Grava snapshot pré-migração
 * - Lê o snapshot de volta e valida checksum/contagem
 * - Aborta se o snapshot falhar, preservando dados antigos
 * - Executa migração tudo-ou-nada (rollback em qualquer erro)
 */
export async function executeAtomicWorkspaceMigration({
  rawWorkspace = {},
  storedMigrationVersion = 0,
  saveSnapshotFn,
  verifySnapshotFn,
  commitFn,
  simulateMidErrorFn = null,
} = {}) {
  const immutableOriginal = deepCloneSafe(rawWorkspace || {});

  if (!needsWorkspaceMigration(immutableOriginal, storedMigrationVersion)) {
    return {
      status: 'up-to-date',
      migrated: false,
      aborted: false,
      workspace: immutableOriginal,
    };
  }

  if (typeof saveSnapshotFn !== 'function' || typeof verifySnapshotFn !== 'function') {
    return {
      status: 'snapshot-failed',
      migrated: false,
      aborted: true,
      workspace: immutableOriginal,
      warning:
        'Não foi possível iniciar a cópia de segurança prévia. Seus dados originais permanecem intactos.',
    };
  }

  let savedSnap;
  try {
    savedSnap = await saveSnapshotFn(immutableOriginal, {
      reason: 'pre-migration',
      label: 'Snapshot pré-migração v1.1.0',
      force: true,
    });
  } catch (err) {
    return {
      status: 'snapshot-failed',
      migrated: false,
      aborted: true,
      workspace: immutableOriginal,
      error: err?.message || 'Erro ao gravar snapshot pré-migração.',
      warning:
        'Falha ao gravar o snapshot automático antes da migração. Seus dados antigos foram mantidos intactos; exporte um backup JSON por precaução.',
    };
  }

  const snapshotId = savedSnap?.snapshot?.id;
  if (!snapshotId) {
    return {
      status: 'snapshot-failed',
      migrated: false,
      aborted: true,
      workspace: immutableOriginal,
      warning:
        'Snapshot pré-migração não confirmou identificador válido. Migração cancelada; dados antigos mantidos intactos.',
    };
  }

  let verified;
  try {
    verified = await verifySnapshotFn(snapshotId, immutableOriginal);
  } catch (err) {
    verified = { ok: false, reason: err?.message || 'Erro ao reler snapshot.' };
  }

  if (!verified?.ok) {
    return {
      status: 'snapshot-failed',
      migrated: false,
      aborted: true,
      workspace: immutableOriginal,
      error: verified?.reason || 'Snapshot inválido ou ilegível após gravação.',
      warning:
        'Não foi possível reler e confirmar a integridade do snapshot de segurança. Seus dados antigos permanecem intactos.',
    };
  }

  try {
    const migrated = migrateWorkspacePure(immutableOriginal, { simulateMidErrorFn });
    const origLen = Array.isArray(immutableOriginal.items) ? immutableOriginal.items.length : 0;
    if (!Array.isArray(migrated.items) || migrated.items.length !== origLen) {
      throw new Error('Contagem de obras divergente após migração.');
    }

    if (typeof commitFn === 'function') {
      await commitFn(migrated);
    }

    return {
      status: 'migrated',
      migrated: true,
      aborted: false,
      snapshotId,
      workspace: migrated,
    };
  } catch (err) {
    return {
      status: 'migration-failed',
      migrated: false,
      aborted: true,
      snapshotId,
      workspace: immutableOriginal,
      error: err?.message || 'Erro durante migração atômica.',
      warning:
        'A atualização dos dados foi interrompida por segurança. Todos os seus dados originais continuam preservados.',
    };
  }
}
