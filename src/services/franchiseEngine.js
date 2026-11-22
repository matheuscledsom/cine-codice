import { normalizeTitleForDedup } from './cinemaApi.js';
import { createUuid } from './codiceDatabase.js';

const RELATION_KIND_LABEL = {
  PREQUEL: 'Prequel',
  SEQUEL: 'Sequência',
  PARENT: 'Obra Principal',
  SIDE_STORY: 'História Paralela / OVA',
  SPIN_OFF: 'Spin-off',
  ALTERNATIVE: 'Versão Alternativa',
  SUMMARY: 'Filme Recap / Resumo',
  MOVIE: 'Filme Canônico',
  OVA: 'OVA',
  ONA: 'ONA',
  SPECIAL: 'Especial',
};

const RELATION_ORDER_WEIGHT = {
  PREQUEL: -10,
  PARENT: 0,
  PRINCIPAL: 0,
  SEQUEL: 10,
  MOVIE: 15,
  SIDE_STORY: 20,
  OVA: 22,
  SPIN_OFF: 25,
  SPECIAL: 28,
  SUMMARY: 30,
  ALTERNATIVE: 35,
};

function normalizeFranchiseKey(raw = '') {
  return String(raw || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractFranchiseBaseInfo(item = {}) {
  const explicitFranchise = String(item.franchiseName || item.seriesName || '').trim();
  if (explicitFranchise) {
    return {
      franchiseName: explicitFranchise,
      franchiseKey: normalizeFranchiseKey(explicitFranchise),
      orderHint: Number(item.chronologicalOrder) || null,
    };
  }

  const rawTitle = String(item.title || '').trim();
  if (!rawTitle) return null;

  // Padrões comuns de sequência / parte / temporada / filme canônico
  const stripped = rawTitle
    .replace(/\s*[:\-—]\s*(?:part|parte|temporada|season|vol\.?|epis[oó]dio|chapter|cap[ií]tulo|the movie|o filme|movie|ova|final season).*$/i, '')
    .replace(/\s+(?:2nd|3rd|4th|\d+th)\s+season\b.*$/i, '')
    .replace(/\s+(?:season|temporada|part|parte)\s+\d+\b.*$/i, '')
    .replace(/\s+(?:II|III|IV|V|VI|[2-9])$/i, '')
    .trim();

  if (stripped && stripped.length >= 2 && stripped !== rawTitle) {
    const numMatch = rawTitle.match(/\b(\d+|II|III|IV|V|VI)\b\s*$/i);
    const romanMap = { II: 2, III: 3, IV: 4, V: 5, VI: 6 };
    const orderHint = numMatch
      ? romanMap[numMatch[1].toUpperCase()] || Number(numMatch[1]) || null
      : null;

    return {
      franchiseName: stripped,
      franchiseKey: normalizeFranchiseKey(stripped),
      orderHint,
    };
  }

  if (Array.isArray(item.franchiseRelations) && item.franchiseRelations.length > 0) {
    return {
      franchiseName: rawTitle,
      franchiseKey: normalizeFranchiseKey(rawTitle),
      orderHint: Number(item.chronologicalOrder) || 1,
    };
  }

  return null;
}

function inferWorkTypeFromRelationFormat(rel = {}, fallbackType = 'anime') {
  const fmt = String(rel.format || '').toUpperCase();
  if (fmt === 'MOVIE') return 'movie';
  if (fmt === 'TV' || fmt === 'TV_SHORT' || fmt === 'OVA' || fmt === 'ONA' || fmt === 'SPECIAL') {
    return fallbackType === 'series' ? 'series' : 'anime';
  }
  return fallbackType;
}

function inferEntryKindLabel(rel = {}, isMovie = false) {
  const relType = String(rel.relationType || '').toUpperCase();
  const fmt = String(rel.format || '').toUpperCase();
  if (fmt === 'MOVIE' || (isMovie && !relType)) return 'Filme Canônico';
  if (fmt === 'OVA' || fmt === 'ONA') return fmt;
  return RELATION_KIND_LABEL[relType] || 'Capítulo da Saga';
}

export function buildFranchiseTimeline(franchiseEntries = [], allCatalogedItems = []) {
  const catalogedByTitle = new Map();
  const catalogedByAnilist = new Map();
  const catalogedByMal = new Map();

  for (const item of Array.isArray(allCatalogedItems) ? allCatalogedItems : []) {
    if (!item || item.inBacklog === false) continue;
    const normTitle = normalizeTitleForDedup(item.title || '');
    const normOrig = normalizeTitleForDedup(item.originalTitle || '');
    if (normTitle) catalogedByTitle.set(normTitle, item);
    if (normOrig) catalogedByTitle.set(normOrig, item);
    if (item.anilistId) catalogedByAnilist.set(String(item.anilistId), item);
    if (item.malId) catalogedByMal.set(String(item.malId), item);
  }

  const timelineMap = new Map();

  const registerNode = (node) => {
    const normKey = normalizeTitleForDedup(node.title || '');
    if (!normKey) return;
    const existing = timelineMap.get(normKey);
    if (!existing) {
      timelineMap.set(normKey, node);
    } else if (node.isCataloged && !existing.isCataloged) {
      timelineMap.set(normKey, { ...existing, ...node });
    }
  };

  for (const { item, orderHint } of franchiseEntries) {
    const isCompleted = item.status === 'completed';
    const isWatching = item.status === 'playing' || item.status === 'rewatching';
    registerNode({
      id: item.id,
      title: item.title,
      originalTitle: item.originalTitle || '',
      releaseYear: Number(item.releaseYear) || null,
      workType: item.workType || 'movie',
      entryKind:
        item.animeFormat === 'OVA'
          ? 'OVA'
          : item.animeFormat === 'Filme'
            ? 'Filme Canônico'
            : 'Catalogado',
      orderWeight: orderHint || (Number(item.chronologicalOrder) || 0),
      isCataloged: true,
      isCompleted,
      isWatching,
      status: item.status,
      coverUrl: item.coverUrl || null,
      totalEpisodes: item.totalEpisodes || null,
      item,
    });

    const rels = Array.isArray(item.franchiseRelations) ? item.franchiseRelations : [];
    rels.forEach((rel, relIdx) => {
      if (!rel?.title) return;
      const normRel = normalizeTitleForDedup(rel.title);
      const matched =
        (rel.anilistId && catalogedByAnilist.get(String(rel.anilistId))) ||
        (rel.malId && catalogedByMal.get(String(rel.malId))) ||
        catalogedByTitle.get(normRel) ||
        null;

      const relWeight =
        RELATION_ORDER_WEIGHT[String(rel.relationType || '').toUpperCase()] ?? 15 + relIdx;
      const inferredType = inferWorkTypeFromRelationFormat(rel, item.workType || 'anime');

      registerNode({
        id: matched ? matched.id : `missing-${rel.anilistId || rel.malId || normRel}`,
        title: matched?.title || rel.title,
        originalTitle: matched?.originalTitle || rel.originalTitle || '',
        releaseYear: matched?.releaseYear || Number(rel.releaseYear) || null,
        workType: matched?.workType || inferredType,
        entryKind: inferEntryKindLabel(rel, inferredType === 'movie'),
        orderWeight: relWeight,
        isCataloged: Boolean(matched),
        isCompleted: matched?.status === 'completed',
        isWatching: matched?.status === 'playing' || matched?.status === 'rewatching',
        status: matched?.status || 'missing',
        coverUrl: matched?.coverUrl || rel.coverUrl || null,
        totalEpisodes: matched?.totalEpisodes || rel.totalEpisodes || null,
        anilistId: rel.anilistId || null,
        malId: rel.malId || null,
        item: matched || null,
        relationSource: rel,
      });
    });
  }

  return Array.from(timelineMap.values()).sort((a, b) => {
    const yearA = Number(a.releaseYear) || 9999;
    const yearB = Number(b.releaseYear) || 9999;
    if (yearA !== yearB) return yearA - yearB;
    return (a.orderWeight || 0) - (b.orderWeight || 0);
  });
}

export function analyzeFranchises(items = []) {
  const safeItems = (Array.isArray(items) ? items : []).filter(
    (item) => item && item.inBacklog !== false
  );

  const groups = new Map();

  for (const item of safeItems) {
    const info = extractFranchiseBaseInfo(item);
    if (!info || !info.franchiseKey) continue;

    if (!groups.has(info.franchiseKey)) {
      groups.set(info.franchiseKey, {
        seriesKey: info.franchiseKey,
        name: info.franchiseName,
        entries: [],
      });
    }
    groups.get(info.franchiseKey).entries.push({ item, orderHint: info.orderHint });
  }

  const franchises = [];

  for (const group of groups.values()) {
    const hasRelations = group.entries.some(
      (e) => Array.isArray(e.item.franchiseRelations) && e.item.franchiseRelations.length > 0
    );
    if (group.entries.length < 2 && !hasRelations) continue;

    const timeline = buildFranchiseTimeline(group.entries, safeItems);
    if (timeline.length < 2) continue;

    const rep =
      group.entries.find((e) => e.item.coverUrl && (e.item.status === 'playing' || e.item.status === 'rewatching'))?.item ||
      group.entries.find((e) => e.item.coverUrl)?.item ||
      group.entries[0].item;

    const totalCount = timeline.length;
    const completedCount = timeline.filter((n) => n.isCompleted).length;
    const catalogedCount = timeline.filter((n) => n.isCataloged).length;
    const missingEntries = timeline.filter((n) => !n.isCataloged);
    const completionPct =
      totalCount > 0 ? Math.min(100, Math.round((completedCount / totalCount) * 100)) : 0;

    franchises.push({
      id: `franchise-${group.seriesKey.replace(/\s+/g, '-')}`,
      seriesKey: group.seriesKey,
      name: group.name,
      representativeItem: rep,
      items: group.entries.map((e) => e.item),
      timeline,
      director: rep.director || rep.studio || '',
      workType: rep.workType || 'movie',
      genres: Array.isArray(rep.genres) ? rep.genres : [],
      coverUrl: rep.coverUrl || null,
      totalCount,
      catalogedCount,
      completedCount,
      completionPct,
      missingEntries,
      nextMissingEntry: missingEntries[0] || null,
      isComplete: missingEntries.length === 0 && completionPct >= 100,
    });
  }

  return franchises.sort((a, b) => {
    if (a.isComplete !== b.isComplete) return a.isComplete ? 1 : -1;
    return b.completionPct - a.completionPct || b.catalogedCount - a.catalogedCount;
  });
}

export function findFranchiseForItem(item, items = []) {
  if (!item) return null;
  const franchises = analyzeFranchises(items);
  const directMatch = franchises.find((f) =>
    f.items.some((entry) => entry.id === item.id) ||
    f.timeline.some((node) => node.id === item.id)
  );
  if (directMatch) return directMatch;

  if (Array.isArray(item.franchiseRelations) && item.franchiseRelations.length > 0) {
    const timeline = buildFranchiseTimeline([{ item, orderHint: 1 }], items);
    const completedCount = timeline.filter((n) => n.isCompleted).length;
    const missingEntries = timeline.filter((n) => !n.isCataloged);
    return {
      id: `franchise-single-${item.id}`,
      seriesKey: normalizeFranchiseKey(item.franchiseName || item.title),
      name: item.franchiseName || item.title,
      representativeItem: item,
      items: [item],
      timeline,
      director: item.director || item.studio || '',
      workType: item.workType || 'anime',
      genres: Array.isArray(item.genres) ? item.genres : [],
      coverUrl: item.coverUrl || null,
      totalCount: timeline.length,
      catalogedCount: timeline.filter((n) => n.isCataloged).length,
      completedCount,
      completionPct: timeline.length > 0 ? Math.round((completedCount / timeline.length) * 100) : 0,
      missingEntries,
      nextMissingEntry: missingEntries[0] || null,
      isComplete: missingEntries.length === 0 && completedCount === timeline.length,
    };
  }
  return null;
}

export function buildMissingFranchiseEntryDraft(franchise, missingNode) {
  const node = missingNode || franchise?.nextMissingEntry;
  if (!node) return null;
  const rep = franchise?.representativeItem || {};
  return {
    id: createUuid(),
    title: node.title,
    originalTitle: node.originalTitle || node.title,
    franchiseName: franchise?.name || rep.franchiseName || '',
    director: franchise?.director || rep.director || rep.studio || '',
    studio: rep.studio || '',
    workType: node.workType || franchise?.workType || rep.workType || 'anime',
    animeFormat:
      node.entryKind === 'OVA' || node.entryKind === 'ONA'
        ? node.entryKind
        : node.workType === 'movie'
          ? 'Filme'
          : 'TV',
    releaseYear: node.releaseYear || null,
    totalEpisodes: node.totalEpisodes || null,
    totalSeasons: 1,
    anilistId: node.anilistId || null,
    malId: node.malId || null,
    genres: Array.isArray(franchise?.genres) ? [...franchise.genres] : [],
    coverUrl: node.coverUrl || franchise?.coverUrl || rep.coverUrl || null,
    format: rep.format || 'Streaming',
    audioFormat: rep.audioFormat || 'Legendado',
    status: 'queued',
    inBacklog: true,
    isWishlist: false,
  };
}
