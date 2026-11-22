/**
 * Lógica pura da Home (Fase 5 / D7): Hero em 4 estados, backfill de backdrop
 * com cooldown de 30 dias, pílulas de sessão (máx. 12), cálculos +1 Ep / +20 min
 * e trilhos locais sem chamadas de rede ou dependências de React/DOM.
 */

import { analyzeFranchises } from '../services/franchiseEngine.js';
import {
  advanceEpisodeProgress,
  advanceMovieSeconds,
  calculateWorkProgress,
  formatFlexibleProgressMetric,
  getHypeMeta,
  isEpisodicWork,
} from '../utils/backlogHelpers.js';
import { buildTimeCapsuleEntries } from '../utils/timeCapsule.js';
import { isConfirmedUserRating } from './ratings.js';

export const BACKDROP_RETRY_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
export const HOME_DISCOVERY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const HERO_QUICK_MINUTES_STEP = 20;
export const MAX_SESSION_PILLS = 12;
export const MAX_FAVORITE_SCENE_CHARS = 200;

function parseRecencyMs(work) {
  return Date.parse(work?.updatedAt || work?.createdAt || '') || 0;
}

export function sortByRecentActivity(works = []) {
  return [...(Array.isArray(works) ? works : [])]
    .filter(Boolean)
    .sort((a, b) => parseRecencyMs(b) - parseRecencyMs(a));
}

export function hasKnownWorkTotal(work) {
  if (!work) return false;
  if (isEpisodicWork(work)) {
    return Number(work.totalEpisodes) > 0;
  }
  const totalSec =
    Number(work.totalSeconds) ||
    (Number(work.durationMinutes) > 0 ? Number(work.durationMinutes) * 60 : 0) ||
    (Number(work.runtimeMinutes) > 0 ? Number(work.runtimeMinutes) * 60 : 0);
  return totalSec > 0;
}

export function formatHonestHeroProgressLabel(work) {
  if (!work) return '';
  if (isEpisodicWork(work)) {
    const sCur = Math.max(1, Number(work.currentSeason) || 1);
    const eCur = Math.max(0, Number(work.currentEpisode) || 0);
    if (!(Number(work.totalEpisodes) > 0)) {
      return `T${sCur} · Ep. ${eCur} assistidos`;
    }
  }
  return formatFlexibleProgressMetric(work);
}

/**
 * Seleciona um dos 4 estados obrigatórios do Hero:
 * - 'loading'      (d) carregando (skeleton)
 * - 'active'       (a) obra mais recente em Assistindo / Reassistindo
 * - 'queued'       (b) catálogo existe, nada em andamento -> destaque da fila Quero Ver ("Começar")
 * - 'library-idle' (b2) catálogo existe sem fila/ativos -> última obra catalogada
 * - 'empty'        (c) catálogo vazio -> boas-vindas com 1 botão ("Catalogar Primeira Obra")
 */
export function selectHeroPresentation(items = [], { loading = false } = {}) {
  if (loading) {
    return {
      state: 'loading',
      work: null,
      progressPct: 0,
      progressLabel: '',
      hasKnownTotal: false,
      isEpisodic: false,
    };
  }

  const backlog = (Array.isArray(items) ? items : []).filter(
    (item) => item && item.inBacklog !== false
  );

  if (backlog.length === 0) {
    return {
      state: 'empty',
      work: null,
      progressPct: 0,
      progressLabel: '',
      hasKnownTotal: false,
      isEpisodic: false,
    };
  }

  const active = sortByRecentActivity(
    backlog.filter(
      (i) =>
        i.status === 'playing' ||
        i.status === 'in-progress' ||
        i.status === 'rewatching'
    )
  );

  if (active.length > 0) {
    const heroWork = active[0];
    const knownTotal = hasKnownWorkTotal(heroWork);
    return {
      state: 'active',
      work: heroWork,
      progressPct: knownTotal ? calculateWorkProgress(heroWork) : null,
      progressLabel: formatHonestHeroProgressLabel(heroWork),
      hasKnownTotal: knownTotal,
      isEpisodic: isEpisodicWork(heroWork),
    };
  }

  const queued = backlog
    .filter((i) => i.status === 'queued')
    .sort((a, b) => {
      const hypeW =
        (getHypeMeta(b.hype)?.weight || 0) - (getHypeMeta(a.hype)?.weight || 0);
      if (hypeW !== 0) return hypeW;
      return parseRecencyMs(b) - parseRecencyMs(a);
    });

  if (queued.length > 0) {
    const picked = queued[0];
    const knownTotal = hasKnownWorkTotal(picked);
    return {
      state: 'queued',
      work: picked,
      progressPct: knownTotal ? calculateWorkProgress(picked) : null,
      progressLabel: 'Na fila Quero Ver',
      hasKnownTotal: knownTotal,
      isEpisodic: isEpisodicWork(picked),
    };
  }

  const fallbackRecent = sortByRecentActivity(backlog)[0];
  const knownTotal = hasKnownWorkTotal(fallbackRecent);
  return {
    state: 'library-idle',
    work: fallbackRecent,
    progressPct: knownTotal ? calculateWorkProgress(fallbackRecent) : null,
    progressLabel: formatHonestHeroProgressLabel(fallbackRecent),
    hasKnownTotal: knownTotal,
    isEpisodic: isEpisodicWork(fallbackRecent),
  };
}

/**
 * Hierarquia visual obrigatória do Hero:
 * backdropUrl > capa com desfoque > gradiente do tema.
 */
export function resolveHeroVisual(work) {
  if (!work || typeof work !== 'object') {
    return { mode: 'theme-gradient', imageUrl: null };
  }
  const cleanBackdrop =
    typeof work.backdropUrl === 'string' && /^https?:\/\//i.test(work.backdropUrl.trim())
      ? work.backdropUrl.trim().replace(/^http:\/\//i, 'https://')
      : null;
  if (cleanBackdrop) {
    return { mode: 'backdrop', imageUrl: cleanBackdrop };
  }

  const coverCandidate = [
    work.coverUrl,
    work.thumbnailUrl,
    ...(Array.isArray(work.coverSources) ? work.coverSources : []),
  ].find((u) => typeof u === 'string' && /^(https?:\/\/|data:image\/)/i.test(u.trim()));

  if (coverCandidate) {
    return {
      mode: 'blurred-cover',
      imageUrl: coverCandidate.trim().replace(/^http:\/\//i, 'https://'),
    };
  }

  return { mode: 'theme-gradient', imageUrl: null };
}

/**
 * Backfill silencioso do backdropUrl (Regra Extra 2):
 * - Nunca chama OMDb.
 * - Exige tmdbId ou anilistId.
 * - Só tenta 1 vez por obra se não tiver backdropUrl e não estiver no cooldown de 30 dias.
 */
export function shouldBackfillHeroBackdrop(work, nowMs = Date.now()) {
  if (!work || typeof work !== 'object') return false;
  if (work.backdropUrl && /^https?:\/\//i.test(String(work.backdropUrl).trim())) {
    return false;
  }
  const hasTmdb = Number(work.ids?.tmdb || work.tmdbId) > 0;
  const hasAnilist = Number(work.ids?.anilist || work.anilistId) > 0;
  if (!hasTmdb && !hasAnilist) return false;

  const lastChecked = Number(work.backdropCheckedAt) || 0;
  if (lastChecked > 0 && nowMs - lastChecked < BACKDROP_RETRY_COOLDOWN_MS) {
    return false;
  }

  return true;
}

/**
 * Calcula prévia segura de avanço rápido no Hero e pílulas:
 * - Episódico: +1 Ep; pede confirmação de conclusão ao atingir/passar do total conhecido.
 * - Filme/curta: +20 min; nunca passa da duração total conhecida.
 */
export function computeHeroAdvancePlan(work) {
  if (!work || typeof work !== 'object') return null;

  if (isEpisodicWork(work)) {
    const curEp = Math.max(0, Number(work.currentEpisode) || 0);
    const totalEps = Number(work.totalEpisodes) || 0;
    const nextRawEp = curEp + 1;
    const preview = advanceEpisodeProgress(work, { addEpisodes: 1 });
    const requiresCompletionConfirm =
      work.status !== 'completed' && totalEps > 0 && nextRawEp >= totalEps;
    const passesTotal = totalEps > 0 && nextRawEp > totalEps;

    return {
      kind: 'episode',
      addEpisodes: 1,
      addMinutes:
        Number(work.episodeDurationMinutes) || (work.workType === 'anime' ? 24 : 45),
      nextSeason: preview.currentSeason,
      nextEpisode: preview.currentEpisode,
      nextProgressPct: preview.progress,
      passesTotal,
      requiresCompletionConfirm,
      actionLabel: '+1 Ep',
    };
  }

  const nextMovie = advanceMovieSeconds(work, HERO_QUICK_MINUTES_STEP);
  const totalSec = nextMovie.totalSeconds || 0;
  const currentSec = Math.max(0, Number(work.currentSeconds) || 0);
  const deltaSec = Math.max(0, nextMovie.currentSeconds - currentSec);
  const clampedMinutes = Math.round(deltaSec / 60);
  const reachesDuration = Boolean(totalSec > 0 && nextMovie.currentSeconds >= totalSec);

  return {
    kind: 'minutes',
    addEpisodes: 0,
    addMinutes: clampedMinutes > 0 ? clampedMinutes : 0,
    nextSeconds: nextMovie.currentSeconds,
    totalSeconds: totalSec,
    nextProgressPct: nextMovie.progress,
    requiresCompletionConfirm: false,
    reachesDuration,
    actionLabel: '+20 min',
  };
}

/**
 * Faixa de pílulas circulares por atividade recente (máx. 12 + "ver todas").
 */
export function buildHomeSessionPills(items = [], { maxCount = MAX_SESSION_PILLS } = {}) {
  const safeCap = Math.max(1, Math.min(MAX_SESSION_PILLS, Number(maxCount) || MAX_SESSION_PILLS));
  const backlog = (Array.isArray(items) ? items : []).filter(
    (item) =>
      item &&
      item.inBacklog !== false &&
      item.status !== 'completed' &&
      item.status !== 'dropped'
  );

  const statusPriority = {
    playing: 0,
    rewatching: 0,
    paused: 1,
    queued: 2,
  };

  const ordered = [...backlog].sort((a, b) => {
    const pDiff = (statusPriority[a.status] ?? 9) - (statusPriority[b.status] ?? 9);
    if (pDiff !== 0) return pDiff;
    return parseRecencyMs(b) - parseRecencyMs(a);
  });

  const pills = ordered.slice(0, safeCap).map((work) => {
    const episodic = isEpisodicWork(work);
    return {
      id: String(work.id),
      work,
      title: work.title || 'Obra sem título',
      progressPct: calculateWorkProgress(work),
      isEpisodic: episodic,
      nextActionLabel: episodic ? '+1 Ep' : '+20 min',
    };
  });

  return {
    pills,
    totalCount: ordered.length,
    hasMore: ordered.length > safeCap,
  };
}

/**
 * Constrói dados dos trilhos locais da Home (zero rede):
 * - Continuar Assistindo (exclui a obra ativa exibida no Hero; oculta se restar 0 obras)
 * - Franquias & Sagas (apenas franquias com >= 2 obras)
 * - Cápsula do Tempo & Destaques (memórias + destaques + cena/citação favorita)
 */
export function buildHomeLocalRails({
  items = [],
  readingSessions = [],
  dailyLogs = {},
  excludeHeroWorkId,
} = {}) {
  const backlog = (Array.isArray(items) ? items : []).filter(
    (item) => item && item.inBacklog !== false
  );

  const heroPresentation = selectHeroPresentation(backlog);
  const effectiveHeroWorkId =
    excludeHeroWorkId !== undefined
      ? excludeHeroWorkId
      : heroPresentation.state === 'active' && heroPresentation.work?.id
        ? heroPresentation.work.id
        : null;

  const continueWatching = sortByRecentActivity(
    backlog.filter(
      (i) =>
        (i.status === 'playing' ||
          i.status === 'in-progress' ||
          i.status === 'rewatching' ||
          i.status === 'paused') &&
        (!effectiveHeroWorkId || String(i.id) !== String(effectiveHeroWorkId))
    )
  ).map((work) => {
    const knownTotal = hasKnownWorkTotal(work);
    return {
      id: String(work.id),
      work,
      hasKnownTotal: knownTotal,
      progressPct: knownTotal ? calculateWorkProgress(work) : null,
      metricLabel: formatHonestHeroProgressLabel(work),
      confirmedRating: isConfirmedUserRating(work) ? work.rating : null,
    };
  });

  const franchises = analyzeFranchises(backlog)
    .filter((f) => f && f.totalCount >= 2)
    .map((f) => ({
      ...f,
      averageRating: f.stats?.franchiseAverageRating ?? null,
    }))
    .slice(0, 10);

  const capsuleEntries = buildTimeCapsuleEntries({
    items: backlog,
    readingSessions,
    dailyLogs,
  });

  const seenHighlightIds = new Set();
  const highlights = [];

  for (const cap of capsuleEntries) {
    if (cap.work?.id) seenHighlightIds.add(String(cap.work.id));
    highlights.push({
      id: `capsule-${cap.id}`,
      kind: 'capsule',
      badgeLabel: cap.badgeLabel,
      dateIso: cap.dateIso,
      title: cap.title,
      subtitle: cap.subtitle,
      quoteText: cap.quoteText || cap.work?.favoriteScene || '',
      work: cap.work || null,
      confirmedRating:
        cap.work && isConfirmedUserRating(cap.work) ? cap.work.rating : null,
    });
  }

  const featuredWorks = [...backlog]
    .filter(
      (i) =>
        Boolean(i.isPlatinum) ||
        Boolean(i.favoriteScene && String(i.favoriteScene).trim()) ||
        i.status === 'completed' ||
        i.status === 'playing' ||
        i.status === 'rewatching'
    )
    .sort((a, b) => {
      const pDiff = Number(Boolean(b.isPlatinum)) - Number(Boolean(a.isPlatinum));
      if (pDiff !== 0) return pDiff;
      const sDiff =
        Number(Boolean(b.favoriteScene && String(b.favoriteScene).trim())) -
        Number(Boolean(a.favoriteScene && String(a.favoriteScene).trim()));
      if (sDiff !== 0) return sDiff;
      return (
        (Date.parse(b.completedDate || b.updatedAt || b.createdAt || '') || 0) -
        (Date.parse(a.completedDate || a.updatedAt || a.createdAt || '') || 0)
      );
    })
    .slice(0, 12);

  for (const w of featuredWorks) {
    if (seenHighlightIds.has(String(w.id))) continue;
    seenHighlightIds.add(String(w.id));
    highlights.push({
      id: `highlight-${w.id}`,
      kind: 'highlight',
      badgeLabel: w.isPlatinum ? 'Obra-Prima' : w.favoriteScene ? 'Cena Marcante' : 'Destaque',
      dateIso: w.completedDate || String(w.updatedAt || '').slice(0, 10) || '',
      title: w.title,
      subtitle: w.director || w.studio || '',
      quoteText: String(w.favoriteScene || w.quotes?.[0]?.text || '').slice(
        0,
        MAX_FAVORITE_SCENE_CHARS
      ),
      work: w,
      confirmedRating: isConfirmedUserRating(w) ? w.rating : null,
    });
  }

  return {
    continueWatching,
    franchises,
    highlights: highlights.slice(0, 14),
  };
}

/**
 * Chip compacto de constância de sessões (zero terminologia de livro — R7).
 */
export function buildCompactStreakChip(streakProps = null) {
  if (!streakProps || typeof streakProps !== 'object') return null;
  const count = Math.max(0, Number(streakProps.streakCount) || 0);
  const loggedToday = Boolean(streakProps.loggedToday);
  const isPaused = Boolean(streakProps.isPaused);
  const isRestDayToday = Boolean(streakProps.isRestDayToday);

  return {
    count,
    loggedToday,
    isPaused,
    isRestDayToday,
    daysLabel: count === 1 ? '1 dia seguido' : `${count} dias seguidos`,
    ctaLabel: loggedToday ? 'Sessão de hoje salva' : 'Registrar Sessão Hoje',
  };
}
