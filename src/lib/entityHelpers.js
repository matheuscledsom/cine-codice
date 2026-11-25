/**
 * Extração e busca local de Entidades (Autor, Diretor, Elenco/Ator, Estúdio, Banda/Artista)
 * para a Página/Folha de Entidade (v2.4.0 Fase 4.4).
 */

import { inferDomainFromWork, normalizeDomainId } from '../config/domainConfig.js';
import { resolveWorkRatingState, score100ToStars } from './ratingModel.js';

export const ENTITY_ROLE_LABELS = Object.freeze({
  author: 'Autor(a)',
  director: 'Direção',
  actor: 'Elenco',
  studio: 'Estúdio',
  artist: 'Banda / Artista',
});

function normalizeName(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

export function splitEntityNames(rawValue, max = 8) {
  const clean = String(rawValue || '').trim();
  if (!clean) return [];
  const parts = clean.includes(';') ? clean.split(';') : clean.split(',');
  const seen = new Set();
  const out = [];
  for (const part of parts) {
    const trimmed = part.trim();
    const norm = normalizeName(trimmed);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(trimmed);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Extrai entidades clicáveis de uma obra de acordo com o seu domínio.
 */
export function extractWorkEntities(work = {}) {
  if (!work || typeof work !== 'object') return [];
  const domain = inferDomainFromWork(work);
  const entities = [];
  const seenKey = new Set();

  const pushNames = (raw, role) => {
    for (const name of splitEntityNames(raw, role === 'actor' ? 8 : 4)) {
      const k = `${role}:${normalizeName(name)}`;
      if (seenKey.has(k)) continue;
      seenKey.add(k);
      entities.push({
        name,
        role,
        roleLabel: ENTITY_ROLE_LABELS[role] || role,
        domain,
      });
    }
  };

  if (domain === 'reading') {
    pushNames(work.creator || work.author || work.director, 'author');
    if (work.studio) pushNames(work.studio, 'studio');
  } else if (domain === 'games') {
    pushNames(work.studio || work.creator || work.director, 'studio');
  } else if (domain === 'music') {
    pushNames(work.creator || work.artist || work.director, 'artist');
  } else {
    // Cinema / Séries / Animes
    pushNames(work.director || work.creator, 'director');
    if (work.studio) pushNames(work.studio, 'studio');
    if (work.cast) pushNames(work.cast, 'actor');
  }

  return entities;
}

/**
 * Localiza obras já catalogadas no acervo ligadas à entidade selecionada.
 */
export function findCatalogWorksForEntity(
  items = [],
  { name = '', role = '', domain = 'all' } = {}
) {
  const targetNorm = normalizeName(name);
  if (!targetNorm) {
    return {
      works: [],
      stats: { total: 0, completed: 0, averageStars: null },
    };
  }

  const filterDomain = domain && domain !== 'all' ? normalizeDomainId(domain) : null;
  const matched = [];

  for (const work of Array.isArray(items) ? items : []) {
    if (!work || work.inBacklog === false) continue;
    const wDomain = inferDomainFromWork(work);
    if (filterDomain && wDomain !== filterDomain) continue;

    const fieldsToCheck =
      role === 'actor'
        ? [work.cast]
        : role === 'studio'
          ? [work.studio, work.creator, work.director]
          : [work.creator, work.director, work.author, work.artist, work.studio, work.cast];

    const namesInWork = fieldsToCheck.flatMap((f) => splitEntityNames(f, 20));
    const isHit = namesInWork.some((candidate) => {
      const normCand = normalizeName(candidate);
      return normCand === targetNorm || normCand.includes(targetNorm) || targetNorm.includes(normCand);
    });

    if (isHit) {
      matched.push(work);
    }
  }

  matched.sort((a, b) => (Number(b.releaseYear) || 0) - (Number(a.releaseYear) || 0));

  const ratedScores = matched
    .map((w) => resolveWorkRatingState(w))
    .filter((st) => st.hasConfirmedRating && st.score100 !== null)
    .map((st) => st.score100);

  const avgScore100 =
    ratedScores.length > 0
      ? Math.round(ratedScores.reduce((acc, s) => acc + s, 0) / ratedScores.length)
      : null;

  return {
    works: matched,
    stats: {
      total: matched.length,
      completed: matched.filter((w) => w.status === 'completed').length,
      averageStars: avgScore100 !== null ? score100ToStars(avgScore100) : null,
    },
  };
}

export const MANUAL_ENTITY_META_STORAGE_KEY = 'omniprism_manual_entity_meta_v1';

function buildEntityMetaKey({ name = '', domain = 'reading', role = 'creator' } = {}) {
  const normName = normalizeName(name);
  if (!normName) return '';
  return `${String(domain || 'reading').trim().toLowerCase()}::${String(role || 'creator').trim().toLowerCase()}::${normName}`;
}

function readAllManualEntityMeta(storage = globalThis?.localStorage) {
  if (!storage || typeof storage.getItem !== 'function') return {};
  try {
    const raw = storage.getItem(MANUAL_ENTITY_META_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function getManualEntityMeta(entity = {}, { storage = globalThis?.localStorage } = {}) {
  const key = buildEntityMetaKey(entity);
  if (!key) return null;
  const all = readAllManualEntityMeta(storage);
  const entry = all[key];
  return entry && typeof entry === 'object' ? entry : null;
}

export function saveManualEntityMeta(
  entity = {},
  patch = {},
  { storage = globalThis?.localStorage } = {},
) {
  const key = buildEntityMetaKey(entity);
  if (!key) return null;
  const all = readAllManualEntityMeta(storage);
  const prev = all[key] && typeof all[key] === 'object' ? all[key] : {};
  const parsedTotal = Number(patch.mainSeriesTotal);
  const cleanTotal =
    Number.isFinite(parsedTotal) && parsedTotal > 0 ? Math.min(999, Math.round(parsedTotal)) : null;
  const next = {
    name: String(entity?.name || prev.name || '').trim(),
    domain: String(entity?.domain || prev.domain || 'reading').trim(),
    role: String(entity?.role || prev.role || 'creator').trim(),
    seriesName:
      patch.seriesName !== undefined
        ? String(patch.seriesName || '').trim()
        : String(prev.seriesName || '').trim(),
    mainSeriesTotal: patch.mainSeriesTotal === null ? null : cleanTotal ?? prev.mainSeriesTotal ?? null,
    updatedAt: new Date().toISOString(),
  };
  all[key] = next;
  if (storage && typeof storage.setItem === 'function') {
    try {
      storage.setItem(MANUAL_ENTITY_META_STORAGE_KEY, JSON.stringify(all));
    } catch {
      // Ignore storage quota errors cleanly
    }
  }
  return next;
}

export function computeEntityCompleteness({ works = [], mainSeriesTotal = null } = {}) {
  const list = Array.isArray(works) ? works : [];
  const completed = list.filter((w) => w?.status === 'completed').length;
  const inCatalog = list.length;
  const parsed = Number(mainSeriesTotal);
  const validTotal = Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
  const pct = validTotal !== null ? Math.min(100, Math.round((completed / validTotal) * 100)) : null;
  return {
    completed,
    inCatalog,
    mainSeriesTotal: validTotal,
    pct,
    isOpenEnded: validTotal === null,
  };
}
