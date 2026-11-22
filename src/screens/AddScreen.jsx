import {
  AlertCircle,
  Check,
  FileSpreadsheet,
  Film,
  PenLine,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CoverArt } from '../components/CoverArt';
import { SmartCatalogButton } from '../components/SmartCatalogButton';
import { TechnicalAtmosphereSection } from '../components/TechnicalAtmosphereSection';
import { VectorIcon } from '../components/VectorIcon';
import { WorkTypeSelector } from '../components/WorkTypeSelector';
import {
  domainConfig,
  getStatusConfig,
  getWorkTypeConfig,
} from '../config/domainConfig';
import {
  CINEMA_API_SOURCES,
  CINEMA_SOURCE_PRESETS,
  enrichCinemaCandidate,
  getCachedCinemaSearch,
  getDefaultSourcesForFilter,
  loadActiveCinemaSources,
  saveActiveCinemaSources,
  searchCinemaMedia,
  searchMockCinema,
} from '../services/cinemaApi';
import { createUuid } from '../services/codiceDatabase';
import {
  calculateSmartRating,
  calculateWorkProgress,
  createDefaultReviewCriteria,
  getDisplayTitles,
  getTodayLocalISO,
  getVerdictForScore,
  isEpisodicWork,
} from '../utils/backlogHelpers';
import { findDuplicateMatch } from '../utils/catalogImporters';
import { buildPrefilledCatalogDraft } from '../utils/genreMapper';
import { GENRE_OPTIONS } from '../utils/readerPreferences';

const SEARCH_FILTER_STORAGE_KEY = 'cine_codice_add_search_filter_v1';
const MIN_SEARCH_QUERY_LENGTH = 3;
const SEARCH_DEBOUNCE_MS = 300;

function createMonogram(title) {
  const words = String(title || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }
  return String(title || 'OB').slice(0, 2).toUpperCase();
}

function buildDraftWithStatus(baseDraft, nextStatus) {
  const today = getTodayLocalISO();
  const updated = { ...baseDraft, status: nextStatus };

  if (nextStatus === 'playing' || nextStatus === 'rewatching') {
    updated.startDate = updated.startDate || today;
    updated.progress = calculateWorkProgress(updated);
  }

  if (nextStatus === 'completed') {
    updated.completedDate = updated.completedDate || today;
    updated.startDate = updated.startDate || updated.completedDate;
    updated.progress = 100;
    if (isEpisodicWork(updated)) {
      if (Number(updated.totalEpisodes) > 0) {
        updated.currentEpisode = Number(updated.totalEpisodes);
      }
      if (Number(updated.totalSeasons) > 0) {
        updated.currentSeason = Number(updated.totalSeasons);
      }
    } else if (Number(updated.totalSeconds) > 0 || Number(updated.durationMinutes) > 0) {
      const totalSec =
        Number(updated.totalSeconds) || Number(updated.durationMinutes) * 60;
      updated.totalSeconds = totalSec;
      updated.currentSeconds = totalSec;
    }
    if (!updated.reviewCriteria) {
      updated.reviewCriteria = createDefaultReviewCriteria(80);
    }
    updated.rating = calculateSmartRating(updated.reviewCriteria);
    updated.verdict = getVerdictForScore(updated.rating);
  }

  if (nextStatus === 'queued') {
    updated.progress = 0;
  }

  return updated;
}

function ResultSkeleton() {
  return (
    <div className="space-y-2.5" aria-hidden="true">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className="flex animate-pulse items-center gap-3 rounded-2xl border border-line bg-card p-2.5"
        >
          <div className="h-20 w-14 shrink-0 rounded-[4px] bg-elevated" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-2/3 rounded bg-elevated" />
            <div className="h-3 w-1/2 rounded bg-elevated/70" />
          </div>
          <div className="h-9 w-20 shrink-0 rounded-[4px] bg-elevated/80" />
        </div>
      ))}
    </div>
  );
}

function loadSavedSearchFilter() {
  try {
    if (typeof localStorage === 'undefined') return 'all';
    const raw = localStorage.getItem(SEARCH_FILTER_STORAGE_KEY);
    return ['all', 'movie', 'series', 'anime'].includes(raw) ? raw : 'all';
  } catch {
    return 'all';
  }
}

export function AddScreen({
  items = [],
  geminiKey = '',
  tmdbKey = '',
  onAddItem,
  onSelectExisting,
  onOpenGeminiSettings,
  onOpenImportCatalog,
}) {
  const [query, setQuery] = useState('');
  const [searchFilter, setSearchFilter] = useState(loadSavedSearchFilter);
  const [activeSources, setActiveSources] = useState(() =>
    loadActiveCinemaSources(loadSavedSearchFilter())
  );
  const [sourcesPopoverOpen, setSourcesPopoverOpen] = useState(false);
  const [results, setResults] = useState(() =>
    searchMockCinema('', loadSavedSearchFilter())
  );
  const [isLoading, setIsLoading] = useState(false);
  const [enrichingCandidate, setEnrichingCandidate] = useState(false);
  const [partialFailure, setPartialFailure] = useState(false);
  const [failedSourcesCount, setFailedSourcesCount] = useState(0);
  const [allFailed, setAllFailed] = useState(false);

  const [draftItem, setDraftItem] = useState(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualDraft, setManualDraft] = useState(null);

  const { ui, cardFields, addFlowStatuses, mediaFormats, audioFormatTags, searchFilters } =
    domainConfig;
  const { add } = ui;

  const isEasterEgg67 = query.trim().toLowerCase() === '#ovodepascoa67';
  const debounceTimerRef = useRef(null);
  const searchAbortRef = useRef(null);
  const sourcesPopoverRef = useRef(null);
  const sourcesButtonRef = useRef(null);

  const backlogLookup = useMemo(() => {
    const byId = new Map();
    const byTitle = new Map();
    items
      .filter((item) => item && item.inBacklog !== false)
      .forEach((item) => {
        byId.set(item.id, item);
        byTitle.set(String(item.title || '').trim().toLowerCase(), item);
        if (item.originalTitle) {
          byTitle.set(String(item.originalTitle).trim().toLowerCase(), item);
        }
      });
    return { byId, byTitle };
  }, [items]);

  const findExisting = (candidate) =>
    backlogLookup.byId.get(candidate.id) ||
    backlogLookup.byTitle.get(candidate.title?.trim().toLowerCase()) ||
    findDuplicateMatch(candidate, items) ||
    null;

  const quickSuggestions = useMemo(() => {
    const curated = [
      { label: 'Hayao Miyazaki', query: 'Spirited Away', filter: 'anime', sources: ['anilist', 'jikan'] },
      { label: 'Blade Runner 2049', query: 'Blade Runner', filter: 'movie', sources: ['tmdb', 'imdb', 'wikidata'] },
      { label: 'Breaking Bad', query: 'Breaking Bad', filter: 'series', sources: ['tvmaze', 'tmdb', 'imdb'] },
      { label: 'Attack on Titan', query: 'Attack on Titan', filter: 'anime', sources: ['anilist', 'jikan'] },
      { label: 'Parasita', query: 'Parasite', filter: 'movie', sources: ['tmdb', 'imdb', 'wikidata'] },
      { label: 'Cowboy Bebop', query: 'Cowboy Bebop', filter: 'anime', sources: ['anilist', 'jikan'] },
    ];
    return curated;
  }, []);

  const updateSearchFilter = useCallback((nextFilter) => {
    setSearchFilter(nextFilter);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(SEARCH_FILTER_STORAGE_KEY, nextFilter);
      }
    } catch {
      // Ignora erro de storage
    }
  }, []);

  const updateSources = useCallback((nextList) => {
    setActiveSources(nextList);
    saveActiveCinemaSources(nextList);
  }, []);

  useEffect(() => {
    if (!sourcesPopoverOpen) return undefined;
    const handlePointerDown = (e) => {
      if (
        sourcesPopoverRef.current &&
        !sourcesPopoverRef.current.contains(e.target)
      ) {
        setSourcesPopoverOpen(false);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setSourcesPopoverOpen(false);
        sourcesButtonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [sourcesPopoverOpen]);

  const handleToggleSource = (sourceId) => {
    const exists = activeSources.includes(sourceId);
    if (exists && activeSources.length === 1) return;
    const next = exists
      ? activeSources.filter((s) => s !== sourceId)
      : [...activeSources, sourceId];
    updateSources(next);
  };

  const handleSelectPreset = (preset) => {
    updateSources(preset.sources);
    updateSearchFilter(preset.filter);
  };

  const handleSelectFilterTab = (nextFilter) => {
    updateSearchFilter(nextFilter);
    updateSources(getDefaultSourcesForFilter(nextFilter));
  };

  const executeSearch = useCallback(
    async (cleanQuery, filter, sources, { skipCache = false } = {}) => {
      searchAbortRef.current?.abort();

      if (!cleanQuery || cleanQuery.length < MIN_SEARCH_QUERY_LENGTH) {
        setResults(searchMockCinema(cleanQuery, filter));
        setIsLoading(false);
        setPartialFailure(false);
        setFailedSourcesCount(0);
        setAllFailed(false);
        return;
      }

      if (cleanQuery.toLowerCase() === '#ovodepascoa67') {
        setResults([]);
        setIsLoading(false);
        setPartialFailure(false);
        setFailedSourcesCount(0);
        setAllFailed(false);
        return;
      }

      if (!skipCache) {
        const cached = getCachedCinemaSearch(cleanQuery, filter, sources);
        if (cached) {
          setResults(cached.results);
          setPartialFailure(Boolean(cached.partialFailure));
          setFailedSourcesCount(Number(cached.failedCount) || 0);
          setAllFailed(false);
          setIsLoading(false);
          return;
        }
      }

      const controller = new AbortController();
      searchAbortRef.current = controller;
      setIsLoading(true);
      setPartialFailure(false);
      setFailedSourcesCount(0);
      setAllFailed(false);

      try {
        const response = await searchCinemaMedia(cleanQuery, {
          filter,
          sources,
          tmdbApiKey: tmdbKey,
          signal: controller.signal,
          skipCache,
        });
        if (controller.signal.aborted) return;

        setResults(response.results || []);
        setPartialFailure(Boolean(response.partialFailure));
        setFailedSourcesCount(Number(response.failedCount) || 0);
        setAllFailed(Boolean(response.allFailed) && (response.results || []).length === 0);
      } catch (err) {
        if (err?.name === 'AbortError' || controller.signal.aborted) return;
        const offlineFallback = searchMockCinema(cleanQuery, filter);
        setResults(offlineFallback);
        setAllFailed(offlineFallback.length === 0);
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    },
    [tmdbKey]
  );

  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    const clean = query.trim();

    if (!clean || clean.length < MIN_SEARCH_QUERY_LENGTH) {
      executeSearch(clean, searchFilter, activeSources);
      return undefined;
    }

    debounceTimerRef.current = setTimeout(() => {
      executeSearch(clean, searchFilter, activeSources);
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [query, searchFilter, activeSources, executeSearch]);

  const handleOpenCandidateDrawer = async (candidate) => {
    const draftBase = buildPrefilledCatalogDraft(candidate);
    const initialDraft = buildDraftWithStatus(
      {
        ...draftBase,
        format: mediaFormats[0],
        audioFormat: candidate.workType === 'anime' ? 'Legendado' : audioFormatTags[0],
      },
      add.defaultNewStatus
    );
    setDraftItem(initialDraft);

    if (candidate.tvmazeId || candidate.tmdbId) {
      setEnrichingCandidate(true);
      try {
        const enriched = await enrichCinemaCandidate(candidate, {
          tmdbApiKey: tmdbKey,
        });
        setDraftItem((curr) => {
          if (!curr || curr.id !== initialDraft.id) return curr;
          return {
            ...curr,
            director: curr.director || enriched.director || '',
            author: curr.director || enriched.director || '',
            studio: curr.studio || enriched.studio || '',
            totalSeasons: enriched.totalSeasons || curr.totalSeasons,
            totalEpisodes: enriched.totalEpisodes || curr.totalEpisodes,
            episodesPerSeason: enriched.episodesPerSeason || curr.episodesPerSeason,
            episodeList: enriched.episodeList || curr.episodeList,
            episodeDurationMinutes:
              enriched.episodeDurationMinutes || curr.episodeDurationMinutes,
            durationMinutes: enriched.durationMinutes || curr.durationMinutes,
            totalSeconds:
              enriched.durationMinutes && curr.workType === 'movie'
                ? enriched.durationMinutes * 60
                : curr.totalSeconds,
            synopsis:
              String(enriched.synopsis || '').length > String(curr.synopsis || '').length
                ? enriched.synopsis
                : curr.synopsis,
          };
        });
      } catch {
        // Mantém rascunho inicial sem travar
      } finally {
        setEnrichingCandidate(false);
      }
    }
  };

  const handleSaveDraft = () => {
    if (!draftItem) return;
    onAddItem(draftItem);
    setDraftItem(null);
  };

  const handleOpenManualModal = () => {
    const defaultType =
      searchFilter === 'anime'
        ? 'anime'
        : searchFilter === 'series'
          ? 'series'
          : 'movie';
    const cleanTitle = query.trim();
    setManualDraft(
      buildDraftWithStatus(
        {
          id: createUuid(),
          workType: defaultType,
          title: cleanTitle,
          originalTitle: '',
          director: '',
          author: '',
          studio: '',
          franchiseName: '',
          releaseYear: domainConfig.currentYear,
          durationMinutes: defaultType === 'movie' ? 120 : null,
          totalSeconds: defaultType === 'movie' ? 7200 : null,
          currentSeconds: 0,
          totalSeasons: defaultType === 'movie' ? 1 : 1,
          currentSeason: 1,
          totalEpisodes: defaultType === 'movie' ? null : 12,
          currentEpisode: 0,
          episodeDurationMinutes: defaultType === 'anime' ? 24 : 45,
          genresText: '',
          synopsis: '',
          format: mediaFormats[0],
          audioFormat: audioFormatTags[0],
          atmosphere: [],
          tropes: [],
          notes: '',
        },
        add.defaultNewStatus
      )
    );
    setManualOpen(true);
  };

  const handleSaveManual = (e) => {
    e.preventDefault();
    if (!manualDraft?.title?.trim()) return;
    const genres = String(manualDraft.genresText || '')
      .split(',')
      .map((g) => g.trim())
      .filter(Boolean)
      .slice(0, 4);
    const title = manualDraft.title.trim();
    const durationMin = Number(manualDraft.durationMinutes) || null;
    const payload = {
      ...manualDraft,
      title,
      director: String(manualDraft.director || '').trim(),
      author: String(manualDraft.director || '').trim(),
      studio: String(manualDraft.studio || '').trim(),
      franchiseName: String(manualDraft.franchiseName || '').trim(),
      totalSeconds: manualDraft.workType === 'movie' && durationMin ? durationMin * 60 : null,
      genres,
      monogram: createMonogram(title),
      palette: MANUAL_PALETTES[title.length % MANUAL_PALETTES.length],
      inBacklog: true,
    };
    delete payload.genresText;
    onAddItem(payload);
    setManualOpen(false);
    setManualDraft(null);
  };

  return (
    <div className="space-y-4 pb-24">
      <header className="flex flex-wrap items-start justify-between gap-2 pt-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">
            {add.title}
          </h1>
          <p className="mt-0.5 text-xs text-subtle">{add.subtitle}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {onOpenImportCatalog && (
            <button
              type="button"
              onClick={onOpenImportCatalog}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[4px] border border-line bg-card px-2.5 py-1.5 text-xs font-medium text-ink transition-colors hover:border-accent"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
              <span className="hidden sm:inline">Importar CSV</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleOpenManualModal}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[4px] border border-accent/45 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-accent/20"
          >
            <PenLine className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
            <span>{add.manualButtonLabel}</span>
          </button>
        </div>
      </header>

      {/* Barra de Busca + Botão Fontes */}
      <div className="relative" ref={sourcesPopoverRef}>
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle"
              strokeWidth={1.5}
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={add.searchPlaceholder}
              aria-label="Buscar filmes, séries e animes nas fontes abertas"
              className="min-h-[46px] w-full rounded-[6px] border border-line bg-card py-2 pl-9 pr-9 text-sm text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Limpar busca"
                className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center text-subtle hover:text-ink"
              >
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            )}
          </div>

          <button
            ref={sourcesButtonRef}
            type="button"
            onClick={() => setSourcesPopoverOpen((v) => !v)}
            aria-expanded={sourcesPopoverOpen}
            aria-label="Configurar fontes da pesquisa"
            className={`inline-flex min-h-[46px] shrink-0 items-center gap-1.5 rounded-[6px] border px-3 text-xs font-medium transition-colors ${
              sourcesPopoverOpen
                ? 'border-accent bg-accent/15 text-ink'
                : 'border-line bg-card text-muted hover:text-ink'
            }`}
          >
            <SlidersHorizontal className="h-4 w-4 text-accent" strokeWidth={1.5} />
            <span>Fontes</span>
            <span className="rounded-[2px] border border-line bg-app px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-ink">
              {activeSources.length}
            </span>
          </button>
        </div>

        {sourcesPopoverOpen && (
          <div className="mt-2 space-y-3 rounded-[6px] border border-line bg-card p-3.5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-ink">Presets rápidos</span>
              <div className="flex flex-wrap gap-1">
                {CINEMA_SOURCE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleSelectPreset(preset)}
                    className="min-h-[34px] rounded-[4px] border border-line bg-app px-2.5 text-[11px] font-medium text-ink hover:border-accent"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {CINEMA_API_SOURCES.map((src) => {
                const checked = activeSources.includes(src.id);
                return (
                  <label
                    key={src.id}
                    className={`flex min-h-[44px] cursor-pointer items-center justify-between gap-2 rounded-[4px] border px-2.5 py-1.5 text-xs ${
                      checked
                        ? 'border-accent/60 bg-accent/10 text-ink'
                        : 'border-line bg-app text-muted'
                    }`}
                  >
                    <div className="min-w-0">
                      <span className="block font-semibold">{src.label}</span>
                      <span className="block truncate text-[10px] text-subtle">
                        {src.hint}
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => handleToggleSource(src.id)}
                      className="h-4 w-4 shrink-0 accent-[var(--accent-color)]"
                    />
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Abas de Formato (Todos | Filmes | Séries | Animes) */}
      <div className="flex gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
        {searchFilters.map((f) => {
          const active = searchFilter === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => handleSelectFilterTab(f.id)}
              className={`min-h-[40px] shrink-0 rounded-[4px] border px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? 'border-accent bg-accent text-accent-ink'
                  : 'border-line bg-card text-muted hover:text-ink'
              }`}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* Sugestões rápidas quando query está vazia */}
      {!query.trim() && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
          <span className="shrink-0 text-[11px] font-medium text-subtle">
            Sugestões:
          </span>
          {quickSuggestions.map((sug) => (
            <button
              key={sug.label}
              type="button"
              onClick={() => {
                searchAbortRef.current?.abort();
                updateSearchFilter(sug.filter || 'all');
                if (sug.sources?.length) updateSources(sug.sources);
                setQuery(sug.query);
              }}
              className="min-h-[36px] shrink-0 rounded-[4px] border border-line bg-card px-2.5 text-[11px] font-medium text-muted hover:border-accent hover:text-ink"
            >
              {sug.label}
            </button>
          ))}
        </div>
      )}

      {partialFailure && (
        <div
          role="status"
          className="flex items-center justify-between gap-2 rounded-[4px] border border-line bg-card px-3 py-2 text-xs text-muted"
        >
          <span>
            {failedSourcesCount} fonte(s) oscilaram ou atingiram timeout (8s) — exibindo resultados das demais APIs.
          </span>
          <button
            type="button"
            onClick={() =>
              executeSearch(query.trim(), searchFilter, activeSources, { skipCache: true })
            }
            className="inline-flex min-h-[34px] shrink-0 items-center gap-1 text-accent hover:underline"
          >
            <RefreshCw className="h-3 w-3" strokeWidth={1.5} />
            Tentar novamente
          </button>
        </div>
      )}

      {isEasterEgg67 ? (
        <div className="rounded-[6px] border border-accent/50 bg-card p-5 text-center space-y-2">
          <Sparkles className="mx-auto h-6 w-6 text-accent" strokeWidth={1.5} />
          <h2 className="text-sm font-semibold text-ink">
            Sessão Secreta dos Irmãos Lumière (1895)
          </h2>
          <p className="text-xs text-muted">
            Cinematógrafo calibrado. Sua cinemateca privada está pronta para novas projeções.
          </p>
        </div>
      ) : isLoading ? (
        <ResultSkeleton />
      ) : allFailed ? (
        <div className="rounded-[6px] border border-dashed border-line bg-card px-5 py-8 text-center space-y-3">
          <AlertCircle className="mx-auto h-6 w-6 text-accent" strokeWidth={1.5} />
          <div>
            <p className="text-xs font-semibold text-ink">
              Todas as fontes consultadas falharam ou expiraram
            </p>
            <p className="mt-1 text-[11px] text-muted">
              Verifique sua conexão ou faça o cadastro manual instantâneo.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() =>
                executeSearch(query.trim(), searchFilter, activeSources, { skipCache: true })
              }
              className="min-h-[44px] rounded-[4px] border border-line bg-app px-3.5 text-xs font-medium text-ink"
            >
              Tentar Novamente
            </button>
            <button
              type="button"
              onClick={handleOpenManualModal}
              className="min-h-[44px] rounded-[4px] bg-accent px-4 text-xs font-semibold text-accent-ink"
            >
              Cadastro Manual
            </button>
          </div>
        </div>
      ) : results.length === 0 ? (
        <div className="rounded-[6px] border border-dashed border-line bg-card px-5 py-8 text-center space-y-2.5">
          <Film className="mx-auto h-6 w-6 text-subtle" strokeWidth={1.5} />
          <p className="text-xs font-semibold text-ink">{add.emptySearchTitle}</p>
          <p className="text-[11px] text-muted">{add.emptySearchDescription}</p>
          <button
            type="button"
            onClick={handleOpenManualModal}
            className="min-h-[44px] rounded-[4px] border border-accent bg-accent/10 px-4 text-xs font-semibold text-accent hover:bg-accent hover:text-accent-ink"
          >
            {add.manualButtonLabel}
          </button>
        </div>
      ) : (
        <section aria-label={add.resultsLabel} className="space-y-2.5">
          <div className="flex items-center justify-between text-[11px] text-subtle tabular-nums">
            <span>
              {query.trim() ? add.resultsLabel : add.suggestionsLabel} ({results.length})
            </span>
          </div>

          <div className="space-y-2.5">
            {results.map((candidate) => {
              const existing = findExisting(candidate);
              const titles = getDisplayTitles(candidate, 'bilingual');
              const workMeta = getWorkTypeConfig(candidate.workType);
              const metaLine = [
                workMeta.shortLabel,
                candidate.director || candidate.studio,
                candidate.releaseYear,
                isEpisodicWork(candidate)
                  ? candidate.totalEpisodes
                    ? `${candidate.totalEpisodes} eps`
                    : ''
                  : candidate.durationMinutes
                    ? `${candidate.durationMinutes} min`
                    : '',
              ]
                .filter(Boolean)
                .join(' · ');

              const badges = Array.isArray(candidate.mergedSources) && candidate.mergedSources.length > 0
                ? candidate.mergedSources
                : candidate.sourceBadge
                  ? [candidate.sourceBadge]
                  : [];

              return (
                <article
                  key={candidate.id}
                  className="flex items-start gap-3 rounded-[6px] border border-line bg-card p-3 transition-colors hover:border-accent/50"
                >
                  <CoverArt
                    item={candidate}
                    compact
                    className="h-24 w-16 shrink-0 rounded-[4px]"
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="line-clamp-2 text-xs sm:text-sm font-semibold text-ink">
                          {titles.primary}
                        </h3>
                        {titles.secondary && (
                          <p className="truncate text-[10px] italic text-subtle">
                            {titles.secondary}
                          </p>
                        )}
                      </div>

                      <div className="flex shrink-0 flex-wrap justify-end gap-1">
                        {badges.map((srcName) => (
                          <span
                            key={srcName}
                            className="rounded-[3px] border border-line bg-app px-1.5 py-0.5 text-[9px] font-semibold text-muted"
                          >
                            {srcName}
                          </span>
                        ))}
                      </div>
                    </div>

                    {metaLine && (
                      <p className="truncate text-[11px] tabular-nums text-muted">
                        {metaLine}
                      </p>
                    )}

                    {candidate.synopsis && (
                      <p className="line-clamp-2 text-[11px] leading-snug text-subtle">
                        {candidate.synopsis}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <div className="flex flex-wrap gap-1">
                        {(candidate.genres || []).slice(0, 3).map((g) => (
                          <span
                            key={g}
                            className="rounded-[3px] border border-line bg-app px-1.5 py-0.5 text-[10px] text-muted"
                          >
                            {g}
                          </span>
                        ))}
                      </div>

                      {existing ? (
                        <button
                          type="button"
                          onClick={() => onSelectExisting?.(existing)}
                          className="inline-flex min-h-[40px] items-center gap-1 rounded-[4px] border border-line bg-app px-3 text-xs font-medium text-accent hover:border-accent"
                        >
                          <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
                          <span>{add.inListBadge}</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleOpenCandidateDrawer(candidate)}
                          className="inline-flex min-h-[40px] items-center gap-1 rounded-[4px] bg-accent px-3.5 text-xs font-semibold text-accent-ink hover:opacity-90"
                        >
                          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                          <span>Catalogar</span>
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {/* Drawer de Confirmação ao Catalogar Resultado */}
      {draftItem && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 sm:items-center sm:p-4"
          onClick={() => setDraftItem(null)}
          role="dialog"
          aria-modal="true"
          aria-label={add.drawerTitle}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-[8px] border border-line bg-card p-5 space-y-4 sm:rounded-[8px] no-scrollbar"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <CoverArt item={draftItem} compact className="h-24 w-16 shrink-0 rounded-[4px]" />
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-accent">
                    {add.drawerTitle}
                    {enrichingCandidate ? ' · Buscando episódios...' : ''}
                  </p>
                  <h2 className="mt-0.5 line-clamp-2 text-sm font-semibold text-ink">
                    {draftItem.title}
                  </h2>
                  <p className="mt-0.5 text-[11px] text-muted">
                    {[
                      draftItem.director || draftItem.studio,
                      draftItem.releaseYear,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDraftItem(null)}
                aria-label={add.drawerCancelLabel}
                className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-[4px] text-muted hover:text-ink"
              >
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>

            <WorkTypeSelector
              label={add.drawerWorkTypeLabel}
              value={draftItem.workType}
              onChange={(nextType) =>
                setDraftItem((curr) => ({ ...curr, workType: nextType }))
              }
            />

            <div>
              <p className="mb-1.5 text-xs font-medium text-muted">{add.drawerStatusLabel}</p>
              <div className="grid grid-cols-3 gap-1.5">
                {addFlowStatuses.map((statusId) => {
                  const cfg = getStatusConfig(statusId);
                  const active = draftItem.status === statusId;
                  return (
                    <button
                      key={statusId}
                      type="button"
                      onClick={() =>
                        setDraftItem((curr) => buildDraftWithStatus(curr, statusId))
                      }
                      className={`min-h-[42px] rounded-[4px] border px-2 text-xs font-medium transition-colors ${
                        active
                          ? 'border-accent bg-accent/15 text-ink'
                          : 'border-line bg-app text-muted hover:text-ink'
                      }`}
                    >
                      {cfg.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted">{add.drawerFormatLabel}</p>
                <div className="flex flex-wrap gap-1">
                  {mediaFormats.map((fmt) => (
                    <button
                      key={fmt}
                      type="button"
                      onClick={() => setDraftItem((curr) => ({ ...curr, format: fmt }))}
                      className={`min-h-[36px] rounded-[4px] border px-2 text-[11px] font-medium ${
                        draftItem.format === fmt
                          ? 'border-accent bg-accent/15 text-ink'
                          : 'border-line bg-app text-muted'
                      }`}
                    >
                      {fmt}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-xs font-medium text-muted">{add.drawerAudioLabel}</p>
                <div className="flex flex-wrap gap-1">
                  {audioFormatTags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() =>
                        setDraftItem((curr) => ({ ...curr, audioFormat: tag }))
                      }
                      className={`min-h-[36px] rounded-[4px] border px-2 text-[11px] font-medium ${
                        draftItem.audioFormat === tag
                          ? 'border-accent bg-accent/15 text-ink'
                          : 'border-line bg-app text-muted'
                      }`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <SmartCatalogButton
              item={draftItem}
              geminiKey={geminiKey}
              onApplyFields={(updates) =>
                setDraftItem((curr) => ({ ...curr, ...updates }))
              }
              onOpenGeminiSettings={onOpenGeminiSettings}
            />

            <TechnicalAtmosphereSection
              item={draftItem}
              onChange={(updates) => setDraftItem((curr) => ({ ...curr, ...updates }))}
            />

            <div className="flex gap-2 border-t border-line pt-3">
              <button
                type="button"
                onClick={() => setDraftItem(null)}
                className="min-h-[44px] flex-1 rounded-[4px] border border-line bg-app text-xs font-medium text-muted hover:text-ink"
              >
                {add.drawerCancelLabel}
              </button>
              <button
                type="button"
                onClick={handleSaveDraft}
                className="min-h-[44px] flex-1 rounded-[4px] bg-accent text-xs font-semibold text-accent-ink hover:opacity-90"
              >
                {add.drawerSaveLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Cadastro Manual */}
      {manualOpen && manualDraft && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 sm:items-center sm:p-4"
          onClick={() => setManualOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label={add.manualModalTitle}
        >
          <form
            onSubmit={handleSaveManual}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-[8px] border border-line bg-card p-5 space-y-3.5 sm:rounded-[8px] no-scrollbar"
          >
            <div className="flex items-center justify-between border-b border-line pb-2.5">
              <h2 className="text-sm font-semibold text-ink">{add.manualModalTitle}</h2>
              <button
                type="button"
                onClick={() => setManualOpen(false)}
                aria-label="Fechar cadastro manual"
                className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-[4px] text-muted hover:text-ink"
              >
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>

            <WorkTypeSelector
              label={add.drawerWorkTypeLabel}
              value={manualDraft.workType}
              onChange={(nextType) =>
                setManualDraft((curr) => ({ ...curr, workType: nextType }))
              }
            />

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">
                {add.manualTitleLabel} *
              </span>
              <input
                type="text"
                required
                value={manualDraft.title}
                onChange={(e) =>
                  setManualDraft((curr) => ({ ...curr, title: e.target.value }))
                }
                placeholder={add.manualTitlePlaceholder}
                className="min-h-[44px] w-full rounded-[4px] border border-line bg-app px-3 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
              />
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted">
                  {add.manualCreatorLabel}
                </span>
                <input
                  type="text"
                  value={manualDraft.director || ''}
                  onChange={(e) =>
                    setManualDraft((curr) => ({ ...curr, director: e.target.value }))
                  }
                  placeholder={add.manualCreatorPlaceholder}
                  className="min-h-[42px] w-full rounded-[4px] border border-line bg-app px-3 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted">
                  {add.manualYearLabel}
                </span>
                <input
                  type="number"
                  min="1895"
                  max="2099"
                  value={manualDraft.releaseYear || ''}
                  onChange={(e) =>
                    setManualDraft((curr) => ({
                      ...curr,
                      releaseYear: e.target.value ? Number(e.target.value) : null,
                    }))
                  }
                  className="min-h-[42px] w-full rounded-[4px] border border-line bg-app px-3 text-xs tabular-nums text-ink focus:border-accent focus:outline-none"
                />
              </label>
            </div>

            {manualDraft.workType === 'movie' ? (
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted">
                  {add.manualDurationLabel}
                </span>
                <input
                  type="number"
                  min="1"
                  max="1200"
                  value={manualDraft.durationMinutes || ''}
                  onChange={(e) =>
                    setManualDraft((curr) => ({
                      ...curr,
                      durationMinutes: e.target.value ? Number(e.target.value) : null,
                    }))
                  }
                  placeholder="Ex: 148"
                  className="min-h-[42px] w-full rounded-[4px] border border-line bg-app px-3 text-xs tabular-nums text-ink focus:border-accent focus:outline-none"
                />
              </label>
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted">
                    Temporadas
                  </span>
                  <input
                    type="number"
                    min="1"
                    value={manualDraft.totalSeasons || 1}
                    onChange={(e) =>
                      setManualDraft((curr) => ({
                        ...curr,
                        totalSeasons: Math.max(1, Number(e.target.value) || 1),
                      }))
                    }
                    className="min-h-[42px] w-full rounded-[4px] border border-line bg-app px-3 text-xs tabular-nums text-ink focus:border-accent focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted">
                    Total de episódios
                  </span>
                  <input
                    type="number"
                    min="1"
                    value={manualDraft.totalEpisodes || ''}
                    onChange={(e) =>
                      setManualDraft((curr) => ({
                        ...curr,
                        totalEpisodes: e.target.value ? Number(e.target.value) : null,
                      }))
                    }
                    className="min-h-[42px] w-full rounded-[4px] border border-line bg-app px-3 text-xs tabular-nums text-ink focus:border-accent focus:outline-none"
                  />
                </label>
              </div>
            )}

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">
                {add.manualGenresLabel}
              </span>
              <input
                type="text"
                value={manualDraft.genresText || ''}
                onChange={(e) =>
                  setManualDraft((curr) => ({ ...curr, genresText: e.target.value }))
                }
                placeholder={add.manualGenresPlaceholder}
                className="min-h-[42px] w-full rounded-[4px] border border-line bg-app px-3 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
              />
            </label>

            <div className="flex flex-wrap gap-1">
              {GENRE_OPTIONS.slice(0, 8).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() =>
                    setManualDraft((curr) => {
                      const current = String(curr.genresText || '')
                        .split(',')
                        .map((x) => x.trim())
                        .filter(Boolean);
                      if (current.includes(g)) return curr;
                      return {
                        ...curr,
                        genresText: [...current, g].slice(0, 4).join(', '),
                      };
                    })
                  }
                  className="rounded-[3px] border border-line bg-app px-2 py-1 text-[10px] text-muted hover:border-accent hover:text-ink"
                >
                  + {g}
                </button>
              ))}
            </div>

            <div className="flex gap-2 border-t border-line pt-3">
              <button
                type="button"
                onClick={() => setManualOpen(false)}
                className="min-h-[44px] flex-1 rounded-[4px] border border-line bg-app text-xs font-medium text-muted"
              >
                {add.drawerCancelLabel}
              </button>
              <button
                type="submit"
                className="min-h-[44px] flex-1 rounded-[4px] bg-accent text-xs font-semibold text-accent-ink hover:opacity-90"
              >
                {add.drawerSaveLabel}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
