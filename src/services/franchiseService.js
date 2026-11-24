import { inferDomainFromWork } from '../config/domainConfig.js';
import {
  buildDomainFranchiseModel,
  computeFranchiseScopeProgress,
  inferFranchiseTier,
} from '../lib/franchiseTier.js';
import { isConfirmedUserRating } from '../lib/ratings.js';
import { loadTmdbApiKey, normalizeTitleForDedup } from './cinemaApi.js';
import { findFranchiseForItem } from './franchiseEngine.js';

export const ALLOWED_UNIVERSE_RELATIONS = Object.freeze([
  'SEQUEL',
  'PREQUEL',
  'SIDE_STORY',
  'SPIN_OFF',
  'PARENT',
]);

export const BLOCKED_UNIVERSE_RELATIONS = Object.freeze([
  'CHARACTER',
  'OTHER',
]);

export function isAllowedUniverseRelation(rel = {}) {
  const relType = String(rel?.relationType || '')
    .trim()
    .toUpperCase();
  if (!relType) return true;
  if (BLOCKED_UNIVERSE_RELATIONS.includes(relType)) return false;
  if (ALLOWED_UNIVERSE_RELATIONS.includes(relType)) return true;
  if (['MOVIE', 'OVA', 'ONA', 'SPECIAL'].includes(relType)) return true;
  return false;
}

export function filterStrictlyCanonicalRelations(relations = []) {
  return (Array.isArray(relations) ? relations : []).filter(
    (rel) => rel && isAllowedUniverseRelation(rel)
  );
}

export async function fetchTmdbCollectionParts(
  collectionId,
  { apiKey = '', fetchImpl = globalThis.fetch, signal } = {}
) {
  const cleanId = Number(collectionId);
  if (!Number.isInteger(cleanId) || cleanId <= 0) return [];
  const key = String(apiKey || loadTmdbApiKey() || '').trim();
  if (!key || typeof fetchImpl !== 'function') return [];

  try {
    const url = `https://api.themoviedb.org/3/collection/${cleanId}?api_key=${encodeURIComponent(key)}&language=pt-BR`;
    const res = await fetchImpl(url, { signal });
    if (!res.ok) return [];
    const json = await res.json();
    const parts = Array.isArray(json?.parts) ? json.parts : [];
    return parts
      .map((part) => {
        const yearMatch = String(part?.release_date || '').match(/^(\d{4})/);
        return {
          tmdbId: Number(part.id) || null,
          title: String(part.title || part.original_title || '').trim(),
          originalTitle: String(part.original_title || '').trim(),
          releaseYear: yearMatch ? Number(yearMatch[1]) : null,
          workType: 'movie',
          coverUrl: part.poster_path
            ? `https://image.tmdb.org/t/p/w500${part.poster_path}`
            : null,
          backdropUrl: part.backdrop_path
            ? `https://image.tmdb.org/t/p/w1280${part.backdrop_path}`
            : null,
          synopsis: String(part.overview || '').trim(),
        };
      })
      .filter((p) => p.title)
      .sort((a, b) => (a.releaseYear || 9999) - (b.releaseYear || 9999));
  } catch {
    return [];
  }
}

function classifyUniverseGroup(node) {
  const fmt = String(
    node?.animeFormat || node?.relationSource?.format || ''
  ).toUpperCase();
  const kind = String(node?.entryKind || '').toUpperCase();
  const relType = String(node?.relationSource?.relationType || '').toUpperCase();

  if (
    node?.workType === 'movie' ||
    fmt === 'MOVIE' ||
    kind.includes('FILME')
  ) {
    return 'movies';
  }
  if (
    fmt === 'OVA' ||
    fmt === 'ONA' ||
    fmt === 'SPECIAL' ||
    kind.includes('OVA') ||
    kind.includes('ESPECIAL') ||
    relType === 'SIDE_STORY'
  ) {
    return 'ovasSpecials';
  }
  return 'mainSeries';
}

function decorateCatalogStatus(node, catalogItems = []) {
  const matched =
    node.item ||
    catalogItems.find((c) => {
      if (!c || c.inBacklog === false) return false;
      if (node.id && c.id === node.id) return true;
      if (
        node.tmdbId &&
        Number(c.tmdbId || c.ids?.tmdb) === Number(node.tmdbId)
      ) {
        return true;
      }
      if (
        node.anilistId &&
        Number(c.anilistId || c.ids?.anilist) === Number(node.anilistId)
      ) {
        return true;
      }
      if (node.malId && Number(c.malId || c.ids?.mal) === Number(node.malId)) {
        return true;
      }
      return (
        normalizeTitleForDedup(c.title) === normalizeTitleForDedup(node.title)
      );
    }) ||
    null;

  if (!matched) {
    return {
      ...node,
      isCataloged: false,
      isCompleted: false,
      catalogState: 'uncataloged',
      catalogStateLabel: 'Não catalogado',
      userRating: null,
      item: null,
    };
  }

  const isCompleted = matched.status === 'completed';
  const hasScore = isConfirmedUserRating(matched);
  const userRating = hasScore ? Math.round(Number(matched.rating)) : null;

  return {
    ...node,
    id: matched.id,
    isCataloged: true,
    isCompleted,
    status: matched.status,
    catalogState: isCompleted ? 'completed' : 'queued',
    catalogStateLabel: isCompleted
      ? userRating !== null
        ? `Concluído (${userRating}/100)`
        : 'Concluído'
      : 'Na fila',
    userRating,
    item: matched,
  };
}

export function buildDeterministicFranchiseOrUniverseModel(
  work,
  allCatalogItems = [],
  remoteCollectionParts = []
) {
  if (!work) return null;

  const isMovie = work.workType === 'movie';
  const sanitizedWork = {
    ...work,
    franchiseRelations: filterStrictlyCanonicalRelations(work.franchiseRelations),
  };

  const catalog = (Array.isArray(allCatalogItems) ? allCatalogItems : [])
    .filter(Boolean)
    .map((entry) => ({
      ...entry,
      franchiseRelations: filterStrictlyCanonicalRelations(
        entry.franchiseRelations
      ),
    }));

  const baseFranchise = findFranchiseForItem(
    sanitizedWork,
    catalog.length > 0 ? catalog : [sanitizedWork]
  );

  const rawNodes = baseFranchise?.timeline ? [...baseFranchise.timeline] : [];

  // Incorpora partes oficiais da coleção TMDB para filmes
  if (isMovie && Array.isArray(remoteCollectionParts)) {
    for (const part of remoteCollectionParts) {
      const norm = normalizeTitleForDedup(part.title);
      const alreadyExists = rawNodes.some(
        (n) =>
          (part.tmdbId && Number(n.tmdbId) === Number(part.tmdbId)) ||
          normalizeTitleForDedup(n.title) === norm
      );
      if (!alreadyExists) {
        rawNodes.push({
          id: `missing-tmdb-${part.tmdbId || norm}`,
          tmdbId: part.tmdbId,
          title: part.title,
          originalTitle: part.originalTitle,
          releaseYear: part.releaseYear,
          workType: 'movie',
          entryKind: 'Filme Canônico',
          coverUrl: part.coverUrl,
        });
      }
    }
  }

  // Garante que a própria obra esteja na lista caso ainda não tenha entrado
  if (
    rawNodes.length === 0 ||
    !rawNodes.some(
      (n) =>
        n.id === sanitizedWork.id ||
        normalizeTitleForDedup(n.title) ===
          normalizeTitleForDedup(sanitizedWork.title)
    )
  ) {
    rawNodes.push({
      id: sanitizedWork.id,
      title: sanitizedWork.title,
      originalTitle: sanitizedWork.originalTitle || '',
      releaseYear: Number(sanitizedWork.releaseYear) || null,
      workType: sanitizedWork.workType || 'movie',
      animeFormat: sanitizedWork.animeFormat || '',
      entryKind: isMovie ? 'Filme Canônico' : 'Série Principal',
      item: sanitizedWork,
    });
  }

  const decorated = rawNodes
    .filter((node) => isAllowedUniverseRelation(node.relationSource || {}))
    .map((node) => {
      const dec = decorateCatalogStatus(node, catalog);
      return {
        ...dec,
        franchiseTier: inferFranchiseTier(dec.item || dec),
      };
    })
    .sort((a, b) => {
      const yA = Number(a.releaseYear) || 9999;
      const yB = Number(b.releaseYear) || 9999;
      if (yA !== yB) return yA - yB;
      return (a.orderWeight || 0) - (b.orderWeight || 0);
    });

  const totalCount = decorated.length;
  const completedCount = decorated.filter((n) => n.isCompleted).length;
  const completionPct =
    totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const scopeProgress = computeFranchiseScopeProgress(decorated, 'cinema');

  if (isMovie) {
    const noun = totalCount === 1 ? 'filme' : 'filmes';
    return {
      mode: 'movie-franchise',
      sectionTitle: 'Franquia & Sequências',
      sagaName:
        baseFranchise?.name ||
        sanitizedWork.belongsToCollection?.name?.replace(/\s*Collection$/i, '') ||
        sanitizedWork.franchiseName ||
        sanitizedWork.title,
      progressHeader: `${completedCount}/${totalCount} ${noun} · ${completionPct}% concluído`,
      completedCount,
      totalCount,
      completionPct,
      scopeProgress,
      entries: decorated,
      groups: null,
      baseFranchise,
    };
  }

  const mainSeries = [];
  const movies = [];
  const ovasSpecials = [];

  for (const node of decorated) {
    const grp = classifyUniverseGroup(node);
    if (grp === 'movies') movies.push(node);
    else if (grp === 'ovasSpecials') ovasSpecials.push(node);
    else mainSeries.push(node);
  }

  const makeGroupMeta = (id, label, list) => ({
    id,
    label,
    totalCount: list.length,
    completedCount: list.filter((n) => n.isCompleted).length,
    entries: list,
  });

  const groups = [
    makeGroupMeta('mainSeries', 'Série Principal', mainSeries),
    makeGroupMeta('movies', 'Filmes', movies),
    makeGroupMeta('ovasSpecials', 'OVAs / Especiais', ovasSpecials),
  ];

  const noun = totalCount === 1 ? 'obra' : 'obras';
  return {
    mode: 'series-universe',
    sectionTitle: 'Obras do Mesmo Universo',
    sagaName:
      baseFranchise?.name ||
      sanitizedWork.franchiseName ||
      sanitizedWork.title,
    progressHeader: `${completedCount}/${totalCount} ${noun} · ${completionPct}% do universo`,
    completedCount,
    totalCount,
    completionPct,
    scopeProgress,
    entries: decorated,
    groups,
    baseFranchise,
  };
}

/**
 * Modelo unificado de Franquia & Escopos para Cinema/Séries, Livros e Games (v2.4.0 Fase 4.2).
 */
export function buildUnifiedFranchiseModel(
  work,
  allCatalogItems = [],
  remoteCollectionParts = []
) {
  if (!work || typeof work !== 'object') return null;
  const domain = inferDomainFromWork(work);
  if (domain === 'reading' || domain === 'games') {
    return buildDomainFranchiseModel(work, allCatalogItems);
  }
  if (domain === 'cinema') {
    return buildDeterministicFranchiseOrUniverseModel(
      work,
      allCatalogItems,
      remoteCollectionParts
    );
  }
  return null;
}
