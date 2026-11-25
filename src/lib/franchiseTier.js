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

import {
  inferDomainFromWork,
  normalizeDomainId,
  normalizeGameEditionType,
} from '../config/domainConfig.js';
import { isBookEdition } from './bookEditions.js';
import { computeEntityCompleteness } from './entityHelpers.js';

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
export function computeFranchiseScopeProgress(
  entries = [],
  domain = 'cinema',
  {
    mainSeriesTotal = null,
    universeTotal = null,
    hasKnownTotal = true,
    totalSource = null,
  } = {}
) {
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

  const parsedMain = Number(mainSeriesTotal);
  const overrideMainTotal =
    Number.isFinite(parsedMain) && parsedMain > 0 ? Math.round(parsedMain) : null;
  const parsedUni = Number(universeTotal);
  const overrideUniTotal =
    Number.isFinite(parsedUni) && parsedUni > 0 ? Math.round(parsedUni) : null;

  const knownMainTotal =
    overrideMainTotal ?? (hasKnownTotal ? grouped.mainline.length : null);
  const knownUniverseTotal =
    overrideUniTotal ?? (hasKnownTotal ? safeEntries.length : null);

  const entityComp = computeEntityCompleteness({
    works: grouped.mainline,
    mainSeriesTotal: knownMainTotal,
    universeWorks: safeEntries,
    universeTotal: knownUniverseTotal,
    totalSource: overrideMainTotal || overrideUniTotal ? 'Definido por você' : totalSource,
  });

  const mainlineTotal = overrideMainTotal ?? grouped.mainline.length;
  const mainlineCompleted = entityComp.mainline.completed;
  const mainlinePct =
    entityComp.mainline.pct !== null
      ? entityComp.mainline.pct
      : hasKnownTotal && mainlineTotal > 0
        ? Math.round((mainlineCompleted / mainlineTotal) * 100)
        : 0;

  const universeTotalCount = overrideUniTotal ?? safeEntries.length;
  const universeCompleted = entityComp.universe.completed;
  const universePct =
    entityComp.universe.pct !== null
      ? entityComp.universe.pct
      : hasKnownTotal && universeTotalCount > 0
        ? Math.round((universeCompleted / universeTotalCount) * 100)
        : 0;

  const mainlineNoun = getDomainUnitNoun(domain, mainlineTotal);

  return {
    domain: normalizeDomainId(domain),
    hasKnownTotal: !entityComp.mainline.isOpenEnded || !entityComp.universe.isOpenEnded,
    entityCompleteness: entityComp,
    mainline: {
      completed: mainlineCompleted,
      total: entityComp.mainline.isOpenEnded ? null : mainlineTotal,
      localCount: grouped.mainline.length,
      pct: entityComp.mainline.isOpenEnded ? null : mainlinePct,
      isOpenEnded: entityComp.mainline.isOpenEnded,
      label: `${mainlineCompleted}/${mainlineTotal} ${mainlineNoun}`,
      displayLabel: entityComp.mainline.displayLabel,
    },
    universe: {
      completed: universeCompleted,
      total: entityComp.universe.isOpenEnded ? null : universeTotalCount,
      localCount: safeEntries.length,
      pct: entityComp.universe.isOpenEnded ? null : universePct,
      isOpenEnded: entityComp.universe.isOpenEnded,
      label: `${universeCompleted}/${universeTotalCount}`,
      displayLabel: entityComp.universe.displayLabel,
    },
    unclassified: {
      completed: grouped.unclassified.filter((e) => e.completed).length,
      total: grouped.unclassified.length,
    },
    counts: {
      mainline: grouped.mainline.length,
      spinoff: grouped.spinoff.length,
      companion: grouped.companion.length,
      unclassified: grouped.unclassified.length,
      all: safeEntries.length,
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
export function buildDomainFranchiseModel(
  item = {},
  allItems = [],
  {
    remoteEntries = [],
    manualMeta = null,
    sourceLabel = null,
    sourceIsComplete = false,
  } = {}
) {
  if (!item || typeof item !== 'object') return null;
  const domain = inferDomainFromWork(item);
  const franchiseName = String(item.franchiseName || manualMeta?.seriesName || '').trim();
  const normKey = normalizeFranchiseKey(franchiseName);
  const manualLinks = Array.isArray(item.franchiseLinks) ? item.franchiseLinks : [];
  const safeRemote = Array.isArray(remoteEntries) ? remoteEntries.filter(Boolean) : [];

  if (!normKey && manualLinks.length === 0 && safeRemote.length === 0) return null;

  const catalogWorks = (Array.isArray(allItems) ? allItems : []).filter(
    (w) => w && w.inBacklog !== false && inferDomainFromWork(w) === domain && !isBookEdition(w)
  );

  const byId = new Map();
  const byTitleKey = new Map();
  const entries = [];

  for (const w of catalogWorks) {
    const wKey = normalizeFranchiseKey(w.franchiseName);
    const sameFranchise = normKey && wKey && wKey === normKey;
    const isCurrent = String(w.id) === String(item.id);
    if (!sameFranchise && !isCurrent) continue;
    byId.set(String(w.id), w);
    const tKey = normalizeFranchiseKey(w.title);
    if (tKey) byTitleKey.set(tKey, w);
    entries.push({
      id: String(w.id),
      title: w.title,
      workType: w.workType,
      editionType: domain === 'games' ? normalizeGameEditionType(w.editionType) : w.editionType || '',
      releaseYear: Number(w.releaseYear) || null,
      chronologicalOrder: Number(w.chronologicalOrder) || null,
      coverUrl: w.manualCoverDataUrl || w.coverUrl || null,
      status: w.status,
      isCataloged: true,
      isCompleted: w.status === 'completed',
      localState:
        w.status === 'completed'
          ? 'completed'
          : w.status === 'queued'
            ? 'queued'
            : 'in-progress',
      franchiseTier: inferFranchiseTier(w),
      work: w,
      item: w,
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
    const linkTitleKey = normalizeFranchiseKey(linkedLocal?.title || link.title);
    if (linkTitleKey && !linkedLocal && byTitleKey.has(linkTitleKey)) continue;
    if (linkTitleKey) byTitleKey.set(linkTitleKey, linkedLocal || link);

    entries.push({
      id: linkedLocal ? String(linkedLocal.id) : `link:${link.title}`,
      title: linkedLocal?.title || link.title,
      workType: linkedLocal?.workType || link.workType || item.workType,
      releaseYear: Number(linkedLocal?.releaseYear) || null,
      chronologicalOrder: Number(linkedLocal?.chronologicalOrder) || null,
      coverUrl: linkedLocal?.coverUrl || null,
      status: linkedLocal?.status || null,
      isCataloged: Boolean(linkedLocal),
      isCompleted: Boolean(linkedLocal && linkedLocal.status === 'completed'),
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
      item: linkedLocal,
      isCurrent: false,
    });
  }

  // Incorpora entradas reais vindas da fonte externa (ex.: IGDB / RAWG / Open Library)
  for (const rem of safeRemote) {
    const remTitle = String(rem.title || '').trim();
    const remTitleKey = normalizeFranchiseKey(remTitle);
    if (!remTitleKey) continue;
    const remIgdb = Number(rem.igdbId || rem.ids?.igdb) || null;
    const matchedCatalog = catalogWorks.find((w) => {
      if (remIgdb && Number(w.igdbId || w.ids?.igdb) === remIgdb) return true;
      return normalizeFranchiseKey(w.title) === remTitleKey;
    });
    if (matchedCatalog && byId.has(String(matchedCatalog.id))) continue;
    if (byTitleKey.has(remTitleKey)) continue;
    byTitleKey.set(remTitleKey, matchedCatalog || rem);
    if (matchedCatalog) byId.set(String(matchedCatalog.id), matchedCatalog);

    const effectiveEdition =
      domain === 'games'
        ? normalizeGameEditionType(matchedCatalog?.editionType || rem.editionType)
        : matchedCatalog?.editionType || rem.editionType || '';
    const inferredRemoteTier =
      matchedCatalog
        ? inferFranchiseTier(matchedCatalog)
        : rem.franchiseTier
          ? normalizeFranchiseTier(rem.franchiseTier) || 'mainline'
          : domain === 'games' && effectiveEdition !== 'Jogo'
            ? effectiveEdition === 'Coletânea'
              ? 'companion'
              : 'spinoff'
            : inferFranchiseTier(rem);

    entries.push({
      id: matchedCatalog ? String(matchedCatalog.id) : String(rem.id || `remote:${remTitleKey}`),
      igdbId: remIgdb,
      rawgId: Number(rem.rawgId || rem.ids?.rawg) || null,
      ids: matchedCatalog?.ids || rem.ids || (remIgdb ? { igdb: remIgdb } : {}),
      title: matchedCatalog?.title || remTitle,
      creator: matchedCatalog?.creator || rem.creator || '',
      domain,
      workType: matchedCatalog?.workType || rem.workType || item.workType,
      editionType: effectiveEdition,
      entryKind:
        domain === 'games'
          ? effectiveEdition || 'Jogo'
          : rem.entryKind || 'Capítulo da Saga',
      platforms: matchedCatalog?.platforms || rem.platforms || [],
      releaseYear: Number(matchedCatalog?.releaseYear || rem.releaseYear) || null,
      chronologicalOrder: Number(matchedCatalog?.chronologicalOrder || rem.chronologicalOrder) || null,
      coverUrl: matchedCatalog?.manualCoverDataUrl || matchedCatalog?.coverUrl || rem.coverUrl || null,
      status: matchedCatalog?.status || null,
      isCataloged: Boolean(matchedCatalog),
      isCompleted: Boolean(matchedCatalog && matchedCatalog.status === 'completed'),
      localState: matchedCatalog
        ? matchedCatalog.status === 'completed'
          ? 'completed'
          : matchedCatalog.status === 'queued'
            ? 'queued'
            : 'in-progress'
        : 'missing',
      catalogStateLabel: matchedCatalog
        ? matchedCatalog.status === 'completed'
          ? 'Concluído'
          : 'No catálogo'
        : 'Faltante',
      franchiseName: franchiseName || rem.franchiseName || '',
      franchiseTier: inferredRemoteTier,
      work: matchedCatalog || null,
      item: matchedCatalog || null,
      isCurrent: Boolean(matchedCatalog && String(matchedCatalog.id) === String(item.id)),
    });
  }

  if (entries.length < 2 && manualLinks.length === 0 && safeRemote.length === 0 && !manualMeta?.mainSeriesTotal) {
    return null;
  }

  entries.sort((a, b) => {
    const orderA = a.chronologicalOrder ?? 9999;
    const orderB = b.chronologicalOrder ?? 9999;
    if (orderA !== orderB) return orderA - orderB;
    const yearA = a.releaseYear ?? 9999;
    const yearB = b.releaseYear ?? 9999;
    if (yearA !== yearB) return yearA - yearB;
    return String(a.title || '').localeCompare(String(b.title || ''), 'pt-BR');
  });

  const hasExternalTotal = Boolean(sourceIsComplete && safeRemote.length > 0);
  const hasManualTotal = Boolean(
    Number(manualMeta?.mainSeriesTotal) > 0 || Number(manualMeta?.universeTotal) > 0
  );
  // Retrocompatibilidade: se chamador não forneceu opções (testes legados v2.4/v2.5), preserva total local calculado;
  // quando explicitamente informado `sourceIsComplete: false` e sem manualMeta, fica total aberto!
  const explicitOpenEndedMode =
    !hasExternalTotal && !hasManualTotal && arguments.length >= 3 && sourceIsComplete === false;

  const scopeProgress = computeFranchiseScopeProgress(entries, domain, {
    mainSeriesTotal: manualMeta?.mainSeriesTotal ?? null,
    universeTotal: manualMeta?.universeTotal ?? null,
    hasKnownTotal: !explicitOpenEndedMode,
    totalSource: hasManualTotal ? 'Definido por você' : sourceLabel,
  });

  const progressHeader = scopeProgress.mainline.isOpenEnded
    ? scopeProgress.mainline.displayLabel
    : `${scopeProgress.mainline.displayLabel}${
        !scopeProgress.universe.isOpenEnded ? ` · ${scopeProgress.universe.displayLabel}` : ''
      }`;

  return {
    mode: 'domain-franchise',
    domain,
    sectionTitle: domain === 'reading' ? 'Série & Universo' : 'Franquia & Universo',
    sagaName: franchiseName || item.title,
    entries,
    scopeProgress,
    sourceLabel: hasManualTotal ? 'Definido por você' : sourceLabel || null,
    hasKnownTotal: scopeProgress.hasKnownTotal,
    progressHeader,
  };
}
