import { domainConfig } from '../config/domainConfig.js';
import {
  computeWeightedDnaRating,
  createDefaultCriteriaScores,
  normalizeCriteriaScores,
} from '../services/dnaScoring.js';

export function getTodayLocalISO() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function diffCalendarDays(fromIso, toIso) {
  if (!fromIso || !toIso) return null;
  const fromMs = Date.parse(`${fromIso}T00:00:00`);
  const toMs = Date.parse(`${toIso}T00:00:00`);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return null;
  return Math.round((toMs - fromMs) / 86400000);
}

export function getStreakState(streakData, todayIso = getTodayLocalISO()) {
  const count = Math.max(0, Number(streakData?.count) || 0);
  const lastDate = streakData?.lastDate || null;

  if (!lastDate || count === 0) {
    return {
      effectiveCount: 0,
      status: 'idle',
      loggedToday: false,
      isPaused: false,
      diffDays: null,
    };
  }

  const diffDays = diffCalendarDays(lastDate, todayIso);
  if (diffDays === null || diffDays < 0) {
    return {
      effectiveCount: count,
      status: 'active',
      loggedToday: false,
      isPaused: false,
      diffDays: 0,
    };
  }

  if (diffDays === 0) {
    return {
      effectiveCount: count,
      status: 'logged_today',
      loggedToday: true,
      isPaused: false,
      diffDays: 0,
    };
  }

  if (diffDays === 1) {
    return {
      effectiveCount: count,
      status: 'active',
      loggedToday: false,
      isPaused: false,
      diffDays: 1,
    };
  }

  if (diffDays === 2) {
    return {
      effectiveCount: count,
      status: 'paused',
      loggedToday: false,
      isPaused: true,
      diffDays: 2,
    };
  }

  return {
    effectiveCount: 0,
    status: 'broken',
    loggedToday: false,
    isPaused: false,
    diffDays,
  };
}

export function roundProgressPct(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return 0;
  const clamped = Math.max(0, Math.min(100, num));
  return Math.round(clamped * 10) / 10;
}

export function formatSecondsToHms(rawSeconds) {
  const sec = Math.max(0, Math.round(Number(rawSeconds) || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

export function parseTimeInputToSeconds(rawValue) {
  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
    return Math.max(0, Math.round(rawValue));
  }
  const clean = String(rawValue || '').trim();
  if (!clean) return 0;
  if (/^\d+$/.test(clean)) {
    return Math.max(0, Number(clean) * 60);
  }
  const parts = clean.split(':').map((p) => Number(p.trim()));
  if (parts.some((n) => Number.isNaN(n) || n < 0)) return 0;
  if (parts.length === 3) {
    return Math.round(parts[0] * 3600 + parts[1] * 60 + parts[2]);
  }
  if (parts.length === 2) {
    return Math.round(parts[0] * 60 + parts[1]);
  }
  return 0;
}

export function isEpisodicWork(item) {
  if (!item) return false;
  if (item.workType === 'series' || item.workType === 'anime') {
    if (String(item.animeFormat || '').toLowerCase() === 'filme') {
      return Number(item.totalEpisodes) > 1;
    }
    return true;
  }
  return Boolean(Number(item.totalEpisodes) > 1 || Number(item.totalSeasons) > 1);
}

export function makeEpisodeKey(season = 1, episode = 1) {
  const s = Math.max(1, Math.round(Number(season) || 1));
  const e = Math.max(1, Math.round(Number(episode) || 1));
  return `${s}:${e}`;
}

export function normalizeEpisodeMap(rawMap) {
  if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) return {};
  const out = {};
  Object.entries(rawMap).forEach(([k, val]) => {
    if (!/^\d+:\d+$/.test(String(k))) return;
    if (val === 'watched' || val === 'watching' || val === 'pending') {
      out[k] = val;
    }
  });
  return out;
}

export function normalizeFillerEpisodes(rawList) {
  if (!Array.isArray(rawList)) return [];
  return Array.from(
    new Set(
      rawList
        .map((k) => String(k || '').trim())
        .filter((k) => /^\d+:\d+$/.test(k))
    )
  );
}

export function normalizeStoryArcs(rawArcs) {
  if (!Array.isArray(rawArcs)) return [];
  return rawArcs
    .filter((a) => a && typeof a === 'object' && String(a.name || '').trim())
    .map((a, idx) => ({
      id: String(a.id || `arc-${idx + 1}`),
      name: String(a.name).trim().slice(0, 60),
      season: Math.max(1, Math.round(Number(a.season) || 1)),
      startEp: Math.max(1, Math.round(Number(a.startEp) || 1)),
      endEp: Math.max(
        Math.max(1, Math.round(Number(a.startEp) || 1)),
        Math.round(Number(a.endEp) || Number(a.startEp) || 1)
      ),
    }))
    .slice(0, 32);
}

export function calculateMovieProgress(currentSeconds, totalSeconds) {
  const cur = Math.max(0, Number(currentSeconds) || 0);
  const tot = Number(totalSeconds) || 0;
  if (tot <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((cur / tot) * 100)));
}

export function calculateEpisodicProgress(item = {}) {
  const totalSeasons = Math.max(1, Number(item.totalSeasons) || 1);
  const totalEpisodes = Number(item.totalEpisodes) || 0;
  const currentEpisode = Math.max(0, Number(item.currentEpisode) || 0);
  const watchedMap = normalizeEpisodeMap(item.watchedEpisodes);
  const fillerSet = new Set(normalizeFillerEpisodes(item.fillerEpisodes));
  const ignoreFillers = Boolean(item.ignoreFillersInProgress);

  const watchedKeys = Object.entries(watchedMap)
    .filter(([, state]) => state === 'watched')
    .map(([key]) => key);

  if (watchedKeys.length > 0 && totalEpisodes > 0) {
    const effectiveWatched = ignoreFillers
      ? watchedKeys.filter((k) => !fillerSet.has(k)).length
      : watchedKeys.length;
    const fillerCount = ignoreFillers ? fillerSet.size : 0;
    const denom = Math.max(1, totalEpisodes - fillerCount);
    return Math.max(0, Math.min(100, Math.round((effectiveWatched / denom) * 100)));
  }

  if (totalEpisodes > 0) {
    const clamped = Math.min(totalEpisodes, currentEpisode);
    return Math.max(0, Math.min(100, Math.round((clamped / totalEpisodes) * 100)));
  }

  const currentSeason = Math.max(1, Number(item.currentSeason) || 1);
  if (totalSeasons > 1 && currentSeason > 0) {
    return Math.max(0, Math.min(100, Math.round(((currentSeason - 1) / totalSeasons) * 100)));
  }

  return 0;
}

export function calculateWorkProgress(item) {
  if (!item) return 0;
  if (item.status === 'completed') return 100;

  if (isEpisodicWork(item)) {
    return calculateEpisodicProgress(item);
  }

  const totalSec =
    Number(item.totalSeconds) ||
    (Number(item.durationMinutes) > 0 ? Number(item.durationMinutes) * 60 : 0);
  const currentSec = Number(item.currentSeconds) || 0;
  if (totalSec > 0) {
    return calculateMovieProgress(currentSec, totalSec);
  }

  if (
    item.progressPercent !== null &&
    item.progressPercent !== undefined &&
    item.progressPercent !== '' &&
    !Number.isNaN(Number(item.progressPercent))
  ) {
    return roundProgressPct(item.progressPercent);
  }

  return 0;
}

export function syncCinemaEpisodeFields(raw = {}, isCompleted = false) {
  const cleanPos = (v, fallback = null) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
  };
  const cleanNonNeg = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
  };

  const totalSeasons = cleanPos(raw.totalSeasons, 1);
  const rawCurSeason = cleanPos(raw.currentSeason, 1);
  const currentSeason = isCompleted ? totalSeasons : Math.min(totalSeasons, rawCurSeason);

  const totalEpisodes = cleanPos(raw.totalEpisodes, null);
  const rawCurEp = cleanNonNeg(raw.currentEpisode);
  const currentEpisode = isCompleted && totalEpisodes ? totalEpisodes : rawCurEp;

  const episodesPerSeason = Array.isArray(raw.episodesPerSeason)
    ? raw.episodesPerSeason
        .map((n) => Math.max(1, Math.round(Number(n) || 0)))
        .filter((n) => Number.isFinite(n) && n > 0)
    : [];

  const watchedEpisodes = normalizeEpisodeMap(raw.watchedEpisodes);
  const fillerEpisodes = normalizeFillerEpisodes(raw.fillerEpisodes);
  const storyArcs = normalizeStoryArcs(raw.storyArcs);

  return {
    currentSeason,
    totalSeasons,
    currentEpisode,
    totalEpisodes,
    episodesPerSeason,
    watchedEpisodes,
    fillerEpisodes,
    storyArcs,
    ignoreFillersInProgress: Boolean(raw.ignoreFillersInProgress),
  };
}

export function getSeasonEpisodeCount(item = {}, seasonNumber = 1) {
  const sIdx = Math.max(0, Math.round(Number(seasonNumber) || 1) - 1);
  if (Array.isArray(item.episodesPerSeason) && Number(item.episodesPerSeason[sIdx]) > 0) {
    return Math.round(Number(item.episodesPerSeason[sIdx]));
  }
  const totalSeasons = Math.max(1, Number(item.totalSeasons) || 1);
  const totalEpisodes = Number(item.totalEpisodes) || 0;
  if (totalEpisodes > 0) {
    return Math.max(1, Math.ceil(totalEpisodes / totalSeasons));
  }
  return 12;
}

export function advanceEpisodeProgress(item = {}, { addEpisodes = 0, addSeasons = 0 } = {}) {
  const totalSeasons = Math.max(1, Number(item.totalSeasons) || 1);
  const totalEpisodes = Number(item.totalEpisodes) || 0;
  let currentSeason = Math.max(1, Number(item.currentSeason) || 1);
  let currentEpisode = Math.max(0, Number(item.currentEpisode) || 0);
  const watchedEpisodes = { ...normalizeEpisodeMap(item.watchedEpisodes) };

  if (addSeasons > 0) {
    const nextSeason = Math.min(totalSeasons, currentSeason + addSeasons);
    const seasonEpCount = getSeasonEpisodeCount(item, currentSeason);
    for (let ep = 1; ep <= seasonEpCount; ep += 1) {
      watchedEpisodes[makeEpisodeKey(currentSeason, ep)] = 'watched';
    }
    const watchedTotal = Object.values(watchedEpisodes).filter((v) => v === 'watched').length;
    currentSeason = nextSeason;
    currentEpisode = Math.max(currentEpisode, watchedTotal);
    if (totalEpisodes > 0) {
      currentEpisode = Math.min(totalEpisodes, currentEpisode);
    }
  } else if (addEpisodes > 0) {
    const targetEp =
      totalEpisodes > 0
        ? Math.min(totalEpisodes, currentEpisode + addEpisodes)
        : currentEpisode + addEpisodes;

    let remaining = targetEp - currentEpisode;
    let s = currentSeason;
    let cursorEpInSeason = 1;
    const curSeasonLen = getSeasonEpisodeCount(item, s);
    while (
      cursorEpInSeason <= curSeasonLen &&
      watchedEpisodes[makeEpisodeKey(s, cursorEpInSeason)] === 'watched'
    ) {
      cursorEpInSeason += 1;
    }

    while (remaining > 0) {
      const sLen = getSeasonEpisodeCount(item, s);
      if (cursorEpInSeason > sLen) {
        if (s < totalSeasons) {
          s += 1;
          cursorEpInSeason = 1;
        } else {
          break;
        }
      }
      watchedEpisodes[makeEpisodeKey(s, cursorEpInSeason)] = 'watched';
      cursorEpInSeason += 1;
      remaining -= 1;
    }

    currentSeason = Math.min(totalSeasons, s);
    currentEpisode = targetEp;
  }

  const nextState = {
    ...item,
    currentSeason,
    currentEpisode,
    watchedEpisodes,
  };

  return {
    currentSeason,
    currentEpisode,
    watchedEpisodes,
    progress: calculateEpisodicProgress(nextState),
  };
}

export function advanceMovieSeconds(item = {}, addMinutes = 15) {
  const totalSec =
    Number(item.totalSeconds) ||
    (Number(item.durationMinutes) > 0 ? Number(item.durationMinutes) * 60 : 0);
  const currentSec = Math.max(0, Number(item.currentSeconds) || 0);
  const nextSec =
    totalSec > 0
      ? Math.min(totalSec, currentSec + Math.round(addMinutes * 60))
      : currentSec + Math.round(addMinutes * 60);

  return {
    currentSeconds: nextSec,
    totalSeconds: totalSec || null,
    progress: totalSec > 0 ? calculateMovieProgress(nextSec, totalSec) : calculateWorkProgress(item),
  };
}

export function formatFlexibleProgressMetric(item) {
  if (!item) return '00:00:00';
  if (isEpisodicWork(item)) {
    const sCur = item.currentSeason || 1;
    const sTot = item.totalSeasons || 1;
    const eCur = item.currentEpisode || 0;
    const eTot = item.totalEpisodes;
    const pct = calculateWorkProgress(item);
    return eTot > 0
      ? `Temp. ${sCur}/${sTot} · Ep. ${eCur}/${eTot} (${pct}%)`
      : `Temp. ${sCur}/${sTot} · Ep. ${eCur}`;
  }

  const totalSec =
    Number(item.totalSeconds) ||
    (Number(item.durationMinutes) > 0 ? Number(item.durationMinutes) * 60 : 0);
  const curSec = Math.max(0, Number(item.currentSeconds) || 0);

  if (totalSec > 0) {
    return `${formatSecondsToHms(curSec)} / ${formatSecondsToHms(totalSec)}`;
  }
  if (curSec > 0) {
    return formatSecondsToHms(curSec);
  }
  const pct = calculateWorkProgress(item);
  return pct > 0 ? `${pct}%` : 'Não iniciado';
}

export function getWatchedMinutes(item) {
  if (!item) return 0;
  if (isEpisodicWork(item)) {
    const epDur = Number(item.episodeDurationMinutes) || (item.workType === 'anime' ? 24 : 45);
    const watchedEps = getWatchedEpisodesCount(item);
    return Math.round(watchedEps * epDur);
  }
  const totalSec =
    Number(item.totalSeconds) ||
    (Number(item.durationMinutes) > 0 ? Number(item.durationMinutes) * 60 : 0);
  const rewatchBonus = Math.max(0, Number(item.rewatchCount) || 0);
  if (item.status === 'completed') {
    const baseMin = Math.round(totalSec / 60) || Math.round((Number(item.currentSeconds) || 0) / 60);
    return baseMin * (1 + rewatchBonus);
  }
  if (item.status === 'queued') return 0;
  const activeMin = Math.round((Number(item.currentSeconds) || 0) / 60);
  const pastRewatchMin = Math.round(totalSec / 60) * rewatchBonus;
  return activeMin + pastRewatchMin;
}

export function getWatchedEpisodesCount(item) {
  if (!item || !isEpisodicWork(item)) return 0;
  const rewatchCount = Math.max(0, Number(item.rewatchCount) || 0);
  const totalEps = Number(item.totalEpisodes) || 0;
  if (item.status === 'completed') {
    const base = totalEps || Number(item.currentEpisode) || 0;
    return base * (1 + rewatchCount);
  }
  if (item.status === 'queued') return 0;
  const mapWatched = Object.values(normalizeEpisodeMap(item.watchedEpisodes)).filter(
    (s) => s === 'watched'
  ).length;
  const cur = Math.max(mapWatched, Number(item.currentEpisode) || 0);
  return cur + rewatchCount * totalEps;
}

export function getCompletionPace(startDate, completedDate, totalMinutes) {
  if (!startDate || !completedDate) return null;

  const startMs = Date.parse(`${startDate}T00:00:00`);
  const endMs = Date.parse(`${completedDate}T00:00:00`);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) {
    return null;
  }

  const diffDays = Math.round((endMs - startMs) / 86400000);
  const days = Math.max(1, diffDays);
  const mins = Math.max(0, Number(totalMinutes) || 0);
  const avgPerDay = Math.round((mins / days) * 10) / 10;

  return {
    days,
    avgPerDay,
    label: `Concluído em ${days} ${days === 1 ? 'dia' : 'dias'}`,
  };
}

export function createDefaultReviewCriteria(baseScore = 80) {
  return createDefaultCriteriaScores(baseScore);
}

export function calculateSmartRating(reviewCriteria, dnaInput = null) {
  if (!reviewCriteria) return null;
  const normalized = normalizeCriteriaScores(reviewCriteria);
  return computeWeightedDnaRating(normalized, dnaInput);
}

export function getVerdictForScore(score) {
  if (score === null || score === undefined || Number.isNaN(Number(score))) {
    return null;
  }
  const numeric = Number(score);
  const matched = domainConfig.tactileOptions.verdicts.find(
    (verdict) => numeric >= verdict.minScore
  );
  return matched ? matched.id : null;
}

export function getVerdictMeta(verdictId) {
  if (!verdictId) return null;
  return (
    domainConfig.tactileOptions.verdicts.find((v) => v.id === verdictId) ?? null
  );
}

export function getHypeMeta(hypeId) {
  if (!hypeId) return null;
  return (
    domainConfig.tactileOptions.hypeLevels.find((h) => h.id === hypeId) ?? null
  );
}

export function getDisplayTitles(item, mode = 'bilingual') {
  const ptTitle = String(item?.title || '').trim();
  const origTitle = String(item?.originalTitle || '').trim();
  const hasDistinctOriginal =
    Boolean(origTitle) && origTitle.toLowerCase() !== ptTitle.toLowerCase();

  if (mode === 'original') {
    return {
      primary: origTitle || ptTitle,
      secondary: '',
    };
  }
  if (mode === 'pt') {
    return {
      primary: ptTitle || origTitle,
      secondary: '',
    };
  }
  return {
    primary: ptTitle || origTitle,
    secondary: hasDistinctOriginal ? origTitle : '',
  };
}

export function buildContinueWatchingHub(items = []) {
  const activeStatuses = new Set(['playing', 'rewatching']);
  const active = (Array.isArray(items) ? items : [])
    .filter((item) => item && item.inBacklog !== false && activeStatuses.has(item.status))
    .sort((a, b) => {
      const tA = Date.parse(a.updatedAt || a.createdAt || '') || 0;
      const tB = Date.parse(b.updatedAt || b.createdAt || '') || 0;
      return tB - tA;
    })
    .map((item) => ({
      id: String(item.id),
      work: item,
      title: item.title,
      originalTitle: item.originalTitle || '',
      director: item.director || item.studio || '',
      workType: item.workType || 'movie',
      format: item.format || '',
      audioFormat: item.audioFormat || '',
      progressPct: calculateWorkProgress(item),
      metricLabel: formatFlexibleProgressMetric(item),
    }));

  return {
    featured: active[0] || null,
    others: active.slice(1),
    all: active,
  };
}

export function getDropReasonMeta(reasonIdOrLabel) {
  if (!reasonIdOrLabel) return null;
  const clean = String(reasonIdOrLabel)
    .replace(/^[\p{Emoji}\u200d\ufe0f\s]+/u, '')
    .trim()
    .toLowerCase();
  return (
    domainConfig.tactileOptions.dropReasons.find(
      (r) =>
        r.id === reasonIdOrLabel ||
        r.label === reasonIdOrLabel ||
        r.id.toLowerCase() === clean
    ) ?? { id: reasonIdOrLabel, label: clean || String(reasonIdOrLabel), icon: 'Hourglass' }
  );
}

export function normalizeTagsList(rawTags) {
  if (!Array.isArray(rawTags)) return [];
  return Array.from(
    new Set(
      rawTags
        .map((t) => String(t || '').trim().replace(/^#/, '').slice(0, 32))
        .filter(Boolean)
    )
  ).slice(0, 24);
}

export function isLoanOverdue(item, thresholdDays = 30) {
  if (!item?.loanedTo || !String(item.loanedTo).trim() || !item.loanedAt) {
    return false;
  }
  const diff = diffCalendarDays(String(item.loanedAt).slice(0, 10), getTodayLocalISO());
  return diff !== null && diff >= thresholdDays;
}
