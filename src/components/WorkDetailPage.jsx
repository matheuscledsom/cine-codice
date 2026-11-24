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
  ListVideo,
  Plus,
  Quote,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Star,
  Tag,
  Trash2,
  Tv,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
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
  getStatusList,
  getWorkTypeLabel,
  inferDomainFromWork,
  normalizeDomainId,
} from '../config/domainConfig';
import { SOCIAL_ENABLED } from '../config/flags';
import { useToast } from '../context/ToastContext';
import { formatNextAiringBadge } from '../lib/episodeStats';
import { computeWorkCritiqueBadge } from '../lib/ratingBadges';
import { getPresentExternalRatingBadges, workHasAnyExternalIds } from '../lib/ratings';
import {
  enrichSeriesAndAnimeSeasons,
  enrichWorkWithExternalRatings,
} from '../services/cinemaApi';
import { findFranchiseForItem } from '../services/franchiseEngine';
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
  extractWorkAdaptivePalette,
  getWorkAdaptivePaletteSync,
} from '../utils/colorExtractor';
import { downloadWorkMarkdown } from '../utils/markdownExport';
import { playTactileSound } from '../utils/soundEffects';
import { CollectionCreatorBar } from './CollectionCreatorBar';
import { CoverArt } from './CoverArt';
import { EpisodeListTab } from './EpisodeListTab';
import { ExternalRatingsPanel } from './ExternalRatingsPanel';
import { FranchiseRadarPanel } from './FranchiseRadarPanel';
import { QuotesVaultTab } from './QuotesVaultTab';
import { SmartCatalogButton } from './SmartCatalogButton';
import { StatusBadge } from './StatusBadge';
import { TechnicalAtmosphereSection } from './TechnicalAtmosphereSection';
import { WorkTypeSelector } from './WorkTypeSelector';

const QUICK_PERSONAL_SCORES = [60, 70, 75, 80, 85, 90, 95, 100];

export function computeNextTop4Patch(item, allItems = []) {
  const currentRank = Number(item?.favoriteRank);
  if (Number.isInteger(currentRank) && currentRank >= 1 && currentRank <= 4) {
    return {
      favoriteRank: null,
      removedRank: currentRank,
    };
  }

  const occupied = new Set(
    (Array.isArray(allItems) ? allItems : [])
      .filter((w) => w && w.id !== item?.id)
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
  const [isEditDrawerOpen, setIsEditDrawerOpen] = useState(false);
  const [top4PickerOpen, setTop4PickerOpen] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [ratingsLoading, setRatingsLoading] = useState(false);
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
    setIsEditDrawerOpen(false);
    setTop4PickerOpen(false);
    setTagInput('');
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
        if (isEditDrawerOpen) {
          setIsEditDrawerOpen(false);
        } else {
          onClose?.();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [item, isEditDrawerOpen, onClose]);

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

  const statuses = getStatusList();
  const { ui, cardFields } = domainConfig;
  const genres = Array.isArray(item[cardFields.genres]) ? item[cardFields.genres] : [];
  const moods = Array.isArray(item.moods)
    ? item.moods
    : Array.isArray(item.atmosphere)
      ? item.atmosphere
      : [];
  const tags = Array.isArray(item.tags) ? item.tags : [];
  const verdictMeta = item.verdict ? getVerdictMeta(item.verdict) : null;
  const quotesCount = Array.isArray(item.quotes) ? item.quotes.length : 0;
  const displayTitles = getDisplayTitles(item, 'bilingual');
  const workDomain = normalizeDomainId(inferDomainFromWork(item));
  const domainMeta = getDomainMeta(workDomain);
  const creatorLabel = item.creator || item.director || item.studio || item.author || '';
  const episodic = workDomain === 'cinema' && isEpisodicWork(item);
  const nextAiringBadge = episodic ? formatNextAiringBadge(item) : null;
  const durationBadge = getWorkDurationBadge(item);
  const workFormatLabel = getWorkTypeLabel(item, workDomain);
  const domainQuickMetric =
    workDomain !== 'cinema' ? formatFlexibleProgressMetric(item) : null;

  const synopsisText = String(item.synopsis || item.overview || '').trim();
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

  const handlePrimaryContextualAction = () => {
    if (workDomain === 'reading') {
      const totalPages = Number(item.totalPages) || 0;
      const currentPages = Math.max(0, Number(item.pagesRead) || 0);
      const nextPages =
        totalPages > 0 ? Math.min(totalPages, currentPages + 10) : currentPages + 10;
      const done = totalPages > 0 && nextPages >= totalPages;
      onUpdateItem(item.id, {
        pagesRead: nextPages,
        status: done ? 'completed' : 'playing',
        ...(done ? { completedAt: getTodayLocalISO(), progress: 100 } : {}),
      });
      playTactileSound(done ? 'complete' : 'page');
      showToast({
        message: totalPages > 0 ? `Leitura: Pág. ${nextPages}/${totalPages}` : `Leitura: Pág. ${nextPages}`,
        type: 'success',
      });
      return;
    }

    if (workDomain === 'games') {
      const nextHours = Number((Math.max(0, Number(item.hoursPlayed) || 0) + 1).toFixed(1));
      onUpdateItem(item.id, {
        hoursPlayed: nextHours,
        status: item.status === 'queued' ? 'playing' : item.status,
      });
      playTactileSound('page');
      showToast({
        message: `${item.title}: ${nextHours}h jogadas (${item.platform || GAME_PLATFORM_UNSET_LABEL})`,
        type: 'success',
      });
      return;
    }

    if (workDomain === 'music') {
      const nextListens = Math.max(0, Number(item.listenCount) || 0) + 1;
      onUpdateItem(item.id, {
        listenCount: nextListens,
        status: item.status === 'queued' ? 'completed' : item.status,
        ...(item.status === 'queued' ? { completedAt: getTodayLocalISO() } : {}),
      });
      playTactileSound('page');
      showToast({
        message: `${item.title}: audição #${nextListens} registrada`,
        type: 'success',
      });
      return;
    }

    if (episodic) {
      const patch = advanceEpisodeProgress(item, 1, { allowExpandSeasons: true });
      playTactileSound(patch.status === 'completed' ? 'complete' : 'page');
      onUpdateItem(item.id, patch);
      showToast({
        message: `Progresso atualizado: T${patch.currentSeason || curSeason} · E${patch.currentEpisode || curEp + 1}`,
        type: 'success',
      });
    } else {
      const alreadyDone = item.status === 'completed';
      const patch = alreadyDone
        ? {
            rewatchCount: Number(item.rewatchCount || 0) + 1,
            completedAt: getTodayLocalISO(),
          }
        : {
            status: 'completed',
            inBacklog: true,
            completedAt: getTodayLocalISO(),
          };
      playTactileSound('complete');
      onUpdateItem(item.id, patch);
      showToast({
        message: alreadyDone
          ? `Rewatch #${patch.rewatchCount} registrado para "${item.title}".`
          : `"${item.title}" marcado como Concluído.`,
        type: 'success',
      });
    }
  };

  const handleToggleTop4 = (explicitSlot = null) => {
    if (explicitSlot !== null) {
      if (currentFavRank === explicitSlot) {
        onUpdateItem(item.id, { favoriteRank: null });
        showToast({ message: 'Removido da vitrine Top 4 Favoritos.', type: 'info' });
      } else {
        // Libera slot se outra obra ocupava a mesma posição
        const currentOccupant = allItems.find(
          (w) => w.id !== item.id && Number(w.favoriteRank) === explicitSlot
        );
        if (currentOccupant) {
          onUpdateItem(currentOccupant.id, { favoriteRank: currentFavRank || null });
        }
        onUpdateItem(item.id, { favoriteRank: explicitSlot, isFavorite: true });
        showToast({
          message: `"${item.title}" fixado no Top #${explicitSlot} Favoritos da Vida.`,
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
        (w) => w.id !== item.id && Number(w.favoriteRank) === res.favoriteRank
      );
      if (currentOccupant) {
        onUpdateItem(currentOccupant.id, { favoriteRank: null });
      }
      onUpdateItem(item.id, { favoriteRank: res.favoriteRank, isFavorite: true });
      showToast({
        message: `"${item.title}" fixado no Top #${res.favoriteRank} Favoritos da Vida.`,
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

  const metadataParts = [
    domainMeta.shortLabel,
    item.releaseYear ? String(item.releaseYear) : null,
    creatorLabel || null,
    workDomain === 'cinema'
      ? durationBadge || (episodic ? `${Math.max(1, Number(item.totalSeasons) || 1)} temp.` : null)
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
                <StatusBadge statusId={item.status} />
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
                    <span>Rewatch #{item.rewatchCount}</span>
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

              {/* Diretor / Estúdio clicável para filtrar catálogo */}
              {clickableCreators.length > 0 && onFilterByCreator && (
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  {clickableCreators.map((creatorName) => (
                    <button
                      key={creatorName}
                      type="button"
                      onClick={() => onFilterByCreator(creatorName)}
                      aria-label={`Filtrar catálogo e buscar mais títulos de ${creatorName}`}
                      className="inline-flex min-h-[44px] items-center rounded-lg border border-line bg-app px-3 py-1.5 text-left text-xs font-medium text-ink transition-colors hover:border-accent hover:text-accent"
                    >
                      {creatorName}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Barra de Ações Principais (>= 44px) */}
          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <button
              type="button"
              onClick={handlePrimaryContextualAction}
              className="inline-flex min-h-[44px] flex-1 sm:flex-initial items-center justify-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-xs font-semibold tabular-nums text-accent-ink transition-opacity hover:opacity-90"
            >
              {workDomain === 'reading' ? (
                <>
                  <Plus className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                  <span>
                    +10 págs ({Number(item.pagesRead || 0)}
                    {Number(item.totalPages) > 0 ? `/${item.totalPages}` : ''})
                  </span>
                </>
              ) : workDomain === 'games' ? (
                <>
                  <Plus className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                  <span>
                    +1h jogada ({Number(item.hoursPlayed || 0)}h · {item.platform || GAME_PLATFORM_UNSET_LABEL})
                  </span>
                </>
              ) : workDomain === 'music' ? (
                <>
                  <Plus className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                  <span>+1 escuta ({Number(item.listenCount || 0)}x)</span>
                </>
              ) : episodic ? (
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
                    {item.status === 'completed' ? 'Registrar Rewatch (+1)' : 'Marcar como Concluído'}
                  </span>
                </>
              )}
            </button>

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
                  onClick={() =>
                    onUpdateItem(item.id, { status: status.id, inBacklog: true })
                  }
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
                    ? 'Faixas & Escutas'
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
            <span className="truncate">Cenas &amp; Diário</span>
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
                        <div className="rounded-lg border border-line bg-app p-2.5">
                          <dt className="text-[10px] text-subtle">Formato</dt>
                          <dd className="mt-0.5 font-semibold text-ink">
                            {item.bookFormat || 'Físico'}
                          </dd>
                        </div>
                        <div className="rounded-lg border border-line bg-app p-2.5">
                          <dt className="text-[10px] text-subtle">ISBN / DOI</dt>
                          <dd className="mt-0.5 truncate font-semibold tabular-nums text-ink">
                            {item.isbnOrDoi || '—'}
                          </dd>
                        </div>
                      </dl>
                    )}
                    {workDomain === 'games' && (
                      <dl className="grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-lg border border-line bg-app p-2.5">
                          <dt className="text-[10px] text-subtle">Plataforma</dt>
                          <dd className="mt-0.5 font-semibold text-ink">
                            {item.platform || GAME_PLATFORM_UNSET_LABEL}
                          </dd>
                        </div>
                        <div className="rounded-lg border border-line bg-app p-2.5">
                          <dt className="text-[10px] text-subtle">Edição</dt>
                          <dd className="mt-0.5 font-semibold text-accent">
                            {item.editionType || GAME_EDITION_TYPES[0]}
                          </dd>
                        </div>
                        <div className="rounded-lg border border-line bg-app p-2.5">
                          <dt className="text-[10px] text-subtle">Tempo jogado</dt>
                          <dd className="mt-0.5 font-semibold tabular-nums text-ink">
                            {Number(item.hoursPlayed || 0)}h
                          </dd>
                        </div>
                        <div className="rounded-lg border border-line bg-app p-2.5">
                          <dt className="text-[10px] text-subtle">Conclusão</dt>
                          <dd className="mt-0.5 font-semibold text-ink">
                            {item.completionType || 'História Principal'}
                          </dd>
                        </div>
                        <div className="col-span-2 rounded-lg border border-line bg-app p-2.5">
                          <dt className="text-[10px] text-subtle">Launcher / Build</dt>
                          <dd className="mt-0.5 truncate font-semibold text-ink">
                            {[item.storeOrLauncher, item.buildOrCharacter].filter(Boolean).join(' · ') || '—'}
                          </dd>
                        </div>
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
                    )}
                    {workDomain === 'music' && (
                      <dl className="grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-lg border border-line bg-app p-2.5">
                          <dt className="text-[10px] text-subtle">Formato / Subgênero</dt>
                          <dd className="mt-0.5 truncate font-semibold text-ink">
                            {[
                              item.releaseFormat ||
                                (item.workType === 'track' ? 'Faixa Individual' : 'Álbum de Estúdio'),
                              item.subgenre,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </dd>
                        </div>
                        <div className="rounded-lg border border-line bg-app p-2.5">
                          <dt className="text-[10px] text-subtle">Audições</dt>
                          <dd className="mt-0.5 font-semibold tabular-nums text-ink">
                            {Number(item.listenCount || 0)} escutas
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
                              {item.favoriteTrack || 'Toque na aba Faixas & Escutas para escolher'}
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
                className="rounded-2xl border border-line bg-card p-5 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
                      Sua Avaliação Pessoal
                    </h2>
                    <p className="mt-0.5 text-xs text-subtle">
                      {workDomain === 'games'
                        ? 'Escala 0–11 (11 = obra-prima excepcional da vida)'
                        : workDomain === 'music' && item.workType === 'track'
                          ? 'Toque para avaliar a faixa na escala 0–10'
                          : 'Toque para avaliar na escala 0–100'}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-bold tabular-nums text-accent">
                      {workDomain === 'games'
                        ? item.gameRating11 !== null && item.gameRating11 !== undefined
                          ? `${item.gameRating11}/11`
                          : typeof item.rating === 'number'
                            ? `${Math.round((item.rating / 10) * 10) / 10}/11`
                            : '—'
                        : workDomain === 'music' && item.workType === 'track'
                          ? item.trackRating10 !== null && item.trackRating10 !== undefined
                            ? `${item.trackRating10}/10`
                            : typeof item.rating === 'number'
                              ? `${Math.round((item.rating / 10) * 10) / 10}/10`
                              : '—'
                          : typeof item.rating === 'number'
                            ? `${item.rating}/100`
                            : '—'}
                    </span>
                  </div>
                </div>

                {workDomain === 'games' ? (
                  <div className="flex flex-wrap gap-1.5">
                    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((score11) => {
                      const active = item.gameRating11 === score11;
                      return (
                        <button
                          key={score11}
                          type="button"
                          onClick={() => {
                            const mapped100 = Math.min(100, Math.round(score11 * 10));
                            onUpdateItem(item.id, {
                              gameRating11: score11,
                              rating: mapped100,
                              ratingSource: 'manual',
                              verdict: score11 === 11 ? 'Obra-Prima' : getVerdictForScore(mapped100),
                            });
                            playTactileSound('page');
                          }}
                          className={`min-h-[44px] min-w-[44px] rounded-xl border px-3 text-xs font-semibold tabular-nums transition-colors ${
                            active
                              ? 'border-accent bg-accent text-accent-ink'
                              : score11 === 11
                                ? 'border-accent/55 bg-accent/10 text-accent hover:bg-accent/20'
                                : 'border-line bg-app text-ink hover:border-accent'
                          }`}
                        >
                          {score11 === 11 ? '11 · Vida' : score11}
                        </button>
                      );
                    })}
                  </div>
                ) : workDomain === 'music' && item.workType === 'track' ? (
                  <div className="flex flex-wrap gap-1.5">
                    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((score10) => {
                      const active = item.trackRating10 === score10;
                      return (
                        <button
                          key={score10}
                          type="button"
                          onClick={() => {
                            const mapped100 = score10 * 10;
                            onUpdateItem(item.id, {
                              trackRating10: score10,
                              rating: mapped100,
                              ratingSource: 'manual',
                              verdict: getVerdictForScore(mapped100),
                            });
                            playTactileSound('page');
                          }}
                          className={`min-h-[44px] min-w-[44px] rounded-xl border px-3 text-xs font-semibold tabular-nums transition-colors ${
                            active
                              ? 'border-accent bg-accent text-accent-ink'
                              : 'border-line bg-app text-ink hover:border-accent'
                          }`}
                        >
                          {score10}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {QUICK_PERSONAL_SCORES.map((score) => {
                      const active = item.rating === score && item.ratingSource !== 'legacy-default';
                      return (
                        <button
                          key={score}
                          type="button"
                          onClick={() => handleSetPersonalScore(score)}
                          className={`min-h-[44px] min-w-[44px] rounded-xl border px-3 text-xs font-semibold tabular-nums transition-colors ${
                            active
                              ? 'border-accent bg-accent text-accent-ink'
                              : 'border-line bg-app text-ink hover:border-accent'
                          }`}
                        >
                          {score}
                        </button>
                      );
                    })}
                    {typeof item.rating === 'number' && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleSetPersonalScore(item.rating - 1)}
                          className="min-h-[44px] rounded-xl border border-line bg-app px-3 text-xs font-semibold tabular-nums text-muted hover:border-accent hover:text-ink"
                        >
                          -1
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSetPersonalScore(item.rating + 1)}
                          className="min-h-[44px] rounded-xl border border-line bg-app px-3 text-xs font-semibold tabular-nums text-muted hover:border-accent hover:text-ink"
                        >
                          +1
                        </button>
                      </>
                    )}
                  </div>
                )}

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
                    <span>{item.wantToReread ? 'Quero rever (ativo)' : 'Quero rever'}</span>
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
                    <span>{ui.detail.wishlistLabel}</span>
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
                      Mídia física emprestada para <strong>{item.loanedTo}</strong>
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

            {/* Radar de Franquia, Sagas & Universo (Cinema) */}
            {workDomain === 'cinema' && (
              <FranchiseRadarPanel
                item={item}
                allItems={allItems}
                franchise={franchise}
                onSelectItem={onSelectItem}
                onQuickCatalogItem={onQuickCatalogItem}
                onUpdateItem={onUpdateItem}
                onShowToast={showToast}
              />
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
                        item.isbnOrDoi ? `Ref. ${item.isbnOrDoi}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {[5, 10, 25].map((delta) => (
                      <button
                        key={delta}
                        type="button"
                        onClick={() => {
                          const total = Number(item.totalPages) || 0;
                          const next =
                            total > 0
                              ? Math.min(total, Number(item.pagesRead || 0) + delta)
                              : Number(item.pagesRead || 0) + delta;
                          const done = total > 0 && next >= total;
                          onUpdateItem(item.id, {
                            pagesRead: next,
                            status: done ? 'completed' : 'playing',
                            ...(done ? { completedAt: getTodayLocalISO(), progress: 100 } : {}),
                          });
                          playTactileSound(done ? 'complete' : 'page');
                        }}
                        className="inline-flex min-h-[44px] items-center gap-1 rounded-xl border border-line bg-app px-3 py-2 text-xs font-semibold tabular-nums text-ink hover:border-accent"
                      >
                        <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                        <span>{delta} págs</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        const total = Number(item.totalPages) || 0;
                        onUpdateItem(item.id, {
                          status: 'completed',
                          pagesRead: total > 0 ? total : Number(item.pagesRead || 0),
                          completedAt: getTodayLocalISO(),
                          progress: 100,
                        });
                        playTactileSound('complete');
                      }}
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-accent-ink hover:opacity-90"
                    >
                      <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
                      <span>Concluir Leitura</span>
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

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          onUpdateItem(item.id, {
                            chaptersRead: Math.max(0, Number(item.chaptersRead || 0)) + 1,
                            status: item.status === 'queued' ? 'playing' : item.status,
                          });
                          playTactileSound('page');
                        }}
                        className="inline-flex min-h-[40px] items-center gap-1 rounded-xl border border-line bg-app px-3 text-xs font-semibold tabular-nums text-ink hover:border-accent"
                      >
                        <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                        <span>1 cap. ({Number(item.chaptersRead || 0)})</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setIsEditDrawerOpen(true)}
                        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-line bg-app px-3 text-xs font-medium text-muted hover:border-accent hover:text-ink"
                      >
                        <Edit3 className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                        <span>Editar páginas / ISBN</span>
                      </button>
                    </div>
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
                        item.storeOrLauncher,
                        item.buildOrCharacter,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {[1, 3].map((delta) => (
                      <button
                        key={delta}
                        type="button"
                        onClick={() => {
                          const next = Number((Number(item.hoursPlayed || 0) + delta).toFixed(1));
                          onUpdateItem(item.id, {
                            hoursPlayed: next,
                            status: item.status === 'queued' ? 'playing' : item.status,
                          });
                          playTactileSound('page');
                        }}
                        className="inline-flex min-h-[44px] items-center gap-1 rounded-xl border border-line bg-app px-3.5 py-2 text-xs font-semibold tabular-nums text-ink hover:border-accent"
                      >
                        <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                        <span>{delta}h</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        onUpdateItem(item.id, {
                          status: 'completed',
                          completedAt: getTodayLocalISO(),
                          progress: 100,
                        });
                        playTactileSound('complete');
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
                      {GAME_PLATFORMS.map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => onUpdateItem(item.id, { platform: p })}
                          className={`min-h-[36px] rounded-lg border px-2.5 text-xs font-medium transition-colors ${
                            item.platform === p
                              ? 'border-accent bg-accent/15 text-accent'
                              : 'border-line bg-app text-muted hover:text-ink'
                          }`}
                        >
                          {p}
                        </button>
                      ))}
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
                            (item.editionType || GAME_EDITION_TYPES[0]) === ed
                              ? 'border-accent bg-accent/15 text-accent'
                              : 'border-line bg-app text-muted hover:text-ink'
                          }`}
                        >
                          {ed}
                        </button>
                      ))}
                    </div>
                  </div>

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
                      onClick={() => setIsEditDrawerOpen(true)}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-line bg-app px-3 text-xs font-medium text-muted hover:border-accent hover:text-ink"
                    >
                      <Edit3 className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                      <span>Editar horas / launcher / build</span>
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
                      Faixas &amp; Escutas ·{' '}
                      <span className="tabular-nums text-accent">
                        {Number(item.listenCount || 0)} audições
                      </span>
                    </h2>
                    <p className="mt-0.5 text-xs text-muted">
                      {[item.releaseFormat || 'Álbum de Estúdio', item.subgenre, item.favoriteTrack && `Fav.: ${item.favoriteTrack}`]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handlePrimaryContextualAction}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-semibold tabular-nums text-accent-ink hover:opacity-90"
                  >
                    <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                    <span>+1 Escuta</span>
                  </button>
                </div>

                {Array.isArray(item.tracks) && item.tracks.length > 0 ? (
                  <div className="space-y-1.5 border-t border-line pt-3">
                    <p className="text-[11px] font-medium text-muted">
                      Tracklist ({item.tracks.length} faixas — toque para definir como faixa favorita)
                    </p>
                    <div className="max-h-72 overflow-y-auto divide-y divide-line rounded-xl border border-line bg-app no-scrollbar">
                      {item.tracks.map((tr, idx) => {
                        const isFav = item.favoriteTrack === tr.title;
                        return (
                          <button
                            key={`${tr.number || idx}-${tr.title}`}
                            type="button"
                            onClick={() => {
                              onUpdateItem(item.id, { favoriteTrack: tr.title });
                              playTactileSound('page');
                            }}
                            className={`flex min-h-[42px] w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition-colors ${
                              isFav ? 'bg-accent/15 font-semibold text-accent' : 'text-ink hover:bg-card'
                            }`}
                          >
                            <span className="truncate">
                              <span className="mr-2 tabular-nums text-subtle">
                                {tr.number || idx + 1}.
                              </span>
                              {tr.title}
                            </span>
                            {isFav && (
                              <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] bg-accent text-accent-ink">
                                Favorita
                              </span>
                            )}
                          </button>
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

                <EpisodeListTab
                  item={item}
                  tmdbKey={tmdbKey}
                  omdbKey={omdbKey}
                  onUpdateItem={onUpdateItem}
                />
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
          <QuotesVaultTab
            item={item}
            onUpdate={(updates) => onUpdateItem(item.id, updates)}
          />
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
              label={ui.detail.workTypeTitle}
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
                  Título Original
                </span>
                <input
                  type="text"
                  value={item.originalTitle || ''}
                  onChange={(e) =>
                    onUpdateItem(item.id, { originalTitle: e.target.value })
                  }
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
                  {workDomain === 'cinema' ? 'Estúdio / Rede' : 'Selo / Editora / Publicadora'}
                </span>
                <input
                  type="text"
                  value={item.studio || ''}
                  onChange={(e) => onUpdateItem(item.id, { studio: e.target.value })}
                  placeholder={workDomain === 'cinema' ? 'Ex: Studio Ghibli, HBO' : 'Opcional'}
                  className="min-h-[44px] w-full rounded-xl border border-line bg-app px-3 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
                />
              </label>

              <label className="block">
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
                  <label className="block sm:col-span-2">
                    <span className="mb-1 block text-[11px] font-medium text-muted">
                      ISBN / DOI
                    </span>
                    <input
                      type="text"
                      value={item.isbnOrDoi || ''}
                      onChange={(e) => onUpdateItem(item.id, { isbnOrDoi: e.target.value })}
                      placeholder="ISBN-13 ou DOI"
                      className="min-h-[44px] w-full rounded-xl border border-line bg-app px-3 text-xs text-ink focus:border-accent focus:outline-none"
                    />
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
                      {GAME_PLATFORMS.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-muted">
                      Tipo de Edição
                    </span>
                    <select
                      value={item.editionType || GAME_EDITION_TYPES[0]}
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
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-muted">
                      Loja / Launcher
                    </span>
                    <select
                      value={item.storeOrLauncher || ''}
                      onChange={(e) =>
                        onUpdateItem(item.id, { storeOrLauncher: e.target.value })
                      }
                      className="min-h-[44px] w-full rounded-xl border border-line bg-app px-3 text-xs text-ink focus:border-accent focus:outline-none"
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
                      className="min-h-[44px] w-full rounded-xl border border-line bg-app px-3 text-xs tabular-nums text-ink focus:border-accent focus:outline-none"
                    />
                  </label>
                  <label className="block">
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
                      className="min-h-[44px] w-full rounded-xl border border-line bg-app px-3 text-xs text-ink focus:border-accent focus:outline-none"
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
                        onUpdateItem(item.id, { masterpieceJustification: e.target.value })
                      }
                      placeholder="Por que este jogo é um marco excepcional da sua vida..."
                      className="min-h-[44px] w-full rounded-xl border border-line bg-app px-3 text-xs text-ink focus:border-accent focus:outline-none"
                    />
                  </label>
                </>
              ) : (
                <>
                  {item.workType === 'track' && (
                    <label className="block sm:col-span-2">
                      <span className="mb-1 block text-[11px] font-medium text-muted">
                        Álbum vinculado
                      </span>
                      <input
                        type="text"
                        value={item.albumName || ''}
                        onChange={(e) => onUpdateItem(item.id, { albumName: e.target.value })}
                        placeholder="Nome do álbum original"
                        className="min-h-[44px] w-full rounded-xl border border-line bg-app px-3 text-xs text-ink focus:border-accent focus:outline-none"
                      />
                    </label>
                  )}
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
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-muted">
                      Subgênero Musical
                    </span>
                    <input
                      type="text"
                      value={item.subgenre || ''}
                      onChange={(e) => onUpdateItem(item.id, { subgenre: e.target.value })}
                      placeholder="Power Metal, Hard Rock..."
                      className="min-h-[44px] w-full rounded-xl border border-line bg-app px-3 text-xs text-ink focus:border-accent focus:outline-none"
                    />
                  </label>
                  <label className="block">
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

              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-muted">
                  URL da Capa
                </span>
                <input
                  type="url"
                  value={item.coverUrl || ''}
                  onChange={(e) => onUpdateItem(item.id, { coverUrl: e.target.value })}
                  placeholder="https://..."
                  className="min-h-[44px] w-full rounded-xl border border-line bg-app px-3 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
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
                  className="min-h-[44px] w-full rounded-xl border border-line bg-app px-3 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
                />
              </label>
            </div>

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
                  <span>Blu-ray / DVD Emprestado</span>
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
    </div>
  );
}

export { WorkDetailPage as WorkDetailModal };
