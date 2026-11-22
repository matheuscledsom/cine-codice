import { domainConfig } from '../config/domainConfig.js';
import { isConfirmedUserRating } from '../lib/ratings.js';
import { getWatchedEpisodesCount, getWatchedMinutes } from './backlogHelpers.js';

export function buildWrappedSummary({
  items = [],
  streakCount = 0,
  period = 'year',
  targetYear = domainConfig.currentYear,
} = {}) {
  const safeItems = (Array.isArray(items) ? items : []).filter(
    (i) => i && i.inBacklog !== false
  );

  const scopedItems =
    period === 'all'
      ? safeItems
      : safeItems.filter((item) => {
          const compYear = Number(
            item.completedYear ||
              (item.completedDate ? String(item.completedDate).slice(0, 4) : 0)
          );
          if (compYear === targetYear) return true;
          return (
            (item.status === 'playing' || item.status === 'rewatching') &&
            String(item.updatedAt || '').startsWith(String(targetYear))
          );
        });

  const completed = scopedItems.filter((i) => i.status === 'completed');
  const totalMinutesWatched = scopedItems.reduce((sum, i) => sum + getWatchedMinutes(i), 0);
  const hoursWatched = Math.round((totalMinutesWatched / 60) * 10) / 10;
  const episodesWatched = scopedItems.reduce(
    (sum, i) => sum + getWatchedEpisodesCount(i),
    0
  );

  const genreCounts = new Map();
  const creatorCounts = new Map();

  scopedItems.forEach((item) => {
    if (Array.isArray(item.genres)) {
      item.genres.forEach((g) => {
        const clean = String(g || '').trim();
        if (clean) genreCounts.set(clean, (genreCounts.get(clean) || 0) + 1);
      });
    }
    const creator = String(item.director || item.studio || '').trim();
    if (creator) {
      creator
        .split(/[;,]/)
        .map((a) => a.trim())
        .filter(Boolean)
        .forEach((a) => creatorCounts.set(a, (creatorCounts.get(a) || 0) + 1));
    }
  });

  const topGenre =
    Array.from(genreCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ||
    'Sessão Livre';
  const topCreator =
    Array.from(creatorCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ||
    'Direções diversas';

  const rated = completed
    .filter((i) => isConfirmedUserRating(i))
    .sort((a, b) => (b.rating || 0) - (a.rating || 0));

  const topWork = rated[0] || completed[0] || scopedItems[0] || null;

  const avgRating = rated.length
    ? Math.round(rated.reduce((s, i) => s + (i.rating || 0), 0) / rated.length)
    : null;

  return {
    periodLabel: period === 'all' ? 'Cinemateca Completa' : `Cine Wrapped ${targetYear}`,
    totalScopedCount: scopedItems.length,
    completedCount: completed.length,
    totalMinutesWatched,
    hoursWatched,
    episodesWatched,
    topGenre,
    topCreator,
    topWorkTitle: topWork?.title || 'Sua Próxima Sessão',
    avgRating,
    streakCount: Math.max(0, Number(streakCount) || 0),
  };
}
