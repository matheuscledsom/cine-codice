import { inferDomainFromWork } from '../config/domainConfig.js';
import {
  UNCLASSIFIED_FRANCHISE_TIER,
  buildDomainFranchiseModel,
  computeFranchiseScopeProgress,
  inferFranchiseTier,
  normalizeFranchiseTier,
} from '../lib/franchiseTier.js';
import { isConfirmedUserRating } from '../lib/ratings.js';
import { fetchTmdbViaProxyOrDirect } from './apiProxyClient.js';
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
  {
    apiKey = '',
    fetchImpl = globalThis.fetch,
    signal,
    accessToken = '',
    supabaseClient = null,
    forceProxy = null,
    isDev = undefined,
  } = {}
) {
  const cleanId = Number(collectionId);
  if (!Number.isInteger(cleanId) || cleanId <= 0) return [];
  const key = String(apiKey || loadTmdbApiKey() || '').trim();
  if (typeof fetchImpl !== 'function') return [];

  try {
    const outcome = await fetchTmdbViaProxyOrDirect(
      `collection/${cleanId}`,
      { language: 'pt-BR' },
      {
        directApiKey: key,
        signal,
        fetchImpl,
        accessToken,
        supabaseClient,
        forceProxy,
        ...(isDev !== undefined ? { isDev } : {}),
      }
    );
    if (outcome.missingKey || !outcome.res || !outcome.res.ok) return [];
    const json = await outcome.res.json();
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

export async function searchTmdbCollections(
  query,
  {
    apiKey = '',
    fetchImpl = globalThis.fetch,
    signal,
    accessToken = '',
    supabaseClient = null,
    forceProxy = null,
    isDev = undefined,
  } = {}
) {
  const cleanQuery = String(query || '').trim();
  if (cleanQuery.length < 2 || typeof fetchImpl !== 'function') return [];
  const key = String(apiKey || loadTmdbApiKey() || '').trim();

  try {
    const outcome = await fetchTmdbViaProxyOrDirect(
      'search/collection',
      { query: cleanQuery, language: 'pt-BR' },
      {
        directApiKey: key,
        signal,
        fetchImpl,
        accessToken,
        supabaseClient,
        forceProxy,
        ...(isDev !== undefined ? { isDev } : {}),
      }
    );
    if (outcome.missingKey || !outcome.res || !outcome.res.ok) return [];
    const json = await outcome.res.json();
    return (Array.isArray(json?.results) ? json.results : [])
      .map((col) => ({
        id: Number(col.id) || null,
        name: String(col.name || '').trim(),
        overview: String(col.overview || '').trim(),
        posterUrl: col.poster_path
          ? `https://image.tmdb.org/t/p/w342${col.poster_path}`
          : null,
      }))
      .filter((c) => c.id && c.name);
  } catch {
    return [];
  }
}

export async function fetchTmdbKeywordDetail(
  keywordId,
  {
    apiKey = '',
    fetchImpl = globalThis.fetch,
    signal,
    accessToken = '',
    supabaseClient = null,
    forceProxy = null,
    isDev = undefined,
  } = {}
) {
  const cleanId = Number(keywordId);
  if (!Number.isInteger(cleanId) || cleanId <= 0 || typeof fetchImpl !== 'function') {
    return null;
  }
  const key = String(apiKey || loadTmdbApiKey() || '').trim();
  try {
    const outcome = await fetchTmdbViaProxyOrDirect(
      `keyword/${cleanId}`,
      {},
      {
        directApiKey: key,
        signal,
        fetchImpl,
        accessToken,
        supabaseClient,
        forceProxy,
        ...(isDev !== undefined ? { isDev } : {}),
      }
    );
    if (outcome.missingKey || !outcome.res || !outcome.res.ok) return null;
    const json = await outcome.res.json();
    const id = Number(json?.id) || cleanId;
    const name = String(json?.name || '').trim();
    return name ? { id, name } : null;
  } catch {
    return null;
  }
}

const UNIVERSE_KEYWORD_HINT_RE =
  /\b(cinematic\s+universe|shared\s+universe|marvel\s+cinematic|dc\s+extended|dc\s+universe|monsterverse|conjuring|star\s+wars|wizarding\s+world|middle[- ]?earth|alien\s+franchise|predator|jurassic|fast\s+and\s+furious|x-men|spider-verse|dune)\b/i;

export function isLikelySharedUniverseKeyword(name = '') {
  return UNIVERSE_KEYWORD_HINT_RE.test(String(name || '').trim());
}

export async function fetchTmdbWorkKeywords(
  work = {},
  {
    apiKey = '',
    fetchImpl = globalThis.fetch,
    signal,
    accessToken = '',
    supabaseClient = null,
    forceProxy = null,
    isDev = undefined,
  } = {}
) {
  const tmdbId = Number(work?.tmdbId || work?.ids?.tmdb);
  if (!Number.isInteger(tmdbId) || tmdbId <= 0 || typeof fetchImpl !== 'function') {
    return [];
  }
  const key = String(apiKey || loadTmdbApiKey() || '').trim();
  const isMovie = work?.workType === 'movie';
  const endpoint = isMovie ? `movie/${tmdbId}/keywords` : `tv/${tmdbId}/keywords`;

  try {
    const outcome = await fetchTmdbViaProxyOrDirect(
      endpoint,
      {},
      {
        directApiKey: key,
        signal,
        fetchImpl,
        accessToken,
        supabaseClient,
        forceProxy,
        ...(isDev !== undefined ? { isDev } : {}),
      }
    );
    if (outcome.missingKey || !outcome.res || !outcome.res.ok) return [];
    const json = await outcome.res.json();
    const rawList = Array.isArray(json?.keywords)
      ? json.keywords
      : Array.isArray(json?.results)
        ? json.results
        : [];
    return rawList
      .map((kw) => ({
        id: Number(kw.id) || null,
        name: String(kw.name || '').trim(),
        isUniverseHint: isLikelySharedUniverseKeyword(kw.name),
      }))
      .filter((kw) => kw.id && kw.name)
      .sort((a, b) => Number(b.isUniverseHint) - Number(a.isUniverseHint));
  } catch {
    return [];
  }
}

/**
 * Busca SUGESTÕES de universo compartilhado (ex.: UCM e similares) via TMDB
 * `discover/movie` e `discover/tv` filtrados por `with_keywords`.
 *
 * Regra v2.5.0:
 * - Nunca classifica automaticamente em `mainline` ou `spinoff`.
 * - Toda sugestão chega com `franchiseTier: 'unclassified'` ("Não classificado")
 *   e `tierConfirmedByUser: false` para confirmação explícita do usuário.
 */
export async function fetchTmdbUniverseSuggestionsByKeyword(
  keywordId,
  {
    keywordName = '',
    mediaTypes = ['movie', 'tv'],
    apiKey = '',
    fetchImpl = globalThis.fetch,
    signal,
    accessToken = '',
    supabaseClient = null,
    forceProxy = null,
    isDev = undefined,
    limit = 30,
  } = {}
) {
  const cleanId = Number(keywordId);
  if (!Number.isInteger(cleanId) || cleanId <= 0 || typeof fetchImpl !== 'function') {
    return { keyword: null, suggestions: [] };
  }
  const key = String(apiKey || loadTmdbApiKey() || '').trim();
  const proxyOpts = {
    directApiKey: key,
    signal,
    fetchImpl,
    accessToken,
    supabaseClient,
    forceProxy,
    ...(isDev !== undefined ? { isDev } : {}),
  };

  let resolvedName = String(keywordName || '').trim();
  if (!resolvedName) {
    const kwDetail = await fetchTmdbKeywordDetail(cleanId, proxyOpts);
    resolvedName = kwDetail?.name || `Keyword #${cleanId}`;
  }

  const wanted = Array.isArray(mediaTypes) && mediaTypes.length > 0 ? mediaTypes : ['movie', 'tv'];
  const collected = [];
  const seen = new Set();

  const tasks = [];
  if (wanted.includes('movie')) {
    tasks.push(
      fetchTmdbViaProxyOrDirect(
        'discover/movie',
        {
          with_keywords: String(cleanId),
          language: 'pt-BR',
          sort_by: 'release_date.asc',
          page: 1,
        },
        proxyOpts
      )
        .then(async (out) => {
          if (out.missingKey || !out.res || !out.res.ok) return [];
          const json = await out.res.json();
          return (Array.isArray(json?.results) ? json.results : []).map((m) => ({
            raw: m,
            workType: 'movie',
          }));
        })
        .catch(() => [])
    );
  }
  if (wanted.includes('tv')) {
    tasks.push(
      fetchTmdbViaProxyOrDirect(
        'discover/tv',
        {
          with_keywords: String(cleanId),
          language: 'pt-BR',
          sort_by: 'first_air_date.asc',
          page: 1,
        },
        proxyOpts
      )
        .then(async (out) => {
          if (out.missingKey || !out.res || !out.res.ok) return [];
          const json = await out.res.json();
          return (Array.isArray(json?.results) ? json.results : []).map((t) => ({
            raw: t,
            workType: 'series',
          }));
        })
        .catch(() => [])
    );
  }

  const chunks = await Promise.all(tasks);
  for (const list of chunks) {
    for (const { raw, workType } of list) {
      const tmdbId = Number(raw?.id) || null;
      const title = String(
        raw?.title || raw?.name || raw?.original_title || raw?.original_name || ''
      ).trim();
      if (!tmdbId || !title) continue;
      const dedupKey = `${workType}:${tmdbId}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      const dateStr = raw?.release_date || raw?.first_air_date || '';
      const yearMatch = String(dateStr).match(/^(\d{4})/);
      collected.push({
        id: `universe-suggestion-${workType}-${tmdbId}`,
        tmdbId,
        domain: 'cinema',
        workType,
        title,
        originalTitle: String(raw?.original_title || raw?.original_name || '').trim(),
        releaseYear: yearMatch ? Number(yearMatch[1]) : null,
        coverUrl: raw?.poster_path
          ? `https://image.tmdb.org/t/p/w500${raw.poster_path}`
          : null,
        backdropUrl: raw?.backdrop_path
          ? `https://image.tmdb.org/t/p/w1280${raw.backdrop_path}`
          : null,
        synopsis: String(raw?.overview || '').trim(),
        isUniverseSuggestion: true,
        sourceKind: 'tmdb_keyword_discover',
        sourceLabel: `Sugestão TMDB · ${resolvedName}`,
        suggestedKeywordId: cleanId,
        suggestedKeywordName: resolvedName,
        franchiseTier: UNCLASSIFIED_FRANCHISE_TIER,
        tierConfirmedByUser: false,
      });
    }
  }

  collected.sort((a, b) => (a.releaseYear || 9999) - (b.releaseYear || 9999));

  return {
    keyword: { id: cleanId, name: resolvedName },
    suggestions: collected.slice(0, Math.max(1, Number(limit) || 30)),
  };
}

/**
 * Cruza sugestões TMDB (keyword/discover) com o catálogo local mantendo
 * `unclassified` ("Não classificado") para tudo que o usuário ainda não confirmou.
 */
export function buildUniverseSuggestionsModel(suggestions = [], allCatalogItems = []) {
  const catalog = (Array.isArray(allCatalogItems) ? allCatalogItems : []).filter(Boolean);
  return (Array.isArray(suggestions) ? suggestions : []).map((sug) => {
    const dec = decorateCatalogStatus(sug, catalog);
    const explicitUserTier = dec.item
      ? normalizeFranchiseTier(
          dec.item.franchiseTier ?? dec.item.progress_data?.franchiseTier
        )
      : '';
    const confirmedTier =
      explicitUserTier && explicitUserTier !== UNCLASSIFIED_FRANCHISE_TIER
        ? explicitUserTier
        : UNCLASSIFIED_FRANCHISE_TIER;
    return {
      ...dec,
      isUniverseSuggestion: true,
      sourceKind: 'tmdb_keyword_discover',
      franchiseTier: confirmedTier,
      tierConfirmedByUser: confirmedTier !== UNCLASSIFIED_FRANCHISE_TIER,
    };
  });
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
  remoteCollectionParts = [],
  options = null
) {
  if (!work || typeof work !== 'object') return null;
  const domain = inferDomainFromWork(work);
  if (domain === 'reading' || domain === 'games') {
    return options
      ? buildDomainFranchiseModel(work, allCatalogItems, options)
      : buildDomainFranchiseModel(work, allCatalogItems);
  }
  if (domain === 'cinema') {
    const base = buildDeterministicFranchiseOrUniverseModel(
      work,
      allCatalogItems,
      remoteCollectionParts
    );
    if (!base || !options) return base;
    const hasCollectionOrRelations = Boolean(
      (Array.isArray(remoteCollectionParts) && remoteCollectionParts.length > 0) ||
        (Array.isArray(work.franchiseRelations) && work.franchiseRelations.length > 0) ||
        options.sourceIsComplete
    );
    const hasManualTotal = Boolean(
      Number(options.manualMeta?.mainSeriesTotal) > 0 ||
        Number(options.manualMeta?.universeTotal) > 0
    );
    const scopeProgress = computeFranchiseScopeProgress(base.entries, 'cinema', {
      mainSeriesTotal: options.manualMeta?.mainSeriesTotal ?? null,
      universeTotal: options.manualMeta?.universeTotal ?? null,
      hasKnownTotal: hasCollectionOrRelations || hasManualTotal,
      totalSource: hasManualTotal
        ? 'Definido por você'
        : Array.isArray(remoteCollectionParts) && remoteCollectionParts.length > 0
          ? 'TMDB'
          : options.sourceLabel || null,
    });
    return {
      ...base,
      scopeProgress,
      hasKnownTotal: scopeProgress.hasKnownTotal,
      sourceLabel: hasManualTotal
        ? 'Definido por você'
        : Array.isArray(remoteCollectionParts) && remoteCollectionParts.length > 0
          ? 'TMDB'
          : options.sourceLabel || null,
      progressHeader: scopeProgress.mainline.isOpenEnded
        ? scopeProgress.mainline.displayLabel
        : `${scopeProgress.mainline.displayLabel}${
            !scopeProgress.universe.isOpenEnded ? ` · ${scopeProgress.universe.displayLabel}` : ''
          }`,
    };
  }
  return null;
}
