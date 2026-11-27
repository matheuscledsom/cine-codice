import {
  Activity,
  Award,
  BarChart2,
  BookOpen,
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  Database,
  Disc3,
  Film,
  Gamepad2,
  GitBranch,
  Globe,
  Layers,
  Music,
  Palette,
  PenLine,
  Plus,
  Quote,
  RefreshCw,
  Search,
  Settings,
  Star,
  Trophy,
  X,
  Zap,
} from 'lucide-react';
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { BackupReminderBanner } from '../components/BackupReminderBanner';
import { CoverArt } from '../components/CoverArt';
import {
  AVATAR_EMBLEM_COMPONENTS,
  ProfileEditModal,
} from '../components/ProfileEditModal';

const AiProvidersPanel = lazy(() =>
  import('../components/AiProvidersPanel').then((m) => ({ default: m.AiProvidersPanel }))
);
const BadgesGallery = lazy(() =>
  import('../components/BadgesGallery').then((m) => ({ default: m.BadgesGallery }))
);
const PostDetailModal = lazy(() =>
  import('../components/PostDetailModal').then((m) => ({ default: m.PostDetailModal }))
);
const ProfileSettingsDrawer = lazy(() =>
  import('../components/ProfileSettingsDrawer').then((m) => ({ default: m.ProfileSettingsDrawer }))
);
const ReaderPassportWidget = lazy(() =>
  import('../components/ReaderPassportWidget').then((m) => ({ default: m.ReaderPassportWidget }))
);
const ReleaseHistoryModal = lazy(() =>
  import('../components/ReleaseHistoryModal').then((m) => ({ default: m.ReleaseHistoryModal }))
);
const ThemeModal = lazy(() =>
  import('../components/ThemeModal').then((m) => ({ default: m.ThemeModal }))
);
const TitlesBadgesModal = lazy(() =>
  import('../components/TitlesBadgesModal').then((m) => ({ default: m.TitlesBadgesModal }))
);

import {
  OMNIPRISM_DOMAINS,
  domainConfig,
  getDomainVocabulary,
  inferDomainFromWork,
  normalizeDomainId,
} from '../config/domainConfig';
import { APP_BUILD_LABEL, CODICE_RELEASE } from '../config/versioning';
import { useToast } from '../context/ToastContext';
import { useAiConfig } from '../hooks/useAiConfig';
import {
  buildProfilePersonalFeed,
  computeCollectorMilestones,
  computeDomainBreakdownMetrics,
  computeProfileMetrics,
  computeRatingHistogram,
  computeRecentActivityWorks,
  normalizeCollectorHandle,
  resolveCollectorIdentity,
  resolveProfileHeroBackdrop,
  resolveTop4Favorites,
} from '../lib/profileMetrics';
import {
  evaluateReaderTitles,
  pinTitleBadge,
} from '../services/readerTitlesEngine';
import { getRelationalApiCache } from '../services/relationalDb';
import { getWatchedEpisodesCount, getWatchedMinutes } from '../utils/backlogHelpers';
import {
  isSoundEnabled,
  playTactileSound,
  setSoundEnabled,
} from '../utils/soundEffects';
import { buildDomainPortalPalette } from '../utils/themeTokens';

const PROFILE_TAB_SESSION_KEY = 'codice_profile_active_tab_v1';
const PAGE_SIZE = 20;
const PROFILE_TABS_IDS = ['journal', 'shelf', 'badges'];

function loadSessionActiveTab() {
  try {
    if (typeof sessionStorage === 'undefined') return 'journal';
    const raw = sessionStorage.getItem(PROFILE_TAB_SESSION_KEY);
    return PROFILE_TABS_IDS.includes(raw) ? raw : 'journal';
  } catch {
    return 'journal';
  }
}

function getDomainIcon(domainId) {
  if (domainId === 'reading') return BookOpen;
  if (domainId === 'games') return Gamepad2;
  if (domainId === 'music') return Music;
  return Film;
}

export function ProfileScreen({
  items = [],
  profile,
  posts = [],
  readingSessions = [],
  streakCount = 0,
  storedReaderBooksCount = 0,
  themeProps,
  activeDomain = 'cinema',
  onSelectDomain,
  themeMode = 'dark',
  geminiKey = '',
  hasGeminiKey = false,
  aiConfig = null,
  backupReminder = null,
  onSaveBackupNow,
  onDismissBackupReminder,
  onOpenGeminiSettings,
  onOpenThemeStudio,
  onSaveGeminiKey,
  onReopenOnboarding,
  onUpdateProfile,
  onUpdateItem,
  onSelectItem,
  onOpenJournalComposer,
  onDeletePost,
  onAddPostComment,
  onDeletePostComment,
  onExportBackup,
  onExportCsv,
  onExportBibtex,
  onImportBackup,
  onOpenBackupModal,
  onOpenImportCatalog,
  onOpenShortcuts,
  onOpenAboutCredits,
  cloudState = null,
  onOpenCloudModal,
  pwaCheckState = 'idle',
  pwaRemoteVersion = '',
  onCheckPwaUpdate,
  onApplyPwaUpdate,
}) {
  const { showToast } = useToast();
  const { ui, cardFields } = domainConfig;
  const { profile: profileCfg } = ui;

  const [activeTab, setActiveTab] = useState(loadSessionActiveTab);
  const [favoritesDomain, setFavoritesDomain] = useState(() =>
    normalizeDomainId(activeDomain)
  );
  const [bannerImgError, setBannerImgError] = useState(false);

  useEffect(() => {
    setFavoritesDomain(normalizeDomainId(activeDomain));
  }, [activeDomain]);

  const [shelfLimit, setShelfLimit] = useState(PAGE_SIZE);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState(null);
  const [themeModalOpen, setThemeModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [titlesModalOpen, setTitlesModalOpen] = useState(false);
  const [releaseModalOpen, setReleaseModalOpen] = useState(false);
  const [pickerSlot, setPickerSlot] = useState(null);
  const [pickerQuery, setPickerQuery] = useState('');
  const [selectedPostId, setSelectedPostId] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [soundOn, setSoundOn] = useState(isSoundEnabled);
  const [systemDrawerOpen, setSystemDrawerOpen] = useState(
    () => pwaCheckState === 'update_available'
  );

  useEffect(() => {
    if (pwaCheckState === 'update_available') {
      setSystemDrawerOpen(true);
    }
  }, [pwaCheckState]);

  // Estado da edição inline suave do Hero de Identidade
  const [inlineEditing, setInlineEditing] = useState(false);
  const [inlineName, setInlineName] = useState('');
  const [inlineHandle, setInlineHandle] = useState('');
  const [inlineTitle, setInlineTitle] = useState('');
  const [inlineBio, setInlineBio] = useState('');

  const localAiConfig = useAiConfig();
  const resolvedAiConfig = aiConfig || localAiConfig;
  const hasAnyAiConfigured = Boolean(
    hasGeminiKey || resolvedAiConfig.hasAnyAiKey || geminiKey
  );

  const fileInputRef = useRef(null);
  const settingsBtnRef = useRef(null);
  const tabRefs = useRef([]);

  useEffect(() => {
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(PROFILE_TAB_SESSION_KEY, activeTab);
      }
    } catch {
      // Ignora erro de sessionStorage
    }
  }, [activeTab]);

  // Hidrata avatar local do IndexedDB (api_cache) caso o perfil ainda não tenha avatarUrl/avatarIcon
  useEffect(() => {
    let cancelled = false;
    getRelationalApiCache('profile:local_avatar_v120')
      .then((res) => {
        if (cancelled || !res?.hit || !res.data) return;
        const patch = {};
        if (res.data.avatarUrl && !profile?.avatarUrl) {
          patch.avatarUrl = res.data.avatarUrl;
        }
        if (res.data.avatarIcon && !profile?.avatarIcon) {
          patch.avatarIcon = res.data.avatarIcon;
        }
        if (Object.keys(patch).length > 0) {
          onUpdateProfile?.(patch);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!feedback) return undefined;
    const timer = setTimeout(() => setFeedback(null), 3000);
    return () => clearTimeout(timer);
  }, [feedback]);

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const result = await onImportBackup?.(file);
    if (result?.ok) {
      setFeedback({
        type: 'success',
        text: `${profileCfg.backup.importSuccessPrefix} ${result.count}`,
      });
    } else if (result?.error) {
      setFeedback({ type: 'error', text: result.error });
    }
  };

  const backlogItems = useMemo(
    () => items.filter((item) => item && item.inBacklog !== false),
    [items]
  );

  const favoritesDomainWorks = useMemo(
    () => backlogItems.filter((item) => inferDomainFromWork(item) === favoritesDomain),
    [backlogItems, favoritesDomain]
  );
  const filteredSwapWorks = useMemo(() => {
    const cleanQ = pickerQuery.trim().toLowerCase();
    if (!cleanQ) return favoritesDomainWorks.slice(0, 16);
    return favoritesDomainWorks
      .filter((w) => {
        const hay = `${w.title || ''} ${w.originalTitle || ''} ${w.creator || ''} ${w.director || ''} ${w.author || ''}`.toLowerCase();
        return hay.includes(cleanQ);
      })
      .slice(0, 16);
  }, [favoritesDomainWorks, pickerQuery]);

  const favoritesVocab = useMemo(
    () => getDomainVocabulary(favoritesDomain),
    [favoritesDomain]
  );
  const top4Slots = useMemo(
    () => resolveTop4Favorites(items, favoritesDomain),
    [items, favoritesDomain]
  );
  const personalFeed = useMemo(
    () => buildProfilePersonalFeed(items, posts, { limit: 18 }),
    [items, posts]
  );
  const ratingHistogram = useMemo(() => computeRatingHistogram(items), [items]);
  const recentActivityWorks = useMemo(
    () => computeRecentActivityWorks(items, 8),
    [items]
  );
  const resolvedThemeMode =
    themeProps?.mode || themeProps?.palette?.mode || themeMode || 'dark';
  const domainBreakdown = useMemo(
    () => computeDomainBreakdownMetrics(items),
    [items]
  );
  const collectorMilestones = useMemo(
    () => computeCollectorMilestones(items),
    [items]
  );

  const statsData = useMemo(() => {
    const completedCount = backlogItems.filter(
      (item) => item.status === 'completed'
    ).length;
    const platinumCount = backlogItems.filter((item) => item.isPlatinum).length;
    const totalMinutesWatched = backlogItems.reduce(
      (sum, item) => sum + getWatchedMinutes(item),
      0
    );
    const totalEpisodesWatched = backlogItems.reduce(
      (sum, item) => sum + getWatchedEpisodesCount(item),
      0
    );

    const { perMinute, perEpisode, perCompleted, perPlatinum, xpPerLevel } =
      profileCfg.xpConfig;
    const totalXp = Math.round(
      totalMinutesWatched * (perMinute ?? 0.25) +
        totalEpisodesWatched * (perEpisode ?? 12) +
        completedCount * perCompleted +
        platinumCount * perPlatinum
    );
    const level = Math.floor(totalXp / xpPerLevel) + 1;
    const currentLevelXp = totalXp % xpPerLevel;
    const xpPct = Math.round((currentLevelXp / xpPerLevel) * 100);

    return {
      level,
      totalXp,
      currentLevelXp,
      xpPerLevel,
      xpPct,
    };
  }, [backlogItems, profileCfg.xpConfig]);

  const selectedPost = useMemo(
    () => posts.find((p) => p.id === selectedPostId) ?? null,
    [posts, selectedPostId]
  );

  const selectedPostLinkedItem = useMemo(
    () =>
      selectedPost?.itemId
        ? items.find((i) => i.id === selectedPost.itemId) ?? null
        : null,
    [items, selectedPost]
  );

  const calmMode = Boolean(profile?.calmMode);
  const gamificationEnabled = profile?.gamificationEnabled !== false && !calmMode;

  const titleEvaluation = useMemo(
    () =>
      evaluateReaderTitles({
        items,
        profile,
        readingSessions,
        streakCount,
        posts,
        wallPostsCount: 0,
        chatMessagesCount: 0,
        storedReaderBooksCount,
      }),
    [items, profile, readingSessions, streakCount, posts, storedReaderBooksCount]
  );

  const collectorIdentity = useMemo(
    () => resolveCollectorIdentity(profile, titleEvaluation, items),
    [profile, titleEvaluation, items]
  );

  const handleOpenInlineEdit = () => {
    setInlineName(collectorIdentity.displayName);
    setInlineHandle(collectorIdentity.handle);
    setInlineTitle(profile?.collectorTitle || '');
    setInlineBio(collectorIdentity.bio);
    setInlineEditing(true);
  };

  const handleSaveInlineEdit = (e) => {
    e?.preventDefault?.();
    const nextName = inlineName.trim() || 'Meu arquivo';
    const nextHandle = normalizeCollectorHandle(inlineHandle);
    const nextTitle = inlineTitle.trim().slice(0, 48);
    const nextBio = inlineBio.trim().slice(0, 220);
    onUpdateProfile?.({
      displayName: nextName,
      handle: nextHandle,
      collectorTitle: nextTitle,
      bio: nextBio,
    });
    setInlineEditing(false);
    playTactileSound('page');
    showToast({ message: 'Perfil de colecionador atualizado.', type: 'success' });
  };

  const handlePinTitleBadge = (badge) => {
    const result = pinTitleBadge(profile, badge, titleEvaluation.catalog);
    if (!result.allowed) {
      showToast({
        message: result.reason || 'Conquiste esta insígnia antes de fixá-la.',
        type: 'info',
      });
      return;
    }
    onUpdateProfile?.({ activeTitleBadge: result.activeTitleBadge });
    setTitlesModalOpen(false);
  };

  const handleAssignTop4Slot = (slotNum, targetWork) => {
    if (!onUpdateItem || !targetWork?.id) return;
    const targetDomain = inferDomainFromWork(targetWork);
    const prevOccupant = backlogItems.find(
      (w) =>
        w.id !== targetWork.id &&
        inferDomainFromWork(w) === targetDomain &&
        Number(w.favoriteRank) === slotNum
    );
    if (prevOccupant) {
      onUpdateItem(prevOccupant.id, { favoriteRank: null });
    }
    onUpdateItem(targetWork.id, {
      favoriteRank: slotNum,
      isFavorite: true,
    });
    playTactileSound('complete');
    showToast({
      message: `"${targetWork.title}" fixado no Top #${slotNum} (${getDomainVocabulary(targetDomain).tabLabel}).`,
      type: 'success',
    });
    setPickerSlot(null);
    setPickerQuery('');
  };

  const handleClearTop4Slot = (slotNum) => {
    if (!onUpdateItem) return;
    const currentOccupant = favoritesDomainWorks.find(
      (w) => Number(w.favoriteRank) === slotNum
    );
    if (currentOccupant) {
      onUpdateItem(currentOccupant.id, { favoriteRank: null });
      showToast({
        message: `"${currentOccupant.title}" removido do Top #${slotNum}.`,
        type: 'info',
      });
    }
    setPickerSlot(null);
    setPickerQuery('');
  };

  const normalizedActiveDomain = normalizeDomainId(activeDomain);
  const heroBanner = useMemo(
    () => resolveProfileHeroBackdrop(items, normalizedActiveDomain),
    [items, normalizedActiveDomain]
  );
  const resolvedBannerUrl =
    profile?.coverUrl && String(profile.coverUrl).trim()
      ? String(profile.coverUrl).trim()
      : heroBanner?.imageUrl || heroBanner?.backdropUrl || '';
  const profileMetrics = useMemo(() => computeProfileMetrics(items), [items]);

  useEffect(() => {
    setBannerImgError(false);
  }, [resolvedBannerUrl]);

  const tabs = useMemo(
    () => [
      { id: 'journal', label: 'Notas & Avaliações' },
      { id: 'shelf', label: 'Meu Catálogo' },
      { id: 'badges', label: calmMode ? 'Passaporte' : 'Insígnias' },
    ],
    [calmMode]
  );

  const resolvedActiveTab = PROFILE_TABS_IDS.includes(activeTab)
    ? activeTab
    : 'journal';

  const handleTabKeyDown = (e, idx) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    const nextIdx = (idx + dir + tabs.length) % tabs.length;
    setActiveTab(tabs[nextIdx].id);
    tabRefs.current[nextIdx]?.focus();
  };

  const visibleShelfWorks = backlogItems.slice(0, shelfLimit);
  const remainingShelf = Math.max(0, backlogItems.length - visibleShelfWorks.length);

  const ActiveDomainIcon = getDomainIcon(normalizedActiveDomain);
  const AvatarEmblemIcon =
    (profile?.avatarIcon && AVATAR_EMBLEM_COMPONENTS[profile.avatarIcon]) ||
    ActiveDomainIcon;

  return (
    <div className="space-y-6 pb-24">
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        onChange={handleFileChange}
        className="hidden"
      />

      {feedback && (
        <div
          role="status"
          className="rounded-[6px] border border-line bg-card px-3 py-2 text-xs text-ink"
        >
          {feedback.text}
        </div>
      )}

      {backupReminder?.shouldRemind && (
        <BackupReminderBanner
          daysWithoutBackup={backupReminder.daysWithoutBackup}
          onSaveBackupNow={onSaveBackupNow}
          onDismiss={onDismissBackupReminder}
        />
      )}

      {/* 1. HERO DE IDENTIDADE DO COLECIONADOR */}
      <header className="-mx-4 sm:-mx-6" data-testid="collector-identity-hero">
        <div
          className="relative aspect-[3/1] max-h-44 w-full overflow-hidden border-y border-line"
          style={{
            background:
              resolvedBannerUrl && !bannerImgError
                ? 'var(--bg-elevated, var(--bg-card))'
                : 'linear-gradient(135deg, color-mix(in srgb, var(--accent-color) 24%, var(--bg-app)) 0%, var(--bg-elevated, var(--bg-card)) 58%, var(--bg-app) 100%)',
          }}
        >
          {resolvedBannerUrl && !bannerImgError ? (
            <>
              <img
                src={resolvedBannerUrl}
                alt={
                  profile?.coverUrl
                    ? 'Capa do perfil'
                    : `Capa de ${heroBanner?.title || 'obra em andamento'}`
                }
                onError={() => setBannerImgError(true)}
                className={`h-full w-full object-cover ${
                  !profile?.coverUrl && heroBanner?.isCoverFallback
                    ? 'scale-110 blur-sm opacity-75'
                    : ''
                }`}
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    'linear-gradient(180deg, rgba(10,12,16,0.72) 0%, rgba(10,12,16,0.84) 100%)',
                }}
              />
              {!profile?.coverUrl && heroBanner?.title && (
                <div className="pointer-events-none absolute right-3 top-2.5 max-w-[70%] rounded-[6px] bg-black/75 px-2.5 py-1 text-right text-[11px] font-medium text-white backdrop-blur-sm">
                  <span className="block truncate">
                    {heroBanner.statusLabel || 'Em andamento'}: {heroBanner.title}
                  </span>
                </div>
              )}
            </>
          ) : (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 opacity-55"
              style={{
                background:
                  'radial-gradient(circle at 82% 22%, color-mix(in srgb, var(--accent-color) 28%, transparent) 0%, transparent 62%)',
              }}
            />
          )}
        </div>

        <div className="px-4 sm:px-6 space-y-5">
          {/* Linha Avatar + Ações Editoriais */}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <button
              type="button"
              onClick={() => setEditModalOpen(true)}
              aria-label="Personalizar avatar e capa"
              className="group -mt-10 relative z-10 flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border-2 bg-card text-accent transition-transform hover:scale-[1.03]"
              style={{ borderColor: 'var(--bg-app)' }}
            >
              {profile?.avatarUrl ? (
                <img
                  src={profile.avatarUrl}
                  alt={collectorIdentity.displayName}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-elevated text-accent">
                  <AvatarEmblemIcon className="h-8 w-8" strokeWidth={1.5} />
                </div>
              )}
              <span className="absolute bottom-1 right-1 flex h-6 w-6 items-center justify-center rounded-[6px] bg-black/75 text-white opacity-90 transition-opacity group-hover:opacity-100">
                <Camera className="h-3 w-3" strokeWidth={1.5} />
              </span>
            </button>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  onOpenThemeStudio ? onOpenThemeStudio() : setThemeModalOpen(true)
                }
                aria-label="Temas e Aparência"
                title="Temas e Aparência"
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-[6px] border border-line bg-card px-3 text-xs font-medium text-ink transition-colors hover:border-muted"
              >
                <Palette className="h-3.5 w-3.5 text-muted" strokeWidth={1.5} />
                <span>Temas &amp; Aparência</span>
              </button>

              <button
                type="button"
                data-testid="inline-identity-edit-btn"
                onClick={() =>
                  inlineEditing ? setInlineEditing(false) : handleOpenInlineEdit()
                }
                aria-expanded={inlineEditing}
                className={`inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-[6px] border px-3 text-xs font-medium transition-colors ${
                  inlineEditing
                    ? 'border-accent bg-accent text-accent-ink'
                    : 'border-line bg-card text-ink hover:border-muted'
                }`}
              >
                <PenLine className="h-3.5 w-3.5" strokeWidth={1.5} />
                <span>{inlineEditing ? 'Fechar edição' : profileCfg.editProfileLabel}</span>
              </button>

              <button
                ref={settingsBtnRef}
                type="button"
                onClick={() => {
                  setSettingsInitialTab(null);
                  setSettingsOpen(true);
                }}
                aria-label="Configurações"
                aria-expanded={settingsOpen}
                title="Configurações"
                className={`flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-[6px] border transition-colors ${
                  hasAnyAiConfigured
                    ? 'border-line bg-card text-accent hover:border-muted'
                    : 'border-line bg-card text-muted hover:border-muted hover:text-ink'
                }`}
              >
                <Settings className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>
          </div>

          {/* Identidade: Leitura Editorial OU Edição Inline Suave */}
          {inlineEditing ? (
            <form
              onSubmit={handleSaveInlineEdit}
              data-testid="inline-identity-form"
              className="rounded-[6px] border border-line bg-card p-4 space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-ink">
                  Editar identidade do colecionador
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setInlineEditing(false);
                    setEditModalOpen(true);
                  }}
                  className="inline-flex min-h-[44px] items-center gap-1 text-xs font-medium text-muted underline underline-offset-2 hover:text-ink"
                >
                  <Camera className="h-3.5 w-3.5" strokeWidth={1.5} />
                  <span>Trocar avatar / capa</span>
                </button>
              </div>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-muted">
                    Nome
                  </span>
                  <input
                    type="text"
                    value={inlineName}
                    onChange={(e) => setInlineName(e.target.value)}
                    maxLength={48}
                    placeholder="Meu arquivo"
                    aria-label="Nome do perfil"
                    className="min-h-[44px] w-full rounded-[6px] border border-line bg-app px-3 text-xs text-ink focus:border-accent focus:outline-none"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-muted">
                    Arroba (@handle)
                  </span>
                  <input
                    type="text"
                    value={inlineHandle}
                    onChange={(e) => setInlineHandle(e.target.value)}
                    maxLength={32}
                    placeholder="@meu-arquivo"
                    aria-label="Arroba do perfil"
                    className="min-h-[44px] w-full rounded-[6px] border border-line bg-app px-3 text-xs text-ink focus:border-accent focus:outline-none"
                  />
                </label>
              </div>

              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-muted">
                  Título de colecionador (opcional — vazio usa sua insígnia ativa)
                </span>
                <input
                  type="text"
                  value={inlineTitle}
                  onChange={(e) => setInlineTitle(e.target.value)}
                  maxLength={48}
                  placeholder={collectorIdentity.collectorTitle}
                  aria-label="Título de colecionador"
                  className="min-h-[44px] w-full rounded-[6px] border border-line bg-app px-3 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-muted">
                  Bio curta
                </span>
                <textarea
                  rows={2}
                  value={inlineBio}
                  onChange={(e) => setInlineBio(e.target.value)}
                  maxLength={220}
                  placeholder="Filmes, livros, games e discos que marcaram sua trajetória..."
                  aria-label="Bio curta"
                  className="w-full rounded-[6px] border border-line bg-app p-2.5 text-xs leading-relaxed text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
                />
              </label>

              <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setInlineEditing(false)}
                  className="min-h-[44px] rounded-[6px] border border-line bg-app px-4 text-xs font-medium text-muted hover:text-ink"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[6px] bg-accent px-4 text-xs font-semibold text-accent-ink hover:opacity-90"
                >
                  <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
                  <span>Salvar identidade</span>
                </button>
              </div>
            </form>
          ) : (
            <div className="min-w-0 space-y-1.5">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                <h1
                  className="font-editorial min-w-0 truncate text-2xl font-bold text-ink"
                  style={{ letterSpacing: '-0.02em', lineHeight: 1.15 }}
                >
                  {collectorIdentity.displayName}
                </h1>
                <span
                  data-testid="collector-handle"
                  className="text-xs font-medium text-subtle"
                >
                  {collectorIdentity.handle}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    gamificationEnabled ? setTitlesModalOpen(true) : handleOpenInlineEdit()
                  }
                  data-testid="collector-title-badge"
                  className="inline-flex min-h-[32px] max-w-full items-center gap-1.5 rounded-[6px] border border-line bg-card px-2.5 py-1 text-xs font-medium text-ink transition-colors hover:border-muted"
                >
                  <Award className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.5} />
                  <span className="truncate">{collectorIdentity.collectorTitle}</span>
                </button>
              </div>

              {collectorIdentity.bio && (
                <p className="line-clamp-3 max-w-[68ch] text-xs leading-relaxed text-muted">
                  {collectorIdentity.bio}
                </p>
              )}
            </div>
          )}

          {/* Faixa Editorial de Métricas Diretas (sem card dentro de card) */}
          <div className="grid grid-cols-2 gap-3 border-y border-line py-3 sm:grid-cols-4 tabular-nums">
            <button
              type="button"
              onClick={() => setActiveTab('shelf')}
              aria-label={`Ver ${profileMetrics.totalWorks} obras no catálogo`}
              className="flex min-h-[44px] flex-col justify-center rounded-[6px] px-1 text-left transition-colors hover:text-accent"
            >
              <span className="text-[11px] font-medium uppercase tracking-wider text-subtle">
                Obras
              </span>
              <span className="text-sm font-semibold text-ink">
                {profileMetrics.totalWorks}{' '}
                <span className="text-xs font-normal text-muted">
                  ({profileMetrics.completedWorks}{' '}
                  {profileMetrics.completedWorks === 1 ? 'concluída' : 'concluídas'})
                </span>
              </span>
            </button>

            <div className="flex min-h-[44px] flex-col justify-center px-1">
              <span className="text-[11px] font-medium uppercase tracking-wider text-subtle">
                Episódios / Horas
              </span>
              <span className="text-sm font-semibold text-ink">
                {profileMetrics.episodesWatched} eps · {profileMetrics.watchedHoursLabel}
              </span>
              {profileMetrics.unknownDurationCount > 0 && (
                <span className="text-[11px] text-subtle">
                  {profileMetrics.unknownDurationCount} sem duração excluída(s)
                </span>
              )}
            </div>

            <div className="flex min-h-[44px] flex-col justify-center px-1">
              <span className="text-[11px] font-medium uppercase tracking-wider text-subtle">
                Média Geral
              </span>
              <span className="text-sm font-semibold text-ink">
                {profileMetrics.averageRatingLabel}
                {profileMetrics.averageRating !== null ? ' / 100' : ''}
              </span>
              <span className="text-[11px] text-subtle">
                {profileMetrics.ratedWorksCount > 0
                  ? `${profileMetrics.ratedWorksCount} avaliada(s)`
                  : 'Sem notas confirmadas'}
              </span>
            </div>

            <div className="flex min-h-[44px] flex-col justify-center px-1">
              <span className="text-[11px] font-medium uppercase tracking-wider text-subtle">
                Obras da Vida
              </span>
              <span className="text-sm font-semibold text-ink">
                {collectorMilestones.lifeWorks.count}{' '}
                <span className="text-xs font-normal text-muted">
                  · {profileMetrics.ratedWorksCount}/{profileMetrics.totalWorks} aval.
                </span>
              </span>
            </div>
          </div>

          {/* 2. PAINEL DE PROGRESSO NOS 4 MUNDOS */}
          <section
            aria-label="Resumo dos 4 Mundos"
            data-testid="four-worlds-progress-panel"
            className="space-y-3"
          >
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
                Resumo dos 4 Mundos · Progresso
              </h2>
              <span className="text-xs tabular-nums text-subtle">
                {profileMetrics.totalWorks} catalogadas
              </span>
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              {domainBreakdown.map((dom) => {
                const portalPalette = buildDomainPortalPalette(dom.tintHex, resolvedThemeMode);
                const isActive = normalizedActiveDomain === dom.domainId;
                const DomIcon = getDomainIcon(dom.domainId);

                return (
                  <button
                    key={dom.domainId}
                    type="button"
                    data-testid={`world-progress-card-${dom.domainId}`}
                    onClick={() => {
                      onSelectDomain?.(dom.domainId);
                      setFavoritesDomain(dom.domainId);
                    }}
                    className={`flex min-h-[44px] flex-col justify-between gap-2.5 rounded-[6px] border p-3.5 text-left transition-colors ${
                      isActive
                        ? 'border-ink/40 bg-elevated'
                        : 'border-line bg-card hover:border-muted'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink">
                        <DomIcon
                          className="h-4 w-4 shrink-0"
                          strokeWidth={1.5}
                          style={{ color: portalPalette.accent }}
                        />
                        <span className="truncate">{dom.tabLabel || dom.shortLabel}</span>
                      </span>
                      <span className="text-base font-bold tabular-nums text-ink">
                        {dom.totalWorks}
                      </span>
                    </div>

                    <div className="h-[3px] w-full overflow-hidden rounded-full bg-line">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${dom.totalWorks > 0 ? Math.max(4, dom.completionRatePct) : 0}%`,
                          backgroundColor: portalPalette.accent,
                        }}
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-1.5 text-[11px] tabular-nums">
                      <div>
                        <span className="block text-[10px] text-subtle">Concluídos</span>
                        <span className="font-semibold text-ink">{dom.completedWorks}</span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-subtle">Média</span>
                        <span className="font-semibold text-ink">
                          {dom.averageRatingLabel}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[10px] text-subtle">Obras da Vida</span>
                        <span className="inline-flex items-center gap-0.5 font-semibold text-ink">
                          {dom.lifeWorksCount > 0 && (
                            <Award
                              className="h-3 w-3 shrink-0"
                              strokeWidth={1.5}
                              style={{ color: portalPalette.accent }}
                            />
                          )}
                          <span>{dom.lifeWorksCount}</span>
                        </span>
                      </div>
                    </div>

                    <p className="border-t border-line pt-2 text-[11px] tabular-nums text-muted">
                      {dom.progressSummary}
                    </p>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 3. VITRINE TOP 4 INTERATIVA POR DOMÍNIO (COM TROCA DIRETA SEM SUBMENUS) */}
          <section
            aria-label={favoritesVocab.favoritesTitle}
            data-testid="collector-top4-showcase"
            className="border-t border-line pt-5 space-y-3"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
                {favoritesVocab.favoritesTitle}
              </h2>
              <span className="text-xs tabular-nums text-subtle">
                {top4Slots.filter((s) => Boolean(s.work)).length}/4 fixados
              </span>
            </div>

            <div
              role="tablist"
              aria-label="Domínios da Vitrine Top 4"
              className="grid grid-cols-4 gap-1.5"
            >
              {OMNIPRISM_DOMAINS.map((dom) => {
                const isFavTabActive = favoritesDomain === dom.id;
                return (
                  <button
                    key={dom.id}
                    type="button"
                    role="tab"
                    aria-selected={isFavTabActive}
                    onClick={() => {
                      setFavoritesDomain(dom.id);
                      setPickerSlot(null);
                      setPickerQuery('');
                    }}
                    className={`min-h-[44px] rounded-[6px] border px-2 text-xs font-semibold transition-colors ${
                      isFavTabActive
                        ? 'border-accent bg-accent text-accent-ink'
                        : 'border-line bg-card text-muted hover:text-ink'
                    }`}
                  >
                    {dom.tabLabel}
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {top4Slots.map(({ slot, work }) => {
                const isEditingSlot = pickerSlot === slot;
                const ratioClass = favoritesDomain === 'music' ? 'aspect-square' : 'aspect-[2/3]';
                return work ? (
                  <div
                    key={`top4-slot-${slot}`}
                    className="group flex flex-col justify-between"
                  >
                    <button
                      type="button"
                      onClick={() => onSelectItem?.(work)}
                      className={`relative w-full overflow-hidden rounded-[6px] text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                        isEditingSlot ? 'ring-2 ring-accent' : ''
                      }`}
                    >
                      <CoverArt
                        item={work}
                        compact
                        className={`${ratioClass} w-full rounded-[6px] object-cover`}
                      />
                    </button>

                    <div className="mt-1.5 flex items-center justify-between gap-1">
                      <p className="font-editorial min-w-0 flex-1 truncate text-xs font-semibold text-ink">
                        <span className="mr-1 font-sans text-[11px] tabular-nums text-subtle">
                          #{slot}
                        </span>
                        {work.title}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setPickerQuery('');
                          setPickerSlot((curr) => (curr === slot ? null : slot));
                        }}
                        aria-label={`Trocar favorito #${slot}`}
                        aria-expanded={isEditingSlot}
                        className={`min-h-[44px] shrink-0 px-1.5 text-xs font-medium transition-colors ${
                          isEditingSlot ? 'text-accent' : 'text-muted hover:text-ink'
                        }`}
                      >
                        {isEditingSlot ? 'Fechar' : 'Trocar'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    key={`top4-slot-${slot}`}
                    type="button"
                    onClick={() => {
                      setPickerQuery('');
                      setPickerSlot((curr) => (curr === slot ? null : slot));
                    }}
                    aria-expanded={isEditingSlot}
                    className={`flex ${ratioClass} min-h-[44px] w-full flex-col items-center justify-center gap-1.5 rounded-[6px] border p-3 text-center transition-colors ${
                      isEditingSlot
                        ? 'border-accent bg-elevated'
                        : 'border-line bg-card hover:border-muted'
                    }`}
                  >
                    <Plus className="h-4 w-4 text-muted" strokeWidth={1.5} />
                    <span className="text-xs font-medium text-ink">Escolher favorito</span>
                    <span className="text-[11px] tabular-nums text-subtle">#{slot}</span>
                  </button>
                );
              })}
            </div>

            {/* Troca direta inline da vitrine Top 4 (sem submenus escondidos) */}
            {pickerSlot !== null && (
              <div
                data-testid="top4-inline-swap-panel"
                className="rounded-[6px] border border-line bg-card p-3.5 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-ink tabular-nums">
                      Trocar posição #{pickerSlot} · {favoritesVocab.tabLabel}
                    </p>
                    <p className="text-[11px] text-muted">
                      Toque em uma obra para fixar imediatamente na vitrine
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {favoritesDomainWorks.some((w) => Number(w.favoriteRank) === pickerSlot) && (
                      <button
                        type="button"
                        onClick={() => handleClearTop4Slot(pickerSlot)}
                        className="min-h-[44px] rounded-[6px] border border-line bg-app px-3 text-xs font-medium text-muted hover:text-ink"
                      >
                        Limpar #{pickerSlot}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setPickerSlot(null);
                        setPickerQuery('');
                      }}
                      aria-label="Fechar troca da vitrine"
                      className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[6px] border border-line bg-app text-muted hover:text-ink"
                    >
                      <X className="h-4 w-4" strokeWidth={1.5} />
                    </button>
                  </div>
                </div>

                {favoritesDomainWorks.length > 4 && (
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle"
                      strokeWidth={1.5}
                    />
                    <input
                      type="search"
                      value={pickerQuery}
                      onChange={(e) => setPickerQuery(e.target.value)}
                      placeholder={`Filtrar em ${favoritesVocab.tabLabel}...`}
                      aria-label={`Filtrar obras de ${favoritesVocab.tabLabel}`}
                      className="min-h-[44px] w-full rounded-[6px] border border-line bg-app pl-9 pr-3 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
                    />
                  </div>
                )}

                {filteredSwapWorks.length === 0 ? (
                  <p className="py-3 text-xs text-muted">
                    {favoritesDomainWorks.length === 0
                      ? `Catalogue obras em ${favoritesVocab.tabLabel} para montar sua vitrine Top 4.`
                      : 'Nenhuma obra encontrada com esse filtro.'}
                  </p>
                ) : (
                  <div className="max-h-64 divide-y divide-line overflow-y-auto border-y border-line no-scrollbar">
                    {filteredSwapWorks.map((work) => {
                      const isCurrent = Number(work.favoriteRank) === pickerSlot;
                      return (
                        <button
                          key={work.id}
                          type="button"
                          onClick={() => handleAssignTop4Slot(pickerSlot, work)}
                          className={`flex min-h-[52px] w-full items-center justify-between gap-3 py-2 px-1.5 text-left transition-colors hover:bg-app ${
                            isCurrent ? 'bg-elevated' : ''
                          }`}
                        >
                          <div className="flex min-w-0 items-center gap-2.5">
                            <CoverArt
                              item={work}
                              compact
                              className={`w-8 shrink-0 rounded-[6px] ${
                                favoritesDomain === 'music' ? 'aspect-square' : 'aspect-[2/3]'
                              }`}
                            />
                            <div className="min-w-0">
                              <p className="font-editorial truncate text-xs font-semibold text-ink">
                                {work.title}
                              </p>
                              <p className="truncate text-[11px] tabular-nums text-muted">
                                {[
                                  work.creator || work.director || work.author || work.studio,
                                  work.releaseYear,
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </p>
                            </div>
                          </div>
                          <span
                            className={`shrink-0 text-[11px] font-semibold tabular-nums ${
                              isCurrent ? 'text-accent' : 'text-muted'
                            }`}
                          >
                            {isCurrent ? `Atual #${pickerSlot}` : `Fixar #${pickerSlot}`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* 4. ESTANTE DE MARCOS & CONQUISTAS DO CATÁLOGO */}
          <section
            aria-label="Estante de Marcos e Conquistas do Catálogo"
            data-testid="collector-milestones-shelf"
            className="border-t border-line pt-5 space-y-3"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
                Estante de Marcos &amp; Conquistas
              </h2>
              <span className="text-xs tabular-nums text-subtle">
                {collectorMilestones.totalMilestones} marcos no catálogo
              </span>
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              {/* Platinas / 100% em Games */}
              <div
                data-testid="milestone-platinums"
                className="flex flex-col justify-between gap-2.5 rounded-[6px] border border-line bg-card p-3.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink">
                    <Trophy className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.5} />
                    <span>Platinas / 100%</span>
                  </span>
                  <span className="text-base font-bold tabular-nums text-ink">
                    {collectorMilestones.platinums.count}
                  </span>
                </div>
                {collectorMilestones.platinums.works.length > 0 ? (
                  <div className="divide-y divide-line border-t border-line pt-1">
                    {collectorMilestones.platinums.works.slice(0, 3).map((game) => (
                      <button
                        key={game.id}
                        type="button"
                        onClick={() => onSelectItem?.(game)}
                        className="flex min-h-[36px] w-full items-center justify-between gap-2 py-1 text-left text-xs text-ink hover:text-accent"
                      >
                        <span className="font-editorial truncate">{game.title}</span>
                        {game.platform && (
                          <span className="shrink-0 text-[10px] text-subtle">
                            {game.platform}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] leading-snug text-muted">
                    Conclua um jogo em 100% / Platina para destacar aqui.
                  </p>
                )}
              </div>

              {/* Sagas Concluídas */}
              <div
                data-testid="milestone-sagas"
                className="flex flex-col justify-between gap-2.5 rounded-[6px] border border-line bg-card p-3.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink">
                    <Layers className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.5} />
                    <span>Sagas Concluídas</span>
                  </span>
                  <span className="text-base font-bold tabular-nums text-ink">
                    {collectorMilestones.completedSagas.count}
                  </span>
                </div>
                {collectorMilestones.completedSagas.sagas.length > 0 ? (
                  <div className="divide-y divide-line border-t border-line pt-1">
                    {collectorMilestones.completedSagas.sagas.slice(0, 3).map((saga) => (
                      <button
                        key={saga.id}
                        type="button"
                        onClick={() => saga.coverWork && onSelectItem?.(saga.coverWork)}
                        className="flex min-h-[36px] w-full items-center justify-between gap-2 py-1 text-left text-xs text-ink hover:text-accent"
                      >
                        <span className="font-editorial truncate">{saga.name}</span>
                        <span className="shrink-0 text-[10px] tabular-nums text-subtle">
                          {saga.completedCount}/{saga.totalCount}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] leading-snug text-muted">
                    Finalize todos os títulos principais de uma franquia.
                  </p>
                )}
              </div>

              {/* Discografias Completas */}
              <div
                data-testid="milestone-discographies"
                className="flex flex-col justify-between gap-2.5 rounded-[6px] border border-line bg-card p-3.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink">
                    <Disc3 className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.5} />
                    <span>Discografias Completas</span>
                  </span>
                  <span className="text-base font-bold tabular-nums text-ink">
                    {collectorMilestones.completedDiscographies.count}
                  </span>
                </div>
                {collectorMilestones.completedDiscographies.artists.length > 0 ? (
                  <div className="divide-y divide-line border-t border-line pt-1">
                    {collectorMilestones.completedDiscographies.artists.slice(0, 3).map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => entry.coverWork && onSelectItem?.(entry.coverWork)}
                        className="flex min-h-[36px] w-full items-center justify-between gap-2 py-1 text-left text-xs text-ink hover:text-accent"
                      >
                        <span className="font-editorial truncate">{entry.artist}</span>
                        <span className="shrink-0 text-[10px] tabular-nums text-subtle">
                          {entry.completedCount}{' '}
                          {entry.completedCount === 1 ? 'álbum' : 'álbuns'}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] leading-snug text-muted">
                    Complete os álbuns de estúdio de um artista ou banda.
                  </p>
                )}
              </div>

              {/* Obras da Vida */}
              <div
                data-testid="milestone-lifeworks"
                className="flex flex-col justify-between gap-2.5 rounded-[6px] border border-line bg-card p-3.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink">
                    <Award className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />
                    <span>Obras da Vida</span>
                  </span>
                  <span className="text-base font-bold tabular-nums text-ink">
                    {collectorMilestones.lifeWorks.count}
                  </span>
                </div>
                {collectorMilestones.lifeWorks.works.length > 0 ? (
                  <div className="flex items-center gap-1.5 border-t border-line pt-2">
                    {collectorMilestones.lifeWorks.works.slice(0, 4).map((lw) => {
                      const lwDom = inferDomainFromWork(lw);
                      return (
                        <button
                          key={lw.id}
                          type="button"
                          onClick={() => onSelectItem?.(lw)}
                          title={lw.title}
                          className="w-10 shrink-0 overflow-hidden rounded-[6px] transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          <CoverArt
                            item={lw}
                            compact
                            className={`${lwDom === 'music' ? 'aspect-square' : 'aspect-[2/3]'} w-full rounded-[6px] object-cover`}
                          />
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[11px] leading-snug text-muted">
                    Marque “Obra da vida” nas avaliações que definem seu gosto.
                  </p>
                )}
              </div>
            </div>
          </section>

          {/* 5. ATIVIDADE RECENTE */}
          {recentActivityWorks.length > 0 && (
            <section
              aria-label="Atividade Recente"
              className="border-t border-line pt-5 space-y-3"
            >
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
                  Atividade Recente
                </h2>
                <span className="text-xs tabular-nums text-subtle">
                  Últimas {recentActivityWorks.length} obras
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
                {recentActivityWorks.map(({ id, work, rating, critiqueBadge, hasNotes, hasScene }) => {
                  const isMusicWork = inferDomainFromWork(work) === 'music';
                  return (
                    <button
                      key={`recent-${id}`}
                      type="button"
                      onClick={() => onSelectItem?.(work)}
                      className="group flex flex-col text-left rounded-[6px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <div
                        className={`relative ${isMusicWork ? 'aspect-square' : 'aspect-[2/3]'} w-full overflow-hidden rounded-[6px] bg-app`}
                      >
                        <CoverArt
                          item={work}
                          compact
                          className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                        />
                      </div>

                      <p className="font-editorial mt-1.5 truncate text-xs font-semibold text-ink group-hover:text-accent">
                        {work.title}
                      </p>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] tabular-nums text-muted">
                        {rating !== null && (
                          <span className="inline-flex items-center gap-0.5 font-semibold text-ink">
                            <Star
                              className="h-3 w-3 text-accent"
                              strokeWidth={1.5}
                              fill="currentColor"
                            />
                            <span>{rating}</span>
                          </span>
                        )}
                        {hasScene && (
                          <Quote
                            className="h-3 w-3 text-subtle"
                            strokeWidth={1.5}
                            aria-label="Possui cena favorita"
                          />
                        )}
                        {hasNotes && (
                          <PenLine
                            className="h-3 w-3 text-subtle"
                            strokeWidth={1.5}
                            aria-label="Possui anotação pessoal"
                          />
                        )}
                      </div>
                      {critiqueBadge && (
                        <span className="truncate text-[10px] text-subtle">
                          {critiqueBadge.label}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* 6. HISTOGRAMA DE NOTAS (0–100) */}
          <section
            aria-label="Histograma de Distribuição de Notas"
            className="border-t border-line pt-5 space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <BarChart2 className="h-4 w-4 text-muted" strokeWidth={1.5} />
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
                  Histograma de Notas (0–100)
                </h2>
              </div>
              <span className="text-xs tabular-nums text-subtle">
                {ratingHistogram.totalRated > 0
                  ? `${ratingHistogram.totalRated} notas registradas`
                  : 'Nenhuma nota registrada'}
              </span>
            </div>

            {ratingHistogram.totalRated > 0 ? (
              <div className="space-y-2 pt-1">
                <div className="flex h-20 items-end gap-1 sm:gap-2">
                  {ratingHistogram.buckets.map((b) => (
                    <div
                      key={`hist-${b.key}`}
                      className="group relative flex h-full flex-1 flex-col items-center justify-end"
                    >
                      <span className="pointer-events-none absolute -top-6 z-10 hidden whitespace-nowrap rounded-[6px] bg-black/90 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white group-hover:block">
                        {b.count} {b.count === 1 ? 'obra' : 'obras'} ({b.key})
                      </span>

                      <div
                        className="w-full rounded-t-[3px] transition-all duration-300"
                        style={{
                          height: `${Math.max(4, b.percentage)}%`,
                          backgroundColor:
                            b.count > 0
                              ? 'var(--accent-color)'
                              : 'color-mix(in srgb, var(--border-color) 45%, transparent)',
                        }}
                      />
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between border-t border-line pt-1.5 text-[10px] font-medium tabular-nums text-muted">
                  {ratingHistogram.buckets.map((b) => (
                    <span key={`lbl-${b.key}`} className="flex-1 text-center">
                      {b.label}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <p className="py-3 text-xs text-muted">
                Avalie obras no catálogo para visualizar a distribuição das suas notas.
              </p>
            )}
          </section>
        </div>
      </header>

      {/* 7. ABAS EDITORIAIS: NOTAS & AVALIAÇÕES | MEU CATÁLOGO | INSÍGNIAS */}
      <section className="-mx-4 sm:-mx-6 pt-1">
        <div
          role="tablist"
          aria-label="Seções do perfil"
          className="grid grid-cols-3 border-y border-line"
        >
          {tabs.map((tab, idx) => {
            const isActive = resolvedActiveTab === tab.id;
            return (
              <button
                key={tab.id}
                ref={(el) => {
                  tabRefs.current[idx] = el;
                }}
                type="button"
                role="tab"
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                onClick={() => setActiveTab(tab.id)}
                onKeyDown={(e) => handleTabKeyDown(e, idx)}
                className={`relative flex min-h-[44px] items-center justify-center px-1.5 py-2.5 text-xs font-semibold transition-colors ${
                  isActive ? 'text-ink' : 'text-muted hover:text-ink'
                }`}
              >
                <span className="truncate tabular-nums">{tab.label}</span>
                {isActive && (
                  <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent" />
                )}
              </button>
            );
          })}
        </div>

        {/* ABA 1: NOTAS & AVALIAÇÕES */}
        {resolvedActiveTab === 'journal' && (
          <div className="px-4 sm:px-6 pt-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
                  Memória Recente
                </h2>
                <p className="text-[11px] text-subtle">
                  Suas citações marcantes, notas confirmadas e registros recentes
                </p>
              </div>
              {onOpenJournalComposer && (
                <button
                  type="button"
                  onClick={() => onOpenJournalComposer(null)}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[6px] border border-line bg-card px-3 text-xs font-semibold text-ink hover:border-muted"
                >
                  <Plus className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                  <span>Registrar Nota</span>
                </button>
              )}
            </div>

            {personalFeed.length === 0 ? (
              <p className="border-y border-line py-6 text-xs text-muted">
                Nenhuma avaliação ou nota registrada ainda.
              </p>
            ) : (
              <div className="divide-y divide-line border-y border-line">
                {personalFeed.map((entry) => {
                  const isEntryMusic = entry.work && inferDomainFromWork(entry.work) === 'music';
                  return (
                    <article
                      key={entry.id}
                      className="flex items-start gap-3 py-3.5"
                    >
                      {entry.work && (
                        <button
                          type="button"
                          onClick={() => onSelectItem?.(entry.work)}
                          className={`${isEntryMusic ? 'aspect-square' : 'aspect-[2/3]'} w-14 shrink-0 overflow-hidden rounded-[6px]`}
                        >
                          <CoverArt
                            item={entry.work}
                            compact
                            className="h-full w-full object-cover"
                          />
                        </button>
                      )}

                      <div className="min-w-0 flex-1 space-y-1">
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium tabular-nums text-muted">
                          {entry.kind === 'scene' ? (
                            <Quote className="h-3 w-3 text-accent" strokeWidth={1.5} />
                          ) : entry.kind === 'review' ? (
                            <Star className="h-3 w-3 text-accent" strokeWidth={1.5} />
                          ) : (
                            <Film className="h-3 w-3 text-muted" strokeWidth={1.5} />
                          )}
                          <span>{entry.badge}</span>
                        </span>

                        <button
                          type="button"
                          onClick={() => {
                            if (entry.post) {
                              setSelectedPostId(entry.post.id);
                            } else if (entry.work) {
                              onSelectItem?.(entry.work);
                            }
                          }}
                          className="font-editorial block text-left text-sm font-semibold text-ink hover:text-accent"
                        >
                          {entry.title}
                        </button>

                        {entry.quoteText && (
                          <blockquote className="border-l-2 border-accent/60 pl-2.5 text-xs italic leading-relaxed text-ink">
                            “{entry.quoteText}”
                          </blockquote>
                        )}

                        {entry.reviewText && (
                          <p className="line-clamp-3 text-xs leading-relaxed text-muted">
                            {entry.reviewText}
                          </p>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ABA 2: MEU CATÁLOGO */}
        {resolvedActiveTab === 'shelf' && (
          <div className="px-4 sm:px-6 pt-4">
            {backlogItems.length === 0 ? (
              <p className="border-y border-line py-6 text-xs text-muted">
                Nenhuma obra catalogada no catálogo ainda.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="divide-y divide-line border-y border-line">
                  {visibleShelfWorks.map((work) => {
                    const isMusicWork = inferDomainFromWork(work) === 'music';
                    return (
                      <button
                        key={work.id}
                        type="button"
                        onClick={() => onSelectItem?.(work)}
                        className="flex min-h-[56px] w-full items-center justify-between gap-3 py-2.5 text-left transition-colors hover:bg-card/60"
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <CoverArt
                            item={work}
                            compact
                            className={`w-9 shrink-0 rounded-[6px] ${
                              isMusicWork ? 'aspect-square' : 'aspect-[2/3]'
                            }`}
                          />
                          <div className="min-w-0">
                            <p className="font-editorial truncate text-sm font-semibold text-ink">
                              {work.title}
                            </p>
                            <p className="truncate text-xs text-muted">
                              {work.creator ||
                                work.director ||
                                work.author ||
                                work.studio ||
                                work[cardFields.creator] ||
                                'Criador não informado'}
                            </p>
                          </div>
                        </div>
                        {typeof work[cardFields.rating] === 'number' &&
                          work.ratingSource !== 'legacy-default' && (
                            <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold tabular-nums text-ink">
                              <Star
                                className="h-3.5 w-3.5 text-accent"
                                strokeWidth={1.5}
                                fill="currentColor"
                              />
                              {work[cardFields.rating]}
                            </span>
                          )}
                      </button>
                    );
                  })}
                </div>

                {remainingShelf > 0 && (
                  <button
                    type="button"
                    onClick={() => setShelfLimit((prev) => prev + PAGE_SIZE)}
                    className="min-h-[44px] w-full rounded-[6px] border border-line bg-card text-xs font-medium tabular-nums text-ink hover:border-muted"
                  >
                    Carregar mais ({remainingShelf} restantes)
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* ABA 3: INSÍGNIAS & PASSAPORTE */}
        {resolvedActiveTab === 'badges' && (
          <Suspense fallback={null}>
            <div className="px-4 sm:px-6 pt-4 space-y-4">
              <ReaderPassportWidget
                items={items}
                posts={posts}
                streakCount={streakCount}
              />

              {!gamificationEnabled ? (
                <p className="border-y border-line py-6 text-xs text-muted">
                  {calmMode
                    ? 'Modo Calmo ativo: XP e contadores numéricos permanecem ocultos.'
                    : 'Gamificação desativada nas configurações do perfil.'}
                </p>
              ) : (
                <>
                  <div className="rounded-[6px] border border-line bg-card p-3.5 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
                        <span className="inline-flex items-center gap-1 rounded-[6px] bg-accent px-2 py-0.5 text-[11px] font-bold tabular-nums text-accent-ink">
                          <Zap className="h-3 w-3" strokeWidth={1.5} />
                          {profileCfg.levelPrefix} {statsData.level}
                        </span>
                        <span className="font-medium tabular-nums text-muted">
                          {titleEvaluation.unlockedCount}/{titleEvaluation.totalCount} insígnias
                        </span>
                      </span>
                      <span className="text-[11px] tabular-nums text-subtle">
                        {statsData.currentLevelXp}/{statsData.xpPerLevel} XP
                      </span>
                    </div>
                    <div
                      role="progressbar"
                      aria-label="Progresso de XP do espectador"
                      aria-valuemin={0}
                      aria-valuemax={statsData.xpPerLevel}
                      aria-valuenow={statsData.currentLevelXp}
                      className="h-1 w-full overflow-hidden rounded-full bg-line"
                    >
                      <div
                        className="h-full bg-accent transition-all duration-300"
                        style={{ width: `${Math.max(4, statsData.xpPct)}%` }}
                      />
                    </div>
                  </div>

                  <BadgesGallery
                    evaluation={titleEvaluation}
                    onSelectAutoMode={() =>
                      onUpdateProfile?.({ activeTitleBadge: 'auto' })
                    }
                    onPinTitleBadge={handlePinTitleBadge}
                  />
                </>
              )}
            </div>
          </Suspense>
        )}
      </section>

      {/* 8. GAVETA / SEÇÃO SECUNDÁRIA DE SISTEMA, APIS, BACKUP, ATUALIZAÇÃO E DIAGNÓSTICO NO RODAPÉ */}
      <section
        aria-label="Configurações, APIs e Ferramentas do Sistema"
        data-testid="profile-system-drawer"
        className="border-t border-line pt-4 space-y-2"
      >
        <button
          type="button"
          data-testid="profile-system-drawer-toggle"
          onClick={() => setSystemDrawerOpen((v) => !v)}
          aria-expanded={systemDrawerOpen}
          className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-[6px] border border-line bg-card px-3.5 py-2.5 text-left transition-colors hover:border-muted"
        >
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-xs font-semibold text-ink">
              <Settings className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.5} />
              <span>Configurações, APIs &amp; Sistema</span>
              {pwaCheckState === 'update_available' && (
                <span className="inline-block h-2 w-2 rounded-full bg-accent" />
              )}
            </p>
            <p className="mt-0.5 truncate text-[11px] text-subtle">
              Configurações · Status das APIs · Central de Backup · Atualização · Diagnóstico
            </p>
          </div>
          {systemDrawerOpen ? (
            <ChevronUp className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.5} />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.5} />
          )}
        </button>

        {systemDrawerOpen && (
          <div className="divide-y divide-line rounded-[6px] border border-line bg-card">
            <button
              type="button"
              data-testid="profile-open-settings-btn"
              onClick={() => {
                setSettingsInitialTab(null);
                setSettingsOpen(true);
              }}
              className="flex min-h-[44px] w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-xs font-medium text-ink transition-colors hover:bg-app"
            >
              <span className="inline-flex items-center gap-2.5">
                <Settings className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.5} />
                <span>Configurações</span>
              </span>
              <span className="text-[11px] text-subtle">Aparência · DNA · Modo Calmo</span>
            </button>

            <button
              type="button"
              data-testid="profile-api-status-btn"
              onClick={() => {
                setSettingsInitialTab('data');
                setSettingsOpen(true);
              }}
              className="flex min-h-[44px] w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-xs font-medium text-ink transition-colors hover:bg-app"
            >
              <span className="inline-flex items-center gap-2.5">
                <Globe className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.5} />
                <span>Status das APIs</span>
              </span>
              <span className="text-[11px] text-subtle">Fontes &amp; Proxies</span>
            </button>

            <button
              type="button"
              data-testid="profile-backup-center-btn"
              onClick={() => {
                if (onOpenBackupModal) onOpenBackupModal();
                else onExportBackup?.();
              }}
              className="flex min-h-[44px] w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-xs font-medium text-ink transition-colors hover:bg-app"
            >
              <span className="inline-flex items-center gap-2.5">
                <Database className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.5} />
                <span>Central de Backup</span>
              </span>
              <span className="text-[11px] text-subtle">.ccodex / .json</span>
            </button>

            {pwaCheckState === 'update_available' && onApplyPwaUpdate ? (
              <button
                type="button"
                onClick={onApplyPwaUpdate}
                data-testid="profile-pwa-update-now-btn"
                className="flex min-h-[44px] w-full items-center justify-between gap-3 bg-accent px-3.5 py-2.5 text-left text-xs font-semibold text-accent-ink transition-opacity hover:opacity-90"
              >
                <span className="inline-flex items-center gap-2.5">
                  <RefreshCw className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                  <span>Atualizar agora</span>
                </span>
                <span className="text-[11px] tabular-nums">
                  {pwaRemoteVersion
                    ? `v${pwaRemoteVersion.replace(/^v/i, '')}`
                    : APP_BUILD_LABEL}
                </span>
              </button>
            ) : (
              <button
                type="button"
                disabled={pwaCheckState === 'checking'}
                onClick={() => onCheckPwaUpdate?.()}
                data-testid="profile-check-update-btn"
                className="flex min-h-[44px] w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-xs font-medium text-ink transition-colors hover:bg-app disabled:opacity-60"
              >
                <span className="inline-flex items-center gap-2.5">
                  <RefreshCw
                    className={`h-4 w-4 shrink-0 text-muted ${
                      pwaCheckState === 'checking' ? 'animate-spin' : ''
                    }`}
                    strokeWidth={1.5}
                  />
                  <span>
                    {pwaCheckState === 'checking'
                      ? 'Verificando...'
                      : pwaCheckState === 'up_to_date'
                        ? 'App atualizado'
                        : 'Verificar atualização'}
                  </span>
                </span>
                <span className="text-[11px] tabular-nums text-subtle">
                  {APP_BUILD_LABEL}
                </span>
              </button>
            )}

            <button
              type="button"
              data-testid="profile-diagnostics-btn"
              onClick={() => {
                setSettingsInitialTab('diagnostics');
                setSettingsOpen(true);
              }}
              className="flex min-h-[44px] w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-xs font-medium text-ink transition-colors hover:bg-app"
            >
              <span className="inline-flex items-center gap-2.5">
                <Activity className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.5} />
                <span>Diagnóstico</span>
              </span>
              <span className="text-[11px] text-subtle">Local</span>
            </button>

            <button
              type="button"
              data-testid="profile-release-notes-btn"
              onClick={() => setReleaseModalOpen(true)}
              className="flex min-h-[44px] w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-xs font-medium text-ink transition-colors hover:bg-app"
            >
              <span className="inline-flex items-center gap-2.5">
                <GitBranch className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.5} />
                <span>Novidades da versão</span>
              </span>
              <span className="text-[11px] tabular-nums text-subtle">
                {APP_BUILD_LABEL}
              </span>
            </button>
          </div>
        )}
      </section>

      <Suspense fallback={null}>
        {settingsOpen && (
          <ProfileSettingsDrawer
            isOpen={settingsOpen}
            onClose={() => {
              setSettingsOpen(false);
              setSettingsInitialTab(null);
            }}
            returnFocusRef={settingsBtnRef}
            items={items}
            initialTab={settingsInitialTab}
            profile={profile}
            cloudState={cloudState}
            onOpenReleaseNotes={() => setReleaseModalOpen(true)}
            soundOn={soundOn}
            onToggleSound={() => {
              const next = !soundOn;
              setSoundEnabled(next);
              setSoundOn(next);
              if (next) playTactileSound('tap');
            }}
            onOpenCloudModal={onOpenCloudModal}
            onUpdateProfile={onUpdateProfile}
            onOpenThemeStudio={() => {
              if (onOpenThemeStudio) {
                onOpenThemeStudio();
              } else {
                setThemeModalOpen(true);
              }
            }}
            themeProps={themeProps}
            onReopenOnboarding={onReopenOnboarding}
            onOpenGeminiSettings={onOpenGeminiSettings}
            onExportBackup={onExportBackup}
            onExportCsv={onExportCsv}
            onExportMarkdown={onExportBibtex}
            onImportBackupClick={() => fileInputRef.current?.click()}
            onOpenBackupModal={onOpenBackupModal}
            onOpenImportCatalog={onOpenImportCatalog}
            onOpenShortcuts={onOpenShortcuts}
            onOpenAboutCredits={onOpenAboutCredits}
            aiPanelSlot={
              <Suspense fallback={null}>
                <AiProvidersPanel
                  keys={resolvedAiConfig.keys}
                  preferences={resolvedAiConfig.preferences}
                  onSaveKey={(providerId, val) => {
                    const saved = resolvedAiConfig.saveProviderKey(providerId, val);
                    if (providerId === 'gemini') onSaveGeminiKey?.(saved);
                    return saved;
                  }}
                  onClearKey={(providerId) => {
                    resolvedAiConfig.clearProviderKey(providerId);
                    if (providerId === 'gemini') onSaveGeminiKey?.('');
                  }}
                  onUpdatePreferences={(next) => resolvedAiConfig.updatePreferences(next)}
                />
              </Suspense>
            }
          />
        )}

        {!onOpenThemeStudio && themeModalOpen && (
          <ThemeModal
            isOpen={themeModalOpen}
            onClose={() => setThemeModalOpen(false)}
            {...themeProps}
          />
        )}
      </Suspense>

      <ProfileEditModal
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        profile={profile}
        onSave={onUpdateProfile}
      />

      <Suspense fallback={null}>
        {titlesModalOpen && (
          <TitlesBadgesModal
            isOpen={titlesModalOpen}
            onClose={() => setTitlesModalOpen(false)}
            evaluation={titleEvaluation}
            onSelectAutoMode={() => {
              onUpdateProfile?.({ activeTitleBadge: 'auto' });
              setTitlesModalOpen(false);
            }}
            onPinTitleBadge={handlePinTitleBadge}
          />
        )}

        {selectedPost && (
          <PostDetailModal
            post={selectedPost}
            profile={profile}
            linkedItem={selectedPostLinkedItem}
            onClose={() => setSelectedPostId(null)}
            onSelectItem={onSelectItem}
            onDeletePost={onDeletePost}
            onAddComment={onAddPostComment}
            onDeleteComment={onDeletePostComment}
          />
        )}
      </Suspense>

      <footer className="flex flex-wrap items-center justify-center gap-3 pt-1 text-center">
        <button
          type="button"
          onClick={() => setReleaseModalOpen(true)}
          className="min-h-[44px] px-2 text-[11px] tabular-nums text-subtle underline-offset-2 hover:text-ink hover:underline"
        >
          OmniPrism {CODICE_RELEASE.label}
        </button>
        {onOpenAboutCredits && (
          <button
            type="button"
            onClick={onOpenAboutCredits}
            className="min-h-[44px] px-2 text-[11px] text-subtle underline-offset-2 hover:text-ink hover:underline"
          >
            Sobre / Créditos &amp; Fontes
          </button>
        )}
      </footer>

      <Suspense fallback={null}>
        {releaseModalOpen && (
          <ReleaseHistoryModal
            isOpen={releaseModalOpen}
            onClose={() => setReleaseModalOpen(false)}
          />
        )}
      </Suspense>
    </div>
  );
}
