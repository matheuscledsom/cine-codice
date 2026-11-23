export const OMNIPRISM_DOMAINS = [
  {
    id: 'cinema',
    label: 'Cinema & Séries',
    shortLabel: 'Cinema',
    icon: 'Film',
    tintHex: '#D97706',
    beamHex: '#F59E0B',
    status: 'active',
    badge: 'Ativo · Completo',
    description: 'Filmes, séries, animes e cronologias',
  },
  {
    id: 'reading',
    label: 'Leitura & Acadêmico',
    shortLabel: 'Leitura',
    icon: 'BookOpen',
    tintHex: '#059669',
    beamHex: '#10B981',
    status: 'soon',
    badge: 'Em breve · Núcleo pronto',
    description: 'Livros, mangás, artigos e fichamentos',
  },
  {
    id: 'games',
    label: 'Games',
    shortLabel: 'Games',
    icon: 'Gamepad2',
    tintHex: '#7C3AED',
    beamHex: '#8B5CF6',
    status: 'soon',
    badge: 'Em breve · Núcleo pronto',
    description: 'Campanhas, horas jogadas e plataformas',
  },
  {
    id: 'music',
    label: 'Música',
    shortLabel: 'Música',
    icon: 'Music',
    tintHex: '#BE123C',
    beamHex: '#F43F5E',
    status: 'soon',
    badge: 'Em breve · Núcleo pronto',
    description: 'Álbuns, faixas e discografias',
  },
];

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
      label: 'Em Pausa',
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
      greetingPrefix: 'Sessão de',
      subtitle: 'Catálogo Pessoal · Cinema & Séries',
      signature: 'OmniPrism · Camaleão',
      annualGoalTitle: 'Meta Anual de Sessões',
      continueWatchingTitle: 'Em Cartaz · Continuar Assistindo',
      resumeLabel: 'Retomar Sessão',
      highlightsTitle: 'Cartazes em Destaque',
      highlightsEmptyTitle: 'Seu catálogo começa aqui',
      highlightsEmptyDescription:
        'Marque obras como 5 estrelas ou avance suas sessões para destacar os cartazes na entrada.',
      summaryCards: {
        total: 'Total no Catálogo',
        completedYear: 'Concluídos no Ano',
        playingNow: 'Em Andamento',
      },
      activeSectionTitle: 'Em Exibição Agora',
      emptyActiveMessage: 'Nenhuma sessão ativa no momento.',
      emptyActiveCta: 'Escolher próxima sessão',
      seeAllLabel: 'Ver catálogo',
      emptyBacklogTitle: 'Seu catálogo está vazio',
      emptyBacklogDescription:
        'Catalogue filmes, séries e animes com controle de minutagem, episódios e ordem cronológica.',
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
      drawerWorkTypeLabel: 'Formato Audiovisual',
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
      emptyBacklogTitle: 'Seu catálogo de filmes, séries e animes está vazio',
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
      handle: '@espectador',
      displayName: 'Cinéfilo',
      avatarInitials: 'CC',
      avatarUrl: '',
      coverUrl: '',
      bio: 'Catálogo pessoal e privado — filmes, séries e animes sem ruído.',
      linkLabel: 'omniprism.app/@espectador',
      linkUrl: 'https://omniprism.app/@espectador',
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
      emptyRadar: 'Nenhuma obra na fila Quero Ver.',
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
      workTypeTitle: 'Formato Audiovisual',
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
      wishlistLabel: 'Quero Reassistir / Guardar',
      removeLabel: 'Remover do catálogo',
      closeLabel: 'Fechar',
    },
  },
};

export function getStatusList() {
  return domainConfig.statusOrder.map((id) => domainConfig.statuses[id]);
}

export function getStatusConfig(statusId) {
  return domainConfig.statuses[statusId] ?? domainConfig.statuses.queued;
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
  if (clean === 'playing' || clean === 'watching' || clean === 'assistindo') return 'playing';
  if (clean === 'completed' || clean === 'watched' || clean === 'concluido') return 'completed';
  if (clean === 'paused' || clean === 'on_hold' || clean === 'em_pausa') return 'paused';
  if (clean === 'rewatching' || clean === 'reassistindo') return 'rewatching';
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
