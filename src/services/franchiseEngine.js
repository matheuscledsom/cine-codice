import { isConfirmedUserRating } from '../lib/ratings.js';
import { normalizeTitleForDedup } from './cinemaApi.js';
import { createUuid } from './codiceDatabase.js';

export const FRANCHISE_GRAPH_MAX_DEPTH = 3;
export const FRANCHISE_GRAPH_MAX_NODES = 60;

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
  if (item.belongsToCollection?.name) {
    const colName = String(item.belongsToCollection.name)
      .replace(/\s*Collection$/i, '')
      .trim();
    if (colName) {
      return {
        franchiseName: colName,
        franchiseKey: item.belongsToCollection.id
          ? `tmdb-col-${item.belongsToCollection.id}`
          : normalizeFranchiseKey(colName),
        orderHint: Number(item.chronologicalOrder) || null,
      };
    }
  }

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
    const manualLinks = Array.isArray(item.franchiseLinks) ? item.franchiseLinks : [];
    const combinedLinks = [
      ...rels,
      ...manualLinks.map((lnk) => ({
        relationType: lnk.relationType || 'SPIN_OFF',
        title: lnk.title || '',
        anilistId: lnk.anilistId || null,
        malId: lnk.malId || null,
        tmdbId: lnk.tmdbId || null,
        targetWorkId: lnk.targetWorkId || null,
        format: lnk.workType === 'movie' ? 'MOVIE' : 'TV',
      })),
    ];

    combinedLinks.forEach((rel, relIdx) => {
      if (!rel?.title && !rel?.targetWorkId) return;
      const normRel = normalizeTitleForDedup(rel.title || '');
      const matched =
        (rel.targetWorkId &&
          allCatalogedItems.find((c) => c && c.id === rel.targetWorkId)) ||
        (rel.anilistId && catalogedByAnilist.get(String(rel.anilistId))) ||
        (rel.malId && catalogedByMal.get(String(rel.malId))) ||
        (rel.tmdbId &&
          allCatalogedItems.find(
            (c) => c && Number(c.tmdbId || c.ids?.tmdb) === Number(rel.tmdbId)
          )) ||
        (normRel ? catalogedByTitle.get(normRel) : null) ||
        null;

      const resolvedTitle = matched?.title || rel.title;
      if (!resolvedTitle) return;

      const relWeight =
        RELATION_ORDER_WEIGHT[String(rel.relationType || '').toUpperCase()] ?? 15 + relIdx;
      const inferredType = inferWorkTypeFromRelationFormat(rel, item.workType || 'anime');

      registerNode({
        id: matched
          ? matched.id
          : `missing-${rel.targetWorkId || rel.anilistId || rel.malId || rel.tmdbId || normRel}`,
        title: resolvedTitle,
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
        anilistId: rel.anilistId || matched?.anilistId || null,
        malId: rel.malId || matched?.malId || null,
        tmdbId: rel.tmdbId || matched?.tmdbId || null,
        item: matched || null,
        relationSource: rel,
      });
    });
  }

  return Array.from(timelineMap.values())
    .slice(0, FRANCHISE_GRAPH_MAX_NODES)
    .sort((a, b) => {
      const yearA = Number(a.releaseYear) || 9999;
      const yearB = Number(b.releaseYear) || 9999;
      if (yearA !== yearB) return yearA - yearB;
      return (a.orderWeight || 0) - (b.orderWeight || 0);
    });
}

function makeNodeDedupKey(node) {
  if (!node) return null;
  if (node.id && !String(node.id).startsWith('missing-')) return `id:${node.id}`;
  const tmdb = Number(node.tmdbId || node.ids?.tmdb || node.item?.tmdbId);
  if (Number.isInteger(tmdb) && tmdb > 0) return `tmdb:${tmdb}`;
  const ani = Number(node.anilistId || node.ids?.anilist || node.item?.anilistId);
  if (Number.isInteger(ani) && ani > 0) return `anilist:${ani}`;
  const mal = Number(node.malId || node.ids?.mal || node.item?.malId);
  if (Number.isInteger(mal) && mal > 0) return `mal:${mal}`;
  const norm = normalizeTitleForDedup(node.title || '');
  return norm ? `title:${norm}` : null;
}

/**
 * Travessia BFS no grafo de relações da franquia com conjunto de visitados (sem ciclos),
 * profundidade máxima 3, teto de 60 nós e deduplicação por ID canônico (Fase 4).
 */
export function traverseFranchiseGraph(
  seedItem,
  allItems = [],
  {
    maxDepth = FRANCHISE_GRAPH_MAX_DEPTH,
    maxNodes = FRANCHISE_GRAPH_MAX_NODES,
  } = {}
) {
  if (!seedItem) return [];

  const capDepth = Math.max(0, Math.min(FRANCHISE_GRAPH_MAX_DEPTH, Number(maxDepth) || 3));
  const capNodes = Math.max(1, Math.min(FRANCHISE_GRAPH_MAX_NODES, Number(maxNodes) || 60));

  const catalog = (Array.isArray(allItems) ? allItems : []).filter(Boolean);
  const findCatalogMatch = (ref = {}) =>
    catalog.find(
      (c) =>
        (ref.targetWorkId && c.id === ref.targetWorkId) ||
        (ref.id && c.id === ref.id) ||
        (ref.anilistId && Number(c.anilistId || c.ids?.anilist) === Number(ref.anilistId)) ||
        (ref.malId && Number(c.malId || c.ids?.mal) === Number(ref.malId)) ||
        (ref.tmdbId && Number(c.tmdbId || c.ids?.tmdb) === Number(ref.tmdbId)) ||
        (ref.title &&
          normalizeTitleForDedup(c.title) === normalizeTitleForDedup(ref.title))
    ) || null;

  const visitedKeys = new Set();
  const nodes = [];
  const queue = [{ item: seedItem, depth: 0, rel: null }];

  while (queue.length > 0 && nodes.length < capNodes) {
    const current = queue.shift();
    const matched = current.item?.id ? current.item : findCatalogMatch(current.item);
    const baseObj = matched || current.item;
    if (!baseObj) continue;

    const dedupKey = makeNodeDedupKey(baseObj);
    if (!dedupKey || visitedKeys.has(dedupKey)) continue;
    visitedKeys.add(dedupKey);

    const inferredType =
      baseObj.workType ||
      (current.rel ? inferWorkTypeFromRelationFormat(current.rel, seedItem.workType) : 'movie');

    nodes.push({
      id: baseObj.id || `missing-${dedupKey}`,
      dedupKey,
      depth: current.depth,
      title: baseObj.title,
      originalTitle: baseObj.originalTitle || '',
      releaseYear: Number(baseObj.releaseYear) || null,
      workType: inferredType,
      animeFormat: baseObj.animeFormat || current.rel?.format || '',
      entryKind: current.rel
        ? inferEntryKindLabel(current.rel, inferredType === 'movie')
        : baseObj.animeFormat === 'OVA'
          ? 'OVA'
          : baseObj.animeFormat === 'Filme'
            ? 'Filme Canônico'
            : 'Catalogado',
      isCataloged: Boolean(matched || baseObj.status),
      isCompleted: baseObj.status === 'completed',
      status: baseObj.status || 'missing',
      anilistId: baseObj.anilistId || baseObj.ids?.anilist || null,
      malId: baseObj.malId || baseObj.ids?.mal || null,
      tmdbId: baseObj.tmdbId || baseObj.ids?.tmdb || null,
      item: matched || (baseObj.status ? baseObj : null),
      relationSource: current.rel || null,
    });

    if (current.depth >= capDepth) continue;

    const neighbors = [];
    if (Array.isArray(baseObj.franchiseRelations)) {
      baseObj.franchiseRelations.forEach((rel) => neighbors.push(rel));
    }
    if (Array.isArray(baseObj.franchiseLinks)) {
      baseObj.franchiseLinks.forEach((lnk) => neighbors.push(lnk));
    }
    // Relações reversas entre obras já catalogadas no catálogo local (bidirecional no grafo)
    const baseAnilist = Number(baseObj.anilistId || baseObj.ids?.anilist) || null;
    const baseMal = Number(baseObj.malId || baseObj.ids?.mal) || null;
    const baseTmdb = Number(baseObj.tmdbId || baseObj.ids?.tmdb) || null;
    const baseTitleNorm = normalizeTitleForDedup(baseObj.title || '');
    catalog.forEach((c) => {
      if (!c || c.id === baseObj.id) return;
      const outEdges = [
        ...(Array.isArray(c.franchiseRelations) ? c.franchiseRelations : []),
        ...(Array.isArray(c.franchiseLinks) ? c.franchiseLinks : []),
      ];
      const pointsToBase = outEdges.some(
        (rel) =>
          (rel.targetWorkId && baseObj.id && rel.targetWorkId === baseObj.id) ||
          (baseAnilist && Number(rel.anilistId) === baseAnilist) ||
          (baseMal && Number(rel.malId) === baseMal) ||
          (baseTmdb && Number(rel.tmdbId) === baseTmdb) ||
          (baseTitleNorm && rel.title && normalizeTitleForDedup(rel.title) === baseTitleNorm)
      );
      if (pointsToBase) {
        neighbors.push({
          ...c,
          targetWorkId: c.id,
          format: c.animeFormat === 'Filme' ? 'MOVIE' : c.animeFormat || (c.workType === 'movie' ? 'MOVIE' : 'TV'),
          relationType: 'PARENT',
        });
      }
    });
    // Obras com mesmo belongsToCollection.id também são vizinhas diretas
    if (baseObj.belongsToCollection?.id) {
      catalog.forEach((c) => {
        if (
          c.id !== baseObj.id &&
          c.belongsToCollection?.id === baseObj.belongsToCollection.id
        ) {
          neighbors.push({ ...c, targetWorkId: c.id, relationType: 'SEQUEL' });
        }
      });
    }

    for (const neighbor of neighbors) {
      if (!neighbor) continue;
      const resolvedNeighbor = findCatalogMatch(neighbor) || {
        ...neighbor,
        id:
          neighbor.targetWorkId ||
          (neighbor.anilistId
            ? `missing-${neighbor.anilistId}`
            : neighbor.malId
              ? `missing-${neighbor.malId}`
              : neighbor.tmdbId
                ? `missing-tmdb-${neighbor.tmdbId}`
                : null),
      };
      const nKey = makeNodeDedupKey(resolvedNeighbor);
      if (nKey && !visitedKeys.has(nKey)) {
        queue.push({ item: resolvedNeighbor, depth: current.depth + 1, rel: neighbor });
      }
    }
  }

  return nodes;
}

/**
 * Calcula estatísticas de franquia/universo:
 * - Média só de obras avaliadas (excluindo legacy-default)
 * - Ranking #k de N somente quando obra atual tem nota confirmada E franquia tem >= 2 obras
 * - Progresso separado em filmes, OVAs, especiais e spin-offs
 */
export function computeFranchiseStats(timeline = [], currentItem = null) {
  const list = Array.isArray(timeline) ? timeline : [];
  const totalCount = list.length;
  const completedCount = list.filter((n) => n.isCompleted).length;

  const breakdown = {
    movies: { completed: 0, total: 0 },
    ovas: { completed: 0, total: 0 },
    specials: { completed: 0, total: 0 },
    spinOffs: { completed: 0, total: 0 },
  };

  for (const node of list) {
    const kind = String(node.entryKind || '').toLowerCase();
    const fmt = String(
      node.animeFormat || node.item?.animeFormat || node.relationSource?.format || ''
    ).toLowerCase();
    const relType = String(node.relationSource?.relationType || '').toUpperCase();

    let bucket = null;
    if (relType === 'SPIN_OFF' || kind.includes('spin')) {
      bucket = breakdown.spinOffs;
    } else if (fmt === 'ova' || fmt === 'ona' || kind === 'ova' || kind === 'ona') {
      bucket = breakdown.ovas;
    } else if (
      relType === 'SPECIAL' ||
      relType === 'SUMMARY' ||
      fmt === 'special' ||
      fmt === 'especial' ||
      kind.includes('especial') ||
      kind.includes('recap')
    ) {
      bucket = breakdown.specials;
    } else if (
      node.workType === 'movie' ||
      node.item?.workType === 'movie' ||
      fmt === 'movie' ||
      fmt === 'filme' ||
      kind.includes('filme')
    ) {
      bucket = breakdown.movies;
    } else if (
      relType === 'SIDE_STORY' ||
      relType === 'ALTERNATIVE' ||
      kind.includes('paralela')
    ) {
      bucket = breakdown.spinOffs;
    }

    if (bucket) {
      bucket.total += 1;
      if (node.isCompleted) bucket.completed += 1;
    }
  }

  const ratedEntries = list
    .filter((n) => n.item && isConfirmedUserRating(n.item))
    .map((n, idx) => ({
      id: n.id,
      title: n.title,
      rating: Number(n.item.rating),
      orderIndex: idx,
    }))
    .sort((a, b) => b.rating - a.rating || a.orderIndex - b.orderIndex);

  const ratedCount = ratedEntries.length;
  const franchiseAverageRating =
    ratedCount > 0
      ? Math.round(ratedEntries.reduce((acc, e) => acc + e.rating, 0) / ratedCount)
      : null;

  const isMultiWorkFranchise = totalCount > 1;
  const currentHasConfirmedRating = Boolean(
    currentItem && isConfirmedUserRating(currentItem)
  );
  const showComparative = isMultiWorkFranchise && currentHasConfirmedRating;

  const rankIndex = showComparative
    ? ratedEntries.findIndex((e) => e.id === currentItem.id)
    : -1;
  const currentRank = rankIndex >= 0 ? rankIndex + 1 : null;

  return {
    totalCount,
    completedCount,
    completionPct: totalCount > 0 ? Math.min(100, Math.round((completedCount / totalCount) * 100)) : 0,
    ratedCount,
    franchiseAverageRating,
    hasComparative: showComparative && currentRank !== null,
    currentRank,
    rankLabel: showComparative && currentRank !== null ? `#${currentRank} de ${ratedCount}` : null,
    breakdown,
  };
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
    const stats = computeFranchiseStats(timeline, rep);

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
      stats,
    });
  }

  return franchises.sort((a, b) => {
    if (a.isComplete !== b.isComplete) return a.isComplete ? 1 : -1;
    return b.completionPct - a.completionPct || b.catalogedCount - a.catalogedCount;
  });
}

export function findFranchiseForItem(item, items = []) {
  if (!item) return null;
  const safeList = Array.isArray(items) ? items : [];
  const franchises = analyzeFranchises(safeList);
  const directMatch = franchises.find((f) =>
    f.items.some((entry) => entry.id === item.id) ||
    f.timeline.some((node) => node.id === item.id)
  );

  const graphNodes = traverseFranchiseGraph(item, safeList, {
    maxDepth: FRANCHISE_GRAPH_MAX_DEPTH,
    maxNodes: FRANCHISE_GRAPH_MAX_NODES,
  });

  const mergeGraphIntoTimeline = (baseTimeline = []) => {
    const map = new Map();
    for (const node of baseTimeline) {
      const k = makeNodeDedupKey(node) || node.id;
      if (k && !map.has(k)) map.set(k, node);
    }
    for (const gNode of graphNodes) {
      const k = gNode.dedupKey || makeNodeDedupKey(gNode) || gNode.id;
      if (k && !map.has(k) && map.size < FRANCHISE_GRAPH_MAX_NODES) {
        map.set(k, gNode);
      }
    }
    return Array.from(map.values()).slice(0, FRANCHISE_GRAPH_MAX_NODES);
  };

  if (directMatch) {
    const mergedTimeline = mergeGraphIntoTimeline(directMatch.timeline);
    const completedCount = mergedTimeline.filter((n) => n.isCompleted).length;
    const catalogedCount = mergedTimeline.filter((n) => n.isCataloged).length;
    const missingEntries = mergedTimeline.filter((n) => !n.isCataloged);
    const completionPct =
      mergedTimeline.length > 0
        ? Math.min(100, Math.round((completedCount / mergedTimeline.length) * 100))
        : 0;
    return {
      ...directMatch,
      timeline: mergedTimeline,
      totalCount: mergedTimeline.length,
      catalogedCount,
      completedCount,
      completionPct,
      missingEntries,
      nextMissingEntry: missingEntries[0] || null,
      stats: computeFranchiseStats(mergedTimeline, item),
    };
  }

  const hasLinks =
    (Array.isArray(item.franchiseRelations) && item.franchiseRelations.length > 0) ||
    (Array.isArray(item.franchiseLinks) && item.franchiseLinks.length > 0) ||
    Boolean(item.belongsToCollection?.id) ||
    graphNodes.length > 1;

  if (hasLinks) {
    const baseTimeline = buildFranchiseTimeline([{ item, orderHint: 1 }], safeList);
    const timeline = mergeGraphIntoTimeline(baseTimeline);
    const completedCount = timeline.filter((n) => n.isCompleted).length;
    const missingEntries = timeline.filter((n) => !n.isCataloged);
    const stats = computeFranchiseStats(timeline, item);
    return {
      id: `franchise-single-${item.id}`,
      seriesKey: normalizeFranchiseKey(
        item.franchiseName || item.belongsToCollection?.name || item.title
      ),
      name: item.franchiseName || item.belongsToCollection?.name || item.title,
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
      completionPct:
        timeline.length > 0 ? Math.round((completedCount / timeline.length) * 100) : 0,
      missingEntries,
      nextMissingEntry: missingEntries[0] || null,
      isComplete: missingEntries.length === 0 && completedCount === timeline.length,
      stats,
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
