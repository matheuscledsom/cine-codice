/**
 * Modelo Único de Nota do OMNIPRISM (v2.4.0).
 *
 * Regras oficiais:
 * - Armazenamento interno normalizado: 0 a 100 (inteiro) ou null quando sem nota.
 * - Exibição principal: 5 estrelas com meia estrela (0.5 a 5.0; 0 apenas se avaliado
 *   explicitamente como 0) + marca opcional "Obra da vida" (progress_data.lifeWork),
 *   retrocompatível com o antigo gameRating11 === 11 de Games.
 * - Avaliação inteligente opcional por 5 critérios específicos por domínio
 *   (Cinema, Leitura, Games, Música). Cada critério vai de 0 a 10 e corresponde a
 *   1 estrela / 20% do total. A média dos critérios preenchidos calcula as estrelas
 *   sugeridas (arredondadas em 0.5), mas o usuário pode sobrescrever a estrela
 *   manualmente a qualquer momento. Critério ausente NUNCA é zero.
 */

import { inferDomainFromWork, normalizeDomainId } from '../config/domainConfig.js';

export const LIFE_WORK_LABEL = 'Obra da vida';
export const MAX_STARS = 5;
export const STAR_STEP = 0.5;
export const CRITERION_MAX = 10;
export const CRITERION_WEIGHT_PERCENT = 20;

export const DOMAIN_RATING_CRITERIA = Object.freeze({
  cinema: Object.freeze([
    Object.freeze({ key: 'roteiro', label: 'Roteiro & História', shortLabel: 'Roteiro', max: 10, weightPercent: 20 }),
    Object.freeze({ key: 'direcao', label: 'Direção & Ritmo', shortLabel: 'Direção', max: 10, weightPercent: 20 }),
    Object.freeze({ key: 'atuacoes', label: 'Atuações & Personagens', shortLabel: 'Atuações', max: 10, weightPercent: 20 }),
    Object.freeze({ key: 'fotografia', label: 'Fotografia & Som', shortLabel: 'Audiovisual', max: 10, weightPercent: 20 }),
    Object.freeze({ key: 'impacto', label: 'Impacto & Memória', shortLabel: 'Impacto', max: 10, weightPercent: 20 }),
  ]),
  reading: Object.freeze([
    Object.freeze({ key: 'narrativa', label: 'Narrativa & Ideias', shortLabel: 'Narrativa', max: 10, weightPercent: 20 }),
    Object.freeze({ key: 'escrita', label: 'Escrita & Estilo', shortLabel: 'Escrita', max: 10, weightPercent: 20 }),
    Object.freeze({ key: 'personagens', label: 'Personagens & Profundidade', shortLabel: 'Personagens', max: 10, weightPercent: 20 }),
    Object.freeze({ key: 'ritmo', label: 'Ritmo & Estrutura', shortLabel: 'Ritmo', max: 10, weightPercent: 20 }),
    Object.freeze({ key: 'impacto', label: 'Impacto & Releitura', shortLabel: 'Impacto', max: 10, weightPercent: 20 }),
  ]),
  games: Object.freeze([
    Object.freeze({ key: 'gameplay', label: 'Jogabilidade & Controles', shortLabel: 'Gameplay', max: 10, weightPercent: 20 }),
    Object.freeze({ key: 'narrativa', label: 'História & Mundo', shortLabel: 'Mundo', max: 10, weightPercent: 20 }),
    Object.freeze({ key: 'arte', label: 'Direção de Arte & Áudio', shortLabel: 'Arte & Som', max: 10, weightPercent: 20 }),
    Object.freeze({ key: 'design', label: 'Level Design & Progressão', shortLabel: 'Design', max: 10, weightPercent: 20 }),
    Object.freeze({ key: 'impacto', label: 'Impacto & Diversão', shortLabel: 'Impacto', max: 10, weightPercent: 20 }),
  ]),
  music: Object.freeze([
    Object.freeze({ key: 'composicao', label: 'Composição & Melodia', shortLabel: 'Composição', max: 10, weightPercent: 20 }),
    Object.freeze({ key: 'producao', label: 'Produção & Arranjo', shortLabel: 'Produção', max: 10, weightPercent: 20 }),
    Object.freeze({ key: 'interpretacao', label: 'Vocal & Execução', shortLabel: 'Execução', max: 10, weightPercent: 20 }),
    Object.freeze({ key: 'coesao', label: 'Coesão & Letra', shortLabel: 'Coesão', max: 10, weightPercent: 20 }),
    Object.freeze({ key: 'impacto', label: 'Impacto & Reaudição', shortLabel: 'Impacto', max: 10, weightPercent: 20 }),
  ]),
});

export function getCriteriaForDomain(domain = 'cinema') {
  const clean = normalizeDomainId(domain);
  return DOMAIN_RATING_CRITERIA[clean] || DOMAIN_RATING_CRITERIA.cinema;
}

function parseOptionalNumber(raw) {
  if (raw === null || raw === undefined || typeof raw === 'boolean') return null;
  if (typeof raw === 'string' && raw.trim() === '') return null;
  if (typeof raw === 'object') return null;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

export function roundToHalfStar(rawStars) {
  const num = parseOptionalNumber(rawStars);
  if (num === null) return null;
  const clamped = Math.max(0, Math.min(MAX_STARS, num));
  return Math.round(clamped * 2) / 2;
}

/**
 * Converte nota interna (0..100) para estrelas (0.5..5.0 em passos de 0.5;
 * 0 explícito permanece 0; ausente retorna null).
 */
export function score100ToStars(score100) {
  const num = parseOptionalNumber(score100);
  if (num === null) return null;
  const clamped = Math.max(0, Math.min(100, num));
  if (clamped === 0) return 0;
  if (clamped < 10) return 0.5;
  return Math.min(MAX_STARS, Math.max(STAR_STEP, Math.round((clamped / 20) * 2) / 2));
}

/**
 * Converte estrelas (0..5 em passos de 0.5) para nota interna inteira (0..100).
 */
export function starsToScore100(stars) {
  const rounded = roundToHalfStar(stars);
  if (rounded === null) return null;
  return Math.max(0, Math.min(100, Math.round(rounded * 20)));
}

/**
 * Converte nota legada de Games (0..11) para o modelo único (0..100 + lifeWork).
 */
export function gameRating11ToInternal(rawGameRating11) {
  const num = parseOptionalNumber(rawGameRating11);
  if (num === null) {
    return { score100: null, stars: null, lifeWork: false };
  }
  const clamped = Math.max(0, Math.min(11, num));
  if (clamped >= 11) {
    return { score100: 100, stars: 5, lifeWork: true };
  }
  const score100 = Math.max(0, Math.min(100, Math.round(clamped * 10)));
  return {
    score100,
    stars: score100ToStars(score100),
    lifeWork: false,
  };
}

/**
 * Deriva campo retrocompatível gameRating11 a partir do modelo único.
 */
export function internalToGameRating11(score100, lifeWork = false) {
  if (lifeWork) return 11;
  const num = parseOptionalNumber(score100);
  if (num === null) return null;
  const clamped = Math.max(0, Math.min(100, num));
  return Math.round((clamped / 10) * 10) / 10;
}

/**
 * Normaliza mapa de 5 critérios (0..10 cada).
 * Critério ausente / vazio / null / undefined / NaN retorna null (NUNCA 0).
 */
export function normalizeCriteria5(rawCriteria, domain = 'cinema') {
  const defs = getCriteriaForDomain(domain);
  const source =
    rawCriteria && typeof rawCriteria === 'object' && !Array.isArray(rawCriteria)
      ? rawCriteria
      : {};

  const normalized = {};
  for (const def of defs) {
    const rawVal = source[def.key];
    const num = parseOptionalNumber(rawVal);
    if (num === null) {
      normalized[def.key] = null;
    } else {
      const clamped = Math.max(0, Math.min(CRITERION_MAX, num));
      normalized[def.key] = Math.round(clamped * 10) / 10;
    }
  }
  return normalized;
}

/**
 * Detecta se um objeto `reviewCriteria` pertence ao modelo de 5 critérios (0..10)
 * em vez do modelo legado DNA 0..100.
 */
export function isFiveCriteriaRecord(rawCriteria, domain = 'cinema') {
  if (!rawCriteria || typeof rawCriteria !== 'object' || Array.isArray(rawCriteria)) {
    return false;
  }
  const defs = getCriteriaForDomain(domain);
  const validKeys = new Set(defs.map((d) => d.key));
  const entries = Object.entries(rawCriteria).filter(([, v]) => parseOptionalNumber(v) !== null);
  if (entries.length === 0) return false;
  const matchesDomainKey = entries.some(([k]) => validKeys.has(k));
  const allWithinTen = entries.every(([, v]) => {
    const n = parseOptionalNumber(v);
    return n !== null && n >= 0 && n <= CRITERION_MAX;
  });
  return matchesDomainKey && allWithinTen;
}

/**
 * Calcula a avaliação inteligente a partir dos 5 critérios preenchidos (0..10 cada).
 * - Cada critério corresponde a 1 estrela (20% do total de 5 estrelas).
 * - A média dos critérios preenchidos determina as estrelas sugeridas (arredondadas em 0.5).
 * - Critério ausente nunca entra como 0.
 */
export function calculateCriteriaRating(rawCriteria, domain = 'cinema') {
  const defs = getCriteriaForDomain(domain);
  const normalized = normalizeCriteria5(rawCriteria, domain);

  const filledValues = [];
  const perCriterionStars = {};

  for (const def of defs) {
    const val = normalized[def.key];
    if (val === null) {
      perCriterionStars[def.key] = null;
    } else {
      filledValues.push(val);
      perCriterionStars[def.key] = Math.round((val / CRITERION_MAX) * 100) / 100;
    }
  }

  if (filledValues.length === 0) {
    return {
      domain: normalizeDomainId(domain),
      criteria: normalized,
      filledCount: 0,
      totalCount: defs.length,
      average10: null,
      exactStars: null,
      suggestedStars: null,
      exactScore100: null,
      suggestedScore100: null,
      perCriterionStars,
    };
  }

  const sum = filledValues.reduce((acc, v) => acc + v, 0);
  const rawAverage10 = sum / filledValues.length;
  const average10 = Math.round(rawAverage10 * 100) / 100;
  const exactStars = Math.round((rawAverage10 / 2) * 100) / 100;
  const exactScore100 = Math.max(0, Math.min(100, Math.round(rawAverage10 * 10)));

  let suggestedStars;
  if (rawAverage10 === 0) {
    suggestedStars = 0;
  } else {
    const snapped = roundToHalfStar(rawAverage10 / 2);
    suggestedStars = Math.max(STAR_STEP, snapped);
  }
  const suggestedScore100 = starsToScore100(suggestedStars);

  return {
    domain: normalizeDomainId(domain),
    criteria: normalized,
    filledCount: filledValues.length,
    totalCount: defs.length,
    average10,
    exactStars,
    suggestedStars,
    exactScore100,
    suggestedScore100,
    perCriterionStars,
  };
}

/**
 * Resolve o marcador booleano "Obra da vida" preservando compatibilidade com gameRating11 === 11.
 */
export function resolveLifeWorkFlag(work = {}) {
  if (!work || typeof work !== 'object') return false;
  if (work.lifeWork === true) return true;
  if (work.progress_data?.lifeWork === true) return true;
  const legacyGame11 = parseOptionalNumber(work.gameRating11 ?? work.progress_data?.game_rating_11);
  return legacyGame11 !== null && legacyGame11 >= 11;
}

/**
 * Resolve o estado unificado de avaliação de qualquer obra (legada ou v2.4.0).
 */
export function resolveWorkRatingState(work = {}) {
  const safeWork = work && typeof work === 'object' ? work : {};
  const domain = inferDomainFromWork(safeWork);
  const isLegacyDefault = safeWork.ratingSource === 'legacy-default';
  const lifeWork = resolveLifeWorkFlag(safeWork);

  const rawCriteriaCandidate = safeWork.reviewCriteria5 || (
    isFiveCriteriaRecord(safeWork.reviewCriteria, domain) ? safeWork.reviewCriteria : null
  );
  const criteriaState = calculateCriteriaRating(rawCriteriaCandidate, domain);

  let score100 = null;
  const directRating = parseOptionalNumber(safeWork.rating);
  if (directRating !== null && directRating >= 0 && directRating <= 100) {
    score100 = Math.round(directRating);
  } else {
    const g11 = gameRating11ToInternal(safeWork.gameRating11);
    if (g11.score100 !== null) {
      score100 = g11.score100;
    } else {
      const t10 = parseOptionalNumber(safeWork.trackRating10);
      if (t10 !== null && t10 >= 0 && t10 <= 10) {
        score100 = Math.round(t10 * 10);
      } else if (criteriaState.suggestedScore100 !== null) {
        score100 = criteriaState.suggestedScore100;
      }
    }
  }

  const stars = score100 !== null ? score100ToStars(score100) : null;
  const hasConfirmedRating = !isLegacyDefault && score100 !== null;
  const isManualOverride =
    Boolean(safeWork.ratingManualOverride) ||
    (criteriaState.suggestedStars !== null && stars !== null && stars !== criteriaState.suggestedStars);

  return {
    domain,
    score100,
    stars,
    formattedStars: formatStarsNumber(stars),
    lifeWork,
    criteria: criteriaState,
    isManualOverride,
    isLegacyDefault,
    hasConfirmedRating,
  };
}

/**
 * Aplica alteração em um dos 5 critérios.
 * - Se não houver sobrescrita manual ativa, atualiza automaticamente estrelas e nota 0..100.
 * - Se houver sobrescrita manual ativa, mantém a estrela escolhida pelo usuário e atualiza a sugestão.
 */
export function applyCriterionChange(
  currentState = {},
  { domain = 'cinema', key, value } = {}
) {
  const cleanDomain = normalizeDomainId(domain || currentState.domain);
  const prevCriteria = normalizeCriteria5(
    currentState.reviewCriteria5 || currentState.criteria || currentState.reviewCriteria,
    cleanDomain
  );
  const nextCriteria = {
    ...prevCriteria,
    [key]: parseOptionalNumber(value) === null ? null : Math.max(0, Math.min(CRITERION_MAX, Math.round(Number(value) * 10) / 10)),
  };

  const calc = calculateCriteriaRating(nextCriteria, cleanDomain);
  const manualOverride = Boolean(currentState.ratingManualOverride);

  let nextStars = parseOptionalNumber(currentState.stars);
  let nextScore100 = parseOptionalNumber(currentState.rating ?? currentState.score100);

  if (!manualOverride) {
    nextStars = calc.suggestedStars;
    nextScore100 = calc.suggestedScore100;
  } else if (nextStars === null && nextScore100 !== null) {
    nextStars = score100ToStars(nextScore100);
  }

  const lifeWork = Boolean(currentState.lifeWork);
  const ratingValue = nextScore100 !== null ? Math.max(0, Math.min(100, Math.round(nextScore100))) : null;

  return {
    domain: cleanDomain,
    rating: ratingValue,
    score100: ratingValue,
    stars: nextStars,
    ratingSource: ratingValue !== null ? 'manual' : null,
    ratingManualOverride: manualOverride,
    lifeWork,
    reviewCriteria: calc.filledCount > 0 ? calc.criteria : null,
    reviewCriteria5: calc.filledCount > 0 ? calc.criteria : null,
    criteria: calc,
    ...(cleanDomain === 'games'
      ? { gameRating11: internalToGameRating11(ratingValue, lifeWork) }
      : {}),
  };
}

/**
 * Converte valor de um critério (0..10) para mini-estrelas interativas (0.5..5.0; 0 explícito permanece 0; null retorna null).
 */
export function criterionValue10ToStars(value10) {
  const num = parseOptionalNumber(value10);
  if (num === null) return null;
  const clamped = Math.max(0, Math.min(CRITERION_MAX, num));
  if (clamped === 0) return 0;
  return Math.max(STAR_STEP, roundToHalfStar(clamped / 2));
}

/**
 * Converte mini-estrelas de um critério (0.5..5.0) para escala canônica 0..10 (1 estrela = 2 pontos = 20%).
 */
export function criterionStarsToValue10(stars) {
  const rounded = roundToHalfStar(stars);
  if (rounded === null) return null;
  return Math.max(0, Math.min(CRITERION_MAX, Math.round(rounded * 2 * 10) / 10));
}

/**
 * Formata equivalente discreto 0–10 de um critério (ex.: "8/10", "7.5/10" ou "—").
 */
export function formatCriterionValue10(value10) {
  const num = parseOptionalNumber(value10);
  if (num === null) return '—';
  const clamped = Math.max(0, Math.min(CRITERION_MAX, Math.round(num * 10) / 10));
  const label = Number.isInteger(clamped) ? String(clamped) : clamped.toFixed(1);
  return `${label}/10`;
}

/**
 * Aplica alteração em um critério a partir da seleção em mini-estrelas (0.5 a 5.0 ou null para limpar).
 */
export function applyCriterionStarChange(
  currentState = {},
  { domain = 'cinema', key, stars } = {}
) {
  const value10 = criterionStarsToValue10(stars);
  return applyCriterionChange(currentState, {
    domain,
    key,
    value: value10,
  });
}

/**
 * Aplica sobrescrita manual direta nas estrelas (0.5 a 5.0, ou null para limpar).
 * Preserva os critérios já preenchidos, marcando `ratingManualOverride` quando diferem.
 */
export function applyManualStarRating(
  currentState = {},
  manualStars,
  { domain = 'cinema' } = {}
) {
  const cleanDomain = normalizeDomainId(domain || currentState.domain);
  const existingCriteria = normalizeCriteria5(
    currentState.reviewCriteria5 || currentState.criteria || currentState.reviewCriteria,
    cleanDomain
  );
  const calc = calculateCriteriaRating(existingCriteria, cleanDomain);
  const snappedStars = roundToHalfStar(manualStars);
  const nextScore100 = snappedStars !== null ? starsToScore100(snappedStars) : null;
  const lifeWork = snappedStars === null ? false : Boolean(currentState.lifeWork);
  const ratingManualOverride =
    snappedStars !== null &&
    (calc.filledCount > 0 ? snappedStars !== calc.suggestedStars : false);

  return {
    domain: cleanDomain,
    rating: nextScore100,
    score100: nextScore100,
    stars: snappedStars,
    ratingSource: nextScore100 !== null ? 'manual' : null,
    ratingManualOverride,
    lifeWork,
    reviewCriteria: calc.filledCount > 0 ? calc.criteria : null,
    reviewCriteria5: calc.filledCount > 0 ? calc.criteria : null,
    criteria: calc,
    ...(cleanDomain === 'games'
      ? { gameRating11: internalToGameRating11(nextScore100, lifeWork) }
      : {}),
  };
}

/**
 * Alterna o selo opcional "Obra da vida" (progress_data.lifeWork).
 * Mantém compatibilidade com gameRating11 === 11 no domínio Games.
 */
export function applyLifeWorkToggle(currentState = {}, nextLifeWork, { domain = 'cinema' } = {}) {
  const cleanDomain = normalizeDomainId(domain || currentState.domain);
  const lifeWork = Boolean(nextLifeWork);
  const currentScore = parseOptionalNumber(currentState.rating ?? currentState.score100);
  const nextScore100 = lifeWork && currentScore === null ? 100 : currentScore !== null ? Math.round(currentScore) : null;
  const nextStars = nextScore100 !== null ? score100ToStars(nextScore100) : null;

  return {
    lifeWork,
    rating: nextScore100,
    score100: nextScore100,
    stars: nextStars,
    ratingSource: nextScore100 !== null ? 'manual' : currentState.ratingSource ?? null,
    ...(cleanDomain === 'games'
      ? { gameRating11: internalToGameRating11(nextScore100, lifeWork) }
      : {}),
  };
}

export function formatStarsNumber(stars) {
  const num = parseOptionalNumber(stars);
  if (num === null) return '';
  return num.toFixed(1);
}

export function formatRatingSummary(work, { emptyLabel = 'Sem nota', showScore100 = false } = {}) {
  const state = resolveWorkRatingState(work);
  if (!state.hasConfirmedRating || state.stars === null) {
    return emptyLabel;
  }
  const parts = [`${state.formattedStars}/5`];
  if (showScore100 && state.score100 !== null) {
    parts.push(`(${state.score100})`);
  }
  if (state.lifeWork) {
    parts.push(LIFE_WORK_LABEL);
  }
  return parts.join(' · ');
}
