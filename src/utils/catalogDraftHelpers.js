import {
  GAME_PLATFORM_UNSET_LABEL,
  inferDomainFromWork,
  normalizeCinemaStatus,
  normalizeDomainId,
  normalizeGameEditionType,
} from '../config/domainConfig.js';
import {
  advanceEpisodeProgress,
  advanceMovieSeconds,
  calculateSmartRating,
  calculateWorkProgress,
  getTodayLocalISO,
  getVerdictForScore,
  isEpisodicWork,
} from './backlogHelpers.js';

/**
 * Campos enxutos da folha rápida v2.4.0 (Fase 4.1):
 * - Nenhuma opção pré-selecionada quando status está vazio.
 * - Fila ("Quero...") não pergunta nada.
 * - Games em andamento pergunta "Onde você está jogando?" (plataformas da API + outra).
 * - Leitura ("Lendo") pergunta página atual.
 * - Concluído/Lido/Zerado/Ouvido exibe seletor 5 estrelas + botão discreto "Avaliar por 5 critérios".
 * - Formato, dublagem, edição e tipo de conclusão ficam recolhidos na ficha completa.
 */
export function getQuickSheetLeanFields(domain = 'cinema', status = '') {
  const cleanDomain = normalizeDomainId(domain);
  const rawStatus = String(status || '').trim();
  if (!rawStatus) {
    return {
      statusSelected: false,
      askGamePlatform: false,
      askGameEdition: false,
      askGameCompletionType: false,
      askCurrentPage: false,
      askStarRating: false,
      showConfirmFullPages: false,
    };
  }
  const cleanStatus = normalizeCinemaStatus(rawStatus);
  const isInProgress = cleanStatus === 'playing' || cleanStatus === 'rewatching';
  const isCompleted = cleanStatus === 'completed';

  return {
    statusSelected: true,
    askGamePlatform: cleanDomain === 'games' && isInProgress,
    askGameEdition: cleanDomain === 'games' && isInProgress,
    askGameCompletionType: cleanDomain === 'games' && isCompleted,
    askCurrentPage: cleanDomain === 'reading' && isInProgress,
    askStarRating: isCompleted,
    showConfirmFullPages: cleanDomain === 'reading' && isCompleted,
  };
}

const DUPLICATE_EXTERNAL_ID_KEYS = [
  'igdb',
  'rawg',
  'steam',
  'wikidata',
  'tmdb',
  'imdb',
  'anilist',
  'mal',
  'tvmaze',
  'openlibrary',
  'googleBooks',
  'isbn',
  'doi',
  'itunes',
  'itunesTrack',
  'musicbrainz',
  'musicbrainzRecording',
];

function normalizeDupTitle(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function collectExternalIdsForDup(work = {}) {
  const ids = work.ids && typeof work.ids === 'object' ? work.ids : {};
  const map = {};
  for (const key of DUPLICATE_EXTERNAL_ID_KEYS) {
    const val =
      ids[key] ??
      (key === 'tmdb'
        ? work.tmdbId
        : key === 'imdb'
          ? work.imdbId
          : key === 'anilist'
            ? work.anilistId
            : key === 'mal'
              ? work.malId
              : key === 'tvmaze'
                ? work.tvmazeId
                : key === 'isbn'
                  ? work.isbn || work.isbnOrDoi
                  : key === 'doi'
                    ? work.doi
                    : null);
    if (val !== null && val !== undefined && String(val).trim() !== '') {
      map[key] = String(val).trim().toLowerCase();
    }
  }
  if (ids.source === 'manual' && ids.id) {
    map.manual = String(ids.id).trim().toLowerCase();
  }
  return map;
}

/**
 * Detecta duplicata no catálogo por `external_ids` OU por `título + ano` (Fase 4.1).
 */
export function findCatalogDuplicate(candidate = {}, existingItems = []) {
  if (!candidate || typeof candidate !== 'object') return null;
  const list = (Array.isArray(existingItems) ? existingItems : []).filter(
    (item) => item && item.inBacklog !== false
  );
  if (list.length === 0) return null;

  const candDomain = inferDomainFromWork(candidate);
  const candIds = collectExternalIdsForDup(candidate);

  // 1. Verifica correspondência exata por external_ids (mesmo domínio)
  for (const item of list) {
    if (inferDomainFromWork(item) !== candDomain) continue;
    const itemIds = collectExternalIdsForDup(item);
    for (const [key, val] of Object.entries(candIds)) {
      if (itemIds[key] && itemIds[key] === val) {
        // Em Música, não confunde faixa com álbum usando apenas collectionId
        if (
          candDomain === 'music' &&
          key === 'itunes' &&
          candidate.workType !== item.workType
        ) {
          continue;
        }
        return {
          match: item,
          reason: 'external_id',
          matchedKey: key,
          label: `Já catalogado (ID ${key.toUpperCase()})`,
        };
      }
    }
  }

  // 2. Verifica correspondência por título normalizado + ano
  const candTitle = normalizeDupTitle(candidate.title);
  if (!candTitle) return null;
  const candYear = Number(candidate.releaseYear) || null;
  const candCreator = normalizeDupTitle(
    candidate.creator || candidate.author || candidate.director || candidate.studio || ''
  );
  const candEdition = normalizeGameEditionType(candidate.editionType).toLowerCase();

  for (const item of list) {
    if (inferDomainFromWork(item) !== candDomain) continue;
    const itemTitle = normalizeDupTitle(item.title);
    if (!itemTitle || itemTitle !== candTitle) continue;

    if (candDomain === 'music' && candidate.workType && item.workType && candidate.workType !== item.workType) {
      continue;
    }

    const itemYear = Number(item.releaseYear) || null;
    const itemCreator = normalizeDupTitle(
      item.creator || item.author || item.director || item.studio || ''
    );
    const sameCreator = Boolean(
      candCreator &&
        itemCreator &&
        (candCreator === itemCreator ||
          candCreator.includes(itemCreator) ||
          itemCreator.includes(candCreator))
    );

    if (candDomain === 'games') {
      const itemEdition = normalizeGameEditionType(item.editionType).toLowerCase();
      if (candEdition !== itemEdition) continue;
      if (candYear && itemYear && Math.abs(candYear - itemYear) >= 3 && !sameCreator) continue;
    } else if (candYear && itemYear && candYear !== itemYear) {
      if (!(candDomain === 'reading' && sameCreator)) {
        continue;
      }
    }

    return {
      match: item,
      reason: 'title_year',
      matchedKey: candYear ? `${candTitle}:${candYear}` : candTitle,
      label: candYear
        ? `Já catalogado (${candidate.title}, ${candYear})`
        : `Já catalogado (${candidate.title})`,
    };
  }

  return null;
}

/**
 * Retorna os campos condicionais visíveis na folha rápida de catalogação
 * de acordo com o domínio e o status selecionado.
 */
export function getQuickCatalogConditionalFields(domain = 'cinema', status = 'queued') {
  const cleanDomain = normalizeDomainId(domain);
  const cleanStatus = normalizeCinemaStatus(status);

  if (cleanDomain === 'reading') {
    return {
      showBookFormat: true,
      showPlatform: false,
      showEditionType: false,
      showCinemaFormats: false,
      showCurrentPage: cleanStatus === 'playing' || cleanStatus === 'rewatching',
      showHours: false,
      showCompletionType: false,
      showRating: cleanStatus === 'completed',
      showCompletedDate: cleanStatus === 'completed',
      showConfirmFullPages: cleanStatus === 'completed',
    };
  }

  if (cleanDomain === 'games') {
    return {
      showBookFormat: false,
      showPlatform: true,
      showEditionType: true,
      showCinemaFormats: false,
      showCurrentPage: false,
      showHours: cleanStatus === 'playing' || cleanStatus === 'rewatching',
      showCompletionType: cleanStatus === 'completed',
      showRating: cleanStatus === 'completed',
      showCompletedDate: false,
      showConfirmFullPages: false,
    };
  }

  if (cleanDomain === 'music') {
    return {
      showBookFormat: false,
      showPlatform: false,
      showEditionType: false,
      showCinemaFormats: false,
      showCurrentPage: false,
      showHours: false,
      showCompletionType: false,
      showRating: cleanStatus === 'completed' || cleanStatus === 'playing' || cleanStatus === 'rewatching',
      showCompletedDate: cleanStatus === 'completed',
      showConfirmFullPages: false,
    };
  }

  return {
    showBookFormat: false,
    showPlatform: false,
    showEditionType: false,
    showCinemaFormats: true,
    showCurrentPage: false,
    showHours: false,
    showCompletionType: false,
    showRating: cleanStatus === 'completed',
    showCompletedDate: cleanStatus === 'completed',
    showConfirmFullPages: false,
  };
}

/**
 * Atualiza um rascunho de catalogação ao trocar o status.
 * Regra estrita (v2.3.0): NUNCA preenche automaticamente `pagesRead = totalPages`
 * só porque o status é 'completed' (Lido), a menos que `confirmFillTotalPages` seja true.
 */
export function buildQuickCatalogDraftWithStatus(
  baseDraft,
  nextStatus,
  { confirmFillTotalPages = false } = {}
) {
  const today = getTodayLocalISO();
  const cleanStatus = normalizeCinemaStatus(nextStatus);
  const updated = { ...baseDraft, status: cleanStatus };
  const domain = inferDomainFromWork(updated);

  if (cleanStatus === 'playing' || cleanStatus === 'rewatching') {
    updated.startDate = updated.startDate || today;
    updated.progress = calculateWorkProgress(updated);
  }

  if (cleanStatus === 'completed') {
    updated.completedDate = updated.completedDate || today;
    updated.startDate = updated.startDate || updated.completedDate;
    updated.progress = 100;

    if (domain === 'reading') {
      if (confirmFillTotalPages && Number(updated.totalPages) > 0) {
        updated.pagesRead = Number(updated.totalPages);
      }
      // Caso contrário, preserva pagesRead exatamente como o usuário deixou!
    } else if (isEpisodicWork(updated)) {
      if (Number(updated.totalEpisodes) > 0) {
        updated.currentEpisode = Number(updated.totalEpisodes);
      }
      if (Number(updated.totalSeasons) > 0) {
        updated.currentSeason = Number(updated.totalSeasons);
      }
    } else if (
      domain === 'cinema' &&
      (Number(updated.totalSeconds) > 0 || Number(updated.durationMinutes) > 0)
    ) {
      const totalSec =
        Number(updated.totalSeconds) || Number(updated.durationMinutes) * 60;
      updated.totalSeconds = totalSec;
      updated.currentSeconds = totalSec;
    }

    if (updated.reviewCriteria) {
      updated.rating = calculateSmartRating(updated.reviewCriteria);
      updated.verdict = getVerdictForScore(updated.rating);
      updated.ratingSource = updated.ratingSource || 'manual';
    } else if (typeof updated.rating === 'number' && !Number.isNaN(updated.rating)) {
      updated.verdict = updated.verdict || getVerdictForScore(updated.rating);
      updated.ratingSource = updated.ratingSource || 'manual';
    } else {
      updated.rating = null;
      updated.verdict = null;
      updated.ratingSource = null;
    }
  }

  if (cleanStatus === 'queued') {
    updated.progress = 0;
  }

  return updated;
}

export function normalizeTrackRatingsMap(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const cleanKey = String(k || '').trim();
    if (!cleanKey || v === null || v === undefined || v === '') continue;
    const num = Number(v);
    if (Number.isFinite(num) && num >= 0 && num <= 10) {
      out[cleanKey] = Math.round(num * 10) / 10;
    }
  }
  return out;
}

export function makeAlbumTrackKey(track, index = 0) {
  if (track && typeof track === 'object') {
    const num = track.number || index + 1;
    const title = String(track.title || '').trim();
    return `${num}:${title}`;
  }
  return `${index + 1}:${String(track || '').trim()}`;
}

/**
 * Calcula patch + snapshot de Desfazer para interações rápidas de todos os 4 domínios:
 * - cinema_ep (+1 Ep), cinema_min (+20 min)
 * - reading_pages (+10 págs), reading_chapter (+1 cap)
 * - games_30m (+30 min / +0.5h), games_1h (+1 h)
 * - music_listen (+1 audição)
 */
export function computeDomainQuickActionPatch(
  work,
  actionType = 'default',
  { allowCompletion = true } = {}
) {
  if (!work || typeof work !== 'object') return null;
  const domain = inferDomainFromWork(work);
  const today = getTodayLocalISO();
  const nowIso = new Date().toISOString();

  const undoSnapshot = {
    status: work.status,
    startDate: work.startDate || null,
    completedDate: work.completedDate || null,
    progress: work.progress ?? 0,
    pagesRead: Number(work.pagesRead) || 0,
    chaptersRead: Number(work.chaptersRead) || 0,
    hoursPlayed: Number(work.hoursPlayed) || 0,
    listenCount: Number(work.listenCount) || 0,
    currentSeason: work.currentSeason ?? 1,
    currentEpisode: work.currentEpisode ?? 0,
    watchedEpisodes: work.watchedEpisodes || {},
    currentSeconds: work.currentSeconds ?? 0,
    totalSeconds: work.totalSeconds ?? null,
    updatedAt: work.updatedAt || work.createdAt || null,
  };

  if (domain === 'reading') {
    if (actionType === 'reading_chapter') {
      const nextChapters = Math.max(0, Number(work.chaptersRead) || 0) + 1;
      const patch = {
        chaptersRead: nextChapters,
        status: work.status === 'queued' ? 'playing' : work.status,
        startDate: work.startDate || today,
        updatedAt: nowIso,
      };
      return {
        patch,
        undoSnapshot,
        sound: 'page',
        toastMessage: `${work.title}: +1 cap (Cap. ${nextChapters})`,
      };
    }

    const total = Number(work.totalPages) || 0;
    const prevPages = Math.max(0, Number(work.pagesRead) || 0);
    const nextPages = total > 0 ? Math.min(total, prevPages + 10) : prevPages + 10;
    const done = allowCompletion && total > 0 && nextPages >= total;
    const patch = {
      pagesRead: nextPages,
      status: done ? 'completed' : work.status === 'queued' ? 'playing' : work.status,
      startDate: work.startDate || today,
      ...(done ? { completedDate: today, progress: 100 } : {}),
      updatedAt: nowIso,
    };
    return {
      patch,
      undoSnapshot,
      sound: done ? 'complete' : 'page',
      toastMessage:
        total > 0
          ? `${work.title}: +10 págs (${nextPages}/${total})`
          : `${work.title}: +10 págs (Pág. ${nextPages})`,
    };
  }

  if (domain === 'games') {
    const deltaHours = actionType === 'games_30m' ? 0.5 : 1;
    const prevHours = Math.max(0, Number(work.hoursPlayed) || 0);
    const nextHours = Number((prevHours + deltaHours).toFixed(1));
    const deltaLabel = deltaHours === 0.5 ? '+30 min' : '+1 h';
    const platHint = work.platform ? ` · ${work.platform}` : '';
    const patch = {
      hoursPlayed: nextHours,
      status: work.status === 'queued' ? 'playing' : work.status,
      startDate: work.startDate || today,
      updatedAt: nowIso,
    };
    return {
      patch,
      undoSnapshot,
      sound: 'page',
      toastMessage: `${work.title}: ${deltaLabel} (${nextHours}h${platHint || ` · ${GAME_PLATFORM_UNSET_LABEL}`})`,
    };
  }

  if (domain === 'music') {
    const nextListens = Math.max(0, Number(work.listenCount) || 0) + 1;
    const patch = {
      listenCount: nextListens,
      status: work.status === 'queued' ? 'playing' : work.status,
      startDate: work.startDate || today,
      updatedAt: nowIso,
    };
    return {
      patch,
      undoSnapshot,
      sound: 'page',
      toastMessage: `${work.title}: +1 audição (${nextListens}x)`,
    };
  }

  // Cinema
  if (actionType === 'cinema_ep' || (actionType === 'default' && isEpisodicWork(work))) {
    const next = advanceEpisodeProgress(work, { addEpisodes: 1 });
    const done = allowCompletion && Number(work.totalEpisodes) > 0 && next.progress >= 100;
    const patch = {
      currentSeason: next.currentSeason,
      currentEpisode: next.currentEpisode,
      watchedEpisodes: next.watchedEpisodes,
      progress: next.progress,
      status: done ? 'completed' : work.status === 'queued' ? 'playing' : work.status,
      startDate: work.startDate || today,
      ...(done ? { completedDate: today } : {}),
      updatedAt: nowIso,
    };
    return {
      patch,
      undoSnapshot,
      sound: done ? 'complete' : 'page',
      toastMessage: `${work.title}: +1 Ep (T${next.currentSeason} · E${next.currentEpisode})`,
    };
  }

  const nextMovie = advanceMovieSeconds(work, 20);
  const done =
    allowCompletion && nextMovie.totalSeconds && nextMovie.currentSeconds >= nextMovie.totalSeconds;
  const patch = {
    currentSeconds: nextMovie.currentSeconds,
    ...(nextMovie.totalSeconds ? { totalSeconds: nextMovie.totalSeconds } : {}),
    progress: nextMovie.progress,
    status: done ? 'completed' : work.status === 'queued' ? 'playing' : work.status,
    startDate: work.startDate || today,
    ...(done ? { completedDate: today } : {}),
    updatedAt: nowIso,
  };
  return {
    patch,
    undoSnapshot,
    sound: done ? 'complete' : 'page',
    toastMessage: `${work.title}: +20 min registrados`,
  };
}

/**
 * Atualiza a nota (0–10) de uma faixa individual na ficha de um álbum, com snapshot de Desfazer.
 */
export function computeAlbumTrackRatingPatch(work, track, index, nextScore10) {
  if (!work || typeof work !== 'object') return null;
  const prevMap = normalizeTrackRatingsMap(work.trackRatings);
  const prevTracks = Array.isArray(work.tracks) ? work.tracks : [];
  const key = makeAlbumTrackKey(track, index);
  const title = String(track?.title || `Faixa ${index + 1}`).trim();

  const nextMap = { ...prevMap };
  const isClearing =
    nextScore10 === null ||
    nextScore10 === undefined ||
    nextScore10 === '' ||
    prevMap[key] === Number(nextScore10);

  let resolvedScore = null;
  if (isClearing) {
    delete nextMap[key];
  } else {
    resolvedScore = Math.max(0, Math.min(10, Math.round(Number(nextScore10) * 10) / 10));
    nextMap[key] = resolvedScore;
  }

  const nextTracks = prevTracks.map((t, i) =>
    i === index ? { ...t, rating10: resolvedScore } : t
  );

  return {
    patch: {
      trackRatings: nextMap,
      tracks: nextTracks,
    },
    undoSnapshot: {
      trackRatings: prevMap,
      tracks: prevTracks,
      updatedAt: work.updatedAt || work.createdAt || null,
    },
    toastMessage:
      resolvedScore !== null
        ? `Faixa "${title}": nota ${resolvedScore}/10`
        : `Nota removida da faixa "${title}"`,
  };
}
