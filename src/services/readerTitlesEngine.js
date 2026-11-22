import { getWatchedEpisodesCount, getWatchedMinutes } from '../utils/backlogHelpers.js';

export const READER_TITLE_CATEGORIES = [
  { id: 'all', label: 'Todos' },
  { id: 'living', label: 'Em Cartaz' },
  { id: 'genre', label: 'Gêneros' },
  { id: 'library', label: 'Catálogo' },
];

function norm(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function itemSearchBlob(item) {
  return norm(
    [
      item?.title,
      item?.originalTitle,
      item?.workType,
      item?.animeFormat,
      item?.audioFormat,
      ...(Array.isArray(item?.genres) ? item.genres : []),
      ...(Array.isArray(item?.tropes) ? item.tropes : []),
      ...(Array.isArray(item?.atmosphere) ? item.atmosphere : []),
    ]
      .filter(Boolean)
      .join(' ')
  );
}

function makePatternPredicate(pattern) {
  return (item) => pattern.test(itemSearchBlob(item));
}

const LIVING_TITLE_SPECS = [
  {
    id: 'living_scifi',
    name: 'Projeção Cyberpunk & Sci-Fi',
    description: 'Ativo ao assistir ficção científica, cyberpunk ou distopias.',
    iconName: 'Compass',
    match: makePatternPredicate(/\b(ficcao cientifica|sci-fi|cyberpunk|mecha|distopia)\b/),
  },
  {
    id: 'living_noir',
    name: 'Sombra Noir & Investigação',
    description: 'Ativo durante sessões de noir, policial ou thriller investigativo.',
    iconName: 'Eye',
    match: makePatternPredicate(/\b(noir|policial|crime|misterio|suspense|thriller)\b/),
  },
  {
    id: 'living_anime',
    name: 'Maratonista de Temporada',
    description: 'Ativo ao acompanhar animes ou séries semanais.',
    iconName: 'Clapperboard',
    match: (item) => item?.workType === 'anime' || item?.workType === 'series',
  },
  {
    id: 'living_terror',
    name: 'Sessão da Meia-Noite',
    description: 'Ativo ao assistir filmes ou séries de terror e suspense sombrio.',
    iconName: 'Moon',
    match: makePatternPredicate(/\b(terror|horror|sombrio|sobrenatural)\b/),
  },
  {
    id: 'living_classics',
    name: 'Restaurador de 35mm',
    description: 'Ativo ao assistir clássicos ou cinema autoral.',
    iconName: 'Film',
    match: (item) =>
      Number(item?.releaseYear) > 0 && Number(item.releaseYear) <= 1990 ||
      /\b(classico|classicos)\b/.test(itemSearchBlob(item)),
  },
];

const GENRE_TEMPLATES = [
  { key: 'scifi', label: 'Ficção Científica', icon: 'Compass', match: makePatternPredicate(/\b(ficcao cientifica|sci-fi|cyberpunk|mecha)\b/) },
  { key: 'drama', label: 'Drama', icon: 'Heart', match: makePatternPredicate(/\bdrama\b/) },
  { key: 'thriller', label: 'Suspense & Thriller', icon: 'Eye', match: makePatternPredicate(/\b(suspense|thriller|misterio|noir|crime)\b/) },
  { key: 'terror', label: 'Terror', icon: 'Moon', match: makePatternPredicate(/\b(terror|horror)\b/) },
  { key: 'animacao', label: 'Animação & Anime', icon: 'Clapperboard', match: (i) => i?.workType === 'anime' || makePatternPredicate(/\b(animacao|anime|shonen|seinen)\b/)(i) },
  { key: 'acao', label: 'Ação & Aventura', icon: 'Flame', match: makePatternPredicate(/\b(acao|aventura)\b/) },
  { key: 'fantasia', label: 'Fantasia', icon: 'Mountain', match: makePatternPredicate(/\b(fantasia|isekai)\b/) },
  { key: 'classicos', label: 'Clássicos', icon: 'Film', match: (i) => (Number(i?.releaseYear) > 0 && Number(i.releaseYear) <= 1989) || makePatternPredicate(/\bclassicos?\b/)(i) },
];

const TIER_LEVELS = [
  { id: 'iniciante', label: 'Espectador', target: 1 },
  { id: 'veterano', label: 'Curador', target: 4 },
  { id: 'mestre', label: 'Cinéfilo', target: 10 },
];

const GENRE_TITLES = GENRE_TEMPLATES.flatMap((topic) =>
  TIER_LEVELS.map((tier) => ({
    id: `genre_${topic.key}_${tier.id}`,
    name: `${tier.label} em ${topic.label}`,
    category: 'genre',
    tier: tier.id,
    iconName: topic.icon,
    description: `Catalogue ou conclua ${tier.target} ${tier.target === 1 ? 'obra' : 'obras'} de ${topic.label}.`,
    evaluate: (ctx) => {
      const current = ctx.backlogItems.filter(topic.match).length;
      return { current, target: tier.target, unlocked: current >= tier.target };
    },
  }))
);

export function toLocalDateKey(input = new Date()) {
  const dt = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(dt.getTime())) return null;
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function computeConsecutiveReadingDays(sessions = [], nowDate = new Date()) {
  const list = Array.isArray(sessions) ? sessions : [];
  const daySet = new Set();
  for (const s of list) {
    const rawDate = s?.endedAt || s?.startedAt || s?.createdAt;
    if (!rawDate) continue;
    const key = toLocalDateKey(rawDate);
    if (key) daySet.add(key);
  }
  if (daySet.size === 0) return 0;

  const baseNow = nowDate instanceof Date ? nowDate : new Date(nowDate);
  if (Number.isNaN(baseNow.getTime())) return 0;

  const today = new Date(baseNow.getFullYear(), baseNow.getMonth(), baseNow.getDate());
  const todayKey = toLocalDateKey(today);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = toLocalDateKey(yesterday);

  let cursor = daySet.has(todayKey)
    ? today
    : daySet.has(yesterdayKey)
      ? yesterday
      : null;

  if (!cursor) return 0;

  let streak = 0;
  while (cursor) {
    const key = toLocalDateKey(cursor);
    if (!key || !daySet.has(key)) break;
    streak += 1;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 1);
  }
  return streak;
}

export function computeSafeBadgeProgress(current, target) {
  const safeTarget = Math.max(0, Number(target) || 0);
  const safeCurrent = Math.max(0, Number(current) || 0);
  if (safeTarget <= 0) return 0;
  return Math.min(100, Math.round((safeCurrent / safeTarget) * 100));
}

export const BADGE_RULES = [
  {
    prefix: 'cine',
    category: 'library',
    iconName: 'Film',
    tiers: [
      { id: 'iniciante', name: 'Primeiro Cartaz', target: 1, desc: 'Catalogue sua primeira obra audiovisual.' },
      { id: 'veterano', name: 'Videolocadora Particular', target: 10, desc: 'Mantenha 10 filmes, séries ou animes no catálogo.' },
      { id: 'mestre', name: 'Curador de Catálogo', target: 30, desc: 'Acumule 30 obras catalogadas com precisão.' },
    ],
    measure: (stats) => stats.catalogedWorksCount,
  },
  {
    prefix: 'hours',
    category: 'library',
    iconName: 'Clock',
    tiers: [
      { id: 'iniciante', name: 'Primeiras 10 Horas', target: 10, desc: 'Assista 10 horas acumuladas em filmes, séries e animes.' },
      { id: 'veterano', name: 'Maratonista 50h', target: 50, desc: 'Alcance 50 horas em tela registradas.' },
      { id: 'mestre', name: 'Projeção Contínua 200h', target: 200, desc: 'Supere 200 horas acumuladas no catálogo.' },
    ],
    measure: (stats) => stats.totalHoursWatched,
  },
  {
    prefix: 'episodes',
    category: 'library',
    iconName: 'Tv',
    tiers: [
      { id: 'iniciante', name: 'Piloto Aprovado', target: 10, desc: 'Assista 10 episódios de séries ou animes.' },
      { id: 'veterano', name: 'Temporada Completa', target: 50, desc: 'Conclua 50 episódios no catálogo.' },
      { id: 'mestre', name: 'Sagas Sem Fim', target: 200, desc: 'Atinja 200 episódios assistidos.' },
    ],
    measure: (stats) => stats.totalEpisodesWatched,
  },
  {
    prefix: 'reviews',
    category: 'library',
    iconName: 'Star',
    tiers: [
      { id: 'iniciante', name: 'Primeira Crítica', target: 1, desc: 'Avalie sua primeira obra com nota ou crítica.' },
      { id: 'veterano', name: 'Crítico da Sala', target: 10, desc: 'Registre 10 avaliações no catálogo.' },
      { id: 'mestre', name: 'Curador Titular', target: 25, desc: 'Avalie 25 obras pelo DNA do Espectador.' },
    ],
    measure: (stats) => stats.reviewedWorksCount,
  },
  {
    prefix: 'rewatch',
    category: 'library',
    iconName: 'RotateCcw',
    tiers: [
      { id: 'iniciante', name: 'Sessão Nostalgia', target: 1, desc: 'Reassista uma obra pelo menos 1 vez (Rewatch #1).' },
      { id: 'veterano', name: 'Clássico de Cabeceira', target: 5, desc: 'Acumule 5 reassistidas registradas no catálogo.' },
    ],
    measure: (stats) => stats.totalRewatches,
  },
  {
    prefix: 'quotes',
    category: 'library',
    iconName: 'Quote',
    tiers: [
      { id: 'iniciante', name: 'Fala Marcante', target: 1, desc: 'Guarde sua primeira fala ou cena no cofre.' },
      { id: 'veterano', name: 'Arquivo de Diálogos', target: 10, desc: 'Salve 10 citações de cinema no cofre.' },
    ],
    measure: (stats) => stats.totalQuotesCount,
  },
  {
    prefix: 'streak',
    category: 'library',
    iconName: 'Flame',
    tiers: [
      { id: 'iniciante', name: 'Trilogia Seguida', target: 3, desc: 'Mantenha 3 dias seguidos de sessões.' },
      { id: 'veterano', name: 'Semana de Festival', target: 7, desc: 'Alcance 7 dias consecutivos de sessões.' },
      { id: 'mestre', name: 'Temporada Inteira', target: 30, desc: 'Mantenha 30 dias seguidos.' },
    ],
    measure: (stats) => stats.streakCount,
  },
].map((group) => ({
  ...group,
  tiers: group.tiers.map((tier) => ({
    ...tier,
    id: `${group.prefix}_${tier.id}`,
    evaluate: (stats) => {
      const progress = Math.max(0, Number(group.measure(stats, tier)) || 0);
      const target = Math.max(1, Number(tier.target) || 1);
      return { earned: progress >= target, progress, target };
    },
  })),
}));

const MILESTONE_TITLES = BADGE_RULES.flatMap((group) =>
  group.tiers.map((tier) => ({
    id: tier.id,
    name: tier.name,
    category: group.category,
    tier: tier.id.split('_').pop(),
    iconName: group.iconName,
    description: tier.desc,
    evaluate: (stats) => {
      const res = tier.evaluate(stats);
      return {
        earned: Boolean(res.earned),
        progress: res.progress,
        target: res.target,
        current: res.progress,
        unlocked: Boolean(res.earned),
      };
    },
  }))
);

function buildLivingBadgeEntries() {
  return LIVING_TITLE_SPECS.map((spec) => ({
    id: spec.id,
    name: spec.name,
    category: 'living',
    tier: 'dinâmico',
    iconName: spec.iconName,
    description: spec.description,
    evaluate: (ctx) => {
      const matched = ctx.activeWatchingItems.some(spec.match);
      return { current: matched ? 1 : 0, target: 1, unlocked: matched };
    },
  }));
}

export const READER_TITLES_CATALOG = [
  ...buildLivingBadgeEntries(),
  ...GENRE_TITLES,
  ...MILESTONE_TITLES,
];

export function detectLivingReaderTitle(activeWatchingItems = []) {
  const list = Array.isArray(activeWatchingItems) ? activeWatchingItems : [];
  if (list.length === 0) return null;

  const sorted = [...list].sort((a, b) => {
    const tB = Date.parse(b.updatedAt || b.createdAt || '') || 0;
    const tA = Date.parse(a.updatedAt || a.createdAt || '') || 0;
    return tB - tA;
  });

  for (const activeItem of sorted) {
    const matched = LIVING_TITLE_SPECS.find((spec) => spec.match(activeItem));
    if (matched) {
      return {
        id: matched.id,
        name: matched.name,
        category: 'living',
        tier: 'dinâmico',
        iconName: matched.iconName,
        description: matched.description,
        sourceWorkTitle: activeItem.title || '',
        unlocked: true,
        current: 1,
        target: 1,
        progressPct: 100,
      };
    }
  }

  return {
    id: 'living_sessao_ativa',
    name: 'Em Sessão Contínua',
    category: 'living',
    tier: 'dinâmico',
    iconName: 'Film',
    description: 'Ativo enquanto há filmes, séries ou animes em exibição.',
    sourceWorkTitle: sorted[0]?.title || '',
    unlocked: true,
    current: 1,
    target: 1,
    progressPct: 100,
  };
}

export function buildReaderUsageStats({
  items = [],
  readingSessions = [],
  streakCount = 0,
  posts = [],
  nowDate = new Date(),
} = {}) {
  const backlogItems = (Array.isArray(items) ? items : []).filter(
    (i) => i && i.inBacklog !== false
  );
  const activeWatchingItems = backlogItems.filter(
    (i) => i.status === 'playing' || i.status === 'rewatching'
  );
  const sessions = Array.isArray(readingSessions) ? readingSessions : [];

  const totalQuotesCount = backlogItems.reduce(
    (sum, i) => sum + (Array.isArray(i.quotes) ? i.quotes.length : 0),
    0
  );
  const reviewedWorksCount = backlogItems.filter(
    (i) =>
      typeof i.rating === 'number' ||
      (typeof i.notes === 'string' && i.notes.trim().length > 0)
  ).length;
  const totalMinutesWatched = backlogItems.reduce((sum, i) => sum + getWatchedMinutes(i), 0);
  const totalHoursWatched = Math.round(totalMinutesWatched / 60);
  const totalEpisodesWatched = backlogItems.reduce(
    (sum, i) => sum + getWatchedEpisodesCount(i),
    0
  );
  const totalRewatches = backlogItems.reduce(
    (sum, i) => sum + Math.max(0, Number(i.rewatchCount) || 0),
    0
  );

  const computedSessionDays = computeConsecutiveReadingDays(sessions, nowDate);
  const effectiveStreak = Math.max(Math.max(0, Number(streakCount) || 0), computedSessionDays);

  return {
    backlogItems,
    activeWatchingItems,
    catalogedWorksCount: backlogItems.length,
    totalQuotesCount,
    reviewedWorksCount,
    streakCount: effectiveStreak,
    totalMinutesWatched,
    totalHoursWatched,
    totalEpisodesWatched,
    totalRewatches,
    postsCount: Array.isArray(posts) ? posts.length : 0,
  };
}

export function canPinTitleBadge(badgeOrId, catalog = []) {
  if (!badgeOrId || badgeOrId === 'auto') return true;
  const targetId = typeof badgeOrId === 'object' ? badgeOrId.id : badgeOrId;
  const targetName = typeof badgeOrId === 'object' ? badgeOrId.name : badgeOrId;
  if (Array.isArray(catalog) && catalog.length > 0) {
    const match = catalog.find((b) => b.id === targetId || b.name === targetName);
    return Boolean(match && match.unlocked);
  }
  return typeof badgeOrId === 'object' ? Boolean(badgeOrId.unlocked) : false;
}

export function pinTitleBadge(profile, badgeOrId, catalog = []) {
  if (!badgeOrId || badgeOrId === 'auto') {
    return { allowed: true, activeTitleBadge: 'auto', reason: '' };
  }
  const targetId = typeof badgeOrId === 'object' ? badgeOrId.id : badgeOrId;
  const targetName = typeof badgeOrId === 'object' ? badgeOrId.name : badgeOrId;
  const match = Array.isArray(catalog)
    ? catalog.find((b) => b.id === targetId || b.name === targetName)
    : null;

  if (!match || !match.unlocked) {
    return {
      allowed: false,
      activeTitleBadge: profile?.activeTitleBadge || 'auto',
      reason: 'Conquiste esta patente antes de fixá-la no perfil.',
    };
  }
  return { allowed: true, activeTitleBadge: match.name, reason: '' };
}

export function evaluateReaderTitles({
  items = [],
  profile = null,
  readingSessions = [],
  streakCount = 0,
  posts = [],
  nowDate = new Date(),
} = {}) {
  const stats = buildReaderUsageStats({
    items,
    readingSessions,
    streakCount,
    posts,
    nowDate,
  });

  const livingTitle = detectLivingReaderTitle(stats.activeWatchingItems);
  const ctx = { ...stats, profile };

  const catalog = READER_TITLES_CATALOG.map((entry) => {
    if (entry.category === 'living') {
      const res = entry.evaluate(ctx);
      return {
        ...entry,
        current: res.current,
        target: res.target,
        unlocked: Boolean(res.unlocked),
        progressPct: res.unlocked ? 100 : 0,
      };
    }
    if (entry.category === 'genre') {
      const res = entry.evaluate(ctx);
      return {
        ...entry,
        current: res.current,
        target: res.target,
        unlocked: Boolean(res.unlocked),
        progressPct: computeSafeBadgeProgress(res.current, res.target),
      };
    }
    const res = entry.evaluate(stats);
    return {
      ...entry,
      current: res.progress,
      target: res.target,
      unlocked: Boolean(res.earned),
      progressPct: computeSafeBadgeProgress(res.progress, res.target),
    };
  });

  const unlockedBadges = catalog.filter((entry) => entry.unlocked);
  const pinnedRaw = String(profile?.activeTitleBadge || '').trim();
  const pinnedMatch =
    pinnedRaw && pinnedRaw !== 'auto'
      ? unlockedBadges.find((b) => b.id === pinnedRaw || b.name === pinnedRaw)
      : null;

  const activeBadge =
    pinnedMatch ||
    livingTitle ||
    unlockedBadges[0] || {
      id: 'default_cinefilo',
      name: 'Espectador do Cine Códice',
      category: 'living',
      iconName: 'Film',
      unlocked: true,
    };

  return {
    livingTitle,
    activeBadge,
    resolvedBadgeName: activeBadge.name,
    catalog,
    unlockedBadges,
    stats,
  };
}
