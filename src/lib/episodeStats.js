/**
 * Cálculos puros de avaliações de episódio, estatísticas, gráfico SVG,
 * virtualização (>100 itens) e badge de próximo episódio (D5 / D7 / Fase 4).
 */

import { formatEpisodeRating10, snapEpisodeRatingStep5 } from './ratings.js';

export const EPISODE_TAGS = Object.freeze([
  'Obra-prima',
  'Filler',
  'Virada de Chave',
  'Final Épico',
]);

export const MAX_EPISODE_REACTION_CHARS = 280;
export const VIRTUALIZE_EPISODE_THRESHOLD = 100;

function compareDisplayOrder(a, b) {
  const sA = Math.max(1, Number(a?.season) || 1);
  const sB = Math.max(1, Number(b?.season) || 1);
  if (sA !== sB) return sA - sB;
  const eA = Math.max(1, Number(a?.episode) || 1);
  const eB = Math.max(1, Number(b?.episode) || 1);
  return eA - eB;
}

export function normalizeEpisodeEvaluationRecord(raw = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const season = Math.max(1, Math.round(Number(raw.season) || 1));
  const episode = Math.max(1, Math.round(Number(raw.episode) || 1));
  const hasRating =
    raw.rating !== null &&
    raw.rating !== undefined &&
    raw.rating !== '' &&
    Number.isFinite(Number(raw.rating));
  const rating = hasRating ? Math.max(0, Math.min(100, Math.round(Number(raw.rating)))) : null;
  const tag = EPISODE_TAGS.includes(raw.tag) ? raw.tag : raw.tag ? String(raw.tag) : null;
  const reaction = String(raw.reaction || '').slice(0, MAX_EPISODE_REACTION_CHARS);

  return {
    evalKey: raw.evalKey || `${raw.workId || ''}:${season}:${episode}`,
    workId: String(raw.workId || ''),
    season,
    episode,
    rating,
    rating10: rating !== null ? formatEpisodeRating10(rating) : null,
    tag,
    reaction,
    provisional: Boolean(raw.provisional),
    updatedAt: raw.updatedAt || null,
  };
}

/**
 * Calcula estatísticas dos episódios avaliados conforme regras estritas da Fase 4:
 * - Média apenas dos episódios com nota válida ("N de M avaliados")
 * - Top 3 com desempate pela ordem de exibição (lista menor se < 3)
 * - Pior episódio apenas com 2 ou mais avaliados
 * - Botão "Aplicar média na nota da série" ativo apenas com 3 ou mais avaliados
 */
export function computeEpisodeStats(
  evaluations = [],
  totalEpisodesInWork = null
) {
  const normalized = (Array.isArray(evaluations) ? evaluations : [])
    .map(normalizeEpisodeEvaluationRecord)
    .filter(Boolean);

  const rated = normalized
    .filter((ev) => typeof ev.rating === 'number' && Number.isFinite(ev.rating))
    .sort(compareDisplayOrder);

  const evaluatedCount = rated.length;
  const numericTotal = Number(totalEpisodesInWork);
  const totalEpisodesKnown =
    Number.isFinite(numericTotal) && numericTotal > 0 ? Math.round(numericTotal) : null;

  if (evaluatedCount === 0) {
    return {
      evaluatedCount: 0,
      totalEpisodesKnown,
      countLabel: totalEpisodesKnown
        ? `0 de ${totalEpisodesKnown} avaliados`
        : '0 avaliados',
      averageRating100: null,
      averageRating10: null,
      topEpisodes: [],
      worstEpisode: null,
      canApplyAverageToSeries: false,
    };
  }

  const sum100 = rated.reduce((acc, ev) => acc + ev.rating, 0);
  const averageRating100 = Math.round(sum100 / evaluatedCount);
  const averageRating10 = Math.round((averageRating100 / 10) * 10) / 10;

  const topEpisodes = [...rated]
    .sort((a, b) => {
      if (b.rating !== a.rating) return b.rating - a.rating;
      return compareDisplayOrder(a, b);
    })
    .slice(0, 3);

  const worstEpisode =
    evaluatedCount >= 2
      ? [...rated].sort((a, b) => {
          if (a.rating !== b.rating) return a.rating - b.rating;
          return compareDisplayOrder(a, b);
        })[0]
      : null;

  return {
    evaluatedCount,
    totalEpisodesKnown,
    countLabel: totalEpisodesKnown
      ? `${evaluatedCount} de ${totalEpisodesKnown} avaliados`
      : `${evaluatedCount} ${evaluatedCount === 1 ? 'avaliado' : 'avaliados'}`,
    averageRating100,
    averageRating10,
    topEpisodes,
    worstEpisode,
    canApplyAverageToSeries: evaluatedCount >= 3,
  };
}

export function needsManualRatingOverwriteConfirm(work) {
  if (!work || typeof work !== 'object') return false;
  return (
    work.ratingSource === 'manual' &&
    work.rating !== null &&
    work.rating !== undefined &&
    Number.isFinite(Number(work.rating))
  );
}

/**
 * Constrói modelo para gráfico SVG de barras e tabela acessível por temporada.
 */
export function buildEpisodeBarChartModel(
  episodesInSeason = [],
  evaluationByKey = new Map(),
  seasonNumber = 1
) {
  const sNum = Math.max(1, Math.round(Number(seasonNumber) || 1));
  const map = evaluationByKey instanceof Map ? evaluationByKey : new Map();

  return (Array.isArray(episodesInSeason) ? episodesInSeason : []).map((ep) => {
    const epNum =
      typeof ep === 'number'
        ? ep
        : Math.max(1, Math.round(Number(ep?.number ?? ep?.episode) || 1));
    const key = `${sNum}:${epNum}`;
    const ev = map.get(key) || map.get(`${ep?.workId || ''}:${key}`) || null;
    const rating100 =
      ev && typeof ev.rating === 'number' && Number.isFinite(ev.rating)
        ? snapEpisodeRatingStep5(ev.rating)
        : null;

    return {
      key,
      season: sNum,
      episode: epNum,
      shortLabel: `E${String(epNum).padStart(2, '0')}`,
      title: (typeof ep === 'object' && ep?.title) || `Episódio ${epNum}`,
      rating100,
      rating10: rating100 !== null ? formatEpisodeRating10(rating100) : null,
      publicScore:
        typeof ep === 'object' && ep?.publicScore !== null && ep?.publicScore !== undefined
          ? ep.publicScore
          : null,
      tag: ev?.tag || null,
      isMissing: rating100 === null,
    };
  });
}

/**
 * Calcula janela visível para listas virtualizadas quando uma temporada tem > 100 episódios.
 */
export function computeVirtualEpisodeWindow({
  totalCount = 0,
  scrollTop = 0,
  viewportHeight = 420,
  itemHeight = 92,
  overscan = 4,
} = {}) {
  const total = Math.max(0, Math.round(Number(totalCount) || 0));
  if (total === 0) {
    return { startIndex: 0, endIndex: -1, paddingTop: 0, paddingBottom: 0, virtualized: false };
  }
  if (total <= VIRTUALIZE_EPISODE_THRESHOLD) {
    return {
      startIndex: 0,
      endIndex: total - 1,
      paddingTop: 0,
      paddingBottom: 0,
      virtualized: false,
    };
  }

  const rowH = Math.max(24, Number(itemHeight) || 92);
  const viewH = Math.max(rowH, Number(viewportHeight) || 420);
  const top = Math.max(0, Number(scrollTop) || 0);
  const firstVisible = Math.floor(top / rowH);
  const visibleCount = Math.ceil(viewH / rowH);

  const startIndex = Math.max(0, firstVisible - overscan);
  const endIndex = Math.min(total - 1, firstVisible + visibleCount + overscan);

  return {
    startIndex,
    endIndex,
    paddingTop: startIndex * rowH,
    paddingBottom: Math.max(0, (total - 1 - endIndex) * rowH),
    virtualized: true,
  };
}

/**
 * Formata badge "Ep. N em DD/MM" no fuso local do aparelho.
 * Fica oculto (retorna null) se a obra já finalizou ou faltar episódio/data.
 */
export function formatNextAiringBadge(work = {}) {
  if (!work || typeof work !== 'object') return null;

  if (work.status === 'completed') return null;
  const rawStatus = String(
    work.animeStatus || work.showStatus || work.tmdbStatus || ''
  ).toLowerCase();
  if (/finished|ended|canceled|cancelled|completed/.test(rawStatus)) {
    return null;
  }

  let episodeNumber = null;
  let airDateObj = null;

  if (work.nextAiringEpisode && Number(work.nextAiringEpisode.episode) > 0) {
    episodeNumber = Math.round(Number(work.nextAiringEpisode.episode));
    const airingAtSec = Number(work.nextAiringEpisode.airingAt);
    if (Number.isFinite(airingAtSec) && airingAtSec > 0) {
      airDateObj = new Date(airingAtSec * 1000);
    }
  } else if (work.nextEpisode && Number(work.nextEpisode.number) > 0) {
    episodeNumber = Math.round(Number(work.nextEpisode.number));
    if (work.nextEpisode.airstamp) {
      airDateObj = new Date(work.nextEpisode.airstamp);
    } else if (work.nextEpisode.airdate) {
      const m = String(work.nextEpisode.airdate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m) {
        airDateObj = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
      }
    }
  } else if (work.nextEpisodeToAir && Number(work.nextEpisodeToAir.episode_number) > 0) {
    episodeNumber = Math.round(Number(work.nextEpisodeToAir.episode_number));
    if (work.nextEpisodeToAir.air_date) {
      const m = String(work.nextEpisodeToAir.air_date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (m) {
        airDateObj = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
      }
    }
  }

  if (!episodeNumber || !airDateObj || Number.isNaN(airDateObj.getTime())) {
    return null;
  }

  const dd = String(airDateObj.getDate()).padStart(2, '0');
  const mm = String(airDateObj.getMonth() + 1).padStart(2, '0');
  return {
    episode: episodeNumber,
    dateLabel: `${dd}/${mm}`,
    text: `Ep. ${episodeNumber} em ${dd}/${mm}`,
    timestampMs: airDateObj.getTime(),
  };
}
