/**
 *Helpers para obras cadastradas manualmente e vinculação reversível a fontes externas
 * (OMNIPRISM v2.6.0 — Fase 2).
 */

import { inferDomainFromWork, normalizeGameEditionType } from '../config/domainConfig.js';

export function isManualWork(work = null) {
  if (!work || typeof work !== 'object') return false;
  return work.ids?.source === 'manual' || work.isManual === true;
}

export function buildManualExternalIds(manualUuid, { isbn = '' } = {}) {
  const cleanId = String(manualUuid || '').trim();
  const cleanIsbn = String(isbn || '').trim();
  return {
    source: 'manual',
    ...(cleanId ? { id: cleanId } : {}),
    ...(cleanIsbn ? { isbn: cleanIsbn } : {}),
  };
}

/**
 * Mescla uma obra manual com um candidato vindo das APIs sem perder
 * nota, critérios, progresso, diário ou capa manual enviada pelo usuário.
 * Retorna `{ updatedWork, undoSnapshot }` para permitir desfazer completo.
 */
export function mergeManualWorkWithApiCandidate(manualWork = {}, apiCandidate = {}) {
  if (!manualWork || typeof manualWork !== 'object' || !apiCandidate || typeof apiCandidate !== 'object') {
    return null;
  }

  const nowIso = new Date().toISOString();
  const domain = inferDomainFromWork(manualWork);

  const undoSnapshot = {
    ids: manualWork.ids ? { ...manualWork.ids } : {},
    isManual: manualWork.isManual !== false,
    title: manualWork.title || '',
    originalTitle: manualWork.originalTitle || '',
    creator: manualWork.creator || '',
    director: manualWork.director || '',
    author: manualWork.author || '',
    studio: manualWork.studio || '',
    releaseYear: manualWork.releaseYear ?? null,
    coverUrl: manualWork.coverUrl || null,
    coverSources: Array.isArray(manualWork.coverSources) ? [...manualWork.coverSources] : [],
    backdropUrl: manualWork.backdropUrl || null,
    synopsis: manualWork.synopsis || '',
    overview: manualWork.overview || '',
    genres: Array.isArray(manualWork.genres) ? [...manualWork.genres] : [],
    totalPages: manualWork.totalPages ?? null,
    isbnOrDoi: manualWork.isbnOrDoi || '',
    platforms: Array.isArray(manualWork.platforms) ? [...manualWork.platforms] : [],
    originalPlatforms: Array.isArray(manualWork.originalPlatforms)
      ? [...manualWork.originalPlatforms]
      : [],
    editionType: manualWork.editionType || '',
    franchiseName: manualWork.franchiseName || '',
    totalSeasons: manualWork.totalSeasons ?? 1,
    totalEpisodes: manualWork.totalEpisodes ?? null,
    episodesPerSeason: Array.isArray(manualWork.episodesPerSeason)
      ? [...manualWork.episodesPerSeason]
      : [],
    durationMinutes: manualWork.durationMinutes ?? null,
    totalSeconds: manualWork.totalSeconds ?? null,
    igdbId: manualWork.igdbId ?? null,
    rawgId: manualWork.rawgId ?? null,
    campaignTimeHours: manualWork.campaignTimeHours ?? null,
    campaignTimeSource: manualWork.campaignTimeSource ?? null,
    completion100Hours: manualWork.completion100Hours ?? null,
    completion100Source: manualWork.completion100Source ?? null,
    tmdbId: manualWork.tmdbId ?? null,
    imdbId: manualWork.imdbId || '',
    anilistId: manualWork.anilistId ?? null,
    malId: manualWork.malId ?? null,
    tvmazeId: manualWork.tvmazeId ?? null,
    externalRatings: manualWork.externalRatings ?? null,
    sourceBadge: manualWork.sourceBadge || '',
    mergedSources: Array.isArray(manualWork.mergedSources) ? [...manualWork.mergedSources] : [],
    updatedAt: manualWork.updatedAt || nowIso,
  };

  const candIds =
    apiCandidate.ids && typeof apiCandidate.ids === 'object' ? { ...apiCandidate.ids } : {};
  delete candIds.source;

  const prevIds = manualWork.ids && typeof manualWork.ids === 'object' ? { ...manualWork.ids } : {};
  const previousManualId = prevIds.source === 'manual' ? prevIds.id || manualWork.id : null;
  delete prevIds.source;
  delete prevIds.id;

  const nextIds = {
    ...prevIds,
    ...candIds,
    ...(apiCandidate.tmdbId ? { tmdb: apiCandidate.tmdbId } : {}),
    ...(apiCandidate.imdbId ? { imdb: apiCandidate.imdbId } : {}),
    ...(apiCandidate.anilistId ? { anilist: apiCandidate.anilistId } : {}),
    ...(apiCandidate.malId ? { mal: apiCandidate.malId } : {}),
    ...(apiCandidate.tvmazeId ? { tvmaze: apiCandidate.tvmazeId } : {}),
    ...(apiCandidate.igdbId ? { igdb: apiCandidate.igdbId } : {}),
    ...(apiCandidate.rawgId ? { rawg: apiCandidate.rawgId } : {}),
    ...(apiCandidate.isbnOrDoi && !candIds.isbn ? { isbn: apiCandidate.isbnOrDoi } : {}),
    ...(previousManualId ? { linkedFromManualId: previousManualId } : {}),
  };

  const hasLocalUploadedCover = Boolean(manualWork.manualCoverDataUrl);
  const resolvedCover = hasLocalUploadedCover
    ? manualWork.manualCoverDataUrl
    : manualWork.coverUrl || apiCandidate.coverUrl || null;
  const resolvedCoverSources = Array.from(
    new Set([
      ...(hasLocalUploadedCover ? [manualWork.manualCoverDataUrl] : []),
      ...(Array.isArray(manualWork.coverSources) ? manualWork.coverSources : []),
      ...(Array.isArray(apiCandidate.coverSources) ? apiCandidate.coverSources : []),
      ...(apiCandidate.coverUrl ? [apiCandidate.coverUrl] : []),
    ].filter(Boolean))
  );

  const resolvedSynopsis =
    String(manualWork.synopsis || '').trim() ||
    String(apiCandidate.synopsis || apiCandidate.overview || '').trim();

  const resolvedCreator =
    String(manualWork.creator || manualWork.author || manualWork.director || '').trim() ||
    String(apiCandidate.creator || apiCandidate.author || apiCandidate.director || '').trim();

  const mergedPlatforms =
    domain === 'games'
      ? Array.from(
          new Set([
            ...(Array.isArray(manualWork.platforms) ? manualWork.platforms : []),
            ...(Array.isArray(apiCandidate.platforms) ? apiCandidate.platforms : []),
          ].filter(Boolean))
        )
      : manualWork.platforms || [];

  const updatedWork = {
    ...manualWork,
    isManual: false,
    ids: nextIds,
    originalTitle: manualWork.originalTitle || apiCandidate.originalTitle || '',
    creator: resolvedCreator,
    director: domain === 'reading' ? resolvedCreator : manualWork.director || resolvedCreator,
    author: domain === 'reading' ? resolvedCreator : manualWork.author || resolvedCreator,
    studio: manualWork.studio || apiCandidate.studio || apiCandidate.publisher || '',
    releaseYear: manualWork.releaseYear || apiCandidate.releaseYear || null,
    coverUrl: resolvedCover,
    coverSources: resolvedCoverSources,
    backdropUrl: manualWork.backdropUrl || apiCandidate.backdropUrl || null,
    synopsis: resolvedSynopsis,
    overview: resolvedSynopsis,
    genres:
      Array.isArray(manualWork.genres) && manualWork.genres.length > 0
        ? manualWork.genres
        : Array.isArray(apiCandidate.genres)
          ? apiCandidate.genres
          : [],
    totalPages: manualWork.totalPages || apiCandidate.totalPages || null,
    isbnOrDoi: manualWork.isbnOrDoi || apiCandidate.isbnOrDoi || '',
    platforms: mergedPlatforms,
    originalPlatforms:
      Array.isArray(manualWork.originalPlatforms) && manualWork.originalPlatforms.length > 0
        ? manualWork.originalPlatforms
        : Array.isArray(apiCandidate.originalPlatforms)
          ? apiCandidate.originalPlatforms
          : [],
    editionType:
      domain === 'games'
        ? manualWork.editionType && manualWork.editionType !== 'Jogo'
          ? manualWork.editionType
          : normalizeGameEditionType(apiCandidate.editionType)
        : manualWork.editionType,
    franchiseName: manualWork.franchiseName || apiCandidate.franchiseName || '',
    totalSeasons: manualWork.totalSeasons || apiCandidate.totalSeasons || 1,
    totalEpisodes: manualWork.totalEpisodes || apiCandidate.totalEpisodes || null,
    episodesPerSeason:
      Array.isArray(manualWork.episodesPerSeason) && manualWork.episodesPerSeason.length > 0
        ? manualWork.episodesPerSeason
        : Array.isArray(apiCandidate.episodesPerSeason)
          ? apiCandidate.episodesPerSeason
          : [],
    durationMinutes: manualWork.durationMinutes || apiCandidate.durationMinutes || null,
    totalSeconds: manualWork.totalSeconds || apiCandidate.totalSeconds || null,
    igdbId: manualWork.igdbId || apiCandidate.igdbId || nextIds.igdb || null,
    rawgId: manualWork.rawgId || apiCandidate.rawgId || nextIds.rawg || null,
    campaignTimeHours: manualWork.campaignTimeHours || apiCandidate.campaignTimeHours || null,
    campaignTimeSource: manualWork.campaignTimeSource || apiCandidate.campaignTimeSource || null,
    completion100Hours: manualWork.completion100Hours || apiCandidate.completion100Hours || null,
    completion100Source: manualWork.completion100Source || apiCandidate.completion100Source || null,
    tmdbId: manualWork.tmdbId || apiCandidate.tmdbId || nextIds.tmdb || null,
    imdbId: manualWork.imdbId || apiCandidate.imdbId || nextIds.imdb || '',
    anilistId: manualWork.anilistId || apiCandidate.anilistId || nextIds.anilist || null,
    malId: manualWork.malId || apiCandidate.malId || nextIds.mal || null,
    tvmazeId: manualWork.tvmazeId || apiCandidate.tvmazeId || nextIds.tvmaze || null,
    externalRatings: manualWork.externalRatings || apiCandidate.externalRatings || null,
    sourceBadge: apiCandidate.sourceBadge || manualWork.sourceBadge || '',
    mergedSources: Array.from(
      new Set([
        ...(Array.isArray(manualWork.mergedSources) ? manualWork.mergedSources : []),
        ...(Array.isArray(apiCandidate.mergedSources) ? apiCandidate.mergedSources : []),
        apiCandidate.sourceBadge,
      ].filter(Boolean))
    ),
    updatedAt: nowIso,
  };

  return {
    updatedWork,
    undoSnapshot,
  };
}
