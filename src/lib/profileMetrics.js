/**
 * Métricas reais e seleção de banner para o Perfil (Fase 6 / D7 / R6):
 * Módulo puro em .js sem React/CSS/DOM.
 *
 * Fórmulas:
 * - Obras: total no acervo (inBacklog !== false) e total com status === 'completed'.
 * - Episódios / Horas: soma episódios assistidos e apenas as durações conhecidas
 *   (filmes com totalSeconds > 0 ou durationMinutes > 0; séries/animes com
 *   episodeDurationMinutes > 0 ou durationMinutes > 0). Obras ativas/concluídas
 *   sem duração conhecida são excluídas da soma de horas e contadas em unknownDurationCount.
 * - Média Geral: média aritmética simples das notas confirmadas do usuário
 *   (isConfirmedUserRating === true, excluindo ratingSource === 'legacy-default');
 *   retorna averageRating: null e averageRatingLabel: '—' quando nenhuma obra tem nota.
 */

import {
  getWatchedEpisodesCount,
  isEpisodicWork,
} from '../utils/backlogHelpers.js';
import { isConfirmedUserRating } from './ratings.js';

function getMovieKnownTotalMinutes(work) {
  const durMin = Number(work?.durationMinutes);
  if (Number.isFinite(durMin) && durMin > 0) return Math.round(durMin);
  const totalSec = Number(work?.totalSeconds);
  if (Number.isFinite(totalSec) && totalSec > 0) return Math.round(totalSec / 60);
  return 0;
}

function getKnownEpisodeDurationMinutes(work) {
  const epDur = Number(work?.episodeDurationMinutes);
  if (Number.isFinite(epDur) && epDur > 0) return epDur;
  const durMin = Number(work?.durationMinutes);
  if (Number.isFinite(durMin) && durMin > 0) return durMin;
  return 0;
}

/**
 * Seleciona o backdropUrl da obra em andamento mais recente para o banner do Perfil.
 * Se não houver obra ativa com backdropUrl válida, retorna null (fallback para gradiente do tema).
 */
export function resolveProfileHeroBackdrop(items = []) {
  const active = (Array.isArray(items) ? items : [])
    .filter(
      (w) =>
        w &&
        w.inBacklog !== false &&
        (w.status === 'playing' || w.status === 'rewatching') &&
        typeof w.backdropUrl === 'string' &&
        /^https?:\/\//i.test(w.backdropUrl.trim())
    )
    .sort((a, b) => {
      const tA = Date.parse(a.updatedAt || a.createdAt || '') || 0;
      const tB = Date.parse(b.updatedAt || b.createdAt || '') || 0;
      return tB - tA;
    });

  if (active.length === 0) return null;
  return {
    workId: active[0].id,
    title: active[0].title || '',
    backdropUrl: active[0].backdropUrl.trim().replace(/^http:\/\//i, 'https://'),
  };
}

export function formatWatchedHoursLabel(totalMinutes = 0) {
  const mins = Math.max(0, Math.round(Number(totalMinutes) || 0));
  if (mins === 0) return '0h';
  const hours = Math.round((mins / 60) * 10) / 10;
  return `${hours}h`;
}

export function computeProfileMetrics(items = []) {
  const backlog = (Array.isArray(items) ? items : []).filter(
    (item) => item && item.inBacklog !== false
  );

  const totalWorks = backlog.length;
  const completedWorks = backlog.filter((w) => w.status === 'completed').length;

  let episodesWatched = 0;
  let knownDurationMinutes = 0;
  let unknownDurationCount = 0;

  for (const work of backlog) {
    if (isEpisodicWork(work)) {
      const eps = getWatchedEpisodesCount(work);
      episodesWatched += eps;

      if (work.status !== 'queued' || eps > 0) {
        const epDur = getKnownEpisodeDurationMinutes(work);
        if (epDur > 0) {
          knownDurationMinutes += Math.round(eps * epDur);
        } else if (eps > 0 || work.status === 'completed' || work.status === 'playing' || work.status === 'rewatching') {
          unknownDurationCount += 1;
        }
      }
      continue;
    }

    const movieKnownMin = getMovieKnownTotalMinutes(work);
    const rewatchBonus = Math.max(0, Number(work.rewatchCount) || 0);
    if (movieKnownMin > 0) {
      if (work.status === 'completed') {
        knownDurationMinutes += movieKnownMin * (1 + rewatchBonus);
      } else if (work.status !== 'queued') {
        const activeMin = Math.round((Number(work.currentSeconds) || 0) / 60);
        knownDurationMinutes += activeMin + movieKnownMin * rewatchBonus;
      }
    } else if (
      work.status === 'completed' ||
      Number(work.currentSeconds) > 0 ||
      rewatchBonus > 0
    ) {
      unknownDurationCount += 1;
    }
  }

  const confirmedScores = backlog
    .filter((w) => isConfirmedUserRating(w))
    .map((w) => Number(w.rating));

  const ratedWorksCount = confirmedScores.length;
  const averageRating =
    ratedWorksCount > 0
      ? Math.round((confirmedScores.reduce((acc, s) => acc + s, 0) / ratedWorksCount) * 10) / 10
      : null;

  return {
    totalWorks,
    completedWorks,
    worksLabel: `${completedWorks}/${totalWorks} concluídas`,
    episodesWatched,
    knownDurationMinutes,
    watchedHours: Math.round((knownDurationMinutes / 60) * 10) / 10,
    watchedHoursLabel: formatWatchedHoursLabel(knownDurationMinutes),
    unknownDurationCount,
    ratedWorksCount,
    averageRating,
    averageRatingLabel: averageRating !== null ? String(averageRating) : '—',
  };
}
