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

const AUTO_TAG_RULES = [
  { patterns: ['horror', 'terror', 'macabro'], atmospheres: ['Sombrio', 'Tenso'], tags: ['Terror'] },
  { patterns: ['supernatural', 'sobrenatural', 'oculto', 'occult', 'demons', 'vampire', 'ghost'], atmospheres: ['Sombrio', 'Tenso'], tags: ['Sobrenatural'] },
  { patterns: ['fantasy', 'fantasia', 'magic', 'magia'], atmospheres: ['Épico'], tags: ['Fantasia'] },
  { patterns: ['isekai'], atmospheres: ['Épico'], tags: ['Isekai', 'Fantasia'] },
  { patterns: ['mecha', 'robot'], atmospheres: ['Épico'], tags: ['Mecha'] },
  { patterns: ['cyberpunk', 'dystopia', 'distopia'], atmospheres: ['Sombrio'], tags: ['Cyberpunk'] },
  { patterns: ['science fiction', 'sci-fi', 'ficcao cientifica', 'space'], atmospheres: ['Épico', 'Contemplativo'], tags: ['Ficção Científica'] },
  { patterns: ['time travel', 'viagem no tempo', 'timetravel'], atmospheres: ['Tenso'], tags: ['Viagem no Tempo'] },
  { patterns: ['mystery', 'misterio', 'detective', 'investig'], atmospheres: ['Tenso'], tags: ['Mistério Investigativo'] },
  { patterns: ['noir', 'crime', 'policial', 'mafia'], atmospheres: ['Sombrio'], tags: ['Noir'] },
  { patterns: ['thriller', 'suspense', 'psychological', 'psicologico'], atmospheres: ['Tenso', 'Sombrio'], tags: [] },
  { patterns: ['drama', 'documentary', 'documentario', 'biograf', 'historical', 'historico'], atmospheres: ['Contemplativo'], tags: [] },
  { patterns: ['action', 'acao', 'adventure', 'aventura', 'epic', 'war', 'guerra'], atmospheres: ['Épico'], tags: [] },
  { patterns: ['comedy', 'comedia', 'slice of life', 'familia', 'family', 'romance'], atmospheres: ['Leve'], tags: [] },
  { patterns: ['classic', 'classico', 'retro'], atmospheres: ['Nostálgico'], tags: [] },
  { patterns: ['found family'], atmospheres: ['Nostálgico'], tags: ['Found Family'] },
];

/**
 * Converte automaticamente gêneros, keywords e texto da sinopse em chips
 * iniciais de Atmosfera/Clima e Temas/Tags relevantes para a obra.
 */
export function autoMapAtmosphereAndTags({
  genres = [],
  rawCategories = [],
  keywords = [],
  synopsis = '',
  workType = 'movie',
} = {}) {
  const tokenBlob = [
    ...(Array.isArray(genres) ? genres : []),
    ...(Array.isArray(rawCategories) ? rawCategories : []),
    ...(Array.isArray(keywords) ? keywords : []),
    String(synopsis || ''),
  ]
    .map((item) => (typeof item === 'string' ? item : item?.name || ''))
    .filter(Boolean)
    .join(' ');
  const low = normAscii(tokenBlob);

  const pickedAtmospheres = [];
  const pickedTags = [];

  for (const rule of AUTO_TAG_RULES) {
    if (rule.patterns.some((pat) => low.includes(pat))) {
      for (const atm of rule.atmospheres) {
        if (!pickedAtmospheres.includes(atm)) pickedAtmospheres.push(atm);
      }
      for (const tg of rule.tags) {
        if (!pickedTags.includes(tg)) pickedTags.push(tg);
      }
    }
  }

  if (pickedAtmospheres.length === 0) {
    pickedAtmospheres.push(workType === 'anime' ? 'Épico' : 'Contemplativo');
  }

  return {
    atmosphere: pickedAtmospheres.slice(0, 3),
    moods: pickedAtmospheres.slice(0, 3),
    tropes: pickedTags.slice(0, 5),
    tags: pickedTags.slice(0, 5),
  };
}

/**
 * Constrói um rascunho de catalogação 100% isolado campo-a-campo (sem spread cego de
 * referências mutáveis) para impedir qualquer vazamento de sinopse ou IDs entre obras.
 */
export function buildPrefilledCatalogDraft(
  item = {},
  options = {}
) {
  const {
    defaultWorkType = 'movie',
    defaultFormat = 'Streaming',
    defaultAudioFormat = 'Legendado',
  } = options || {};
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

  const cleanSynopsis = String(item.synopsis ?? item.overview ?? '').trim();
  const autoMapped = autoMapAtmosphereAndTags({
    genres: mapped.genres,
    rawCategories: rawCats,
    keywords: Array.isArray(item.keywords) ? item.keywords : [],
    synopsis: cleanSynopsis,
    workType,
  });

  const existingAtmosphere = Array.isArray(item.atmosphere)
    ? item.atmosphere.filter(Boolean)
    : Array.isArray(item.moods)
      ? item.moods.filter(Boolean)
      : [];
  const existingTropes = Array.isArray(item.tropes)
    ? item.tropes.filter(Boolean)
    : Array.isArray(item.tags)
      ? item.tags.filter(Boolean)
      : [];

  const finalAtmosphere =
    existingAtmosphere.length > 0 ? [...existingAtmosphere] : autoMapped.atmosphere;
  const finalTropes =
    existingTropes.length > 0 ? [...existingTropes] : autoMapped.tropes;

  const idsCopy =
    item.ids && typeof item.ids === 'object'
      ? { ...item.ids }
      : {
          tmdb: item.tmdbId || null,
          imdb: item.imdbId || '',
          tvmaze: item.tvmazeId || null,
          anilist: item.anilistId || null,
          mal: item.malId || null,
        };

  return {
    id: item.id || null,
    workType,
    animeFormat: item.animeFormat || (workType === 'anime' ? 'TV' : ''),
    format: item.format || defaultFormat,
    audioFormat: item.audioFormat || defaultAudioFormat,
    title: String(item.title || '').trim(),
    originalTitle: String(item.originalTitle || '').trim(),
    director: String(item.director || item.studio || item.author || '').trim(),
    author: String(item.director || item.studio || item.author || '').trim(),
    studio: String(item.studio || '').trim(),
    cast: String(item.cast || '').trim(),
    franchiseName: String(item.franchiseName || '').trim(),
    franchiseRelations: Array.isArray(item.franchiseRelations)
      ? item.franchiseRelations.map((r) => (r && typeof r === 'object' ? { ...r } : r))
      : [],
    belongsToCollection:
      item.belongsToCollection && typeof item.belongsToCollection === 'object'
        ? { ...item.belongsToCollection }
        : null,
    ids: idsCopy,
    tmdbId: idsCopy.tmdb ?? item.tmdbId ?? null,
    imdbId: String(idsCopy.imdb ?? item.imdbId ?? '').trim(),
    tvmazeId: idsCopy.tvmaze ?? item.tvmazeId ?? null,
    anilistId: idsCopy.anilist ?? item.anilistId ?? null,
    malId: idsCopy.mal ?? item.malId ?? null,
    tmdbMediaType: item.tmdbMediaType || null,
    tmdbStatus: item.tmdbStatus || null,
    showStatus: item.showStatus || null,
    animeStatus: item.animeStatus || null,
    genres: [...mapped.genres],
    primaryGenre: mapped.primaryGenre,
    subgenres: [...mapped.subgenres],
    atmosphere: finalAtmosphere,
    moods: [...finalAtmosphere],
    tropes: finalTropes,
    tags: Array.isArray(item.tags) ? [...item.tags] : [...finalTropes],
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
    episodesPerSeason: Array.isArray(item.episodesPerSeason)
      ? item.episodesPerSeason.map((n) => Math.max(1, Math.round(Number(n) || 1)))
      : [],
    currentSeason: 1,
    currentEpisode: 0,
    watchedEpisodes: {},
    fillerEpisodes: [],
    storyArcs: [],
    language: normalizeLanguageLabel(item.language || ''),
    synopsis: cleanSynopsis,
    overview: cleanSynopsis,
    coverUrl: item.coverUrl || null,
    backdropUrl: item.backdropUrl || null,
    coverCandidates: Array.isArray(item.coverCandidates) ? [...item.coverCandidates] : [],
    coverSources: Array.isArray(item.coverSources) ? [...item.coverSources] : [],
    externalRatings:
      item.externalRatings && typeof item.externalRatings === 'object'
        ? { ...item.externalRatings }
        : null,
    sourceBadge: String(item.sourceBadge || '').trim(),
    mergedSources: Array.isArray(item.mergedSources) ? [...item.mergedSources] : [],
    originCountry: Array.isArray(item.originCountry) ? [...item.originCountry] : [],
    hasTmdbAnimationGenre: Boolean(item.hasTmdbAnimationGenre),
    genreIds: Array.isArray(item.genreIds) ? [...item.genreIds] : [],
    monogram: String(item.monogram || '').trim(),
  };
}
