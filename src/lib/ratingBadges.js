import { computeExternalPublicAverage100 } from './ratings.js';

export function resolvePublicScore100(externalRatingsOrWork) {
  if (typeof externalRatingsOrWork === 'number' && Number.isFinite(externalRatingsOrWork)) {
    return Math.max(0, Math.min(100, Math.round(externalRatingsOrWork)));
  }
  if (!externalRatingsOrWork || typeof externalRatingsOrWork !== 'object') {
    return null;
  }

  const ratingsObj = externalRatingsOrWork.externalRatings || externalRatingsOrWork;
  const computed = computeExternalPublicAverage100(ratingsObj);
  if (computed && typeof computed.average100 === 'number') {
    return computed.average100;
  }

  if (
    typeof externalRatingsOrWork.publicScore === 'number' &&
    externalRatingsOrWork.publicScore > 0
  ) {
    const raw = externalRatingsOrWork.publicScore;
    return raw <= 10 ? Math.round(raw * 10) : Math.round(raw);
  }

  return null;
}

export function computeCritiqueComparisonBadge(
  userRating,
  externalRatingsOrScore,
  ratingSource = 'manual'
) {
  if (ratingSource === 'legacy-default') return null;
  if (userRating === null || userRating === undefined || userRating === '') {
    return null;
  }
  const userNum = Number(userRating);
  if (!Number.isFinite(userNum) || userNum < 0 || userNum > 100) {
    return null;
  }

  const publicScore = resolvePublicScore100(externalRatingsOrScore);
  if (publicScore === null || publicScore <= 0) {
    return null;
  }

  const userScore = Math.round(userNum);
  const delta = userScore - publicScore;
  const detail = `Você ${userScore} · Público ${publicScore}`;

  if (delta >= 12) {
    return {
      id: 'loved-more',
      label: 'Você Amou Mais que o Público',
      shortLabel: `Você ${userScore} · Público ${publicScore}`,
      detail,
      userScore,
      publicScore,
      delta,
    };
  }

  if (delta <= -12) {
    return {
      id: 'more-demanding',
      label: 'Mais Exigente que a Crítica',
      shortLabel: `Você ${userScore} · Público ${publicScore}`,
      detail,
      userScore,
      publicScore,
      delta,
    };
  }

  if (userScore >= 88 && publicScore >= 88) {
    return {
      id: 'consensus-masterpiece',
      label: 'Obra-Prima Consensual',
      shortLabel: `Obra-Prima · ${detail}`,
      detail,
      userScore,
      publicScore,
      delta,
    };
  }

  if (Math.abs(delta) <= 5) {
    return {
      id: 'total-harmony',
      label: 'Sintonia Total',
      shortLabel: `Sintonia · ${detail}`,
      detail,
      userScore,
      publicScore,
      delta,
    };
  }

  return {
    id: delta > 0 ? 'above-public' : 'below-public',
    label: delta > 0 ? 'Acima da Média Pública' : 'Abaixo da Média Pública',
    shortLabel: detail,
    detail,
    userScore,
    publicScore,
    delta,
  };
}

export function computeWorkCritiqueBadge(work) {
  if (!work || typeof work !== 'object') return null;
  return computeCritiqueComparisonBadge(
    work.rating,
    work.externalRatings || work,
    work.ratingSource
  );
}
