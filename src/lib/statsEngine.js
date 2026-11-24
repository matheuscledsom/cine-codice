import { domainConfig, getStatusList } from '../config/domainConfig.js';
import {
  getWatchedEpisodesCount,
  getWatchedMinutes,
} from '../utils/backlogHelpers.js';
import { isConfirmedUserRating } from './ratings.js';

export function formatDecadeLabel(decadeStart) {
  const d = Number(decadeStart);
  if (!Number.isInteger(d) || d < 1880) return 'Outras';
  if (d >= 1900 && d < 2000) {
    return `Anos ${d - 1900}`;
  }
  return `Anos ${d}`;
}

export function computeSpectatorMetrics(items = []) {
  const { cardFields, workTypes } = domainConfig;
  const statuses = getStatusList();

  const backlogItems = (Array.isArray(items) ? items : []).filter(
    (item) => item && item.inBacklog !== false
  );

  const totalCount = backlogItems.length;
  const completedItems = backlogItems.filter((item) => item.status === 'completed');
  const completedCount = completedItems.length;
  const inProgressCount = backlogItems.filter(
    (item) =>
      item.status === 'playing' ||
      item.status === 'in-progress' ||
      item.status === 'rewatching'
  ).length;

  const watchedMinutes = backlogItems.reduce(
    (sum, item) => sum + getWatchedMinutes(item),
    0
  );
  const watchedHours = Math.round((watchedMinutes / 60) * 10) / 10;
  const equivalentDays = Math.round((watchedHours / 24) * 10) / 10;
  const heroTimeLabel = `${watchedHours} h · ~${equivalentDays} dias de cinema`;

  const episodesWatched = backlogItems.reduce(
    (sum, item) => sum + getWatchedEpisodesCount(item),
    0
  );

  const rated = backlogItems.filter(
    (item) => isConfirmedUserRating(item) && Number(item[cardFields.rating]) > 0
  );
  const avgRatingValue = rated.length
    ? Math.round(
        rated.reduce((sum, item) => sum + Number(item[cardFields.rating] || 0), 0) /
          rated.length
      )
    : null;

  // 2. Distribuição por Formato (Filmes, Séries e Animes — Horas & Títulos)
  const rawFormats = workTypes.map((type) => {
    const matching = backlogItems.filter(
      (item) => (item.workType || 'movie') === type.id
    );
    const count = matching.length;
    const completed = matching.filter((item) => item.status === 'completed').length;
    const mins = matching.reduce((sum, item) => sum + getWatchedMinutes(item), 0);
    const hours = Math.round((mins / 60) * 10) / 10;
    const eps = matching.reduce((sum, item) => sum + getWatchedEpisodesCount(item), 0);
    return {
      ...type,
      count,
      completedCount: completed,
      watchedMinutes: mins,
      watchedHours: hours,
      episodesWatched: eps,
    };
  });

  const maxFormatHours = Math.max(
    ...rawFormats.map((f) => f.watchedHours),
    1
  );
  const maxFormatCount = Math.max(
    ...rawFormats.map((f) => f.count),
    1
  );

  const formatDistribution = rawFormats.map((f) => ({
    ...f,
    countSharePct: totalCount > 0 ? Math.round((f.count / totalCount) * 100) : 0,
    hoursSharePct:
      watchedMinutes > 0 ? Math.round((f.watchedMinutes / watchedMinutes) * 100) : 0,
    hoursBarPct:
      f.watchedHours > 0 ? Math.max(6, Math.round((f.watchedHours / maxFormatHours) * 100)) : 0,
    countBarPct:
      f.count > 0 ? Math.max(6, Math.round((f.count / maxFormatCount) * 100)) : 0,
  }));

  // 3. Linha do Tempo por Década (Anos 70, 80, 90, 2000, 2010, 2020...)
  const decadeMap = new Map();
  backlogItems.forEach((item) => {
    const year = Number(item.releaseYear);
    if (!Number.isInteger(year) || year < 1890 || year > 2099) return;
    const decade = Math.floor(year / 10) * 10;
    const mins = getWatchedMinutes(item);
    const prev = decadeMap.get(decade) || {
      decade,
      label: formatDecadeLabel(decade),
      count: 0,
      watchedMinutes: 0,
    };
    decadeMap.set(decade, {
      ...prev,
      count: prev.count + 1,
      watchedMinutes: prev.watchedMinutes + mins,
    });
  });

  const rawDecades = Array.from(decadeMap.values()).sort((a, b) => a.decade - b.decade);
  const maxDecadeCount = Math.max(...rawDecades.map((d) => d.count), 1);
  const maxDecadeMins = Math.max(...rawDecades.map((d) => d.watchedMinutes), 1);

  const decadeDistribution = rawDecades.map((d) => {
    const watchedHoursDecade = Math.round((d.watchedMinutes / 60) * 10) / 10;
    const weightScore =
      d.watchedMinutes > 0
        ? Math.round((d.watchedMinutes / maxDecadeMins) * 100)
        : Math.round((d.count / maxDecadeCount) * 100);
    return {
      ...d,
      watchedHours: watchedHoursDecade,
      barPct: Math.max(8, weightScore),
    };
  });

  const topDecade =
    [...decadeDistribution].sort(
      (a, b) => b.watchedMinutes - a.watchedMinutes || b.count - a.count
    )[0] || null;

  // 4. Top Diretores, Estúdios & Gêneros (baseado em horas acumuladas e obras)
  const buildRanking = (extractKeys) => {
    const map = new Map();
    backlogItems.forEach((item) => {
      const keys = extractKeys(item);
      const mins = getWatchedMinutes(item);
      keys.forEach((key) => {
        const current = map.get(key) || { label: key, count: 0, mins: 0 };
        map.set(key, {
          label: key,
          count: current.count + 1,
          mins: current.mins + mins,
        });
      });
    });

    const sorted = Array.from(map.values())
      .sort((a, b) => b.mins - a.mins || b.count - a.count)
      .slice(0, 6);

    const maxMins = sorted[0]?.mins || 0;
    const maxCount = sorted[0]?.count || 1;
    return sorted.map((entry) => {
      const hours = Math.round((entry.mins / 60) * 10) / 10;
      const pct =
        maxMins > 0
          ? Math.max(8, Math.round((entry.mins / maxMins) * 100))
          : Math.max(8, Math.round((entry.count / maxCount) * 100));
      return {
        ...entry,
        hours,
        pct,
      };
    });
  };

  const topCreators = buildRanking((item) => {
    const raw = [item.director, item.studio, item[cardFields.creator]]
      .filter(Boolean)
      .join(', ');
    return raw
      ? Array.from(
          new Set(
            String(raw)
              .split(/[;,]/)
              .map((c) => c.trim())
              .filter(Boolean)
          )
        )
      : [];
  });

  const topGenres = buildRanking((item) =>
    Array.isArray(item[cardFields.genres]) ? item[cardFields.genres] : []
  );

  const statusCounts = statuses.map((status) => {
    const count = backlogItems.filter((item) => item.status === status.id).length;
    const pct = totalCount > 0 ? Math.round((count / totalCount) * 100) : 0;
    return { ...status, count, pct };
  });

  return {
    totalCount,
    completedCount,
    inProgressCount,
    watchedMinutes,
    watchedHours,
    equivalentDays,
    heroTimeLabel,
    episodesWatched,
    avgRatingValue,
    avgRating: avgRatingValue !== null ? `${avgRatingValue}/100` : '—',
    formatDistribution,
    decadeDistribution,
    topDecade,
    topCreators,
    topGenres,
    statusCounts,
  };
}
