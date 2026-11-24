import {
  domainConfig,
  getDomainMeta,
  inferDomainFromWork,
  normalizeDomainId,
} from '../config/domainConfig.js';
import { resolveGameRating11 } from '../lib/profileMetrics.js';
import { isConfirmedUserRating } from '../lib/ratings.js';
import { getWatchedEpisodesCount, getWatchedMinutes } from './backlogHelpers.js';

export function buildWrappedSummary({
  items = [],
  streakCount = 0,
  period = 'year',
  targetYear = domainConfig.currentYear,
  domain = 'global',
} = {}) {
  const isGlobal = !domain || domain === 'global';
  const cleanDomain = isGlobal ? 'global' : normalizeDomainId(domain);
  const domainMeta = isGlobal ? null : getDomainMeta(cleanDomain);

  const safeItems = (Array.isArray(items) ? items : []).filter((i) => {
    if (!i || i.inBacklog === false) return false;
    if (isGlobal) return true;
    return inferDomainFromWork(i) === cleanDomain;
  });

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
  const pagesRead = scopedItems.reduce(
    (sum, i) => sum + Math.max(0, Number(i.pagesRead) || 0),
    0
  );
  const chaptersRead = scopedItems.reduce(
    (sum, i) => sum + Math.max(0, Number(i.chaptersRead) || 0),
    0
  );
  const hoursPlayed =
    Math.round(
      scopedItems.reduce((sum, i) => sum + Math.max(0, Number(i.hoursPlayed) || 0), 0) * 10
    ) / 10;
  const totalListens = scopedItems.reduce(
    (sum, i) => sum + Math.max(0, Number(i.listenCount) || 0),
    0
  );

  const genreCounts = new Map();
  const creatorCounts = new Map();

  scopedItems.forEach((item) => {
    const genreList = Array.isArray(item.genres) ? [...item.genres] : [];
    if (cleanDomain === 'music' && item.subgenre) genreList.push(item.subgenre);
    genreList.forEach((g) => {
      const clean = String(g || '').trim();
      if (clean) genreCounts.set(clean, (genreCounts.get(clean) || 0) + 1);
    });

    const creator = String(
      item.creator || item.director || item.author || item.studio || ''
    ).trim();
    if (creator) {
      creator
        .split(/[;,]/)
        .map((a) => a.trim())
        .filter(Boolean)
        .forEach((a) => creatorCounts.set(a, (creatorCounts.get(a) || 0) + 1));
    }
  });

  const defaultGenreFallback =
    cleanDomain === 'reading'
      ? 'Leitura Livre'
      : cleanDomain === 'games'
        ? 'Jogatina Livre'
        : cleanDomain === 'music'
          ? 'Escuta Livre'
          : 'Catálogo Livre';

  const defaultCreatorFallback =
    cleanDomain === 'reading'
      ? 'Autores diversos'
      : cleanDomain === 'games'
        ? 'Estúdios diversos'
        : cleanDomain === 'music'
          ? 'Artistas diversos'
          : 'Criadores diversos';

  const topGenre =
    Array.from(genreCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ||
    defaultGenreFallback;
  const topCreator =
    Array.from(creatorCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ||
    defaultCreatorFallback;

  const ratedPositive = scopedItems
    .filter((i) => {
      if (cleanDomain === 'games') {
        const g11 = resolveGameRating11(i);
        return g11 !== null && g11 > 0;
      }
      return isConfirmedUserRating(i) && Number(i.rating) > 0;
    })
    .sort((a, b) => {
      if (cleanDomain === 'games') {
        return (resolveGameRating11(b) || 0) - (resolveGameRating11(a) || 0);
      }
      return (Number(b.rating) || 0) - (Number(a.rating) || 0);
    });

  const topWork = ratedPositive[0] || completed[0] || scopedItems[0] || null;

  let avgRating = null;
  let avgRatingDisplay = 'Sem notas';
  if (cleanDomain === 'games') {
    const scores11 = ratedPositive.map((i) => resolveGameRating11(i)).filter((s) => s !== null);
    if (scores11.length > 0) {
      avgRating =
        Math.round((scores11.reduce((s, n) => s + n, 0) / scores11.length) * 10) / 10;
      avgRatingDisplay = `${avgRating}/11`;
    }
  } else if (ratedPositive.length > 0) {
    avgRating = Math.round(
      ratedPositive.reduce((s, i) => s + Number(i.rating || 0), 0) / ratedPositive.length
    );
    avgRatingDisplay = `${avgRating}/100`;
  }

  let primaryMetricLabel = 'TEMPO & EPISÓDIOS';
  let primaryMetricValue = `${hoursWatched}h · ${episodesWatched} eps`;
  let completedLabel = 'OBRAS CONCLUÍDAS';
  let creatorLabel = 'DIREÇÃO / ESTÚDIO';
  let genreLabel = 'GÊNERO PRINCIPAL';

  if (cleanDomain === 'reading') {
    primaryMetricLabel = 'PÁGINAS & CAPÍTULOS';
    primaryMetricValue = `${pagesRead} págs · ${chaptersRead} cap.`;
    completedLabel = 'LEITURAS CONCLUÍDAS';
    creatorLabel = 'AUTOR(A) EM DESTAQUE';
  } else if (cleanDomain === 'games') {
    primaryMetricLabel = 'HORAS JOGADAS';
    primaryMetricValue = `${hoursPlayed}h · ${scopedItems.length} jogos`;
    completedLabel = 'ZERADOS / CONCLUÍDOS';
    creatorLabel = 'ESTÚDIO EM DESTAQUE';
  } else if (cleanDomain === 'music') {
    primaryMetricLabel = 'ESCUTAS & CATÁLOGO';
    primaryMetricValue = `${totalListens} escutas · ${scopedItems.length} itens`;
    completedLabel = 'ÁLBUNS / FAIXAS CONCLUÍDOS';
    creatorLabel = 'ARTISTA / BANDA EM DESTAQUE';
    genreLabel = 'SUBGÊNERO PRINCIPAL';
  } else if (cleanDomain === 'global') {
    const activeDomains = new Set(scopedItems.map((i) => inferDomainFromWork(i))).size;
    primaryMetricLabel = 'CATÁLOGO UNIFICADO';
    primaryMetricValue = `${scopedItems.length} obras · ${activeDomains} portais`;
    completedLabel = 'CONCLUÍDAS (GLOBAL)';
    creatorLabel = 'CRIADOR EM DESTAQUE';
  }

  const domainTag = domainMeta ? domainMeta.shortLabel.toUpperCase() : 'GLOBAL';
  const periodLabel =
    period === 'all'
      ? `Omni Wrapped · ${domainMeta ? domainMeta.label : 'Catálogo Global'}`
      : `Omni Wrapped ${targetYear} · ${domainMeta ? domainMeta.shortLabel : 'Global'}`;

  return {
    domain: cleanDomain,
    domainLabel: domainMeta ? domainMeta.label : 'Visão Global OmniPrism',
    brandTitle: `OMNI WRAPPED · ${domainTag}`,
    periodLabel,
    fileSlug: `omniprism-wrapped-${cleanDomain}-${period === 'all' ? 'all' : targetYear}.png`,
    totalScopedCount: scopedItems.length,
    completedCount: completed.length,
    completedLabel,
    primaryMetricLabel,
    primaryMetricValue,
    creatorLabel,
    genreLabel,
    totalMinutesWatched,
    hoursWatched,
    episodesWatched,
    pagesRead,
    chaptersRead,
    hoursPlayed,
    totalListens,
    topGenre,
    topCreator,
    topWorkTitle: topWork?.title || 'Sua Próxima Descoberta',
    avgRating,
    avgRatingDisplay,
    streakCount: Math.max(0, Number(streakCount) || 0),
  };
}
