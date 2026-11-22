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
  RotateCcw,
  Search,
  SlidersHorizontal,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import {
  memo,
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { CollectionCreatorBar } from '../components/CollectionCreatorBar';
import { CoverArt } from '../components/CoverArt';
import { OfflineBookPickerModal } from '../components/OfflineBookPickerModal';
import { ResponsiveSheet } from '../components/ResponsiveSheet';
import { StatusBadge } from '../components/StatusBadge';
import { VectorIcon } from '../components/VectorIcon';
import {
  domainConfig,
  getStatusConfig,
  getStatusList,
  getWorkTypeConfig,
} from '../config/domainConfig';
import { isFlagEnabled } from '../config/flags';
import { useToast } from '../context/ToastContext';
import { SpineRenderer } from '../graphics/SpineRenderer';
import {
  calculateWorkProgress,
  formatFlexibleProgressMetric,
  getDisplayTitles,
  getHypeMeta,
  getWatchedMinutes,
  isEpisodicWork,
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

const MemoGridCard = memo(function MemoGridCard({
  item,
  titleMode,
  priority = false,
  selectionMode = false,
  selected = false,
  onSelectItem,
  onLongPressItem,
}) {
  const status = getStatusConfig(item.status);
  const workMeta = getWorkTypeConfig(item.workType);
  const itemPct = calculateWorkProgress(item);
  const episodic = isEpisodicWork(item);
  const pressTimerRef = useRef(null);
  const longPressedRef = useRef(false);

  const badgeMetric = episodic
    ? Number(item.currentEpisode) > 0
      ? `T${item.currentSeason || 1}·E${item.currentEpisode}`
      : Number(item.totalEpisodes) > 0
        ? `${item.totalEpisodes}ep`
        : ''
    : Number(item.durationMinutes) > 0
      ? `${item.durationMinutes}m`
      : '';

  const titles = getDisplayTitles(item, titleMode);
  const creatorLabel = item.director || item.studio || item.author || workMeta.shortLabel;

  const clearPress = () => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  };

  return (
    <div className="group flex flex-col text-left" style={{ contain: 'layout paint' }}>
      <button
        type="button"
        onClick={() => {
          if (longPressedRef.current) {
            longPressedRef.current = false;
            return;
          }
          onSelectItem(item);
        }}
        onPointerDown={() => {
          if (!onLongPressItem) return;
          longPressedRef.current = false;
          clearPress();
          pressTimerRef.current = setTimeout(() => {
            longPressedRef.current = true;
            onLongPressItem(item);
          }, 520);
        }}
        onPointerUp={clearPress}
        onPointerCancel={clearPress}
        onPointerLeave={clearPress}
        aria-pressed={selectionMode ? selected : undefined}
        className="text-left focus:outline-none"
      >
        <div className="relative overflow-hidden rounded-[4px]">
          <CoverArt
            item={item}
            compact
            priority={priority}
            className={`aspect-[2/3] w-full rounded-[4px] transition-transform duration-150 group-hover:scale-[1.02] group-hover:border-accent/60 ${
              selected ? 'ring-2 ring-accent' : ''
            }`}
          />

          {selectionMode && (
            <span
              className={`absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-[4px] border ${
                selected
                  ? 'border-accent bg-accent text-accent-ink'
                  : 'border-white/70 bg-black/55 text-white'
              }`}
            >
              {selected && <Check className="h-3.5 w-3.5" strokeWidth={2} />}
            </span>
          )}

          {!selectionMode && item.isPlatinum && (
            <span
              aria-label="Favorito 5 estrelas"
              className="absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-app/90 text-accent ring-1 ring-accent/60"
            >
              <Star className="h-3 w-3 fill-current" strokeWidth={1.5} />
            </span>
          )}

          {typeof item.rating === 'number' && (
            <span className="absolute right-1.5 top-1.5 rounded-[3px] border border-line bg-app/90 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-ink">
              {item.rating}
            </span>
          )}

          {badgeMetric && (
            <span className="absolute bottom-2 right-1.5 rounded-[3px] bg-black/75 px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-white">
              {badgeMetric}
            </span>
          )}

          {/* Fita de progresso na base do pôster */}
          {(itemPct > 0 || item.status === 'completed') && (
            <div className="absolute inset-x-0 bottom-0 h-[3px] bg-black/50">
              <div
                className="h-full transition-all duration-200"
                style={{
                  width: `${item.status === 'completed' ? 100 : Math.min(100, itemPct)}%`,
                  backgroundColor: status?.color || 'var(--accent-color)',
                }}
              />
            </div>
          )}
        </div>

        <div className="mt-1.5 space-y-0.5 px-0.5">
          <p className="line-clamp-2 text-[11px] font-semibold leading-snug text-ink transition-colors group-hover:text-accent">
            {titles.primary}
          </p>
          <p className="truncate text-[10px] text-muted">{creatorLabel}</p>
        </div>
      </button>
    </div>
  );
});

export function ListScreen({
  items = [],
  profile = null,
  collections = [],
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
}) {
  const { showToast } = useToast();
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

  const availableGenres = useMemo(() => {
    const map = new Map();
    backlogItems.forEach((item) => {
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
  }, [backlogItems]);

  const availableFormats = useMemo(() => {
    const map = new Map();
    backlogItems.forEach((item) => {
      const fmt = String(item.format || '').trim();
      if (fmt) map.set(fmt, (map.get(fmt) || 0) + 1);
    });
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [backlogItems]);

  const availableAudioTags = useMemo(() => {
    const map = new Map();
    backlogItems.forEach((item) => {
      const tag = String(item.audioFormat || '').trim();
      if (tag) map.set(tag, (map.get(tag) || 0) + 1);
    });
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [backlogItems]);

  const syncFilteredItems = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const filtered = backlogItems.filter((item) => {
      if (selectedStatus !== 'all' && item.status !== selectedStatus) return false;
      if (selectedWorkType !== 'all' && (item.workType || 'movie') !== selectedWorkType) {
        return false;
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
      const inCreator = String(item.director || item.studio || item.author || '')
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
      return inTitle || inOrig || inCreator || inFranchise || inImdb || inGenres || inTags;
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
          (Number(a.totalEpisodes) || 0) * 24;
        const dB =
          Number(b.durationMinutes) ||
          getWatchedMinutes(b) ||
          (Number(b.totalEpisodes) || 0) * 24;
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
    backlogItems,
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
    if (backlogItems.length <= WORKER_ITEM_THRESHOLD) {
      setWorkerResult(null);
      return undefined;
    }
    let active = true;
    queryLibraryIndex(backlogItems, {
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
    backlogItems,
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
    backlogItems.length > WORKER_ITEM_THRESHOLD && Array.isArray(workerResult)
      ? workerResult
      : syncFilteredItems;

  useEffect(() => {
    setVisibleLimit(LIST_WINDOW_BATCH);
  }, [
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
      message: `${removedCount} obra(s) removida(s) da cinemateca.`,
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
    { id: 'all', label: list.allTabLabel, count: backlogItems.length },
    ...statuses.map((status) => ({
      id: status.id,
      label: status.label,
      count: backlogItems.filter((item) => item.status === status.id).length,
    })),
  ];

  const clearAllFilters = () => {
    setSelectedStatus('all');
    setSelectedWorkType('all');
    setSelectedCollectionId('all');
    setSelectedGenre('all');
    setSelectedFormat('all');
    setSelectedAudioFormat('all');
    setLocalQuery('');
    setSortBy('recent');
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
            aria-label="Buscar obras no acervo"
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
      {backlogItems.length === 0 ? (
        <div className="rounded-[6px] border border-line bg-card px-6 py-10 text-center">
          <p className="text-sm font-semibold text-ink">{list.emptyBacklogTitle}</p>
          <p className="mt-1 text-xs text-muted">
            Comece buscando filmes, séries ou animes no botão Catalogar.
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
            const workMeta = getWorkTypeConfig(item.workType);
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
                      item.director || item.studio || workMeta.shortLabel,
                      item.releaseYear,
                      item.audioFormat,
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
            <MemoGridCard
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
            <p className="mb-1.5 text-xs font-medium text-muted">Formato Audiovisual</p>
            <div className="flex flex-wrap gap-1.5">
              {[
                { id: 'all', label: list.allTypesLabel },
                ...domainConfig.workTypes.map((w) => ({ id: w.id, label: w.shortLabel })),
              ].map((opt) => (
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
