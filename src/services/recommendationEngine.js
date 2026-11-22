import { catalogItems } from '../data/mockData.js';
import {
  extractFavoriteGenreLabels,
  migrateFavoriteGenresToObjects,
} from '../lib/genreCatalog.js';
import { normalizeViewerFocusList } from '../lib/migrations.js';
import { isConfirmedUserRating } from '../lib/ratings.js';
import { normalizePreferredCriteria } from '../utils/readerPreferences.js';
import {
  computeDnaWeightedScore,
  evaluateCandidateExclusion,
  getEstimatedSessionMinutes,
  normalizeReaderDna,
} from './dnaScoring.js';

function normalizeToken(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function splitPeople(rawValue) {
  return String(rawValue || '')
    .split(/[;,]/)
    .map((s) => normalizeToken(s))
    .filter((s) => s.length >= 3);
}

const ANIME_TEXT_RE = /\b(anime|shonen|seinen|shojo|josei|mecha|isekai|ova|ona)\b/;

const CANONICAL_GENRE_GROUPS = [
  { tag: 'ficcao cientifica', patterns: ['ficcao cientifica', 'science fiction', 'sci-fi', 'cyberpunk', 'mecha', 'distopia'] },
  { tag: 'drama', patterns: ['drama'] },
  { tag: 'suspense', patterns: ['suspense', 'thriller', 'misterio', 'noir', 'policial', 'crime'] },
  { tag: 'terror', patterns: ['terror', 'horror', 'gotico'] },
  { tag: 'acao', patterns: ['acao', 'aventura', 'acao & aventura', 'action', 'adventure'] },
  { tag: 'fantasia', patterns: ['fantasia', 'fantasy', 'isekai'] },
  { tag: 'animacao', patterns: ['animacao', 'animation', 'anime', 'shonen', 'seinen', 'slice of life'] },
  { tag: 'comedia', patterns: ['comedia', 'comedy'] },
  { tag: 'romance', patterns: ['romance'] },
  { tag: 'documentario', patterns: ['documentario', 'documentary'] },
  { tag: 'classicos', patterns: ['classico', 'classicos'] },
];

export function expandGenreTags(rawGenre) {
  const norm = normalizeToken(rawGenre);
  if (!norm) return [];
  const tags = new Set([norm]);
  for (const group of CANONICAL_GENRE_GROUPS) {
    if (group.patterns.some((pat) => norm === pat || norm.includes(pat))) {
      tags.add(group.tag);
    }
  }
  return Array.from(tags);
}

function getWorkCanonicalGenreTags(work) {
  const rawList = [
    work?.primaryGenre,
    ...(Array.isArray(work?.subgenres) ? work.subgenres : []),
    ...(Array.isArray(work?.genres) ? work.genres : []),
  ].filter(Boolean);

  const tags = new Set();
  for (const g of rawList) {
    for (const tag of expandGenreTags(g)) {
      tags.add(tag);
    }
  }
  if (work?.workType === 'anime') tags.add('animacao');
  return tags;
}

export function buildSpectatorTasteProfile(items = [], profile = null) {
  const backlog = Array.isArray(items)
    ? items.filter((i) => i && i.inBacklog !== false)
    : [];
  const highRated = backlog
    .filter((item) => (isConfirmedUserRating(item) && Number(item.rating) >= 80) || Boolean(item.isPlatinum))
    .sort((a, b) => {
      const timeB = Date.parse(b.completedDate || b.updatedAt || '') || 0;
      const timeA = Date.parse(a.completedDate || a.updatedAt || '') || 0;
      return timeB - timeA || (Number(b.rating) || 0) - (Number(a.rating) || 0);
    });

  const structuredFavoriteGenres = migrateFavoriteGenresToObjects(profile?.favoriteGenres);
  const onboardingGenreLabels = extractFavoriteGenreLabels(structuredFavoriteGenres);

  const onboardingGenres = new Set(onboardingGenreLabels.map(normalizeToken).filter(Boolean));
  const onboardingCanonicalTags = new Set();
  const onboardingTagToLabel = new Map();
  for (const label of onboardingGenreLabels) {
    for (const tag of expandGenreTags(label)) {
      onboardingCanonicalTags.add(tag);
      if (!onboardingTagToLabel.has(tag)) onboardingTagToLabel.set(tag, label);
    }
  }

  const libraryCanonicalTags = new Set();
  const libraryTagToLabel = new Map();
  for (const item of backlog) {
    const itemGenres = [
      item.primaryGenre,
      ...(Array.isArray(item.subgenres) ? item.subgenres : []),
      ...(Array.isArray(item.genres) ? item.genres : []),
    ]
      .map((g) => String(g || '').trim())
      .filter(Boolean);
    for (const label of itemGenres) {
      for (const tag of expandGenreTags(label)) {
        libraryCanonicalTags.add(tag);
        if (!libraryTagToLabel.has(tag)) libraryTagToLabel.set(tag, label);
      }
    }
  }

  const viewerFocus = normalizeViewerFocusList(
    profile?.viewerFocus ?? profile?.viewer_focus,
    profile?.readerFocus ?? profile?.reader_focus
  );
  const viewerFocusTokens = viewerFocus.map(normalizeToken).filter(Boolean);
  const readerFocus = viewerFocusTokens[0] || '';
  const preferredCriteria = normalizePreferredCriteria(
    profile?.preferredCriteria ?? profile?.preferred_criteria,
    profile?.preferredCriterion ?? profile?.preferred_criterion
  );

  const preferredCreators = new Map();
  const preferredGenres = new Map();

  for (const genre of onboardingGenres) {
    preferredGenres.set(genre, (preferredGenres.get(genre) || 0) + 2);
  }
  for (const tag of onboardingCanonicalTags) {
    preferredGenres.set(tag, (preferredGenres.get(tag) || 0) + 2);
  }

  for (const item of highRated) {
    const ratingWeight = item.isPlatinum || Number(item.rating) >= 90 ? 2 : 1;
    for (const creator of splitPeople(item.director || item.studio)) {
      preferredCreators.set(creator, (preferredCreators.get(creator) || 0) + ratingWeight);
    }
    for (const g of Array.isArray(item.genres) ? item.genres : []) {
      const ng = normalizeToken(g);
      if (ng) preferredGenres.set(ng, (preferredGenres.get(ng) || 0) + ratingWeight);
      for (const tag of expandGenreTags(g)) {
        preferredGenres.set(tag, (preferredGenres.get(tag) || 0) + ratingWeight);
      }
    }
  }

  const allowedCanonicalTags = new Set([...onboardingCanonicalTags, ...libraryCanonicalTags]);

  return {
    onboardingGenres,
    onboardingCanonicalTags,
    onboardingTagToLabel,
    structuredFavoriteGenres,
    libraryCanonicalTags,
    libraryTagToLabel,
    allowedCanonicalTags,
    allowsAnime:
      viewerFocusTokens.some((f) => ANIME_TEXT_RE.test(f)) ||
      structuredFavoriteGenres.some((g) => g.group === 'animes') ||
      onboardingGenreLabels.some((g) => ANIME_TEXT_RE.test(normalizeToken(g))) ||
      backlog.some((i) => i.workType === 'anime'),
    viewerFocus,
    viewerFocusTokens,
    readerFocus,
    preferredCriteria,
    readerDna: normalizeReaderDna(profile?.readerDna ?? profile?.reader_dna),
    preferredCreators,
    preferredGenres,
    recentLovedWorks: highRated.slice(0, 3),
  };
}

export function scoreCandidateForMood(item, tasteProfile, mood = '') {
  if (!item) return { item, score: 0, reasons: [] };
  let score = 0;
  const reasons = [];

  const normMood = normalizeToken(mood);
  const titleText = normalizeToken(`${item.title || ''} ${item.originalTitle || ''}`);
  const genres = Array.isArray(item.genres) ? item.genres : [];
  const workTags = getWorkCanonicalGenreTags(item);
  const tropesText = normalizeToken(
    [...(item.tropes || []), ...(item.atmosphere || []), item.synopsis || ''].join(' ')
  );
  const fullText = `${titleText} ${genres.map(normalizeToken).join(' ')} ${tropesText}`;
  const sessionMins = getEstimatedSessionMinutes(item);

  let matchedOnboardingLabel = '';
  for (const tag of workTags) {
    if (tasteProfile.onboardingCanonicalTags?.has(tag)) {
      matchedOnboardingLabel = tasteProfile.onboardingTagToLabel?.get(tag) || '';
      break;
    }
  }
  if (matchedOnboardingLabel) {
    score += 14;
    reasons.push(`seu interesse em ${matchedOnboardingLabel}`);
  }

  for (const creator of splitPeople(item.director || item.studio)) {
    if (tasteProfile.preferredCreators.has(creator)) {
      score += 28;
      reasons.push(`direção/estúdio bem avaliado (${item.director || item.studio})`);
      break;
    }
  }

  let genreMatches = 0;
  for (const tag of workTags) {
    if (tasteProfile.preferredGenres.has(tag) && !tasteProfile.onboardingCanonicalTags?.has(tag)) {
      genreMatches += 1;
    }
  }
  if (genreMatches > 0) {
    score += Math.min(20, genreMatches * 10);
    if (reasons.length === 0) reasons.push('afinidade com suas notas altas');
  }

  if (normMood.includes('epica') || normMood.includes('maratona') || normMood.includes('imersao')) {
    if (sessionMins >= 120 || item.workType === 'series' || /epico|fantasia|ficcao/.test(fullText)) {
      score += 18;
      reasons.push('escala ideal para imersão');
    }
  } else if (normMood.includes('curta') || normMood.includes('leve') || normMood.includes('25')) {
    if (sessionMins <= 35 || /comedia|leve|slice of life/.test(fullText)) {
      score += 18;
      reasons.push('sessão rápida e fluida');
    }
  } else if (normMood.includes('suspense') || normMood.includes('sombrio') || normMood.includes('tenso')) {
    if (/suspense|terror|thriller|noir|crime|sombrio|tenso/.test(fullText)) {
      score += 20;
      reasons.push('clima sombrio ou tenso');
    }
  } else if (normMood.length >= 3) {
    const moodWords = normMood.split(/\s+/).filter((w) => w.length >= 3);
    const hits = moodWords.filter((w) => fullText.includes(w));
    if (hits.length > 0) {
      score += hits.length * 14;
      reasons.push(`combina com "${mood}"`);
    }
  }

  const dnaResult = computeDnaWeightedScore(item, tasteProfile?.readerDna);
  if (dnaResult.excluded) {
    return { item, score: -999, reasons: [] };
  }
  score += dnaResult.bonus;
  if (dnaResult.topDimensionLabel && dnaResult.bonus >= 12) {
    reasons.push(`alinhado ao seu DNA em ${dnaResult.topDimensionLabel}`);
  }

  if (item.hype === 'urgent') score += 8;
  else if (item.hype === 'high') score += 4;

  return {
    item,
    score,
    reasons: Array.from(new Set(reasons)).slice(0, 3),
  };
}

export function generateOfflineRecommendations({
  items = [],
  profile = null,
  mood = '',
  limit = 3,
} = {}) {
  const queuedItems = (Array.isArray(items) ? items : []).filter(
    (item) => item && item.inBacklog !== false && item.status === 'queued'
  );

  if (queuedItems.length === 0) {
    return {
      ok: false,
      mode: 'offline',
      primaryId: null,
      headline: 'Nenhuma obra em Quero Ver para sortear',
      reason: 'Adicione filmes, séries ou animes em "Quero Ver" para gerar sugestões personalizadas.',
      alternatives: [],
      scoredCandidates: [],
    };
  }

  const tasteProfile = buildSpectatorTasteProfile(items, profile);
  const eligibleItems = queuedItems.filter(
    (candidate) => !evaluateCandidateExclusion(candidate, tasteProfile.readerDna)
  );
  if (eligibleItems.length === 0) {
    return {
      ok: false,
      mode: 'offline',
      primaryId: null,
      headline: 'Nenhuma obra compatível com seus filtros de exclusão',
      reason: 'Todas as obras na fila correspondem às exclusões ativas no seu DNA.',
      alternatives: [],
      scoredCandidates: [],
    };
  }

  const ranked = eligibleItems
    .map((candidate) => scoreCandidateForMood(candidate, tasteProfile, mood))
    .sort(
      (a, b) =>
        b.score - a.score ||
        String(a.item.title).localeCompare(String(b.item.title), 'pt-BR')
    );

  const top = ranked[0];
  const refWork = tasteProfile.recentLovedWorks[0]?.title;
  const reasonParts =
    top.reasons.length > 0
      ? `Selecionado por ${top.reasons.join(', ')}`
      : 'Melhor equilíbrio de prioridade e afinidade na sua fila';
  const refClause =
    refWork && top.reasons.length > 0
      ? ` — em sintonia com "${refWork}".`
      : '.';

  const alternatives = ranked.slice(1, Math.max(1, limit)).map((entry) => ({
    id: entry.item.id,
    why:
      entry.reasons[0] ||
      (entry.item.director ? `De ${entry.item.director}` : 'Boa opção na sua fila'),
  }));

  return {
    ok: true,
    mode: 'offline',
    primaryId: top.item.id,
    headline: mood ? `Sugestão para ${mood}` : 'Próxima sessão recomendada',
    reason: `${reasonParts}${refClause}`,
    alternatives,
    scoredCandidates: ranked.slice(0, limit),
  };
}

export function buildHomeCinemaRecommendations({
  items = [],
  profile = null,
  limit = 4,
  excludeIds = [],
  dismissedIds = [],
} = {}) {
  const safeItems = Array.isArray(items) ? items : [];
  const tasteProfile = buildSpectatorTasteProfile(safeItems, profile);
  const backlogTitles = new Set(
    safeItems
      .filter((i) => i && i.inBacklog !== false)
      .flatMap((i) => [normalizeToken(i.title), normalizeToken(i.originalTitle)])
      .filter(Boolean)
  );
  const completedTitles = new Set(
    safeItems
      .filter((i) => i?.status === 'completed' || i?.status === 'playing' || i?.status === 'rewatching')
      .flatMap((i) => [normalizeToken(i.title), normalizeToken(i.originalTitle)])
      .filter(Boolean)
  );

  const candidateMap = new Map();

  safeItems
    .filter((i) => i && i.inBacklog !== false && i.status === 'queued')
    .forEach((work) => {
      if (evaluateCandidateExclusion(work, tasteProfile.readerDna)) return;
      const normTitle = normalizeToken(work.title);
      if (!normTitle || candidateMap.has(normTitle)) return;
      const scored = scoreCandidateForMood(work, tasteProfile, '');
      candidateMap.set(normTitle, {
        id: work.id,
        item: work,
        score: scored.score + 10,
        reason: scored.reasons[0] || 'Na sua fila Quero Ver',
        alreadyInBacklog: true,
        sourceKind: 'shelf',
      });
    });

  catalogItems.forEach((work) => {
    if (evaluateCandidateExclusion(work, tasteProfile.readerDna)) return;
    if (!tasteProfile.allowsAnime && work.workType === 'anime') return;
    const normTitle = normalizeToken(work.title);
    if (!normTitle || completedTitles.has(normTitle) || candidateMap.has(normTitle)) return;
    const scored = scoreCandidateForMood(work, tasteProfile, '');
    candidateMap.set(normTitle, {
      id: work.id,
      item: work,
      score: scored.score,
      reason:
        scored.reasons[0] ||
        (work.genres?.[0] ? `Curadoria em ${work.genres[0]}` : 'Clássico da Cinemateca'),
      alreadyInBacklog: backlogTitles.has(normTitle),
      sourceKind: 'discovery',
    });
  });

  const dismissedSet = new Set(Array.isArray(dismissedIds) ? dismissedIds : []);
  const sortedPool = Array.from(candidateMap.values())
    .filter((entry) => !dismissedSet.has(entry.id))
    .sort(
      (a, b) =>
        b.score - a.score ||
        String(a.item?.title || '').localeCompare(String(b.item?.title || ''), 'pt-BR')
    );

  const excludeSet = new Set(Array.isArray(excludeIds) ? excludeIds : []);
  const fresh = sortedPool.filter((entry) => !excludeSet.has(entry.id));
  const finalPool = fresh.length > 0 ? fresh : sortedPool;

  return {
    recommendations: finalPool.slice(0, Math.max(1, limit)),
    totalCandidates: sortedPool.length,
  };
}

export const buildHomeBookRecommendations = buildHomeCinemaRecommendations;
export const buildReaderTasteProfile = buildSpectatorTasteProfile;
