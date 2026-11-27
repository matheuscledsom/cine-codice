import {
  AlertCircle,
  ArrowLeft,
  Award,
  Bookmark,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronUp,
  Clapperboard,
  Download,
  Edit3,
  Film,
  FolderOpen,
  Heart,
  Layers,
  Link2,
  ListVideo,
  Plus,
  Quote,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  Tag,
  Trash2,
  Trophy,
  Tv,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import {
  BOOK_FORMATS,
  EXTENDED_GAME_PLATFORMS,
  GAME_COMPLETION_TYPES,
  GAME_EDITION_TYPES,
  GAME_PLATFORMS,
  GAME_PLATFORM_UNSET_LABEL,
  GAME_STORES_LAUNCHERS,
  MUSIC_RELEASE_FORMATS,
  domainConfig,
  getDomainMeta,
  getDomainVocabulary,
  getStatusListForDomain,
  getWorkTypeLabel,
  inferDomainFromWork,
  normalizeDomainId,
  normalizeGameEditionType,
} from '../config/domainConfig';
import { SOCIAL_ENABLED } from '../config/flags';
import { useToast } from '../context/ToastContext';
import { formatAnimeEpisodeCountLabel } from '../lib/animeEpisodes';
import {
  buildEditionLinkPatch,
  findEditionsOfWork,
  getEditionBaseWorkId,
  resolveBaseWorkForEdition,
} from '../lib/bookEditions';
import { formatNextAiringBadge } from '../lib/episodeStats';
import { extractWorkEntities } from '../lib/entityHelpers';
import { ALL_FRANCHISE_TIER_OPTIONS } from '../lib/franchiseTier';
import {
  ACHIEVEMENT_SOURCE_OPTIONS,
  GAME_ATTRIBUTION_LINKS,
  buildAchievementsSyncPatch,
  formatAchievementsSourceLabel,
  formatGameAchievementsSummary,
  formatGameCampaignTime,
  formatGameCompletion100Time,
  normalizeAchievementSource,
  normalizeAchievementsModel,
  suggestGameFranchiseLink,
} from '../lib/gameDepth';
import { looksLikeIsbnInput } from '../lib/isbn';
import { compressManualCoverImage } from '../lib/manualCovers';
import { isManualWork, mergeManualWorkWithApiCandidate } from '../lib/manualWorkLink';
import { computeDerivedAverage, updateEditableSubgenres } from '../lib/musicDepth';
import { computeWorkCritiqueBadge } from '../lib/ratingBadges';
import { getPresentExternalRatingBadges, workHasAnyExternalIds } from '../lib/ratings';
import {
  enrichSeriesAndAnimeSeasons,
  enrichWorkWithExternalRatings,
  searchCinemaMedia,
} from '../services/cinemaApi';
import { findFranchiseForItem } from '../services/franchiseEngine';
import {
  fetchGameDepthWithFallback,
  loadAchievementSyncHandles,
  saveAchievementSyncHandles,
  syncRetroAchievementsGame,
  syncSteamGameAchievements,
} from '../services/gameDepthService';
import { fetchLastfmSubgenres } from '../services/musicDepthService';
import {
  fetchBookByIsbn,
  getDisplayGenres,
  getDisplaySynopsis,
  searchWorksByDomain,
} from '../services/multiDomainSearchService';
import {
  advanceEpisodeProgress,
  createExpandedSeasonPatch,
  formatFlexibleProgressMetric,
  getDisplayTitles,
  getTodayLocalISO,
  getVerdictForScore,
  getVerdictMeta,
  getWorkDurationBadge,
  isEpisodicWork,
  isLoanOverdue,
  normalizeTagsList,
} from '../utils/backlogHelpers';
import {
  computeAlbumTrackRatingPatch,
  computeDomainQuickActionPatch,
  makeAlbumTrackKey,
  normalizeTrackRatingsMap,
} from '../utils/catalogDraftHelpers';
import {
  extractWorkAdaptivePalette,
  getWorkAdaptivePaletteSync,
} from '../utils/colorExtractor';
import { downloadWorkMarkdown } from '../utils/markdownExport';
import { playTactileSound } from '../utils/soundEffects';
import { CollectionCreatorBar } from './CollectionCreatorBar';
import { CoverArt } from './CoverArt';
import { SmartCatalogButton } from './SmartCatalogButton';
import { StarRatingPicker } from './StarRatingPicker';
import { StatusBadge } from './StatusBadge';
import { TechnicalAtmosphereSection } from './TechnicalAtmosphereSection';
import { WorkTypeSelector } from './WorkTypeSelector';

const EntitySheetModal = lazy(() =>
  import('./EntitySheetModal').then((m) => ({ default: m.EntitySheetModal }))
);
const EpisodeListTab = lazy(() =>
  import('./EpisodeListTab').then((m) => ({ default: m.EpisodeListTab }))
);
const ExternalRatingsPanel = lazy(() =>
  import('./ExternalRatingsPanel').then((m) => ({ default: m.ExternalRatingsPanel }))
);
const FranchiseRadarPanel = lazy(() =>
  import('./FranchiseRadarPanel').then((m) => ({ default: m.FranchiseRadarPanel }))
);
const QuotesVaultTab = lazy(() =>
  import('./QuotesVaultTab').then((m) => ({ default: m.QuotesVaultTab }))
);

const QUICK_PERSONAL_SCORES = [60, 70, 75, 80, 85, 90, 95, 100];

export function computeNextTop4Patch(item, allItems = []) {
  const currentRank = Number(item?.favoriteRank);
  if (Number.isInteger(currentRank) && currentRank >= 1 && currentRank <= 4) {
    return {
      favoriteRank: null,
      removedRank: currentRank,
    };
  }

  const targetDomain = inferDomainFromWork(item || {});
  const occupied = new Set(
    (Array.isArray(allItems) ? allItems : [])
      .filter((w) => w && w.id !== item?.id && inferDomainFromWork(w) === targetDomain)
      .map((w) => Number(w.favoriteRank))
      .filter((r) => Number.isInteger(r) && r >= 1 && r <= 4)
  );

  let chosenRank = 4;
  for (let slot = 1; slot <= 4; slot += 1) {
    if (!occupied.has(slot)) {
      chosenRank = slot;
      break;
    }
  }

  return {
    favoriteRank: chosenRank,
    isFavorite: true,
    removedRank: null,
  };
}

export function WorkDetailPage({
  item,
  allItems = [],
  profile = null,
  collections = [],
  geminiKey = '',
  tmdbKey = '',
  omdbKey = '',
  onClose,
  onUpdateItem,
  onSelectItem,
  onQuickCatalogItem,
  onToggleCollection,
  onCreateCollection,
  onRemoveItem,
  onOpenGeminiSettings,
  onFilterByCreator,
}) {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState('overview');
  const [synopsisExpanded, setSynopsisExpanded] = useState(false);
  const [moreDetailsOpen, setMoreDetailsOpen] = useState(false);
  const [isEditDrawerOpen, setIsEditDrawerOpen] = useState(false);
  const [editMoreDetailsOpen, setEditMoreDetailsOpen] = useState(false);
  const [activeEntity, setActiveEntity] = useState(null);
  const [activeTrackRatingKey, setActiveTrackRatingKey] = useState(null);
  const [pendingPagesFillPrompt, setPendingPagesFillPrompt] = useState(false);
  const [top4PickerOpen, setTop4PickerOpen] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [subgenreInput, setSubgenreInput] = useState('');
  const [subgenresLoading, setSubgenresLoading] = useState(false);
  const [rawgLoading, setRawgLoading] = useState(false);
  const [ratingsLoading, setRatingsLoading] = useState(false);
  const [linkSourceModalOpen, setLinkSourceModalOpen] = useState(false);
  const [linkSearchQuery, setLinkSearchQuery] = useState('');
  const [linkSearchLoading, setLinkSearchLoading] = useState(false);
  const [linkSearchResults, setLinkSearchResults] = useState([]);
  const [linkSearchError, setLinkSearchError] = useState('');
  const [coverUploadBusy, setCoverUploadBusy] = useState(false);
  const [coverUploadError, setCoverUploadError] = useState('');
  const [achSourceTab, setAchSourceTab] = useState(() =>
    normalizeAchievementSource(item?.achievements?.source)
  );
  const [achSyncLoading, setAchSyncLoading] = useState(false);
  const [achSyncFeedback, setAchSyncFeedback] = useState({ type: 'idle', message: '' });
  const [achievementsModalOpen, setAchievementsModalOpen] = useState(false);
  const [achManualUnlockedDraft, setAchManualUnlockedDraft] = useState('');
  const [achManualTotalDraft, setAchManualTotalDraft] = useState('');
  const [steamIdDraft, setSteamIdDraft] = useState(() => loadAchievementSyncHandles().steamId);
  const [steamAppIdDraft, setSteamAppIdDraft] = useState(() =>
    item?.ids?.steam ? String(item.ids.steam) : ''
  );
  const [raUsernameDraft, setRaUsernameDraft] = useState(
    () => loadAchievementSyncHandles().retroachievementsUsername
  );
  const [raGameIdDraft, setRaGameIdDraft] = useState(() =>
    item?.ids?.retroachievements ? String(item.ids.retroachievements) : ''
  );
  const [ratingsMeta, setRatingsMeta] = useState({
    failedSources: [],
    omdbMissingKey: false,
    isOfflineCache: false,
    cacheDateLabel: '',
    hasAttempted: false,
  });

  const autoEnrichedIdsRef = useRef(new Set());
  const enrichAbortRef = useRef(null);
  const latestItemRef = useRef(item);
  latestItemRef.current = item;

  const runEnrichmentForWork = async (targetItem, { forceRefresh = false } = {}) => {
    if (!targetItem?.id) return;
    if (normalizeDomainId(inferDomainFromWork(targetItem)) !== 'cinema') return;
    enrichAbortRef.current?.abort();
    const controller = new AbortController();
    enrichAbortRef.current = controller;

    if (!workHasAnyExternalIds(targetItem)) {
      if (isEpisodicWork(targetItem) && Number(targetItem.totalSeasons || 1) <= 1) {
        enrichSeriesAndAnimeSeasons(targetItem, {
          tmdbApiKey: tmdbKey,
          signal: controller.signal,
        })
          .then((seasonRes) => {
            if (!seasonRes || controller.signal.aborted) return;
            const seasonPatch = {};
            if (Number(seasonRes.totalSeasons) > Number(targetItem.totalSeasons || 1)) {
              seasonPatch.totalSeasons = seasonRes.totalSeasons;
            }
            if (seasonRes.totalEpisodes && !targetItem.totalEpisodes) {
              seasonPatch.totalEpisodes = seasonRes.totalEpisodes;
            }
            if (
              Array.isArray(seasonRes.episodesPerSeason) &&
              seasonRes.episodesPerSeason.length > 0
            ) {
              seasonPatch.episodesPerSeason = seasonRes.episodesPerSeason;
            }
            if (seasonRes.tvmazeId && !targetItem.tvmazeId) {
              seasonPatch.tvmazeId = seasonRes.tvmazeId;
            }
            if (Object.keys(seasonPatch).length > 0) {
              onUpdateItem(targetItem.id, seasonPatch);
            }
          })
          .catch(() => {});
      }
      setRatingsLoading(false);
      setRatingsMeta({
        failedSources: [],
        omdbMissingKey: false,
        isOfflineCache: false,
        cacheDateLabel: '',
        hasAttempted: true,
      });
      return;
    }

    setRatingsLoading(true);
    try {
      const res = await enrichWorkWithExternalRatings(targetItem, {
        tmdbApiKey: tmdbKey,
        omdbApiKey: omdbKey,
        forceRefresh,
        allowStaleOffline: true,
        signal: controller.signal,
        maxConcurrency: 2,
      });
      if (controller.signal.aborted) return;

      const updatedWork = res?.work;
      if (updatedWork) {
        const patch = {};
        if (JSON.stringify(updatedWork.ids || {}) !== JSON.stringify(targetItem.ids || {})) {
          patch.ids = updatedWork.ids;
          patch.tmdbId = updatedWork.tmdbId ?? null;
          patch.imdbId = updatedWork.imdbId ?? '';
          patch.tvmazeId = updatedWork.tvmazeId ?? null;
          patch.anilistId = updatedWork.anilistId ?? null;
          patch.malId = updatedWork.malId ?? null;
          if (updatedWork.tmdbMediaType) patch.tmdbMediaType = updatedWork.tmdbMediaType;
        }
        if (updatedWork.backdropUrl && updatedWork.backdropUrl !== targetItem.backdropUrl) {
          patch.backdropUrl = updatedWork.backdropUrl;
        }
        if (
          JSON.stringify(updatedWork.externalRatings || {}) !==
          JSON.stringify(targetItem.externalRatings || {})
        ) {
          patch.externalRatings = updatedWork.externalRatings;
        }
        if (updatedWork.belongsToCollection && !targetItem.belongsToCollection) {
          patch.belongsToCollection = updatedWork.belongsToCollection;
        }
        if (updatedWork.tmdbStatus && updatedWork.tmdbStatus !== targetItem.tmdbStatus) {
          patch.tmdbStatus = updatedWork.tmdbStatus;
        }
        if (updatedWork.showStatus && updatedWork.showStatus !== targetItem.showStatus) {
          patch.showStatus = updatedWork.showStatus;
        }
        if (
          JSON.stringify(updatedWork.nextEpisode || null) !==
          JSON.stringify(targetItem.nextEpisode || null)
        ) {
          patch.nextEpisode = updatedWork.nextEpisode;
        }
        if (
          JSON.stringify(updatedWork.nextAiringEpisode || null) !==
          JSON.stringify(targetItem.nextAiringEpisode || null)
        ) {
          patch.nextAiringEpisode = updatedWork.nextAiringEpisode;
        }
        if (updatedWork.franchiseName && !targetItem.franchiseName) {
          patch.franchiseName = updatedWork.franchiseName;
        }
        if (
          Array.isArray(updatedWork.franchiseRelations) &&
          updatedWork.franchiseRelations.length > 0 &&
          (!Array.isArray(targetItem.franchiseRelations) ||
            targetItem.franchiseRelations.length === 0)
        ) {
          patch.franchiseRelations = updatedWork.franchiseRelations;
        }
        if (updatedWork.director && !targetItem.director) {
          patch.director = updatedWork.director;
        }
        if (updatedWork.studio && !targetItem.studio) {
          patch.studio = updatedWork.studio;
        }
        if (
          String(updatedWork.synopsis || '').length >
          String(targetItem.synopsis || '').length
        ) {
          patch.synopsis = updatedWork.synopsis;
          patch.overview = updatedWork.synopsis;
        }
        if (
          isEpisodicWork(targetItem) &&
          Number(updatedWork.totalSeasons) > Number(targetItem.totalSeasons || 1)
        ) {
          patch.totalSeasons = updatedWork.totalSeasons;
        }
        if (
          isEpisodicWork(targetItem) &&
          updatedWork.totalEpisodes &&
          !targetItem.totalEpisodes
        ) {
          patch.totalEpisodes = updatedWork.totalEpisodes;
        }
        if (
          isEpisodicWork(targetItem) &&
          Array.isArray(updatedWork.episodesPerSeason) &&
          updatedWork.episodesPerSeason.length > 0 &&
          (!Array.isArray(targetItem.episodesPerSeason) ||
            targetItem.episodesPerSeason.length === 0)
        ) {
          patch.episodesPerSeason = updatedWork.episodesPerSeason;
        }
        if (Object.keys(patch).length > 0) {
          onUpdateItem(targetItem.id, patch);
        }
      }

      setRatingsMeta({
        failedSources: res?.meta?.failedSources || [],
        omdbMissingKey: Boolean(res?.meta?.omdbMissingKey),
        isOfflineCache: Boolean(res?.meta?.isOfflineCache),
        cacheDateLabel: res?.meta?.cacheDateLabel || '',
        hasAttempted: true,
      });
    } catch {
      if (!controller.signal.aborted) {
        setRatingsMeta((prev) => ({
          ...prev,
          failedSources: ['rede'],
          hasAttempted: true,
        }));
      }
    } finally {
      if (!controller.signal.aborted) {
        setRatingsLoading(false);
      }
    }
  };

  useEffect(() => {
    setActiveTab('overview');
    setSynopsisExpanded(false);
    setMoreDetailsOpen(false);
    setIsEditDrawerOpen(false);
    setEditMoreDetailsOpen(false);
    setActiveTrackRatingKey(null);
    setPendingPagesFillPrompt(false);
    setTop4PickerOpen(false);
    setTagInput('');
    setAchievementsModalOpen(false);
    setAchSyncLoading(false);
    setAchSyncFeedback({ type: 'idle', message: '' });
    const savedHandles = loadAchievementSyncHandles();
    setSteamIdDraft(savedHandles.steamId);
    setRaUsernameDraft(savedHandles.retroachievementsUsername);
    const currentForAch = latestItemRef.current;
    setAchSourceTab(normalizeAchievementSource(currentForAch?.achievements?.source));
    setSteamAppIdDraft(currentForAch?.ids?.steam ? String(currentForAch.ids.steam) : '');
    setRaGameIdDraft(
      currentForAch?.ids?.retroachievements ? String(currentForAch.ids.retroachievements) : ''
    );
    setRatingsMeta({
      failedSources: [],
      omdbMissingKey: false,
      isOfflineCache: false,
      cacheDateLabel: '',
      hasAttempted: false,
    });

    const current = latestItemRef.current;
    if (!current?.id) return undefined;
    if (normalizeDomainId(inferDomainFromWork(current)) !== 'cinema') {
      return () => {
        enrichAbortRef.current?.abort();
      };
    }

    const badges = getPresentExternalRatingBadges(current.externalRatings);
    const missingSeasons =
      isEpisodicWork(current) &&
      Number(current.totalSeasons || 1) <= 1 &&
      (!Array.isArray(current.episodesPerSeason) || current.episodesPerSeason.length === 0);
    const hasMissingExpected =
      missingSeasons ||
      (current.workType === 'anime'
        ? !current.externalRatings?.anilist ||
          (Boolean(current.ids?.mal || current.malId) && !current.externalRatings?.mal) ||
          !Array.isArray(current.franchiseRelations) ||
          current.franchiseRelations.length === 0
        : !current.externalRatings?.tmdb ||
          (Boolean(current.ids?.imdb || current.imdbId) && !current.externalRatings?.imdb));
    const needsAutoFetch =
      (workHasAnyExternalIds(current) || missingSeasons) &&
      !autoEnrichedIdsRef.current.has(current.id) &&
      (!current.backdropUrl || badges.length === 0 || hasMissingExpected);

    if (needsAutoFetch) {
      autoEnrichedIdsRef.current.add(current.id);
      runEnrichmentForWork(current, { forceRefresh: false });
    }

    return () => {
      enrichAbortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  // Suporte a tecla Escape para fechar o drawer ou a página
  useEffect(() => {
    if (!item) return undefined;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (activeEntity) {
          setActiveEntity(null);
        } else if (achievementsModalOpen) {
          setAchievementsModalOpen(false);
        } else if (isEditDrawerOpen) {
          setIsEditDrawerOpen(false);
        } else {
          onClose?.();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [item, activeEntity, achievementsModalOpen, isEditDrawerOpen, onClose]);

  const openAchievementsSheet = (mode = achSourceTab) => {
    const cleanMode = normalizeAchievementSource(mode);
    setAchSourceTab(cleanMode);
    setAchSyncFeedback({ type: 'idle', message: '' });
    setAchManualUnlockedDraft(
      item?.achievements?.unlocked !== null && item?.achievements?.unlocked !== undefined
        ? String(item.achievements.unlocked)
        : ''
    );
    setAchManualTotalDraft(
      item?.achievements?.total !== null && item?.achievements?.total !== undefined
        ? String(item.achievements.total)
        : ''
    );
    const handles = loadAchievementSyncHandles();
    if (!steamIdDraft && handles.steamId) setSteamIdDraft(handles.steamId);
    if (!raUsernameDraft && handles.retroachievementsUsername) {
      setRaUsernameDraft(handles.retroachievementsUsername);
    }
    setSteamAppIdDraft(item?.ids?.steam ? String(item.ids.steam) : steamAppIdDraft || '');
    setRaGameIdDraft(
      item?.ids?.retroachievements ? String(item.ids.retroachievements) : raGameIdDraft || ''
    );
    setAchievementsModalOpen(true);
  };

  const handleSyncSteamAchievements = async ({
    overrideSteamId = steamIdDraft,
    overrideAppId = steamAppIdDraft || (item?.ids?.steam ? String(item.ids.steam) : ''),
  } = {}) => {
    if (!item?.id || achSyncLoading) return;
    const cleanSteamId = String(overrideSteamId || '').trim();
    const cleanAppId = String(overrideAppId || '').trim();
    if (!cleanSteamId) {
      openAchievementsSheet('steam');
      return;
    }

    setAchSyncLoading(true);
    setAchSyncFeedback({ type: 'info', message: 'Sincronizando conquistas na Steam...' });
    try {
      saveAchievementSyncHandles({ steamId: cleanSteamId });
      const res = await syncSteamGameAchievements({
        steamId: cleanSteamId,
        appId: cleanAppId,
        gameTitle: item.title || '',
      });
      if (!res.ok || !res.achievements) {
        setAchSyncFeedback({
          type: 'error',
          message: res.error || 'Não foi possível sincronizar conquistas Steam.',
        });
        showToast({
          message: res.error || 'Falha ao sincronizar conquistas Steam.',
          type: 'error',
        });
        return;
      }

      const patch = buildAchievementsSyncPatch(item, res.achievements, {
        steamAppId: res.resolvedAppId || cleanAppId,
      });
      if (patch) {
        onUpdateItem(item.id, patch);
      }
      if (res.resolvedAppId) {
        setSteamAppIdDraft(String(res.resolvedAppId));
      }
      const summary = formatGameAchievementsSummary(res.achievements);
      setAchSyncFeedback({
        type: 'success',
        message: `Steam sincronizada: ${summary?.label || `${res.achievements.unlocked} obtidos`}.`,
      });
      setAchievementsModalOpen(false);
      showToast({
        message: `Conquistas Steam atualizadas (${summary?.label || `${res.achievements.unlocked} obtidos`}).`,
        type: 'success',
      });
    } finally {
      setAchSyncLoading(false);
    }
  };

  const handleSyncRetroAchievements = async ({
    overrideUsername = raUsernameDraft,
    overrideGameId = raGameIdDraft ||
      (item?.ids?.retroachievements ? String(item.ids.retroachievements) : ''),
  } = {}) => {
    if (!item?.id || achSyncLoading) return;
    const cleanUser = String(overrideUsername || '').trim();
    const cleanGameId = String(overrideGameId || '').trim();
    if (!cleanUser || !cleanGameId) {
      openAchievementsSheet('retroachievements');
      return;
    }

    setAchSyncLoading(true);
    setAchSyncFeedback({
      type: 'info',
      message: 'Sincronizando conquistas no RetroAchievements...',
    });
    try {
      saveAchievementSyncHandles({ retroachievementsUsername: cleanUser });
      const res = await syncRetroAchievementsGame({
        username: cleanUser,
        gameId: cleanGameId,
      });
      if (!res.ok || !res.achievements) {
        setAchSyncFeedback({
          type: 'error',
          message: res.error || 'Não foi possível sincronizar no RetroAchievements.',
        });
        showToast({
          message: res.error || 'Falha ao sincronizar RetroAchievements.',
          type: 'error',
        });
        return;
      }

      const patch = buildAchievementsSyncPatch(item, res.achievements, {
        retroachievementsGameId: cleanGameId,
      });
      if (patch) {
        onUpdateItem(item.id, patch);
      }
      setRaGameIdDraft(cleanGameId);
      const summary = formatGameAchievementsSummary(res.achievements);
      const consoleSuffix = res.consoleName ? ` · ${res.consoleName}` : '';
      setAchSyncFeedback({
        type: 'success',
        message: `RetroAchievements sincronizado: ${summary?.label || `${res.achievements.unlocked} obtidos`}${consoleSuffix}.`,
      });
      setAchievementsModalOpen(false);
      showToast({
        message: `RetroAchievements atualizado (${summary?.label || `${res.achievements.unlocked} obtidos`}).`,
        type: 'success',
      });
    } finally {
      setAchSyncLoading(false);
    }
  };

  const franchise = useMemo(
    () => (item ? findFranchiseForItem(item, allItems.length > 0 ? allItems : [item]) : null),
    [item, allItems]
  );

  const [adaptivePalette, setAdaptivePalette] = useState(() =>
    item ? getWorkAdaptivePaletteSync(item) : null
  );

  useEffect(() => {
    if (!item) return undefined;
    let cancelled = false;
    setAdaptivePalette(getWorkAdaptivePaletteSync(item));
    extractWorkAdaptivePalette(item)
      .then((res) => {
        if (!cancelled && res) setAdaptivePalette(res);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [item]);

  if (!item) return null;

  const critiqueBadge = computeWorkCritiqueBadge(item);

  const workDomain = normalizeDomainId(inferDomainFromWork(item));
  const domainMeta = getDomainMeta(workDomain);
  const workVocab = getDomainVocabulary(workDomain);
  const statuses = getStatusListForDomain(workDomain);
  const { ui } = domainConfig;
  const genres = getDisplayGenres(item, { max: 3 });
  const moods = Array.isArray(item.moods)
    ? item.moods
    : Array.isArray(item.atmosphere)
      ? item.atmosphere
      : [];
  const tags = Array.isArray(item.tags) ? item.tags : [];
  const verdictMeta = item.verdict ? getVerdictMeta(item.verdict) : null;
  const quotesCount = Array.isArray(item.quotes) ? item.quotes.length : 0;
  const displayTitles = getDisplayTitles(item, 'bilingual');
  const creatorLabel = item.creator || item.director || item.studio || item.author || '';
  const episodic = workDomain === 'cinema' && isEpisodicWork(item);
  const nextAiringBadge = episodic ? formatNextAiringBadge(item) : null;
  const durationBadge = getWorkDurationBadge(item);
  const workFormatLabel = getWorkTypeLabel(item, workDomain);
  const domainQuickMetric =
    workDomain !== 'cinema' ? formatFlexibleProgressMetric(item) : null;
  const albumTrackRatings = normalizeTrackRatingsMap(item.trackRatings);

  const synopsisText = getDisplaySynopsis(item);
  const isLongSynopsis = synopsisText.length > 260;

  const clickableCreators = Array.from(
    new Set(
      [item.creator, item.director, item.studio, item.author]
        .filter(Boolean)
        .flatMap((raw) =>
          String(raw)
            .split(/[;,]/)
            .map((part) => part.trim())
            .filter(Boolean)
        )
    )
  );

  const curSeason = Math.max(1, Number(item.currentSeason) || 1);
  const curEp = Math.max(0, Number(item.currentEpisode) || 0);
  const currentFavRank =
    Number.isInteger(Number(item.favoriteRank)) &&
    Number(item.favoriteRank) >= 1 &&
    Number(item.favoriteRank) <= 4
      ? Number(item.favoriteRank)
      : null;

  const runDomainQuickAction = (actionType) => {
    const plan = computeDomainQuickActionPatch(item, actionType, {
      allowCompletion: true,
    });
    if (!plan) return;
    onUpdateItem(item.id, plan.patch);
    playTactileSound(plan.sound || 'page');
    showToast({
      message: plan.toastMessage,
      type: 'success',
      duration: 6000,
      action: {
        label: 'Desfazer',
        onClick: () => {
          onUpdateItem(item.id, plan.undoSnapshot);
        },
      },
    });
  };

  const handleTrackRatingSelect = (track, idx, score10) => {
    const result = computeAlbumTrackRatingPatch(item, track, idx, score10);
    if (!result) return;
    onUpdateItem(item.id, result.patch);
    playTactileSound('page');
    showToast({
      message: result.toastMessage,
      type: 'success',
      duration: 6000,
      action: {
        label: 'Desfazer',
        onClick: () => {
          onUpdateItem(item.id, result.undoSnapshot);
        },
      },
    });
  };

  const handleStatusSelect = (nextStatusId) => {
    onUpdateItem(item.id, { status: nextStatusId, inBacklog: true });
    if (
      workDomain === 'reading' &&
      nextStatusId === 'completed' &&
      Number(item.totalPages) > 0 &&
      Number(item.pagesRead || 0) < Number(item.totalPages)
    ) {
      setPendingPagesFillPrompt(true);
    } else {
      setPendingPagesFillPrompt(false);
    }
  };

  const handlePrimaryContextualAction = () => {
    if (workDomain === 'reading') {
      runDomainQuickAction('reading_pages');
      return;
    }

    if (workDomain === 'games') {
      runDomainQuickAction('games_1h');
      return;
    }

    if (workDomain === 'music') {
      runDomainQuickAction('music_listen');
      return;
    }

    if (episodic) {
      const undoSnapshot = {
        status: item.status,
        currentSeason: item.currentSeason ?? 1,
        currentEpisode: item.currentEpisode ?? 0,
        watchedEpisodes: item.watchedEpisodes || {},
        progress: item.progress ?? 0,
        completedDate: item.completedDate || null,
        updatedAt: item.updatedAt || item.createdAt || null,
      };
      const patch = advanceEpisodeProgress(item, 1, { allowExpandSeasons: true });
      playTactileSound(patch.status === 'completed' ? 'complete' : 'page');
      onUpdateItem(item.id, patch);
      showToast({
        message: `Progresso atualizado: T${patch.currentSeason || curSeason} · E${patch.currentEpisode || curEp + 1}`,
        type: 'success',
        duration: 6000,
        action: {
          label: 'Desfazer',
          onClick: () => onUpdateItem(item.id, undoSnapshot),
        },
      });
    } else {
      const undoSnapshot = {
        status: item.status,
        rewatchCount: Number(item.rewatchCount || 0),
        completedDate: item.completedDate || null,
        progress: item.progress ?? 0,
        updatedAt: item.updatedAt || item.createdAt || null,
      };
      const alreadyDone = item.status === 'completed';
      const patch = alreadyDone
        ? {
            rewatchCount: Number(item.rewatchCount || 0) + 1,
            completedDate: getTodayLocalISO(),
          }
        : {
            status: 'completed',
            inBacklog: true,
            completedDate: getTodayLocalISO(),
          };
      playTactileSound('complete');
      onUpdateItem(item.id, patch);
      showToast({
        message: alreadyDone
          ? `${workVocab.revisitBadgePrefix} #${patch.rewatchCount} registrado para "${item.title}".`
          : `"${item.title}" marcado como ${workVocab.statuses.completed}.`,
        type: 'success',
        duration: 6000,
        action: {
          label: 'Desfazer',
          onClick: () => onUpdateItem(item.id, undoSnapshot),
        },
      });
    }
  };

  const handleToggleTop4 = (explicitSlot = null) => {
    if (explicitSlot !== null) {
      if (currentFavRank === explicitSlot) {
        onUpdateItem(item.id, { favoriteRank: null });
        showToast({ message: 'Removido da vitrine Top 4 Favoritos.', type: 'info' });
      } else {
        // Libera slot se outra obra do MESMO domínio ocupava a mesma posição
        const currentOccupant = allItems.find(
          (w) =>
            w.id !== item.id &&
            inferDomainFromWork(w) === workDomain &&
            Number(w.favoriteRank) === explicitSlot
        );
        if (currentOccupant) {
          onUpdateItem(currentOccupant.id, { favoriteRank: currentFavRank || null });
        }
        onUpdateItem(item.id, { favoriteRank: explicitSlot, isFavorite: true });
        showToast({
          message: `"${item.title}" fixado no Top #${explicitSlot} (${workVocab.favoritesTabLabel}).`,
          type: 'success',
        });
      }
      setTop4PickerOpen(false);
      return;
    }

    const res = computeNextTop4Patch(item, allItems);
    if (res.favoriteRank === null) {
      onUpdateItem(item.id, { favoriteRank: null });
      showToast({ message: 'Removido da vitrine Top 4 Favoritos.', type: 'info' });
    } else {
      const currentOccupant = allItems.find(
        (w) =>
          w.id !== item.id &&
          inferDomainFromWork(w) === workDomain &&
          Number(w.favoriteRank) === res.favoriteRank
      );
      if (currentOccupant) {
        onUpdateItem(currentOccupant.id, { favoriteRank: null });
      }
      onUpdateItem(item.id, { favoriteRank: res.favoriteRank, isFavorite: true });
      showToast({
        message: `"${item.title}" fixado no Top #${res.favoriteRank} (${workVocab.favoritesTabLabel}).`,
        type: 'success',
      });
    }
  };

  const handleSetPersonalScore = (nextScore) => {
    const clamped = Math.max(0, Math.min(100, Math.round(Number(nextScore) || 0)));
    onUpdateItem(item.id, {
      rating: clamped,
      ratingSource: 'manual',
      verdict: getVerdictForScore(clamped),
    });
    playTactileSound('page');
  };

  const animeReleasedInfo =
    workDomain === 'cinema' && item.workType === 'anime'
      ? formatAnimeEpisodeCountLabel(item)
      : null;

  const editionBaseWork =
    workDomain === 'reading' ? resolveBaseWorkForEdition(item, allItems) : null;
  const linkedBookEditions =
    workDomain === 'reading' ? findEditionsOfWork(item.id, allItems) : [];

  const metadataParts = [
    domainMeta.shortLabel,
    item.releaseYear ? String(item.releaseYear) : null,
    creatorLabel || null,
    workDomain === 'cinema'
      ? animeReleasedInfo?.kind === 'released-so-far' && animeReleasedInfo.label
        ? animeReleasedInfo.label
        : durationBadge || (episodic ? `${Math.max(1, Number(item.totalSeasons) || 1)} temp.` : null)
      : domainQuickMetric,
    workFormatLabel,
  ].filter(Boolean);

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-app text-ink"
      role="dialog"
      aria-modal="true"
      aria-label={`Página da obra ${item.title}`}
      style={
        adaptivePalette
          ? {
              '--work-accent': adaptivePalette.workAccent,
              '--work-glow': adaptivePalette.workGlow,
              '--work-contrast': adaptivePalette.workContrast,
            }
          : undefined
      }
    >
      {/* Fundo imersivo desfocado (blur(32px)) sob véu legível do tema ativo */}
      {(item.backdropUrl || item.coverUrl) && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-0 overflow-hidden opacity-25"
        >
          <img
            src={item.backdropUrl || item.coverUrl}
            alt=""
            className="h-full w-full scale-110 object-cover"
            style={{ filter: 'blur(32px) saturate(1.25)' }}
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                'radial-gradient(circle at 50% 0%, var(--work-glow, transparent), var(--bg-primary) 75%)',
            }}
          />
        </div>
      )}

      {/* HERO CINEMATOGRÁFICO WIDE (16:9 mobile / 320-380px desktop + scrim >= 72%) */}
      <header className="relative z-10 w-full overflow-hidden border-b border-line bg-card">
        <div className="relative aspect-video w-full sm:aspect-auto sm:h-[340px] lg:h-[380px]">
          {item.backdropUrl ? (
            <img
              src={item.backdropUrl}
              alt=""
              aria-hidden="true"
              className="h-full w-full object-cover"
              style={{ objectPosition: 'center 20%' }}
            />
          ) : item.coverUrl ? (
            <img
              src={item.coverUrl}
              alt=""
              aria-hidden="true"
              className="h-full w-full scale-110 object-cover blur-2xl opacity-55"
              style={{ objectPosition: 'center 20%' }}
            />
          ) : (
            <div
              className="h-full w-full"
              style={{
                background:
                  'radial-gradient(circle at 25% 20%, var(--accent-soft), transparent 65%), var(--bg-secondary)',
              }}
            />
          )}

          {/* Scrim cinematográfico protetor >= 72% opacidade para contraste WCAG 2.2 AA */}
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              background:
                'linear-gradient(180deg, rgba(10,12,16,0.74) 0%, rgba(10,12,16,0.84) 55%, var(--bg-primary) 100%)',
            }}
          />

          {/* Barra Superior de Navegação da Página */}
          <div className="absolute inset-x-0 top-0 z-10 mx-auto flex max-w-5xl items-center justify-between px-4 pt-3 sm:px-6">
            <button
              type="button"
              onClick={onClose}
              aria-label={ui.detail.closeLabel}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-white/15 bg-black/60 px-3.5 py-2 text-xs font-semibold text-white backdrop-blur-md transition-colors hover:border-accent"
            >
              <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
              <span>Voltar</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsEditDrawerOpen(true)}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-white/15 bg-black/60 px-3.5 py-2 text-xs font-semibold text-white backdrop-blur-md transition-colors hover:border-accent"
              >
                <Edit3 className="h-3.5 w-3.5" strokeWidth={1.5} />
                <span>Editar Metadados</span>
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label="Fechar página da obra"
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-white/15 bg-black/60 text-white backdrop-blur-md transition-colors hover:border-accent"
              >
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>
          </div>
        </div>

        {/* Conteúdo Editorial Sobreposto ao Hero */}
        <div className="relative z-10 mx-auto -mt-20 max-w-5xl px-4 pb-6 sm:-mt-36 sm:px-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end">
            {/* Pôster 2:3 rigoroso (120x180 mobile / 160x240 desktop) */}
            <div
              className="h-[180px] w-[120px] shrink-0 overflow-hidden rounded-xl shadow-2xl sm:h-[240px] sm:w-[160px]"
              style={{
                aspectRatio: '2 / 3',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <CoverArt
                item={item}
                className="h-full w-full rounded-xl object-cover"
              />
            </div>

            <div className="min-w-0 flex-1 space-y-2.5">
              {/* Selos de Status, Top 4 e Próxima Exibição */}
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge statusId={item.status} domain={workDomain} />
                {currentFavRank && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-accent bg-accent/20 px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-accent">
                    <Award className="h-3 w-3" strokeWidth={1.5} />
                    <span>Top #{currentFavRank} Favorito</span>
                  </span>
                )}
                {nextAiringBadge && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-accent">
                    <CalendarClock className="h-3 w-3 shrink-0" strokeWidth={1.5} />
                    <span>{nextAiringBadge.text}</span>
                  </span>
                )}
                {typeof item.rating === 'number' && (
                  item.ratingSource === 'legacy-default' ? (
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateItem(item.id, {
                          rating: item.rating,
                          ratingSource: 'manual',
                          verdict: item.verdict || getVerdictForScore(item.rating),
                        })
                      }
                      title="Nota padrão criada automaticamente na versão anterior — toque para confirmar"
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-dashed border-line bg-app px-3 py-1 text-[11px] font-medium tabular-nums text-muted hover:border-accent hover:text-ink"
                    >
                      <Star className="h-3 w-3 text-subtle" strokeWidth={1.5} />
                      <span>{item.rating}/100 · nota padrão</span>
                      <span className="font-semibold text-accent">Confirmar</span>
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/15 px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-accent">
                      <Star className="h-3 w-3 fill-current" strokeWidth={1.5} />
                      <span>{item.rating}/100</span>
                    </span>
                  )
                )}
                {Number(item.rewatchCount) > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-line bg-app px-2.5 py-0.5 text-[11px] font-medium tabular-nums text-ink">
                    <RotateCcw className="h-3 w-3 text-accent" strokeWidth={1.5} />
                    <span>{workVocab.revisitBadgePrefix} #{item.rewatchCount}</span>
                  </span>
                )}
                {verdictMeta && (
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${verdictMeta.badgeClass}`}
                  >
                    {verdictMeta.id}
                  </span>
                )}
                {critiqueBadge && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tabular-nums"
                    style={{
                      borderColor: 'var(--work-accent, var(--accent-color))',
                      backgroundColor: 'var(--work-glow, var(--accent-soft))',
                      color: 'var(--work-accent, var(--accent-color))',
                    }}
                  >
                    <Sparkles className="h-3 w-3 shrink-0" strokeWidth={1.5} />
                    <span>
                      {critiqueBadge.label} · {critiqueBadge.detail}
                    </span>
                  </span>
                )}
              </div>

              {/* Título Principal e Título Original Discreto */}
              <div>
                <h1
                  className="text-2xl font-bold text-ink sm:text-3xl"
                  style={{ letterSpacing: '-0.02em', lineHeight: 1.15 }}
                >
                  {displayTitles.primary}
                </h1>
                {displayTitles.secondary && (
                  <p className="mt-1 text-xs italic text-muted sm:text-sm">
                    {displayTitles.secondary}
                  </p>
                )}
              </div>

              {/* Linha Editorial de Metadados (0.8125rem / 13px separados por pontos médios ·) */}
              <p
                className="tabular-nums text-muted"
                style={{ fontSize: '0.8125rem' }}
              >
                {metadataParts.join(' · ')}
              </p>

              {/* Entidades clicáveis: Autor, Diretor, Estúdio, Elenco, Banda (v2.4.0 Fase 4.4) */}
              {(() => {
                const entities = extractWorkEntities(item);
                if (entities.length === 0) return null;
                return (
                  <div
                    className="flex flex-wrap items-center gap-1.5 pt-1"
                    data-testid="work-clickable-entities"
                  >
                    {entities.map((ent) => (
                      <button
                        key={`${ent.role}:${ent.name}`}
                        type="button"
                        onClick={() => setActiveEntity(ent)}
                        aria-label={`Abrir página de ${ent.roleLabel} ${ent.name}`}
                        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[6px] border border-line bg-app px-3 py-1.5 text-left text-xs font-medium text-ink transition-colors hover:border-accent hover:text-accent"
                      >
                        <span className="text-[10px] uppercase tracking-wider text-subtle">
                          {ent.roleLabel}
                        </span>
                        <span>{ent.name}</span>
                      </button>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Barra de Ações Principais (>= 44px) */}
          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
            {workDomain === 'reading' ? (
              <>
                <button
                  type="button"
                  onClick={() => runDomainQuickAction('reading_pages')}
                  className="inline-flex min-h-[44px] flex-1 sm:flex-initial items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-xs font-semibold tabular-nums text-accent-ink transition-opacity hover:opacity-90"
                >
                  <Plus className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                  <span>
                    +10 págs ({Number(item.pagesRead || 0)}
                    {Number(item.totalPages) > 0 ? `/${item.totalPages}` : ''})
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => runDomainQuickAction('reading_chapter')}
                  className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-accent/40 bg-accent/15 px-4 py-2.5 text-xs font-semibold tabular-nums text-accent transition-colors hover:bg-accent/25"
                >
                  <Plus className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                  <span>+1 cap ({Number(item.chaptersRead || 0)})</span>
                </button>
              </>
            ) : workDomain === 'games' ? (
              <>
                <button
                  type="button"
                  onClick={() => runDomainQuickAction('games_30m')}
                  className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-accent/40 bg-accent/15 px-4 py-2.5 text-xs font-semibold tabular-nums text-accent transition-colors hover:bg-accent/25"
                >
                  <Plus className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                  <span>+30 min</span>
                </button>
                <button
                  type="button"
                  onClick={() => runDomainQuickAction('games_1h')}
                  className="inline-flex min-h-[44px] flex-1 sm:flex-initial items-center justify-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-xs font-semibold tabular-nums text-accent-ink transition-opacity hover:opacity-90"
                >
                  <Plus className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                  <span>+1 h ({Number(item.hoursPlayed || 0)}h)</span>
                </button>
              </>
            ) : workDomain === 'music' ? (
              <button
                type="button"
                onClick={() => runDomainQuickAction('music_listen')}
                className="inline-flex min-h-[44px] flex-1 sm:flex-initial items-center justify-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-xs font-semibold tabular-nums text-accent-ink transition-opacity hover:opacity-90"
              >
                <Plus className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                <span>+1 audição ({Number(item.listenCount || 0)}x)</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handlePrimaryContextualAction}
                className="inline-flex min-h-[44px] flex-1 sm:flex-initial items-center justify-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-xs font-semibold tabular-nums text-accent-ink transition-opacity hover:opacity-90"
              >
                {episodic ? (
                  <>
                    <Plus className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                    <span>
                      +1 Ep (T{curSeason} · E{curEp})
                    </span>
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                    <span>
                      {item.status === 'completed'
                        ? 'Registrar Rewatch (+1)'
                        : `Marcar como ${workVocab.statuses.completed}`}
                    </span>
                  </>
                )}
              </button>
            )}

            <div className="relative">
              <button
                type="button"
                onClick={() => handleToggleTop4(null)}
                className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-semibold tabular-nums transition-colors ${
                  currentFavRank
                    ? 'border-accent bg-accent/15 text-accent'
                    : 'border-line bg-app text-ink hover:border-accent'
                }`}
              >
                <Award className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                <span>
                  {currentFavRank ? `Top #${currentFavRank} (Remover)` : 'Fixar nos Top 4'}
                </span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setTop4PickerOpen((v) => !v)}
              aria-expanded={top4PickerOpen}
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-line bg-app px-3 py-2.5 text-xs font-medium tabular-nums text-muted hover:border-accent hover:text-ink"
            >
              <span>Posição Top 1–4</span>
              {top4PickerOpen ? (
                <ChevronUp className="h-3.5 w-3.5" strokeWidth={1.5} />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.5} />
              )}
            </button>

            {isManualWork(item) && (
              <button
                type="button"
                data-testid="link-manual-source-btn"
                onClick={() => {
                  const defaultQ = String(
                    item.isbnOrDoi || `${item.title || ''} ${item.creator || item.author || ''}`.trim()
                  ).trim();
                  setLinkSearchQuery(defaultQ);
                  setLinkSearchError('');
                  setLinkSearchResults([]);
                  setLinkSourceModalOpen(true);
                  if (defaultQ.length >= 2) {
                    setLinkSearchLoading(true);
                    const runner =
                      workDomain === 'reading' && looksLikeIsbnInput(defaultQ)
                        ? fetchBookByIsbn(defaultQ)
                        : workDomain === 'cinema'
                          ? searchCinemaMedia(defaultQ, { tmdbApiKey: tmdbKey })
                          : searchWorksByDomain(workDomain, defaultQ);
                    Promise.resolve(runner)
                      .then((out) => {
                        setLinkSearchResults(Array.isArray(out?.results) ? out.results.slice(0, 12) : []);
                        if (!out?.ok && out?.error) setLinkSearchError(out.error);
                      })
                      .catch(() => setLinkSearchError('Falha ao buscar nas fontes externas.'))
                      .finally(() => setLinkSearchLoading(false));
                  }
                }}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-accent/60 bg-accent/10 px-4 py-2.5 text-xs font-semibold text-ink transition-colors hover:border-accent hover:text-accent"
              >
                <Link2 className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />
                <span>Vincular a uma fonte</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsEditDrawerOpen(true)}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-line bg-app px-4 py-2.5 text-xs font-semibold text-ink transition-colors hover:border-accent hover:text-accent"
            >
              <SlidersHorizontal className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />
              <span>Editar Metadados</span>
            </button>
          </div>

          {top4PickerOpen && (
            <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-app p-3">
              <span className="text-xs font-medium text-muted">
                Escolha a posição na vitrine Favoritos da Vida:
              </span>
              {[1, 2, 3, 4].map((slot) => {
                const active = currentFavRank === slot;
                return (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => handleToggleTop4(slot)}
                    className={`min-h-[44px] min-w-[44px] rounded-xl border px-3 text-xs font-semibold tabular-nums transition-colors ${
                      active
                        ? 'border-accent bg-accent text-accent-ink'
                        : 'border-line bg-card text-ink hover:border-accent'
                    }`}
                  >
                    Top #{slot}
                  </button>
                );
              })}
            </div>
          )}

          {/* Seletor Rápido de Status Editorial */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Status da obra">
            {statuses.map((status) => {
              const isSelected = item.inBacklog && item.status === status.id;
              return (
                <button
                  key={status.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => handleStatusSelect(status.id)}
                  className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-medium transition-colors ${
                    isSelected
                      ? 'border-accent bg-accent/15 text-ink'
                      : 'border-line bg-app text-muted hover:text-ink'
                  }`}
                >
                  <span className={`h-2 w-2 rounded-full ${status.dotClass}`} />
                  <span>{status.label}</span>
                </button>
              );
            })}
          </div>

          {pendingPagesFillPrompt &&
            workDomain === 'reading' &&
            Number(item.totalPages) > 0 &&
            Number(item.pagesRead || 0) < Number(item.totalPages) && (
              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-accent/40 bg-accent/10 px-3.5 py-2.5 text-xs">
                <span className="text-ink">
                  Preencher páginas lidas com o total ({item.totalPages} págs)?
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const prevPages = Number(item.pagesRead || 0);
                      const prevProgress = Number(item.progress || 0);
                      onUpdateItem(item.id, {
                        pagesRead: Number(item.totalPages),
                        progress: 100,
                      });
                      setPendingPagesFillPrompt(false);
                      showToast({
                        message: `Páginas lidas atualizadas para ${item.totalPages}/${item.totalPages}.`,
                        type: 'success',
                        duration: 6000,
                        action: {
                          label: 'Desfazer',
                          onClick: () =>
                            onUpdateItem(item.id, {
                              pagesRead: prevPages,
                              progress: prevProgress,
                            }),
                        },
                      });
                    }}
                    className="min-h-[36px] rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink hover:opacity-90"
                  >
                    Confirmar ({item.totalPages} págs)
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingPagesFillPrompt(false)}
                    className="min-h-[36px] rounded-lg border border-line bg-card px-3 py-1.5 text-xs font-medium text-muted hover:text-ink"
                  >
                    Manter em {Number(item.pagesRead || 0)}
                  </button>
                </div>
              </div>
            )}
        </div>
      </header>

      {/* CORPO DA PÁGINA: 3 ABAS EDITORIAIS LIMPAS */}
      <main className="mx-auto max-w-5xl px-4 py-6 pb-20 sm:px-6 space-y-6">
        <nav
          aria-label="Seções da página da obra"
          className="grid grid-cols-3 gap-1.5 rounded-2xl border border-line bg-card p-1.5"
        >
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className={`flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
              activeTab === 'overview'
                ? 'bg-accent text-accent-ink'
                : 'text-muted hover:text-ink'
            }`}
          >
            <Film className="h-4 w-4 shrink-0" strokeWidth={1.5} />
            <span className="truncate">Visão Geral</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('episodes')}
            className={`flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
              activeTab === 'episodes'
                ? 'bg-accent text-accent-ink'
                : 'text-muted hover:text-ink'
            }`}
          >
            <ListVideo className="h-4 w-4 shrink-0" strokeWidth={1.5} />
            <span className="truncate">
              {workDomain === 'reading'
                ? 'Leitura & Páginas'
                : workDomain === 'games'
                  ? 'Plataforma & Horas'
                  : workDomain === 'music'
                    ? 'Faixas & Audições'
                    : episodic
                      ? 'Temporadas & Episódios'
                      : 'Sessão & Duração'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('diary')}
            className={`flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors ${
              activeTab === 'diary'
                ? 'bg-accent text-accent-ink'
                : 'text-muted hover:text-ink'
            }`}
          >
            <Quote className="h-4 w-4 shrink-0" strokeWidth={1.5} />
            <span className="truncate">
              {workDomain === 'cinema' ? <>Cenas &amp; Diário</> : workVocab.notesTabLabel}
            </span>
            {quotesCount > 0 && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${
                  activeTab === 'diary'
                    ? 'bg-black/20 text-accent-ink'
                    : 'bg-accent/15 text-accent'
                }`}
              >
                {quotesCount}
              </span>
            )}
          </button>
        </nav>

        {/* ABA 1 — VISÃO GERAL (Zero inputs abertos) */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Sinopse Editorial (max-width: 68ch, line-height: 1.65) */}
            <section
              aria-label="Sinopse editorial"
              className="rounded-2xl border border-line bg-card p-5 space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
                  Sinopse Editorial
                </h2>
                <button
                  type="button"
                  onClick={() => setIsEditDrawerOpen(true)}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-line bg-app px-3 py-1.5 text-[11px] font-medium text-muted hover:border-accent hover:text-ink"
                >
                  <Edit3 className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                  <span>{synopsisText ? 'Editar sinopse' : 'Adicionar sinopse'}</span>
                </button>
              </div>

              {synopsisText ? (
                <div className="space-y-2">
                  <p
                    className={`text-sm text-ink ${
                      !synopsisExpanded && isLongSynopsis ? 'line-clamp-4' : ''
                    }`}
                    style={{ maxWidth: '68ch', lineHeight: 1.65 }}
                  >
                    {synopsisText}
                  </p>
                  {isLongSynopsis && (
                    <button
                      type="button"
                      onClick={() => setSynopsisExpanded((v) => !v)}
                      className="inline-flex min-h-[44px] items-center gap-1 text-xs font-semibold text-accent hover:underline"
                    >
                      <span>
                        {synopsisExpanded ? 'Recolher sinopse' : 'Ler sinopse completa'}
                      </span>
                    </button>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted" style={{ maxWidth: '68ch', lineHeight: 1.6 }}>
                  Nenhuma sinopse registrada ainda para esta obra. Use o botão Editar Metadados caso queira redigir ou autopreencher a premissa.
                </p>
              )}
            </section>

            {/* Notas do Público / Ficha do Domínio & Sua Avaliação Pessoal */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-line bg-card p-4">
                {workDomain === 'cinema' ? (
                  <Suspense fallback={<div className="h-24 animate-pulse rounded-[6px] bg-app" />}>
                    <ExternalRatingsPanel
                      item={item}
                      loading={ratingsLoading}
                      failedSources={ratingsMeta.failedSources}
                      omdbMissingKey={ratingsMeta.omdbMissingKey}
                      isOfflineCache={ratingsMeta.isOfflineCache}
                      cacheDateLabel={ratingsMeta.cacheDateLabel}
                      hasAttempted={ratingsMeta.hasAttempted}
                      onRetryRefresh={() => {
                        autoEnrichedIdsRef.current.add(item.id);
                        runEnrichmentForWork(item, { forceRefresh: true });
                      }}
                      onOpenApiSettings={() => {
                        onClose?.();
                        onOpenGeminiSettings?.();
                      }}
                    />
                  </Suspense>
                ) : (
                  <div className="space-y-3 p-1">
                    <div className="flex items-center justify-between">
                      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
                        Ficha · {domainMeta.label}
                      </h2>
                      <span className="rounded-[4px] border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">
                        {workFormatLabel}
                      </span>
                    </div>
                    {workDomain === 'reading' && (
                      <dl className="grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-lg border border-line bg-app p-2.5">
                          <dt className="text-[10px] text-subtle">Progresso</dt>
                          <dd className="mt-0.5 font-semibold tabular-nums text-ink">
                            Pág. {Number(item.pagesRead || 0)}
                            {Number(item.totalPages) > 0 ? ` / ${item.totalPages}` : ''}
                          </dd>
                        </div>
                        <div className="rounded-lg border border-line bg-app p-2.5">
                          <dt className="text-[10px] text-subtle">Capítulos</dt>
                          <dd className="mt-0.5 font-semibold tabular-nums text-ink">
                            {Number(item.chaptersRead || 0)} cap.
                          </dd>
                        </div>
                        <div className="col-span-2 rounded-lg border border-line bg-app p-2.5">
                          <dt className="text-[10px] text-subtle">Formato</dt>
                          <dd className="mt-0.5 font-semibold text-ink">
                            {item.bookFormat || 'Físico'}
                          </dd>
                        </div>
                      </dl>
                    )}
                    {workDomain === 'games' && (() => {
                      const fichaCampaign = formatGameCampaignTime(item);
                      const fichaAch = formatGameAchievementsSummary(item.achievements);
                      const origPlats = Array.isArray(item.originalPlatforms)
                        ? item.originalPlatforms
                        : [];
                      const parentName =
                        item.versionParent?.name || item.parentGame?.name || '';
                      return (
                        <dl className="grid grid-cols-2 gap-2 text-xs">
                          <div className="rounded-lg border border-line bg-app p-2.5">
                            <dt className="text-[10px] text-subtle">Plataforma Jogada</dt>
                            <dd className="mt-0.5 font-semibold text-ink">
                              {item.platform || GAME_PLATFORM_UNSET_LABEL}
                            </dd>
                            {origPlats.length > 0 && (
                              <p className="mt-0.5 text-[10px] text-subtle">
                                Original: {origPlats.join(', ')}
                              </p>
                            )}
                          </div>
                          <div className="rounded-lg border border-line bg-app p-2.5">
                            <dt className="text-[10px] text-subtle">Edição</dt>
                            <dd className="mt-0.5 font-semibold text-accent">
                              {normalizeGameEditionType(item.editionType)}
                            </dd>
                            {parentName && (
                              <p className="mt-0.5 truncate text-[10px] text-subtle">
                                Base: {parentName}
                              </p>
                            )}
                          </div>
                          <div className="rounded-lg border border-line bg-app p-2.5">
                            <dt className="text-[10px] text-subtle">Seu Tempo Jogado</dt>
                            <dd className="mt-0.5 font-semibold tabular-nums text-ink">
                              {Number(item.hoursPlayed || 0)}h
                            </dd>
                            {fichaCampaign && (
                              <p className="mt-0.5 text-[10px] text-subtle">
                                Média: {fichaCampaign.label} (
                                {fichaCampaign.isFromIgdb
                                  ? 'IGDB'
                                  : fichaCampaign.isFromRawg
                                    ? 'RAWG'
                                    : 'Manual'}
                                )
                              </p>
                            )}
                          </div>
                          <div className="rounded-lg border border-line bg-app p-2.5">
                            <dt className="text-[10px] text-subtle">Conclusão</dt>
                            <dd className="mt-0.5 font-semibold text-ink">
                              {item.completionType || GAME_COMPLETION_TYPES[0]}
                            </dd>
                            {item.storeOrLauncher && (
                              <p className="mt-0.5 truncate text-[10px] text-subtle">
                                Origem: {item.storeOrLauncher}
                              </p>
                            )}
                          </div>
                          {fichaAch && (
                            <div className="col-span-2 rounded-lg border border-line bg-app p-2.5">
                              <dt className="text-[10px] text-subtle">
                                Troféus / Conquistas ({formatAchievementsSourceLabel(fichaAch.source)})
                              </dt>
                              <dd className="mt-0.5 font-semibold tabular-nums text-ink">
                                {fichaAch.label}
                              </dd>
                            </div>
                          )}
                          {item.masterpieceJustification && (
                            <div className="col-span-2 rounded-lg border border-accent/40 bg-accent/10 p-2.5">
                              <dt className="text-[10px] font-semibold text-accent">
                                Justificativa · Nota 11 (Obra-Prima)
                              </dt>
                              <dd className="mt-0.5 text-xs text-ink">
                                {item.masterpieceJustification}
                              </dd>
                            </div>
                          )}
                        </dl>
                      );
                    })()}
                    {workDomain === 'music' && (
                      <dl className="grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-lg border border-line bg-app p-2.5">
                          <dt className="text-[10px] text-subtle">Formato</dt>
                          <dd className="mt-0.5 truncate font-semibold text-ink">
                            {item.releaseFormat ||
                              (item.workType === 'track' ? 'Faixa Individual' : 'Álbum de Estúdio')}
                          </dd>
                        </div>
                        <div className="rounded-lg border border-line bg-app p-2.5">
                          <dt className="text-[10px] text-subtle">Audições</dt>
                          <dd className="mt-0.5 font-semibold tabular-nums text-ink">
                            {Number(item.listenCount || 0)} audições
                          </dd>
                        </div>
                        {item.workType === 'track' ? (
                          <div className="col-span-2 rounded-lg border border-line bg-app p-2.5">
                            <dt className="text-[10px] text-subtle">Álbum vinculado</dt>
                            <dd className="mt-0.5 truncate font-semibold text-accent">
                              {item.albumName || 'Single / Faixa avulsa'}
                            </dd>
                          </div>
                        ) : (
                          <div className="col-span-2 rounded-lg border border-line bg-app p-2.5">
                            <dt className="text-[10px] text-subtle">Faixa favorita</dt>
                            <dd className="mt-0.5 truncate font-semibold text-accent">
                              {item.favoriteTrack || 'Toque na aba Faixas & Audições para escolher'}
                            </dd>
                          </div>
                        )}
                      </dl>
                    )}
                  </div>
                )}
              </div>

              <section
                aria-label="Sua avaliação pessoal"
                className="rounded-[6px] border border-line bg-card p-5 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
                      Sua Avaliação Pessoal
                    </h2>
                    <p className="mt-0.5 text-xs text-subtle">
                      5 estrelas com meia estrela · avaliação opcional por 5 critérios
                    </p>
                  </div>
                </div>

                <StarRatingPicker
                  domain={workDomain}
                  rating={item.rating}
                  ratingSource={item.ratingSource}
                  reviewCriteria={item.reviewCriteria}
                  reviewCriteria5={item.reviewCriteria5}
                  ratingManualOverride={item.ratingManualOverride}
                  lifeWork={item.lifeWork}
                  gameRating11={item.gameRating11}
                  onChange={(patch) => {
                    onUpdateItem(item.id, {
                      ...patch,
                      verdict:
                        patch.lifeWork
                          ? 'Obra-Prima'
                          : patch.rating !== null && patch.rating !== undefined
                            ? getVerdictForScore(patch.rating)
                            : null,
                    });
                    playTactileSound('page');
                  }}
                />

                <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                  <button
                    type="button"
                    onClick={() => onUpdateItem(item.id, { isFavorite: !item.isFavorite })}
                    className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-medium transition-colors ${
                      item.isFavorite
                        ? 'border-accent/60 bg-accent/15 text-accent'
                        : 'border-line bg-app text-muted hover:text-ink'
                    }`}
                  >
                    <Heart
                      className="h-3.5 w-3.5"
                      fill={item.isFavorite ? 'currentColor' : 'none'}
                      strokeWidth={1.5}
                    />
                    <span>{ui.detail.favoriteLabel}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onUpdateItem(item.id, { wantToReread: !item.wantToReread })}
                    className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-medium transition-colors ${
                      item.wantToReread
                        ? 'border-accent/60 bg-accent/15 text-accent'
                        : 'border-line bg-app text-muted hover:text-ink'
                    }`}
                  >
                    <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} />
                    <span>
                      {item.wantToReread
                        ? workVocab.revisitActiveLabel
                        : workVocab.revisitLabel}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onUpdateItem(item.id, { isWishlist: !item.isWishlist })}
                    className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-medium transition-colors ${
                      item.isWishlist
                        ? 'border-accent/60 bg-accent/15 text-accent'
                        : 'border-line bg-app text-muted hover:text-ink'
                    }`}
                  >
                    <Bookmark
                      className="h-3.5 w-3.5"
                      fill={item.isWishlist ? 'currentColor' : 'none'}
                      strokeWidth={1.5}
                    />
                    <span>{workVocab.wishlistToggleLabel}</span>
                  </button>
                </div>
              </section>
            </div>

            {/* Atmosfera, Gêneros, Tags & Especificações (Modo Leitura Limpo) */}
            <section
              aria-label="Atmosfera, gêneros e ficha técnica"
              className="rounded-2xl border border-line bg-card p-5 space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4 text-accent" strokeWidth={1.5} />
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
                    Atmosfera, Gêneros &amp; Ficha Técnica
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setIsEditDrawerOpen(true)}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-line bg-app px-3 py-1.5 text-[11px] font-medium text-muted hover:border-accent hover:text-ink"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                  <span>Personalizar tags</span>
                </button>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {genres.map((g) => (
                  <span
                    key={`genre-${g}`}
                    className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-medium text-ink"
                  >
                    {g}
                  </span>
                ))}
                {moods.map((m) => (
                  <span
                    key={`mood-${m}`}
                    className="rounded-full border border-line bg-app px-3 py-1 text-xs font-medium text-muted"
                  >
                    {m}
                  </span>
                ))}
                {tags.map((t) => (
                  <span
                    key={`tag-${t}`}
                    className="rounded-full border border-line bg-app px-2.5 py-1 text-xs text-subtle"
                  >
                    #{t}
                  </span>
                ))}
                {item.mediaFormat && (
                  <span className="rounded-full border border-line bg-app px-3 py-1 text-xs text-muted">
                    Mídia: {item.mediaFormat}
                  </span>
                )}
                {item.audioFormat && (
                  <span className="rounded-full border border-line bg-app px-3 py-1 text-xs text-muted">
                    {item.audioFormat}
                  </span>
                )}
                {genres.length === 0 && moods.length === 0 && tags.length === 0 && (
                  <p className="text-xs text-muted">
                    Nenhum gênero ou marcador de atmosfera associado ainda.
                  </p>
                )}
              </div>

              {item.loanedTo && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-app px-3.5 py-2.5 text-xs">
                  <span className="inline-flex items-center gap-1.5 text-ink">
                    <UserCheck className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                    <span>
                      Emprestado para <strong>{item.loanedTo}</strong>
                    </span>
                  </span>
                  {isLoanOverdue(item) && (
                    <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-500">
                      <AlertCircle className="h-3 w-3" strokeWidth={1.5} />
                      <span>Emprestado há +30 dias</span>
                    </span>
                  )}
                </div>
              )}
            </section>

            {/* Seção recolhida "Mais detalhes" (campos avançados saem do fluxo rápido) */}
            <section
              aria-label="Mais detalhes da obra"
              className="rounded-2xl border border-line bg-card p-4"
            >
              <button
                type="button"
                aria-expanded={moreDetailsOpen}
                onClick={() => setMoreDetailsOpen((v) => !v)}
                className="flex min-h-[44px] w-full items-center justify-between gap-2 text-left"
              >
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                    Mais detalhes
                  </span>
                  <p className="text-[11px] text-subtle">
                    {workDomain === 'reading'
                      ? 'ISBN/DOI, citação marcante, editora e título original'
                      : workDomain === 'games'
                        ? 'Loja/launcher, build/personagem, horas detalhadas e título original'
                        : workDomain === 'music'
                          ? 'Subgênero, selo, álbum vinculado e título original'
                          : 'Título original, estúdio, franquia e data de conclusão'}
                  </p>
                </div>
                {moreDetailsOpen ? (
                  <ChevronUp className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.5} />
                ) : (
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.5} />
                )}
              </button>

              {moreDetailsOpen && (
                <div className="mt-3 space-y-3 border-t border-line pt-3">
                  <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                    <div className="rounded-lg border border-line bg-app p-2.5">
                      <dt className="text-[10px] text-subtle">Título original</dt>
                      <dd className="mt-0.5 font-semibold text-ink">
                        {item.originalTitle || '—'}
                      </dd>
                    </div>
                    <div className="rounded-lg border border-line bg-app p-2.5">
                      <dt className="text-[10px] text-subtle">
                        {workDomain === 'cinema' ? 'Estúdio / Rede' : 'Selo / Editora / Publicadora'}
                      </dt>
                      <dd className="mt-0.5 font-semibold text-ink">
                        {item.studio ? (
                          <button
                            type="button"
                            onClick={() =>
                              setActiveEntity({
                                name: item.studio,
                                role: 'studio',
                                domain: workDomain,
                              })
                            }
                            className="text-left underline-offset-2 hover:text-accent hover:underline"
                          >
                            {item.studio}
                          </button>
                        ) : (
                          '—'
                        )}
                      </dd>
                    </div>
                    {workDomain === 'reading' && (
                      <>
                        <div className="rounded-lg border border-line bg-app p-2.5">
                          <dt className="text-[10px] text-subtle">ISBN / DOI</dt>
                          <dd className="mt-0.5 truncate font-semibold tabular-nums text-ink">
                            {item.isbnOrDoi || '—'}
                          </dd>
                        </div>
                        <div className="rounded-lg border border-line bg-app p-2.5">
                          <dt className="text-[10px] text-subtle">Volume / Data de término</dt>
                          <dd className="mt-0.5 font-semibold tabular-nums text-ink">
                            {[item.seriesVolume && `Vol. ${item.seriesVolume}`, item.completedDate || item.completedAt]
                              .filter(Boolean)
                              .join(' · ') || '—'}
                          </dd>
                        </div>
                        {item.workUrl && (
                          <div className="sm:col-span-2 rounded-lg border border-line bg-app p-2.5">
                            <dt className="text-[10px] text-subtle">Link da obra</dt>
                            <dd className="mt-0.5 truncate text-xs">
                              <a
                                href={item.workUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-medium text-accent underline underline-offset-2 hover:opacity-85"
                              >
                                {item.workUrl}
                              </a>
                            </dd>
                          </div>
                        )}
                        <div className="sm:col-span-2 rounded-lg border border-line bg-app p-2.5">
                          <dt className="text-[10px] text-subtle">Citação marcante</dt>
                          <dd className="mt-0.5 text-xs text-ink">
                            {item.favoriteScene || '—'}
                          </dd>
                        </div>
                      </>
                    )}
                    {workDomain === 'games' && (
                      <>
                        <div className="rounded-lg border border-line bg-app p-2.5">
                          <dt className="text-[10px] text-subtle">Loja / Launcher</dt>
                          <dd className="mt-0.5 font-semibold text-ink">
                            {item.storeOrLauncher || '—'}
                          </dd>
                        </div>
                        <div className="rounded-lg border border-line bg-app p-2.5">
                          <dt className="text-[10px] text-subtle">Build / Personagem / Time</dt>
                          <dd className="mt-0.5 font-semibold text-ink">
                            {item.buildOrCharacter || '—'}
                          </dd>
                        </div>
                        <div className="rounded-lg border border-line bg-app p-2.5">
                          <dt className="text-[10px] text-subtle">Horas jogadas</dt>
                          <dd className="mt-0.5 font-semibold tabular-nums text-ink">
                            {Number(item.hoursPlayed || 0)}h
                          </dd>
                        </div>
                        <div className="rounded-lg border border-line bg-app p-2.5">
                          <dt className="text-[10px] text-subtle">Data de término</dt>
                          <dd className="mt-0.5 font-semibold tabular-nums text-ink">
                            {item.completedDate || item.completedAt || '—'}
                          </dd>
                        </div>
                        {(() => {
                          const campaignInfo = formatGameCampaignTime(item);
                          const comp100Info = formatGameCompletion100Time(item);
                          const franchiseSug = suggestGameFranchiseLink(item, allItems);
                          return (
                            <div
                              data-testid="games-more-details-depth"
                              className="sm:col-span-2 grid grid-cols-1 gap-2 sm:grid-cols-2 border-t border-line pt-2"
                            >
                              <div className="rounded-lg border border-line bg-app p-2.5 space-y-1">
                                <dt className="text-[10px] text-subtle">
                                  Tempo médio de campanha vs Seu tempo
                                </dt>
                                <dd className="font-semibold tabular-nums text-ink">
                                  {campaignInfo ? campaignInfo.label : 'Não informado'}
                                  <span className="ml-2 text-xs font-normal text-muted">
                                    (Seu: {Number(item.hoursPlayed || 0)}h)
                                  </span>
                                </dd>
                                <p className="text-[10px] text-subtle">
                                  {campaignInfo
                                    ? `Fonte: ${campaignInfo.sourceLabel}`
                                    : 'Consulte IGDB/RAWG ou informe manualmente em Editar'}
                                </p>
                                <button
                                  type="button"
                                  disabled={rawgLoading}
                                  data-testid="games-fetch-rawg-btn"
                                  onClick={async () => {
                                    setRawgLoading(true);
                                    try {
                                      const res = await fetchGameDepthWithFallback(item);
                                      if (res.notConfigured && !res.ok) {
                                        showToast({
                                          message:
                                            'IGDB e RAWG não configurados no servidor. Você pode editar o tempo manualmente em Mais detalhes.',
                                          type: 'info',
                                        });
                                      } else if (res.ok && res.data) {
                                        const d = res.data;
                                        const nextPlatforms = Array.from(
                                          new Set([
                                            ...(Array.isArray(item.platforms) ? item.platforms : []),
                                            ...(Array.isArray(d.platforms) ? d.platforms : []),
                                          ])
                                        );
                                        const patch = {
                                          ...(d.igdbId ? { igdbId: d.igdbId } : {}),
                                          ...(d.rawgId ? { rawgId: d.rawgId } : {}),
                                          ...(d.campaignTimeHours !== undefined &&
                                          d.campaignTimeHours !== null
                                            ? {
                                                campaignTimeHours: d.campaignTimeHours,
                                                campaignTimeSource: d.campaignTimeSource,
                                              }
                                            : {}),
                                          ...(d.rawgPlaytimeHours !== undefined &&
                                          d.rawgPlaytimeHours !== null
                                            ? {
                                                rawgPlaytimeHours: d.rawgPlaytimeHours,
                                                rawgPlaytimeSource: d.rawgPlaytimeSource,
                                              }
                                            : {}),
                                          ...(d.completion100Hours !== undefined &&
                                          d.completion100Hours !== null
                                            ? {
                                                completion100Hours: d.completion100Hours,
                                                completion100Source: d.completion100Source,
                                              }
                                            : {}),
                                          ...(Array.isArray(d.originalPlatforms) &&
                                          d.originalPlatforms.length > 0
                                            ? { originalPlatforms: d.originalPlatforms }
                                            : {}),
                                          ...(nextPlatforms.length > 0
                                            ? { platforms: nextPlatforms }
                                            : {}),
                                          ...(d.parentGame ? { parentGame: d.parentGame } : {}),
                                          ...(d.versionParent
                                            ? { versionParent: d.versionParent }
                                            : {}),
                                          ...(!item.franchiseName && d.franchiseName
                                            ? { franchiseName: d.franchiseName }
                                            : {}),
                                        };
                                        onUpdateItem(item.id, patch);
                                        const hoursMsg =
                                          d.campaignTimeHours ?? d.rawgPlaytimeHours ?? null;
                                        showToast({
                                          message:
                                            hoursMsg !== null
                                              ? `Metadados atualizados via ${res.source?.toUpperCase() || 'API'} (${hoursMsg}h).`
                                              : `Jogo encontrado via ${res.source?.toUpperCase() || 'API'}, sem tempo médio informado.`,
                                          type: 'success',
                                        });
                                      } else {
                                        showToast({
                                          message:
                                            'Não foi possível consultar IGDB ou RAWG agora.',
                                          type: 'info',
                                        });
                                      }
                                    } finally {
                                      setRawgLoading(false);
                                    }
                                  }}
                                  className="mt-1 inline-flex min-h-[44px] items-center rounded-[6px] border border-line bg-card px-2.5 text-[11px] font-medium text-ink hover:border-accent disabled:opacity-55"
                                >
                                  {rawgLoading ? 'Consultando fontes...' : 'Atualizar IGDB / RAWG'}
                                </button>
                              </div>

                              <div className="rounded-lg border border-line bg-app p-2.5 space-y-1">
                                <dt className="text-[10px] text-subtle">Tempo 100%</dt>
                                <dd className="font-semibold tabular-nums text-ink">
                                  {comp100Info.label}
                                </dd>
                                <p className="text-[10px] text-subtle">
                                  {comp100Info.sourceLabel}
                                </p>
                              </div>

                              <p className="sm:col-span-2 text-right text-[10px] text-subtle">
                                Atribuição:{' '}
                                <a
                                  href={GAME_ATTRIBUTION_LINKS.igdb.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="underline underline-offset-2 hover:text-ink"
                                >
                                  {GAME_ATTRIBUTION_LINKS.igdb.label}
                                </a>{' '}
                                ·{' '}
                                <a
                                  href={GAME_ATTRIBUTION_LINKS.rawg.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="underline underline-offset-2 hover:text-ink"
                                >
                                  {GAME_ATTRIBUTION_LINKS.rawg.label}
                                </a>
                              </p>

                              {franchiseSug.suggestedFranchiseName &&
                                franchiseSug.suggestedFranchiseName !== (item.franchiseName || '') && (
                                  <div
                                    data-testid="games-franchise-suggestion"
                                    className="sm:col-span-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-app p-2.5"
                                  >
                                    <div className="min-w-0">
                                      <p className="text-[10px] text-subtle">
                                        Sugestão de vínculo de franquia (confirmação manual)
                                      </p>
                                      <p className="truncate text-xs font-semibold text-ink">
                                        {franchiseSug.suggestedFranchiseName}
                                        {franchiseSug.relatedGames.length > 0
                                          ? ` (${franchiseSug.relatedGames.length} relacionado(s) no catálogo)`
                                          : ''}
                                      </p>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        onUpdateItem(item.id, {
                                          franchiseName: franchiseSug.suggestedFranchiseName,
                                        });
                                        showToast({
                                          message: `Franquia vinculada manualmente: ${franchiseSug.suggestedFranchiseName}`,
                                          type: 'success',
                                        });
                                      }}
                                      className="inline-flex min-h-[44px] shrink-0 items-center rounded-[6px] border border-accent bg-accent/15 px-3 text-xs font-semibold text-ink hover:bg-accent hover:text-accent-ink"
                                    >
                                      Confirmar franquia
                                    </button>
                                  </div>
                                )}
                            </div>
                          );
                        })()}
                      </>
                    )}
                    {workDomain === 'music' && (
                      <>
                        <div className="rounded-lg border border-line bg-app p-2.5">
                          <dt className="text-[10px] text-subtle">Subgênero</dt>
                          <dd className="mt-0.5 font-semibold text-ink">
                            {item.subgenre || '—'}
                          </dd>
                        </div>
                        <div className="rounded-lg border border-line bg-app p-2.5">
                          <dt className="text-[10px] text-subtle">Álbum vinculado</dt>
                          <dd className="mt-0.5 font-semibold text-ink">
                            {item.albumName || '—'}
                          </dd>
                        </div>
                      </>
                    )}
                    {workDomain === 'cinema' && (
                      <>
                        <div className="rounded-lg border border-line bg-app p-2.5">
                          <dt className="text-[10px] text-subtle">Franquia / Universo</dt>
                          <dd className="mt-0.5 font-semibold text-ink">
                            {item.franchiseName || item.seriesName || '—'}
                          </dd>
                        </div>
                        <div className="rounded-lg border border-line bg-app p-2.5">
                          <dt className="text-[10px] text-subtle">Data de conclusão</dt>
                          <dd className="mt-0.5 font-semibold tabular-nums text-ink">
                            {item.completedDate || item.completedAt || '—'}
                          </dd>
                        </div>
                      </>
                    )}
                  </dl>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setEditMoreDetailsOpen(true);
                        setIsEditDrawerOpen(true);
                      }}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-line bg-app px-3 text-xs font-medium text-ink hover:border-accent hover:text-accent"
                    >
                      <Edit3 className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                      <span>Editar mais detalhes</span>
                    </button>
                  </div>
                </div>
              )}
            </section>

            {/* Relação separada editionOf para Livros (v2.5.0 Fase A) */}
            {workDomain === 'reading' && (editionBaseWork || linkedBookEditions.length > 0) && (
              <section
                aria-label="Edições desta obra"
                data-testid="book-editions-relation"
                className="rounded-[6px] border border-line bg-card p-4 space-y-2.5"
              >
                {editionBaseWork && (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                        Edição vinculada
                      </p>
                      <button
                        type="button"
                        onClick={() => onSelectItem?.(editionBaseWork)}
                        className="mt-0.5 inline-flex min-h-[44px] items-center text-left font-editorial text-sm font-semibold text-ink hover:text-accent"
                      >
                        Edição de: {editionBaseWork.title}
                      </button>
                      <p className="text-[11px] text-subtle">
                        Conta nas estatísticas do autor sem alterar o progresso da obra base.
                      </p>
                    </div>
                  </div>
                )}

                {linkedBookEditions.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                      Outras edições catalogadas ({linkedBookEditions.length})
                    </p>
                    <div className="divide-y divide-line rounded-[6px] border border-line bg-app">
                      {linkedBookEditions.map((ed) => (
                        <button
                          key={ed.id}
                          type="button"
                          onClick={() => onSelectItem?.(ed)}
                          className="flex min-h-[44px] w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-card"
                        >
                          <span className="truncate font-editorial font-medium text-ink">
                            {ed.title}
                          </span>
                          <span className="shrink-0 text-[11px] tabular-nums text-subtle">
                            {[ed.bookFormat, ed.releaseYear].filter(Boolean).join(' · ') || 'Edição'}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* Radar de Franquia, Sagas & Universo (Cinema, Livros e Games) */}
            {(workDomain === 'cinema' || workDomain === 'reading' || workDomain === 'games') && (
              <Suspense fallback={null}>
                <FranchiseRadarPanel
                  item={item}
                  allItems={allItems}
                  franchise={franchise}
                  tmdbKey={tmdbKey}
                  onSelectItem={onSelectItem}
                  onQuickCatalogItem={onQuickCatalogItem}
                  onUpdateItem={onUpdateItem}
                  onShowToast={showToast}
                />
              </Suspense>
            )}
          </div>
        )}

        {/* ABA 2 — PROGRESSO DO DOMÍNIO / TEMPORADAS & EPISÓDIOS */}
        {activeTab === 'episodes' && (
          <div className="space-y-5">
            {workDomain === 'reading' ? (
              <section
                aria-label="Controle de progresso de leitura"
                className="rounded-2xl border border-line bg-card p-5 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-ink">
                      Progresso de Leitura ·{' '}
                      <span className="tabular-nums text-accent">
                        Pág. {Number(item.pagesRead || 0)}
                        {Number(item.totalPages) > 0 ? ` / ${item.totalPages}` : ''}
                      </span>
                    </h2>
                    <p className="mt-0.5 text-xs tabular-nums text-muted">
                      {[
                        item.bookFormat || 'Físico',
                        Number(item.chaptersRead) > 0 ? `${item.chaptersRead} capítulos` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => runDomainQuickAction('reading_pages')}
                      className="inline-flex min-h-[44px] items-center gap-1 rounded-xl border border-line bg-app px-3.5 py-2 text-xs font-semibold tabular-nums text-ink hover:border-accent"
                    >
                      <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                      <span>10 págs</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => runDomainQuickAction('reading_chapter')}
                      className="inline-flex min-h-[44px] items-center gap-1 rounded-xl border border-line bg-app px-3.5 py-2 text-xs font-semibold tabular-nums text-ink hover:border-accent"
                    >
                      <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                      <span>1 cap ({Number(item.chaptersRead || 0)})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const prevStatus = item.status;
                        const prevCompletedDate = item.completedDate || null;
                        handleStatusSelect('completed');
                        playTactileSound('complete');
                        showToast({
                          message: `"${item.title}" marcado como ${workVocab.statuses.completed}.`,
                          type: 'success',
                          duration: 6000,
                          action: {
                            label: 'Desfazer',
                            onClick: () => {
                              setPendingPagesFillPrompt(false);
                              onUpdateItem(item.id, {
                                status: prevStatus,
                                completedDate: prevCompletedDate,
                              });
                            },
                          },
                        });
                      }}
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-accent-ink hover:opacity-90"
                    >
                      <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
                      <span>Marcar como Lido</span>
                    </button>
                  </div>
                </div>

                <div className="space-y-3 border-t border-line pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] font-medium text-muted mr-1">Formato:</span>
                      {BOOK_FORMATS.map((fmt) => (
                        <button
                          key={fmt}
                          type="button"
                          onClick={() => onUpdateItem(item.id, { bookFormat: fmt })}
                          className={`min-h-[36px] rounded-lg border px-2.5 text-xs font-medium transition-colors ${
                            (item.bookFormat || BOOK_FORMATS[0]) === fmt
                              ? 'border-accent bg-accent/15 text-accent'
                              : 'border-line bg-app text-muted hover:text-ink'
                          }`}
                        >
                          {fmt}
                        </button>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => setIsEditDrawerOpen(true)}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-line bg-app px-3 text-xs font-medium text-muted hover:border-accent hover:text-ink"
                    >
                      <Edit3 className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                      <span>Editar páginas e detalhes</span>
                    </button>
                  </div>
                </div>
              </section>
            ) : workDomain === 'games' ? (
              <section
                aria-label="Controle de campanha e horas jogadas"
                className="rounded-2xl border border-line bg-card p-5 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-ink">
                      Plataforma &amp; Campanha ·{' '}
                      <span className="tabular-nums text-accent">
                        {item.platform || GAME_PLATFORM_UNSET_LABEL} · {Number(item.hoursPlayed || 0)}h
                      </span>
                    </h2>
                    <p className="mt-0.5 text-xs text-muted">
                      {[
                        item.editionType || GAME_EDITION_TYPES[0],
                        item.completionType || 'História Principal',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => runDomainQuickAction('games_30m')}
                      className="inline-flex min-h-[44px] items-center gap-1 rounded-xl border border-line bg-app px-3.5 py-2 text-xs font-semibold tabular-nums text-ink hover:border-accent"
                    >
                      <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                      <span>30 min</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => runDomainQuickAction('games_1h')}
                      className="inline-flex min-h-[44px] items-center gap-1 rounded-xl border border-line bg-app px-3.5 py-2 text-xs font-semibold tabular-nums text-ink hover:border-accent"
                    >
                      <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                      <span>1 h</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const prev = {
                          status: item.status,
                          completedAt: item.completedAt || null,
                          completedDate: item.completedDate || null,
                          progress: item.progress ?? 0,
                        };
                        onUpdateItem(item.id, {
                          status: 'completed',
                          completedAt: getTodayLocalISO(),
                          completedDate: getTodayLocalISO(),
                          progress: 100,
                        });
                        playTactileSound('complete');
                        showToast({
                          message: `"${item.title}" marcado como Zerado.`,
                          type: 'success',
                          duration: 6000,
                          action: {
                            label: 'Desfazer',
                            onClick: () => onUpdateItem(item.id, prev),
                          },
                        });
                      }}
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-accent-ink hover:opacity-90"
                    >
                      <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
                      <span>Marcar Zerado</span>
                    </button>
                  </div>
                </div>

                <div className="space-y-3 border-t border-line pt-4">
                  <div>
                    <span className="mb-1.5 block text-[11px] font-medium text-muted">
                      Plataforma Jogada
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => onUpdateItem(item.id, { platform: '' })}
                        className={`min-h-[36px] rounded-lg border px-2.5 text-xs font-medium transition-colors ${
                          !item.platform
                            ? 'border-accent bg-accent/15 text-accent'
                            : 'border-line bg-app text-muted hover:text-ink'
                        }`}
                      >
                        A definir
                      </button>
                      {Array.from(
                        new Set([
                          ...(Array.isArray(item.platforms) ? item.platforms : []),
                          ...(Array.isArray(item.originalPlatforms) ? item.originalPlatforms : []),
                          ...GAME_PLATFORMS,
                        ])
                      ).map((p) => {
                        const isOriginal =
                          Array.isArray(item.originalPlatforms) &&
                          item.originalPlatforms.includes(p);
                        return (
                          <button
                            key={p}
                            type="button"
                            onClick={() => onUpdateItem(item.id, { platform: p })}
                            className={`inline-flex min-h-[36px] items-center gap-1 rounded-lg border px-2.5 text-xs font-medium transition-colors ${
                              item.platform === p
                                ? 'border-accent bg-accent/15 text-accent'
                                : isOriginal
                                  ? 'border-accent/50 bg-app text-ink hover:border-accent'
                                  : 'border-line bg-app text-muted hover:text-ink'
                            }`}
                          >
                            <span>{p}</span>
                            {isOriginal && (
                              <span className="rounded-[3px] border border-current/30 px-1 py-0.5 text-[9px] uppercase">
                                Original
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <span className="mb-1.5 block text-[11px] font-medium text-muted">
                      Tipo de Edição
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {GAME_EDITION_TYPES.map((ed) => (
                        <button
                          key={ed}
                          type="button"
                          onClick={() => onUpdateItem(item.id, { editionType: ed })}
                          className={`min-h-[36px] rounded-lg border px-2.5 text-xs font-medium transition-colors ${
                            normalizeGameEditionType(item.editionType) === ed
                              ? 'border-accent bg-accent/15 text-accent'
                              : 'border-line bg-app text-muted hover:text-ink'
                          }`}
                        >
                          {ed}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Troféus & Conquistas — Manual/Offline, Steam e RetroAchievements (somente controles táteis no modo leitura) */}
                  {(() => {
                    const achSummary = formatGameAchievementsSummary(item.achievements);
                    const achUpdatedLabel = item.achievements?.updated_at
                      ? (() => {
                          const dt = new Date(item.achievements.updated_at);
                          return Number.isNaN(dt.getTime())
                            ? ''
                            : dt.toLocaleDateString('pt-BR', {
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric',
                              });
                        })()
                      : '';
                    const effectiveSteamAppId =
                      steamAppIdDraft || (item.ids?.steam ? String(item.ids.steam) : '');
                    const effectiveRaGameId =
                      raGameIdDraft ||
                      (item.ids?.retroachievements ? String(item.ids.retroachievements) : '');

                    return (
                      <div
                        data-testid="game-achievements-section"
                        className="rounded-[6px] border border-line bg-app p-3.5 space-y-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Trophy
                              className="h-3.5 w-3.5 shrink-0 text-accent"
                              strokeWidth={1.5}
                              aria-hidden="true"
                            />
                            <span className="text-xs font-semibold text-ink">
                              Troféus &amp; Conquistas
                            </span>
                            <span className="rounded-[4px] border border-line bg-card px-1.5 py-0.5 text-[10px] text-subtle">
                              {achSummary?.sourceLabel || formatAchievementsSourceLabel(achSourceTab)}
                            </span>
                          </div>
                          <span className="text-xs font-semibold tabular-nums text-accent">
                            {achSummary?.label || '0 obtidos'}
                          </span>
                        </div>

                        {achSummary && typeof achSummary.pct === 'number' && (
                          <div
                            className="h-1.5 w-full overflow-hidden rounded-full bg-line"
                            role="progressbar"
                            aria-valuenow={achSummary.pct}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label="Progresso de troféus e conquistas"
                          >
                            <div
                              className="h-full rounded-full bg-accent transition-all"
                              style={{ width: `${achSummary.pct}%` }}
                            />
                          </div>
                        )}

                        <div
                          role="tablist"
                          aria-label="Origem das conquistas"
                          className="flex flex-wrap gap-1.5"
                        >
                          {ACHIEVEMENT_SOURCE_OPTIONS.map((opt) => {
                            const active = achSourceTab === opt.id;
                            return (
                              <button
                                key={opt.id}
                                type="button"
                                role="tab"
                                aria-selected={active}
                                onClick={() => {
                                  setAchSourceTab(opt.id);
                                  setAchSyncFeedback({ type: 'idle', message: '' });
                                }}
                                className={`min-h-[36px] rounded-[6px] border px-2.5 text-[11px] font-medium transition-colors ${
                                  active
                                    ? 'border-accent bg-accent/15 text-accent'
                                    : 'border-line bg-card text-muted hover:text-ink'
                                }`}
                              >
                                {opt.id === 'manual' ? 'Manual / Console Offline' : opt.shortLabel}
                              </button>
                            );
                          })}
                        </div>

                        {achSourceTab === 'manual' && (
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                const cur = Number(item.achievements?.unlocked) || 0;
                                const tot = item.achievements?.total ?? null;
                                const patch = buildAchievementsSyncPatch(item, {
                                  source: 'manual',
                                  unlocked: Math.max(0, cur - 1),
                                  total: tot,
                                  updated_at: new Date().toISOString(),
                                });
                                if (patch) onUpdateItem(item.id, patch);
                              }}
                              className="min-h-[44px] min-w-[44px] rounded-[6px] border border-line bg-card px-2.5 text-xs font-semibold tabular-nums text-ink hover:border-accent"
                              aria-label="Diminuir troféu obtido"
                            >
                              -1
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const cur = Number(item.achievements?.unlocked) || 0;
                                const tot = item.achievements?.total ?? null;
                                const patch = buildAchievementsSyncPatch(item, {
                                  source: 'manual',
                                  unlocked: tot !== null ? Math.min(tot, cur + 1) : cur + 1,
                                  total: tot,
                                  updated_at: new Date().toISOString(),
                                });
                                if (patch) onUpdateItem(item.id, patch);
                              }}
                              className="min-h-[44px] min-w-[44px] rounded-[6px] border border-line bg-card px-2.5 text-xs font-semibold tabular-nums text-ink hover:border-accent"
                              aria-label="Adicionar troféu obtido"
                            >
                              +1
                            </button>
                            <button
                              type="button"
                              onClick={() => openAchievementsSheet('manual')}
                              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[6px] border border-line bg-card px-3 text-xs font-medium text-ink hover:border-accent"
                            >
                              <SlidersHorizontal className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                              <span>
                                Editar obtidos / total ({item.achievements?.unlocked ?? 0} /{' '}
                                {item.achievements?.total ?? '—'})
                              </span>
                            </button>
                          </div>
                        )}

                        {achSourceTab === 'steam' && (
                          <div className="space-y-2">
                            <p className="text-[11px] leading-relaxed text-muted">
                              {steamIdDraft
                                ? `SteamID ${steamIdDraft}${effectiveSteamAppId ? ` · AppID ${effectiveSteamAppId}` : ' · AppID detectado via biblioteca'}`
                                : 'Vincule seu SteamID64 para sincronizar conquistas via servidor (perfil público).'}
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                disabled={achSyncLoading}
                                onClick={() =>
                                  steamIdDraft
                                    ? handleSyncSteamAchievements()
                                    : openAchievementsSheet('steam')
                                }
                                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[6px] bg-accent px-3.5 text-xs font-semibold text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-55"
                              >
                                <RefreshCw
                                  className={`h-3.5 w-3.5 ${achSyncLoading ? 'animate-spin' : ''}`}
                                  strokeWidth={1.5}
                                />
                                <span>
                                  {achSyncLoading ? 'Sincronizando...' : 'Sincronizar conquistas'}
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={() => openAchievementsSheet('steam')}
                                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[6px] border border-line bg-card px-3 text-xs font-medium text-muted hover:border-accent hover:text-ink"
                              >
                                <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.5} />
                                <span>Configurar Steam</span>
                              </button>
                            </div>
                          </div>
                        )}

                        {achSourceTab === 'retroachievements' && (
                          <div className="space-y-2">
                            <p className="text-[11px] leading-relaxed text-muted">
                              {raUsernameDraft && effectiveRaGameId
                                ? `Usuário ${raUsernameDraft} · Game ID ${effectiveRaGameId}`
                                : 'Para emuladores (PS1, PS2, SNES, GBA, N64, PSP). Informe seu usuário e o Game ID.'}
                            </p>
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                disabled={achSyncLoading}
                                onClick={() =>
                                  raUsernameDraft && effectiveRaGameId
                                    ? handleSyncRetroAchievements()
                                    : openAchievementsSheet('retroachievements')
                                }
                                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[6px] bg-accent px-3.5 text-xs font-semibold text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-55"
                              >
                                <RefreshCw
                                  className={`h-3.5 w-3.5 ${achSyncLoading ? 'animate-spin' : ''}`}
                                  strokeWidth={1.5}
                                />
                                <span>
                                  {achSyncLoading ? 'Sincronizando...' : 'Sincronizar conquistas'}
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={() => openAchievementsSheet('retroachievements')}
                                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[6px] border border-line bg-card px-3 text-xs font-medium text-muted hover:border-accent hover:text-ink"
                              >
                                <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.5} />
                                <span>Configurar RetroAchievements</span>
                              </button>
                            </div>
                          </div>
                        )}

                        {(achSyncFeedback.message || achUpdatedLabel) && (
                          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/70 pt-2 text-[11px]">
                            <span
                              className={
                                achSyncFeedback.type === 'error'
                                  ? 'text-ink'
                                  : achSyncFeedback.type === 'success'
                                    ? 'text-accent'
                                    : 'text-muted'
                              }
                            >
                              {achSyncFeedback.message || 'Notas e comentários preservados ao sincronizar.'}
                            </span>
                            {achUpdatedLabel && (
                              <span className="tabular-nums text-[10px] text-subtle">
                                Atualizado em {achUpdatedLabel}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-1.5">
                      {GAME_COMPLETION_TYPES.map((ct) => (
                        <button
                          key={ct}
                          type="button"
                          onClick={() => onUpdateItem(item.id, { completionType: ct })}
                          className={`min-h-[36px] rounded-lg border px-2.5 text-xs font-medium transition-colors ${
                            (item.completionType || GAME_COMPLETION_TYPES[0]) === ct
                              ? 'border-accent bg-accent/15 text-accent'
                              : 'border-line bg-app text-muted hover:text-ink'
                          }`}
                        >
                          {ct}
                        </button>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setEditMoreDetailsOpen(true);
                        setIsEditDrawerOpen(true);
                      }}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-line bg-app px-3 text-xs font-medium text-muted hover:border-accent hover:text-ink"
                    >
                      <Edit3 className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                      <span>Mais detalhes / Editar</span>
                    </button>
                  </div>
                </div>
              </section>
            ) : workDomain === 'music' ? (
              <section
                aria-label="Tracklist e audições musicais"
                className="rounded-2xl border border-line bg-card p-5 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-ink">
                      Faixas &amp; Audições ·{' '}
                      <span className="tabular-nums text-accent">
                        {Number(item.listenCount || 0)} audições
                      </span>
                    </h2>
                    <p className="mt-0.5 text-xs text-muted">
                      {[item.releaseFormat || 'Álbum de Estúdio', item.favoriteTrack && `Fav.: ${item.favoriteTrack}`]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={subgenresLoading}
                      onClick={async () => {
                        setSubgenresLoading(true);
                        try {
                          const res = await fetchLastfmSubgenres({
                            artist: item.creator || item.director || '',
                            album: item.workType === 'album' ? item.title : item.albumName || '',
                          });
                          if (res.notConfigured) {
                            showToast({
                              message:
                                'Last.fm não configurado no servidor. Você pode editar subgêneros manualmente em Editar.',
                              type: 'info',
                            });
                          } else if (res.ok && res.tags.length > 0) {
                            const merged = updateEditableSubgenres(
                              Array.isArray(item.subgenres) ? item.subgenres : [],
                              { replaceWith: res.tags }
                            );
                            onUpdateItem(item.id, {
                              subgenres: merged,
                              subgenre: merged.join(', '),
                            });
                            showToast({
                              message: `Subgêneros sugeridos (Last.fm): ${merged.join(', ')}`,
                              type: 'success',
                            });
                          } else {
                            showToast({
                              message: 'Nenhuma tag acima do limite mínimo encontrada no Last.fm.',
                              type: 'info',
                            });
                          }
                        } finally {
                          setSubgenresLoading(false);
                        }
                      }}
                      data-testid="music-suggest-subgenres-btn"
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[6px] border border-line bg-app px-3 text-xs font-medium text-ink hover:border-accent disabled:opacity-55"
                    >
                      <span>{subgenresLoading ? 'Buscando...' : 'Sugerir subgêneros (Last.fm)'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => runDomainQuickAction('music_listen')}
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-semibold tabular-nums text-accent-ink hover:opacity-90"
                    >
                      <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                      <span>+1 audição</span>
                    </button>
                  </div>
                </div>

                {Array.isArray(item.tracks) && item.tracks.length > 0 ? (
                  <div className="space-y-1.5 border-t border-line pt-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[11px] font-medium text-muted">
                        Tracklist ({item.tracks.length} faixas — avalie cada faixa de 0 a 10 sem alterar sua estrela manual)
                      </p>
                      {(() => {
                        const derived = computeDerivedAverage({
                          ratings: Object.values(albumTrackRatings),
                          totalItems: item.tracks.length,
                          unit: 'track',
                        });
                        if (derived.average === null) return null;
                        return (
                          <span
                            data-testid="album-derived-track-average"
                            className="inline-flex flex-wrap items-center gap-1.5 rounded-[6px] border border-line bg-app px-2.5 py-1 text-[11px] font-medium tabular-nums text-ink"
                          >
                            <span>Média derivada: {derived.average.toFixed(1)}/10</span>
                            <span className="text-muted">({derived.coverageLabel})</span>
                            {derived.provisional && (
                              <span className="rounded-[4px] border border-line bg-card px-1.5 py-0.5 text-[10px] font-semibold text-muted">
                                provisória
                              </span>
                            )}
                          </span>
                        );
                      })()}
                    </div>
                    <div className="max-h-96 overflow-y-auto divide-y divide-line rounded-xl border border-line bg-app no-scrollbar">
                      {item.tracks.map((tr, idx) => {
                        const isFav = item.favoriteTrack === tr.title;
                        const trackKey = makeAlbumTrackKey(tr, idx);
                        const trackScore = albumTrackRatings[trackKey];
                        const pickerOpen = activeTrackRatingKey === trackKey;
                        return (
                          <div
                            key={`${tr.number || idx}-${tr.title}`}
                            className={`px-3 py-2 text-xs transition-colors ${
                              isFav ? 'bg-accent/10' : ''
                            }`}
                          >
                            <div className="flex min-h-[38px] items-center justify-between gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  const prevFav = item.favoriteTrack || '';
                                  const nextFav = isFav ? '' : tr.title;
                                  onUpdateItem(item.id, { favoriteTrack: nextFav });
                                  playTactileSound('page');
                                  showToast({
                                    message: nextFav
                                      ? `Faixa favorita: "${nextFav}".`
                                      : 'Faixa favorita removida.',
                                    type: 'info',
                                    duration: 5000,
                                    action: {
                                      label: 'Desfazer',
                                      onClick: () =>
                                        onUpdateItem(item.id, { favoriteTrack: prevFav }),
                                    },
                                  });
                                }}
                                title={
                                  isFav
                                    ? 'Remover destaque de faixa favorita'
                                    : 'Definir como faixa favorita'
                                }
                                className={`min-w-0 flex-1 truncate text-left ${
                                  isFav ? 'font-semibold text-accent' : 'text-ink hover:text-accent'
                                }`}
                              >
                                <span className="mr-2 tabular-nums text-subtle">
                                  {tr.number || idx + 1}.
                                </span>
                                {tr.title}
                              </button>

                              <div className="flex shrink-0 items-center gap-1.5">
                                {isFav && (
                                  <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-accent text-accent-ink">
                                    Favorita
                                  </span>
                                )}
                                <button
                                  type="button"
                                  aria-expanded={pickerOpen}
                                  aria-label={`Avaliar faixa ${tr.title}`}
                                  onClick={() =>
                                    setActiveTrackRatingKey(pickerOpen ? null : trackKey)
                                  }
                                  className={`min-h-[34px] rounded-lg border px-2 py-1 text-[11px] font-semibold tabular-nums transition-colors ${
                                    typeof trackScore === 'number'
                                      ? 'border-accent/50 bg-accent/15 text-accent'
                                      : 'border-line bg-card text-muted hover:border-accent hover:text-ink'
                                  }`}
                                >
                                  {typeof trackScore === 'number' ? `${trackScore}/10` : 'Nota'}
                                </button>
                              </div>
                            </div>

                            {pickerOpen && (
                              <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-line/60 pt-2">
                                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((sc) => (
                                  <button
                                    key={sc}
                                    type="button"
                                    onClick={() => {
                                      handleTrackRatingSelect(tr, idx, sc);
                                      setActiveTrackRatingKey(null);
                                    }}
                                    className={`min-h-[34px] min-w-[34px] rounded-lg border px-2 text-[11px] font-semibold tabular-nums transition-colors ${
                                      trackScore === sc
                                        ? 'border-accent bg-accent text-accent-ink'
                                        : 'border-line bg-card text-ink hover:border-accent'
                                    }`}
                                  >
                                    {sc}
                                  </button>
                                ))}
                                {typeof trackScore === 'number' && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      handleTrackRatingSelect(tr, idx, null);
                                      setActiveTrackRatingKey(null);
                                    }}
                                    className="min-h-[34px] rounded-lg border border-line bg-card px-2.5 text-[11px] text-muted hover:text-ink"
                                  >
                                    Limpar
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <p className="border-t border-line pt-3 text-xs text-muted">
                    Use Editar Metadados caso queira cadastrar sua faixa favorita ou subgênero manualmente.
                  </p>
                )}
              </section>
            ) : episodic ? (
              <>
                {/* Barra Resumo de Progresso Episódico Unificada */}
                <section
                  aria-label="Controle unificado de progresso da série"
                  className="rounded-2xl border border-line bg-card p-5 space-y-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold text-ink">
                        Progresso Geral ·{' '}
                        <span className="tabular-nums text-accent">
                          T{curSeason} · Ep. {curEp}
                          {Number(item.totalEpisodes) > 0
                            ? ` / ${item.totalEpisodes} eps`
                            : ' assistidos'}
                        </span>
                      </h2>
                      <p className="mt-0.5 text-xs tabular-nums text-muted">
                        {Math.max(1, Number(item.totalSeasons) || 1)}{' '}
                        {Number(item.totalSeasons) === 1
                          ? 'temporada registrada'
                          : 'temporadas registradas'}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const patch = advanceEpisodeProgress(item, 1, {
                            allowExpandSeasons: true,
                          });
                          playTactileSound('page');
                          onUpdateItem(item.id, patch);
                        }}
                        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-semibold tabular-nums text-accent-ink hover:opacity-90"
                      >
                        <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                        <span>+1 Ep</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          const patch = advanceEpisodeProgress(item, 3, {
                            allowExpandSeasons: true,
                          });
                          playTactileSound('page');
                          onUpdateItem(item.id, patch);
                        }}
                        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-line bg-app px-3.5 py-2 text-xs font-semibold tabular-nums text-ink hover:border-accent"
                      >
                        <span>+3 Eps</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          const patch = createExpandedSeasonPatch(item, {
                            defaultEpisodes: 12,
                            switchToNewSeason: true,
                          });
                          playTactileSound('page');
                          onUpdateItem(item.id, patch);
                          showToast({
                            message: `Temporada ${patch.totalSeasons} adicionada e liberada.`,
                            type: 'success',
                          });
                        }}
                        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-dashed border-line bg-app px-3.5 py-2 text-xs font-semibold tabular-nums text-accent hover:border-accent"
                      >
                        <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                        <span>+ Nova Temporada</span>
                      </button>
                    </div>
                  </div>
                </section>

                <Suspense fallback={<div className="h-32 animate-pulse rounded-[6px] bg-card" />}>
                  <EpisodeListTab
                    item={item}
                    tmdbKey={tmdbKey}
                    omdbKey={omdbKey}
                    onUpdateItem={onUpdateItem}
                  />
                </Suspense>
              </>
            ) : (
              <section className="rounded-2xl border border-line bg-card p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-ink">
                      Sessão &amp; Duração do Filme
                    </h2>
                    <p className="mt-0.5 text-xs tabular-nums text-muted">
                      Duração total:{' '}
                      {Number(item.runtimeMinutes) > 0
                        ? `${item.runtimeMinutes} min`
                        : 'Não informada'}
                      {Number(item.watchedMinutes) > 0
                        ? ` · Assistido até ${item.watchedMinutes} min`
                        : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const total = Number(item.runtimeMinutes) || 120;
                        const nextMin = Math.min(
                          total,
                          (Number(item.watchedMinutes) || 0) + 15
                        );
                        onUpdateItem(item.id, {
                          watchedMinutes: nextMin,
                          status: nextMin >= total ? 'completed' : 'in-progress',
                          inBacklog: true,
                        });
                      }}
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-line bg-app px-3.5 py-2 text-xs font-semibold tabular-nums text-ink hover:border-accent"
                    >
                      <span>+15 min</span>
                    </button>
                    <button
                      type="button"
                      onClick={handlePrimaryContextualAction}
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-accent-ink hover:opacity-90"
                    >
                      <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
                      <span>Marcar Filme Concluído</span>
                    </button>
                  </div>
                </div>
              </section>
            )}
          </div>
        )}

        {/* ABA 3 — CENAS & DIÁRIO DA OBRA */}
        {activeTab === 'diary' && (
          <Suspense fallback={<div className="h-32 animate-pulse rounded-[6px] bg-card" />}>
            <QuotesVaultTab
              item={item}
              onUpdate={(updates) => onUpdateItem(item.id, updates)}
            />
          </Suspense>
        )}

        {/* Compatibilidade SOCIAL_ENABLED legado (desativado por padrão) */}
        {SOCIAL_ENABLED && activeTab === 'buddy' && (
          <div className="rounded-2xl border border-line bg-card p-4 text-xs text-muted">
            Sessão Conjunta
          </div>
        )}
      </main>

      {/* DRAWER SOB DEMANDA: "EDITAR METADADOS" (Único lugar onde campos de formulário existem) */}
      {isEditDrawerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 sm:items-center sm:p-4"
          onClick={() => setIsEditDrawerOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label={`Editar metadados de ${item.title}`}
        >
          <div
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-line bg-card p-5 pb-10 space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 border-b border-line pb-3">
              <div>
                <h2 className="text-base font-bold text-ink">Editar Metadados da Obra</h2>
                <p className="text-xs text-muted">
                  Altere informações técnicas, número de temporadas, sinopse e coleções
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsEditDrawerOpen(false)}
                aria-label="Fechar editor de metadados"
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-line bg-app text-muted hover:text-ink"
              >
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>

            <WorkTypeSelector
              domain={workDomain}
              label={workVocab.workTypeLabel}
              value={item.workType}
              onChange={(nextType) => onUpdateItem(item.id, { workType: nextType })}
            />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-muted">
                  Título Principal
                </span>
                <input
                  type="text"
                  value={item.title || ''}
                  onChange={(e) => onUpdateItem(item.id, { title: e.target.value })}
                  className="min-h-[44px] w-full rounded-xl border border-line bg-app px-3 text-xs text-ink focus:border-accent focus:outline-none"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-muted">
                  {domainMeta.creatorLabel}
                </span>
                <input
                  type="text"
                  value={item.creator || item.director || item.author || ''}
                  onChange={(e) =>
                    onUpdateItem(item.id, {
                      creator: e.target.value,
                      director: e.target.value,
                      author: e.target.value,
                    })
                  }
                  placeholder={domainMeta.creatorLabel}
                  className="min-h-[44px] w-full rounded-xl border border-line bg-app px-3 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-muted">
                  Ano de Lançamento
                </span>
                <input
                  type="number"
                  min="1500"
                  max="2099"
                  value={item.releaseYear || ''}
                  onChange={(e) =>
                    onUpdateItem(item.id, {
                      releaseYear: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                  placeholder="2001"
                  className="min-h-[44px] w-full rounded-xl border border-line bg-app px-3 text-xs tabular-nums text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-muted">
                  Data de Término
                </span>
                <input
                  type="date"
                  value={
                    item.completedDate
                      ? String(item.completedDate).slice(0, 10)
                      : item.completedAt
                        ? String(item.completedAt).slice(0, 10)
                        : ''
                  }
                  onChange={(e) =>
                    onUpdateItem(item.id, {
                      completedDate: e.target.value || null,
                      completedAt: e.target.value || null,
                    })
                  }
                  className="min-h-[44px] w-full rounded-xl border border-line bg-app px-3 text-xs tabular-nums text-ink focus:border-accent focus:outline-none"
                />
              </label>

              {workDomain === 'cinema' ? (
                episodic ? (
                  <>
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-medium text-muted">
                        Total de Temporadas
                      </span>
                      <input
                        type="number"
                        min="1"
                        max="150"
                        value={item.totalSeasons || 1}
                        onChange={(e) => {
                          const nextTotal = Math.max(1, Number(e.target.value) || 1);
                          onUpdateItem(item.id, { totalSeasons: nextTotal });
                        }}
                        className="min-h-[44px] w-full rounded-xl border border-line bg-app px-3 text-xs tabular-nums text-ink focus:border-accent focus:outline-none"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1 block text-[11px] font-medium text-muted">
                        Total de Episódios (Série Completa)
                      </span>
                      <input
                        type="number"
                        min="1"
                        max="5000"
                        value={item.totalEpisodes || ''}
                        onChange={(e) =>
                          onUpdateItem(item.id, {
                            totalEpisodes: e.target.value ? Number(e.target.value) : null,
                          })
                        }
                        placeholder="Ex: 64"
                        className="min-h-[44px] w-full rounded-xl border border-line bg-app px-3 text-xs tabular-nums text-ink focus:border-accent focus:outline-none"
                      />
                    </label>
                  </>
                ) : (
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-muted">
                      Duração do Filme (minutos)
                    </span>
                    <input
                      type="number"
                      min="1"
                      max="1200"
                      value={item.runtimeMinutes || ''}
                      onChange={(e) =>
                        onUpdateItem(item.id, {
                          runtimeMinutes: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                      placeholder="125"
                      className="min-h-[44px] w-full rounded-xl border border-line bg-app px-3 text-xs tabular-nums text-ink focus:border-accent focus:outline-none"
                    />
                  </label>
                )
              ) : workDomain === 'reading' ? (
                <>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-muted">
                      Páginas Lidas
                    </span>
                    <input
                      type="number"
                      min="0"
                      value={item.pagesRead ?? 0}
                      onChange={(e) =>
                        onUpdateItem(item.id, {
                          pagesRead: Math.max(0, Number(e.target.value) || 0),
                        })
                      }
                      className="min-h-[44px] w-full rounded-xl border border-line bg-app px-3 text-xs tabular-nums text-ink focus:border-accent focus:outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-muted">
                      Total de Páginas
                    </span>
                    <input
                      type="number"
                      min="1"
                      value={item.totalPages || ''}
                      onChange={(e) =>
                        onUpdateItem(item.id, {
                          totalPages: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                      className="min-h-[44px] w-full rounded-xl border border-line bg-app px-3 text-xs tabular-nums text-ink focus:border-accent focus:outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-muted">
                      Capítulos Lidos
                    </span>
                    <input
                      type="number"
                      min="0"
                      value={item.chaptersRead ?? 0}
                      onChange={(e) =>
                        onUpdateItem(item.id, {
                          chaptersRead: Math.max(0, Number(e.target.value) || 0),
                        })
                      }
                      className="min-h-[44px] w-full rounded-xl border border-line bg-app px-3 text-xs tabular-nums text-ink focus:border-accent focus:outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-muted">
                      Formato
                    </span>
                    <select
                      value={item.bookFormat || BOOK_FORMATS[0]}
                      onChange={(e) => onUpdateItem(item.id, { bookFormat: e.target.value })}
                      className="min-h-[44px] w-full rounded-xl border border-line bg-app px-3 text-xs text-ink focus:border-accent focus:outline-none"
                    >
                      {BOOK_FORMATS.map((fmt) => (
                        <option key={fmt} value={fmt}>
                          {fmt}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : workDomain === 'games' ? (
                <>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-muted">
                      Plataforma Jogada
                    </span>
                    <select
                      value={item.platform || ''}
                      onChange={(e) => onUpdateItem(item.id, { platform: e.target.value })}
                      className="min-h-[44px] w-full rounded-xl border border-line bg-app px-3 text-xs text-ink focus:border-accent focus:outline-none"
                    >
                      <option value="">{GAME_PLATFORM_UNSET_LABEL}</option>
                      {Array.from(
                        new Set([
                          ...(Array.isArray(item.platforms) ? item.platforms : []),
                          ...(Array.isArray(item.originalPlatforms) ? item.originalPlatforms : []),
                          ...EXTENDED_GAME_PLATFORMS,
                        ])
                      ).map((p) => (
                        <option key={p} value={p}>
                          {p}
                          {Array.isArray(item.originalPlatforms) &&
                          item.originalPlatforms.includes(p)
                            ? ' (Original)'
                            : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-muted">
                      Tipo de Edição
                    </span>
                    <select
                      value={normalizeGameEditionType(item.editionType)}
                      onChange={(e) => onUpdateItem(item.id, { editionType: e.target.value })}
                      className="min-h-[44px] w-full rounded-xl border border-line bg-app px-3 text-xs text-ink focus:border-accent focus:outline-none"
                    >
                      {GAME_EDITION_TYPES.map((ed) => (
                        <option key={ed} value={ed}>
                          {ed}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="mb-1 block text-[11px] font-medium text-muted">
                      Tipo de Conclusão
                    </span>
                    <select
                      value={item.completionType || GAME_COMPLETION_TYPES[0]}
                      onChange={(e) =>
                        onUpdateItem(item.id, { completionType: e.target.value })
                      }
                      className="min-h-[44px] w-full rounded-xl border border-line bg-app px-3 text-xs text-ink focus:border-accent focus:outline-none"
                    >
                      {GAME_COMPLETION_TYPES.map((ct) => (
                        <option key={ct} value={ct}>
                          {ct}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : (
                <>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-muted">
                      Formato do Lançamento
                    </span>
                    <select
                      value={item.releaseFormat || MUSIC_RELEASE_FORMATS[0]}
                      onChange={(e) =>
                        onUpdateItem(item.id, { releaseFormat: e.target.value })
                      }
                      className="min-h-[44px] w-full rounded-xl border border-line bg-app px-3 text-xs text-ink focus:border-accent focus:outline-none"
                    >
                      {MUSIC_RELEASE_FORMATS.map((rf) => (
                        <option key={rf} value={rf}>
                          {rf}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-muted">
                      Audições
                    </span>
                    <input
                      type="number"
                      min="0"
                      value={item.listenCount ?? 0}
                      onChange={(e) =>
                        onUpdateItem(item.id, {
                          listenCount: Math.max(0, Number(e.target.value) || 0),
                        })
                      }
                      className="min-h-[44px] w-full rounded-xl border border-line bg-app px-3 text-xs tabular-nums text-ink focus:border-accent focus:outline-none"
                    />
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="mb-1 block text-[11px] font-medium text-muted">
                      Faixa Favorita
                    </span>
                    <input
                      type="text"
                      value={item.favoriteTrack || ''}
                      onChange={(e) =>
                        onUpdateItem(item.id, { favoriteTrack: e.target.value })
                      }
                      className="min-h-[44px] w-full rounded-xl border border-line bg-app px-3 text-xs text-ink focus:border-accent focus:outline-none"
                    />
                  </label>
                </>
              )}
            </div>

            {/* Seção recolhida "Mais detalhes" para campos avançados */}
            <section className="rounded-xl border border-line bg-app p-3.5">
              <button
                type="button"
                aria-expanded={editMoreDetailsOpen}
                onClick={() => setEditMoreDetailsOpen((v) => !v)}
                className="flex min-h-[40px] w-full items-center justify-between gap-2 text-left text-xs font-semibold text-ink"
              >
                <span>Mais detalhes</span>
                {editMoreDetailsOpen ? (
                  <ChevronUp className="h-4 w-4 text-muted" strokeWidth={1.5} />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted" strokeWidth={1.5} />
                )}
              </button>

              {editMoreDetailsOpen && (
                <div className="mt-3 grid grid-cols-1 gap-3 border-t border-line pt-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-muted">
                      Título Original
                    </span>
                    <input
                      type="text"
                      value={item.originalTitle || ''}
                      onChange={(e) =>
                        onUpdateItem(item.id, { originalTitle: e.target.value })
                      }
                      className="min-h-[44px] w-full rounded-xl border border-line bg-card px-3 text-xs text-ink focus:border-accent focus:outline-none"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-muted">
                      {workDomain === 'cinema' ? 'Estúdio / Rede' : 'Selo / Editora / Publicadora'}
                    </span>
                    <input
                      type="text"
                      value={item.studio || ''}
                      onChange={(e) => onUpdateItem(item.id, { studio: e.target.value })}
                      placeholder={workDomain === 'cinema' ? 'Ex: Studio Ghibli, HBO' : 'Opcional'}
                      className="min-h-[44px] w-full rounded-xl border border-line bg-card px-3 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
                    />
                  </label>

                  <label className="block sm:col-span-2">
                    <span className="mb-1 block text-[11px] font-medium text-muted">
                      Franquia / Universo
                    </span>
                    <input
                      type="text"
                      value={item.franchiseName || item.seriesName || ''}
                      onChange={(e) =>
                        onUpdateItem(item.id, {
                          franchiseName: e.target.value,
                          seriesName: e.target.value,
                        })
                      }
                      placeholder="Ex: Duna, Zelda..."
                      className="min-h-[44px] w-full rounded-xl border border-line bg-card px-3 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
                    />
                  </label>

                  {workDomain === 'reading' && (
                    <>
                      <label className="block">
                        <span className="mb-1 block text-[11px] font-medium text-muted">
                          ISBN / DOI
                        </span>
                        <input
                          type="text"
                          value={item.isbnOrDoi || ''}
                          onChange={(e) => onUpdateItem(item.id, { isbnOrDoi: e.target.value })}
                          placeholder="ISBN-13 ou DOI"
                          className="min-h-[44px] w-full rounded-xl border border-line bg-card px-3 text-xs text-ink focus:border-accent focus:outline-none"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[11px] font-medium text-muted">
                          Volume na Saga
                        </span>
                        <input
                          type="text"
                          value={item.seriesVolume || ''}
                          onChange={(e) => onUpdateItem(item.id, { seriesVolume: e.target.value })}
                          placeholder="Ex.: 1 ou Livro I"
                          className="min-h-[44px] w-full rounded-xl border border-line bg-card px-3 text-xs text-ink focus:border-accent focus:outline-none"
                        />
                      </label>
                      <label className="block sm:col-span-2">
                        <span className="mb-1 block text-[11px] font-medium text-muted">
                          Link da obra (Amazon, Wattpad, site do autor)
                        </span>
                        <input
                          type="url"
                          value={item.workUrl || ''}
                          onChange={(e) => onUpdateItem(item.id, { workUrl: e.target.value })}
                          placeholder="https://..."
                          className="min-h-[44px] w-full rounded-xl border border-line bg-card px-3 text-xs text-ink focus:border-accent focus:outline-none"
                        />
                      </label>
                      <label className="block sm:col-span-2">
                        <span className="mb-1 block text-[11px] font-medium text-muted">
                          Citação marcante
                        </span>
                        <input
                          type="text"
                          value={item.favoriteScene || ''}
                          onChange={(e) =>
                            onUpdateItem(item.id, { favoriteScene: e.target.value })
                          }
                          placeholder="Trecho ou passagem inesquecível..."
                          className="min-h-[44px] w-full rounded-xl border border-line bg-card px-3 text-xs text-ink focus:border-accent focus:outline-none"
                        />
                      </label>
                    </>
                  )}

                  <div className="sm:col-span-2 rounded-xl border border-line bg-card p-3 space-y-2">
                    <span className="block text-[11px] font-medium text-muted">
                      Enviar nova capa local (comprimida até 300 KB no IndexedDB)
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-xl border border-line bg-app px-3 text-xs font-medium text-ink hover:border-accent">
                        <span>{coverUploadBusy ? 'Comprimindo...' : 'Escolher imagem'}</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="sr-only"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            e.target.value = '';
                            if (!file) return;
                            setCoverUploadBusy(true);
                            setCoverUploadError('');
                            try {
                              const res = await compressManualCoverImage(file);
                              if (!res.ok || !res.dataUrl) {
                                setCoverUploadError(res.error || 'Falha ao comprimir imagem.');
                                return;
                              }
                              onUpdateItem(item.id, {
                                coverUrl: res.dataUrl,
                                manualCoverDataUrl: res.dataUrl,
                              });
                              showToast({ message: 'Capa local atualizada.', type: 'success' });
                            } finally {
                              setCoverUploadBusy(false);
                            }
                          }}
                        />
                      </label>
                      {item.manualCoverDataUrl && (
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateItem(item.id, {
                              manualCoverDataUrl: '',
                              coverUrl: item.coverUrl === item.manualCoverDataUrl ? '' : item.coverUrl,
                            })
                          }
                          className="min-h-[44px] rounded-xl border border-line bg-app px-3 text-xs text-muted hover:text-ink"
                        >
                          Remover capa enviada
                        </button>
                      )}
                    </div>
                    {coverUploadError && (
                      <p className="text-[11px] text-muted">{coverUploadError}</p>
                    )}
                  </div>

                  {workDomain === 'games' && (
                    <>
                      <label className="block">
                        <span className="mb-1 block text-[11px] font-medium text-muted">
                          Horas Jogadas
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          value={item.hoursPlayed ?? 0}
                          onChange={(e) =>
                            onUpdateItem(item.id, {
                              hoursPlayed: Math.max(0, Number(e.target.value) || 0),
                            })
                          }
                          className="min-h-[44px] w-full rounded-xl border border-line bg-card px-3 text-xs tabular-nums text-ink focus:border-accent focus:outline-none"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[11px] font-medium text-muted">
                          Origem / Loja (ex.: Local / Offline)
                        </span>
                        <select
                          value={item.storeOrLauncher || ''}
                          onChange={(e) =>
                            onUpdateItem(item.id, { storeOrLauncher: e.target.value })
                          }
                          className="min-h-[44px] w-full rounded-xl border border-line bg-card px-3 text-xs text-ink focus:border-accent focus:outline-none"
                        >
                          <option value="">A definir</option>
                          {GAME_STORES_LAUNCHERS.map((st) => (
                            <option key={st} value={st}>
                              {st}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block sm:col-span-2">
                        <span className="mb-1 block text-[11px] font-medium text-muted">
                          Build / Personagem / Time
                        </span>
                        <input
                          type="text"
                          value={item.buildOrCharacter || ''}
                          onChange={(e) =>
                            onUpdateItem(item.id, { buildOrCharacter: e.target.value })
                          }
                          placeholder="Build, campeão ou time"
                          className="min-h-[44px] w-full rounded-xl border border-line bg-card px-3 text-xs text-ink focus:border-accent focus:outline-none"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[11px] font-medium text-muted">
                          Tempo médio de campanha (h · manual se sem IGDB/RAWG)
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          value={item.manualCampaignHours ?? ''}
                          onChange={(e) => {
                            const v = e.target.value === '' ? null : Math.max(0, Number(e.target.value) || 0);
                            onUpdateItem(item.id, { manualCampaignHours: v });
                          }}
                          placeholder="Ex.: 25"
                          className="min-h-[44px] w-full rounded-[6px] border border-line bg-card px-3 text-xs tabular-nums text-ink focus:border-accent focus:outline-none"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[11px] font-medium text-muted">
                          Tempo 100% (h · editável)
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          value={item.completion100Hours ?? ''}
                          onChange={(e) => {
                            const v = e.target.value === '' ? null : Math.max(0, Number(e.target.value) || 0);
                            onUpdateItem(item.id, {
                              completion100Hours: v,
                              completion100Source: v !== null ? 'manual' : null,
                            });
                          }}
                          placeholder="Sem fonte automática — editável"
                          className="min-h-[44px] w-full rounded-[6px] border border-line bg-card px-3 text-xs tabular-nums text-ink focus:border-accent focus:outline-none"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[11px] font-medium text-muted">
                          Troféus / Conquistas obtidos (manual)
                        </span>
                        <input
                          type="number"
                          min="0"
                          value={item.achievements?.unlocked ?? ''}
                          onChange={(e) => {
                            const raw = e.target.value;
                            const nextUnlocked = raw === '' ? null : Math.max(0, Number(raw) || 0);
                            onUpdateItem(item.id, {
                              achievements: normalizeAchievementsModel({
                                source: 'manual',
                                unlocked: nextUnlocked,
                                total: item.achievements?.total ?? null,
                                updated_at: new Date().toISOString(),
                              }),
                            });
                          }}
                          placeholder="Ex.: 24"
                          className="min-h-[44px] w-full rounded-[6px] border border-line bg-card px-3 text-xs tabular-nums text-ink focus:border-accent focus:outline-none"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[11px] font-medium text-muted">
                          Total de Troféus / Conquistas
                        </span>
                        <input
                          type="number"
                          min="0"
                          value={item.achievements?.total ?? ''}
                          onChange={(e) => {
                            const raw = e.target.value;
                            const nextTotal = raw === '' ? null : Math.max(0, Number(raw) || 0);
                            onUpdateItem(item.id, {
                              achievements: normalizeAchievementsModel({
                                source: 'manual',
                                unlocked: item.achievements?.unlocked ?? 0,
                                total: nextTotal,
                                updated_at: new Date().toISOString(),
                              }),
                            });
                          }}
                          placeholder="Ex.: 50"
                          className="min-h-[44px] w-full rounded-[6px] border border-line bg-card px-3 text-xs tabular-nums text-ink focus:border-accent focus:outline-none"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[11px] font-medium text-muted">
                          AppID Steam (opcional · conquistas)
                        </span>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={item.ids?.steam ?? ''}
                          onChange={(e) => {
                            const digits = e.target.value.replace(/\D/g, '');
                            const nextIds = { ...(item.ids || {}) };
                            if (digits) nextIds.steam = Number(digits);
                            else delete nextIds.steam;
                            setSteamAppIdDraft(digits);
                            onUpdateItem(item.id, { ids: nextIds });
                          }}
                          placeholder="Ex.: 620"
                          className="min-h-[44px] w-full rounded-[6px] border border-line bg-card px-3 text-xs tabular-nums text-ink focus:border-accent focus:outline-none"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[11px] font-medium text-muted">
                          Game ID RetroAchievements (emulador)
                        </span>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={item.ids?.retroachievements ?? ''}
                          onChange={(e) => {
                            const digits = e.target.value.replace(/\D/g, '');
                            const nextIds = { ...(item.ids || {}) };
                            if (digits) nextIds.retroachievements = Number(digits);
                            else delete nextIds.retroachievements;
                            setRaGameIdDraft(digits);
                            onUpdateItem(item.id, { ids: nextIds });
                          }}
                          placeholder="Ex.: 14402"
                          className="min-h-[44px] w-full rounded-[6px] border border-line bg-card px-3 text-xs tabular-nums text-ink focus:border-accent focus:outline-none"
                        />
                      </label>
                      <label className="block sm:col-span-2">
                        <span className="mb-1 block text-[11px] font-medium text-muted">
                          Justificativa da Nota 11 (Obra-Prima · opcional)
                        </span>
                        <input
                          type="text"
                          value={item.masterpieceJustification || ''}
                          onChange={(e) =>
                            onUpdateItem(item.id, {
                              masterpieceJustification: e.target.value,
                            })
                          }
                          placeholder="Por que este jogo é um marco excepcional da sua vida..."
                          className="min-h-[44px] w-full rounded-xl border border-line bg-card px-3 text-xs text-ink focus:border-accent focus:outline-none"
                        />
                      </label>
                    </>
                  )}

                  {workDomain === 'music' && (
                    <>
                      <div className="space-y-2">
                        <span className="block text-[11px] font-medium text-muted">
                          Subgêneros (editáveis)
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {(Array.isArray(item.subgenres) && item.subgenres.length > 0
                            ? item.subgenres
                            : item.subgenre
                              ? String(item.subgenre)
                                  .split(',')
                                  .map((s) => s.trim())
                                  .filter(Boolean)
                              : []
                          ).map((sg) => (
                            <button
                              key={sg}
                              type="button"
                              onClick={() => {
                                const cur =
                                  Array.isArray(item.subgenres) && item.subgenres.length > 0
                                    ? item.subgenres
                                    : String(item.subgenre || '')
                                        .split(',')
                                        .map((s) => s.trim())
                                        .filter(Boolean);
                                const next = updateEditableSubgenres(cur, { remove: sg });
                                onUpdateItem(item.id, {
                                  subgenres: next,
                                  subgenre: next.join(', '),
                                });
                              }}
                              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[6px] border border-line bg-card px-2.5 text-xs text-ink hover:border-accent"
                            >
                              <span>{sg}</span>
                              <X className="h-3 w-3 text-subtle" strokeWidth={1.5} />
                            </button>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={subgenreInput}
                            onChange={(e) => setSubgenreInput(e.target.value)}
                            placeholder="Adicionar subgênero (ex: Shoegaze, Post-Punk)..."
                            className="min-h-[44px] flex-1 rounded-[6px] border border-line bg-card px-3 text-xs text-ink focus:border-accent focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              if (!subgenreInput.trim()) return;
                              const cur =
                                Array.isArray(item.subgenres) && item.subgenres.length > 0
                                  ? item.subgenres
                                  : String(item.subgenre || '')
                                      .split(',')
                                      .map((s) => s.trim())
                                      .filter(Boolean);
                              const next = updateEditableSubgenres(cur, { add: subgenreInput });
                              onUpdateItem(item.id, {
                                subgenres: next,
                                subgenre: next.join(', '),
                              });
                              setSubgenreInput('');
                            }}
                            className="min-h-[44px] rounded-[6px] border border-line bg-app px-3 text-xs font-medium text-ink hover:border-accent"
                          >
                            Adicionar
                          </button>
                        </div>
                      </div>
                      <label className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-[6px] border border-line bg-card px-3 text-xs text-ink">
                        <input
                          type="checkbox"
                          checked={Boolean(item.excludeFromDiscography)}
                          onChange={(e) =>
                            onUpdateItem(item.id, {
                              excludeFromDiscography: Boolean(e.target.checked),
                            })
                          }
                          className="h-4 w-4 accent-accent"
                        />
                        <span>Não conta na completude da discografia</span>
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[11px] font-medium text-muted">
                          Álbum vinculado
                        </span>
                        <input
                          type="text"
                          value={item.albumName || ''}
                          onChange={(e) => onUpdateItem(item.id, { albumName: e.target.value })}
                          placeholder="Nome do álbum original"
                          className="min-h-[44px] w-full rounded-xl border border-line bg-card px-3 text-xs text-ink focus:border-accent focus:outline-none"
                        />
                      </label>
                    </>
                  )}

                  {(workDomain === 'cinema' || workDomain === 'reading' || workDomain === 'games') && (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-1 block text-[11px] font-medium text-muted">
                          Franquia / Série
                        </span>
                        <input
                          type="text"
                          value={item.franchiseName || ''}
                          onChange={(e) =>
                            onUpdateItem(item.id, { franchiseName: e.target.value })
                          }
                          placeholder="Ex.: Duna, Zelda, Senhor dos Anéis..."
                          className="min-h-[44px] w-full rounded-[6px] border border-line bg-card px-3 text-xs text-ink focus:border-accent focus:outline-none"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[11px] font-medium text-muted">
                          Escopo na Franquia
                        </span>
                        <select
                          value={item.franchiseTier || 'mainline'}
                          onChange={(e) =>
                            onUpdateItem(item.id, { franchiseTier: e.target.value })
                          }
                          className="min-h-[44px] w-full rounded-[6px] border border-line bg-card px-3 text-xs text-ink focus:border-accent focus:outline-none"
                        >
                          {ALL_FRANCHISE_TIER_OPTIONS.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  )}

                  {workDomain === 'reading' && (
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-medium text-muted">
                        Edição de outra obra (editionOf)
                      </span>
                      <select
                        value={getEditionBaseWorkId(item)}
                        onChange={(e) => {
                          const patch = buildEditionLinkPatch(item, e.target.value, allItems);
                          if (patch) onUpdateItem(item.id, patch);
                        }}
                        className="min-h-[44px] w-full rounded-[6px] border border-line bg-card px-3 text-xs text-ink focus:border-accent focus:outline-none"
                      >
                        <option value="">Obra base (não é edição de outra obra)</option>
                        {allItems
                          .filter(
                            (cand) =>
                              cand &&
                              cand.inBacklog !== false &&
                              cand.id !== item.id &&
                              inferDomainFromWork(cand) === 'reading' &&
                              getEditionBaseWorkId(cand) !== String(item.id)
                          )
                          .map((cand) => (
                            <option key={cand.id} value={cand.id}>
                              {cand.title}
                              {cand.releaseYear ? ` (${cand.releaseYear})` : ''}
                            </option>
                          ))}
                      </select>
                      <span className="mt-1 block text-[11px] text-subtle">
                        Conta nas estatísticas do autor e nunca altera o progresso da obra base.
                      </span>
                    </label>
                  )}

                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-muted">
                      URL da Capa
                    </span>
                    <input
                      type="url"
                      value={item.coverUrl || ''}
                      onChange={(e) => onUpdateItem(item.id, { coverUrl: e.target.value })}
                      placeholder="https://..."
                      className="min-h-[44px] w-full rounded-xl border border-line bg-card px-3 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-muted">
                      URL do Banner Widescreen (16:9)
                    </span>
                    <input
                      type="url"
                      value={item.backdropUrl || ''}
                      onChange={(e) =>
                        onUpdateItem(item.id, { backdropUrl: e.target.value })
                      }
                      placeholder="https://..."
                      className="min-h-[44px] w-full rounded-xl border border-line bg-card px-3 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
                    />
                  </label>
                </div>
              )}
            </section>

            {workDomain === 'cinema' && (
              <SmartCatalogButton
                item={item}
                geminiKey={geminiKey}
                onApplyFields={(updates) => onUpdateItem(item.id, updates)}
                onOpenGeminiSettings={() => {
                  setIsEditDrawerOpen(false);
                  onClose?.();
                  onOpenGeminiSettings?.();
                }}
              />
            )}

            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-muted">
                Sinopse (sem spoilers)
              </span>
              <textarea
                rows={4}
                value={item.synopsis || item.overview || ''}
                onChange={(e) =>
                  onUpdateItem(item.id, {
                    synopsis: e.target.value,
                    overview: e.target.value,
                  })
                }
                placeholder="Premissa sem spoilers da obra..."
                className="w-full resize-none rounded-xl border border-line bg-app px-3 py-2.5 text-xs leading-relaxed text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
              />
            </label>

            <TechnicalAtmosphereSection
              item={item}
              onChange={(updates) => onUpdateItem(item.id, updates)}
            />

            {/* Coleções Personalizadas */}
            <section
              aria-label="Coleções personalizadas"
              className="rounded-xl border border-line bg-app p-3.5 space-y-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink">
                  <FolderOpen className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                  <span>Coleções &amp; Mostras</span>
                </span>
                <span className="text-[10px] tabular-nums text-subtle">
                  {Array.isArray(item.collectionIds) ? item.collectionIds.length : 0} selecionada(s)
                </span>
              </div>

              {collections.length > 0 && (
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {collections.map((col) => {
                    const checked =
                      Array.isArray(item.collectionIds) &&
                      item.collectionIds.map(String).includes(String(col.id));
                    return (
                      <label
                        key={col.id}
                        className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
                          checked
                            ? 'border-accent bg-accent/10 text-ink'
                            : 'border-line bg-card text-muted hover:text-ink'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => onToggleCollection?.(item.id, col.id)}
                          className="h-4 w-4 accent-[var(--accent-color)]"
                        />
                        <span className="truncate">{col.name}</span>
                      </label>
                    );
                  })}
                </div>
              )}

              {onCreateCollection && (
                <CollectionCreatorBar
                  collections={collections}
                  onCreateCollection={onCreateCollection}
                  onCreated={(created) => {
                    if (
                      created?.id &&
                      !(item.collectionIds || []).map(String).includes(String(created.id))
                    ) {
                      onToggleCollection?.(item.id, created.id);
                    }
                  }}
                />
              )}
            </section>

            {/* Tags Livres & Empréstimo de Mídia Física */}
            <section className="rounded-xl border border-line bg-app p-3.5 space-y-3">
              <div className="space-y-1.5">
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink">
                  <Tag className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                  <span>Tags livres</span>
                </span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && tagInput.trim()) {
                        e.preventDefault();
                        const nextTags = normalizeTagsList([
                          ...tags,
                          tagInput.trim(),
                        ]);
                        onUpdateItem(item.id, { tags: nextTags });
                        setTagInput('');
                      }
                    }}
                    placeholder="Ex: imax, anos-80, ghibli..."
                    aria-label="Adicionar tag livre"
                    className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-line bg-card px-3 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!tagInput.trim()) return;
                      const nextTags = normalizeTagsList([
                        ...tags,
                        tagInput.trim(),
                      ]);
                      onUpdateItem(item.id, { tags: nextTags });
                      setTagInput('');
                    }}
                    className="min-h-[44px] rounded-xl border border-line bg-card px-3.5 text-xs font-medium text-ink hover:border-accent"
                  >
                    + Tag
                  </button>
                </div>

                {tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {tags.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() =>
                          onUpdateItem(item.id, {
                            tags: tags.filter((x) => x !== t),
                          })
                        }
                        className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-accent/40 bg-accent/10 px-2.5 py-1 text-xs font-medium text-ink"
                      >
                        <span>#{t}</span>
                        <X className="h-3 w-3 text-subtle" strokeWidth={1.5} />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t border-line pt-3 space-y-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink">
                  <UserCheck className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                  <span>{workVocab.loanLabel}</span>
                </span>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <input
                    type="text"
                    value={item.loanedTo || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      onUpdateItem(item.id, {
                        loanedTo: val,
                        loanedAt: val.trim() ? item.loanedAt || getTodayLocalISO() : null,
                      });
                    }}
                    placeholder="Emprestado para quem?"
                    aria-label="Nome de quem pegou a mídia emprestada"
                    className="min-h-[44px] rounded-xl border border-line bg-card px-3 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
                  />
                  <input
                    type="date"
                    value={item.loanedAt ? String(item.loanedAt).slice(0, 10) : ''}
                    onChange={(e) =>
                      onUpdateItem(item.id, { loanedAt: e.target.value || null })
                    }
                    aria-label="Data do empréstimo"
                    className="min-h-[44px] rounded-xl border border-line bg-card px-3 text-xs text-ink focus:border-accent focus:outline-none"
                  />
                </div>
              </div>
            </section>

            {/* Exportar e Excluir */}
            <div className="grid grid-cols-1 gap-2 border-t border-line pt-4 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  downloadWorkMarkdown(item);
                  showToast({
                    message: 'Ficha exportada em Markdown (.md).',
                    type: 'success',
                  });
                }}
                className="flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl border border-line bg-app py-2.5 text-xs font-medium text-ink hover:border-accent"
              >
                <Download className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                <span>Exportar crítica e ficha (.md)</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onRemoveItem(item.id);
                  setIsEditDrawerOpen(false);
                  onClose?.();
                }}
                className="flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl border border-rose-500/20 bg-rose-500/10 py-2.5 text-xs font-medium text-rose-400 hover:bg-rose-500/20"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                <span>{ui.detail.removeLabel}</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setIsEditDrawerOpen(false)}
              className="flex min-h-[44px] w-full items-center justify-center rounded-xl bg-accent py-2.5 text-xs font-semibold text-accent-ink"
            >
              Concluir Edição
            </button>
          </div>
        </div>
      )}

      {/* Modal sob demanda: Vincular obra manual a uma fonte externa */}
      {linkSourceModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 sm:items-center sm:p-4"
          onClick={() => setLinkSourceModalOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Vincular obra manual a uma fonte"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-t-[14px] border border-line bg-card p-5 space-y-4 sm:rounded-[14px]"
          >
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div>
                <h2 className="font-editorial text-base font-semibold text-ink">
                  Vincular a uma fonte
                </h2>
                <p className="text-[11px] text-muted">
                  Preserva sua nota, progresso e comentários; permite desfazer.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLinkSourceModalOpen(false)}
                aria-label="Fechar busca de vínculo"
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[6px] border border-line text-muted hover:text-ink"
              >
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const q = linkSearchQuery.trim();
                if (!q) return;
                setLinkSearchLoading(true);
                setLinkSearchError('');
                try {
                  const runner =
                    workDomain === 'reading' && looksLikeIsbnInput(q)
                      ? fetchBookByIsbn(q)
                      : workDomain === 'cinema'
                        ? searchCinemaMedia(q, { tmdbApiKey: tmdbKey })
                        : searchWorksByDomain(workDomain, q);
                  const out = await runner;
                  setLinkSearchResults(Array.isArray(out?.results) ? out.results.slice(0, 12) : []);
                  if (!out?.ok && out?.error) setLinkSearchError(out.error);
                } catch {
                  setLinkSearchError('Falha ao consultar as APIs.');
                } finally {
                  setLinkSearchLoading(false);
                }
              }}
              className="flex gap-2"
            >
              <input
                type="text"
                value={linkSearchQuery}
                onChange={(e) => setLinkSearchQuery(e.target.value)}
                placeholder={workDomain === 'reading' ? 'Título, autor ou ISBN...' : 'Título ou criador...'}
                aria-label="Buscar obra nas fontes para vincular"
                className="min-h-[44px] flex-1 rounded-[6px] border border-line bg-app px-3 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
              />
              <button
                type="submit"
                disabled={linkSearchLoading || !linkSearchQuery.trim()}
                className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-[6px] bg-accent px-4 text-xs font-semibold text-accent-ink hover:opacity-90 disabled:opacity-50"
              >
                <Search className="h-3.5 w-3.5" strokeWidth={1.5} />
                <span>{linkSearchLoading ? 'Buscando...' : 'Buscar'}</span>
              </button>
            </form>

            {linkSearchError && (
              <p className="text-xs text-muted">{linkSearchError}</p>
            )}

            {!linkSearchLoading && linkSearchResults.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted">
                Nenhum resultado encontrado para este termo nas fontes externas.
              </p>
            ) : (
              <div className="divide-y divide-line border-y border-line">
                {linkSearchResults.map((cand) => (
                  <div
                    key={cand.id}
                    className="flex items-center justify-between gap-3 py-2.5"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <CoverArt
                        item={cand}
                        compact
                        className={`w-10 shrink-0 rounded-[6px] ${
                          workDomain === 'music' ? 'aspect-square' : 'aspect-[2/3]'
                        }`}
                      />
                      <div className="min-w-0">
                        <p className="font-editorial truncate text-sm font-semibold text-ink">
                          {cand.title}
                        </p>
                        <p className="truncate text-xs tabular-nums text-muted">
                          {[cand.creator || cand.director || cand.author, cand.releaseYear, cand.sourceBadge]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const merged = mergeManualWorkWithApiCandidate(item, cand);
                        if (!merged) return;
                        onUpdateItem(item.id, merged.updatedWork);
                        setLinkSourceModalOpen(false);
                        showToast({
                          message: `Obra vinculada a ${cand.sourceBadge || 'fonte externa'}.`,
                          type: 'success',
                          duration: 7000,
                          action: {
                            label: 'Desfazer',
                            onClick: () => onUpdateItem(item.id, merged.undoSnapshot),
                          },
                        });
                      }}
                      className="min-h-[44px] shrink-0 rounded-[6px] border border-accent bg-accent/15 px-3 text-xs font-semibold text-ink hover:bg-accent hover:text-accent-ink"
                    >
                      Vincular
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Folha sob demanda: Troféus & Conquistas (Manual / Steam / RetroAchievements) */}
      {achievementsModalOpen && workDomain === 'games' && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 sm:items-center sm:p-4"
          onClick={() => setAchievementsModalOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Troféus e conquistas do jogo"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-[14px] border border-line bg-card p-5 space-y-4 sm:rounded-[14px]"
          >
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div>
                <h2 className="font-editorial text-base font-semibold text-ink">
                  Troféus &amp; Conquistas
                </h2>
                <p className="text-[11px] text-muted">
                  Atualiza somente a contagem de conquistas, preservando notas e comentários.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAchievementsModalOpen(false)}
                aria-label="Fechar painel de conquistas"
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[6px] border border-line text-muted hover:text-ink"
              >
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {ACHIEVEMENT_SOURCE_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    setAchSourceTab(opt.id);
                    setAchSyncFeedback({ type: 'idle', message: '' });
                  }}
                  className={`min-h-[36px] rounded-[6px] border px-2.5 text-[11px] font-medium transition-colors ${
                    achSourceTab === opt.id
                      ? 'border-accent bg-accent/15 text-accent'
                      : 'border-line bg-app text-muted hover:text-ink'
                  }`}
                >
                  {opt.id === 'manual' ? 'Manual / Offline' : opt.shortLabel}
                </button>
              ))}
            </div>

            {achSourceTab === 'manual' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const nextUnlocked =
                    achManualUnlockedDraft === '' ? 0 : Math.max(0, Number(achManualUnlockedDraft) || 0);
                  const nextTotal =
                    achManualTotalDraft === '' ? null : Math.max(0, Number(achManualTotalDraft) || 0);
                  const patch = buildAchievementsSyncPatch(item, {
                    source: 'manual',
                    unlocked: nextUnlocked,
                    total: nextTotal,
                    updated_at: new Date().toISOString(),
                  });
                  if (patch) {
                    onUpdateItem(item.id, patch);
                    const summary = formatGameAchievementsSummary(patch.achievements);
                    setAchSyncFeedback({
                      type: 'success',
                      message: `Conquistas atualizadas (${summary?.label || `${nextUnlocked} obtidos`}).`,
                    });
                    showToast({
                      message: `Conquistas salvas (${summary?.label || `${nextUnlocked} obtidos`}).`,
                      type: 'success',
                    });
                  }
                  setAchievementsModalOpen(false);
                }}
                className="space-y-3"
              >
                <div className="grid grid-cols-2 gap-2.5">
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-muted">
                      Obtidos
                    </span>
                    <input
                      type="number"
                      min="0"
                      value={achManualUnlockedDraft}
                      onChange={(e) => setAchManualUnlockedDraft(e.target.value)}
                      placeholder="Ex.: 24"
                      className="min-h-[44px] w-full rounded-[6px] border border-line bg-app px-3 text-xs tabular-nums text-ink focus:border-accent focus:outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-muted">
                      Total
                    </span>
                    <input
                      type="number"
                      min="0"
                      value={achManualTotalDraft}
                      onChange={(e) => setAchManualTotalDraft(e.target.value)}
                      placeholder="Ex.: 50"
                      className="min-h-[44px] w-full rounded-[6px] border border-line bg-app px-3 text-xs tabular-nums text-ink focus:border-accent focus:outline-none"
                    />
                  </label>
                </div>
                <p className="text-[11px] text-subtle">
                  Ideal para consoles offline (PS2, Switch, 3DS, mídia física) ou acompanhamento manual.
                </p>
                <button
                  type="submit"
                  className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-[6px] bg-accent px-4 text-xs font-semibold text-accent-ink hover:opacity-90"
                >
                  <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
                  <span>Salvar contagem offline</span>
                </button>
              </form>
            )}

            {achSourceTab === 'steam' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSyncSteamAchievements({
                    overrideSteamId: steamIdDraft,
                    overrideAppId: steamAppIdDraft,
                  });
                }}
                className="space-y-3"
              >
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-muted">
                    SteamID64 do jogador
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={steamIdDraft}
                    onChange={(e) => setSteamIdDraft(e.target.value.replace(/\D/g, ''))}
                    placeholder="Ex.: 76561198000000000"
                    className="min-h-[44px] w-full rounded-[6px] border border-line bg-app px-3 text-xs tabular-nums text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-muted">
                    AppID Steam do jogo (opcional — busca automática na biblioteca)
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={steamAppIdDraft}
                    onChange={(e) => setSteamAppIdDraft(e.target.value.replace(/\D/g, ''))}
                    placeholder="Ex.: 620 (Portal 2)"
                    className="min-h-[44px] w-full rounded-[6px] border border-line bg-app px-3 text-xs tabular-nums text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
                  />
                </label>
                <p className="text-[11px] leading-relaxed text-subtle">
                  A chave STEAM_WEB_API_KEY permanece apenas no servidor Cloudflare. Seu perfil Steam precisa ter detalhes de jogos públicos.
                </p>
                {achSyncFeedback.message && (
                  <p className="text-xs text-muted">{achSyncFeedback.message}</p>
                )}
                <button
                  type="submit"
                  disabled={achSyncLoading || !steamIdDraft.trim()}
                  className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-[6px] bg-accent px-4 text-xs font-semibold text-accent-ink hover:opacity-90 disabled:opacity-55"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${achSyncLoading ? 'animate-spin' : ''}`}
                    strokeWidth={1.5}
                  />
                  <span>{achSyncLoading ? 'Sincronizando...' : 'Sincronizar conquistas'}</span>
                </button>
              </form>
            )}

            {achSourceTab === 'retroachievements' && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSyncRetroAchievements({
                    overrideUsername: raUsernameDraft,
                    overrideGameId: raGameIdDraft,
                  });
                }}
                className="space-y-3"
              >
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-muted">
                    Usuário RetroAchievements
                  </span>
                  <input
                    type="text"
                    value={raUsernameDraft}
                    onChange={(e) => setRaUsernameDraft(e.target.value.trim())}
                    placeholder="Ex.: seu_usuario"
                    className="min-h-[44px] w-full rounded-[6px] border border-line bg-app px-3 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-muted">
                    Game ID RetroAchievements
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={raGameIdDraft}
                    onChange={(e) => setRaGameIdDraft(e.target.value.replace(/\D/g, ''))}
                    placeholder="Ex.: 14402"
                    className="min-h-[44px] w-full rounded-[6px] border border-line bg-app px-3 text-xs tabular-nums text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
                  />
                </label>
                <p className="text-[11px] leading-relaxed text-subtle">
                  Para jogos em emuladores (RetroArch, PCSX2, DuckStation, PPSSPP, Dolphin). A chave RETROACHIEVEMENTS_API_KEY fica somente no servidor.
                </p>
                {achSyncFeedback.message && (
                  <p className="text-xs text-muted">{achSyncFeedback.message}</p>
                )}
                <button
                  type="submit"
                  disabled={achSyncLoading || !raUsernameDraft.trim() || !raGameIdDraft.trim()}
                  className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-[6px] bg-accent px-4 text-xs font-semibold text-accent-ink hover:opacity-90 disabled:opacity-55"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${achSyncLoading ? 'animate-spin' : ''}`}
                    strokeWidth={1.5}
                  />
                  <span>{achSyncLoading ? 'Sincronizando...' : 'Sincronizar conquistas'}</span>
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Página / Folha de Entidade (Autor, Diretor, Estúdio, Elenco, Banda) — v2.4.0 Fase 4.4 */}
      <Suspense fallback={null}>
        {activeEntity && (
          <EntitySheetModal
            entity={activeEntity}
            allItems={allItems}
            tmdbKey={tmdbKey}
            onClose={() => setActiveEntity(null)}
            onSelectWork={(work) => {
              setActiveEntity(null);
              onSelectItem?.(work);
            }}
            onQuickCatalogCandidate={(cand) => {
              onQuickCatalogItem?.({
                ...cand,
                status: cand?.status || 'queued',
                inBacklog: cand?.inBacklog !== false,
              });
              setActiveEntity(null);
            }}
          />
        )}
      </Suspense>
    </div>
  );
}

export { WorkDetailPage as WorkDetailModal };
