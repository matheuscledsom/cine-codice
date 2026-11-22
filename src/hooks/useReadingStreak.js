import { useCallback, useEffect, useState } from 'react';
import { domainConfig } from '../config/domainConfig';
import { loadEmergencyMirror } from '../services/backupEngine';
import { getStreakState, getTodayLocalISO } from '../utils/backlogHelpers';

const STREAK_KEY = domainConfig.streakStorageKey;

const DEFAULT_STREAK = {
  count: 0,
  lastDate: null,
  history: [],
  dailyLogs: {},
  restDays: [],
};

function sanitizeRestDays(rawRestDays) {
  if (!Array.isArray(rawRestDays)) return [];
  return Array.from(
    new Set(
      rawRestDays
        .map((d) => String(d || '').trim())
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    )
  )
    .sort()
    .slice(-60);
}

function sanitizeDailyLogs(rawLogs) {
  if (!rawLogs || typeof rawLogs !== 'object' || Array.isArray(rawLogs)) {
    return {};
  }
  const entries = Object.entries(rawLogs)
    .filter(([date, val]) => /^\d{4}-\d{2}-\d{2}$/.test(date) && val && typeof val === 'object')
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-365);

  return entries.reduce((acc, [date, val]) => {
    acc[date] = {
      standalonePages: Math.max(0, Number(val.standalonePages) || 0),
      standaloneSessions: Math.max(0, Number(val.standaloneSessions) || 0),
      notes: Array.isArray(val.notes)
        ? val.notes.map((n) => String(n || '').trim()).filter(Boolean).slice(-10)
        : [],
    };
    return acc;
  }, {});
}

function loadStreak() {
  try {
    const raw = localStorage.getItem(STREAK_KEY);
    if (!raw) {
      const mirror = loadEmergencyMirror();
      if (mirror.ok && mirror.streak) {
        return {
          count: Math.max(0, Number(mirror.streak.count) || 0),
          lastDate:
            typeof mirror.streak.lastDate === 'string'
              ? mirror.streak.lastDate
              : null,
          history: Array.isArray(mirror.streak.history)
            ? mirror.streak.history.slice(-365)
            : [],
          dailyLogs: sanitizeDailyLogs(mirror.streak.dailyLogs),
          restDays: sanitizeRestDays(mirror.streak.restDays),
        };
      }
      return DEFAULT_STREAK;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return DEFAULT_STREAK;
    return {
      count: Math.max(0, Number(parsed.count) || 0),
      lastDate: typeof parsed.lastDate === 'string' ? parsed.lastDate : null,
      history: Array.isArray(parsed.history) ? parsed.history.slice(-365) : [],
      dailyLogs: sanitizeDailyLogs(parsed.dailyLogs),
      restDays: sanitizeRestDays(parsed.restDays),
    };
  } catch {
    return DEFAULT_STREAK;
  }
}

export function useReadingStreak() {
  const [streakData, setStreakData] = useState(loadStreak);
  const [todayIso, setTodayIso] = useState(getTodayLocalISO);

  useEffect(() => {
    try {
      localStorage.setItem(STREAK_KEY, JSON.stringify(streakData));
    } catch {
      // Ignora erro caso quota de storage esteja indisponível
    }
  }, [streakData]);

  useEffect(() => {
    const syncDate = () => setTodayIso(getTodayLocalISO());
    window.addEventListener('focus', syncDate);
    document.addEventListener('visibilitychange', syncDate);
    return () => {
      window.removeEventListener('focus', syncDate);
      document.removeEventListener('visibilitychange', syncDate);
    };
  }, []);

  const registerToday = useCallback((options = {}) => {
    const today = getTodayLocalISO();
    setTodayIso(today);

    const extraStandalonePages = Math.max(
      0,
      Number(options?.standalonePages) || 0
    );
    const extraStandaloneSessions = Math.max(
      0,
      Number(options?.standaloneSessions) || 0
    );
    const cleanNote = String(options?.note || '').trim();

    setStreakData((prev) => {
      const state = getStreakState(prev, today);
      const hasDailyExtras =
        extraStandalonePages > 0 ||
        extraStandaloneSessions > 0 ||
        Boolean(cleanNote);

      if (state.loggedToday && !hasDailyExtras) return prev;

      const nextCount = state.loggedToday
        ? prev.count
        : state.status === 'active' || state.status === 'paused'
          ? prev.count + 1
          : 1;

      const nextHistory = Array.from(new Set([...(prev.history || []), today]))
        .sort()
        .slice(-365);

      const prevLogs = sanitizeDailyLogs(prev.dailyLogs);
      if (!hasDailyExtras) {
        return {
          count: nextCount,
          lastDate: today,
          history: nextHistory,
          dailyLogs: prevLogs,
          restDays: sanitizeRestDays(prev.restDays),
        };
      }

      const todayPrev = prevLogs[today] || {
        standalonePages: 0,
        standaloneSessions: 0,
        notes: [],
      };
      const nextNotes = cleanNote
        ? Array.from(new Set([...todayPrev.notes, cleanNote])).slice(-10)
        : todayPrev.notes;

      const nextLogs = sanitizeDailyLogs({
        ...prevLogs,
        [today]: {
          standalonePages: todayPrev.standalonePages + extraStandalonePages,
          standaloneSessions:
            todayPrev.standaloneSessions +
            (extraStandaloneSessions > 0
              ? extraStandaloneSessions
              : extraStandalonePages > 0 || cleanNote
                ? 1
                : 0),
          notes: nextNotes,
        },
      });

      return {
        count: nextCount,
        lastDate: today,
        history: nextHistory,
        dailyLogs: nextLogs,
        restDays: sanitizeRestDays(prev.restDays),
      };
    });
  }, []);

  const useRestDay = useCallback(() => {
    const today = getTodayLocalISO();
    setTodayIso(today);
    const state = getStreakState(streakData, today);
    const restList = sanitizeRestDays(streakData.restDays);
    if (state.loggedToday || restList.includes(today)) return false;
    const monthPrefix = today.slice(0, 7);
    const usedThisMonth = restList.filter((d) => d.startsWith(monthPrefix)).length;
    if (usedThisMonth >= 2) return false;

    setStreakData((prev) => {
      const prevRest = sanitizeRestDays(prev.restDays);
      if (prevRest.includes(today)) return prev;
      return {
        ...prev,
        lastDate: today,
        restDays: [...prevRest, today].slice(-60),
      };
    });
    return true;
  }, [streakData]);

  const restoreStreakBackup = useCallback((savedStreak) => {
    if (!savedStreak || typeof savedStreak !== 'object') return;
    setStreakData({
      count: Math.max(0, Number(savedStreak.count) || 0),
      lastDate: typeof savedStreak.lastDate === 'string' ? savedStreak.lastDate : null,
      history: Array.isArray(savedStreak.history) ? savedStreak.history.slice(-365) : [],
      dailyLogs: sanitizeDailyLogs(savedStreak.dailyLogs),
      restDays: sanitizeRestDays(savedStreak.restDays),
    });
  }, []);

  const state = getStreakState(streakData, todayIso);
  const restDays = sanitizeRestDays(streakData.restDays);
  const currentMonthKey = todayIso.slice(0, 7);
  const restDaysUsedThisMonth = restDays.filter((d) => d.startsWith(currentMonthKey)).length;
  const restDaysRemaining = Math.max(0, 2 - restDaysUsedThisMonth);
  const isRestDayToday = restDays.includes(todayIso);

  return {
    streakData,
    streakCount: state.effectiveCount,
    streakStatus: state.status,
    loggedToday: state.loggedToday,
    isPaused: state.isPaused,
    history: streakData.history,
    dailyLogs: streakData.dailyLogs || {},
    restDays,
    restDaysRemaining,
    isRestDayToday,
    useRestDay,
    registerToday,
    restoreStreakBackup,
  };
}
