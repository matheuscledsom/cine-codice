/**
 * Métricas reais e seleção de banner para o Perfil (Fase 6 / D7 / R6):
 * Módulo puro em .js sem React/CSS/DOM.
 *
 * Fórmulas:
 * - Obras: total no catálogo (inBacklog !== false) e total com status === 'completed'.
 * - Episódios / Horas: soma episódios assistidos e apenas as durações conhecidas
 *   (filmes com totalSeconds > 0 ou durationMinutes > 0; séries/animes com
 *   episodeDurationMinutes > 0 ou durationMinutes > 0). Obras ativas/concluídas
 *   sem duração conhecida são excluídas da soma de horas e contadas em unknownDurationCount.
 * - Média Geral: média aritmética simples das notas confirmadas do usuário
 *   (isConfirmedUserRating === true, excluindo ratingSource === 'legacy-default');
 *   retorna averageRating: null e averageRatingLabel: '—' quando nenhuma obra tem nota.
 */

import {
  GAME_EDITION_TYPES,
  GAME_PLATFORM_UNSET_LABEL,
  OMNIPRISM_DOMAINS,
  getDomainMeta,
  getDomainVocabulary,
  getMediaTypesForDomain,
  getWorkTypeLabel,
  inferDomainFromWork,
  normalizeDomainId,
  normalizeGameEditionType,
  normalizeWorkTypeForDomain,
} from '../config/domainConfig.js';
import {
  computeStrictCompletionProgress,
  getWatchedEpisodesCount,
  isEpisodicWork,
} from '../utils/backlogHelpers.js';
import { computeWorkCritiqueBadge } from './ratingBadges.js';
import { isConfirmedUserRating } from './ratings.js';
import { computeSpectatorMetrics } from './statsEngine.js';

export function isPositiveConfirmedUserRating(work) {
  if (!work || typeof work !== 'object') return false;
  if (work.ratingSource === 'legacy-default') return false;
  if (
    inferDomainFromWork(work) === 'games' &&
    work.gameRating11 !== null &&
    work.gameRating11 !== undefined &&
    work.gameRating11 !== ''
  ) {
    const g = Number(work.gameRating11);
    if (Number.isFinite(g) && g > 0 && g <= 11) return true;
  }
  return isConfirmedUserRating(work) && Number(work.rating) > 0;
}

export function resolveGameRating11(work) {
  if (!work || typeof work !== 'object') return null;
  if (work.ratingSource === 'legacy-default') return null;
  if (
    work.gameRating11 !== null &&
    work.gameRating11 !== undefined &&
    work.gameRating11 !== ''
  ) {
    const g = Number(work.gameRating11);
    if (Number.isFinite(g) && g > 0 && g <= 11) {
      return Math.round(g * 10) / 10;
    }
    return null;
  }
  if (isConfirmedUserRating(work) && Number(work.rating) > 0) {
    return Math.round((Number(work.rating) / 10) * 10) / 10;
  }
  return null;
}

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
 * Seleciona a imagem de banner da obra em andamento mais recente para o Perfil.
 * - Sem `activeDomain` (legado): exige `backdropUrl` válida, retornando null se não houver.
 * - Com `activeDomain`: filtra pelo domínio ativo e aceita `backdropUrl` OU `coverUrl`
 *   (para que livros, games e álbuns usem sua capa sem ficar presos a cinema).
 * Se não houver obra ativa com imagem válida, retorna null (fallback para gradiente do tema).
 */
export function resolveProfileHeroBackdrop(items = [], activeDomain = null) {
  const scopedDomain = activeDomain ? normalizeDomainId(activeDomain) : null;
  const active = (Array.isArray(items) ? items : [])
    .filter((w) => {
      if (!w || w.inBacklog === false) return false;
      const isActive =
        w.status === 'playing' || w.status === 'in-progress' || w.status === 'rewatching';
      if (!isActive) return false;
      if (scopedDomain && inferDomainFromWork(w) !== scopedDomain) return false;

      const hasBackdrop =
        typeof w.backdropUrl === 'string' && /^https?:\/\//i.test(w.backdropUrl.trim());
      if (hasBackdrop) return true;

      if (scopedDomain) {
        const hasCover =
          typeof w.coverUrl === 'string' &&
          /^(https?:\/\/|data:image\/)/i.test(w.coverUrl.trim());
        return hasCover;
      }
      return false;
    })
    .sort((a, b) => {
      const tA = Date.parse(a.updatedAt || a.createdAt || '') || 0;
      const tB = Date.parse(b.updatedAt || b.createdAt || '') || 0;
      return tB - tA;
    });

  if (active.length === 0) return null;
  const top = active[0];
  const hasBackdrop =
    typeof top.backdropUrl === 'string' && /^https?:\/\//i.test(top.backdropUrl.trim());
  const rawUrl = hasBackdrop ? top.backdropUrl.trim() : String(top.coverUrl || '').trim();
  const cleanUrl = rawUrl.replace(/^http:\/\//i, 'https://');

  if (!scopedDomain) {
    return {
      workId: top.id,
      title: top.title || '',
      backdropUrl: cleanUrl,
    };
  }

  const domain = inferDomainFromWork(top);
  const vocab = getDomainVocabulary(domain);
  const statusKey = top.status === 'rewatching' ? 'rewatching' : 'playing';

  return {
    workId: top.id,
    title: top.title || '',
    domain,
    statusLabel: vocab.statuses[statusKey],
    backdropUrl: cleanUrl,
    imageUrl: cleanUrl,
    isCoverFallback: !hasBackdrop,
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
    .filter((w) => isConfirmedUserRating(w) && Number(w.rating) > 0)
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

export const PROFILE_AVATAR_EMBLEMS = [
  { id: 'Film', label: 'Película 35mm' },
  { id: 'Clapperboard', label: 'Claquete de Direção' },
  { id: 'Tv', label: 'Tela & Séries' },
  { id: 'Sparkles', label: 'Animação & Fantasia' },
  { id: 'Award', label: 'Palma de Ouro' },
  { id: 'Compass', label: 'Explorador de Catálogo' },
  { id: 'Flame', label: 'Sessão Contínua' },
  { id: 'Star', label: 'Crítica & Curadoria' },
];

/**
 * Monta os 4 slots da vitrine "Favoritos da Vida" (Top 4) a partir de favoriteRank (1..4).
 * Quando `domain` é informado, filtra as obras pelo domínio selecionado (Filmes, Livros, Games, Música).
 */
export function resolveTop4Favorites(items = [], domain = null) {
  const targetDomain = domain ? normalizeDomainId(domain) : null;
  const backlog = (Array.isArray(items) ? items : []).filter((item) => {
    if (!item || item.inBacklog === false) return false;
    if (targetDomain && inferDomainFromWork(item) !== targetDomain) return false;
    return true;
  });

  const byRank = new Map();
  for (const work of backlog) {
    const rank = Number(work.favoriteRank);
    if (Number.isInteger(rank) && rank >= 1 && rank <= 4 && !byRank.has(rank)) {
      byRank.set(rank, work);
    }
  }

  return [1, 2, 3, 4].map((slot) => ({
    slot,
    work: byRank.get(slot) || null,
  }));
}

/**
 * Constrói o feed pessoal dinâmico com Últimas Avaliações, Episódios Vistos & Cenas Favoritas
 * extraídas automaticamente do catálogo do espectador.
 */
export function buildProfilePersonalFeed(items = [], posts = [], { limit = 16 } = {}) {
  const backlog = (Array.isArray(items) ? items : []).filter(
    (item) => item && item.inBacklog !== false
  );

  const entries = [];

  for (const work of backlog) {
    const timestamp =
      Date.parse(work.updatedAt || work.completedDate || work.createdAt || '') || 0;
    const confirmedScore = isConfirmedUserRating(work) ? Number(work.rating) : null;
    const sceneText =
      String(work.favoriteScene || '').trim() ||
      (Array.isArray(work.quotes) && work.quotes[0]?.text
        ? String(work.quotes[0].text).trim()
        : '');
    const reviewText = String(work.notes || work.fichamento || '').trim();
    const epsWatched = isEpisodicWork(work) ? getWatchedEpisodesCount(work) : 0;

    if (sceneText) {
      entries.push({
        id: `feed-scene-${work.id}`,
        kind: 'scene',
        badge: 'Cena Marcante',
        workId: work.id,
        work,
        title: work.title,
        quoteText: sceneText,
        rating: confirmedScore,
        timestamp: timestamp + 2,
      });
    }

    if (confirmedScore !== null || reviewText) {
      entries.push({
        id: `feed-review-${work.id}`,
        kind: 'review',
        badge: confirmedScore !== null ? `Avaliação · ${confirmedScore}/100` : 'Crítica Pessoal',
        workId: work.id,
        work,
        title: work.title,
        reviewText,
        rating: confirmedScore,
        timestamp: timestamp + 1,
      });
    } else if (epsWatched > 0 || work.status === 'completed' || work.status === 'playing') {
      entries.push({
        id: `feed-progress-${work.id}`,
        kind: 'progress',
        badge:
          work.status === 'completed'
            ? 'Concluída'
            : isEpisodicWork(work)
              ? `T${work.currentSeason || 1} · Ep. ${work.currentEpisode || epsWatched}`
              : 'Em Sessão',
        workId: work.id,
        work,
        title: work.title,
        rating: null,
        timestamp,
      });
    }
  }

  for (const post of Array.isArray(posts) ? posts : []) {
    if (!post?.id) continue;
    const linked = post.itemId ? backlog.find((w) => w.id === post.itemId) : null;
    entries.push({
      id: `feed-post-${post.id}`,
      kind: 'post',
      badge: post.progressMarker || 'Diário de Sessão',
      workId: linked?.id || post.itemId || null,
      work: linked || post.itemSnapshot || null,
      post,
      title: post.title || linked?.title || 'Nota de Sessão',
      reviewText: post.content || '',
      timestamp: Date.parse(post.createdAt || '') || 0,
    });
  }

  return entries
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, Math.max(1, Number(limit) || 16));
}

/**
 * Histograma de Notas (0–100) inspirado no Letterboxd / Serializd.
 * Agrupa notas confirmadas pelo usuário em 10 intervalos (0–10, 11–20, ..., 91–100).
 */
export function computeRatingHistogram(items = []) {
  const backlog = (Array.isArray(items) ? items : []).filter(
    (item) => item && item.inBacklog !== false && isConfirmedUserRating(item)
  );

  const BUCKETS = [
    { key: '0-10', label: '10', min: 0, max: 10, count: 0 },
    { key: '11-20', label: '20', min: 11, max: 20, count: 0 },
    { key: '21-30', label: '30', min: 21, max: 30, count: 0 },
    { key: '31-40', label: '40', min: 31, max: 40, count: 0 },
    { key: '41-50', label: '50', min: 41, max: 50, count: 0 },
    { key: '51-60', label: '60', min: 51, max: 60, count: 0 },
    { key: '61-70', label: '70', min: 61, max: 70, count: 0 },
    { key: '71-80', label: '80', min: 71, max: 80, count: 0 },
    { key: '81-90', label: '90', min: 81, max: 90, count: 0 },
    { key: '91-100', label: '100', min: 91, max: 100, count: 0 },
  ];

  let maxCount = 0;
  for (const work of backlog) {
    const score = Number(work.rating);
    if (!Number.isFinite(score)) continue;
    const bucket = BUCKETS.find((b) => score >= b.min && score <= b.max);
    if (bucket) {
      bucket.count += 1;
      if (bucket.count > maxCount) maxCount = bucket.count;
    }
  }

  return {
    totalRated: backlog.length,
    maxCount,
    buckets: BUCKETS.map((b) => ({
      ...b,
      percentage: maxCount > 0 ? Math.round((b.count / maxCount) * 100) : 0,
    })),
  };
}

/**
 * Monta lista de obras recentes para a vitrine "Atividade Recente" do perfil editorial:
 * Retorna as obras recentemente assistidas, avaliadas ou anotadas com selos comparativos.
 */
export function computeRecentActivityWorks(items = [], limit = 8) {
  const backlog = (Array.isArray(items) ? items : []).filter(
    (item) => item && item.inBacklog !== false
  );

  return backlog
    .filter((w) => {
      const hasRating = isConfirmedUserRating(w);
      const isWatchedOrActive =
        w.status === 'completed' || w.status === 'playing' || w.status === 'rewatching';
      const hasNotes = Boolean(String(w.notes || w.fichamento || '').trim());
      const hasScene = Boolean(String(w.favoriteScene || '').trim());
      return hasRating || isWatchedOrActive || hasNotes || hasScene;
    })
    .sort((a, b) => {
      const tA = Date.parse(a.updatedAt || a.completedDate || a.createdAt || '') || 0;
      const tB = Date.parse(b.updatedAt || b.completedDate || b.createdAt || '') || 0;
      return tB - tA;
    })
    .slice(0, Math.max(1, limit))
    .map((work) => {
      const confirmedScore = isConfirmedUserRating(work) ? Number(work.rating) : null;
      const critiqueBadge = computeWorkCritiqueBadge(work);
      const hasNotes = Boolean(String(work.notes || work.fichamento || '').trim());
      const hasScene = Boolean(String(work.favoriteScene || '').trim());
      return {
        id: work.id,
        work,
        rating: confirmedScore,
        critiqueBadge,
        hasNotes,
        hasScene,
      };
    });
}

/**
 * Resumo estatístico consolidado dos 4 mundos OmniPrism:
 * Cinema & Séries, Leitura & Acadêmico, Games e Música.
 */
export function computeDomainBreakdownMetrics(items = []) {
  const backlog = (Array.isArray(items) ? items : []).filter(
    (item) => item && item.inBacklog !== false
  );

  return OMNIPRISM_DOMAINS.map((dom) => {
    const domainWorks = backlog.filter((w) => inferDomainFromWork(w) === dom.id);
    const completedWorks = domainWorks.filter((w) => w.status === 'completed').length;
    const rated = domainWorks.filter((w) => isPositiveConfirmedUserRating(w));
    const ratingSum = rated.reduce((sum, w) => sum + Number(w.rating || 0), 0);
    const averageRating = rated.length > 0 ? Math.round(ratingSum / rated.length) : null;
    const favoritesCount = domainWorks.filter(
      (w) =>
        Boolean(w.isFavorite) ||
        (Number.isInteger(Number(w.favoriteRank)) &&
          Number(w.favoriteRank) >= 1 &&
          Number(w.favoriteRank) <= 4)
    ).length;

    let progressSummary = '';
    if (dom.id === 'reading') {
      const pages = domainWorks.reduce(
        (sum, w) => sum + Math.max(0, Number(w.pagesRead) || 0),
        0
      );
      progressSummary = `${pages} págs lidas`;
    } else if (dom.id === 'games') {
      const hours = domainWorks.reduce(
        (sum, w) => sum + Math.max(0, Number(w.hoursPlayed) || 0),
        0
      );
      const rounded = Number.isInteger(hours) ? hours : Number(hours.toFixed(1));
      progressSummary = `${rounded}h jogadas`;
    } else if (dom.id === 'music') {
      const listens = domainWorks.reduce(
        (sum, w) => sum + Math.max(0, Number(w.listenCount) || 0),
        0
      );
      progressSummary = `${listens} audições`;
    } else {
      const eps = domainWorks.reduce(
        (sum, w) => sum + (isEpisodicWork(w) ? getWatchedEpisodesCount(w) : 0),
        0
      );
      progressSummary = `${eps} eps`;
    }

    const vocab = getDomainVocabulary(dom.id);
    return {
      domainId: dom.id,
      label: dom.label,
      shortLabel: dom.shortLabel,
      tabLabel: dom.tabLabel || dom.shortLabel,
      completedLabel: vocab.statuses.completed,
      tintHex: dom.tintHex,
      totalWorks: domainWorks.length,
      completedWorks,
      ratedWorksCount: rated.length,
      averageRating,
      averageRatingLabel: averageRating !== null ? String(averageRating) : '—',
      favoritesCount,
      progressSummary,
    };
  });
}

function buildGenericRanking(items = [], extractKeys, extractWeight, formatMetric) {
  const map = new Map();
  for (const item of items) {
    const keys = extractKeys(item);
    const weight = Math.max(0, Number(extractWeight(item)) || 0);
    for (const rawKey of keys) {
      const label = String(rawKey || '').trim();
      if (!label) continue;
      const prev = map.get(label) || { label, count: 0, weight: 0 };
      map.set(label, {
        label,
        count: prev.count + 1,
        weight: prev.weight + weight,
      });
    }
  }

  const sorted = Array.from(map.values())
    .sort((a, b) => b.weight - a.weight || b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 5);

  const maxWeight = sorted[0]?.weight || 0;
  const maxCount = sorted[0]?.count || 1;

  return sorted.map((entry) => {
    const pct =
      maxWeight > 0
        ? Math.max(8, Math.round((entry.weight / maxWeight) * 100))
        : Math.max(8, Math.round((entry.count / maxCount) * 100));
    return {
      label: entry.label,
      count: entry.count,
      weight: entry.weight,
      metricText: formatMetric(entry),
      pct,
    };
  });
}

function splitCreatorNames(item) {
  const raw = [item?.creator, item?.director, item?.author, item?.studio]
    .filter(Boolean)
    .join(', ');
  if (!raw) return [];
  return Array.from(
    new Set(
      String(raw)
        .split(/[;,]/)
        .map((c) => c.trim())
        .filter(Boolean)
    )
  );
}

function extractGameFranchiseKey(item) {
  const explicit = String(item?.franchiseName || '').trim();
  if (explicit) return explicit;
  const rawTitle = String(item?.title || '').trim();
  if (!rawTitle) return '';
  const base = rawTitle
    .split(':')[0]
    .replace(/\s+(remake|remaster(ed)?|hd|definitive edition|goty|part\s+\w+|\d+|[ivx]+)$/i, '')
    .trim();
  return base || rawTitle;
}

/**
 * Calcula métricas dinâmicas completas para um domínio específico do OmniPrism
 * (`cinema`, `reading`, `games`, `music`), seguindo a regra matemática estrita:
 * - Nunca inventa porcentagens quando o total é desconhecido/zero ("Progresso aberto").
 * - Calcula médias apenas sobre obras realmente avaliadas (`rating > 0`).
 */
export function computeDomainStatsMetrics(items = [], domainId = 'cinema') {
  const cleanDomain = normalizeDomainId(domainId);
  const domainMeta = getDomainMeta(cleanDomain);
  const domainItems = (Array.isArray(items) ? items : []).filter(
    (w) => w && w.inBacklog !== false && inferDomainFromWork(w) === cleanDomain
  );

  const totalCount = domainItems.length;
  const completedCount = domainItems.filter((w) => w.status === 'completed').length;
  const inProgressCount = domainItems.filter(
    (w) => w.status === 'playing' || w.status === 'in-progress' || w.status === 'rewatching'
  ).length;
  const openProgressCount = domainItems.filter(
    (w) =>
      w.status !== 'completed' &&
      w.status !== 'queued' &&
      computeStrictCompletionProgress(w).isOpenProgress
  ).length;

  if (cleanDomain === 'cinema') {
    const cinema = computeSpectatorMetrics(domainItems);
    const ratedCount = domainItems.filter(
      (w) => isConfirmedUserRating(w) && Number(w.rating) > 0
    ).length;

    return {
      domainId: 'cinema',
      domainMeta,
      totalCount: cinema.totalCount,
      completedCount: cinema.completedCount,
      inProgressCount: cinema.inProgressCount,
      ratedCount,
      openProgressCount,
      watchedHours: cinema.watchedHours,
      equivalentDays: cinema.equivalentDays,
      episodesWatched: cinema.episodesWatched,
      avgRatingValue: cinema.avgRatingValue,
      avgRating: cinema.avgRating,
      topDecade: cinema.topDecade,
      formatDistribution: cinema.formatDistribution,
      decadeDistribution: cinema.decadeDistribution,
      kpis: [
        {
          id: 'hours',
          label: 'Horas em Tela',
          value: `${cinema.watchedHours} h`,
          sub: `Tempo Acumulado em Tela · ~${cinema.equivalentDays}d`,
          icon: 'Clock',
          highlight: true,
        },
        {
          id: 'episodes',
          label: 'Episódios Vistos',
          value: String(cinema.episodesWatched),
          sub:
            openProgressCount > 0
              ? `${cinema.inProgressCount} em andamento · Progresso aberto`
              : `${cinema.inProgressCount} em andamento`,
          icon: 'Film',
        },
        {
          id: 'completed',
          label: 'Obras Concluídas',
          value: String(cinema.completedCount),
          sub: `de ${cinema.totalCount} no catálogo`,
          icon: 'CheckCircle2',
        },
        {
          id: 'rating',
          label: 'Média Geral',
          value: cinema.avgRating,
          sub: cinema.topDecade
            ? `Era: ${cinema.topDecade.label}`
            : `${ratedCount} avaliadas`,
          icon: 'Star',
        },
      ],
      distribution: {
        primaryTabLabel: 'Formatos',
        primaryTitle: 'Distribuição por Formato (Horas & Títulos)',
        primaryEmptyMessage: 'Catalogue filmes, séries ou animes para ver a distribuição.',
        primaryRows: cinema.formatDistribution.map((fmt) => ({
          key: fmt.id,
          label: fmt.shortLabel,
          icon: fmt.icon,
          count: fmt.count,
          primaryMetric: `${fmt.watchedHours} h`,
          secondaryMetric: `${fmt.count} ${fmt.count === 1 ? 'obra' : 'obras'}${
            fmt.episodesWatched > 0 ? ` · ${fmt.episodesWatched} eps` : ''
          }`,
          barPct: fmt.hoursBarPct || fmt.countBarPct,
        })),
        secondaryTabLabel: 'Décadas',
        secondaryTitle: 'Linha do Tempo por Década',
        secondaryEmptyMessage: 'Catalogue obras com ano de lançamento para ver as décadas.',
        secondaryRows: cinema.decadeDistribution.slice(0, 6).map((dec) => ({
          key: String(dec.decade),
          label: dec.label,
          icon: 'CalendarRange',
          count: dec.count,
          primaryMetric: `${dec.watchedHours} h`,
          secondaryMetric: `${dec.count} ${dec.count === 1 ? 'obra' : 'obras'}`,
          barPct: dec.barPct,
        })),
      },
      ranking: {
        primaryTabLabel: 'Direção / Estúdio',
        secondaryTabLabel: 'Gêneros',
        primaryRows: cinema.topCreators.slice(0, 5).map((entry) => ({
          label: entry.label,
          count: entry.count,
          metricText: `${entry.hours} h`,
          countLabel: entry.count === 1 ? 'obra' : 'obras',
          pct: entry.pct,
        })),
        secondaryRows: cinema.topGenres.slice(0, 5).map((entry) => ({
          label: entry.label,
          count: entry.count,
          metricText: `${entry.hours} h`,
          countLabel: entry.count === 1 ? 'obra' : 'obras',
          pct: entry.pct,
        })),
      },
    };
  }

  if (cleanDomain === 'reading') {
    const pagesRead = domainItems.reduce(
      (sum, w) => sum + Math.max(0, Number(w.pagesRead) || 0),
      0
    );
    const chaptersRead = domainItems.reduce(
      (sum, w) => sum + Math.max(0, Number(w.chaptersRead) || 0),
      0
    );
    const rated = domainItems.filter(
      (w) => isConfirmedUserRating(w) && Number(w.rating) > 0
    );
    const avgRatingValue =
      rated.length > 0
        ? Math.round(
            rated.reduce((sum, w) => sum + Number(w.rating), 0) / rated.length
          )
        : null;
    const avgRating = avgRatingValue !== null ? `${avgRatingValue}/100` : '—';

    const readingTypes = getMediaTypesForDomain('reading');
    const rawTypes = readingTypes.map((type) => {
      const matching = domainItems.filter(
        (w) => normalizeWorkTypeForDomain(w.workType, 'reading') === type.id
      );
      const pages = matching.reduce((s, w) => s + Math.max(0, Number(w.pagesRead) || 0), 0);
      return {
        ...type,
        count: matching.length,
        pages,
      };
    });
    const maxTypePages = Math.max(...rawTypes.map((r) => r.pages), 0);
    const maxTypeCount = Math.max(...rawTypes.map((r) => r.count), 1);
    const typeDistribution = rawTypes.map((r) => ({
      key: r.id,
      label: r.label,
      icon: r.icon,
      count: r.count,
      pages: r.pages,
      primaryMetric: `${r.pages} págs`,
      secondaryMetric: `${r.count} ${r.count === 1 ? 'título' : 'títulos'}`,
      barPct:
        maxTypePages > 0 && r.pages > 0
          ? Math.max(8, Math.round((r.pages / maxTypePages) * 100))
          : r.count > 0
            ? Math.max(8, Math.round((r.count / maxTypeCount) * 100))
            : 0,
    }));

    const formatMap = new Map();
    for (const w of domainItems) {
      const fmt = String(w.bookFormat || '').trim() || 'Formato a definir';
      const prev = formatMap.get(fmt) || { label: fmt, count: 0, pages: 0 };
      formatMap.set(fmt, {
        label: fmt,
        count: prev.count + 1,
        pages: prev.pages + Math.max(0, Number(w.pagesRead) || 0),
      });
    }
    const rawBookFormats = Array.from(formatMap.values()).sort(
      (a, b) => b.count - a.count || b.pages - a.pages
    );
    const maxFmtCount = Math.max(...rawBookFormats.map((f) => f.count), 1);
    const bookFormatDistribution = rawBookFormats.map((f) => ({
      key: f.label,
      label: f.label,
      icon: 'BookOpen',
      count: f.count,
      pages: f.pages,
      primaryMetric: `${f.pages} págs`,
      secondaryMetric: `${f.count} ${f.count === 1 ? 'obra' : 'obras'}`,
      barPct: Math.max(8, Math.round((f.count / maxFmtCount) * 100)),
    }));

    const topAuthors = buildGenericRanking(
      domainItems,
      splitCreatorNames,
      (w) => Math.max(0, Number(w.pagesRead) || 0),
      (e) => (e.weight > 0 ? `${e.weight} págs` : `${e.count} ${e.count === 1 ? 'obra' : 'obras'}`)
    ).map((e) => ({ ...e, countLabel: e.count === 1 ? 'obra' : 'obras' }));

    const topGenres = buildGenericRanking(
      domainItems,
      (w) => (Array.isArray(w.genres) ? w.genres : []),
      (w) => Math.max(0, Number(w.pagesRead) || 0),
      (e) => (e.weight > 0 ? `${e.weight} págs` : `${e.count} ${e.count === 1 ? 'obra' : 'obras'}`)
    ).map((e) => ({ ...e, countLabel: e.count === 1 ? 'obra' : 'obras' }));

    return {
      domainId: 'reading',
      domainMeta,
      totalCount,
      completedCount,
      inProgressCount,
      ratedCount: rated.length,
      openProgressCount,
      pagesRead,
      chaptersRead,
      avgRatingValue,
      avgRating,
      typeDistribution,
      bookFormatDistribution,
      kpis: [
        {
          id: 'pages',
          label: 'Páginas Lidas',
          value: String(pagesRead),
          sub:
            openProgressCount > 0
              ? `${openProgressCount} em Progresso aberto`
              : `${inProgressCount} em leitura`,
          icon: 'BookOpen',
          highlight: true,
        },
        {
          id: 'chapters',
          label: 'Capítulos / Volumes',
          value: String(chaptersRead),
          sub:
            openProgressCount > 0
              ? 'Progresso aberto em volumes sem total'
              : `${inProgressCount} lendo agora`,
          icon: 'Layers',
        },
        {
          id: 'completed',
          label: 'Livros & Papers Concluídos',
          value: String(completedCount),
          sub: `de ${totalCount} no catálogo`,
          icon: 'CheckCircle2',
        },
        {
          id: 'rating',
          label: 'Média Geral',
          value: avgRating,
          sub: rated.length > 0 ? `${rated.length} avaliadas` : 'Sem notas ainda',
          icon: 'Star',
        },
      ],
      distribution: {
        primaryTabLabel: 'Tipos',
        primaryTitle: 'Distribuição por Tipo (Livro, Mangá, Artigo, Técnico)',
        primaryEmptyMessage: 'Catalogue livros, mangás ou artigos para ver a distribuição.',
        primaryRows: typeDistribution,
        secondaryTabLabel: 'Formatos',
        secondaryTitle: 'Distribuição por Formato (Físico, EPUB, PDF)',
        secondaryEmptyMessage: 'Catalogue leituras para acompanhar seus formatos.',
        secondaryRows: bookFormatDistribution,
      },
      ranking: {
        primaryTabLabel: 'Autores',
        secondaryTabLabel: 'Gêneros',
        primaryRows: topAuthors,
        secondaryRows: topGenres,
      },
    };
  }

  if (cleanDomain === 'games') {
    const rawHours = domainItems.reduce(
      (sum, w) => sum + Math.max(0, Number(w.hoursPlayed) || 0),
      0
    );
    const hoursPlayed = Math.round(rawHours * 10) / 10;
    const equivalentDays = Math.round((hoursPlayed / 24) * 10) / 10;
    const hundredPercentCount = domainItems.filter(
      (w) =>
        Boolean(w.isPlatinum) ||
        String(w.completionType || '').includes('100%') ||
        /platina/i.test(String(w.completionType || ''))
    ).length;

    const scores11 = domainItems
      .map((w) => resolveGameRating11(w))
      .filter((s) => s !== null && s > 0);
    const avgRating11 =
      scores11.length > 0
        ? Math.round((scores11.reduce((acc, s) => acc + s, 0) / scores11.length) * 10) / 10
        : null;
    const avgRating = avgRating11 !== null ? `${avgRating11}/11` : '—';
    const masterpiece11Count = domainItems.filter((w) => Number(w.gameRating11) === 11).length;

    const platMap = new Map();
    for (const w of domainItems) {
      const plat = String(w.platform || '').trim() || GAME_PLATFORM_UNSET_LABEL;
      const prev = platMap.get(plat) || { label: plat, count: 0, hours: 0 };
      platMap.set(plat, {
        label: plat,
        count: prev.count + 1,
        hours: Math.round((prev.hours + Math.max(0, Number(w.hoursPlayed) || 0)) * 10) / 10,
      });
    }
    const rawPlats = Array.from(platMap.values()).sort(
      (a, b) => b.hours - a.hours || b.count - a.count
    );
    const maxPlatHours = Math.max(...rawPlats.map((p) => p.hours), 0);
    const maxPlatCount = Math.max(...rawPlats.map((p) => p.count), 1);
    const platformDistribution = rawPlats.map((p) => ({
      key: p.label,
      label: p.label,
      icon: 'Gamepad2',
      count: p.count,
      hours: p.hours,
      primaryMetric: `${p.hours} h`,
      secondaryMetric: `${p.count} ${p.count === 1 ? 'jogo' : 'jogos'}`,
      barPct:
        maxPlatHours > 0 && p.hours > 0
          ? Math.max(8, Math.round((p.hours / maxPlatHours) * 100))
          : Math.max(8, Math.round((p.count / maxPlatCount) * 100)),
    }));

    const edMap = new Map();
    for (const w of domainItems) {
      const ed = normalizeGameEditionType(w.editionType);
      const prev = edMap.get(ed) || { label: ed, count: 0, hours: 0 };
      edMap.set(ed, {
        label: ed,
        count: prev.count + 1,
        hours: Math.round((prev.hours + Math.max(0, Number(w.hoursPlayed) || 0)) * 10) / 10,
      });
    }
    const rawEditions = Array.from(edMap.values()).sort(
      (a, b) => b.count - a.count || b.hours - a.hours
    );
    const maxEdCount = Math.max(...rawEditions.map((e) => e.count), 1);
    const editionDistribution = rawEditions.map((e) => ({
      key: e.label,
      label: e.label,
      icon: 'Layers',
      count: e.count,
      hours: e.hours,
      primaryMetric: `${e.hours} h`,
      secondaryMetric: `${e.count} ${e.count === 1 ? 'jogo' : 'jogos'}`,
      barPct: Math.max(8, Math.round((e.count / maxEdCount) * 100)),
    }));

    const topFranchises = buildGenericRanking(
      domainItems,
      (w) => {
        const f = extractGameFranchiseKey(w);
        return f ? [f] : [];
      },
      (w) => Math.max(0, Number(w.hoursPlayed) || 0),
      (e) => `${Math.round(e.weight * 10) / 10} h`
    ).map((e) => ({ ...e, countLabel: e.count === 1 ? 'jogo' : 'jogos' }));

    const topGenres = buildGenericRanking(
      domainItems,
      (w) => (Array.isArray(w.genres) ? w.genres : []),
      (w) => Math.max(0, Number(w.hoursPlayed) || 0),
      (e) => `${Math.round(e.weight * 10) / 10} h`
    ).map((e) => ({ ...e, countLabel: e.count === 1 ? 'jogo' : 'jogos' }));

    return {
      domainId: 'games',
      domainMeta,
      totalCount,
      completedCount,
      inProgressCount,
      ratedCount: scores11.length,
      openProgressCount,
      hoursPlayed,
      equivalentDays,
      hundredPercentCount,
      masterpiece11Count,
      avgRating11,
      avgRatingValue: avgRating11,
      avgRating,
      platformDistribution,
      editionDistribution,
      kpis: [
        {
          id: 'hours',
          label: 'Horas Jogadas',
          value: `${hoursPlayed} h`,
          sub:
            openProgressCount > 0
              ? `~${equivalentDays}d · Progresso aberto`
              : `~${equivalentDays}d de gameplay`,
          icon: 'Clock',
          highlight: true,
        },
        {
          id: 'completed',
          label: 'Zerados / 100%',
          value: String(completedCount),
          sub: `${hundredPercentCount} com 100% / Platina`,
          icon: 'CheckCircle2',
        },
        {
          id: 'cataloged',
          label: 'Jogos Catalogados',
          value: String(totalCount),
          sub: `${inProgressCount} jogando agora`,
          icon: 'Gamepad2',
        },
        {
          id: 'rating',
          label: 'Média Geral (0–11)',
          value: avgRating,
          sub:
            masterpiece11Count > 0
              ? `${masterpiece11Count} nota 11 (Obra-Prima)`
              : scores11.length > 0
                ? `${scores11.length} avaliados`
                : 'Sem notas ainda',
          icon: 'Star',
        },
      ],
      distribution: {
        primaryTabLabel: 'Plataformas',
        primaryTitle: 'Distribuição por Plataforma (PS2, PS4, PC, Switch...)',
        primaryEmptyMessage: 'Catalogue jogos para ver o mapa de plataformas.',
        primaryRows: platformDistribution,
        secondaryTabLabel: 'Edições',
        secondaryTitle: 'Distribuição por Edição (Original, Remake, Remaster...)',
        secondaryEmptyMessage: 'Catalogue jogos para ver suas edições.',
        secondaryRows: editionDistribution,
      },
      ranking: {
        primaryTabLabel: 'Franquias',
        secondaryTabLabel: 'Gêneros',
        primaryRows: topFranchises,
        secondaryRows: topGenres,
      },
    };
  }

  // Música (`music`)
  const tracksCount = domainItems.filter(
    (w) => normalizeWorkTypeForDomain(w.workType, 'music') === 'track'
  ).length;
  const albumsCount = totalCount - tracksCount;
  const totalListens = domainItems.reduce(
    (sum, w) => sum + Math.max(0, Number(w.listenCount) || 0),
    0
  );
  const artistSet = new Set();
  for (const w of domainItems) {
    for (const artist of splitCreatorNames(w)) {
      artistSet.add(artist.toLowerCase());
    }
  }
  const uniqueArtistsCount = artistSet.size;
  const rated = domainItems.filter(
    (w) => isConfirmedUserRating(w) && Number(w.rating) > 0
  );
  const avgRatingValue =
    rated.length > 0
      ? Math.round(rated.reduce((sum, w) => sum + Number(w.rating), 0) / rated.length)
      : null;
  const avgRating = avgRatingValue !== null ? `${avgRatingValue}/100` : '—';

  const subgenreMap = new Map();
  for (const w of domainItems) {
    const sg =
      String(w.subgenre || '').trim() ||
      (Array.isArray(w.genres) && w.genres[0] ? String(w.genres[0]).trim() : '') ||
      'Sem subgênero';
    const prev = subgenreMap.get(sg) || { label: sg, count: 0, listens: 0 };
    subgenreMap.set(sg, {
      label: sg,
      count: prev.count + 1,
      listens: prev.listens + Math.max(0, Number(w.listenCount) || 0),
    });
  }
  const rawSubgenres = Array.from(subgenreMap.values()).sort(
    (a, b) => b.listens - a.listens || b.count - a.count
  );
  const maxSgListens = Math.max(...rawSubgenres.map((s) => s.listens), 0);
  const maxSgCount = Math.max(...rawSubgenres.map((s) => s.count), 1);
  const subgenreDistribution = rawSubgenres.slice(0, 8).map((s) => ({
    key: s.label,
    label: s.label,
    icon: 'Music',
    count: s.count,
    listens: s.listens,
    primaryMetric: `${s.listens} escutas`,
    secondaryMetric: `${s.count} ${s.count === 1 ? 'item' : 'itens'}`,
    barPct:
      maxSgListens > 0 && s.listens > 0
        ? Math.max(8, Math.round((s.listens / maxSgListens) * 100))
        : Math.max(8, Math.round((s.count / maxSgCount) * 100)),
  }));

  const relFmtMap = new Map();
  for (const w of domainItems) {
    const rf =
      String(w.releaseFormat || '').trim() || getWorkTypeLabel(w, 'music');
    const prev = relFmtMap.get(rf) || { label: rf, count: 0, listens: 0 };
    relFmtMap.set(rf, {
      label: rf,
      count: prev.count + 1,
      listens: prev.listens + Math.max(0, Number(w.listenCount) || 0),
    });
  }
  const rawRelFormats = Array.from(relFmtMap.values()).sort(
    (a, b) => b.count - a.count || b.listens - a.listens
  );
  const maxRfCount = Math.max(...rawRelFormats.map((f) => f.count), 1);
  const releaseFormatDistribution = rawRelFormats.map((f) => ({
    key: f.label,
    label: f.label,
    icon: 'Award',
    count: f.count,
    listens: f.listens,
    primaryMetric: `${f.listens} escutas`,
    secondaryMetric: `${f.count} ${f.count === 1 ? 'item' : 'itens'}`,
    barPct: Math.max(8, Math.round((f.count / maxRfCount) * 100)),
  }));

  const topArtists = buildGenericRanking(
    domainItems,
    splitCreatorNames,
    (w) => Math.max(0, Number(w.listenCount) || 0),
    (e) => (e.weight > 0 ? `${e.weight} escutas` : `${e.count} ${e.count === 1 ? 'item' : 'itens'}`)
  ).map((e) => ({ ...e, countLabel: e.count === 1 ? 'item' : 'itens' }));

  const topSubgenres = buildGenericRanking(
    domainItems,
    (w) => {
      const list = [];
      if (w.subgenre) list.push(w.subgenre);
      if (Array.isArray(w.genres)) list.push(...w.genres);
      return Array.from(new Set(list.map((x) => String(x || '').trim()).filter(Boolean)));
    },
    (w) => Math.max(0, Number(w.listenCount) || 0),
    (e) => (e.weight > 0 ? `${e.weight} escutas` : `${e.count} ${e.count === 1 ? 'item' : 'itens'}`)
  ).map((e) => ({ ...e, countLabel: e.count === 1 ? 'item' : 'itens' }));

  return {
    domainId: 'music',
    domainMeta,
    totalCount,
    completedCount,
    inProgressCount,
    ratedCount: rated.length,
    openProgressCount,
    albumsCount,
    tracksCount,
    totalListens,
    uniqueArtistsCount,
    avgRatingValue,
    avgRating,
    subgenreDistribution,
    releaseFormatDistribution,
    kpis: [
      {
        id: 'cataloged',
        label: 'Álbuns & Faixas Catalogadas',
        value: String(totalCount),
        sub: `${albumsCount} álbuns/EPs · ${tracksCount} faixas`,
        icon: 'Music',
        highlight: true,
      },
      {
        id: 'listens',
        label: 'Total de Escutas',
        value: String(totalListens),
        sub:
          openProgressCount > 0
            ? `${inProgressCount} ouvindo · Progresso aberto`
            : `${inProgressCount} ouvindo agora`,
        icon: 'Sparkles',
      },
      {
        id: 'artists',
        label: 'Discografias Exploradas',
        value: String(uniqueArtistsCount),
        sub: `${completedCount} concluídas`,
        icon: 'Award',
      },
      {
        id: 'rating',
        label: 'Média Geral',
        value: avgRating,
        sub: rated.length > 0 ? `${rated.length} avaliadas` : 'Sem notas ainda',
        icon: 'Star',
      },
    ],
    distribution: {
      primaryTabLabel: 'Subgêneros',
      primaryTitle: 'Distribuição por Subgênero Musical',
      primaryEmptyMessage: 'Catalogue álbuns ou faixas para ver seus subgêneros.',
      primaryRows: subgenreDistribution,
      secondaryTabLabel: 'Formatos',
      secondaryTitle: 'Distribuição por Formato de Lançamento',
      secondaryEmptyMessage: 'Catalogue álbuns, faixas ou shows ao vivo.',
      secondaryRows: releaseFormatDistribution,
    },
    ranking: {
      primaryTabLabel: 'Artistas & Bandas',
      secondaryTabLabel: 'Subgêneros',
      primaryRows: topArtists,
      secondaryRows: topSubgenres,
    },
  };
}

/**
 * Visão Global consolidada dos 4 domínios do OmniPrism.
 */
export function computeGlobalOmniMetrics(items = []) {
  const backlog = (Array.isArray(items) ? items : []).filter(
    (w) => w && w.inBacklog !== false
  );
  const breakdown = computeDomainBreakdownMetrics(backlog);
  const totalCount = backlog.length;
  const completedCount = backlog.filter((w) => w.status === 'completed').length;
  const inProgressCount = backlog.filter(
    (w) => w.status === 'playing' || w.status === 'in-progress' || w.status === 'rewatching'
  ).length;
  const openProgressCount = backlog.filter(
    (w) =>
      w.status !== 'completed' &&
      w.status !== 'queued' &&
      computeStrictCompletionProgress(w).isOpenProgress
  ).length;

  const rated = backlog.filter(
    (w) => isConfirmedUserRating(w) && Number(w.rating) > 0
  );
  const avgRatingValue =
    rated.length > 0
      ? Math.round(rated.reduce((sum, w) => sum + Number(w.rating), 0) / rated.length)
      : null;
  const avgRating = avgRatingValue !== null ? `${avgRatingValue}/100` : '—';

  const maxDomCount = Math.max(...breakdown.map((d) => d.totalWorks), 1);
  const domainRows = breakdown.map((d) => {
    const meta = getDomainMeta(d.domainId);
    return {
      key: d.domainId,
      label: d.label,
      icon: meta.icon,
      count: d.totalWorks,
      primaryMetric: d.progressSummary,
      secondaryMetric: `${d.totalWorks} ${d.totalWorks === 1 ? 'obra' : 'obras'} · ${d.completedWorks} concl.`,
      barPct: d.totalWorks > 0 ? Math.max(8, Math.round((d.totalWorks / maxDomCount) * 100)) : 0,
    };
  });

  const statusCounts = [
    { id: 'playing', label: 'Em Andamento' },
    { id: 'completed', label: 'Concluídas' },
    { id: 'queued', label: 'Na Fila' },
    { id: 'paused', label: 'Em Pausa' },
    { id: 'dropped', label: 'Abandonadas' },
  ].map((st) => {
    const count = backlog.filter((w) =>
      st.id === 'playing'
        ? w.status === 'playing' || w.status === 'in-progress' || w.status === 'rewatching'
        : w.status === st.id
    ).length;
    return {
      key: st.id,
      label: st.label,
      icon: 'Layers',
      count,
      primaryMetric: `${count}`,
      secondaryMetric: totalCount > 0 ? `${Math.round((count / totalCount) * 100)}% do catálogo` : '0 obras',
      barPct: totalCount > 0 && count > 0 ? Math.max(8, Math.round((count / totalCount) * 100)) : 0,
    };
  });

  const topCreators = buildGenericRanking(
    backlog,
    splitCreatorNames,
    () => 1,
    (e) => `${e.count} ${e.count === 1 ? 'obra' : 'obras'}`
  ).map((e) => ({ ...e, countLabel: e.count === 1 ? 'obra' : 'obras' }));

  const topGenres = buildGenericRanking(
    backlog,
    (w) => (Array.isArray(w.genres) ? w.genres : []),
    () => 1,
    (e) => `${e.count} ${e.count === 1 ? 'obra' : 'obras'}`
  ).map((e) => ({ ...e, countLabel: e.count === 1 ? 'obra' : 'obras' }));

  return {
    domainId: 'global',
    totalCount,
    completedCount,
    inProgressCount,
    ratedCount: rated.length,
    openProgressCount,
    avgRatingValue,
    avgRating,
    breakdown,
    kpis: [
      {
        id: 'total',
        label: 'Obras no OmniPrism',
        value: String(totalCount),
        sub: `${breakdown.filter((b) => b.totalWorks > 0).length} de 4 portais ativos`,
        icon: 'Layers',
        highlight: true,
      },
      {
        id: 'completed',
        label: 'Concluídas (Global)',
        value: String(completedCount),
        sub:
          openProgressCount > 0
            ? `${inProgressCount} ativas · Progresso aberto`
            : `${inProgressCount} em andamento`,
        icon: 'CheckCircle2',
      },
      {
        id: 'rated',
        label: 'Obras Avaliadas',
        value: String(rated.length),
        sub: 'Apenas notas reais (> 0)',
        icon: 'Award',
      },
      {
        id: 'avg',
        label: 'Média Global',
        value: avgRating,
        sub: rated.length > 0 ? `${rated.length} obras com nota` : 'Sem notas ainda',
        icon: 'Star',
      },
    ],
    distribution: {
      primaryTabLabel: '4 Portais',
      primaryTitle: 'Distribuição pelos 4 Portais OmniPrism',
      primaryEmptyMessage: 'Catalogue obras em qualquer portal para ver o panorama global.',
      primaryRows: domainRows,
      secondaryTabLabel: 'Status',
      secondaryTitle: 'Distribuição Global por Status',
      secondaryEmptyMessage: 'Sem obras cadastradas ainda.',
      secondaryRows: statusCounts,
    },
    ranking: {
      primaryTabLabel: 'Criadores',
      secondaryTabLabel: 'Gêneros',
      primaryRows: topCreators,
      secondaryRows: topGenres,
    },
  };
}
