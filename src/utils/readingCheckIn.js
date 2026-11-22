import { computeDnaWeightedScore, getEstimatedSessionMinutes } from '../services/dnaScoring.js';
import { getTodayLocalISO } from './backlogHelpers.js';

export function toLocalIsoDate(dateInput) {
  if (!dateInput) return null;
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput.trim())) {
    return dateInput.trim();
  }
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(d.getTime())) return null;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatShortPtBrDate(isoDate) {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate || '';
  const [y, m, d] = isoDate.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  const months = [
    'jan',
    'fev',
    'mar',
    'abr',
    'mai',
    'jun',
    'jul',
    'ago',
    'set',
    'out',
    'nov',
    'dez',
  ];
  return `${String(dateObj.getDate()).padStart(2, '0')} de ${months[dateObj.getMonth()]}`;
}

export function computeHeatmapLevel(minutes, sessions) {
  const safeMins = Math.max(0, Number(minutes) || 0);
  const safeSessions = Math.max(0, Number(sessions) || 0);
  if (safeMins === 0 && safeSessions === 0) return 0;
  if (safeMins >= 150) return 4;
  if (safeMins >= 90) return 3;
  if (safeMins >= 40) return 2;
  return 1;
}

export function buildReadingHeatmap({
  readingSessions = [],
  streakHistory = [],
  dailyLogs = {},
  weeks = 16,
  endDate = null,
} = {}) {
  const safeWeeks = Math.max(4, Math.min(53, Number(weeks) || 16));
  const anchorIso = toLocalIsoDate(endDate) || getTodayLocalISO();
  const [ay, am, ad] = anchorIso.split('-').map(Number);
  const anchorDate = new Date(ay, am - 1, ad);

  const dayOfWeek = anchorDate.getDay();
  const gridStart = new Date(anchorDate);
  gridStart.setDate(anchorDate.getDate() - dayOfWeek - (safeWeeks - 1) * 7);

  const dayMap = new Map();

  const ensureDay = (iso) => {
    if (!iso) return null;
    if (!dayMap.has(iso)) {
      dayMap.set(iso, {
        date: iso,
        minutes: 0,
        episodes: 0,
        sessions: 0,
        notes: [],
      });
    }
    return dayMap.get(iso);
  };

  (Array.isArray(readingSessions) ? readingSessions : []).forEach((session) => {
    const iso = toLocalIsoDate(
      session?.endedAt || session?.startedAt || session?.createdAt
    );
    const entry = ensureDay(iso);
    if (!entry) return;
    const mins =
      Number(session?.minutesWatched) ||
      Math.round((Number(session?.durationSeconds) || 0) / 60) ||
      Number(session?.pagesRead) ||
      0;
    entry.minutes += Math.max(0, mins);
    entry.episodes += Math.max(0, Number(session?.episodesWatched) || 0);
    entry.sessions += 1;
    if (session?.notes && String(session.notes).trim()) {
      entry.notes.push(String(session.notes).trim());
    }
  });

  if (dailyLogs && typeof dailyLogs === 'object') {
    Object.entries(dailyLogs).forEach(([iso, log]) => {
      const cleanIso = toLocalIsoDate(iso);
      const entry = ensureDay(cleanIso);
      if (!entry || !log || typeof log !== 'object') return;
      entry.minutes += Math.max(0, Number(log.standalonePages) || 0);
      entry.sessions += Math.max(0, Number(log.standaloneSessions) || 0);
      if (Array.isArray(log.notes)) {
        log.notes.forEach((n) => {
          const cleanNote = String(n || '').trim();
          if (cleanNote && !entry.notes.includes(cleanNote)) {
            entry.notes.push(cleanNote);
          }
        });
      }
    });
  }

  (Array.isArray(streakHistory) ? streakHistory : []).forEach((iso) => {
    const cleanIso = toLocalIsoDate(iso);
    const entry = ensureDay(cleanIso);
    if (!entry) return;
    if (entry.sessions === 0) entry.sessions = 1;
  });

  const columns = [];
  let activeDays = 0;
  let totalMinutes = 0;
  let totalEpisodes = 0;
  let totalSessions = 0;
  let bestDay = null;

  for (let col = 0; col < safeWeeks; col += 1) {
    const weekDays = [];
    for (let row = 0; row < 7; row += 1) {
      const cellDate = new Date(gridStart);
      cellDate.setDate(gridStart.getDate() + col * 7 + row);
      const iso = toLocalIsoDate(cellDate);
      const isFuture = iso > anchorIso;
      const stats = dayMap.get(iso) || {
        date: iso,
        minutes: 0,
        episodes: 0,
        sessions: 0,
        notes: [],
      };
      const level = isFuture ? 0 : computeHeatmapLevel(stats.minutes, stats.sessions);
      const prettyDate = formatShortPtBrDate(iso);

      if (!isFuture && level > 0) {
        activeDays += 1;
        totalMinutes += stats.minutes;
        totalEpisodes += stats.episodes;
        totalSessions += stats.sessions;
        if (
          !bestDay ||
          stats.minutes > bestDay.minutes ||
          (stats.minutes === bestDay.minutes && stats.sessions > bestDay.sessions)
        ) {
          bestDay = {
            date: iso,
            prettyDate,
            minutes: stats.minutes,
            episodes: stats.episodes,
            sessions: stats.sessions,
          };
        }
      }

      const ariaLabel = isFuture
        ? `${prettyDate}: data futura`
        : stats.minutes > 0
          ? `${prettyDate}: ${stats.minutes} min em tela`
          : stats.sessions > 0
            ? `${prettyDate}: sessão registrada`
            : `${prettyDate}: sem sessão registrada`;

      weekDays.push({
        date: iso,
        prettyDate,
        minutes: isFuture ? 0 : stats.minutes,
        episodes: isFuture ? 0 : stats.episodes,
        sessions: isFuture ? 0 : stats.sessions,
        notes: isFuture ? [] : stats.notes,
        level,
        isFuture,
        isToday: iso === anchorIso,
        ariaLabel,
      });
    }
    columns.push(weekDays);
  }

  return {
    weeks: safeWeeks,
    anchorIso,
    columns,
    activeDays,
    totalMinutes,
    totalEpisodes,
    totalSessions,
    bestDay,
  };
}

export const ROULETTE_FILTERS = [
  { id: 'all', label: 'Qualquer duração' },
  { id: '25min', label: '25 min' },
  { id: '50min', label: '50 min' },
  { id: '2h+', label: '2h+' },
];

export function buildWatchPickerPool({
  items = [],
  filter = 'all',
} = {}) {
  const queued = (Array.isArray(items) ? items : []).filter(
    (item) => item && item.inBacklog !== false && item.status === 'queued'
  );

  if (filter === '25min') {
    return queued.filter((item) => {
      const mins = getEstimatedSessionMinutes(item);
      return mins > 0 && mins <= 32;
    });
  }

  if (filter === '50min') {
    return queued.filter((item) => {
      const mins = getEstimatedSessionMinutes(item);
      return mins > 32 && mins <= 75;
    });
  }

  if (filter === '2h+') {
    return queued.filter((item) => {
      const mins = getEstimatedSessionMinutes(item);
      return mins >= 110;
    });
  }

  return queued;
}

export function pickRandomQueuedWork({
  items = [],
  filter = 'all',
  lastPickedId = null,
  rng = Math.random,
} = {}) {
  const pool = buildWatchPickerPool({ items, filter });
  if (pool.length === 0) return { picked: null, poolCount: 0, pool };

  const eligible =
    pool.length > 1 && lastPickedId
      ? pool.filter((item) => item.id !== lastPickedId)
      : pool;

  const rawIndex = Math.floor(rng() * eligible.length);
  const safeIndex = Math.max(0, Math.min(eligible.length - 1, rawIndex));

  return {
    picked: eligible[safeIndex],
    poolCount: pool.length,
    pool,
  };
}

export function pickWeightedQueuedWork({
  items = [],
  filter = 'all',
  readerDna = null,
  lastPickedId = null,
  rng = Math.random,
} = {}) {
  const pool = buildWatchPickerPool({ items, filter });
  if (pool.length === 0) {
    return { picked: null, poolCount: 0, totalPoolCount: 0, matchedReason: '', pool: [] };
  }

  const scored = pool.map((item) => ({
    item,
    dna: computeDnaWeightedScore(item, readerDna),
  }));

  const allowed = scored.filter((entry) => !entry.dna.excluded);
  const safePool = allowed.length > 0 ? allowed : scored;
  const eligible =
    safePool.length > 1 && lastPickedId
      ? safePool.filter((entry) => entry.item.id !== lastPickedId)
      : safePool;

  const weighted = eligible.map((entry) => ({
    ...entry,
    weight: Math.max(1, 10 + (Number(entry.dna?.bonus) || 0)),
  }));

  const totalWeight = weighted.reduce((acc, entry) => acc + entry.weight, 0);
  let target = Math.max(0, Math.min(0.999999, rng())) * totalWeight;
  let chosen = weighted[weighted.length - 1];

  for (const entry of weighted) {
    if (target < entry.weight) {
      chosen = entry;
      break;
    }
    target -= entry.weight;
  }

  return {
    picked: chosen.item,
    poolCount: allowed.length,
    totalPoolCount: pool.length,
    matchedReason: chosen.dna?.topDimensionLabel || '',
    pool: allowed.map((entry) => entry.item),
  };
}
