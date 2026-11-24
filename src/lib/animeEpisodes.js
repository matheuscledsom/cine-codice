/**
 * Resolução transparente de episódios de anime em exibição (v2.5.0 Fase A).
 *
 * Regras:
 * - O AniList costuma retornar `episodes: null` em séries em exibição.
 * - Nesses casos, usa `nextAiringEpisode.episode - 1` como "lançados até agora",
 *   registrando a fonte ("AniList") e a data da consulta.
 * - Nunca fixa números de exemplo nem inventa `totalEpisodes`: total só existe
 *   quando a fonte informar explicitamente.
 */

export function formatIsoDatePtBr(isoString) {
  const raw = String(isoString || '').trim();
  if (!raw) return '';
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return '';
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function resolveAnimeEpisodeReleaseInfo(
  sourceData = {},
  { source = 'AniList', fetchedAt = null } = {}
) {
  if (!sourceData || typeof sourceData !== 'object') {
    return {
      totalEpisodes: null,
      releasedEpisodesCount: null,
      releasedEpisodesSource: null,
      releasedEpisodesFetchedAt: null,
    };
  }

  const rawTotal = sourceData.episodes ?? sourceData.totalEpisodes;
  const totalEpisodes =
    Number.isFinite(Number(rawTotal)) && Number(rawTotal) > 0
      ? Math.floor(Number(rawTotal))
      : null;

  const nextEpNum = Number(sourceData.nextAiringEpisode?.episode);
  const existingReleased = Number(sourceData.releasedEpisodesCount);

  if (Number.isFinite(nextEpNum) && nextEpNum > 1) {
    return {
      totalEpisodes,
      releasedEpisodesCount: Math.floor(nextEpNum) - 1,
      releasedEpisodesSource:
        String(sourceData.releasedEpisodesSource || source || 'AniList').trim() || 'AniList',
      releasedEpisodesFetchedAt:
        sourceData.releasedEpisodesFetchedAt || fetchedAt || new Date().toISOString(),
    };
  }

  if (Number.isFinite(existingReleased) && existingReleased > 0) {
    return {
      totalEpisodes,
      releasedEpisodesCount: Math.floor(existingReleased),
      releasedEpisodesSource:
        String(sourceData.releasedEpisodesSource || source || 'AniList').trim() || 'AniList',
      releasedEpisodesFetchedAt:
        sourceData.releasedEpisodesFetchedAt || fetchedAt || null,
    };
  }

  return {
    totalEpisodes,
    releasedEpisodesCount: null,
    releasedEpisodesSource: null,
    releasedEpisodesFetchedAt: null,
  };
}

export function formatAnimeEpisodeCountLabel(work = {}) {
  if (!work || typeof work !== 'object') {
    return {
      kind: 'unknown',
      count: null,
      source: '',
      dateLabel: '',
      label: '',
    };
  }

  const info = resolveAnimeEpisodeReleaseInfo(work, {
    source: work.releasedEpisodesSource || 'AniList',
    fetchedAt: work.releasedEpisodesFetchedAt || null,
  });

  if (info.totalEpisodes !== null) {
    const formatted =
      info.totalEpisodes >= 1000
        ? info.totalEpisodes.toLocaleString('pt-BR')
        : String(info.totalEpisodes);
    return {
      kind: 'total',
      count: info.totalEpisodes,
      source: '',
      dateLabel: '',
      label: `${formatted} ${info.totalEpisodes === 1 ? 'episódio' : 'episódios'}`,
    };
  }

  if (info.releasedEpisodesCount !== null && info.releasedEpisodesCount > 0) {
    const formatted =
      info.releasedEpisodesCount >= 1000
        ? info.releasedEpisodesCount.toLocaleString('pt-BR')
        : String(info.releasedEpisodesCount);
    const dateLabel = formatIsoDatePtBr(info.releasedEpisodesFetchedAt);
    const sourceText = info.releasedEpisodesSource || 'AniList';
    const meta = dateLabel ? `${sourceText}, ${dateLabel}` : sourceText;
    return {
      kind: 'released-so-far',
      count: info.releasedEpisodesCount,
      source: sourceText,
      dateLabel,
      label: `${formatted} lançados até agora (${meta})`,
    };
  }

  return {
    kind: 'unknown',
    count: null,
    source: '',
    dateLabel: '',
    label: '',
  };
}
