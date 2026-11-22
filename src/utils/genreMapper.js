function normAscii(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const LANGUAGE_MAP = {
  pt: 'Português',
  'pt-br': 'Português',
  por: 'Português',
  portuguese: 'Português',
  portugues: 'Português',
  en: 'Inglês',
  'en-us': 'Inglês',
  eng: 'Inglês',
  english: 'Inglês',
  ingles: 'Inglês',
  ja: 'Japonês',
  jp: 'Japonês',
  jpn: 'Japonês',
  japanese: 'Japonês',
  japones: 'Japonês',
  es: 'Espanhol',
  spa: 'Espanhol',
  spanish: 'Espanhol',
  espanhol: 'Espanhol',
  fr: 'Francês',
  fre: 'Francês',
  fra: 'Francês',
  french: 'Francês',
  frances: 'Francês',
  de: 'Alemão',
  deu: 'Alemão',
  german: 'Alemão',
  alemao: 'Alemão',
  it: 'Italiano',
  ita: 'Italiano',
  italian: 'Italiano',
  italiano: 'Italiano',
  ko: 'Coreano',
  kor: 'Coreano',
  korean: 'Coreano',
  coreano: 'Coreano',
  zh: 'Chinês',
  zho: 'Chinês',
  chinese: 'Chinês',
  chines: 'Chinês',
};

export function normalizeLanguageLabel(rawLanguage) {
  const clean = String(rawLanguage || '').trim();
  if (!clean) return '';
  if (clean.includes(',')) {
    return Array.from(
      new Set(
        clean
          .split(',')
          .map((part) => normalizeLanguageLabel(part))
          .filter(Boolean)
      )
    ).join(', ');
  }
  const key = normAscii(clean);
  if (LANGUAGE_MAP[key]) return LANGUAGE_MAP[key];
  return clean;
}

const GENRE_TRANSLATION_RULES = [
  { patterns: ['science fiction', 'sci-fi', 'ficcao cientifica', 'cyberpunk', 'mecha'], label: 'Ficção Científica' },
  { patterns: ['action', 'acao', 'adventure', 'aventura'], label: 'Ação & Aventura' },
  { patterns: ['drama'], label: 'Drama' },
  { patterns: ['thriller', 'suspense', 'mystery', 'misterio'], label: 'Suspense & Thriller' },
  { patterns: ['horror', 'terror', 'supernatural'], label: 'Terror' },
  { patterns: ['fantasy', 'fantasia', 'isekai', 'mahou shoujo'], label: 'Fantasia' },
  { patterns: ['crime', 'policial', 'noir'], label: 'Crime & Policial' },
  { patterns: ['comedy', 'comedia'], label: 'Comédia' },
  { patterns: ['romance'], label: 'Romance' },
  { patterns: ['animation', 'animacao', 'anime'], label: 'Animação' },
  { patterns: ['documentary', 'documentario'], label: 'Documentário' },
  { patterns: ['psychological', 'psicologico'], label: 'Psicológico' },
  { patterns: ['slice of life'], label: 'Slice of Life' },
  { patterns: ['history', 'historical', 'historia', 'historico'], label: 'Histórico' },
  { patterns: ['music', 'musical'], label: 'Musical' },
  { patterns: ['sports', 'esportes'], label: 'Esportes' },
  { patterns: ['family', 'familia'], label: 'Família' },
  { patterns: ['war', 'guerra'], label: 'Guerra' },
];

export function mapCategoriesToGenreAndSubgenres(
  rawCategories = [],
  { workType = 'movie' } = {}
) {
  const tokens = Array.isArray(rawCategories)
    ? rawCategories.map((c) => (typeof c === 'string' ? c : c?.name || '')).filter(Boolean)
    : [];

  const mapped = [];
  for (const tok of tokens) {
    const low = normAscii(tok);
    const rule = GENRE_TRANSLATION_RULES.find((r) =>
      r.patterns.some((p) => low === p || low.includes(p))
    );
    mapped.push(rule ? rule.label : tok.trim());
  }

  const unique = Array.from(new Set(mapped.filter(Boolean))).slice(0, 4);
  if (unique.length === 0) {
    if (workType === 'anime') unique.push('Animação');
    else if (workType === 'series') unique.push('Drama');
    else unique.push('Cinema');
  }

  return {
    primaryGenre: unique[0] || '',
    subgenres: unique.slice(1),
    genres: unique,
  };
}

export function buildPrefilledCatalogDraft(
  item = {},
  {
    defaultWorkType = 'movie',
    defaultFormat = 'Streaming',
    defaultAudioFormat = 'Legendado',
  } = {}
) {
  const workType = item.workType || defaultWorkType;
  const rawCats =
    Array.isArray(item.rawCategories) && item.rawCategories.length > 0
      ? item.rawCategories
      : Array.isArray(item.genres)
        ? item.genres
        : [];
  const mapped = mapCategoriesToGenreAndSubgenres(rawCats, { workType });

  const durationMinutes =
    Number(item.durationMinutes) > 0 ? Math.round(Number(item.durationMinutes)) : null;
  const totalSeconds =
    Number(item.totalSeconds) > 0
      ? Math.round(Number(item.totalSeconds))
      : workType === 'movie' && durationMinutes
        ? durationMinutes * 60
        : null;

  return {
    ...item,
    workType,
    format: item.format || defaultFormat,
    audioFormat: item.audioFormat || defaultAudioFormat,
    title: String(item.title || '').trim(),
    originalTitle: String(item.originalTitle || '').trim(),
    director: String(item.director || item.studio || item.author || '').trim(),
    studio: String(item.studio || '').trim(),
    cast: String(item.cast || '').trim(),
    genres: mapped.genres,
    primaryGenre: mapped.primaryGenre,
    subgenres: mapped.subgenres,
    releaseYear: item.releaseYear ? Number(item.releaseYear) : null,
    durationMinutes,
    totalSeconds,
    episodeDurationMinutes:
      Number(item.episodeDurationMinutes) > 0
        ? Math.round(Number(item.episodeDurationMinutes))
        : workType !== 'movie' && durationMinutes
          ? durationMinutes
          : null,
    totalSeasons: Number(item.totalSeasons) > 0 ? Math.round(Number(item.totalSeasons)) : 1,
    totalEpisodes: Number(item.totalEpisodes) > 0 ? Math.round(Number(item.totalEpisodes)) : null,
    language: normalizeLanguageLabel(item.language || ''),
    synopsis: String(item.synopsis || '').trim(),
  };
}
