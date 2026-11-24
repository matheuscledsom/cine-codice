export const OMNIPRISM_DOMAIN_IDS = ['cinema', 'reading', 'games', 'music'];

export const OMNIPRISM_DOMAINS = [
  {
    id: 'cinema',
    label: 'Cinema & Séries',
    shortLabel: 'Cinema',
    tabLabel: 'Cinema',
    favoritesTabLabel: 'Filmes',
    icon: 'Film',
    tintHex: '#D97706',
    beamHex: '#F59E0B',
    status: 'active',
    badge: 'Filmes · Séries · Animes',
    description: 'Filmes, séries, animes e cronologias',
    creatorLabel: 'Direção / Estúdio',
    queueLabel: 'Quero Ver',
    playingLabel: 'Assistindo',
  },
  {
    id: 'reading',
    label: 'Leitura & Acadêmico',
    shortLabel: 'Leitura',
    tabLabel: 'Livros',
    favoritesTabLabel: 'Livros',
    icon: 'BookOpen',
    tintHex: '#059669',
    beamHex: '#10B981',
    status: 'active',
    badge: 'Livros · Mangás · Papers',
    description: 'Livros, mangás, artigos e filosofia',
    creatorLabel: 'Autor(a)',
    queueLabel: 'Quero Ler',
    playingLabel: 'Lendo',
  },
  {
    id: 'games',
    label: 'Games',
    shortLabel: 'Games',
    tabLabel: 'Games',
    favoritesTabLabel: 'Games',
    icon: 'Gamepad2',
    tintHex: '#7C3AED',
    beamHex: '#8B5CF6',
    status: 'active',
    badge: 'Jogos · DLCs · Modpacks',
    description: 'Campanhas, horas jogadas e plataformas',
    creatorLabel: 'Estúdio / Desenvolvedora',
    queueLabel: 'Quero Jogar',
    playingLabel: 'Jogando',
  },
  {
    id: 'music',
    label: 'Música',
    shortLabel: 'Música',
    tabLabel: 'Música',
    favoritesTabLabel: 'Música',
    icon: 'Music',
    tintHex: '#BE123C',
    beamHex: '#F43F5E',
    status: 'active',
    badge: 'Faixas · Álbuns · Discografias',
    description: 'Faixas, álbuns, shows e discografias',
    creatorLabel: 'Artista / Banda',
    queueLabel: 'Quero Ouvir',
    playingLabel: 'Ouvindo',
  },
];

export const DOMAIN_VOCABULARY = {
  cinema: {
    domainId: 'cinema',
    tabLabel: 'Cinema',
    favoritesTabLabel: 'Filmes',
    favoritesTitle: 'Favoritos da Vida · Filmes',
    workTypeLabel: 'Formato Audiovisual',
    creatorLabel: 'Direção / Estúdio',
    creatorFallback: 'Direção não informada',
    ratingLabel: 'Nota (0–100)',
    searchPlaceholder: 'Buscar filme, série, anime ou direção...',
    addSearchPlaceholder: 'Buscar filme, série, anime, diretor ou estúdio...',
    homeEmptySearchPlaceholder: 'Buscar um filme, série ou anime...',
    emptyTitle: 'Nenhum título de Cinema & Séries ainda',
    emptyDescription: 'Catalogue filmes, séries e animes para acompanhar episódios e notas.',
    emptyCta: 'Catalogar título',
    rouletteButtonLabel: 'Sortear da fila Quero Ver',
    rouletteTitle: 'O que assistir hoje?',
    rouletteSubtitle: 'Roleta da fila Quero Ver',
    continueLastLabel: 'Continuar última sessão',
    startActionLabel: 'Começar',
    revisitLabel: 'Quero rever',
    revisitActiveLabel: 'Quero rever (ativo)',
    revisitBadgePrefix: 'Rewatch',
    wishlistToggleLabel: 'Guardar na lista',
    notesTabLabel: 'Cenas & Diário',
    loanLabel: 'Mídia física emprestada',
    manualTitlePlaceholder: 'Ex: Blade Runner 2049',
    manualGenresPlaceholder: 'Ex: Ficção Científica, Noir',
    completedPluralLabel: 'Concluídos',
    addButtonLabel: 'Adicionar',
    statuses: {
      queued: 'Quero Ver',
      playing: 'Assistindo',
      rewatching: 'Reassistindo',
      paused: 'Pausado',
      completed: 'Concluído',
      dropped: 'Abandonado',
    },
  },
  reading: {
    domainId: 'reading',
    tabLabel: 'Livros',
    favoritesTabLabel: 'Livros',
    favoritesTitle: 'Favoritos da Vida · Livros',
    workTypeLabel: 'Tipo',
    creatorLabel: 'Autor(a)',
    creatorFallback: 'Autor não informado',
    ratingLabel: 'Nota (0–100)',
    searchPlaceholder: 'Buscar livro, autor, mangá ou ISBN...',
    addSearchPlaceholder: 'Buscar livro, mangá, autor ou ISBN...',
    homeEmptySearchPlaceholder: 'Buscar um livro ou mangá...',
    emptyTitle: 'Nenhum livro ou leitura ainda',
    emptyDescription: 'Catalogue livros, mangás e artigos para acompanhar páginas e capítulos.',
    emptyCta: 'Catalogar livro',
    rouletteButtonLabel: 'Sortear da fila Quero Ler',
    rouletteTitle: 'O que ler hoje?',
    rouletteSubtitle: 'Roleta da fila Quero Ler',
    continueLastLabel: 'Continuar última leitura',
    startActionLabel: 'Começar a ler',
    revisitLabel: 'Quero reler',
    revisitActiveLabel: 'Quero reler (ativo)',
    revisitBadgePrefix: 'Releitura',
    wishlistToggleLabel: 'Guardar para ler',
    notesTabLabel: 'Citações & Notas',
    loanLabel: 'Livro emprestado',
    manualTitlePlaceholder: 'Ex: A Metamorfose',
    manualGenresPlaceholder: 'Ex: Clássico, Filosofia',
    completedPluralLabel: 'Lidos',
    addButtonLabel: 'Adicionar',
    statuses: {
      queued: 'Quero Ler',
      playing: 'Lendo',
      rewatching: 'Relendo',
      paused: 'Pausado',
      completed: 'Lido',
      dropped: 'Abandonado',
    },
  },
  games: {
    domainId: 'games',
    tabLabel: 'Games',
    favoritesTabLabel: 'Games',
    favoritesTitle: 'Favoritos da Vida · Games',
    workTypeLabel: 'Tipo',
    creatorLabel: 'Estúdio / Desenvolvedora',
    creatorFallback: 'Estúdio não informado',
    ratingLabel: 'Nota (0–11)',
    searchPlaceholder: 'Buscar jogo, estúdio, remake ou plataforma...',
    addSearchPlaceholder: 'Buscar jogo, remake, DLC ou plataforma...',
    homeEmptySearchPlaceholder: 'Buscar um jogo...',
    emptyTitle: 'Nenhum jogo catalogado ainda',
    emptyDescription: 'Catalogue jogos, remakes e DLCs com plataforma e horas jogadas.',
    emptyCta: 'Catalogar jogo',
    rouletteButtonLabel: 'Sortear da fila Quero Jogar',
    rouletteTitle: 'O que jogar hoje?',
    rouletteSubtitle: 'Roleta da fila Quero Jogar',
    continueLastLabel: 'Continuar último jogo',
    startActionLabel: 'Começar a jogar',
    revisitLabel: 'Quero rejogar',
    revisitActiveLabel: 'Quero rejogar (ativo)',
    revisitBadgePrefix: 'Rejogada',
    wishlistToggleLabel: 'Guardar para jogar',
    notesTabLabel: 'Momentos & Diário',
    loanLabel: 'Jogo físico emprestado',
    manualTitlePlaceholder: 'Ex: Shadow of the Colossus',
    manualGenresPlaceholder: 'Ex: Aventura, RPG',
    completedPluralLabel: 'Zerados',
    addButtonLabel: 'Adicionar',
    statuses: {
      queued: 'Quero Jogar',
      playing: 'Jogando',
      rewatching: 'Rejogando',
      paused: 'Pausado',
      completed: 'Zerado',
      dropped: 'Abandonado',
    },
  },
  music: {
    domainId: 'music',
    tabLabel: 'Música',
    favoritesTabLabel: 'Música',
    favoritesTitle: 'Favoritos da Vida · Música',
    workTypeLabel: 'Tipo',
    creatorLabel: 'Artista / Banda',
    creatorFallback: 'Artista não informado',
    ratingLabel: 'Nota (0–100)',
    trackRatingLabel: 'Nota da faixa (0–10)',
    searchPlaceholder: 'Buscar faixa, álbum, artista ou subgênero...',
    addSearchPlaceholder: 'Buscar faixa, álbum, EP, artista ou show...',
    homeEmptySearchPlaceholder: 'Buscar um álbum ou faixa...',
    emptyTitle: 'Nenhuma música ou álbum ainda',
    emptyDescription: 'Catalogue faixas, álbuns e discografias com notas e audições.',
    emptyCta: 'Catalogar música',
    rouletteButtonLabel: 'Sortear da fila Quero Ouvir',
    rouletteTitle: 'O que ouvir hoje?',
    rouletteSubtitle: 'Roleta da fila Quero Ouvir',
    continueLastLabel: 'Continuar última audição',
    startActionLabel: 'Começar a ouvir',
    revisitLabel: 'Quero reouvir',
    revisitActiveLabel: 'Quero reouvir (ativo)',
    revisitBadgePrefix: 'Reaudição',
    wishlistToggleLabel: 'Guardar para ouvir',
    notesTabLabel: 'Letras & Notas',
    loanLabel: 'Vinil / CD emprestado',
    manualTitlePlaceholder: 'Ex: Master of Puppets',
    manualGenresPlaceholder: 'Ex: Heavy Metal, Rock',
    completedPluralLabel: 'Ouvidos',
    addButtonLabel: 'Adicionar',
    statuses: {
      queued: 'Quero Ouvir',
      playing: 'Ouvindo',
      rewatching: 'Reouvindo',
      paused: 'Pausado',
      completed: 'Ouvido',
      dropped: 'Abandonado',
    },
  },
  all: {
    domainId: 'all',
    tabLabel: 'Todos',
    favoritesTabLabel: 'Todos',
    favoritesTitle: 'Favoritos da Vida',
    workTypeLabel: 'Tipo',
    creatorLabel: 'Criador',
    creatorFallback: 'Criador não informado',
    ratingLabel: 'Nota',
    searchPlaceholder: 'Buscar obra, autor, estúdio, artista ou tag...',
    addSearchPlaceholder: 'Buscar filme, livro, jogo ou álbum...',
    homeEmptySearchPlaceholder: 'Buscar um filme, livro, jogo ou álbum...',
    emptyTitle: 'Seu arquivo está vazio',
    emptyDescription: 'Busque um filme, livro, jogo ou álbum para começar.',
    emptyCta: 'Catalogar obra',
    rouletteButtonLabel: 'Sortear da fila',
    rouletteTitle: 'Sortear da fila',
    rouletteSubtitle: 'Roleta da sua fila',
    continueLastLabel: 'Continuar mais recente',
    startActionLabel: 'Começar',
    revisitLabel: 'Quero revisitar',
    revisitActiveLabel: 'Quero revisitar (ativo)',
    revisitBadgePrefix: 'Revisita',
    wishlistToggleLabel: 'Guardar na lista',
    notesTabLabel: 'Notas & Diário',
    loanLabel: 'Item emprestado',
    manualTitlePlaceholder: 'Título da obra',
    manualGenresPlaceholder: 'Separados por vírgula',
    completedPluralLabel: 'Concluídos',
    addButtonLabel: 'Adicionar',
    statuses: {
      queued: 'Na Fila',
      playing: 'Em andamento',
      rewatching: 'Revendo',
      paused: 'Pausado',
      completed: 'Concluído',
      dropped: 'Abandonado',
    },
  },
};

export const DOMAIN_MEDIA_TYPES = {
  cinema: [
    { id: 'movie', label: 'Filme', shortLabel: 'Filme', pluralLabel: 'Filmes', icon: 'Film' },
    { id: 'series', label: 'Série', shortLabel: 'Série', pluralLabel: 'Séries', icon: 'Tv' },
    { id: 'anime', label: 'Anime', shortLabel: 'Anime', pluralLabel: 'Animes', icon: 'Clapperboard' },
  ],
  reading: [
    { id: 'book', label: 'Livro', shortLabel: 'Livro', pluralLabel: 'Livros', icon: 'BookOpen' },
    { id: 'manga', label: 'Mangá / HQ', shortLabel: 'Mangá / HQ', pluralLabel: 'Mangás / HQs', icon: 'Layers' },
    { id: 'paper', label: 'Artigo / Paper', shortLabel: 'Artigo / Paper', pluralLabel: 'Artigos / Papers', icon: 'FileText' },
    { id: 'technical', label: 'Livro Técnico / Filosofia', shortLabel: 'Técnico / Fil.', pluralLabel: 'Técnicos / Fil.', icon: 'Compass' },
  ],
  games: [
    { id: 'game', label: 'Jogo', shortLabel: 'Jogo', pluralLabel: 'Jogos', icon: 'Gamepad2' },
    { id: 'dlc', label: 'DLC / Expansão', shortLabel: 'DLC', pluralLabel: 'DLCs', icon: 'Sparkles' },
    { id: 'modpack', label: 'Modpack / Hack', shortLabel: 'Modpack', pluralLabel: 'Modpacks', icon: 'Layers' },
  ],
  music: [
    { id: 'track', label: 'Faixa', shortLabel: 'Faixa', pluralLabel: 'Faixas', icon: 'Music' },
    { id: 'album', label: 'Álbum', shortLabel: 'Álbum', pluralLabel: 'Álbuns', icon: 'Music' },
    { id: 'ep_single', label: 'EP / Single', shortLabel: 'EP / Single', pluralLabel: 'EPs / Singles', icon: 'Music' },
    { id: 'discography', label: 'Artista / Banda', shortLabel: 'Artista / Banda', pluralLabel: 'Artistas / Bandas', icon: 'Award' },
    { id: 'live_show', label: 'Show / Ao Vivo', shortLabel: 'Ao Vivo', pluralLabel: 'Shows Ao Vivo', icon: 'Sparkles' },
  ],
};

export const BOOK_FORMATS = ['Físico', 'EPUB', 'PDF'];

export const GAME_PLATFORM_UNSET_LABEL = 'Plataforma a definir';

export const GAME_PLATFORMS = [
  'PS1',
  'PS2',
  'PS3',
  'PS4',
  'PS5',
  'PSP',
  'SNES',
  'GBA',
  'DS',
  '3DS',
  'Switch',
  'PC',
  'Mobile',
];

export const GAME_EDITION_TYPES = [
  'Original',
  'Remake',
  'Remaster',
  'Port',
  'DLC/Expansão',
];

export const GAME_COMPLETION_TYPES = [
  'História Principal',
  '100% / Platina',
  'Multiplayer / Ranked',
  'Emulação',
];

export const GAME_STORES_LAUNCHERS = [
  'Mídia Física / Console',
  'PlayStation Store',
  'Nintendo eShop',
  'Steam',
  'Nuuvem',
  'Epic / GOG',
  'Prism Launcher',
  'PCSX2',
  'mGBA',
  'RetroArch / Emulador',
];

export const MUSIC_RELEASE_FORMATS = [
  'Álbum de Estúdio',
  'Faixa Individual',
  'Ao Vivo',
  'Coletânea',
];

export function normalizeDomainId(rawDomain) {
  const clean = String(rawDomain || '').trim().toLowerCase();
  return OMNIPRISM_DOMAIN_IDS.includes(clean) ? clean : 'cinema';
}

export function getDomainMeta(domainId = 'cinema') {
  const clean = normalizeDomainId(domainId);
  return OMNIPRISM_DOMAINS.find((d) => d.id === clean) || OMNIPRISM_DOMAINS[0];
}

export function getMediaTypesForDomain(domainId = 'cinema') {
  const clean = normalizeDomainId(domainId);
  return DOMAIN_MEDIA_TYPES[clean] || DOMAIN_MEDIA_TYPES.cinema;
}

export function inferDomainFromWork(work = {}) {
  if (work?.domain && OMNIPRISM_DOMAIN_IDS.includes(String(work.domain).trim().toLowerCase())) {
    return String(work.domain).trim().toLowerCase();
  }
  const type = String(work?.workType || work?.mediaType || work?.media_type || '')
    .trim()
    .toLowerCase();
  if (['book', 'manga', 'paper', 'technical', 'academic', 'hq'].includes(type)) {
    return 'reading';
  }
  if (['game', 'dlc', 'modpack', 'romhack'].includes(type)) {
    return 'games';
  }
  if (
    [
      'track',
      'song',
      'faixa',
      'album',
      'ep_single',
      'ep',
      'single',
      'discography',
      'artist',
      'band',
      'live_show',
    ].includes(type)
  ) {
    return 'music';
  }
  return 'cinema';
}

export function normalizeWorkTypeForDomain(rawType, domain = 'cinema') {
  const cleanDomain = normalizeDomainId(domain);
  const clean = String(rawType || '').trim().toLowerCase();

  if (cleanDomain === 'reading') {
    if (clean === 'manga' || clean === 'hq' || clean === 'comic') return 'manga';
    if (clean === 'paper' || clean === 'article' || clean === 'artigo') return 'paper';
    if (clean === 'technical' || clean === 'academic' || clean === 'philosophy') return 'technical';
    return 'book';
  }
  if (cleanDomain === 'games') {
    if (clean === 'dlc' || clean === 'expansion') return 'dlc';
    if (clean === 'modpack' || clean === 'hack' || clean === 'romhack') return 'modpack';
    return 'game';
  }
  if (cleanDomain === 'music') {
    if (clean === 'track' || clean === 'song' || clean === 'faixa') return 'track';
    if (clean === 'ep_single' || clean === 'ep' || clean === 'single') return 'ep_single';
    if (clean === 'discography' || clean === 'band' || clean === 'artist' || clean === 'artista') {
      return 'discography';
    }
    if (clean === 'live_show' || clean === 'live' || clean === 'show') return 'live_show';
    return 'album';
  }

  if (clean === 'series' || clean === 'tv' || clean === 'serie' || clean === 'show') {
    return 'series';
  }
  if (clean === 'anime' || clean === 'ova' || clean === 'ona') {
    return 'anime';
  }
  return 'movie';
}

export function getWorkTypeLabel(workOrType, domainArg = null) {
  const isObj = typeof workOrType === 'object' && workOrType !== null;
  const domain = domainArg
    ? normalizeDomainId(domainArg)
    : isObj
      ? inferDomainFromWork(workOrType)
      : inferDomainFromWork({ workType: workOrType });
  const rawType = isObj ? workOrType.workType || workOrType.mediaType : workOrType;
  const norm = normalizeWorkTypeForDomain(rawType, domain);
  const found = getMediaTypesForDomain(domain).find((t) => t.id === norm);
  return found ? found.shortLabel : 'Obra';
}

export const domainConfig = {
  domainKey: 'cine',
  domain: 'Cinema, Séries & Animes',
  domainSingular: 'Obra',
  appName: 'OmniPrism',
  appSubtitle: 'Catálogo Pessoal · Cinema & Séries',
  appFullTitle: 'OmniPrism',
  signature: 'OmniPrism · Camaleão',
  publicHost: 'omniprism.app',
  storageKey: 'cine_codice_backlog_v1',
  profileStorageKey: 'cine_codice_profile_v1',
  postsStorageKey: 'cine_codice_posts_v1',
  streakStorageKey: 'cine_codice_streak_v1',
  geminiStorageKey: 'cine_codice_gemini_key_v1',
  tmdbStorageKey: 'cine_codice_tmdb_key_v1',
  currentYear: 2026,

  statuses: {
    queued: {
      id: 'queued',
      label: 'Quero Ver',
      color: '#737373',
      dotClass: 'bg-neutral-400',
      badgeClass: 'bg-neutral-500/15 text-muted border-line',
    },
    playing: {
      id: 'playing',
      label: 'Assistindo',
      color: 'var(--accent-color)',
      dotClass: 'bg-accent',
      badgeClass: 'bg-accent/15 text-accent border-accent/30',
    },
    completed: {
      id: 'completed',
      label: 'Concluído',
      color: '#10B981',
      dotClass: 'bg-emerald-400',
      badgeClass: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    },
    paused: {
      id: 'paused',
      label: 'Pausado',
      color: '#F59E0B',
      dotClass: 'bg-amber-400',
      badgeClass: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    },
    rewatching: {
      id: 'rewatching',
      label: 'Reassistindo',
      color: '#38BDF8',
      dotClass: 'bg-sky-400',
      badgeClass: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
    },
    dropped: {
      id: 'dropped',
      label: 'Abandonado',
      color: '#F43F5E',
      dotClass: 'bg-rose-400',
      badgeClass: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
    },
  },
  statusOrder: ['playing', 'rewatching', 'queued', 'paused', 'completed', 'dropped'],
  addFlowStatuses: ['queued', 'playing', 'completed'],

  workTypes: [
    { id: 'movie', label: 'Filme', shortLabel: 'Filme', icon: 'Film' },
    { id: 'series', label: 'Série', shortLabel: 'Série', icon: 'Tv' },
    { id: 'anime', label: 'Anime', shortLabel: 'Anime', icon: 'Clapperboard' },
  ],

  searchFilters: [
    { id: 'all', label: 'Todos' },
    { id: 'movie', label: 'Filmes' },
    { id: 'series', label: 'Séries' },
    { id: 'anime', label: 'Animes' },
  ],

  mediaFormats: ['Streaming', 'Cinema', 'Blu-ray / 4K', 'VHS / DVD'],
  formatOptions: ['Streaming', 'Cinema', 'Blu-ray / 4K', 'VHS / DVD'],
  audioFormatTags: ['Legendado', 'Dublado', 'Original', 'IMAX/4K'],
  animeFormats: ['TV', 'Filme', 'OVA', 'ONA', 'Especial'],
  pubStatuses: ['Em exibição', 'Finalizado', 'Hiato'],

  atmosphereOptions: [
    { id: 'Sombrio', label: 'Sombrio', icon: 'Moon' },
    { id: 'Épico', label: 'Épico', icon: 'Mountain' },
    { id: 'Contemplativo', label: 'Contemplativo', icon: 'Compass' },
    { id: 'Tenso', label: 'Tenso', icon: 'Flame' },
    { id: 'Nostálgico', label: 'Nostálgico', icon: 'Film' },
    { id: 'Leve', label: 'Leve', icon: 'Feather' },
  ],

  suggestedTropes: [
    'Cyberpunk',
    'Viagem no Tempo',
    'Noir',
    'Found Family',
    'Plano-Sequência',
    'Mecha',
    'Isekai',
    'Mistério Investigativo',
  ],

  tactileOptions: {
    quickMinutes: [15, 20, 30],
    quickEpisodes: [1, 3],
    hypeLevels: [
      { id: 'urgent', label: 'Sessão Imediata', icon: 'Flame', weight: 4 },
      { id: 'high', label: 'Alta Prioridade', icon: 'Star', weight: 3 },
      { id: 'curious', label: 'Na Fila', icon: 'Eye', weight: 2 },
      { id: 'low', label: 'Sem Pressa', icon: 'Snowflake', weight: 1 },
    ],
    durationPresets: [
      { value: 90, label: '1h30' },
      { value: 120, label: '2h00' },
      { value: 150, label: '2h30' },
      { value: 180, label: '3h00' },
    ],
    verdicts: [
      { id: 'Obra-Prima', minScore: 90, badgeClass: 'border-amber-400/40 bg-amber-400/15 text-amber-400' },
      { id: 'Excelente', minScore: 80, badgeClass: 'border-accent/40 bg-accent/15 text-accent' },
      { id: 'Muito Bom', minScore: 70, badgeClass: 'border-emerald-400/40 bg-emerald-400/15 text-emerald-400' },
      { id: 'Regular', minScore: 50, badgeClass: 'border-line bg-elevated text-muted' },
      { id: 'Abaixo do Esperado', minScore: 0, badgeClass: 'border-rose-500/40 bg-rose-500/15 text-rose-400' },
    ],
    dropReasons: [
      { id: 'Ritmo arrastado', label: 'Ritmo arrastado', icon: 'Moon' },
      { id: 'Fillers em excesso', label: 'Fillers em excesso', icon: 'Layers' },
      { id: 'Pausa / Sem tempo', label: 'Pausa / Sem tempo', icon: 'Hourglass' },
      { id: 'Não conectou', label: 'Não conectou', icon: 'HeartCrack' },
    ],
  },

  fields: {
    format: { key: 'format', label: 'Mídia / Sala', shortLabel: 'Mídia', type: 'text' },
    audioFormat: { key: 'audioFormat', label: 'Áudio / Legenda', shortLabel: 'Áudio', type: 'text' },
    rating: { key: 'rating', label: 'Nota Final', shortLabel: 'Nota', unit: '/100', type: 'number' },
    genres: { key: 'genres', label: 'Gêneros', shortLabel: 'Gêneros', type: 'array' },
    director: { key: 'director', label: 'Direção / Estúdio', shortLabel: 'Direção', type: 'text' },
    releaseYear: { key: 'releaseYear', label: 'Ano', shortLabel: 'Ano', type: 'number' },
    progress: { key: 'progress', label: 'Progresso', shortLabel: 'Prog.', unit: '%', type: 'number' },
    notes: { key: 'notes', label: 'Crítica Pessoal', shortLabel: 'Crítica', type: 'text' },
  },
  cardFields: {
    primary: 'format',
    secondary: 'audioFormat',
    rating: 'rating',
    genres: 'genres',
    creator: 'director',
    year: 'releaseYear',
    progress: 'progress',
    notes: 'notes',
  },

  navigation: [
    { id: 'home', label: 'Início', icon: 'Home' },
    { id: 'stats', label: 'Métricas', icon: 'BarChart2' },
    { id: 'add', label: 'Catalogar', icon: 'PlusCircle', isCenterHighlight: true },
    { id: 'list', label: 'Catálogo', icon: 'Library' },
    { id: 'profile', label: 'Perfil', icon: 'User' },
  ],

  ui: {
    home: {
      greetingPrefix: 'Arquivo de',
      subtitle: 'Catálogo Pessoal Multi-Domínio',
      signature: 'OmniPrism · Camaleão',
      annualGoalTitle: 'Meta Anual',
      continueWatchingTitle: 'Em andamento',
      resumeLabel: 'Retomar',
      highlightsTitle: 'Destaques',
      highlightsEmptyTitle: 'Seu catálogo começa aqui',
      highlightsEmptyDescription:
        'Busque um título para acompanhar seu progresso em cinema, livros, games e música.',
      summaryCards: {
        total: 'Total no Catálogo',
        completedYear: 'Concluídos no Ano',
        playingNow: 'Em Andamento',
      },
      activeSectionTitle: 'Em andamento',
      emptyActiveMessage: 'Nenhum item ativo no momento.',
      emptyActiveCta: 'Escolher próximo item',
      seeAllLabel: 'Ver catálogo',
      emptyBacklogTitle: 'Seu catálogo está vazio',
      emptyBacklogDescription:
        'Catalogue filmes, livros, games e músicas em um único lugar.',
      emptyBacklogCta: 'Catalogar primeira Obra',
    },
    stats: {
      title: 'Métricas',
      subtitle: 'Horas em tela, maratonas, notas e histórico anual',
      completionRateTitle: 'Taxa de Conclusão',
      completionRateSubtitle: 'Obras finalizadas sobre o total do catálogo',
      completedLabel: 'Concluídos',
      totalLabel: 'No Catálogo',
      statusDistributionTitle: 'Distribuição por Status',
      workTypeDistributionTitle: 'Distribuição por Formato',
      topRankingTitle: 'Top Direção / Estúdios & Gêneros',
      creatorsTabLabel: 'Direção / Estúdio',
      genresTabLabel: 'Gêneros',
      topEmptyMessage: 'Sem dados suficientes ainda.',
      timeBalanceTitle: 'Tempo em Tela',
      timeBalanceSubtitle: 'Horas assistidas vs. horas na fila Quero Ver',
      watchedHoursLabel: 'Horas Assistidas',
      queuedHoursLabel: 'Estimado em Quero Ver',
      hallOfFameTitle: 'Sala de Projeção',
      avgRatingLabel: 'Média das Notas',
      lifeFavoritesLabel: 'Obras-Primas',
      episodesWatchedLabel: 'Episódios Vistos',
      hoursUnit: 'h',
      countSingular: 'obra',
      countPlural: 'obras',
      emptyStatsTitle: 'Sem métricas ainda',
      emptyStatsDescription: 'Catalogue seu primeiro filme, série ou anime para acompanhar o ritmo.',
    },
    add: {
      title: 'Catalogar',
      subtitle: 'Busca paralela em AniList, MAL, TVmaze, TMDB, IMDb, Wikidata & Internet Archive',
      searchPlaceholder: 'Título de filme, série, anime, diretor ou estúdio...',
      suggestionsLabel: 'Sugestões do Catálogo',
      resultsLabel: 'Resultados',
      inListBadge: 'No Catálogo',
      emptySearchTitle: 'Nenhuma obra encontrada',
      emptySearchDescription: 'Tente o título original, mude o filtro ou cadastre manualmente.',
      defaultNewStatus: 'queued',
      drawerTitle: 'Catalogar Obra',
      drawerStatusLabel: 'Status inicial',
      drawerFormatLabel: 'Mídia / Sala',
      drawerAudioLabel: 'Áudio / Legenda',
      drawerWorkTypeLabel: 'Tipo',
      drawerSaveLabel: 'Guardar no Catálogo',
      drawerCancelLabel: 'Cancelar',
      manualButtonLabel: 'Cadastro Manual',
      manualModalTitle: 'Nova Obra Manual',
      manualTitleLabel: 'Título',
      manualTitlePlaceholder: 'Ex: Blade Runner 2049',
      manualCreatorLabel: 'Diretor(a) ou Estúdio',
      manualCreatorPlaceholder: 'Opcional (ex: Denis Villeneuve / Studio Ghibli)',
      manualYearLabel: 'Ano',
      manualDurationLabel: 'Duração (min)',
      manualGenresLabel: 'Gêneros',
      manualGenresPlaceholder: 'Separados por vírgula (ex: Ficção Científica, Noir)',
    },
    list: {
      title: 'Catálogo',
      allTabLabel: 'Todos',
      allTypesLabel: 'Todos os formatos',
      emptyMessage: 'Nenhuma obra neste filtro.',
      emptyBacklogTitle: 'Seu catálogo está vazio',
      emptyBacklogCta: 'Catalogar primeira Obra',
      countSingular: 'obra',
      countPlural: 'obras',
      sortOptions: [
        { id: 'recent', label: 'Recentes' },
        { id: 'rating', label: 'Maior Nota' },
        { id: 'hype', label: 'Prioridade' },
        { id: 'duration', label: 'Maior Duração' },
        { id: 'title', label: 'Título A–Z' },
      ],
      layoutOptions: {
        grid: 'Grade',
        detailed: 'Lista',
        shelf: 'Estante',
      },
      daysSuffix: 'dias p/ concluir',
    },
    theme: {
      title: 'Estúdio Visual',
      modeLabel: 'Atmosferas Base',
      accentLabel: 'Cor de Destaque',
      closeLabel: 'Fechar',
    },
    profile: {
      handle: '@meu-arquivo',
      displayName: 'Meu arquivo',
      avatarInitials: 'MA',
      avatarUrl: '',
      coverUrl: '',
      bio: 'Catálogo pessoal multi-domínio — filmes, livros, games e música.',
      linkLabel: 'omniprism.app/@meu-arquivo',
      linkUrl: 'https://omniprism.app/@meu-arquivo',
      xpConfig: {
        perMinute: 0.25,
        perEpisode: 12,
        perCompleted: 150,
        perPlatinum: 300,
        xpPerLevel: 500,
      },
      levelPrefix: 'Nv.',
      xpTitle: 'Patente do Catálogo',
      editProfileLabel: 'Editar Perfil',
      newPostLabel: 'Novo Bilhete',
      metrics: {
        total: 'Catálogo',
        completed: 'Concluídos',
        hours: 'Horas Vistas',
      },
      tabs: [
        { id: 'journal', label: 'Diário', icon: 'Film' },
        { id: 'trophies', label: 'Estante', icon: 'Trophy' },
        { id: 'radar', label: 'Fila', icon: 'Bookmark' },
      ],
      emptyJournalTitle: 'Seu Diário de Sessões está vazio',
      emptyJournalDescription: 'Registre ingressos, impressões de sessão, capturas e diálogos marcantes.',
      emptyJournalCta: 'Registrar primeira sessão',
      emptyTrophies: 'Nenhuma obra concluída ou favoritada ainda.',
      emptyRadar: 'Nenhum item na fila ainda.',
      editModal: {
        title: 'Editar Perfil',
        coverLabel: 'Banner do Catálogo',
        coverUploadLabel: 'Enviar imagem',
        coverUrlPlaceholder: 'Ou cole uma URL da capa...',
        avatarLabel: 'Avatar Circular',
        avatarUploadLabel: 'Trocar foto',
        avatarUrlPlaceholder: 'Ou cole uma URL do avatar...',
        nameLabel: 'Nome',
        handleLabel: '@handle',
        bioLabel: 'Bio',
        linkLabel: 'Link',
        saveLabel: 'Salvar Perfil',
        clearImageLabel: 'Remover',
      },
      journalComposer: {
        title: 'Registrar Sessão no Diário',
        itemLabel: 'Obra vinculada',
        noItemsHint: 'Catalogue uma obra no catálogo primeiro para vincular.',
        postTitleLabel: 'Título do Registro',
        postTitlePlaceholder: 'Ex: Projeção noturna em 4K · Cena final',
        captionLabel: 'Impressão / Diálogo / Nota da Sessão',
        captionPlaceholder: 'Anote uma fala marcante, escolha de fotografia ou reflexão da sessão...',
        mediaLabel: 'Capturas ou Clipes',
        addPhotosLabel: 'Adicionar Imagens',
        videoUrlPlaceholder: 'Link de trailer ou cena...',
        addVideoLabel: 'Anexar',
        publishLabel: 'Guardar no Diário',
      },
      postModal: {
        commentsTitle: 'Notas & Comentários da Sessão',
        commentPlaceholder: 'Nova nota de sessão...',
        commentSubmitLabel: 'Enviar',
        emptyComments: 'Registre observações ao longo da maratona ou reassistida.',
        deletePostLabel: 'Excluir registro',
      },
      backup: {
        menuLabel: 'Opções de backup e exportação',
        exportLabel: 'Exportar Backup Assinado (.json)',
        exportCsvLabel: 'Exportar Catálogo (.csv)',
        importLabel: 'Importar Backup (.json)',
        importSuccessPrefix: 'Backup importado:',
        importError: 'Arquivo JSON inválido.',
      },
    },
    detail: {
      workTypeTitle: 'Tipo',
      statusTitle: 'Status',
      formatTitle: 'Mídia / Sala',
      audioFormatTitle: 'Áudio / Legenda',
      hypeLabel: 'Prioridade na Fila',
      durationLabel: 'Duração Total (min)',
      startDateLabel: 'Data de Início',
      completedDateLabel: 'Data de Conclusão',
      dropDateLabel: 'Data do Abandono',
      directorLabel: 'Direção / Criador / Estúdio',
      castLabel: 'Elenco Principal',
      studioLabel: 'Estúdio / Produtora / Canal',
      yearLabel: 'Ano',
      atmosphereSectionTitle: 'Ficha Técnica & Atmosfera',
      atmosphereLabel: 'Atmosfera / Clima',
      tropesLabel: 'Temas & Tropos',
      tropePlaceholder: 'Adicionar tema ou tropo...',
      progressLabel: 'Progresso',
      checkpointLabel: 'Cena / Episódio de Parada',
      checkpointPlaceholder: 'Ex: T02E05 · Cena da ponte (00:32:10)',
      journalButtonLabel: 'Registrar sessão no Diário',
      lifeFavoriteLabel: 'Obra-Prima / Favorito da Vida',
      smartReviewTitle: 'Avaliação & DNA (0–100)',
      finalScoreLabel: 'Nota Ponderada',
      verdictLabel: 'Veredito',
      dropReasonLabel: 'Motivo do Abandono',
      notesLabel: 'Crítica Pessoal',
      notesPlaceholder: 'Escreva sua crítica, impressões de direção, trilha ou atuações...',
      favoriteLabel: 'Favorito',
      wishlistLabel: 'Guardar na lista',
      removeLabel: 'Remover do catálogo',
      closeLabel: 'Fechar',
    },
  },
};

export function getDomainVocabulary(domain = 'cinema') {
  if (String(domain || '').trim().toLowerCase() === 'all') {
    return DOMAIN_VOCABULARY.all;
  }
  const clean = normalizeDomainId(domain);
  return DOMAIN_VOCABULARY[clean] || DOMAIN_VOCABULARY.cinema;
}

export function getStatusLabelForDomain(statusId, domain = 'cinema') {
  const vocab = getDomainVocabulary(domain);
  const key = normalizeCinemaStatus(statusId);
  return vocab.statuses[key] || DOMAIN_VOCABULARY.cinema.statuses[key] || domainConfig.statuses.queued.label;
}

export function getStatusConfigForDomain(statusId, domain = 'cinema') {
  const key = normalizeCinemaStatus(statusId);
  const base = domainConfig.statuses[key] ?? domainConfig.statuses.queued;
  return {
    ...base,
    label: getStatusLabelForDomain(key, domain),
  };
}

export function getStatusListForDomain(domain = 'cinema') {
  return domainConfig.statusOrder.map((id) => getStatusConfigForDomain(id, domain));
}

export function getStatusList(domain = 'cinema') {
  return getStatusListForDomain(domain);
}

export function getStatusConfig(statusId, domain = 'cinema') {
  return getStatusConfigForDomain(statusId, domain);
}

export function getWorkTypeConfig(workTypeId) {
  const normalized = normalizeCinemaWorkType(workTypeId);
  return (
    domainConfig.workTypes.find((type) => type.id === normalized) ??
    domainConfig.workTypes[0]
  );
}

export function normalizeCinemaWorkType(rawType) {
  const clean = String(rawType || '').trim().toLowerCase();
  if (clean === 'series' || clean === 'tv' || clean === 'serie' || clean === 'show') {
    return 'series';
  }
  if (clean === 'anime' || clean === 'ova' || clean === 'ona') {
    return 'anime';
  }
  return 'movie';
}

export function normalizeCinemaStatus(rawStatus) {
  const clean = String(rawStatus || '').trim().toLowerCase();
  if (
    clean === 'playing' ||
    clean === 'watching' ||
    clean === 'in-progress' ||
    clean === 'assistindo' ||
    clean === 'lendo' ||
    clean === 'jogando' ||
    clean === 'ouvindo'
  ) {
    return 'playing';
  }
  if (
    clean === 'completed' ||
    clean === 'watched' ||
    clean === 'concluido' ||
    clean === 'concluído' ||
    clean === 'lido' ||
    clean === 'zerado' ||
    clean === 'ouvido'
  ) {
    return 'completed';
  }
  if (clean === 'paused' || clean === 'on_hold' || clean === 'em_pausa' || clean === 'pausado') {
    return 'paused';
  }
  if (
    clean === 'rewatching' ||
    clean === 'reassistindo' ||
    clean === 'relendo' ||
    clean === 'rejogando' ||
    clean === 'reouvindo'
  ) {
    return 'rewatching';
  }
  if (clean === 'dropped' || clean === 'abandonado') return 'dropped';
  return 'queued';
}

export function buildPublicProfileLink(handle = '@espectador') {
  const cleanHandle = String(handle || '@espectador')
    .trim()
    .replace(/^@+/, '');
  const safeHandle = cleanHandle ? `@${cleanHandle}` : '@espectador';
  return {
    label: `${domainConfig.publicHost}/${safeHandle}`,
    url: `https://${domainConfig.publicHost}/${safeHandle}`,
  };
}

export function formatFieldValue(fieldKey, value) {
  const field = domainConfig.fields[fieldKey];
  if (value === undefined || value === null || value === '') return '—';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
  return field?.unit ? `${value}${field.unit}` : String(value);
}
