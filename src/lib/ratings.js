/**
 * Funções puras para normalização e comparação de notas externas e do usuário (D5).
 * Módulo puro em .js sem React, CSS ou acesso a DOM (D7).
 */

export const EXTERNAL_RATING_KEYS = Object.freeze([
  'imdb',
  'rottenTomatoes',
  'metacritic',
  'tmdb',
  'anilist',
  'mal',
]);

export const RATING_SOURCE_META = Object.freeze({
  imdb: Object.freeze({ id: 'imdb', label: 'IMDb', scale: 10 }),
  rottenTomatoes: Object.freeze({ id: 'rottenTomatoes', label: 'RT', scale: 100 }),
  metacritic: Object.freeze({ id: 'metacritic', label: 'Metacritic', scale: 100 }),
  tmdb: Object.freeze({ id: 'tmdb', label: 'TMDB', scale: 10 }),
  anilist: Object.freeze({ id: 'anilist', label: 'AniList', scale: 100 }),
  mal: Object.freeze({ id: 'mal', label: 'MAL', scale: 10 }),
});

export function createEmptyExternalRatings() {
  return {
    imdb: null,
    rottenTomatoes: null,
    metacritic: null,
    tmdb: null,
    anilist: null,
    mal: null,
  };
}

function toFinitePositiveOrZero(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'string' && /^n\/?a$/i.test(raw.trim())) return null;
  const num = Number(raw);
  if (!Number.isFinite(num) || num < 0) return null;
  return num;
}

function parseVotesCount(rawVotes) {
  if (rawVotes === null || rawVotes === undefined || rawVotes === '') return null;
  if (typeof rawVotes === 'string' && /^n\/?a$/i.test(rawVotes.trim())) return null;
  const clean = String(rawVotes).replace(/[^\d]/g, '');
  if (!clean) return null;
  const parsed = Number(clean);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function normalizeExternalRatingEntry(entry, expectedScale = null, hasVotes = false) {
  if (!entry || typeof entry !== 'object') return null;
  const scale = expectedScale || Number(entry.scale) || 100;
  const val = toFinitePositiveOrZero(entry.value);
  if (val === null || val > scale) return null;
  const fetchedAt =
    entry.fetchedAt && Number.isFinite(Number(entry.fetchedAt))
      ? Number(entry.fetchedAt)
      : entry.fetchedAt || null;

  const normalized = {
    value: scale === 100 ? Math.round(val) : Math.round(val * 100) / 100,
    scale,
    fetchedAt,
  };

  if (hasVotes || entry.votes !== undefined) {
    normalized.votes = parseVotesCount(entry.votes);
  }
  return normalized;
}

export function normalizeExternalRatings(raw) {
  const base = createEmptyExternalRatings();
  if (!raw || typeof raw !== 'object') return base;
  return {
    imdb: normalizeExternalRatingEntry(raw.imdb, 10, true),
    rottenTomatoes: normalizeExternalRatingEntry(raw.rottenTomatoes, 100, false),
    metacritic: normalizeExternalRatingEntry(raw.metacritic, 100, false),
    tmdb: normalizeExternalRatingEntry(raw.tmdb, 10, true),
    anilist: normalizeExternalRatingEntry(raw.anilist, 100, false),
    mal: normalizeExternalRatingEntry(raw.mal, 10, false),
  };
}

export function mergeExternalRatings(existing, incoming) {
  const curr = normalizeExternalRatings(existing);
  const next = normalizeExternalRatings(incoming);
  const out = createEmptyExternalRatings();

  for (const key of EXTERNAL_RATING_KEYS) {
    if (next[key] && curr[key]) {
      const nextTime = Number(next[key].fetchedAt) || 0;
      const currTime = Number(curr[key].fetchedAt) || 0;
      out[key] = nextTime >= currTime ? next[key] : curr[key];
    } else {
      out[key] = next[key] || curr[key] || null;
    }
  }
  return out;
}

/**
 * Converte a resposta oficial da OMDb em { imdb, rottenTomatoes, metacritic }.
 * Campo ausente ou "N/A" retorna null (nunca inventado).
 */
export function parseOmdbRatings(omdbData, fetchedAt = Date.now()) {
  if (!omdbData || typeof omdbData !== 'object' || omdbData.Response === 'False') {
    return { imdb: null, rottenTomatoes: null, metacritic: null };
  }

  const ts = Number(fetchedAt) || Date.now();
  const ratingsArr = Array.isArray(omdbData.Ratings) ? omdbData.Ratings : [];

  // IMDb
  let imdbValue = toFinitePositiveOrZero(omdbData.imdbRating);
  if (imdbValue === null) {
    const imdbRow = ratingsArr.find((r) => /internet movie database/i.test(String(r?.Source || '')));
    const m = String(imdbRow?.Value || '').match(/^(\d+(?:\.\d+)?)\s*\/\s*10$/);
    if (m) imdbValue = toFinitePositiveOrZero(m[1]);
  }
  const votes = parseVotesCount(omdbData.imdbVotes);
  const imdb =
    imdbValue !== null && imdbValue > 0 && imdbValue <= 10
      ? { value: Math.round(imdbValue * 10) / 10, scale: 10, votes, fetchedAt: ts }
      : null;

  // Rotten Tomatoes (exclusivo da OMDb)
  const rtRow = ratingsArr.find((r) => /rotten tomatoes/i.test(String(r?.Source || '')));
  let rtValue = null;
  if (rtRow?.Value) {
    const m = String(rtRow.Value).trim().match(/^(\d{1,3})\s*%$/);
    if (m) rtValue = toFinitePositiveOrZero(m[1]);
  }
  const rottenTomatoes =
    rtValue !== null && rtValue <= 100
      ? { value: Math.round(rtValue), scale: 100, fetchedAt: ts }
      : null;

  // Metacritic
  let metaValue = toFinitePositiveOrZero(omdbData.Metascore);
  if (metaValue === null) {
    const metaRow = ratingsArr.find((r) => /metacritic/i.test(String(r?.Source || '')));
    const m = String(metaRow?.Value || '').match(/^(\d{1,3})\s*\/\s*100$/);
    if (m) metaValue = toFinitePositiveOrZero(m[1]);
  }
  const metacritic =
    metaValue !== null && metaValue <= 100
      ? { value: Math.round(metaValue), scale: 100, fetchedAt: ts }
      : null;

  return { imdb, rottenTomatoes, metacritic };
}

export function buildTmdbRating(voteAverage, voteCount = null, fetchedAt = Date.now()) {
  const num = toFinitePositiveOrZero(voteAverage);
  const votes = parseVotesCount(voteCount);
  if (num === null || num <= 0 || num > 10) return null;
  if (voteCount !== null && voteCount !== undefined && Number(voteCount) <= 0) {
    return null;
  }
  return {
    value: Math.round(num * 10) / 10,
    scale: 10,
    votes,
    fetchedAt: Number(fetchedAt) || Date.now(),
  };
}

export function buildAniListRating(averageScore, fetchedAt = Date.now()) {
  const num = toFinitePositiveOrZero(averageScore);
  if (num === null || num <= 0 || num > 100) return null;
  return {
    value: Math.round(num),
    scale: 100,
    fetchedAt: Number(fetchedAt) || Date.now(),
  };
}

export function buildMalRating(score, fetchedAt = Date.now()) {
  const num = toFinitePositiveOrZero(score);
  if (num === null || num <= 0 || num > 10) return null;
  return {
    value: Math.round(num * 100) / 100,
    scale: 10,
    fetchedAt: Number(fetchedAt) || Date.now(),
  };
}

/**
 * Converte uma nota externa para a escala comparativa 0–100.
 */
export function normalizeScoreTo100(entryOrValue, explicitScale = null) {
  if (entryOrValue === null || entryOrValue === undefined) return null;
  let val = null;
  let scale = explicitScale;

  if (typeof entryOrValue === 'object') {
    val = toFinitePositiveOrZero(entryOrValue.value);
    scale = explicitScale || Number(entryOrValue.scale) || 100;
  } else {
    val = toFinitePositiveOrZero(entryOrValue);
    scale = explicitScale || 100;
  }

  if (val === null || val <= 0 || scale <= 0) return null;
  const pct = scale === 100 ? val : (val / scale) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

/**
 * Formata o valor para selo de fonte externa sem nunca retornar "N/A".
 */
export function formatExternalRatingValue(sourceId, entry) {
  const norm = normalizeExternalRatingEntry(entry, RATING_SOURCE_META[sourceId]?.scale);
  if (!norm) return null;
  if (sourceId === 'imdb' || sourceId === 'tmdb') {
    return norm.value.toFixed(1);
  }
  if (sourceId === 'mal') {
    return norm.value.toFixed(2);
  }
  if (sourceId === 'rottenTomatoes' || sourceId === 'anilist') {
    return `${Math.round(norm.value)}%`;
  }
  if (sourceId === 'metacritic') {
    return String(Math.round(norm.value));
  }
  return String(norm.value);
}

export function formatRatingFetchedDate(timestampMs) {
  const ts = Number(timestampMs);
  if (!Number.isFinite(ts) || ts <= 0) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

export function getPresentExternalRatingBadges(externalRatings) {
  const normalized = normalizeExternalRatings(externalRatings);
  const badges = [];
  for (const sourceId of EXTERNAL_RATING_KEYS) {
    const entry = normalized[sourceId];
    if (!entry) continue;
    const formattedValue = formatExternalRatingValue(sourceId, entry);
    if (!formattedValue) continue;
    const meta = RATING_SOURCE_META[sourceId];
    badges.push({
      id: sourceId,
      label: meta.label,
      value: entry.value,
      scale: meta.scale,
      formattedValue,
      displayText: `${meta.label} ${formattedValue}`,
      normalized100: normalizeScoreTo100(entry),
      votes: entry.votes ?? null,
      fetchedAt: entry.fetchedAt ?? null,
      fetchedDateLabel: formatRatingFetchedDate(entry.fetchedAt),
    });
  }
  return badges;
}

export function computeExternalPublicAverage100(externalRatings) {
  const badges = getPresentExternalRatingBadges(externalRatings).filter(
    (b) => typeof b.normalized100 === 'number'
  );
  if (badges.length === 0) return null;
  const sum = badges.reduce((acc, b) => acc + b.normalized100, 0);
  return {
    average100: Math.round(sum / badges.length),
    sourceCount: badges.length,
    sources: badges.map((b) => b.id),
  };
}

/**
 * Verifica se a obra possui nota efetiva do usuário (excluindo 'legacy-default' e null).
 */
export function isConfirmedUserRating(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.ratingSource === 'legacy-default') return false;
  if (item.rating === null || item.rating === undefined || item.rating === '') return false;
  const n = Number(item.rating);
  return Number.isFinite(n) && n >= 0 && n <= 100;
}

/**
 * Compara a nota do usuário (escala 0–100 do app) com a média normalizada das fontes públicas.
 * Exclui notas 'legacy-default' e retorna null quando faltar nota do usuário ou fontes públicas.
 */
export function compareUserRatingWithPublic(
  userRating,
  externalRatings,
  ratingSource = 'manual'
) {
  if (ratingSource === 'legacy-default') return null;
  if (userRating === null || userRating === undefined || userRating === '') return null;
  const numericUser = Number(userRating);
  if (!Number.isFinite(numericUser) || numericUser < 0 || numericUser > 100) return null;

  const userScore100 = Math.round(numericUser);
  const publicAvg = computeExternalPublicAverage100(externalRatings);
  if (!publicAvg) return null;

  const delta = userScore100 - publicAvg.average100;
  const deltaText = delta > 0 ? `+${delta}` : String(delta);
  const alignment = delta > 0 ? 'above' : delta < 0 ? 'below' : 'equal';
  const alignmentText =
    delta > 0
      ? `${deltaText} pts acima do público`
      : delta < 0
        ? `${deltaText} pts abaixo do público`
        : '0 pts (alinhada ao público)';

  return {
    userScore100,
    publicAverage100: publicAvg.average100,
    delta,
    deltaText,
    sourceCount: publicAvg.sourceCount,
    alignment,
    alignmentText,
  };
}

/**
 * Fontes esperadas por tipo de obra conforme D1 (para skeleton individual durante carregamento).
 */
export function getExpectedExternalSourcesForWork(work = {}) {
  const workType = work?.workType || 'movie';
  const ids = work?.ids || {};
  const hasTmdb = Boolean(ids.tmdb || work?.tmdbId || work?.externalRatings?.tmdb);

  if (workType === 'anime') {
    const list = ['anilist', 'mal'];
    if (hasTmdb) list.push('tmdb');
    return list;
  }

  return ['tmdb', 'imdb', 'rottenTomatoes', 'metacritic'];
}

export function workHasAnyExternalIds(work = {}) {
  const ids = work?.ids || {};
  return Boolean(
    ids.tmdb ||
      work?.tmdbId ||
      ids.imdb ||
      work?.imdbId ||
      ids.anilist ||
      work?.anilistId ||
      ids.mal ||
      work?.malId ||
      ids.tvmaze ||
      work?.tvmazeId
  );
}

/**
 * Planeja estado unificado da seção "Notas do Público" e "Sua Nota vs. Público" na ficha (D5 / D6 / D7).
 */
export function buildExternalRatingsViewModel(
  work = {},
  {
    loading = false,
    pendingSources = null,
    failedSources = [],
    omdbMissingKey = false,
    isOfflineCache = false,
    cacheDateLabel = '',
    hasAttempted = false,
  } = {}
) {
  const badges = getPresentExternalRatingBadges(work?.externalRatings);
  const presentSet = new Set(badges.map((b) => b.id));
  const expected = getExpectedExternalSourcesForWork(work);

  let skeletonSourceIds = [];
  if (loading) {
    const candidatePending = Array.isArray(pendingSources) ? pendingSources : expected;
    skeletonSourceIds = candidatePending.filter((id) => !presentSet.has(id));
  }

  const comparison = compareUserRatingWithPublic(
    work?.rating,
    work?.externalRatings,
    work?.ratingSource
  );

  const safeFailed = Array.isArray(failedSources) ? failedSources.filter(Boolean) : [];
  const hasIds = workHasAnyExternalIds(work);

  let state = 'ready';
  if (loading && badges.length === 0) {
    state = 'loading';
  } else if (badges.length > 0 && isOfflineCache) {
    state = 'offline';
  } else if (
    badges.length > 0 &&
    (loading || safeFailed.length > 0 || omdbMissingKey)
  ) {
    state = 'partial';
  } else if (badges.length === 0 && safeFailed.length > 0) {
    state = 'error';
  } else if (badges.length === 0 && hasAttempted) {
    state = 'empty';
  } else if (badges.length === 0 && !hasIds) {
    state = 'empty';
  }

  return {
    state,
    badges,
    skeletonSourceIds: skeletonSourceIds.map((id) => ({
      id,
      label: RATING_SOURCE_META[id]?.label || id,
    })),
    comparison,
    omdbMissingKey: Boolean(omdbMissingKey),
    failedSources: safeFailed,
    isOfflineCache: Boolean(isOfflineCache),
    cacheDateLabel: String(cacheDateLabel || ''),
    hasAnyIds: hasIds,
  };
}

/**
 * Helpers para nota de episódio (D5: interna 0–100 em passos de 5, exibida como 0–10).
 */
export function snapEpisodeRatingStep5(score100) {
  const num = toFinitePositiveOrZero(score100);
  if (num === null) return null;
  const clamped = Math.max(0, Math.min(100, num));
  return Math.round(clamped / 5) * 5;
}

export function episodeScore10To100(score10) {
  const num = toFinitePositiveOrZero(score10);
  if (num === null || num > 10) return null;
  return snapEpisodeRatingStep5(num * 10);
}

export function formatEpisodeRating10(score100) {
  const num = toFinitePositiveOrZero(score100);
  if (num === null || num > 100) return null;
  const score10 = num / 10;
  return Number.isInteger(score10) ? String(score10) : score10.toFixed(1);
}
