import { getDisplayTitles } from '../utils/backlogHelpers.js';

export function buildCommandPaletteEntries({
  query = '',
  items = [],
  collections = [],
  onNavigateTab,
  onSelectItem,
  onSelectCollection,
  onOpenThemeStudio,
  onOpenRoulette,
  onExportBackup,
  onToggleFocusTheme,
}) {
  const q = String(query || '').trim().toLowerCase();

  const actions = [
    {
      id: 'act-home',
      kind: 'Ação',
      label: 'Ir para Início',
      hint: 'Check-in de sessão e obras em cartaz',
      iconKey: 'home',
      run: () => onNavigateTab?.('home'),
    },
    {
      id: 'act-list',
      kind: 'Ação',
      label: 'Ir para Catálogo',
      hint: 'Estante VHS/Blu-ray, grade de pôsteres e filtros',
      iconKey: 'library',
      run: () => onNavigateTab?.('list'),
    },
    {
      id: 'act-add',
      kind: 'Ação',
      label: 'Catalogar Filme, Série ou Anime',
      hint: 'Busca paralela AniList, MAL, TVmaze, TMDB e IMDb',
      iconKey: 'plus',
      run: () => onNavigateTab?.('add'),
    },
    {
      id: 'act-stats',
      kind: 'Ação',
      label: 'Ir para Métricas',
      hint: 'Mapa de calor anual, horas assistidas e Cine Wrapped',
      iconKey: 'stats',
      run: () => onNavigateTab?.('stats'),
    },
    {
      id: 'act-profile',
      kind: 'Ação',
      label: 'Ir para Meu Perfil',
      hint: 'DNA do espectador, diário e sincronização @handle#XXXX',
      iconKey: 'user',
      run: () => onNavigateTab?.('profile'),
    },
    {
      id: 'act-roulette',
      kind: 'Curadoria',
      label: 'Roleta "O que assistir hoje?"',
      hint: 'Filtrar por 25 min, 50 min ou 2h+',
      iconKey: 'film',
      run: () => onOpenRoulette?.(),
    },
    {
      id: 'act-themes',
      kind: 'Aparência',
      label: 'Abrir Temas & Aparência',
      hint: 'Fontes, densidade e 6 estilos',
      iconKey: 'palette',
      run: () => onOpenThemeStudio?.(),
    },
    {
      id: 'act-focus',
      kind: 'Aparência',
      label: 'Alternar Modo Foco (Baixo Brilho)',
      hint: 'Grafite fosco sem distrações',
      iconKey: 'command',
      run: () => onToggleFocusTheme?.(),
    },
    {
      id: 'act-backup',
      kind: 'Dados',
      label: 'Exportar Cópia de Segurança (.json SHA-256)',
      hint: 'Baixar ou compartilhar backup',
      iconKey: 'download',
      run: () => onExportBackup?.(),
    },
  ];

  const workEntries = (Array.isArray(items) ? items : [])
    .filter((i) => i && i.inBacklog !== false)
    .map((item) => {
      const titles = getDisplayTitles(item, 'bilingual');
      const creator = item.director || item.studio || item.author || '';
      const franchiseLabel = item.franchiseName || item.seriesName || '';
      return {
        id: `work-${item.id}`,
        kind: 'Catálogo',
        label: titles.primary || item.title,
        hint:
          [creator, item.releaseYear, franchiseLabel].filter(Boolean).join(' · ') ||
          'Obra catalogada',
        searchBlob: `${item.title || ''} ${item.originalTitle || ''} ${creator} ${item.imdbId || ''} ${franchiseLabel} ${(item.genres || []).join(' ')}`.toLowerCase(),
        iconKey: 'film',
        run: () => onSelectItem?.(item),
      };
    });

  const collectionEntries = (Array.isArray(collections) ? collections : []).map((col) => ({
    id: `col-${col.id}`,
    kind: 'Coleção',
    label: col.name,
    hint: 'Abrir coleção no Catálogo',
    searchBlob: String(col.name || '').toLowerCase(),
    iconKey: 'folder',
    run: () => {
      onSelectCollection?.(col.id);
      onNavigateTab?.('list');
    },
  }));

  if (!q) {
    return [
      ...actions.slice(0, 6),
      ...collectionEntries.slice(0, 3),
      ...workEntries.slice(0, 4),
    ];
  }

  const matchedActions = actions.filter((a) =>
    `${a.label} ${a.hint} ${a.kind}`.toLowerCase().includes(q)
  );
  const matchedCollections = collectionEntries.filter((c) => c.searchBlob.includes(q));
  const matchedWorks = workEntries.filter((b) => b.searchBlob.includes(q));

  return [
    ...matchedWorks.slice(0, 8),
    ...matchedCollections.slice(0, 4),
    ...matchedActions.slice(0, 6),
  ];
}
