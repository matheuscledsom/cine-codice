/**
 * Extração e busca local de Entidades (Autor, Diretor, Elenco/Ator, Estúdio, Banda/Artista)
 * para a Página/Folha de Entidade (v2.4.0 Fase 4.4).
 */

import {
  inferDomainFromWork,
  normalizeDomainId,
  normalizeGameEditionType,
} from '../config/domainConfig.js';
import { getEditionBaseWorkId, isBookEdition } from './bookEditions.js';
import { resolveWorkRatingState, score100ToStars } from './ratingModel.js';

export const ENTITY_ROLE_LABELS = Object.freeze({
  author: 'Autor(a)',
  director: 'Direção',
  actor: 'Elenco',
  studio: 'Estúdio',
  artist: 'Banda / Artista',
  franchise: 'Franquia / Universo',
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
  const parsedUniverse = Number(patch.universeTotal);
  const cleanUniverse =
    Number.isFinite(parsedUniverse) && parsedUniverse > 0
      ? Math.min(9999, Math.round(parsedUniverse))
      : null;
  const next = {
    name: String(entity?.name || prev.name || '').trim(),
    domain: String(entity?.domain || prev.domain || 'reading').trim(),
    role: String(entity?.role || prev.role || 'creator').trim(),
    seriesName:
      patch.seriesName !== undefined
        ? String(patch.seriesName || '').trim()
        : String(prev.seriesName || '').trim(),
    mainSeriesTotal:
      patch.mainSeriesTotal === null
        ? null
        : patch.mainSeriesTotal !== undefined
          ? cleanTotal
          : prev.mainSeriesTotal ?? null,
    universeTotal:
      patch.universeTotal === null
        ? null
        : patch.universeTotal !== undefined
          ? cleanUniverse
          : prev.universeTotal ?? null,
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

function isWorkCompletedForCompleteness(work) {
  if (!work || typeof work !== 'object') return false;
  return (
    work.status === 'completed' ||
    work.localState === 'completed' ||
    work.completed === true ||
    work.work?.status === 'completed'
  );
}

export function formatCompletenessMetricLabel({
  prefix = 'Linha Principal',
  completed = 0,
  total = null,
  pct = null,
} = {}) {
  const safeCompleted = Math.max(0, Math.round(Number(completed) || 0));
  const parsedTotal = Number(total);
  if (Number.isFinite(parsedTotal) && parsedTotal > 0) {
    const cleanTotal = Math.round(parsedTotal);
    const cleanPct =
      typeof pct === 'number' && Number.isFinite(pct)
        ? Math.min(100, Math.max(0, Math.round(pct)))
        : Math.min(100, Math.round((safeCompleted / cleanTotal) * 100));
    return `${prefix} ${safeCompleted} / ${cleanTotal} · ${cleanPct}%`;
  }
  return `${safeCompleted} concluídos · total aberto`;
}

/**
 * Núcleo único de cálculo de completude (reutilizado em EntitySheetModal,
 * FranchiseRadarPanel, MusicDiscographyView, musicDepth e franchiseTier).
 *
 * Nunca inventa porcentagem quando o total não é conhecido (da fonte ou definido pelo usuário).
 */
export function computeEntityCompleteness({
  works = [],
  mainSeriesTotal = null,
  universeWorks = null,
  universeTotal = null,
  totalSource = null,
} = {}) {
  const mainList = (Array.isArray(works) ? works : []).filter(
    (w) => w && !isBookEdition(w.work || w)
  );
  const completed = mainList.filter((w) => isWorkCompletedForCompleteness(w)).length;
  const inCatalog = mainList.length;
  const parsedMain = Number(mainSeriesTotal);
  const validMainTotal = Number.isFinite(parsedMain) && parsedMain > 0 ? Math.round(parsedMain) : null;
  const pct =
    validMainTotal !== null ? Math.min(100, Math.round((completed / validMainTotal) * 100)) : null;

  const uniList = Array.isArray(universeWorks)
    ? universeWorks.filter((w) => w && !isBookEdition(w.work || w))
    : mainList;
  const universeCompleted = uniList.filter((w) => isWorkCompletedForCompleteness(w)).length;
  const universeInCatalog = uniList.length;
  const parsedUniverse = Number(universeTotal);
  const validUniverseTotal =
    Number.isFinite(parsedUniverse) && parsedUniverse > 0 ? Math.round(parsedUniverse) : null;
  const universePct =
    validUniverseTotal !== null
      ? Math.min(100, Math.round((universeCompleted / validUniverseTotal) * 100))
      : null;

  const mainline = {
    completed,
    inCatalog,
    total: validMainTotal,
    pct,
    isOpenEnded: validMainTotal === null,
    displayLabel: formatCompletenessMetricLabel({
      prefix: 'Linha Principal',
      completed,
      total: validMainTotal,
      pct,
    }),
  };

  const universe = {
    completed: universeCompleted,
    inCatalog: universeInCatalog,
    total: validUniverseTotal,
    pct: universePct,
    isOpenEnded: validUniverseTotal === null,
    displayLabel: formatCompletenessMetricLabel({
      prefix: 'Universo Completo',
      completed: universeCompleted,
      total: validUniverseTotal,
      pct: universePct,
    }),
  };

  return {
    completed,
    inCatalog,
    mainSeriesTotal: validMainTotal,
    pct,
    isOpenEnded: validMainTotal === null,
    totalSource: validMainTotal !== null || validUniverseTotal !== null ? totalSource || 'manual' : null,
    mainline,
    universe,
  };
}

function normalizeWorkMatchTitle(raw = '') {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function collectComparableExternalKeys(entry = {}) {
  const keys = [];
  const ids = entry?.ids && typeof entry.ids === 'object' ? entry.ids : {};
  const pairs = [
    ['igdb', entry.igdbId || ids.igdb],
    ['rawg', entry.rawgId || ids.rawg],
    ['tmdb', entry.tmdbId || ids.tmdb],
    ['imdb', entry.imdbId || ids.imdb],
    ['anilist', entry.anilistId || ids.anilist],
    ['mal', entry.malId || ids.mal],
    ['musicbrainz', entry.mbid || entry.musicBrainzId || ids.musicbrainz],
    ['isbn', entry.isbnOrDoi || entry.isbn || ids.isbn],
    ['googleBooks', ids.googleBooks],
    ['ol', ids.ol],
  ];
  for (const [k, v] of pairs) {
    const clean = String(v || '').trim().toLowerCase();
    if (clean) keys.push(`${k}:${clean}`);
  }
  return keys;
}

function classifyCompletenessGroup(entry = {}, domain = 'reading') {
  const cleanDomain = normalizeDomainId(domain);
  const rawTitle = String(entry.title || '').trim();
  const explicitTier = String(
    entry.franchiseTier || entry.progress_data?.franchiseTier || ''
  ).toLowerCase();

  if (cleanDomain === 'music') {
    const explicitScope = String(entry.releaseCategory || entry.musicGroup || '').toLowerCase();
    if (explicitScope === 'live') return { id: 'live', label: 'Ao Vivo', isMainline: false, order: 2 };
    if (explicitScope === 'ep_single') {
      return { id: 'ep_single', label: 'EPs & Singles', isMainline: false, order: 3 };
    }
    if (explicitScope === 'compilation') {
      return { id: 'compilation', label: 'Coletâneas & Extras', isMainline: false, order: 4 };
    }
    if (explicitScope === 'studio') {
      return { id: 'studio', label: 'Álbuns de Estúdio', isMainline: true, order: 1 };
    }

    const primary = String(entry.primaryType || entry['primary-type'] || '').toLowerCase();
    const secondaries = Array.isArray(entry.secondaryTypes || entry['secondary-types'])
      ? (entry.secondaryTypes || entry['secondary-types']).map((s) => String(s || '').toLowerCase())
      : [];
    const workType = String(entry.workType || '').toLowerCase();
    const fmt = `${entry.releaseFormat || ''} ${rawTitle}`;

    if (
      secondaries.includes('live') ||
      workType === 'live_show' ||
      workType === 'concert' ||
      /\b(live|ao\s+vivo|unplugged|ac[uú]stico|in\s+concert)\b/i.test(fmt)
    ) {
      return { id: 'live', label: 'Ao Vivo', isMainline: false, order: 2 };
    }
    if (
      primary === 'ep' ||
      primary === 'single' ||
      workType === 'ep_single' ||
      workType === 'track' ||
      /\b(ep|single)\b/i.test(String(entry.releaseFormat || ''))
    ) {
      return { id: 'ep_single', label: 'EPs & Singles', isMainline: false, order: 3 };
    }
    if (
      secondaries.length > 0 ||
      /\b(colet[aâ]nea|compilation|greatest\s+hits|best\s+of|anthology|remix|soundtrack)\b/i.test(
        fmt
      )
    ) {
      return { id: 'compilation', label: 'Coletâneas & Extras', isMainline: false, order: 4 };
    }
    return { id: 'studio', label: 'Álbuns de Estúdio', isMainline: true, order: 1 };
  }

  if (cleanDomain === 'games') {
    const edition = normalizeGameEditionType(entry.editionType);
    if (explicitTier === 'companion' || edition === 'Coletânea') {
      return { id: 'collection_extras', label: 'Coletâneas & Extras', isMainline: false, order: 3 };
    }
    if (edition === 'Remake' || edition === 'Remaster' || edition === 'Port') {
      return { id: 'reissues', label: 'Remakes, Remasters & Ports', isMainline: false, order: 2 };
    }
    if (explicitTier === 'spinoff' || edition === 'DLC' || entry.workType === 'dlc') {
      return { id: 'spinoffs_dlcs', label: 'Spin-offs & DLCs', isMainline: false, order: 3 };
    }
    return { id: 'mainline', label: 'Linha Principal', isMainline: true, order: 1 };
  }

  if (cleanDomain === 'reading') {
    const saga = String(entry.franchiseName || entry.seriesName || '').trim();
    const isExtra =
      explicitTier === 'companion' ||
      /\b(guia|guide|almanaque|almanac|compendium|companion|enciclop[eé]dia)\b/i.test(rawTitle);
    if (isExtra) {
      return { id: 'extras', label: 'Guias & Extras', isMainline: false, order: 90 };
    }
    if (saga) {
      const slug = `saga:${normalizeName(saga)}`;
      const isSpinoff = explicitTier === 'spinoff';
      return {
        id: slug,
        label: saga,
        isMainline: !isSpinoff,
        order: isSpinoff ? 50 : 10,
      };
    }
    return { id: 'standalone', label: 'Obras Avulsas', isMainline: true, order: 40 };
  }

  // Cinema / Animes / Universos
  const animeFmt = String(entry.animeFormat || '').toUpperCase();
  if (
    explicitTier === 'companion' ||
    animeFmt === 'OVA' ||
    animeFmt === 'ONA' ||
    animeFmt === 'SPECIAL'
  ) {
    return { id: 'extras', label: 'Especiais, OVAs & Extras', isMainline: false, order: 3 };
  }
  if (explicitTier === 'spinoff') {
    return { id: 'spinoffs', label: 'Spin-offs & Derivados', isMainline: false, order: 2 };
  }
  return { id: 'mainline', label: 'Linha Principal', isMainline: true, order: 1 };
}

function parseSortableVolumeNumber(entry = {}) {
  const order = Number(entry.chronologicalOrder);
  if (Number.isFinite(order) && order > 0) return order;
  const volText = String(entry.seriesVolume || '').trim();
  const volMatch = volText.match(/(\d+(?:\.\d+)?)/);
  if (volMatch) return Number(volMatch[1]);
  return null;
}

/**
 * Monta o modelo completo do Painel de Completude (Autor, Banda, Franquia de Games,
 * Universo/Estúdio) reutilizando `computeEntityCompleteness` sem nenhuma lista fixa no código.
 */
export function buildEntityCompletenessPanelModel({
  entity = {},
  localWorks = [],
  externalWorks = [],
  manualMeta = null,
  sourceLabel = null,
  sourceIsComplete = false,
} = {}) {
  const domain = normalizeDomainId(entity?.domain || 'reading');
  const safeLocal = (Array.isArray(localWorks) ? localWorks : []).filter(
    (w) => w && w.inBacklog !== false
  );

  // Separa reimpressões (`editionOf`) para que fiquem agrupadas sob a obra principal
  const editionsByBaseId = new Map();
  const primaryLocal = [];
  for (const work of safeLocal) {
    const baseId = getEditionBaseWorkId(work);
    if (baseId) {
      if (!editionsByBaseId.has(baseId)) editionsByBaseId.set(baseId, []);
      editionsByBaseId.get(baseId).push(work);
    } else {
      primaryLocal.push(work);
    }
  }

  const unifiedEntries = [];
  const localIndexByExtKey = new Map();
  const localIndexByTitle = new Map();

  for (const work of primaryLocal) {
    const groupInfo = classifyCompletenessGroup(work, domain);
    const entry = {
      id: String(work.id),
      title: String(work.title || '').trim(),
      creator: String(work.creator || work.author || work.director || entity?.name || '').trim(),
      releaseYear: Number(work.releaseYear) || null,
      seriesVolume: work.seriesVolume || '',
      chronologicalOrder: Number(work.chronologicalOrder) || null,
      franchiseName: work.franchiseName || '',
      editionType: work.editionType || '',
      coverUrl: work.manualCoverDataUrl || work.coverUrl || null,
      domain,
      workType: work.workType || '',
      status: work.status || 'queued',
      statusKind: work.status === 'completed' ? 'completed' : 'in_catalog',
      inCatalog: true,
      completed: work.status === 'completed',
      work,
      editions: editionsByBaseId.get(String(work.id)) || [],
      groupId: groupInfo.id,
      groupLabel: groupInfo.label,
      groupOrder: groupInfo.order,
      isMainline: groupInfo.isMainline,
      sourceBadge: work.sourceBadge || (work.isManual ? 'Cadastro manual' : ''),
    };
    const idx = unifiedEntries.length;
    unifiedEntries.push(entry);
    for (const ek of collectComparableExternalKeys(work)) {
      localIndexByExtKey.set(ek, idx);
    }
    const normT = normalizeWorkMatchTitle(work.title);
    if (normT && !localIndexByTitle.has(normT)) {
      localIndexByTitle.set(normT, idx);
    }
    const normOrig = normalizeWorkMatchTitle(work.originalTitle);
    if (normOrig && !localIndexByTitle.has(normOrig)) {
      localIndexByTitle.set(normOrig, idx);
    }
  }

  const seenExternalTitles = new Set();
  for (const ext of Array.isArray(externalWorks) ? externalWorks : []) {
    if (!ext || !String(ext.title || '').trim()) continue;
    const extKeys = collectComparableExternalKeys(ext);
    const normT = normalizeWorkMatchTitle(ext.title);
    const normOrig = normalizeWorkMatchTitle(ext.originalTitle);

    let matchedLocalIdx = -1;
    for (const ek of extKeys) {
      if (localIndexByExtKey.has(ek)) {
        matchedLocalIdx = localIndexByExtKey.get(ek);
        break;
      }
    }
    if (matchedLocalIdx === -1 && normT && localIndexByTitle.has(normT)) {
      matchedLocalIdx = localIndexByTitle.get(normT);
    }
    if (matchedLocalIdx === -1 && normOrig && localIndexByTitle.has(normOrig)) {
      matchedLocalIdx = localIndexByTitle.get(normOrig);
    }

    if (matchedLocalIdx !== -1) {
      // Enriquece obra local já catalogada com grupo/ano da fonte se faltarem
      const existing = unifiedEntries[matchedLocalIdx];
      if (!existing.releaseYear && Number(ext.releaseYear) > 0) {
        existing.releaseYear = Number(ext.releaseYear);
      }
      if (!existing.franchiseName && ext.franchiseName) {
        existing.franchiseName = ext.franchiseName;
        const nextGrp = classifyCompletenessGroup({ ...existing.work, franchiseName: ext.franchiseName }, domain);
        existing.groupId = nextGrp.id;
        existing.groupLabel = nextGrp.label;
        existing.groupOrder = nextGrp.order;
        existing.isMainline = nextGrp.isMainline;
      }
      continue;
    }

    const dedupKey = `${normT}::${Number(ext.releaseYear) || ''}`;
    if (!normT || seenExternalTitles.has(dedupKey) || seenExternalTitles.has(normT)) continue;
    seenExternalTitles.add(dedupKey);
    seenExternalTitles.add(normT);

    const groupInfo = classifyCompletenessGroup(ext, domain);
    unifiedEntries.push({
      id: String(ext.id || `missing-${domain}-${normT}`),
      title: String(ext.title || '').trim(),
      originalTitle: String(ext.originalTitle || '').trim(),
      creator: String(ext.creator || ext.author || ext.director || entity?.name || '').trim(),
      releaseYear: Number(ext.releaseYear) || null,
      seriesVolume: ext.seriesVolume || '',
      chronologicalOrder: Number(ext.chronologicalOrder) || null,
      franchiseName: ext.franchiseName || manualMeta?.seriesName || '',
      editionType: ext.editionType || '',
      coverUrl: ext.coverUrl || null,
      domain,
      workType: ext.workType || '',
      status: null,
      statusKind: 'missing',
      inCatalog: false,
      completed: false,
      work: null,
      candidate: ext,
      editions: [],
      groupId: groupInfo.id,
      groupLabel: groupInfo.label,
      groupOrder: groupInfo.order,
      isMainline: groupInfo.isMainline,
      sourceBadge: ext.sourceBadge || sourceLabel || '',
    });
  }

  // Agrupa por Saga / Cronologia / Tipo de Lançamento e ordena cronologicamente
  const groupMap = new Map();
  for (const entry of unifiedEntries) {
    if (!groupMap.has(entry.groupId)) {
      groupMap.set(entry.groupId, {
        id: entry.groupId,
        label: entry.groupLabel,
        isMainline: entry.isMainline,
        order: entry.groupOrder,
        items: [],
      });
    }
    groupMap.get(entry.groupId).items.push(entry);
  }

  const groups = Array.from(groupMap.values())
    .map((grp) => {
      grp.items.sort((a, b) => {
        const volA = parseSortableVolumeNumber(a);
        const volB = parseSortableVolumeNumber(b);
        if (volA !== null && volB !== null && volA !== volB) return volA - volB;
        const yA = a.releaseYear ?? 9999;
        const yB = b.releaseYear ?? 9999;
        if (yA !== yB) return yA - yB;
        return a.title.localeCompare(b.title, 'pt-BR');
      });
      return {
        ...grp,
        completedCount: grp.items.filter((i) => i.statusKind === 'completed').length,
        inCatalogCount: grp.items.filter((i) => i.inCatalog).length,
        missingCount: grp.items.filter((i) => i.statusKind === 'missing').length,
        totalCount: grp.items.length,
      };
    })
    .sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return a.label.localeCompare(b.label, 'pt-BR');
    });

  const mainlineCatalogEntries = unifiedEntries.filter((e) => e.inCatalog && e.isMainline);
  const allCatalogEntries = unifiedEntries.filter((e) => e.inCatalog);
  const mainlineAllEntries = unifiedEntries.filter((e) => e.isMainline);

  const manualMainTotal =
    Number(manualMeta?.mainSeriesTotal) > 0 ? Math.round(Number(manualMeta.mainSeriesTotal)) : null;
  const manualUniTotal =
    Number(manualMeta?.universeTotal) > 0 ? Math.round(Number(manualMeta.universeTotal)) : null;

  const knownMainTotal =
    manualMainTotal ?? (sourceIsComplete && mainlineAllEntries.length > 0 ? mainlineAllEntries.length : null);
  const knownUniverseTotal =
    manualUniTotal ?? (sourceIsComplete && unifiedEntries.length > 0 ? unifiedEntries.length : null);

  const resolvedSource =
    manualMainTotal || manualUniTotal
      ? 'Definido por você'
      : sourceIsComplete
        ? sourceLabel || 'Fonte externa'
        : null;

  const completeness = computeEntityCompleteness({
    works: mainlineCatalogEntries,
    mainSeriesTotal: knownMainTotal,
    universeWorks: allCatalogEntries,
    universeTotal: knownUniverseTotal,
    totalSource: resolvedSource,
  });

  return {
    domain,
    entityName: String(entity?.name || '').trim(),
    groups,
    allItems: unifiedEntries,
    completedItems: unifiedEntries.filter((e) => e.statusKind === 'completed'),
    inCatalogItems: unifiedEntries.filter((e) => e.statusKind === 'in_catalog'),
    missingItems: unifiedEntries.filter((e) => e.statusKind === 'missing'),
    completeness,
    sourceLabel: resolvedSource || sourceLabel || null,
    sourceIsComplete: Boolean(sourceIsComplete),
    hasKnownTotal: !completeness.mainline.isOpenEnded || !completeness.universe.isOpenEnded,
  };
}
