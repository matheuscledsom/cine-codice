import {
  ArrowDown,
  ArrowUp,
  Check,
  CheckSquare,
  Command,
  Dices,
  FolderPlus,
  LayoutGrid,
  LayoutList,
  Library,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Star,
  Trash2,
  User,
  X,
} from 'lucide-react';
import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { CollectionCreatorBar } from '../components/CollectionCreatorBar';
import { CoverArt } from '../components/CoverArt';
import { DomainSwitcherBar } from '../components/DomainSwitcherBar';
import { OfflineBookPickerModal } from '../components/OfflineBookPickerModal';
import { ResponsiveSheet } from '../components/ResponsiveSheet';
import { StatusBadge } from '../components/StatusBadge';
import { WorkCard } from '../components/WorkCard';
import {
  OMNIPRISM_DOMAINS,
  domainConfig,
  getDomainMeta,
  getMediaTypesForDomain,
  getStatusConfig,
  getStatusList,
  getWorkTypeLabel,
  inferDomainFromWork,
  normalizeDomainId,
  normalizeWorkTypeForDomain,
} from '../config/domainConfig';
import { isFlagEnabled } from '../config/flags';
import { useToast } from '../context/ToastContext';
import { SpineRenderer } from '../graphics/SpineRenderer';
import { searchCinemaMedia } from '../services/cinemaApi';
import {
  formatCatalogCardFormatBadge,
  formatFlexibleProgressMetric,
  getDisplayTitles,
  getHypeMeta,
  getWatchedMinutes,
} from '../utils/backlogHelpers';
import {
  buildCollectionMosaicCoverDataUri,
  filterWorksByCollection,
  sortWorksInCollection,
} from '../utils/collections';
import { WORKER_ITEM_THRESHOLD, queryLibraryIndex } from '../workers/searchIndexClient';

const VIEW_MODE_STORAGE_KEY = 'cine_codice_list_view_mode_v1';
const TITLE_MODE_STORAGE_KEY = 'cine_codice_list_title_mode_v1';

const TITLE_MODES = [
  { id: 'bilingual', label: 'Bilíngue' },
  { id: 'pt', label: 'PT-BR' },
  { id: 'original', label: 'Original' },
];

const VIEW_MODES = [
  { id: 'grid', label: 'Grade', icon: LayoutGrid },
  { id: 'detailed', label: 'Lista', icon: LayoutList },
  { id: 'shelf', label: 'Estante', icon: Library },
];

const LIST_WINDOW_BATCH = 60;
export { formatCatalogCardFormatBadge };

function loadSavedTitleMode() {
  try {
    const val = localStorage.getItem(TITLE_MODE_STORAGE_KEY);
    return TITLE_MODES.some((m) => m.id === val) ? val : 'bilingual';
  } catch {
    return 'bilingual';
  }
}

function loadSavedViewMode() {
  try {
    const val = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    if (val === 'shelf' && !isFlagEnabled('spineShelf')) return 'grid';
    return VIEW_MODES.some((m) => m.id === val) ? val : 'grid';
  } catch {
    return 'grid';
  }
}

export function ListScreen({
  items = [],
  profile = null,
  collections = [],
  activeDomain = 'cinema',
  onSelectDomain,
  themeMode = 'dark',
  onCreateCollection,
  onDeleteCollection,
  onMoveCollection,
  onMoveCollectionWork,
  onBatchUpdateItems,
  onBatchRemoveItems,
  onRestoreRemovedItems,
  onStartPickedWork,
  onSelectItem,
  onOpenCommandPalette,
  onNavigateAdd,
  requestedCollectionId = null,
  onConsumeRequestedCollection,
  requestedCreatorQuery = '',
  onConsumeRequestedCreatorQuery,
  tmdbKey = '',
  onAddItem,
}) {
  const { showToast } = useToast();
  const [selectedDomain, setSelectedDomain] = useState(() => normalizeDomainId(activeDomain));
  useEffect(() => {
    setSelectedDomain(normalizeDomainId(activeDomain));
    setSelectedWorkType('all');
  }, [activeDomain]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [batchColTarget, setBatchColTarget] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [selectedWorkType, setSelectedWorkType] = useState('all');
  const [selectedCollectionId, setSelectedCollectionId] = useState('all');
  const [selectedGenre, setSelectedGenre] = useState('all');
  const [selectedFormat, setSelectedFormat] = useState('all');
  const [selectedAudioFormat, setSelectedAudioFormat] = useState('all');
  const [shelfGroupByTheme, setShelfGroupByTheme] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [collectionManagerOpen, setCollectionManagerOpen] = useState(false);
  const [rouletteOpen, setRouletteOpen] = useState(false);
  const [localQuery, setLocalQuery] = useState('');
  const [creatorFilterBanner, setCreatorFilterBanner] = useState('');
  const [moreCreatorState, setMoreCreatorState] = useState({
    open: false,
    query: '',
    loading: false,
    results: [],
    error: '',
    offline: false,
  });
  const deferredQuery = useDeferredValue(localQuery);
  const [titleMode, setTitleMode] = useState(loadSavedTitleMode);
  const [sortBy, setSortBy] = useState('recent');
  const [layoutMode, setLayoutMode] = useState(loadSavedViewMode);
  const [visibleLimit, setVisibleLimit] = useState(LIST_WINDOW_BATCH);
  const [workerResult, setWorkerResult] = useState(null);
  const loadMoreRef = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem(TITLE_MODE_STORAGE_KEY, titleMode);
    } catch {
      // Ignora erro de storage
    }
  }, [titleMode]);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, layoutMode);
    } catch {
      // Ignora erro de storage
    }
  }, [layoutMode]);

  const { ui, cardFields } = domainConfig;
  const { list } = ui;
  const statuses = getStatusList();

  const backlogItems = useMemo(
    () => items.filter((item) => item && item.inBacklog !== false),
    [items]
  );

  const domainScopedItems = useMemo(() => {
    if (selectedDomain === 'all') return backlogItems;
    return backlogItems.filter((item) => inferDomainFromWork(item) === selectedDomain);
  }, [backlogItems, selectedDomain]);

  useEffect(() => {
    if (
      selectedCollectionId !== 'all' &&
      !collections.some((c) => c.id === selectedCollectionId)
    ) {
      setSelectedCollectionId('all');
    }
  }, [collections, selectedCollectionId]);

  useEffect(() => {
    if (!requestedCollectionId) return;
    if (collections.some((c) => c.id === requestedCollectionId)) {
      setSelectedCollectionId(requestedCollectionId);
    }
    onConsumeRequestedCollection?.();
  }, [requestedCollectionId, collections, onConsumeRequestedCollection]);

  useEffect(() => {
    const cleanCreator = String(requestedCreatorQuery || '').trim();
    if (!cleanCreator) return;
    setLocalQuery(cleanCreator);
    setCreatorFilterBanner(cleanCreator);
    setMoreCreatorState({
      open: false,
      query: cleanCreator,
      loading: false,
      results: [],
      error: '',
      offline: false,
    });
    onConsumeRequestedCreatorQuery?.();
  }, [requestedCreatorQuery, onConsumeRequestedCreatorQuery]);

  const availableGenres = useMemo(() => {
    const map = new Map();
    domainScopedItems.forEach((item) => {
      if (Array.isArray(item.genres)) {
        item.genres.forEach((g) => {
          const clean = String(g || '').trim();
          if (clean) map.set(clean, (map.get(clean) || 0) + 1);
        });
      }
    });
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'))
      .slice(0, 16)
      .map(([name, count]) => ({ name, count }));
  }, [domainScopedItems]);

  const availableFormats = useMemo(() => {
    const map = new Map();
    domainScopedItems.forEach((item) => {
      const fmt = String(item.format || '').trim();
      if (fmt) map.set(fmt, (map.get(fmt) || 0) + 1);
    });
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [domainScopedItems]);

  const availableAudioTags = useMemo(() => {
    const map = new Map();
    domainScopedItems.forEach((item) => {
      const tag = String(item.audioFormat || '').trim();
      if (tag) map.set(tag, (map.get(tag) || 0) + 1);
    });
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [domainScopedItems]);

  const syncFilteredItems = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const filtered = domainScopedItems.filter((item) => {
      if (selectedStatus !== 'all' && item.status !== selectedStatus) return false;
      if (selectedWorkType !== 'all') {
        if (selectedWorkType.startsWith('domain:')) {
          const domFilter = selectedWorkType.slice('domain:'.length);
          if (inferDomainFromWork(item) !== domFilter) return false;
        } else if (selectedDomain === 'all') {
          if ((item.workType || 'movie') !== selectedWorkType) return false;
        } else if (
          normalizeWorkTypeForDomain(item.workType, selectedDomain) !== selectedWorkType
        ) {
          return false;
        }
      }
      if (selectedCollectionId !== 'all') {
        const cols = Array.isArray(item.collectionIds) ? item.collectionIds.map(String) : [];
        if (!cols.includes(String(selectedCollectionId))) return false;
      }
      if (selectedGenre !== 'all') {
        const genres = Array.isArray(item.genres) ? item.genres : [];
        if (!genres.some((g) => String(g || '').trim() === selectedGenre)) return false;
      }
      if (selectedFormat !== 'all' && String(item.format || '').trim() !== selectedFormat) {
        return false;
      }
      if (
        selectedAudioFormat !== 'all' &&
        String(item.audioFormat || '').trim() !== selectedAudioFormat
      ) {
        return false;
      }
      if (!q) return true;

      const inTitle = String(item.title || '').toLowerCase().includes(q);
      const inOrig = String(item.originalTitle || '').toLowerCase().includes(q);
      const inCreator = [item.creator, item.director, item.studio, item.author]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q);
      const inDomainMeta = [
        item.platform,
        item.storeOrLauncher,
        item.buildOrCharacter,
        item.subgenre,
        item.favoriteTrack,
        item.isbnOrDoi,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q);
      const inFranchise = String(item.franchiseName || item.seriesName || '')
        .toLowerCase()
        .includes(q);
      const inImdb = String(item.imdbId || '').toLowerCase().includes(q);
      const inGenres = Array.isArray(item.genres)
        ? item.genres.some((g) => String(g).toLowerCase().includes(q))
        : false;
      const inTags = Array.isArray(item.tags)
        ? item.tags.some((t) => String(t).toLowerCase().includes(q))
        : false;
      return (
        inTitle ||
        inOrig ||
        inCreator ||
        inDomainMeta ||
        inFranchise ||
        inImdb ||
        inGenres ||
        inTags
      );
    });

    return [...filtered].sort((a, b) => {
      if (sortBy === 'rating') {
        const rA = typeof a[cardFields.rating] === 'number' ? a[cardFields.rating] : -1;
        const rB = typeof b[cardFields.rating] === 'number' ? b[cardFields.rating] : -1;
        return rB - rA;
      }
      if (sortBy === 'hype') {
        return (getHypeMeta(b.hype)?.weight ?? 0) - (getHypeMeta(a.hype)?.weight ?? 0);
      }
      if (sortBy === 'duration' || sortBy === 'runtime') {
        const dA =
          Number(a.durationMinutes) ||
          getWatchedMinutes(a) ||
          (Number(a.totalEpisodes) || 0) * 24 ||
          (Number(a.hoursPlayed) || 0) * 60 ||
          Number(a.totalPages) ||
          0;
        const dB =
          Number(b.durationMinutes) ||
          getWatchedMinutes(b) ||
          (Number(b.totalEpisodes) || 0) * 24 ||
          (Number(b.hoursPlayed) || 0) * 60 ||
          Number(b.totalPages) ||
          0;
        return dB - dA;
      }
      if (sortBy === 'title') {
        return String(a.title || '').localeCompare(String(b.title || ''), 'pt-BR');
      }
      const timeA = Date.parse(a.updatedAt || a.createdAt || '') || 0;
      const timeB = Date.parse(b.updatedAt || b.createdAt || '') || 0;
      return timeB - timeA;
    });
  }, [
    domainScopedItems,
    selectedDomain,
    selectedStatus,
    selectedWorkType,
    selectedCollectionId,
    selectedGenre,
    selectedFormat,
    selectedAudioFormat,
    deferredQuery,
    sortBy,
    cardFields.rating,
  ]);

  useEffect(() => {
    if (
      domainScopedItems.length <= WORKER_ITEM_THRESHOLD ||
      selectedWorkType.startsWith('domain:') ||
      selectedDomain !== 'cinema'
    ) {
      setWorkerResult(null);
      return undefined;
    }
    let active = true;
    queryLibraryIndex(domainScopedItems, {
      selectedStatus,
      selectedWorkType,
      selectedCollectionId,
      selectedGenre,
      selectedFormat,
      selectedAudioFormat,
      query: deferredQuery,
      sortBy: sortBy === 'duration' ? 'runtime' : sortBy,
      creatorField: cardFields.creator,
      ratingField: cardFields.rating,
    }).then((result) => {
      if (active && Array.isArray(result)) {
        startTransition(() => {
          setWorkerResult(result);
        });
      }
    });
    return () => {
      active = false;
    };
  }, [
    domainScopedItems,
    selectedDomain,
    selectedStatus,
    selectedWorkType,
    selectedCollectionId,
    selectedGenre,
    selectedFormat,
    selectedAudioFormat,
    deferredQuery,
    sortBy,
    cardFields.creator,
    cardFields.rating,
  ]);

  const filteredAndSortedItems =
    domainScopedItems.length > WORKER_ITEM_THRESHOLD && Array.isArray(workerResult)
      ? workerResult
      : syncFilteredItems;

  useEffect(() => {
    setVisibleLimit(LIST_WINDOW_BATCH);
  }, [
    selectedDomain,
    selectedStatus,
    selectedWorkType,
    selectedCollectionId,
    selectedGenre,
    selectedFormat,
    selectedAudioFormat,
    deferredQuery,
    sortBy,
    layoutMode,
  ]);

  const visibleItems = useMemo(
    () =>
      filteredAndSortedItems.length > visibleLimit
        ? filteredAndSortedItems.slice(0, visibleLimit)
        : filteredAndSortedItems,
    [filteredAndSortedItems, visibleLimit]
  );

  const hasMoreVisible = visibleItems.length < filteredAndSortedItems.length;

  useEffect(() => {
    setSelectedIds((prev) =>
      prev.filter((id) => backlogItems.some((item) => String(item.id) === String(id)))
    );
  }, [backlogItems]);

  useEffect(() => {
    if (!hasMoreVisible || !loadMoreRef.current || typeof IntersectionObserver === 'undefined') {
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          startTransition(() => {
            setVisibleLimit((prev) => prev + LIST_WINDOW_BATCH);
          });
        }
      },
      { rootMargin: '220px' }
    );
    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [hasMoreVisible]);

  const toggleSelectedId = (workId) => {
    const targetId = String(workId || '');
    if (!targetId) return;
    setSelectedIds((prev) =>
      prev.includes(targetId)
        ? prev.filter((id) => id !== targetId)
        : [...prev, targetId]
    );
  };

  const handleWorkCardClick = (item) => {
    if (!item) return;
    if (selectionMode) {
      toggleSelectedId(item.id);
      return;
    }
    onSelectItem(item);
  };

  const handleLongPressWork = (item) => {
    if (!item) return;
    if (!selectionMode) {
      setSelectionMode(true);
      setSelectedIds([String(item.id)]);
    } else {
      toggleSelectedId(item.id);
    }
  };

  const toggleSelectAllVisible = () => {
    const visibleIdSet = visibleItems.map((i) => String(i.id));
    const allSelected =
      visibleIdSet.length > 0 && visibleIdSet.every((id) => selectedIds.includes(id));
    setSelectedIds(allSelected ? [] : visibleIdSet);
  };

  const clearSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds([]);
    setBatchColTarget('');
  };

  const handleBatchStatusChange = (nextStatus) => {
    if (!nextStatus || selectedIds.length === 0 || !onBatchUpdateItems) return;
    onBatchUpdateItems(selectedIds, { status: nextStatus });
    const statusLabel = getStatusConfig(nextStatus)?.label || nextStatus;
    showToast({
      message: `${selectedIds.length} obra(s) movida(s) para ${statusLabel}.`,
      type: 'success',
    });
    clearSelectionMode();
  };

  const handleBatchAssignCollection = (collectionId) => {
    if (!collectionId || selectedIds.length === 0 || !onBatchUpdateItems) return;
    onBatchUpdateItems(selectedIds, { addCollectionId: collectionId });
    const colName = collections.find((c) => c.id === collectionId)?.name || 'Coleção';
    showToast({
      message: `${selectedIds.length} obra(s) adicionada(s) a "${colName}".`,
      type: 'success',
    });
    setBatchColTarget('');
    clearSelectionMode();
  };

  const handleBatchDelete = () => {
    if (selectedIds.length === 0 || !onBatchRemoveItems) return;
    const snap = onBatchRemoveItems(selectedIds);
    const removedCount = snap?.removedItems?.length || selectedIds.length;
    clearSelectionMode();
    showToast({
      message: `${removedCount} obra(s) removida(s) do catálogo.`,
      type: 'info',
      duration: 8000,
      action:
        onRestoreRemovedItems && snap?.removedItems?.length > 0
          ? {
              label: 'Desfazer',
              onClick: () => {
                onRestoreRemovedItems(snap);
                showToast({
                  message: `${snap.removedItems.length} obra(s) restaurada(s).`,
                  type: 'success',
                });
              },
            }
          : undefined,
    });
  };

  const activeCustomCollection = useMemo(
    () =>
      selectedCollectionId !== 'all'
        ? collections.find((c) => c.id === selectedCollectionId) || null
        : null,
    [collections, selectedCollectionId]
  );

  const activeCollectionWorks = useMemo(
    () =>
      activeCustomCollection
        ? sortWorksInCollection(
            filterWorksByCollection(backlogItems, activeCustomCollection.id),
            activeCustomCollection
          )
        : [],
    [activeCustomCollection, backlogItems]
  );

  const visibleViewModes = useMemo(() => {
    const spineEnabled = isFlagEnabled('spineShelf');
    return VIEW_MODES.filter((m) => m.id !== 'shelf' || spineEnabled);
  }, []);

  const extraFilterCount = useMemo(() => {
    let count = 0;
    if (selectedWorkType !== 'all') count += 1;
    if (selectedCollectionId !== 'all') count += 1;
    if (selectedGenre !== 'all') count += 1;
    if (selectedFormat !== 'all') count += 1;
    if (selectedAudioFormat !== 'all') count += 1;
    return count;
  }, [
    selectedWorkType,
    selectedCollectionId,
    selectedGenre,
    selectedFormat,
    selectedAudioFormat,
  ]);

  const filterTabs = [
    { id: 'all', label: list.allTabLabel, count: domainScopedItems.length },
    ...statuses.map((status) => ({
      id: status.id,
      label: status.label,
      count: domainScopedItems.filter((item) => item.status === status.id).length,
    })),
  ];

  const formatQuickTabs = useMemo(() => {
    if (selectedDomain === 'all') {
      return [
        { id: 'all', label: 'Todos', count: domainScopedItems.length },
        ...OMNIPRISM_DOMAINS.map((dom) => ({
          id: `domain:${dom.id}`,
          label: dom.shortLabel,
          count: domainScopedItems.filter((it) => inferDomainFromWork(it) === dom.id).length,
        })),
      ];
    }
    const domainTypes = getMediaTypesForDomain(selectedDomain);
    return [
      { id: 'all', label: 'Todos', count: domainScopedItems.length },
      ...domainTypes.map((wt) => ({
        id: wt.id,
        label: wt.pluralLabel || wt.label,
        count: domainScopedItems.filter(
          (it) => normalizeWorkTypeForDomain(it.workType, selectedDomain) === wt.id
        ).length,
      })),
    ];
  }, [domainScopedItems, selectedDomain]);

  const handleDomainSelect = (nextDomain) => {
    setSelectedWorkType('all');
    if (nextDomain === 'all') {
      setSelectedDomain('all');
      return;
    }
    const clean = normalizeDomainId(nextDomain);
    setSelectedDomain(clean);
    onSelectDomain?.(clean);
  };

  const clearAllFilters = () => {
    setSelectedStatus('all');
    setSelectedWorkType('all');
    setSelectedCollectionId('all');
    setSelectedGenre('all');
    setSelectedFormat('all');
    setSelectedAudioFormat('all');
    setLocalQuery('');
    setCreatorFilterBanner('');
    setMoreCreatorState({
      open: false,
      query: '',
      loading: false,
      results: [],
      error: '',
      offline: false,
    });
    setSortBy('recent');
  };

  const handleSearchMoreByCreator = async (targetQuery = creatorFilterBanner || localQuery) => {
    const cleanQuery = String(targetQuery || '').trim();
    if (!cleanQuery) return;
    const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
    setMoreCreatorState({
      open: true,
      query: cleanQuery,
      loading: true,
      results: [],
      error: '',
      offline: isOffline,
    });

    try {
      const response = await searchCinemaMedia(cleanQuery, {
        tmdbApiKey: tmdbKey,
      });

      const existingIds = new Set();
      const existingTitles = new Set();
      backlogItems.forEach((work) => {
        if (work.tmdbId) existingIds.add(`tmdb:${work.tmdbId}`);
        if (work.imdbId) existingIds.add(`imdb:${work.imdbId}`);
        if (work.anilistId) existingIds.add(`ani:${work.anilistId}`);
        if (work.malId) existingIds.add(`mal:${work.malId}`);
        if (work.tvmazeId) existingIds.add(`tvmaze:${work.tvmazeId}`);
        const normTitle = String(work.title || '').trim().toLowerCase();
        if (normTitle) existingTitles.add(normTitle);
      });

      const fresh = (Array.isArray(response?.results) ? response.results : [])
        .filter((cand) => {
          if (!cand) return false;
          if (cand.tmdbId && existingIds.has(`tmdb:${cand.tmdbId}`)) return false;
          if (cand.imdbId && existingIds.has(`imdb:${cand.imdbId}`)) return false;
          if (cand.anilistId && existingIds.has(`ani:${cand.anilistId}`)) return false;
          if (cand.malId && existingIds.has(`mal:${cand.malId}`)) return false;
          if (cand.tvmazeId && existingIds.has(`tvmaze:${cand.tvmazeId}`)) return false;
          const candTitle = String(cand.title || '').trim().toLowerCase();
          if (candTitle && existingTitles.has(candTitle)) return false;
          return true;
        })
        .slice(0, 6);

      setMoreCreatorState({
        open: true,
        query: cleanQuery,
        loading: false,
        results: fresh,
        error: response?.allFailed
          ? isOffline
            ? 'Sem conexão com a internet para buscar novos títulos.'
            : 'Nenhuma fonte externa respondeu no momento.'
          : '',
        partialWarning: Boolean(response?.partialFailure),
        offline: isOffline,
      });
    } catch {
      setMoreCreatorState({
        open: true,
        query: cleanQuery,
        loading: false,
        results: [],
        error: isOffline
          ? 'Sem conexão no momento. Tente novamente quando voltar a ficar online.'
          : 'Não foi possível buscar outros títulos agora.',
        partialWarning: false,
        offline: isOffline,
      });
    }
  };

  return (
    <div className="space-y-3.5 pb-24">
      {/* Elemento 1: Cabeçalho compacto da Estante Direta */}
      <header className="flex items-center justify-between gap-2 pt-2">
        <div className="flex items-baseline gap-2 min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-ink">
            {list.title}
          </h1>
          <span className="text-xs font-medium tabular-nums text-subtle">
            {filteredAndSortedItems.length}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {onOpenCommandPalette && (
            <button
              type="button"
              onClick={onOpenCommandPalette}
              aria-label="Abrir paleta de comandos (Ctrl+K)"
              title="Buscar global (Ctrl+K)"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[4px] border border-line bg-card text-muted transition-colors hover:border-accent hover:text-ink"
            >
              <Command className="h-4 w-4" strokeWidth={1.5} />
            </button>
          )}
          <button
            type="button"
            onClick={() => setRouletteOpen(true)}
            aria-label="Roleta O que assistir hoje"
            title="O que assistir hoje?"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[4px] border border-line bg-card text-accent transition-colors hover:border-accent"
          >
            <Dices className="h-4 w-4" strokeWidth={1.5} />
          </button>
          <button
            type="button"
            onClick={() => setCollectionManagerOpen(true)}
            aria-label="Gerenciar coleções personalizadas"
            title="Coleções"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[4px] border border-line bg-card text-muted transition-colors hover:border-accent hover:text-ink"
          >
            <FolderPlus className="h-4 w-4" strokeWidth={1.5} />
          </button>
          <button
            type="button"
            onClick={() => {
              if (selectionMode) clearSelectionMode();
              else setSelectionMode(true);
            }}
            aria-pressed={selectionMode}
            aria-label={selectionMode ? 'Sair da seleção em lote' : 'Seleção em lote'}
            className={`flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[4px] border transition-colors ${
              selectionMode
                ? 'border-accent bg-accent text-accent-ink'
                : 'border-line bg-card text-muted hover:border-accent hover:text-ink'
            }`}
          >
            <CheckSquare className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>
      </header>

      <DomainSwitcherBar
        compact
        includeAll
        activeDomain={selectedDomain}
        onSelectDomain={handleDomainSelect}
        items={backlogItems}
        themeMode={themeMode}
      />

      {/* Elemento 2: Busca + Botão de Filtros + Seletor Grade/Lista/Estante */}
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle"
            strokeWidth={1.5}
          />
          <input
            type="search"
            value={localQuery}
            onChange={(e) => setLocalQuery(e.target.value)}
            placeholder="Buscar filme, diretor, anime, saga..."
            aria-label="Buscar obras no catálogo"
            className="min-h-[44px] w-full rounded-[4px] border border-line bg-card py-1.5 pl-8 pr-8 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
          />
          {localQuery && (
            <button
              type="button"
              onClick={() => setLocalQuery('')}
              aria-label="Limpar busca"
              className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center text-subtle hover:text-ink"
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setFiltersOpen(true)}
          aria-expanded={filtersOpen}
          aria-label="Abrir filtros avançados e ordenação"
          className={`relative inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-[4px] border px-3 py-1.5 text-xs font-medium transition-colors ${
            extraFilterCount > 0
              ? 'border-accent bg-accent/15 text-ink'
              : 'border-line bg-card text-muted hover:text-ink'
          }`}
        >
          <SlidersHorizontal className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
          <span className="hidden sm:inline">Filtros</span>
          {extraFilterCount > 0 && (
            <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold tabular-nums text-accent-ink">
              {extraFilterCount}
            </span>
          )}
        </button>

        <div
          role="group"
          aria-label="Modo de visualização"
          className="flex shrink-0 items-center rounded-[4px] border border-line bg-card p-0.5"
        >
          {visibleViewModes.map((mode) => {
            const Icon = mode.icon;
            const isActive = layoutMode === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                onClick={() => setLayoutMode(mode.id)}
                aria-label={mode.label}
                aria-pressed={isActive}
                title={mode.label}
                className={`flex min-h-[40px] min-w-[40px] items-center justify-center rounded-[3px] transition-colors ${
                  isActive
                    ? 'bg-accent text-accent-ink'
                    : 'text-subtle hover:text-ink'
                }`}
              >
                <Icon className="h-4 w-4" strokeWidth={1.5} />
              </button>
            );
          })}
        </div>
      </div>

      {/* Filtros rápidos de formato no topo do Catálogo com contadores (Todos, Filmes, Séries, Animes) */}
      <div
        className="flex gap-1.5 overflow-x-auto pb-0.5 no-scrollbar"
        role="group"
        aria-label="Filtrar catálogo por formato"
      >
        {formatQuickTabs.map((ft) => {
          const active = selectedWorkType === ft.id;
          return (
            <button
              key={ft.id}
              type="button"
              aria-pressed={active}
              onClick={() => setSelectedWorkType(ft.id)}
              className={`inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-[4px] border px-3 py-1 text-xs font-semibold tabular-nums transition-colors ${
                active
                  ? 'border-accent bg-accent/15 text-accent'
                  : 'border-line bg-card text-muted hover:text-ink'
              }`}
            >
              <span>{ft.label}</span>
              <span className="text-[10px] opacity-80">({ft.count})</span>
            </button>
          );
        })}
      </div>

      {/* Elemento 3: Fita única de Status */}
      <div className="flex gap-1.5 overflow-x-auto pb-0.5 no-scrollbar" role="tablist" aria-label="Filtrar por status">
        {filterTabs.map((tab) => {
          const active = selectedStatus === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSelectedStatus(tab.id)}
              className={`inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-[4px] border px-3 py-1.5 text-xs font-medium tabular-nums transition-colors ${
                active
                  ? 'border-accent bg-accent text-accent-ink'
                  : 'border-line bg-card text-muted hover:text-ink'
              }`}
            >
              <span>{tab.label}</span>
              <span className={`text-[10px] ${active ? 'opacity-90' : 'text-subtle'}`}>
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Filtro ativo por Diretor/Estúdio + Descoberta limitada a 6 */}
      {creatorFilterBanner && (
        <section
          aria-label="Filtro por diretor ou estúdio"
          className="rounded-[6px] border border-accent/40 bg-card p-3 space-y-2.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <User className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-ink">
                  Direção/Estúdio: {creatorFilterBanner}
                </p>
                <p className="text-[11px] tabular-nums text-subtle">
                  {filteredAndSortedItems.length} título(s) encontrado(s) no catálogo local
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleSearchMoreByCreator(creatorFilterBanner)}
                disabled={moreCreatorState.loading}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[4px] border border-accent bg-accent px-3 text-xs font-semibold text-accent-ink disabled:opacity-60"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${moreCreatorState.loading ? 'animate-spin' : ''}`}
                  strokeWidth={1.5}
                />
                <span>Buscar mais títulos</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreatorFilterBanner('');
                  setLocalQuery('');
                  setMoreCreatorState({
                    open: false,
                    query: '',
                    loading: false,
                    results: [],
                    error: '',
                    offline: false,
                  });
                }}
                className="inline-flex min-h-[44px] items-center gap-1 rounded-[4px] border border-line bg-app px-3 text-xs font-medium text-muted hover:text-ink"
              >
                <X className="h-3.5 w-3.5" strokeWidth={1.5} />
                <span>Limpar</span>
              </button>
            </div>
          </div>

          {moreCreatorState.open && (
            <div className="space-y-2 border-t border-line pt-2.5">
              {moreCreatorState.loading ? (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" aria-busy="true">
                  {[0, 1].map((idx) => (
                    <div
                      key={idx}
                      className="h-16 animate-pulse rounded-[4px] border border-line bg-app"
                    />
                  ))}
                </div>
              ) : moreCreatorState.error && moreCreatorState.results.length === 0 ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-line bg-app px-3 py-2.5 text-xs text-muted">
                  <span>{moreCreatorState.error}</span>
                  <button
                    type="button"
                    onClick={() => handleSearchMoreByCreator(creatorFilterBanner)}
                    className="inline-flex min-h-[44px] items-center gap-1 rounded-[4px] border border-line bg-card px-3 text-xs font-semibold text-ink hover:border-accent"
                  >
                    <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} />
                    <span>Tentar novamente</span>
                  </button>
                </div>
              ) : moreCreatorState.results.length === 0 ? (
                <p className="rounded-[4px] border border-line bg-app px-3 py-2 text-xs text-muted">
                  Nenhum outro título novo encontrado para {creatorFilterBanner} além do que já está no seu catálogo.
                </p>
              ) : (
                <>
                  {moreCreatorState.partialWarning && (
                    <p className="text-[11px] text-subtle">
                      Algumas fontes externas não responderam; exibindo os títulos disponíveis (máximo de 6).
                    </p>
                  )}
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {moreCreatorState.results.slice(0, 6).map((cand, idx) => {
                      const alreadyInLibrary = backlogItems.some(
                        (work) =>
                          (cand.tmdbId && work.tmdbId === cand.tmdbId) ||
                          (cand.imdbId && work.imdbId === cand.imdbId) ||
                          (cand.anilistId && work.anilistId === cand.anilistId) ||
                          (cand.malId && work.malId === cand.malId) ||
                          (cand.tvmazeId && work.tvmazeId === cand.tvmazeId) ||
                          (cand.title &&
                            String(work.title || '').trim().toLowerCase() ===
                              String(cand.title || '').trim().toLowerCase())
                      );
                      return (
                        <div
                          key={`${cand.id || cand.tmdbId || cand.anilistId || cand.title}-${idx}`}
                          className="flex items-center justify-between gap-2 rounded-[4px] border border-line bg-app p-2.5"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-semibold text-ink">
                              {cand.title}
                            </p>
                            <p className="truncate text-[11px] tabular-nums text-subtle">
                              {[cand.releaseYear, cand.director || cand.studio, cand.workType]
                                .filter(Boolean)
                                .join(' · ')}
                            </p>
                          </div>
                          {alreadyInLibrary ? (
                            <span className="inline-flex min-h-[44px] items-center rounded-[4px] border border-line bg-card px-2.5 text-[11px] font-medium text-muted">
                              No catálogo
                            </span>
                          ) : (
                            onAddItem && (
                              <button
                                type="button"
                                onClick={() =>
                                  onAddItem({
                                    ...cand,
                                    status: 'wishlist',
                                    inBacklog: true,
                                  })
                                }
                                className="inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-[4px] border border-accent bg-accent/15 px-3 text-[11px] font-semibold text-accent hover:bg-accent hover:text-accent-ink"
                              >
                                <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                                <span>+ Catalogar</span>
                              </button>
                            )
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </section>
      )}

      {/* Barra contextual de Seleção em Lote */}
      {selectionMode && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[6px] border border-accent/50 bg-accent/10 p-2.5">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-semibold tabular-nums text-ink">
              {selectedIds.length} selecionada(s)
            </span>
            <button
              type="button"
              onClick={toggleSelectAllVisible}
              className="min-h-[34px] rounded-[4px] border border-line bg-card px-2 text-[11px] font-medium text-ink hover:border-accent"
            >
              Marcar visíveis
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <select
              aria-label="Mover seleção para status"
              value=""
              disabled={selectedIds.length === 0}
              onChange={(e) => {
                if (e.target.value) handleBatchStatusChange(e.target.value);
              }}
              className="min-h-[36px] rounded-[4px] border border-line bg-card px-2 text-[11px] text-ink disabled:opacity-45"
            >
              <option value="">Status...</option>
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>

            {collections.length > 0 && (
              <select
                aria-label="Adicionar seleção a uma coleção"
                value={batchColTarget}
                disabled={selectedIds.length === 0}
                onChange={(e) => {
                  if (e.target.value) handleBatchAssignCollection(e.target.value);
                }}
                className="min-h-[36px] rounded-[4px] border border-line bg-card px-2 text-[11px] text-ink disabled:opacity-45"
              >
                <option value="">Coleção...</option>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}

            <button
              type="button"
              disabled={selectedIds.length === 0}
              onClick={handleBatchDelete}
              className="inline-flex min-h-[36px] items-center gap-1 rounded-[4px] border border-rose-500/40 bg-rose-500/15 px-2.5 text-[11px] font-semibold text-rose-400 disabled:opacity-45"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
              Excluir
            </button>

            <button
              type="button"
              onClick={clearSelectionMode}
              className="min-h-[36px] rounded-[4px] border border-line bg-card px-2.5 text-[11px] text-muted hover:text-ink"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Conteúdo Principal */}
      {domainScopedItems.length === 0 ? (
        <div className="rounded-[6px] border border-line bg-card px-6 py-10 text-center">
          <p className="text-sm font-semibold text-ink">
            {selectedDomain === 'all'
              ? list.emptyBacklogTitle
              : `Nenhuma obra em ${getDomainMeta(selectedDomain).label}`}
          </p>
          <p className="mt-1 text-xs text-muted">
            {selectedDomain === 'all'
              ? 'Comece catalogando obras em qualquer um dos 4 mundos no botão Catalogar.'
              : `Comece catalogando obras de ${getDomainMeta(selectedDomain).label} no botão Catalogar.`}
          </p>
          {onNavigateAdd && (
            <button
              type="button"
              onClick={onNavigateAdd}
              className="mt-4 inline-flex min-h-[44px] items-center gap-1.5 rounded-[4px] bg-accent px-4 py-2 text-xs font-semibold text-accent-ink"
            >
              <Plus className="h-4 w-4" strokeWidth={1.5} />
              {list.emptyBacklogCta}
            </button>
          )}
        </div>
      ) : filteredAndSortedItems.length === 0 ? (
        <div className="rounded-[6px] border border-dashed border-line bg-card px-6 py-8 text-center space-y-2.5">
          <p className="text-xs font-medium text-ink">{list.emptyMessage}</p>
          <button
            type="button"
            onClick={clearAllFilters}
            className="min-h-[40px] rounded-[4px] border border-accent bg-accent/10 px-3.5 text-xs font-semibold text-accent hover:bg-accent hover:text-accent-ink"
          >
            Limpar filtros
          </button>
        </div>
      ) : layoutMode === 'shelf' ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 px-0.5">
            <span className="text-[11px] text-subtle">
              Lombadas VHS/Blu-ray pela cor dominante do pôster
            </span>
            <button
              type="button"
              onClick={() => setShelfGroupByTheme((v) => !v)}
              className="min-h-[36px] rounded-[4px] border border-line bg-card px-2.5 text-[11px] font-medium text-ink hover:border-accent"
            >
              {shelfGroupByTheme ? 'Agrupar: Por Gênero' : 'Agrupar: Contínuo'}
            </button>
          </div>
          <SpineRenderer
            items={visibleItems}
            titleMode={titleMode}
            groupByTheme={shelfGroupByTheme}
            selectionMode={selectionMode}
            selectedIds={selectedIds}
            onSelectItem={handleWorkCardClick}
            onLongPressItem={handleLongPressWork}
          />
        </div>
      ) : layoutMode === 'detailed' ? (
        <div className="divide-y divide-line rounded-[6px] border border-line bg-card">
          {visibleItems.map((item) => {
            const titles = getDisplayTitles(item, titleMode);
            const itemDomain = inferDomainFromWork(item);
            const formatBadge = formatCatalogCardFormatBadge(item);
            const workLabel = getWorkTypeLabel(item, itemDomain);
            const isSelected = selectedIds.includes(String(item.id));
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleWorkCardClick(item)}
                className={`flex min-h-[76px] w-full items-center gap-3 p-3 text-left transition-colors hover:bg-app ${
                  isSelected ? 'bg-accent/10' : ''
                }`}
              >
                {selectionMode && (
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border ${
                      isSelected
                        ? 'border-accent bg-accent text-accent-ink'
                        : 'border-line bg-app'
                    }`}
                  >
                    {isSelected && <Check className="h-3.5 w-3.5" strokeWidth={2} />}
                  </span>
                )}
                <CoverArt item={item} compact className="h-16 w-11 shrink-0 rounded-[3px]" />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-ink">
                        {titles.primary}
                      </p>
                      {titles.secondary && (
                        <p className="truncate text-[10px] italic text-subtle">
                          {titles.secondary}
                        </p>
                      )}
                    </div>
                    {typeof item.rating === 'number' && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-[3px] border border-line bg-app px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-accent">
                        <Star className="h-3 w-3 fill-current" strokeWidth={1.5} />
                        {item.rating}
                      </span>
                    )}
                  </div>

                  <p className="truncate text-[11px] text-muted">
                    {[
                      formatBadge?.label || workLabel,
                      item.creator || item.director || item.studio || item.author,
                      item.releaseYear,
                      itemDomain === 'games'
                        ? item.completionType || item.storeOrLauncher
                        : itemDomain === 'reading'
                          ? item.bookFormat
                          : itemDomain === 'music'
                            ? item.subgenre || item.releaseFormat
                            : item.audioFormat,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>

                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge statusId={item.status} size="xs" />
                    <span className="text-[10px] font-medium tabular-nums text-muted">
                      {formatFlexibleProgressMetric(item)}
                    </span>
                    {Number(item.rewatchCount) > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] tabular-nums text-accent">
                        <RotateCcw className="h-2.5 w-2.5" strokeWidth={1.5} />
                        #{item.rewatchCount}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-5">
          {visibleItems.map((item, idx) => (
            <WorkCard
              key={item.id}
              item={item}
              titleMode={titleMode}
              priority={idx < 6}
              selectionMode={selectionMode}
              selected={selectedIds.includes(String(item.id))}
              onSelectItem={handleWorkCardClick}
              onLongPressItem={handleLongPressWork}
            />
          ))}
        </div>
      )}

      {hasMoreVisible && (
        <div ref={loadMoreRef} className="pt-2 text-center">
          <button
            type="button"
            onClick={() => setVisibleLimit((prev) => prev + LIST_WINDOW_BATCH)}
            className="min-h-[44px] rounded-[4px] border border-line bg-card px-4 text-xs font-medium text-ink hover:border-accent"
          >
            Carregar mais ({filteredAndSortedItems.length - visibleItems.length} restantes)
          </button>
        </div>
      )}

      {/* Drawer de Filtros Avançados & Ordenação */}
      <ResponsiveSheet
        isOpen={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filtros & Ordenação"
      >
        <div className="space-y-4 p-1">
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted">
              Tipo {selectedDomain !== 'all' ? `· ${getDomainMeta(selectedDomain).shortLabel}` : '· Todos'}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {formatQuickTabs.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSelectedWorkType(opt.id)}
                  className={`min-h-[40px] rounded-[4px] border px-3 text-xs font-medium ${
                    selectedWorkType === opt.id
                      ? 'border-accent bg-accent/15 text-ink'
                      : 'border-line bg-app text-muted hover:text-ink'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium text-muted">Ordenação</p>
            <div className="flex flex-wrap gap-1.5">
              {list.sortOptions.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSortBy(opt.id)}
                  className={`min-h-[40px] rounded-[4px] border px-3 text-xs font-medium ${
                    sortBy === opt.id
                      ? 'border-accent bg-accent/15 text-ink'
                      : 'border-line bg-app text-muted hover:text-ink'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {collections.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted">Coleção</p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setSelectedCollectionId('all')}
                  className={`min-h-[38px] rounded-[4px] border px-2.5 text-xs font-medium ${
                    selectedCollectionId === 'all'
                      ? 'border-accent bg-accent/15 text-ink'
                      : 'border-line bg-app text-muted'
                  }`}
                >
                  Todas
                </button>
                {collections.map((col) => (
                  <button
                    key={col.id}
                    type="button"
                    onClick={() => setSelectedCollectionId(col.id)}
                    className={`min-h-[38px] rounded-[4px] border px-2.5 text-xs font-medium ${
                      selectedCollectionId === col.id
                        ? 'border-accent bg-accent/15 text-ink'
                        : 'border-line bg-app text-muted'
                    }`}
                  >
                    {col.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {availableGenres.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted">Gênero</p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setSelectedGenre('all')}
                  className={`min-h-[36px] rounded-[4px] border px-2.5 text-[11px] font-medium ${
                    selectedGenre === 'all'
                      ? 'border-accent bg-accent/15 text-ink'
                      : 'border-line bg-app text-muted'
                  }`}
                >
                  Todos
                </button>
                {availableGenres.map((g) => (
                  <button
                    key={g.name}
                    type="button"
                    onClick={() => setSelectedGenre(g.name)}
                    className={`min-h-[36px] rounded-[4px] border px-2.5 text-[11px] font-medium tabular-nums ${
                      selectedGenre === g.name
                        ? 'border-accent bg-accent/15 text-ink'
                        : 'border-line bg-app text-muted'
                    }`}
                  >
                    {g.name} ({g.count})
                  </button>
                ))}
              </div>
            </div>
          )}

          {availableFormats.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted">Mídia / Exibição</p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setSelectedFormat('all')}
                  className={`min-h-[36px] rounded-[4px] border px-2.5 text-[11px] font-medium ${
                    selectedFormat === 'all'
                      ? 'border-accent bg-accent/15 text-ink'
                      : 'border-line bg-app text-muted'
                  }`}
                >
                  Todas
                </button>
                {availableFormats.map((f) => (
                  <button
                    key={f.name}
                    type="button"
                    onClick={() => setSelectedFormat(f.name)}
                    className={`min-h-[36px] rounded-[4px] border px-2.5 text-[11px] font-medium ${
                      selectedFormat === f.name
                        ? 'border-accent bg-accent/15 text-ink'
                        : 'border-line bg-app text-muted'
                    }`}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {availableAudioTags.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted">Áudio / Edição</p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setSelectedAudioFormat('all')}
                  className={`min-h-[36px] rounded-[4px] border px-2.5 text-[11px] font-medium ${
                    selectedAudioFormat === 'all'
                      ? 'border-accent bg-accent/15 text-ink'
                      : 'border-line bg-app text-muted'
                  }`}
                >
                  Todos
                </button>
                {availableAudioTags.map((a) => (
                  <button
                    key={a.name}
                    type="button"
                    onClick={() => setSelectedAudioFormat(a.name)}
                    className={`min-h-[36px] rounded-[4px] border px-2.5 text-[11px] font-medium ${
                      selectedAudioFormat === a.name
                        ? 'border-accent bg-accent/15 text-ink'
                        : 'border-line bg-app text-muted'
                    }`}
                  >
                    {a.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="mb-1.5 text-xs font-medium text-muted">Exibição dos Títulos</p>
            <div className="grid grid-cols-3 gap-1.5">
              {TITLE_MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setTitleMode(m.id)}
                  className={`min-h-[38px] rounded-[4px] border text-xs font-medium ${
                    titleMode === m.id
                      ? 'border-accent bg-accent/15 text-ink'
                      : 'border-line bg-app text-muted'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2 border-t border-line pt-3">
            <button
              type="button"
              onClick={clearAllFilters}
              className="min-h-[44px] flex-1 rounded-[4px] border border-line bg-app text-xs font-medium text-ink"
            >
              Limpar Tudo
            </button>
            <button
              type="button"
              onClick={() => setFiltersOpen(false)}
              className="min-h-[44px] flex-1 rounded-[4px] bg-accent text-xs font-semibold text-accent-ink"
            >
              Aplicar ({filteredAndSortedItems.length})
            </button>
          </div>
        </div>
      </ResponsiveSheet>

      {/* Modal de Coleções Personalizadas */}
      <ResponsiveSheet
        isOpen={collectionManagerOpen}
        onClose={() => setCollectionManagerOpen(false)}
        title="Coleções Personalizadas"
      >
        <div className="space-y-4 p-1">
          {onCreateCollection && (
            <CollectionCreatorBar
              collections={collections}
              onCreateCollection={onCreateCollection}
            />
          )}

          {collections.length === 0 ? (
            <p className="rounded-[4px] border border-dashed border-line bg-app py-6 text-center text-xs text-subtle">
              Crie coleções temáticas como Animes Clássicos ou Terror Anos 80.
            </p>
          ) : (
            <div className="space-y-2">
              {collections.map((col, idx) => {
                const members = sortWorksInCollection(
                  filterWorksByCollection(backlogItems, col.id),
                  col
                );
                const mosaicUri = buildCollectionMosaicCoverDataUri(members, col.name);
                return (
                  <div
                    key={col.id}
                    className="flex items-center justify-between gap-2.5 rounded-[6px] border border-line bg-app p-2.5"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCollectionId(col.id);
                        setCollectionManagerOpen(false);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                    >
                      <img
                        src={mosaicUri}
                        alt={col.name}
                        className="h-11 w-11 shrink-0 rounded-[4px] border border-line object-cover"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-ink">
                          {col.name}
                        </p>
                        <p className="text-[11px] tabular-nums text-subtle">
                          {members.length} {members.length === 1 ? 'obra' : 'obras'}
                        </p>
                      </div>
                    </button>

                    <div className="flex items-center gap-1">
                      {onMoveCollection && (
                        <>
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => onMoveCollection(col.id, -1)}
                            aria-label={`Mover coleção ${col.name} para cima`}
                            className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-[4px] border border-line bg-card text-muted disabled:opacity-35"
                          >
                            <ArrowUp className="h-3.5 w-3.5" strokeWidth={1.5} />
                          </button>
                          <button
                            type="button"
                            disabled={idx === collections.length - 1}
                            onClick={() => onMoveCollection(col.id, 1)}
                            aria-label={`Mover coleção ${col.name} para baixo`}
                            className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-[4px] border border-line bg-card text-muted disabled:opacity-35"
                          >
                            <ArrowDown className="h-3.5 w-3.5" strokeWidth={1.5} />
                          </button>
                        </>
                      )}
                      {onDeleteCollection && (
                        <button
                          type="button"
                          onClick={() => onDeleteCollection(col.id)}
                          aria-label={`Excluir coleção ${col.name}`}
                          className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-[4px] border border-line bg-card text-rose-400 hover:border-rose-500/40"
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {activeCustomCollection && activeCollectionWorks.length > 1 && onMoveCollectionWork && (
            <div className="space-y-1.5 border-t border-line pt-3">
              <p className="text-xs font-semibold text-ink">
                Ordenar obras em &quot;{activeCustomCollection.name}&quot;
              </p>
              <div className="max-h-40 space-y-1 overflow-y-auto">
                {activeCollectionWorks.map((w, idx) => (
                  <div
                    key={w.id}
                    className="flex items-center justify-between gap-2 rounded-[4px] border border-line bg-app px-2.5 py-1.5 text-xs"
                  >
                    <span className="truncate text-ink">{w.title}</span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => onMoveCollectionWork(activeCustomCollection.id, w.id, -1)}
                        className="rounded border border-line bg-card p-1 text-muted disabled:opacity-35"
                      >
                        <ArrowUp className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === activeCollectionWorks.length - 1}
                        onClick={() => onMoveCollectionWork(activeCustomCollection.id, w.id, 1)}
                        className="rounded border border-line bg-card p-1 text-muted disabled:opacity-35"
                      >
                        <ArrowDown className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </ResponsiveSheet>

      <OfflineBookPickerModal
        isOpen={rouletteOpen}
        onClose={() => setRouletteOpen(false)}
        items={items}
        readerDna={profile?.readerDna || null}
        onStartReading={onStartPickedWork}
        onSelectItem={onSelectItem}
      />
    </div>
  );
}
