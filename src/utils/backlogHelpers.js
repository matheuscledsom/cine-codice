import {
  GAME_PLATFORM_UNSET_LABEL,
  domainConfig,
  getWorkTypeLabel,
  inferDomainFromWork,
} from '../config/domainConfig.js';
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
  const domain = inferDomainFromWork(item);
  if (domain !== 'cinema') return false;
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

  const domain = inferDomainFromWork(item);

  if (domain === 'reading') {
    const pagesRead = Math.max(0, Number(item.pagesRead) || 0);
    const totalPages = Number(item.totalPages) || 0;
    if (totalPages > 0) {
      return Math.max(0, Math.min(100, Math.round((pagesRead / totalPages) * 100)));
    }
    if (Number(item.progressPercent) > 0) {
      return roundProgressPct(item.progressPercent);
    }
    return 0;
  }

  if (domain === 'games') {
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

  if (domain === 'music') {
    if (Number(item.listenCount) > 0 && item.status !== 'queued') {
      return 100;
    }
    return 0;
  }

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
  if (Array.isArray(item.episodesPerSeason) && item.episodesPerSeason.length > 0) {
    const lastKnown = Number(item.episodesPerSeason[item.episodesPerSeason.length - 1]);
    if (lastKnown > 0) return Math.round(lastKnown);
  }
  return 12;
}

export function computeStrictCompletionProgress(item) {
  if (!item) {
    return { percent: null, isOpenProgress: true, label: 'Progresso aberto' };
  }
  if (item.status === 'completed') {
    return { percent: 100, isOpenProgress: false, label: 'Concluído (100%)' };
  }

  const domain = inferDomainFromWork(item);

  if (domain === 'reading') {
    const pagesRead = Math.max(0, Number(item.pagesRead) || 0);
    const totalPages = Number(item.totalPages) || 0;
    const chaptersRead = Math.max(0, Number(item.chaptersRead) || 0);
    if (totalPages > 0) {
      const pct = Math.max(0, Math.min(100, Math.round((pagesRead / totalPages) * 100)));
      return {
        percent: pct,
        isOpenProgress: false,
        label: `Pág. ${pagesRead}/${totalPages} (${pct}%)`,
      };
    }
    if (pagesRead > 0) {
      return {
        percent: null,
        isOpenProgress: true,
        label: `${pagesRead} págs · Progresso aberto`,
      };
    }
    if (chaptersRead > 0) {
      return {
        percent: null,
        isOpenProgress: true,
        label: `${chaptersRead} cap. · Progresso aberto`,
      };
    }
    return { percent: null, isOpenProgress: true, label: 'Progresso aberto' };
  }

  if (domain === 'games') {
    const hours = Math.max(0, Number(item.hoursPlayed) || 0);
    if (
      item.progressPercent !== null &&
      item.progressPercent !== undefined &&
      item.progressPercent !== '' &&
      Number.isFinite(Number(item.progressPercent)) &&
      Number(item.progressPercent) > 0
    ) {
      const pct = roundProgressPct(item.progressPercent);
      return { percent: pct, isOpenProgress: false, label: `${hours}h (${pct}%)` };
    }
    return {
      percent: null,
      isOpenProgress: true,
      label: hours > 0 ? `${hours}h · Progresso aberto` : 'Progresso aberto',
    };
  }

  if (domain === 'music') {
    const listens = Math.max(0, Number(item.listenCount) || 0);
    const totalTracks =
      (Array.isArray(item.tracks) && item.tracks.length) || Number(item.trackCount) || 0;
    if (totalTracks > 0 && listens > 0) {
      return {
        percent: null,
        isOpenProgress: false,
        label: `${listens} ${listens === 1 ? 'escuta' : 'escutas'} · ${totalTracks} faixas`,
      };
    }
    return {
      percent: null,
      isOpenProgress: true,
      label: listens > 0 ? `${listens} escutas · Progresso aberto` : 'Progresso aberto',
    };
  }

  if (isEpisodicWork(item)) {
    const totalEpisodes = Number(item.totalEpisodes) || 0;
    const watchedCount = getWatchedEpisodesCount(item);
    if (totalEpisodes > 0) {
      const pct = calculateEpisodicProgress(item);
      return {
        percent: pct,
        isOpenProgress: false,
        label: `${watchedCount}/${totalEpisodes} eps (${pct}%)`,
      };
    }
    return {
      percent: null,
      isOpenProgress: true,
      label: `${watchedCount} eps · Progresso aberto`,
    };
  }

  const totalSec =
    Number(item.totalSeconds) ||
    (Number(item.durationMinutes) > 0 ? Number(item.durationMinutes) * 60 : 0);
  const currentSec = Math.max(0, Number(item.currentSeconds) || 0);
  if (totalSec > 0) {
    const pct = calculateMovieProgress(currentSec, totalSec);
    return {
      percent: pct,
      isOpenProgress: false,
      label: `${formatSecondsToHms(currentSec)} / ${formatSecondsToHms(totalSec)} (${pct}%)`,
    };
  }
  return {
    percent: null,
    isOpenProgress: true,
    label: currentSec > 0 ? `${formatSecondsToHms(currentSec)} · Progresso aberto` : 'Progresso aberto',
  };
}

export function formatCatalogCardFormatBadge(item = {}) {
  const domain = inferDomainFromWork(item);

  if (domain === 'reading') {
    const shortType = getWorkTypeLabel(item, 'reading');
    const pagesRead = Math.max(0, Number(item?.pagesRead) || 0);
    const totalPages = Number(item?.totalPages) || 0;
    const chaptersRead = Math.max(0, Number(item?.chaptersRead) || 0);
    if (totalPages > 0) {
      return {
        domain,
        workType: item?.workType || 'book',
        label: `Pág. ${pagesRead}/${totalPages}`,
        shortType,
        detail: `${pagesRead}/${totalPages}`,
      };
    }
    if (chaptersRead > 0) {
      return {
        domain,
        workType: item?.workType || 'manga',
        label: `${shortType} · Cap. ${chaptersRead}`,
        shortType,
        detail: `Cap. ${chaptersRead}`,
      };
    }
    return {
      domain,
      workType: item?.workType || 'book',
      label: item?.bookFormat ? `${shortType} · ${item.bookFormat}` : shortType,
      shortType,
      detail: item?.bookFormat || '',
    };
  }

  if (domain === 'games') {
    const shortType = getWorkTypeLabel(item, 'games');
    const platform = String(item?.platform || '').trim() || GAME_PLATFORM_UNSET_LABEL;
    const edition = String(item?.editionType || '').trim();
    const hours = Math.max(0, Number(item?.hoursPlayed) || 0);
    const compRaw = String(item?.completionType || '').trim();
    const compShort = compRaw.includes('100%')
      ? '100%'
      : compRaw.includes('História')
        ? 'História'
        : compRaw.includes('Multiplayer')
          ? 'Ranked'
          : compRaw.includes('Sem fim')
            ? 'Sem fim'
            : compRaw || '';
    const parts = [platform];
    if (edition && edition !== 'Jogo' && edition !== 'Original') parts.push(edition);
    if (hours > 0) parts.push(`${hours}h`);
    if (compShort) parts.push(compShort);
    return {
      domain,
      workType: item?.workType || 'game',
      label: parts.join(' · '),
      shortType,
      detail: compShort || edition,
    };
  }

  if (domain === 'music') {
    const shortType = getWorkTypeLabel(item, 'music');
    if (item?.workType === 'track') {
      const ms = Number(item?.durationMs);
      let dur = '';
      if (Number.isFinite(ms) && ms > 0) {
        const sec = Math.round(ms / 1000);
        dur = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
      }
      const detail = dur || String(item?.albumName || '').trim() || '';
      return {
        domain,
        workType: 'track',
        label: detail ? `${shortType} · ${detail}` : shortType,
        shortType,
        detail,
      };
    }
    const favTrack = String(item?.favoriteTrack || '').trim();
    const subgenre = String(item?.subgenre || '').trim();
    const listens = Math.max(0, Number(item?.listenCount) || 0);
    const detail = favTrack
      ? 'Faixa fav.'
      : subgenre || (listens > 0 ? `${listens}x` : '');
    return {
      domain,
      workType: item?.workType || 'album',
      label: detail ? `${shortType} · ${detail}` : shortType,
      shortType,
      detail,
    };
  }

  const workType = item?.workType || 'movie';
  if (workType === 'anime') {
    const audioRaw = String(item?.audioFormat || '').toLowerCase();
    const audioCode = audioRaw.includes('dub') ? 'DUB' : 'LEG';
    return {
      domain: 'cinema',
      workType: 'anime',
      label: `Anime · ${audioCode}`,
      shortType: 'Anime',
      detail: audioCode,
    };
  }
  if (workType === 'series') {
    const season = Math.max(1, Number(item?.currentSeason) || 1);
    const ep =
      Number(item?.currentEpisode) > 0
        ? Number(item.currentEpisode)
        : Number(item?.totalEpisodes) > 0
          ? Number(item.totalEpisodes)
          : 1;
    return {
      domain: 'cinema',
      workType: 'series',
      label: `Série · T${season} E${ep}`,
      shortType: 'Série',
      detail: `T${season} E${ep}`,
    };
  }
  const mins = Number(item?.durationMinutes) || 0;
  if (mins > 0) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const durText = h > 0 ? `${h}h ${m}m` : `${m}m`;
    return {
      domain: 'cinema',
      workType: 'movie',
      label: `Filme · ${durText}`,
      shortType: 'Filme',
      detail: durText,
    };
  }
  return {
    domain: 'cinema',
    workType: 'movie',
    label: 'Filme',
    shortType: 'Filme',
    detail: '',
  };
}

export function createExpandedSeasonPatch(item = {}, optionsOrCount = 12) {
  const curTotal = Math.max(1, Number(item.totalSeasons) || 1);
  const rawCount =
    typeof optionsOrCount === 'object' && optionsOrCount !== null
      ? optionsOrCount.defaultEpisodes ?? 12
      : optionsOrCount;
  const safeEpCount = Math.max(1, Math.round(Number(rawCount) || 12));
  const nextTotal = curTotal + 1;
  const baseArr = Array.isArray(item.episodesPerSeason) ? [...item.episodesPerSeason] : [];
  while (baseArr.length < curTotal) {
    baseArr.push(getSeasonEpisodeCount(item, baseArr.length + 1));
  }
  baseArr.push(safeEpCount);
  const prevTotalEps = Number(item.totalEpisodes) || 0;
  return {
    totalSeasons: nextTotal,
    currentSeason: nextTotal,
    episodesPerSeason: baseArr,
    totalEpisodes:
      prevTotalEps > 0 ? prevTotalEps + safeEpCount : baseArr.reduce((acc, n) => acc + n, 0),
  };
}

export function advanceEpisodeProgress(
  item = {},
  secondArg = {},
  thirdArg = {}
) {
  const normalizedOpts =
    typeof secondArg === 'number'
      ? { addEpisodes: secondArg, ...(thirdArg || {}) }
      : secondArg || {};
  const { addEpisodes = 0, addSeasons = 0, allowExpandSeasons = false } = normalizedOpts;
  let totalSeasons = Math.max(1, Number(item.totalSeasons) || 1);
  let totalEpisodes = Number(item.totalEpisodes) || 0;
  let episodesPerSeason = Array.isArray(item.episodesPerSeason) ? [...item.episodesPerSeason] : null;
  let currentSeason = Math.max(1, Number(item.currentSeason) || 1);
  let currentEpisode = Math.max(0, Number(item.currentEpisode) || 0);
  const watchedEpisodes = { ...normalizeEpisodeMap(item.watchedEpisodes) };

  if (addSeasons > 0) {
    const rawNextSeason = currentSeason + addSeasons;
    let nextSeason = Math.min(totalSeasons, rawNextSeason);
    if (allowExpandSeasons && rawNextSeason > totalSeasons) {
      nextSeason = rawNextSeason;
      totalSeasons = rawNextSeason;
      if (episodesPerSeason) {
        while (episodesPerSeason.length < totalSeasons) {
          episodesPerSeason.push(getSeasonEpisodeCount(item, episodesPerSeason.length + 1));
        }
        totalEpisodes = episodesPerSeason.reduce((acc, n) => acc + Math.max(1, Number(n) || 1), 0);
      }
    }
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
    totalSeasons,
    ...(totalEpisodes > 0 ? { totalEpisodes } : {}),
    ...(episodesPerSeason ? { episodesPerSeason } : {}),
    currentSeason,
    currentEpisode,
    watchedEpisodes,
  };

  return {
    currentSeason,
    currentEpisode,
    totalSeasons,
    ...(totalEpisodes > 0 ? { totalEpisodes } : {}),
    ...(episodesPerSeason ? { episodesPerSeason } : {}),
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
  const domain = inferDomainFromWork(item);

  if (domain === 'reading') {
    const pagesRead = Math.max(0, Number(item.pagesRead) || 0);
    const totalPages = Number(item.totalPages) || 0;
    const chaptersRead = Math.max(0, Number(item.chaptersRead) || 0);
    const pct = calculateWorkProgress(item);
    if (totalPages > 0) {
      return `Pág. ${pagesRead}/${totalPages} (${pct}%)`;
    }
    if (chaptersRead > 0) {
      return `Cap. ${chaptersRead} · Progresso aberto`;
    }
    if (pagesRead > 0) {
      return `${pagesRead} págs · Progresso aberto`;
    }
    return item.bookFormat || 'Não iniciado';
  }

  if (domain === 'games') {
    const platform = String(item.platform || '').trim() || GAME_PLATFORM_UNSET_LABEL;
    const edition = String(item.editionType || '').trim();
    const hours = Math.max(0, Number(item.hoursPlayed) || 0);
    const comp = String(item.completionType || '').trim();
    const parts = [
      platform,
      edition && edition !== 'Jogo' && edition !== 'Original' ? edition : null,
      hours > 0 ? `${hours}h` : null,
      comp || null,
    ].filter(Boolean);
    return parts.join(' · ') || 'Não iniciado';
  }

  if (domain === 'music') {
    const isTrack = item.workType === 'track';
    const albumName = String(item.albumName || '').trim();
    const fav = String(item.favoriteTrack || '').trim();
    const listens = Math.max(0, Number(item.listenCount) || 0);
    const relFmt = String(item.releaseFormat || '').trim();
    const parts = [
      isTrack && albumName ? `Álbum: ${albumName}` : null,
      !isTrack && fav ? `Faixa: ${fav}` : null,
      listens > 0 ? `${listens} ${listens === 1 ? 'escuta' : 'escutas'}` : null,
      !fav && !albumName && relFmt ? relFmt : null,
    ].filter(Boolean);
    return parts.join(' · ') || 'Na fila';
  }

  if (isEpisodicWork(item)) {
    const sCur = item.currentSeason || 1;
    const sTot = item.totalSeasons || 1;
    const eCur = item.currentEpisode || 0;
    const eTot = item.totalEpisodes;
    const pct = calculateWorkProgress(item);
    return eTot > 0
      ? `Temp. ${sCur}/${sTot} · Ep. ${eCur}/${eTot} (${pct}%)`
      : `Temp. ${sCur}/${sTot} · Ep. ${eCur} · Progresso aberto`;
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

export function getWorkDurationBadge(item) {
  if (!item) return '';
  const domain = inferDomainFromWork(item);
  if (domain === 'reading') {
    const totalPages = Number(item.totalPages) || 0;
    return totalPages > 0 ? `${totalPages} págs` : '';
  }
  if (domain === 'games') {
    const hours = Number(item.hoursPlayed) || 0;
    return hours > 0 ? `${hours}h jogadas` : '';
  }
  if (domain === 'music') {
    const count =
      Number(item.trackCount) || (Array.isArray(item.tracks) ? item.tracks.length : 0);
    return count > 0 ? `${count} faixas` : '';
  }
  if (isEpisodicWork(item)) {
    const seasons = Math.max(1, Number(item.totalSeasons) || 1);
    const totalEps = Number(item.totalEpisodes) || 0;
    return totalEps > 0
      ? `${seasons} temp. · ${totalEps} eps`
      : `${seasons} ${seasons === 1 ? 'temporada' : 'temporadas'}`;
  }
  const mins =
    Number(item.runtimeMinutes) ||
    Number(item.durationMinutes) ||
    (Number(item.totalSeconds) > 0 ? Math.round(Number(item.totalSeconds) / 60) : 0);
  if (mins <= 0) return '';
  const h = Math.floor(mins / 60);
  const rem = Math.round(mins % 60);
  return h > 0 ? `${h}h ${rem}m` : `${rem}m`;
}
