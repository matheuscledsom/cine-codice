/**
 * Classificação de escopo de Franquias / Séries / Universos (v2.4.0 Fase 4.2).
 *
 * Tiers oficiais (`progress_data.franchiseTier`):
 * - `mainline`: Cronologia / História Principal
 * - `spinoff`: Spin-off / Universo Expandido
 * - `companion`: Guias, Entrevistas, Especiais / OVAs
 *
 * Calcula sempre dois indicadores transparentes sem misturar extras na linha principal:
 * 1) Progresso da Linha Principal (ex.: 3/5 livros)
 * 2) Progresso do Universo Completo (ex.: 4/9)
 */

import { inferDomainFromWork, normalizeDomainId } from '../config/domainConfig.js';
import { isBookEdition } from './bookEditions.js';

export const UNCLASSIFIED_FRANCHISE_TIER = 'unclassified';

export const UNCLASSIFIED_TIER_META = Object.freeze({
  id: 'unclassified',
  label: 'Não classificado (aguarda confirmação)',
  shortLabel: 'Não classificado',
});

export const FRANCHISE_TIER_OPTIONS = Object.freeze([
  Object.freeze({
    id: 'mainline',
    label: 'Cronologia / História Principal',
    shortLabel: 'Linha Principal',
  }),
  Object.freeze({
    id: 'spinoff',
    label: 'Spin-off / Universo Expandido',
    shortLabel: 'Spin-off',
  }),
  Object.freeze({
    id: 'companion',
    label: 'Guias, Entrevistas, Especiais / OVAs',
    shortLabel: 'Guias & Extras',
  }),
]);

export const ALL_FRANCHISE_TIER_OPTIONS = Object.freeze([
  ...FRANCHISE_TIER_OPTIONS,
  UNCLASSIFIED_TIER_META,
]);

// Nunca usar 'edition' em franchiseTier: edições de livros usam a relação separada `editionOf`.
const CONFIRMED_TIERS = new Set(['mainline', 'spinoff', 'companion']);
const VALID_TIERS = new Set(['mainline', 'spinoff', 'companion', 'unclassified']);

const COMPANION_RELATION_TYPES = new Set([
  'SPECIAL',
  'OVA',
  'ONA',
  'SUMMARY',
  'COMPILATION',
  'CHARACTER',
  'OTHER',
]);

const SPINOFF_RELATION_TYPES = new Set([
  'SPIN_OFF',
  'SIDE_STORY',
  'ALTERNATIVE',
]);

const COMPANION_TITLE_REGEX =
  /\b(guia|guide|entrevista|interview|artbook|making\s+of|behind\s+the\s+scenes|special|especial|ova|compendium|almanac|almanaque|encyclopedia|enciclop[eé]dia|companion|databook|fanbook|document[aá]rio)\b/i;

const SPINOFF_TITLE_REGEX =
  /\b(spin[- ]?off|gaiden|side\s+story|dlc|expans[aã]o|expansion|remake|modpack|tales\s+from|chronicles\s+of)\b/i;

export function normalizeFranchiseTier(raw) {
  const clean = String(raw || '').trim().toLowerCase();
  if (clean === 'edition') return '';
  return VALID_TIERS.has(clean) ? clean : '';
}

export function inferFranchiseTier(entry = {}) {
  if (!entry || typeof entry !== 'object') return 'mainline';
  const explicit = normalizeFranchiseTier(
    entry.franchiseTier ??
      entry.progress_data?.franchiseTier ??
      entry.work?.franchiseTier ??
      entry.work?.progress_data?.franchiseTier
  );
  if (explicit && CONFIRMED_TIERS.has(explicit)) return explicit;

  // Sugestões de universo (TMDB keyword/discover) NUNCA são classificadas automaticamente
  // como mainline ou spinoff: o padrão é 'unclassified' até confirmação explícita do usuário.
  if (
    explicit === UNCLASSIFIED_FRANCHISE_TIER ||
    entry.isUniverseSuggestion === true ||
    entry.sourceKind === 'tmdb_keyword_discover'
  ) {
    return UNCLASSIFIED_FRANCHISE_TIER;
  }

  const relType = String(entry.relationType || entry.work?.relationType || '')
    .trim()
    .toUpperCase();
  if (COMPANION_RELATION_TYPES.has(relType)) return 'companion';
  if (SPINOFF_RELATION_TYPES.has(relType)) return 'spinoff';

  const workType = String(entry.workType || entry.work?.workType || '').toLowerCase();
  const animeFormat = String(entry.animeFormat || entry.work?.animeFormat || '').toUpperCase();
  if (animeFormat === 'OVA' || animeFormat === 'SPECIAL' || animeFormat === 'ONA') {
    return 'companion';
  }
  if (workType === 'dlc' || workType === 'modpack') {
    return 'spinoff';
  }

  const title = String(entry.title || entry.work?.title || '');
  if (COMPANION_TITLE_REGEX.test(title)) return 'companion';
  if (SPINOFF_TITLE_REGEX.test(title)) return 'spinoff';

  return 'mainline';
}

export function getFranchiseTierMeta(tierId) {
  const clean = normalizeFranchiseTier(tierId) || 'mainline';
  if (clean === UNCLASSIFIED_FRANCHISE_TIER) return UNCLASSIFIED_TIER_META;
  return (
    FRANCHISE_TIER_OPTIONS.find((opt) => opt.id === clean) || FRANCHISE_TIER_OPTIONS[0]
  );
}

function getDomainUnitNoun(domain, count) {
  const clean = normalizeDomainId(domain);
  const singular = count === 1;
  if (clean === 'reading') return singular ? 'livro' : 'livros';
  if (clean === 'games') return singular ? 'jogo' : 'jogos';
  if (clean === 'music') return singular ? 'lançamento' : 'lançamentos';
  return singular ? 'obra' : 'obras';
}

function isEntryCompleted(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (entry.localState === 'completed') return true;
  if (entry.status === 'completed') return true;
  if (entry.work?.status === 'completed') return true;
  return false;
}

/**
 * Calcula progresso separado e transparente:
 * - Linha Principal (somente `mainline`)
 * - Universo Completo (`mainline` + `spinoff` + `companion`)
 */
export function computeFranchiseScopeProgress(entries = [], domain = 'cinema') {
  // Edições (`editionOf`) nunca alteram o progresso da obra base nem inflam a série.
  const safeEntries = (Array.isArray(entries) ? entries : []).filter(
    (entry) => entry && !isBookEdition(entry.work || entry)
  );
  const grouped = {
    mainline: [],
    spinoff: [],
    companion: [],
    unclassified: [],
  };

  for (const entry of safeEntries) {
    const tier = inferFranchiseTier(entry);
    const bucket = grouped[tier] ? tier : 'mainline';
    grouped[bucket].push({
      ...entry,
      franchiseTier: bucket,
      completed: isEntryCompleted(entry),
    });
  }

  const mainlineTotal = grouped.mainline.length;
  const mainlineCompleted = grouped.mainline.filter((e) => e.completed).length;
  const mainlinePct =
    mainlineTotal > 0 ? Math.round((mainlineCompleted / mainlineTotal) * 100) : 0;

  const universeTotal = safeEntries.length;
  const universeCompleted =
    mainlineCompleted +
    grouped.spinoff.filter((e) => e.completed).length +
    grouped.companion.filter((e) => e.completed).length +
    grouped.unclassified.filter((e) => e.completed).length;
  const universePct =
    universeTotal > 0 ? Math.round((universeCompleted / universeTotal) * 100) : 0;

  const mainlineNoun = getDomainUnitNoun(domain, mainlineTotal);

  return {
    domain: normalizeDomainId(domain),
    mainline: {
      completed: mainlineCompleted,
      total: mainlineTotal,
      pct: mainlinePct,
      label: `${mainlineCompleted}/${mainlineTotal} ${mainlineNoun}`,
    },
    universe: {
      completed: universeCompleted,
      total: universeTotal,
      pct: universePct,
      label: `${universeCompleted}/${universeTotal}`,
    },
    unclassified: {
      completed: grouped.unclassified.filter((e) => e.completed).length,
      total: grouped.unclassified.length,
    },
    counts: {
      mainline: mainlineTotal,
      spinoff: grouped.spinoff.length,
      companion: grouped.companion.length,
      unclassified: grouped.unclassified.length,
      all: universeTotal,
    },
    grouped,
  };
}

function normalizeFranchiseKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Monta modelo de franquia/série para Games e Livros a partir de `franchiseName` e `franchiseLinks`.
 */
export function buildDomainFranchiseModel(item = {}, allItems = []) {
  if (!item || typeof item !== 'object') return null;
  const domain = inferDomainFromWork(item);
  const franchiseName = String(item.franchiseName || '').trim();
  const normKey = normalizeFranchiseKey(franchiseName);
  const manualLinks = Array.isArray(item.franchiseLinks) ? item.franchiseLinks : [];

  if (!normKey && manualLinks.length === 0) return null;

  const catalogWorks = (Array.isArray(allItems) ? allItems : []).filter(
    (w) => w && w.inBacklog !== false && inferDomainFromWork(w) === domain && !isBookEdition(w)
  );

  const byId = new Map();
  const entries = [];

  for (const w of catalogWorks) {
    const wKey = normalizeFranchiseKey(w.franchiseName);
    const sameFranchise = normKey && wKey && wKey === normKey;
    const isCurrent = String(w.id) === String(item.id);
    if (!sameFranchise && !isCurrent) continue;
    byId.set(String(w.id), w);
    entries.push({
      id: String(w.id),
      title: w.title,
      workType: w.workType,
      releaseYear: Number(w.releaseYear) || null,
      chronologicalOrder: Number(w.chronologicalOrder) || null,
      coverUrl: w.coverUrl || null,
      status: w.status,
      localState:
        w.status === 'completed'
          ? 'completed'
          : w.status === 'queued'
            ? 'queued'
            : 'in-progress',
      franchiseTier: inferFranchiseTier(w),
      work: w,
      isCurrent,
    });
  }

  for (const link of manualLinks) {
    if (!link?.title && !link?.targetWorkId) continue;
    const linkedLocal = link.targetWorkId
      ? catalogWorks.find((w) => String(w.id) === String(link.targetWorkId)) || null
      : null;
    if (linkedLocal && byId.has(String(linkedLocal.id))) continue;
    if (linkedLocal) byId.set(String(linkedLocal.id), linkedLocal);

    entries.push({
      id: linkedLocal ? String(linkedLocal.id) : `link:${link.title}`,
      title: linkedLocal?.title || link.title,
      workType: linkedLocal?.workType || link.workType || item.workType,
      releaseYear: Number(linkedLocal?.releaseYear) || null,
      chronologicalOrder: Number(linkedLocal?.chronologicalOrder) || null,
      coverUrl: linkedLocal?.coverUrl || null,
      status: linkedLocal?.status || null,
      localState: linkedLocal
        ? linkedLocal.status === 'completed'
          ? 'completed'
          : linkedLocal.status === 'queued'
            ? 'queued'
            : 'in-progress'
        : 'missing',
      relationType: link.relationType || 'SEQUEL',
      franchiseTier: inferFranchiseTier(linkedLocal || link),
      work: linkedLocal,
      isCurrent: false,
    });
  }

  if (entries.length < 2 && manualLinks.length === 0) return null;

  entries.sort((a, b) => {
    const orderA = a.chronologicalOrder ?? 9999;
    const orderB = b.chronologicalOrder ?? 9999;
    if (orderA !== orderB) return orderA - orderB;
    const yearA = a.releaseYear ?? 9999;
    const yearB = b.releaseYear ?? 9999;
    if (yearA !== yearB) return yearA - yearB;
    return String(a.title || '').localeCompare(String(b.title || ''), 'pt-BR');
  });

  const scopeProgress = computeFranchiseScopeProgress(entries, domain);

  return {
    mode: 'domain-franchise',
    domain,
    sectionTitle: domain === 'reading' ? 'Série & Universo' : 'Franquia & Universo',
    sagaName: franchiseName || item.title,
    entries,
    scopeProgress,
    progressHeader: `Linha Principal: ${scopeProgress.mainline.label} · Universo: ${scopeProgress.universe.label}`,
  };
}
