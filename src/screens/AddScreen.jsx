import {
  AlertCircle,
  BookOpen,
  Check,
  FileSpreadsheet,
  Film,
  Gamepad2,
  Music,
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
import { DomainSwitcherBar } from '../components/DomainSwitcherBar';
import { SmartCatalogButton } from '../components/SmartCatalogButton';
import { TechnicalAtmosphereSection } from '../components/TechnicalAtmosphereSection';
import { VectorIcon } from '../components/VectorIcon';
import { WorkTypeSelector } from '../components/WorkTypeSelector';
import {
  BOOK_FORMATS,
  GAME_COMPLETION_TYPES,
  GAME_EDITION_TYPES,
  GAME_PLATFORMS,
  GAME_PLATFORM_UNSET_LABEL,
  GAME_STORES_LAUNCHERS,
  MUSIC_RELEASE_FORMATS,
  domainConfig,
  getDomainMeta,
  getMediaTypesForDomain,
  getStatusConfig,
  getWorkTypeLabel,
  normalizeDomainId,
  normalizeWorkTypeForDomain,
} from '../config/domainConfig';
import {
  CINEMA_API_SOURCES,
  CINEMA_SOURCE_PRESETS,
  enrichSeriesAndAnimeSeasons,
  enrichWorkWithExternalRatings,
  formatWorkStructureBadge,
  getCachedCinemaSearch,
  getDefaultSourcesForFilter,
  loadActiveCinemaSources,
  normalizeBrazilStreamingProviders,
  resolveCuratedSuggestions,
  saveActiveCinemaSources,
  searchCinemaMedia,
  searchMockCinema,
} from '../services/cinemaApi';
import {
  fetchMusicReleaseTracks,
  formatTrackDuration,
  getQuickSuggestionsForDomain,
  searchWorksByDomain,
} from '../services/multiDomainSearchService';
import { getPresentExternalRatingBadges } from '../lib/ratings';
import { workHasAnyExternalIds } from '../lib/ratings';
import { createUuid } from '../services/codiceDatabase';
import {
  calculateSmartRating,
  calculateWorkProgress,
  formatFlexibleProgressMetric,
  getDisplayTitles,
  getTodayLocalISO,
  getVerdictForScore,
  isEpisodicWork,
} from '../utils/backlogHelpers';
import { findDuplicateMatch } from '../utils/catalogImporters';
import {
  autoMapAtmosphereAndTags,
  buildPrefilledCatalogDraft,
} from '../utils/genreMapper';
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
    if (updated.domain === 'reading' && Number(updated.totalPages) > 0) {
      updated.pagesRead = Number(updated.totalPages);
    } else if (isEpisodicWork(updated)) {
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
    if (updated.reviewCriteria) {
      updated.rating = calculateSmartRating(updated.reviewCriteria);
      updated.verdict = getVerdictForScore(updated.rating);
      updated.ratingSource = updated.ratingSource || 'manual';
    } else if (typeof updated.rating === 'number' && !Number.isNaN(updated.rating)) {
      updated.verdict = updated.verdict || getVerdictForScore(updated.rating);
      updated.ratingSource = updated.ratingSource || 'manual';
    } else {
      updated.rating = null;
      updated.verdict = null;
      updated.ratingSource = null;
    }
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

function loadSavedSearchFilter(domain = 'cinema') {
  const cleanDomain = normalizeDomainId(domain);
  const validIds = ['all', ...getMediaTypesForDomain(cleanDomain).map((m) => m.id)];
  try {
    if (typeof localStorage === 'undefined') return 'all';
    const raw =
      cleanDomain === 'cinema'
        ? localStorage.getItem(SEARCH_FILTER_STORAGE_KEY)
        : localStorage.getItem(`${SEARCH_FILTER_STORAGE_KEY}_${cleanDomain}`);
    return validIds.includes(raw) ? raw : 'all';
  } catch {
    return 'all';
  }
}

export function AddScreen({
  items = [],
  geminiKey = '',
  tmdbKey = '',
  omdbKey = '',
  activeDomain = 'cinema',
  onSelectDomain,
  themeMode = 'dark',
  onAddItem,
  onUpdateItem,
  onSelectExisting,
  onOpenGeminiSettings,
  onOpenImportCatalog,
}) {
  const [internalDomain, setInternalDomain] = useState(() => normalizeDomainId(activeDomain));
  useEffect(() => {
    setInternalDomain(normalizeDomainId(activeDomain));
  }, [activeDomain]);
  const effectiveDomain = internalDomain;
  const domainMeta = useMemo(() => getDomainMeta(effectiveDomain), [effectiveDomain]);
  const domainMediaTypes = useMemo(
    () => getMediaTypesForDomain(effectiveDomain),
    [effectiveDomain]
  );

  const [query, setQuery] = useState('');
  const [searchFilter, setSearchFilter] = useState(() =>
    loadSavedSearchFilter(activeDomain)
  );
  const [activeSources, setActiveSources] = useState(() =>
    loadActiveCinemaSources(loadSavedSearchFilter('cinema'))
  );
  const [sourcesPopoverOpen, setSourcesPopoverOpen] = useState(false);
  const [results, setResults] = useState(() =>
    normalizeDomainId(activeDomain) === 'cinema'
      ? searchMockCinema('', loadSavedSearchFilter('cinema'))
      : []
  );
  const [isLoading, setIsLoading] = useState(false);
  const [enrichingCandidate, setEnrichingCandidate] = useState(false);

  const enrichAbortRef = useRef(null);
  const drawerOpenTokenRef = useRef(0);
  const enrichedDraftIdsRef = useRef(new Set());
  const oneShotSourcesRef = useRef(null);
  const [partialFailure, setPartialFailure] = useState(false);
  const [failedSourcesCount, setFailedSourcesCount] = useState(0);
  const [allFailed, setAllFailed] = useState(false);
  const [offlineNotice, setOfflineNotice] = useState(false);
  const [sourceStatusHint, setSourceStatusHint] = useState('');
  const [gameCardOverrides, setGameCardOverrides] = useState({});

  const [draftItem, setDraftItem] = useState(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualDraft, setManualDraft] = useState(null);

  const { ui, addFlowStatuses, mediaFormats, audioFormatTags } = domainConfig;
  const { add } = ui;
  const searchFilters = useMemo(
    () => [
      { id: 'all', label: 'Todos' },
      ...domainMediaTypes.map((m) => ({
        id: m.id,
        label: m.pluralLabel || m.label,
      })),
    ],
    [domainMediaTypes]
  );

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

  const findExisting = (candidate) => {
    const byId = backlogLookup.byId.get(candidate.id);
    if (byId) return byId;

    const candDomain = normalizeDomainId(candidate?.domain || effectiveDomain);
    // Em Games, permite catalogar Original e Remake/Remaster (ou anos diferentes) separadamente
    if (candDomain === 'games') {
      const candTitle = String(candidate?.title || '').trim().toLowerCase();
      const candOverride = gameCardOverrides[candidate.id] || {};
      const candEdition = String(
        candOverride.editionType || candidate?.editionType || 'Original'
      )
        .trim()
        .toLowerCase();
      const candYear = Number(candidate?.releaseYear) || null;
      return (
        items.find((item) => {
          if (!item || item.inBacklog === false) return false;
          if (normalizeDomainId(item.domain) !== 'games') return false;
          if (String(item.title || '').trim().toLowerCase() !== candTitle) return false;
          const itemEdition = String(item.editionType || 'Original').trim().toLowerCase();
          if (itemEdition !== candEdition) return false;
          const itemYear = Number(item.releaseYear) || null;
          if (candYear && itemYear && Math.abs(candYear - itemYear) >= 3) return false;
          return true;
        }) || null
      );
    }

    // Em Música, separa faixa individual de álbum homônimo
    if (candDomain === 'music') {
      const candTitle = String(candidate?.title || '').trim().toLowerCase();
      const candType = normalizeWorkTypeForDomain(candidate?.workType, 'music');
      const candCreator = String(candidate?.creator || candidate?.artist || '')
        .trim()
        .toLowerCase();
      return (
        items.find((item) => {
          if (!item || item.inBacklog === false) return false;
          if (normalizeDomainId(item.domain) !== 'music') return false;
          if (String(item.title || '').trim().toLowerCase() !== candTitle) return false;
          if (normalizeWorkTypeForDomain(item.workType, 'music') !== candType) return false;
          const itemCreator = String(item.creator || item.director || '')
            .trim()
            .toLowerCase();
          if (candCreator && itemCreator && candCreator !== itemCreator) return false;
          return true;
        }) || null
      );
    }

    return (
      backlogLookup.byTitle.get(candidate.title?.trim().toLowerCase()) ||
      findDuplicateMatch(candidate, items) ||
      null
    );
  };

  const quickSuggestions = useMemo(
    () => getQuickSuggestionsForDomain(effectiveDomain),
    [effectiveDomain]
  );

  const updateSearchFilter = useCallback(
    (nextFilter, domainArg = effectiveDomain) => {
      const cleanDomain = normalizeDomainId(domainArg);
      setSearchFilter(nextFilter);
      try {
        if (typeof localStorage !== 'undefined') {
          const storageKey =
            cleanDomain === 'cinema'
              ? SEARCH_FILTER_STORAGE_KEY
              : `${SEARCH_FILTER_STORAGE_KEY}_${cleanDomain}`;
          localStorage.setItem(storageKey, nextFilter);
        }
      } catch {
        // Ignora erro de storage
      }
    },
    [effectiveDomain]
  );

  const handleDomainSwitch = (nextDomain) => {
    const cleanNext = normalizeDomainId(nextDomain);
    if (cleanNext === effectiveDomain) return;
    searchAbortRef.current?.abort();
    enrichAbortRef.current?.abort();
    setInternalDomain(cleanNext);
    setSourcesPopoverOpen(false);
    setPartialFailure(false);
    setFailedSourcesCount(0);
    setAllFailed(false);
    setOfflineNotice(false);
    setSourceStatusHint('');
    setGameCardOverrides({});
    setResults(cleanNext === 'cinema' ? searchMockCinema('', 'all') : []);
    setSearchFilter('all');
    onSelectDomain?.(cleanNext);
  };

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
    updateSearchFilter(nextFilter, effectiveDomain);
    if (effectiveDomain === 'cinema') {
      updateSources(getDefaultSourcesForFilter(nextFilter));
    }
  };

  const executeSearch = useCallback(
    async (
      cleanQuery,
      filter,
      sources,
      { skipCache = false, domainOverride = effectiveDomain } = {}
    ) => {
      const targetDomain = normalizeDomainId(domainOverride);
      searchAbortRef.current?.abort();

      if (targetDomain !== 'cinema') {
        setOfflineNotice(false);
        setSourceStatusHint('');
        if (!cleanQuery || cleanQuery.length < 2) {
          setResults([]);
          setIsLoading(false);
          setPartialFailure(false);
          setFailedSourcesCount(0);
          setAllFailed(false);
          return;
        }

        const controller = new AbortController();
        searchAbortRef.current = controller;
        setIsLoading(true);
        setPartialFailure(false);
        setFailedSourcesCount(0);
        setAllFailed(false);

        try {
          const response = await searchWorksByDomain(targetDomain, cleanQuery, {
            signal: controller.signal,
            mediaTypeFilter: filter,
          });
          if (controller.signal.aborted) return;

          setResults(response.results || []);
          setOfflineNotice(Boolean(response.offline));
          setPartialFailure(Boolean(response.partialFailure));
          setFailedSourcesCount(response.partialFailure ? 1 : 0);
          setSourceStatusHint(String(response.sourceStatusHint || ''));
          setAllFailed(
            !response.offline && !response.ok && (response.results || []).length === 0
          );
        } catch (err) {
          if (err?.name === 'AbortError' || controller.signal.aborted) return;
          setResults([]);
          setAllFailed(true);
        } finally {
          if (!controller.signal.aborted) {
            setIsLoading(false);
          }
        }
        return;
      }

      if (!cleanQuery || cleanQuery.length < MIN_SEARCH_QUERY_LENGTH) {
        const mockList = searchMockCinema(cleanQuery, filter);
        setResults(mockList);
        setIsLoading(false);
        setPartialFailure(false);
        setFailedSourcesCount(0);
        setAllFailed(false);
        setOfflineNotice(false);
        resolveCuratedSuggestions(mockList, { tmdbApiKey: tmdbKey })
          .then((resolved) => {
            if (Array.isArray(resolved) && resolved.length > 0) {
              setResults((curr) =>
                curr.length === resolved.length &&
                curr.every((c, idx) => c.id === resolved[idx]?.id)
                  ? resolved
                  : curr
              );
            }
          })
          .catch(() => {});
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
      setOfflineNotice(false);

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
    [effectiveDomain, tmdbKey]
  );

  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    const clean = query.trim();
    const effectiveSources = oneShotSourcesRef.current || activeSources;
    oneShotSourcesRef.current = null;
    const minLen = effectiveDomain === 'cinema' ? MIN_SEARCH_QUERY_LENGTH : 2;

    if (!clean || clean.length < minLen) {
      executeSearch(clean, searchFilter, effectiveSources, {
        domainOverride: effectiveDomain,
      });
      return undefined;
    }

    debounceTimerRef.current = setTimeout(() => {
      executeSearch(clean, searchFilter, effectiveSources, {
        domainOverride: effectiveDomain,
      });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      searchAbortRef.current?.abort();
    };
  }, [query, searchFilter, activeSources, effectiveDomain, executeSearch]);

  const applyEnrichedFieldsToWork = (base, enriched) => {
    const nextSynopsis =
      String(enriched.synopsis ?? enriched.overview ?? '').length >
      String(base.synopsis ?? base.overview ?? '').length
        ? String(enriched.synopsis ?? enriched.overview ?? '').trim()
        : String(base.synopsis ?? base.overview ?? '').trim();
    const nextGenres =
      Array.isArray(enriched.genres) && enriched.genres.length > 0
        ? Array.from(new Set([...(base.genres || []), ...enriched.genres])).slice(0, 4)
        : base.genres || [];
    const autoMapped = autoMapAtmosphereAndTags({
      genres: nextGenres,
      synopsis: nextSynopsis,
      workType: base.workType,
    });
    const nextAtmosphere =
      Array.isArray(base.atmosphere) && base.atmosphere.length > 0
        ? base.atmosphere
        : autoMapped.atmosphere;
    const nextTropes =
      Array.isArray(base.tropes) && base.tropes.length > 0
        ? Array.from(new Set([...base.tropes, ...autoMapped.tropes])).slice(0, 5)
        : autoMapped.tropes;

    return {
      ...base,
      ids: enriched.ids || base.ids,
      tmdbId: enriched.tmdbId ?? base.tmdbId ?? null,
      imdbId: enriched.imdbId ?? base.imdbId ?? '',
      tvmazeId: enriched.tvmazeId ?? base.tvmazeId ?? null,
      anilistId: enriched.anilistId ?? base.anilistId ?? null,
      malId: enriched.malId ?? base.malId ?? null,
      tmdbMediaType: enriched.tmdbMediaType || base.tmdbMediaType || null,
      backdropUrl: enriched.backdropUrl || base.backdropUrl || null,
      externalRatings: enriched.externalRatings || base.externalRatings,
      belongsToCollection: enriched.belongsToCollection || base.belongsToCollection || null,
      tmdbStatus: enriched.tmdbStatus || base.tmdbStatus || null,
      showStatus: enriched.showStatus || base.showStatus || null,
      animeStatus: enriched.animeStatus || base.animeStatus || null,
      streamingProvidersBR: normalizeBrazilStreamingProviders(
        enriched.streamingProvidersBR || [],
        base.streamingProvidersBR || []
      ),
      franchiseName: base.franchiseName || enriched.franchiseName || '',
      franchiseRelations:
        Array.isArray(enriched.franchiseRelations) && enriched.franchiseRelations.length > 0
          ? enriched.franchiseRelations
          : base.franchiseRelations || [],
      director: base.director || enriched.director || '',
      author: base.director || enriched.director || '',
      studio: base.studio || enriched.studio || '',
      genres: nextGenres,
      atmosphere: nextAtmosphere,
      moods: nextAtmosphere,
      tropes: nextTropes,
      tags: nextTropes,
      totalSeasons: Math.max(
        Number(base.totalSeasons) || 1,
        Number(enriched.totalSeasons) || 1
      ),
      totalEpisodes: enriched.totalEpisodes || base.totalEpisodes,
      episodesPerSeason:
        Array.isArray(enriched.episodesPerSeason) && enriched.episodesPerSeason.length > 0
          ? enriched.episodesPerSeason
          : base.episodesPerSeason,
      episodeList: enriched.episodeList || base.episodeList,
      episodeDurationMinutes:
        enriched.episodeDurationMinutes || base.episodeDurationMinutes,
      durationMinutes: enriched.durationMinutes || base.durationMinutes,
      totalSeconds:
        enriched.durationMinutes && base.workType === 'movie'
          ? enriched.durationMinutes * 60
          : base.totalSeconds,
      synopsis: nextSynopsis,
      overview: nextSynopsis,
    };
  };

  const handleOpenCandidateDrawer = async (candidate) => {
    enrichAbortRef.current?.abort();
    const openToken = ++drawerOpenTokenRef.current;
    const controller = new AbortController();
    enrichAbortRef.current = controller;

    const candDomain = normalizeDomainId(candidate?.domain || effectiveDomain);

    if (candDomain !== 'cinema') {
      const cardOverride = gameCardOverrides[candidate?.id] || {};
      const normalizedType = normalizeWorkTypeForDomain(candidate?.workType, candDomain);
      const draftId = candidate?.id || createUuid();
      const creatorName = String(candidate?.creator || candidate?.director || candidate?.artist || '').trim();
      const genres = Array.isArray(candidate?.genres) ? candidate.genres.slice(0, 4) : [];
      const resolvedPlatform =
        candDomain === 'games'
          ? String(
              cardOverride.platform !== undefined ? cardOverride.platform : candidate?.platform || ''
            ).trim()
          : '';
      const resolvedEdition =
        candDomain === 'games'
          ? String(cardOverride.editionType || candidate?.editionType || 'Original').trim()
          : '';
      const baseDomainDraft = buildDraftWithStatus(
        {
          id: draftId,
          domain: candDomain,
          workType: normalizedType,
          title: String(candidate?.title || '').trim(),
          originalTitle: String(candidate?.originalTitle || '').trim(),
          creator: creatorName,
          director: creatorName,
          author: creatorName,
          studio: candDomain === 'games' ? creatorName : '',
          releaseYear: candidate?.releaseYear || null,
          coverUrl: candidate?.coverUrl || null,
          coverSources: Array.isArray(candidate?.coverSources)
            ? candidate.coverSources
            : candidate?.coverUrl
              ? [candidate.coverUrl]
              : [],
          synopsis: String(candidate?.synopsis || '').trim(),
          overview: String(candidate?.synopsis || '').trim(),
          genres,
          ids: candidate?.ids || {},
          rating: null,
          ratingSource: null,
          verdict: null,
          language: String(candidate?.language || '').trim(),
          pagesRead: Number(candidate?.pagesRead) || 0,
          totalPages: Number(candidate?.totalPages) > 0 ? Number(candidate.totalPages) : null,
          chaptersRead: Number(candidate?.chaptersRead) || 0,
          isbnOrDoi: String(candidate?.isbnOrDoi || '').trim(),
          bookFormat: candidate?.bookFormat || BOOK_FORMATS[0],
          favoriteScene: String(candidate?.favoriteScene || '').trim(),
          // Games: preserva plataformas reais da API sem assumir PC / Steam
          platform: resolvedPlatform,
          platforms: Array.isArray(candidate?.platforms) ? candidate.platforms : [],
          editionType: resolvedEdition,
          gameRating11: null,
          masterpieceJustification: '',
          hoursPlayed: Number(candidate?.hoursPlayed) || 0,
          completionType: candidate?.completionType || GAME_COMPLETION_TYPES[0],
          storeOrLauncher: String(candidate?.storeOrLauncher || '').trim(),
          buildOrCharacter: String(candidate?.buildOrCharacter || '').trim(),
          // Música: suporta faixa individual (albumName, durationMs, nota 0-10) e álbum completo
          albumName: String(candidate?.albumName || '').trim(),
          durationMs: Number(candidate?.durationMs) > 0 ? Number(candidate.durationMs) : null,
          trackRating10: null,
          favoriteTrack: String(candidate?.favoriteTrack || '').trim(),
          subgenre: String(candidate?.subgenre || '').trim(),
          releaseFormat:
            candidate?.releaseFormat ||
            (normalizedType === 'track' ? 'Faixa Individual' : MUSIC_RELEASE_FORMATS[0]),
          listenCount: Number(candidate?.listenCount) || 0,
          tracks: Array.isArray(candidate?.tracks) ? candidate.tracks : [],
          trackCount: Number(candidate?.trackCount) || null,
          atmosphere: [],
          tropes: [],
          tags: [],
          monogram: createMonogram(candidate?.title),
          inBacklog: true,
        },
        add.defaultNewStatus
      );
      setDraftItem(baseDomainDraft);

      if (
        candDomain === 'music' &&
        normalizedType !== 'track' &&
        normalizedType !== 'discography' &&
        (!Array.isArray(baseDomainDraft.tracks) || baseDomainDraft.tracks.length === 0)
      ) {
        setEnrichingCandidate(true);
        fetchMusicReleaseTracks(candidate, { signal: controller.signal })
          .then((tracks) => {
            if (controller.signal.aborted || drawerOpenTokenRef.current !== openToken) return;
            if (Array.isArray(tracks) && tracks.length > 0) {
              setDraftItem((curr) =>
                curr && curr.id === draftId ? { ...curr, tracks } : curr
              );
            }
          })
          .catch(() => {})
          .finally(() => {
            if (!controller.signal.aborted && drawerOpenTokenRef.current === openToken) {
              setEnrichingCandidate(false);
            }
          });
      }
      return;
    }

    // Reseta explicitamente rascunho anterior e constrói cópia limpa 100% isolada (Defeito A)
    const draftBase = buildPrefilledCatalogDraft(candidate, {
      defaultFormat: mediaFormats[0],
      defaultAudioFormat: candidate.workType === 'anime' ? 'Legendado' : audioFormatTags[0],
    });
    const draftId = draftBase.id || candidate.id || createUuid();
    const initialDraft = buildDraftWithStatus(
      {
        ...draftBase,
        domain: 'cinema',
        id: draftId,
        format: mediaFormats[0],
        audioFormat: candidate.workType === 'anime' ? 'Legendado' : audioFormatTags[0],
      },
      add.defaultNewStatus
    );
    setDraftItem(initialDraft);

    const needsSeasonLookup =
      initialDraft.workType === 'series' || initialDraft.workType === 'anime';

    if (workHasAnyExternalIds(initialDraft) || needsSeasonLookup) {
      setEnrichingCandidate(true);
      try {
        const [enrichRes, seasonRes] = await Promise.all([
          workHasAnyExternalIds(initialDraft)
            ? enrichWorkWithExternalRatings(initialDraft, {
                tmdbApiKey: tmdbKey,
                omdbApiKey: omdbKey,
                signal: controller.signal,
                maxConcurrency: 2,
              }).catch(() => null)
            : Promise.resolve(null),
          needsSeasonLookup && Number(initialDraft.totalSeasons || 1) <= 1
            ? enrichSeriesAndAnimeSeasons(initialDraft, {
                tmdbApiKey: tmdbKey,
                signal: controller.signal,
              }).catch(() => null)
            : Promise.resolve(null),
        ]);

        if (controller.signal.aborted || drawerOpenTokenRef.current !== openToken) {
          return;
        }
        enrichedDraftIdsRef.current.add(draftId);
        setDraftItem((curr) => {
          if (!curr || curr.id !== draftId) return curr;
          let updated = enrichRes?.work ? applyEnrichedFieldsToWork(curr, enrichRes.work) : curr;
          if (seasonRes) {
            updated = applyEnrichedFieldsToWork(updated, seasonRes);
          }
          return updated;
        });
      } catch {
        // Mantém rascunho inicial sem travar
      } finally {
        if (!controller.signal.aborted && drawerOpenTokenRef.current === openToken) {
          setEnrichingCandidate(false);
        }
      }
    }
  };

  const handleSaveDraft = () => {
    if (!draftItem) return;
    enrichAbortRef.current?.abort();
    const draftDomain = normalizeDomainId(draftItem.domain || effectiveDomain);
    const finalDraft = {
      ...draftItem,
      domain: draftDomain,
      id: draftItem.id || createUuid(),
      creator:
        draftItem.creator || draftItem.director || draftItem.author || draftItem.studio || '',
    };
    const alreadyEnriched = enrichedDraftIdsRef.current.has(finalDraft.id);
    onAddItem(finalDraft);
    setDraftItem(null);

    if (
      draftDomain === 'cinema' &&
      !alreadyEnriched &&
      onUpdateItem &&
      (workHasAnyExternalIds(finalDraft) || isEpisodicWork(finalDraft))
    ) {
      Promise.all([
        workHasAnyExternalIds(finalDraft)
          ? enrichWorkWithExternalRatings(finalDraft, {
              tmdbApiKey: tmdbKey,
              omdbApiKey: omdbKey,
              maxConcurrency: 2,
            }).catch(() => null)
          : Promise.resolve(null),
        isEpisodicWork(finalDraft) && Number(finalDraft.totalSeasons || 1) <= 1
          ? enrichSeriesAndAnimeSeasons(finalDraft, { tmdbApiKey: tmdbKey }).catch(() => null)
          : Promise.resolve(null),
      ])
        .then(([res, seasonRes]) => {
          if (!res?.work && !seasonRes) return;
          let patched = res?.work ? applyEnrichedFieldsToWork(finalDraft, res.work) : finalDraft;
          if (seasonRes) patched = applyEnrichedFieldsToWork(patched, seasonRes);
          onUpdateItem(finalDraft.id, {
            ids: patched.ids,
            tmdbId: patched.tmdbId,
            imdbId: patched.imdbId,
            tvmazeId: patched.tvmazeId,
            anilistId: patched.anilistId,
            malId: patched.malId,
            tmdbMediaType: patched.tmdbMediaType,
            backdropUrl: patched.backdropUrl,
            externalRatings: patched.externalRatings,
            belongsToCollection: patched.belongsToCollection,
            tmdbStatus: patched.tmdbStatus,
            franchiseName: patched.franchiseName,
            franchiseRelations: patched.franchiseRelations,
            director: patched.director,
            studio: patched.studio,
            genres: patched.genres,
            atmosphere: patched.atmosphere,
            moods: patched.moods,
            tropes: patched.tropes,
            tags: patched.tags,
            totalSeasons: patched.totalSeasons,
            totalEpisodes: patched.totalEpisodes,
            episodesPerSeason: patched.episodesPerSeason,
            episodeList: patched.episodeList,
            episodeDurationMinutes: patched.episodeDurationMinutes,
            durationMinutes: patched.durationMinutes,
            totalSeconds: patched.totalSeconds,
            synopsis: patched.synopsis,
            overview: patched.overview,
          });
        })
        .catch(() => {});
    }
  };

  const handleOpenManualModal = () => {
    const validTypes = domainMediaTypes.map((m) => m.id);
    const defaultType =
      searchFilter !== 'all' && validTypes.includes(searchFilter)
        ? searchFilter
        : validTypes[0] || 'movie';
    const cleanTitle = query.trim();
    setManualDraft(
      buildDraftWithStatus(
        {
          id: createUuid(),
          domain: effectiveDomain,
          workType: defaultType,
          title: cleanTitle,
          originalTitle: '',
          creator: '',
          director: '',
          author: '',
          studio: '',
          franchiseName: '',
          releaseYear: domainConfig.currentYear,
          coverUrl: '',
          durationMinutes: defaultType === 'movie' ? 120 : null,
          totalSeconds: defaultType === 'movie' ? 7200 : null,
          currentSeconds: 0,
          totalSeasons: defaultType === 'movie' ? 1 : 1,
          currentSeason: 1,
          totalEpisodes: defaultType === 'movie' ? null : 12,
          currentEpisode: 0,
          episodeDurationMinutes: defaultType === 'anime' ? 24 : 45,
          pagesRead: 0,
          totalPages: effectiveDomain === 'reading' ? 280 : null,
          chaptersRead: 0,
          isbnOrDoi: '',
          bookFormat: BOOK_FORMATS[0],
          favoriteScene: '',
          platform: '',
          platforms: [],
          editionType: GAME_EDITION_TYPES[0],
          gameRating11: null,
          masterpieceJustification: '',
          hoursPlayed: 0,
          completionType: GAME_COMPLETION_TYPES[0],
          storeOrLauncher: '',
          buildOrCharacter: '',
          albumName: '',
          durationMs: null,
          trackRating10: null,
          favoriteTrack: '',
          subgenre: '',
          releaseFormat:
            defaultType === 'track' ? 'Faixa Individual' : MUSIC_RELEASE_FORMATS[0],
          listenCount: 0,
          tracks: [],
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
    const targetDomain = normalizeDomainId(manualDraft.domain || effectiveDomain);
    const durationMin = Number(manualDraft.durationMinutes) || null;
    const creatorName = String(manualDraft.director || manualDraft.creator || '').trim();
    const cleanCoverUrl = String(manualDraft.coverUrl || '').trim() || null;
    const payload = {
      ...manualDraft,
      domain: targetDomain,
      workType: normalizeWorkTypeForDomain(manualDraft.workType, targetDomain),
      title,
      creator: creatorName,
      director: creatorName,
      author: creatorName,
      studio: String(manualDraft.studio || (targetDomain === 'games' ? creatorName : '')).trim(),
      franchiseName: String(manualDraft.franchiseName || '').trim(),
      coverUrl: cleanCoverUrl,
      coverSources: cleanCoverUrl ? [cleanCoverUrl] : [],
      totalSeconds:
        targetDomain === 'cinema' && manualDraft.workType === 'movie' && durationMin
          ? durationMin * 60
          : null,
      pagesRead: Math.max(0, Number(manualDraft.pagesRead) || 0),
      totalPages: Number(manualDraft.totalPages) > 0 ? Number(manualDraft.totalPages) : null,
      chaptersRead: Math.max(0, Number(manualDraft.chaptersRead) || 0),
      hoursPlayed: Math.max(0, Number(manualDraft.hoursPlayed) || 0),
      listenCount: Math.max(0, Number(manualDraft.listenCount) || 0),
      genres,
      monogram: createMonogram(title),
      palette: null,
      inBacklog: true,
    };
    delete payload.genresText;
    onAddItem(payload);
    setManualOpen(false);
    setManualDraft(null);
  };

  const searchPlaceholder =
    effectiveDomain === 'reading'
      ? 'Buscar livros, mangás, autores ou ISBN...'
      : effectiveDomain === 'games'
        ? 'Buscar jogos, remakes, DLCs ou plataformas...'
        : effectiveDomain === 'music'
          ? 'Buscar faixas, álbuns, EPs, artistas ou shows...'
          : add.searchPlaceholder;

  const domainApiHint =
    effectiveDomain === 'reading'
      ? 'Open Library · Google Books'
      : effectiveDomain === 'games'
        ? 'CheapShark · FreeToGame · Wikidata'
        : effectiveDomain === 'music'
          ? 'iTunes · MusicBrainz'
          : '';

  const EmptyDomainIcon =
    effectiveDomain === 'reading'
      ? BookOpen
      : effectiveDomain === 'games'
        ? Gamepad2
        : effectiveDomain === 'music'
          ? Music
          : Film;

  const draftDomain = draftItem
    ? normalizeDomainId(draftItem.domain || effectiveDomain)
    : effectiveDomain;
  const draftDomainMeta = getDomainMeta(draftDomain);
  const manualDomain = manualDraft
    ? normalizeDomainId(manualDraft.domain || effectiveDomain)
    : effectiveDomain;
  const manualDomainMeta = getDomainMeta(manualDomain);

  return (
    <div className="space-y-4 pb-24">
      <header className="flex flex-wrap items-start justify-between gap-2 pt-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">
            {add.title}
          </h1>
          <p className="mt-0.5 text-xs text-subtle">
            {domainMeta.label} · {domainMeta.description}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {onOpenImportCatalog && effectiveDomain === 'cinema' && (
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

      <DomainSwitcherBar
        compact
        activeDomain={effectiveDomain}
        onSelectDomain={handleDomainSwitch}
        items={items}
        themeMode={themeMode}
      />

      {/* Barra de Busca + Fontes / APIs do Domínio */}
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
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="min-h-[46px] w-full rounded-[6px] border border-line bg-card py-2 pl-9 pr-10 text-sm text-ink placeholder:text-subtle focus:border-accent focus:outline-none [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
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

          {effectiveDomain === 'cinema' ? (
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
          ) : (
            <span className="hidden sm:inline-flex min-h-[46px] shrink-0 items-center rounded-[6px] border border-line bg-card px-3 text-[11px] font-medium text-muted">
              {domainApiHint}
            </span>
          )}
        </div>

        {sourcesPopoverOpen && effectiveDomain === 'cinema' && (
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
                oneShotSourcesRef.current = sug.sources?.length ? sug.sources : null;
                updateSearchFilter(sug.filter || 'all', effectiveDomain);
                setQuery(sug.query);
              }}
              className="min-h-[36px] shrink-0 rounded-[4px] border border-line bg-card px-2.5 text-[11px] font-medium text-muted hover:border-accent hover:text-ink"
            >
              {sug.label}
            </button>
          ))}
        </div>
      )}

      {offlineNotice && (
        <div
          role="status"
          className="flex items-center justify-between gap-2 rounded-[4px] border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-ink"
        >
          <span>
            Modo offline detectado — faça o cadastro manual instantâneo ou tente quando reconectar.
          </span>
          <button
            type="button"
            onClick={handleOpenManualModal}
            className="inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-[4px] bg-accent px-2.5 text-[11px] font-semibold text-accent-ink"
          >
            Cadastro Manual
          </button>
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
            Cinematógrafo calibrado. Seu catálogo privada está pronta para novas projeções.
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
          <EmptyDomainIcon className="mx-auto h-6 w-6 text-accent" strokeWidth={1.5} />
          <p className="text-xs font-semibold text-ink">
            {effectiveDomain !== 'cinema' && query.trim().length < 2
              ? `Explore o catálogo aberto de ${domainMeta.label}`
              : add.emptySearchTitle}
          </p>
          <p className="text-[11px] text-muted">
            {effectiveDomain !== 'cinema' && query.trim().length < 2
              ? `Digite ao menos 2 caracteres (APIs: ${domainApiHint}) ou use uma sugestão acima.`
              : add.emptySearchDescription}
          </p>
          <button
            type="button"
            onClick={handleOpenManualModal}
            className="min-h-[44px] rounded-[4px] border border-accent bg-accent/10 px-4 text-xs font-semibold text-accent hover:bg-accent hover:text-accent-ink"
          >
            {add.manualButtonLabel} ({domainMeta.shortLabel})
          </button>
        </div>
      ) : (
        <section aria-label={add.resultsLabel} className="space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-subtle tabular-nums">
            <span>
              {query.trim() ? add.resultsLabel : add.suggestionsLabel} ({results.length})
            </span>
            {effectiveDomain !== 'cinema' && sourceStatusHint && (
              <span
                data-testid="domain-source-hint"
                className="rounded-[3px] border border-line bg-card px-2 py-0.5 text-[10px] font-medium text-muted"
              >
                {sourceStatusHint}
              </span>
            )}
          </div>

          <div className="space-y-2.5">
            {results.map((candidate) => {
              const existing = findExisting(candidate);
              const titles = getDisplayTitles(candidate, 'bilingual');
              const candDomain = normalizeDomainId(candidate.domain || effectiveDomain);
              const workLabel = getWorkTypeLabel(candidate, candDomain);
              const cardOverride = gameCardOverrides[candidate.id] || {};
              const activeGamePlatform =
                cardOverride.platform !== undefined
                  ? cardOverride.platform
                  : candidate.platform || '';
              const activeGameEdition =
                cardOverride.editionType || candidate.editionType || GAME_EDITION_TYPES[0];
              const apiPlatforms = Array.isArray(candidate.platforms)
                ? candidate.platforms.filter(Boolean)
                : [];
              const domainMetric =
                candDomain === 'reading'
                  ? candidate.totalPages
                    ? `${candidate.totalPages} págs`
                    : ''
                  : candDomain === 'games'
                    ? [
                        apiPlatforms.length > 0
                          ? apiPlatforms.slice(0, 3).join(' / ')
                          : activeGamePlatform || GAME_PLATFORM_UNSET_LABEL,
                        candidate.storeOrLauncher || '',
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    : candDomain === 'music'
                      ? candidate.workType === 'track'
                        ? [
                            candidate.albumName ? `Álbum: ${candidate.albumName}` : '',
                            candidate.durationLabel || formatTrackDuration(candidate.durationMs),
                            candidate.subgenre,
                          ]
                            .filter(Boolean)
                            .join(' · ')
                        : [
                            candidate.subgenre,
                            candidate.trackCount ? `${candidate.trackCount} faixas` : '',
                          ]
                            .filter(Boolean)
                            .join(' · ')
                      : isEpisodicWork(candidate)
                        ? candidate.totalEpisodes
                          ? `${candidate.totalEpisodes} eps`
                          : ''
                        : candidate.durationMinutes
                          ? `${candidate.durationMinutes} min`
                          : '';
              const metaLine = [
                workLabel,
                candidate.creator || candidate.director || candidate.studio,
                candidate.releaseYear,
                domainMetric,
              ]
                .filter(Boolean)
                .join(' · ');

              const badges = Array.isArray(candidate.mergedSources) && candidate.mergedSources.length > 0
                ? candidate.mergedSources
                : candidate.sourceBadge
                  ? [candidate.sourceBadge]
                  : [];
              const searchRatings = getPresentExternalRatingBadges(
                candidate.externalRatings
              ).slice(0, 2);
              const structureBadge = formatWorkStructureBadge(candidate);
              const streamingBR = Array.isArray(candidate.streamingProvidersBR)
                ? candidate.streamingProvidersBR
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
                        {candDomain === 'games' && (
                          <span className="rounded-[3px] border border-accent/45 bg-accent/15 px-1.5 py-0.5 text-[9px] font-semibold text-accent">
                            {activeGameEdition}
                          </span>
                        )}
                        {searchRatings.map((rb) => (
                          <span
                            key={rb.id}
                            className="rounded-[3px] border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-accent"
                          >
                            {rb.displayText}
                          </span>
                        ))}
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

                    {candDomain === 'games' && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        <select
                          aria-label={`Plataforma jogada de ${candidate.title}`}
                          value={activeGamePlatform}
                          onChange={(e) =>
                            setGameCardOverrides((curr) => ({
                              ...curr,
                              [candidate.id]: {
                                ...(curr[candidate.id] || {}),
                                platform: e.target.value,
                              },
                            }))
                          }
                          className="min-h-[32px] rounded-[4px] border border-line bg-app px-2 text-[10px] font-medium text-ink focus:border-accent focus:outline-none"
                        >
                          <option value="">{GAME_PLATFORM_UNSET_LABEL}</option>
                          {Array.from(new Set([...apiPlatforms, ...GAME_PLATFORMS])).map((plat) => (
                            <option key={plat} value={plat}>
                              {plat}
                            </option>
                          ))}
                        </select>
                        <select
                          aria-label={`Tipo de edição de ${candidate.title}`}
                          value={activeGameEdition}
                          onChange={(e) =>
                            setGameCardOverrides((curr) => ({
                              ...curr,
                              [candidate.id]: {
                                ...(curr[candidate.id] || {}),
                                editionType: e.target.value,
                              },
                            }))
                          }
                          className="min-h-[32px] rounded-[4px] border border-line bg-app px-2 text-[10px] font-medium text-ink focus:border-accent focus:outline-none"
                        >
                          {GAME_EDITION_TYPES.map((ed) => (
                            <option key={ed} value={ed}>
                              {ed}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <div className="flex flex-wrap gap-1">
                        {structureBadge && (
                          <span className="rounded-[3px] border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-accent">
                            {structureBadge}
                          </span>
                        )}
                        {streamingBR.map((provider) => (
                          <span
                            key={provider}
                            className="rounded-[3px] border border-line bg-elevated px-1.5 py-0.5 text-[10px] font-semibold text-ink"
                          >
                            {provider}
                          </span>
                        ))}
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
                          className="inline-flex min-h-[44px] items-center gap-1 rounded-[4px] border border-line bg-app px-3 text-xs font-medium text-accent hover:border-accent"
                        >
                          <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
                          <span>{add.inListBadge}</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleOpenCandidateDrawer(candidate)}
                          className="inline-flex min-h-[44px] items-center gap-1 rounded-[4px] bg-accent px-3.5 text-xs font-semibold text-accent-ink hover:opacity-90"
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
          key={`draft-drawer-${draftItem.id}`}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 sm:items-center sm:p-4"
          onClick={() => {
            enrichAbortRef.current?.abort();
            setDraftItem(null);
          }}
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
                    {enrichingCandidate ? ' · Buscando detalhes...' : ''}
                  </p>
                  <h2 className="mt-0.5 line-clamp-2 text-sm font-semibold text-ink">
                    {draftItem.title}
                  </h2>
                  {draftItem.originalTitle &&
                    draftItem.originalTitle.toLowerCase() !==
                      String(draftItem.title || '').toLowerCase() && (
                      <p className="truncate text-[10px] italic text-subtle">
                        Original: {draftItem.originalTitle}
                      </p>
                    )}
                  <p className="mt-0.5 text-[11px] tabular-nums text-muted">
                    {[
                      draftItem.creator || draftItem.director || draftItem.studio,
                      draftItem.releaseYear,
                      formatFlexibleProgressMetric(draftItem) ||
                        (draftDomain === 'cinema' && isEpisodicWork(draftItem)
                          ? `${Math.max(1, Number(draftItem.totalSeasons) || 1)} temp.${
                              draftItem.totalEpisodes ? ` · ${draftItem.totalEpisodes} eps` : ''
                            }`
                          : draftDomain === 'cinema' && draftItem.durationMinutes
                            ? `${draftItem.durationMinutes} min`
                            : null),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  enrichAbortRef.current?.abort();
                  setDraftItem(null);
                }}
                aria-label={add.drawerCancelLabel}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[4px] text-muted hover:text-ink"
              >
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>

            {/* Estrutura e Streaming BR antes de Salvar */}
            {draftDomain === 'cinema' && (
              <div className="flex flex-wrap items-center gap-1.5">
                {formatWorkStructureBadge(draftItem) && (
                  <span className="rounded-[4px] border border-accent/40 bg-accent/15 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-accent">
                    {formatWorkStructureBadge(draftItem)}
                  </span>
                )}
                {Array.isArray(draftItem.streamingProvidersBR) &&
                  draftItem.streamingProvidersBR.map((provider) => (
                    <span
                      key={provider}
                      className="rounded-[4px] border border-line bg-app px-2 py-0.5 text-[11px] font-semibold text-ink"
                    >
                      BR · {provider}
                    </span>
                  ))}
              </div>
            )}

            {Array.isArray(draftItem.genres) && draftItem.genres.length > 0 && (
              <div className="space-y-1.5 rounded-[6px] border border-line bg-app p-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-subtle">
                  Gêneros Oficiais (API)
                </p>
                <div className="flex flex-wrap gap-1">
                  {draftItem.genres.map((g) => (
                    <span
                      key={g}
                      className="rounded-[4px] border border-line bg-card px-2 py-0.5 text-[11px] font-medium text-ink"
                    >
                      {g}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {draftItem.synopsis && (
              <p className="line-clamp-3 rounded-xl border border-line bg-app px-3 py-2 text-xs leading-relaxed text-muted">
                {draftItem.synopsis}
              </p>
            )}

            <WorkTypeSelector
              key={`wt-${draftItem.id}-${draftDomain}`}
              domain={draftDomain}
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

            {draftDomain === 'cinema' ? (
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
            ) : draftDomain === 'reading' ? (
              <div className="space-y-3 rounded-[6px] border border-line bg-app p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-accent">
                  Dados de {draftDomainMeta.shortLabel}
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-[11px] text-muted">Págs lidas</span>
                    <input
                      type="number"
                      min="0"
                      value={draftItem.pagesRead ?? 0}
                      onChange={(e) =>
                        setDraftItem((curr) => ({
                          ...curr,
                          pagesRead: Math.max(0, Number(e.target.value) || 0),
                        }))
                      }
                      className="min-h-[40px] w-full rounded-[4px] border border-line bg-card px-2.5 text-xs tabular-nums text-ink focus:border-accent focus:outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] text-muted">Total págs</span>
                    <input
                      type="number"
                      min="1"
                      value={draftItem.totalPages || ''}
                      onChange={(e) =>
                        setDraftItem((curr) => ({
                          ...curr,
                          totalPages: e.target.value ? Number(e.target.value) : null,
                        }))
                      }
                      placeholder="340"
                      className="min-h-[40px] w-full rounded-[4px] border border-line bg-card px-2.5 text-xs tabular-nums text-ink focus:border-accent focus:outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] text-muted">Capítulos</span>
                    <input
                      type="number"
                      min="0"
                      value={draftItem.chaptersRead ?? 0}
                      onChange={(e) =>
                        setDraftItem((curr) => ({
                          ...curr,
                          chaptersRead: Math.max(0, Number(e.target.value) || 0),
                        }))
                      }
                      className="min-h-[40px] w-full rounded-[4px] border border-line bg-card px-2.5 text-xs tabular-nums text-ink focus:border-accent focus:outline-none"
                    />
                  </label>
                </div>

                <div>
                  <span className="mb-1 block text-[11px] text-muted">Formato</span>
                  <div className="flex flex-wrap gap-1.5">
                    {BOOK_FORMATS.map((fmt) => (
                      <button
                        key={fmt}
                        type="button"
                        onClick={() => setDraftItem((curr) => ({ ...curr, bookFormat: fmt }))}
                        className={`min-h-[36px] rounded-[4px] border px-2.5 text-[11px] font-medium ${
                          draftItem.bookFormat === fmt
                            ? 'border-accent bg-accent/15 text-ink'
                            : 'border-line bg-card text-muted'
                        }`}
                      >
                        {fmt}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="block">
                  <span className="mb-1 block text-[11px] text-muted">
                    Título Original (opcional)
                  </span>
                  <input
                    type="text"
                    value={draftItem.originalTitle || ''}
                    onChange={(e) =>
                      setDraftItem((curr) => ({ ...curr, originalTitle: e.target.value }))
                    }
                    placeholder="Ex: Die Verwandlung / Metamorphosis"
                    className="min-h-[40px] w-full rounded-[4px] border border-line bg-card px-2.5 text-xs text-ink focus:border-accent focus:outline-none"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-[11px] text-muted">ISBN / DOI</span>
                  <input
                    type="text"
                    value={draftItem.isbnOrDoi || ''}
                    onChange={(e) =>
                      setDraftItem((curr) => ({ ...curr, isbnOrDoi: e.target.value }))
                    }
                    placeholder="Ex: 978-0-14-044913-6 ou 10.1145/..."
                    className="min-h-[40px] w-full rounded-[4px] border border-line bg-card px-2.5 text-xs text-ink focus:border-accent focus:outline-none"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-[11px] text-muted">Citação marcante</span>
                  <input
                    type="text"
                    value={draftItem.favoriteScene || ''}
                    onChange={(e) =>
                      setDraftItem((curr) => ({ ...curr, favoriteScene: e.target.value }))
                    }
                    placeholder="Trecho ou passagem favorita..."
                    className="min-h-[40px] w-full rounded-[4px] border border-line bg-card px-2.5 text-xs text-ink focus:border-accent focus:outline-none"
                  />
                </label>
              </div>
            ) : draftDomain === 'games' ? (
              <div className="space-y-3 rounded-[6px] border border-line bg-app p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-accent">
                  Dados de {draftDomainMeta.shortLabel}
                </p>

                <div>
                  <span className="mb-1 block text-[11px] text-muted">Tipo de Edição</span>
                  <div className="flex flex-wrap gap-1">
                    {GAME_EDITION_TYPES.map((ed) => (
                      <button
                        key={ed}
                        type="button"
                        onClick={() => setDraftItem((curr) => ({ ...curr, editionType: ed }))}
                        className={`min-h-[34px] rounded-[4px] border px-2 text-[11px] font-medium ${
                          (draftItem.editionType || GAME_EDITION_TYPES[0]) === ed
                            ? 'border-accent bg-accent/15 text-ink'
                            : 'border-line bg-card text-muted'
                        }`}
                      >
                        {ed}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-muted">Plataforma Jogada</span>
                    {Array.isArray(draftItem.platforms) && draftItem.platforms.length > 0 && (
                      <span className="text-[10px] text-subtle">
                        API: {draftItem.platforms.join(', ')}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      onClick={() => setDraftItem((curr) => ({ ...curr, platform: '' }))}
                      className={`min-h-[34px] rounded-[4px] border px-2 text-[11px] font-medium ${
                        !draftItem.platform
                          ? 'border-accent bg-accent/15 text-ink'
                          : 'border-line bg-card text-muted'
                      }`}
                    >
                      A definir
                    </button>
                    {Array.from(
                      new Set([...(draftItem.platforms || []), ...GAME_PLATFORMS])
                    ).map((plat) => (
                      <button
                        key={plat}
                        type="button"
                        onClick={() => setDraftItem((curr) => ({ ...curr, platform: plat }))}
                        className={`min-h-[34px] rounded-[4px] border px-2 text-[11px] font-medium ${
                          draftItem.platform === plat
                            ? 'border-accent bg-accent/15 text-ink'
                            : 'border-line bg-card text-muted'
                        }`}
                      >
                        {plat}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-[11px] text-muted">Horas jogadas</span>
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      value={draftItem.hoursPlayed ?? 0}
                      onChange={(e) =>
                        setDraftItem((curr) => ({
                          ...curr,
                          hoursPlayed: Math.max(0, Number(e.target.value) || 0),
                        }))
                      }
                      className="min-h-[40px] w-full rounded-[4px] border border-line bg-card px-2.5 text-xs tabular-nums text-ink focus:border-accent focus:outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] text-muted">Loja / Launcher</span>
                    <select
                      value={draftItem.storeOrLauncher || ''}
                      onChange={(e) =>
                        setDraftItem((curr) => ({
                          ...curr,
                          storeOrLauncher: e.target.value,
                        }))
                      }
                      className="min-h-[40px] w-full rounded-[4px] border border-line bg-card px-2 text-xs text-ink focus:border-accent focus:outline-none"
                    >
                      <option value="">A definir</option>
                      {GAME_STORES_LAUNCHERS.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div>
                  <span className="mb-1 block text-[11px] text-muted">Meta de conclusão</span>
                  <div className="flex flex-wrap gap-1">
                    {GAME_COMPLETION_TYPES.map((ct) => (
                      <button
                        key={ct}
                        type="button"
                        onClick={() =>
                          setDraftItem((curr) => ({ ...curr, completionType: ct }))
                        }
                        className={`min-h-[34px] rounded-[4px] border px-2 text-[11px] font-medium ${
                          draftItem.completionType === ct
                            ? 'border-accent bg-accent/15 text-ink'
                            : 'border-line bg-card text-muted'
                        }`}
                      >
                        {ct}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-muted">Nota (0 a 11 · 11 = Obra-Prima)</span>
                    <span className="text-[11px] font-semibold tabular-nums text-accent">
                      {draftItem.gameRating11 !== null && draftItem.gameRating11 !== undefined
                        ? `${draftItem.gameRating11}/11`
                        : 'Sem nota'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => {
                      const active = draftItem.gameRating11 === n;
                      return (
                        <button
                          key={n}
                          type="button"
                          onClick={() =>
                            setDraftItem((curr) => ({
                              ...curr,
                              gameRating11: curr.gameRating11 === n ? null : n,
                              rating:
                                curr.gameRating11 === n ? null : Math.min(100, Math.round(n * 10)),
                              ratingSource: curr.gameRating11 === n ? null : 'manual',
                            }))
                          }
                          className={`min-h-[32px] min-w-[32px] rounded-[4px] border px-1.5 text-[11px] font-semibold tabular-nums ${
                            active
                              ? 'border-accent bg-accent text-accent-ink'
                              : n === 11
                                ? 'border-accent/45 bg-accent/10 text-accent hover:bg-accent/20'
                                : 'border-line bg-card text-muted hover:text-ink'
                          }`}
                        >
                          {n}
                        </button>
                      );
                    })}
                  </div>
                  {draftItem.gameRating11 === 11 && (
                    <label className="mt-2 block">
                      <span className="mb-1 block text-[11px] text-accent">
                        Justificativa da Obra-Prima (Nota 11 · opcional)
                      </span>
                      <input
                        type="text"
                        value={draftItem.masterpieceJustification || ''}
                        onChange={(e) =>
                          setDraftItem((curr) => ({
                            ...curr,
                            masterpieceJustification: e.target.value,
                          }))
                        }
                        placeholder="Por que este jogo é um marco excepcional da sua vida..."
                        className="min-h-[40px] w-full rounded-[4px] border border-accent/50 bg-card px-2.5 text-xs text-ink focus:border-accent focus:outline-none"
                      />
                    </label>
                  )}
                </div>

                <label className="block">
                  <span className="mb-1 block text-[11px] text-muted">
                    Build / Personagem / Time
                  </span>
                  <input
                    type="text"
                    value={draftItem.buildOrCharacter || ''}
                    onChange={(e) =>
                      setDraftItem((curr) => ({
                        ...curr,
                        buildOrCharacter: e.target.value,
                      }))
                    }
                    placeholder="Ex: Dex/Arcane, Time Kanto, Main Thresh..."
                    className="min-h-[40px] w-full rounded-[4px] border border-line bg-card px-2.5 text-xs text-ink focus:border-accent focus:outline-none"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-[11px] text-muted">URL da capa (opcional)</span>
                  <input
                    type="url"
                    value={draftItem.coverUrl || ''}
                    onChange={(e) =>
                      setDraftItem((curr) => ({
                        ...curr,
                        coverUrl: e.target.value.trim() || null,
                      }))
                    }
                    placeholder="https://..."
                    className="min-h-[40px] w-full rounded-[4px] border border-line bg-card px-2.5 text-xs text-ink focus:border-accent focus:outline-none"
                  />
                </label>
              </div>
            ) : (
              <div className="space-y-3 rounded-[6px] border border-line bg-app p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-accent">
                  Dados de {draftDomainMeta.shortLabel}
                </p>

                {draftItem.workType === 'track' && (
                  <div className="space-y-2.5 rounded-[5px] border border-accent/35 bg-card p-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-accent">
                      Faixa Individual
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="mb-1 block text-[11px] text-muted">Álbum vinculado</span>
                        <input
                          type="text"
                          value={draftItem.albumName || ''}
                          onChange={(e) =>
                            setDraftItem((curr) => ({ ...curr, albumName: e.target.value }))
                          }
                          placeholder="Ex: Metallica (Black Album)"
                          className="min-h-[38px] w-full rounded-[4px] border border-line bg-app px-2.5 text-xs text-ink focus:border-accent focus:outline-none"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[11px] text-muted">Duração</span>
                        <input
                          type="text"
                          value={
                            draftItem.durationMs
                              ? formatTrackDuration(draftItem.durationMs)
                              : ''
                          }
                          onChange={(e) => {
                            const raw = e.target.value.trim();
                            const parts = raw.split(':').map(Number);
                            const ms =
                              parts.length === 2 && parts.every((n) => Number.isFinite(n) && n >= 0)
                                ? (parts[0] * 60 + parts[1]) * 1000
                                : null;
                            setDraftItem((curr) => ({ ...curr, durationMs: ms }));
                          }}
                          placeholder="5:24"
                          className="min-h-[38px] w-full rounded-[4px] border border-line bg-app px-2.5 text-xs tabular-nums text-ink focus:border-accent focus:outline-none"
                        />
                      </label>
                    </div>
                    <div>
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-[11px] text-muted">Nota da Faixa (0–10)</span>
                        <span className="text-[11px] font-semibold tabular-nums text-accent">
                          {draftItem.trackRating10 !== null && draftItem.trackRating10 !== undefined
                            ? `${draftItem.trackRating10}/10`
                            : 'Sem nota'}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => {
                          const active = draftItem.trackRating10 === n;
                          return (
                            <button
                              key={n}
                              type="button"
                              onClick={() =>
                                setDraftItem((curr) => ({
                                  ...curr,
                                  trackRating10: curr.trackRating10 === n ? null : n,
                                  rating: curr.trackRating10 === n ? null : n * 10,
                                  ratingSource: curr.trackRating10 === n ? null : 'manual',
                                }))
                              }
                              className={`min-h-[32px] min-w-[32px] rounded-[4px] border px-1.5 text-[11px] font-semibold tabular-nums ${
                                active
                                  ? 'border-accent bg-accent text-accent-ink'
                                  : 'border-line bg-app text-muted hover:text-ink'
                              }`}
                            >
                              {n}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                <div>
                  <span className="mb-1 block text-[11px] text-muted">Formato de lançamento</span>
                  <div className="flex flex-wrap gap-1.5">
                    {MUSIC_RELEASE_FORMATS.map((rf) => (
                      <button
                        key={rf}
                        type="button"
                        onClick={() =>
                          setDraftItem((curr) => ({ ...curr, releaseFormat: rf }))
                        }
                        className={`min-h-[36px] rounded-[4px] border px-2.5 text-[11px] font-medium ${
                          draftItem.releaseFormat === rf
                            ? 'border-accent bg-accent/15 text-ink'
                            : 'border-line bg-card text-muted'
                        }`}
                      >
                        {rf}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-[11px] text-muted">Subgênero</span>
                    <input
                      type="text"
                      value={draftItem.subgenre || ''}
                      onChange={(e) =>
                        setDraftItem((curr) => ({ ...curr, subgenre: e.target.value }))
                      }
                      placeholder="Heavy Metal, Rock Nacional..."
                      className="min-h-[40px] w-full rounded-[4px] border border-line bg-card px-2.5 text-xs text-ink focus:border-accent focus:outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] text-muted">Audições</span>
                    <input
                      type="number"
                      min="0"
                      value={draftItem.listenCount ?? 0}
                      onChange={(e) =>
                        setDraftItem((curr) => ({
                          ...curr,
                          listenCount: Math.max(0, Number(e.target.value) || 0),
                        }))
                      }
                      className="min-h-[40px] w-full rounded-[4px] border border-line bg-card px-2.5 text-xs tabular-nums text-ink focus:border-accent focus:outline-none"
                    />
                  </label>
                </div>

                {draftItem.workType !== 'track' && (
                  <label className="block">
                    <span className="mb-1 block text-[11px] text-muted">Faixa favorita</span>
                    <input
                      type="text"
                      value={draftItem.favoriteTrack || ''}
                      onChange={(e) =>
                        setDraftItem((curr) => ({ ...curr, favoriteTrack: e.target.value }))
                      }
                      placeholder="Digite ou selecione abaixo..."
                      className="min-h-[40px] w-full rounded-[4px] border border-line bg-card px-2.5 text-xs text-ink focus:border-accent focus:outline-none"
                    />
                  </label>
                )}

                {draftItem.workType !== 'track' &&
                  Array.isArray(draftItem.tracks) &&
                  draftItem.tracks.length > 0 && (
                    <div className="space-y-1">
                      <span className="block text-[10px] font-semibold uppercase tracking-wider text-subtle">
                        Tracklist ({draftItem.tracks.length} faixas — clique para favoritar)
                      </span>
                      <div className="max-h-32 overflow-y-auto space-y-1 rounded-[4px] border border-line bg-card p-1.5 no-scrollbar">
                        {draftItem.tracks.map((tr, idx) => {
                          const isFav = draftItem.favoriteTrack === tr.title;
                          return (
                            <button
                              key={`${tr.number || idx}-${tr.title}`}
                              type="button"
                              onClick={() =>
                                setDraftItem((curr) => ({ ...curr, favoriteTrack: tr.title }))
                              }
                              className={`flex w-full items-center justify-between rounded-[3px] px-2 py-1 text-left text-[11px] transition-colors ${
                                isFav
                                  ? 'bg-accent/15 font-semibold text-accent'
                                  : 'text-ink hover:bg-app'
                              }`}
                            >
                              <span className="truncate">
                                {tr.number || idx + 1}. {tr.title}
                              </span>
                              {tr.durationMs && (
                                <span className="ml-2 shrink-0 text-[10px] tabular-nums text-subtle">
                                  {formatTrackDuration(tr.durationMs)}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
              </div>
            )}

            {draftDomain === 'cinema' && (
              <SmartCatalogButton
                key={`smart-${draftItem.id}`}
                item={draftItem}
                geminiKey={geminiKey}
                onApplyFields={(updates) =>
                  setDraftItem((curr) => ({ ...curr, ...updates }))
                }
                onOpenGeminiSettings={onOpenGeminiSettings}
              />
            )}

            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-subtle">
                Clima &amp; Marcadores Pessoais
              </p>
              <TechnicalAtmosphereSection
                key={`atmo-${draftItem.id}`}
                item={draftItem}
                compactAutoChips
                defaultExpanded
                onChange={(updates) => setDraftItem((curr) => ({ ...curr, ...updates }))}
              />
            </div>

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
              <h2 className="text-sm font-semibold text-ink">
                {add.manualModalTitle} · {manualDomainMeta.shortLabel}
              </h2>
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
              domain={manualDomain}
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
                  {manualDomainMeta.creatorLabel}
                </span>
                <input
                  type="text"
                  value={manualDraft.director || manualDraft.creator || ''}
                  onChange={(e) =>
                    setManualDraft((curr) => ({
                      ...curr,
                      director: e.target.value,
                      creator: e.target.value,
                    }))
                  }
                  placeholder={manualDomainMeta.creatorLabel}
                  className="min-h-[42px] w-full rounded-[4px] border border-line bg-app px-3 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted">
                  {add.manualYearLabel}
                </span>
                <input
                  type="number"
                  min="1500"
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

            {manualDomain !== 'cinema' && (
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted">
                  Capa por URL (opcional)
                </span>
                <input
                  type="url"
                  value={manualDraft.coverUrl || ''}
                  onChange={(e) =>
                    setManualDraft((curr) => ({ ...curr, coverUrl: e.target.value }))
                  }
                  placeholder="https://..."
                  className="min-h-[42px] w-full rounded-[4px] border border-line bg-app px-3 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
                />
              </label>
            )}

            {manualDomain === 'cinema' ? (
              manualDraft.workType === 'movie' ? (
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
              )
            ) : manualDomain === 'reading' ? (
              <div className="space-y-2.5">
                <div className="grid grid-cols-3 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-muted">
                      Págs lidas
                    </span>
                    <input
                      type="number"
                      min="0"
                      value={manualDraft.pagesRead ?? 0}
                      onChange={(e) =>
                        setManualDraft((curr) => ({
                          ...curr,
                          pagesRead: Math.max(0, Number(e.target.value) || 0),
                        }))
                      }
                      className="min-h-[40px] w-full rounded-[4px] border border-line bg-app px-2.5 text-xs tabular-nums text-ink focus:border-accent focus:outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-muted">
                      Total págs
                    </span>
                    <input
                      type="number"
                      min="1"
                      value={manualDraft.totalPages || ''}
                      onChange={(e) =>
                        setManualDraft((curr) => ({
                          ...curr,
                          totalPages: e.target.value ? Number(e.target.value) : null,
                        }))
                      }
                      className="min-h-[40px] w-full rounded-[4px] border border-line bg-app px-2.5 text-xs tabular-nums text-ink focus:border-accent focus:outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-muted">
                      Formato
                    </span>
                    <select
                      value={manualDraft.bookFormat || BOOK_FORMATS[0]}
                      onChange={(e) =>
                        setManualDraft((curr) => ({ ...curr, bookFormat: e.target.value }))
                      }
                      className="min-h-[40px] w-full rounded-[4px] border border-line bg-app px-2 text-xs text-ink focus:border-accent focus:outline-none"
                    >
                      {BOOK_FORMATS.map((fmt) => (
                        <option key={fmt} value={fmt}>
                          {fmt}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted">
                    Título Original (opcional)
                  </span>
                  <input
                    type="text"
                    value={manualDraft.originalTitle || ''}
                    onChange={(e) =>
                      setManualDraft((curr) => ({ ...curr, originalTitle: e.target.value }))
                    }
                    placeholder="Ex: Die Verwandlung"
                    className="min-h-[40px] w-full rounded-[4px] border border-line bg-app px-3 text-xs text-ink focus:border-accent focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted">ISBN / DOI</span>
                  <input
                    type="text"
                    value={manualDraft.isbnOrDoi || ''}
                    onChange={(e) =>
                      setManualDraft((curr) => ({ ...curr, isbnOrDoi: e.target.value }))
                    }
                    placeholder="Opcional"
                    className="min-h-[40px] w-full rounded-[4px] border border-line bg-app px-3 text-xs text-ink focus:border-accent focus:outline-none"
                  />
                </label>
              </div>
            ) : manualDomain === 'games' ? (
              <div className="space-y-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-muted">
                      Plataforma Jogada
                    </span>
                    <select
                      value={manualDraft.platform || ''}
                      onChange={(e) =>
                        setManualDraft((curr) => ({ ...curr, platform: e.target.value }))
                      }
                      className="min-h-[42px] w-full rounded-[4px] border border-line bg-app px-2.5 text-xs text-ink focus:border-accent focus:outline-none"
                    >
                      <option value="">{GAME_PLATFORM_UNSET_LABEL}</option>
                      {GAME_PLATFORMS.map((plat) => (
                        <option key={plat} value={plat}>
                          {plat}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-muted">
                      Tipo de Edição
                    </span>
                    <select
                      value={manualDraft.editionType || GAME_EDITION_TYPES[0]}
                      onChange={(e) =>
                        setManualDraft((curr) => ({ ...curr, editionType: e.target.value }))
                      }
                      className="min-h-[42px] w-full rounded-[4px] border border-line bg-app px-2.5 text-xs text-ink focus:border-accent focus:outline-none"
                    >
                      {GAME_EDITION_TYPES.map((ed) => (
                        <option key={ed} value={ed}>
                          {ed}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-muted">
                      Loja / Launcher
                    </span>
                    <select
                      value={manualDraft.storeOrLauncher || ''}
                      onChange={(e) =>
                        setManualDraft((curr) => ({
                          ...curr,
                          storeOrLauncher: e.target.value,
                        }))
                      }
                      className="min-h-[42px] w-full rounded-[4px] border border-line bg-app px-2.5 text-xs text-ink focus:border-accent focus:outline-none"
                    >
                      <option value="">A definir</option>
                      {GAME_STORES_LAUNCHERS.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-muted">
                      Conclusão
                    </span>
                    <select
                      value={manualDraft.completionType || GAME_COMPLETION_TYPES[0]}
                      onChange={(e) =>
                        setManualDraft((curr) => ({
                          ...curr,
                          completionType: e.target.value,
                        }))
                      }
                      className="min-h-[42px] w-full rounded-[4px] border border-line bg-app px-2.5 text-xs text-ink focus:border-accent focus:outline-none"
                    >
                      {GAME_COMPLETION_TYPES.map((ct) => (
                        <option key={ct} value={ct}>
                          {ct}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-muted">
                      Horas jogadas
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      value={manualDraft.hoursPlayed ?? 0}
                      onChange={(e) =>
                        setManualDraft((curr) => ({
                          ...curr,
                          hoursPlayed: Math.max(0, Number(e.target.value) || 0),
                        }))
                      }
                      className="min-h-[42px] w-full rounded-[4px] border border-line bg-app px-3 text-xs tabular-nums text-ink focus:border-accent focus:outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-muted">
                      Nota (0–11)
                    </span>
                    <select
                      value={
                        manualDraft.gameRating11 !== null &&
                        manualDraft.gameRating11 !== undefined
                          ? String(manualDraft.gameRating11)
                          : ''
                      }
                      onChange={(e) => {
                        const val = e.target.value === '' ? null : Number(e.target.value);
                        setManualDraft((curr) => ({
                          ...curr,
                          gameRating11: val,
                          rating: val !== null ? Math.min(100, Math.round(val * 10)) : null,
                          ratingSource: val !== null ? 'manual' : null,
                        }));
                      }}
                      className="min-h-[42px] w-full rounded-[4px] border border-line bg-app px-2.5 text-xs tabular-nums text-ink focus:border-accent focus:outline-none"
                    >
                      <option value="">Sem nota</option>
                      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => (
                        <option key={n} value={n}>
                          {n === 11 ? '11 · Obra-Prima da Vida' : `${n}/11`}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {manualDraft.gameRating11 === 11 && (
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-accent">
                      Justificativa da Nota 11 (opcional)
                    </span>
                    <input
                      type="text"
                      value={manualDraft.masterpieceJustification || ''}
                      onChange={(e) =>
                        setManualDraft((curr) => ({
                          ...curr,
                          masterpieceJustification: e.target.value,
                        }))
                      }
                      placeholder="Por que é uma obra-prima excepcional da sua vida..."
                      className="min-h-[40px] w-full rounded-[4px] border border-accent/50 bg-app px-3 text-xs text-ink focus:border-accent focus:outline-none"
                    />
                  </label>
                )}
              </div>
            ) : (
              <div className="space-y-2.5">
                {manualDraft.workType === 'track' && (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-muted">
                        Álbum vinculado
                      </span>
                      <input
                        type="text"
                        value={manualDraft.albumName || ''}
                        onChange={(e) =>
                          setManualDraft((curr) => ({ ...curr, albumName: e.target.value }))
                        }
                        placeholder="Ex: Metallica (1991)"
                        className="min-h-[42px] w-full rounded-[4px] border border-line bg-app px-3 text-xs text-ink focus:border-accent focus:outline-none"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-muted">
                        Nota da Faixa (0–10)
                      </span>
                      <select
                        value={
                          manualDraft.trackRating10 !== null &&
                          manualDraft.trackRating10 !== undefined
                            ? String(manualDraft.trackRating10)
                            : ''
                        }
                        onChange={(e) => {
                          const val = e.target.value === '' ? null : Number(e.target.value);
                          setManualDraft((curr) => ({
                            ...curr,
                            trackRating10: val,
                            rating: val !== null ? Math.round(val * 10) : null,
                            ratingSource: val !== null ? 'manual' : null,
                          }));
                        }}
                        className="min-h-[42px] w-full rounded-[4px] border border-line bg-app px-2.5 text-xs tabular-nums text-ink focus:border-accent focus:outline-none"
                      >
                        <option value="">Sem nota</option>
                        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                          <option key={n} value={n}>
                            {n}/10
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-muted">
                      Formato
                    </span>
                    <select
                      value={manualDraft.releaseFormat || MUSIC_RELEASE_FORMATS[0]}
                      onChange={(e) =>
                        setManualDraft((curr) => ({
                          ...curr,
                          releaseFormat: e.target.value,
                        }))
                      }
                      className="min-h-[42px] w-full rounded-[4px] border border-line bg-app px-2.5 text-xs text-ink focus:border-accent focus:outline-none"
                    >
                      {MUSIC_RELEASE_FORMATS.map((rf) => (
                        <option key={rf} value={rf}>
                          {rf}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-muted">
                      Subgênero
                    </span>
                    <input
                      type="text"
                      value={manualDraft.subgenre || ''}
                      onChange={(e) =>
                        setManualDraft((curr) => ({ ...curr, subgenre: e.target.value }))
                      }
                      placeholder="Power Metal..."
                      className="min-h-[42px] w-full rounded-[4px] border border-line bg-app px-3 text-xs text-ink focus:border-accent focus:outline-none"
                    />
                  </label>
                </div>
                {manualDraft.workType !== 'track' && (
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-muted">
                      Faixa favorita
                    </span>
                    <input
                      type="text"
                      value={manualDraft.favoriteTrack || ''}
                      onChange={(e) =>
                        setManualDraft((curr) => ({ ...curr, favoriteTrack: e.target.value }))
                      }
                      placeholder="Opcional"
                      className="min-h-[42px] w-full rounded-[4px] border border-line bg-app px-3 text-xs text-ink focus:border-accent focus:outline-none"
                    />
                  </label>
                )}
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
