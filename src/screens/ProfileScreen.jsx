import {
  Award,
  Camera,
  Clapperboard,
  Film,
  Layers,
  PenLine,
  Plus,
  Quote,
  Settings,
  Sparkles,
  Star,
  X,
  Zap,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AiProvidersPanel } from '../components/AiProvidersPanel';
import { BackupReminderBanner } from '../components/BackupReminderBanner';
import { BadgesGallery } from '../components/BadgesGallery';
import { CoverArt } from '../components/CoverArt';
import { PostDetailModal } from '../components/PostDetailModal';
import {
  AVATAR_EMBLEM_COMPONENTS,
  ProfileEditModal,
} from '../components/ProfileEditModal';
import { ProfileSettingsDrawer } from '../components/ProfileSettingsDrawer';
import { ReaderPassportWidget } from '../components/ReaderPassportWidget';
import { ReleaseHistoryModal } from '../components/ReleaseHistoryModal';
import { ThemeModal } from '../components/ThemeModal';
import { TitlesBadgesModal } from '../components/TitlesBadgesModal';
import { domainConfig } from '../config/domainConfig';
import { CODICE_RELEASE } from '../config/versioning';
import { useToast } from '../context/ToastContext';
import { useAiConfig } from '../hooks/useAiConfig';
import {
  buildProfilePersonalFeed,
  computeProfileMetrics,
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

export function ProfileScreen({
  items = [],
  profile,
  posts = [],
  readingSessions = [],
  streakCount = 0,
  storedReaderBooksCount = 0,
  themeProps,
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
}) {
  const { showToast } = useToast();
  const { ui, cardFields } = domainConfig;
  const { profile: profileCfg } = ui;

  const [activeTab, setActiveTab] = useState(loadSessionActiveTab);
  const [bannerImgError, setBannerImgError] = useState(false);
  const [shelfLimit, setShelfLimit] = useState(PAGE_SIZE);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [themeModalOpen, setThemeModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [titlesModalOpen, setTitlesModalOpen] = useState(false);
  const [releaseModalOpen, setReleaseModalOpen] = useState(false);
  const [pickerSlot, setPickerSlot] = useState(null);
  const [selectedPostId, setSelectedPostId] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [soundOn, setSoundOn] = useState(isSoundEnabled);

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

  const top4Slots = useMemo(() => resolveTop4Favorites(items), [items]);
  const personalFeed = useMemo(
    () => buildProfilePersonalFeed(items, posts, { limit: 18 }),
    [items, posts]
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
    // Libera qualquer outra obra que estivesse neste slot
    const prevOccupant = backlogItems.find(
      (w) => w.id !== targetWork.id && Number(w.favoriteRank) === slotNum
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
      message: `"${targetWork.title}" fixado no Top #${slotNum} Favoritos da Vida.`,
      type: 'success',
    });
    setPickerSlot(null);
  };

  const handleClearTop4Slot = (slotNum) => {
    if (!onUpdateItem) return;
    const currentOccupant = backlogItems.find(
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
  };

  const heroBanner = useMemo(() => resolveProfileHeroBackdrop(items), [items]);
  const profileMetrics = useMemo(() => computeProfileMetrics(items), [items]);

  useEffect(() => {
    setBannerImgError(false);
  }, [heroBanner?.backdropUrl]);

  const tabs = useMemo(
    () => [
      { id: 'journal', label: 'Últimas Cenas & Avaliações' },
      { id: 'shelf', label: 'Meu Acervo' },
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

  const AvatarEmblemIcon =
    AVATAR_EMBLEM_COMPONENTS[profile?.avatarIcon] ||
    AVATAR_EMBLEM_COMPONENTS.Film;

  return (
    <div className="space-y-4 pb-24">
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
          className="rounded-[4px] border border-line bg-card px-3 py-2 text-xs text-ink"
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

      {/* Cabeçalho Editorial */}
      <header className="-mx-4 sm:-mx-6">
        <div
          className="relative aspect-[3/1] w-full overflow-hidden border-y border-line"
          style={{
            background:
              heroBanner?.backdropUrl && !bannerImgError
                ? 'var(--bg-elevated, var(--bg-card))'
                : 'linear-gradient(135deg, color-mix(in srgb, var(--accent-color) 28%, var(--bg-app)) 0%, var(--bg-elevated, var(--bg-card)) 55%, var(--bg-app) 100%)',
          }}
        >
          {heroBanner?.backdropUrl && !bannerImgError ? (
            <>
              <img
                src={heroBanner.backdropUrl}
                alt={`Cena de ${heroBanner.title}`}
                onError={() => setBannerImgError(true)}
                className="h-full w-full object-cover"
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    'linear-gradient(180deg, rgba(10,12,16,0.72) 0%, rgba(10,12,16,0.84) 100%)',
                }}
              />
              <div className="pointer-events-none absolute right-3 top-2.5 max-w-[70%] rounded-[4px] bg-black/75 px-2.5 py-1 text-right text-[11px] font-medium text-white backdrop-blur-sm">
                <span className="block truncate">Em cartaz: {heroBanner.title}</span>
              </div>
            </>
          ) : (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 opacity-65"
              style={{
                background:
                  'radial-gradient(circle at 80% 25%, color-mix(in srgb, var(--accent-color) 32%, transparent) 0%, transparent 62%)',
              }}
            />
          )}
        </div>

        <div className="px-4 sm:px-6 space-y-4">
          <div className="flex items-end justify-between gap-3">
            {/* Avatar Customizável: Foto 256x256 OU 1 dos 8 Emblemas Cinematográficos */}
            <button
              type="button"
              onClick={() => setEditModalOpen(true)}
              aria-label="Personalizar avatar e perfil"
              className="-mt-10 relative z-10 flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 bg-card text-accent transition-transform hover:scale-105"
              style={{ borderColor: 'var(--bg-app)' }}
            >
              {profile?.avatarUrl ? (
                <img
                  src={profile.avatarUrl}
                  alt={profile.displayName || 'Avatar do espectador'}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-accent/15 text-accent">
                  <AvatarEmblemIcon className="h-8 w-8" strokeWidth={1.5} />
                </div>
              )}
            </button>

            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEditModalOpen(true)}
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-line bg-card px-3.5 py-2 text-xs font-medium text-ink hover:border-accent hover:text-accent"
              >
                <PenLine className="h-3.5 w-3.5" strokeWidth={1.5} />
                <span>{profileCfg.editProfileLabel}</span>
              </button>

              <button
                ref={settingsBtnRef}
                type="button"
                onClick={() => setSettingsOpen(true)}
                aria-label="Configurações"
                aria-expanded={settingsOpen}
                title="Configurações"
                className={`flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl border transition-colors ${
                  hasAnyAiConfigured
                    ? 'border-accent/50 bg-card text-accent'
                    : 'border-line bg-card hover:border-accent hover:text-ink'
                }`}
                style={!hasAnyAiConfigured ? { color: 'var(--text-secondary)' } : undefined}
              >
                <Settings className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>
          </div>

          {/* Nome, bio e insígnia ativa */}
          <div className="min-w-0 space-y-1">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <h1
                className="min-w-0 truncate text-xl font-bold text-ink"
                style={{ letterSpacing: '-0.02em', lineHeight: 1.15 }}
              >
                {profile?.displayName || 'Espectador'}
              </h1>
            </div>

            {gamificationEnabled && titleEvaluation.resolvedActiveBadge?.name && (
              <div className="pt-0.5">
                <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-0.5 text-[11px] font-medium text-accent">
                  <Award className="h-3 w-3 shrink-0" strokeWidth={1.5} />
                  <span className="truncate">
                    {titleEvaluation.resolvedActiveBadge.name}
                  </span>
                </span>
              </div>
            )}

            {profile?.bio && (
              <p className="line-clamp-3 text-xs leading-relaxed text-muted max-w-[68ch]">
                {profile.bio}
              </p>
            )}
          </div>

          {/* VITRINE "FAVORITOS DA VIDA" (TOP 4 — Grade 2:3 de 4 slots) */}
          <section
            aria-label="Vitrine Favoritos da Vida Top 4"
            className="rounded-2xl border border-line bg-card p-4 space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Award className="h-4 w-4 text-accent" strokeWidth={1.5} />
                <h2 className="text-xs font-bold uppercase tracking-wider text-ink">
                  Favoritos da Vida · Top 4
                </h2>
              </div>
              <span className="text-[11px] tabular-nums text-subtle">
                {top4Slots.filter((s) => Boolean(s.work)).length}/4 fixados
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {top4Slots.map(({ slot, work }) =>
                work ? (
                  <div
                    key={`top4-slot-${slot}`}
                    className="group relative flex flex-col justify-between rounded-xl border border-line bg-app p-1.5 transition-colors hover:border-accent"
                  >
                    <button
                      type="button"
                      onClick={() => onSelectItem?.(work)}
                      className="relative aspect-[2/3] w-full overflow-hidden rounded-lg text-left"
                    >
                      <CoverArt
                        item={work}
                        compact
                        className="h-full w-full object-cover"
                      />
                      <span className="absolute left-1.5 top-1.5 rounded-full border border-accent/60 bg-black/80 px-2 py-0.5 text-[10px] font-bold tabular-nums text-accent">
                        #{slot}
                      </span>
                    </button>

                    <div className="mt-1.5 flex items-center justify-between gap-1 px-0.5">
                      <p className="min-w-0 flex-1 truncate text-[11px] font-semibold text-ink">
                        {work.title}
                      </p>
                      <button
                        type="button"
                        onClick={() => setPickerSlot(slot)}
                        aria-label={`Trocar favorito #${slot}`}
                        className="min-h-[32px] shrink-0 rounded-md px-1.5 text-[10px] font-medium text-accent hover:bg-card"
                      >
                        Trocar
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    key={`top4-slot-${slot}`}
                    type="button"
                    onClick={() => setPickerSlot(slot)}
                    className="flex aspect-[2/3] min-h-[44px] w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-app p-3 text-center transition-colors hover:border-accent hover:text-accent"
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-card text-accent">
                      <Plus className="h-4 w-4" strokeWidth={1.5} />
                    </div>
                    <span className="text-xs font-semibold tabular-nums text-ink">
                      + Escolher favorito
                    </span>
                    <span className="text-[10px] tabular-nums text-subtle">
                      Posição #{slot}
                    </span>
                  </button>
                )
              )}
            </div>
          </section>

          {/* Resumo Acumulado do Acervo */}
          <div className="grid grid-cols-1 gap-2 border-y border-line py-2.5 sm:grid-cols-3 tabular-nums">
            <button
              type="button"
              onClick={() => setActiveTab('shelf')}
              aria-label={`Ver ${profileMetrics.totalWorks} obras no acervo`}
              className="flex min-h-[44px] flex-col justify-center rounded-xl border border-line bg-app px-3 py-2 text-left transition-colors hover:border-accent"
            >
              <span
                className="text-[11px] font-medium uppercase tracking-wider"
                style={{ color: 'var(--text-secondary)' }}
              >
                Obras
              </span>
              <span className="text-sm font-semibold text-ink">
                {profileMetrics.totalWorks}{' '}
                <span
                  className="text-xs font-normal"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  ({profileMetrics.completedWorks}{' '}
                  {profileMetrics.completedWorks === 1 ? 'concluída' : 'concluídas'})
                </span>
              </span>
            </button>

            <div className="flex min-h-[44px] flex-col justify-center rounded-xl border border-line bg-app px-3 py-2">
              <span
                className="text-[11px] font-medium uppercase tracking-wider"
                style={{ color: 'var(--text-secondary)' }}
              >
                Episódios / Horas
              </span>
              <span className="text-sm font-semibold text-ink">
                {profileMetrics.episodesWatched} eps · {profileMetrics.watchedHoursLabel}
              </span>
              {profileMetrics.unknownDurationCount > 0 && (
                <span
                  className="text-[11px]"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {profileMetrics.unknownDurationCount} sem duração excluída(s)
                </span>
              )}
            </div>

            <div className="flex min-h-[44px] flex-col justify-center rounded-xl border border-line bg-app px-3 py-2">
              <span
                className="text-[11px] font-medium uppercase tracking-wider"
                style={{ color: 'var(--text-secondary)' }}
              >
                Média Geral
              </span>
              <span className="text-sm font-semibold text-ink">
                {profileMetrics.averageRatingLabel}
                {profileMetrics.averageRating !== null ? ' / 100' : ''}
              </span>
              <span
                className="text-[11px]"
                style={{ color: 'var(--text-secondary)' }}
              >
                {profileMetrics.ratedWorksCount > 0
                  ? `${profileMetrics.ratedWorksCount} avaliada(s)`
                  : 'Sem notas confirmadas'}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Abas Editoriais: Últimas Cenas & Avaliações | Meu Acervo | Insígnias */}
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
                className={`relative flex min-h-[44px] items-center justify-center px-1.5 py-2.5 text-[11px] font-semibold transition-colors ${
                  isActive ? 'text-ink' : 'hover:text-ink'
                }`}
                style={!isActive ? { color: 'var(--text-secondary)' } : undefined}
              >
                <span className="truncate tabular-nums">{tab.label}</span>
                {isActive && (
                  <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent" />
                )}
              </button>
            );
          })}
        </div>

        {/* ABA 1: FEED PESSOAL DINÂMICO — ÚLTIMAS AVALIAÇÕES, EPISÓDIOS VISTOS & CENAS FAVORITAS */}
        {resolvedActiveTab === 'journal' && (
          <div className="px-4 sm:px-6 pt-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
                  Memória Recente do Espectador
                </h2>
                <p className="text-[11px] text-subtle">
                  Suas cenas favoritas, notas confirmadas e sessões recentes
                </p>
              </div>
              {onOpenJournalComposer && (
                <button
                  type="button"
                  onClick={() => onOpenJournalComposer(null)}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-line bg-card px-3 py-1.5 text-xs font-semibold text-ink hover:border-accent hover:text-accent"
                >
                  <Plus className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                  <span>+ Registrar Sessão</span>
                </button>
              )}
            </div>

            {personalFeed.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-line bg-card px-4 py-8 text-center space-y-2">
                <Clapperboard className="mx-auto h-5 w-5 text-accent" strokeWidth={1.5} />
                <p className="text-xs font-medium text-ink">
                  Suas avaliações, episódios assistidos e cenas favoritas aparecerão aqui automaticamente
                </p>
                <p className="text-[11px] text-subtle">
                  Catalogue obras, avalie episódios ou destaque uma cena favorita na página da obra.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {personalFeed.map((entry) => (
                  <article
                    key={entry.id}
                    className="flex items-start gap-3 rounded-2xl border border-line bg-card p-3.5 transition-colors hover:border-accent/50"
                  >
                    {entry.work && (
                      <button
                        type="button"
                        onClick={() => onSelectItem?.(entry.work)}
                        className="aspect-[2/3] w-14 shrink-0 overflow-hidden rounded-lg border border-line"
                      >
                        <CoverArt
                          item={entry.work}
                          compact
                          className="h-full w-full object-cover"
                        />
                      </button>
                    )}

                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-1.5">
                        <span className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-0.5 text-[10px] font-semibold tabular-nums text-accent">
                          {entry.kind === 'scene' ? (
                            <Quote className="h-3 w-3" strokeWidth={1.5} />
                          ) : entry.kind === 'review' ? (
                            <Star className="h-3 w-3" strokeWidth={1.5} />
                          ) : (
                            <Film className="h-3 w-3" strokeWidth={1.5} />
                          )}
                          <span>{entry.badge}</span>
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          if (entry.post) {
                            setSelectedPostId(entry.post.id);
                          } else if (entry.work) {
                            onSelectItem?.(entry.work);
                          }
                        }}
                        className="block text-left text-sm font-bold text-ink hover:text-accent"
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
                ))}
              </div>
            )}
          </div>
        )}

        {/* ABA 2: MEU ACERVO */}
        {resolvedActiveTab === 'shelf' && (
          <div className="px-4 sm:px-6 pt-4">
            {backlogItems.length === 0 ? (
              <p className="rounded-2xl border border-line bg-card py-8 text-center text-xs text-muted">
                Nenhuma obra catalogada no acervo ainda.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="divide-y divide-line rounded-2xl border border-line bg-card">
                  {visibleShelfWorks.map((work) => (
                    <button
                      key={work.id}
                      type="button"
                      onClick={() => onSelectItem?.(work)}
                      className="flex min-h-[56px] w-full items-center justify-between gap-3 p-3 text-left hover:bg-app"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <CoverArt
                          item={work}
                          compact
                          className="h-12 w-8 shrink-0 rounded-md"
                        />
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-ink">
                            {work.title}
                          </p>
                          <p className="truncate text-[11px] text-muted">
                            {work.director ||
                              work.studio ||
                              work[cardFields.creator] ||
                              'Direção não informada'}
                          </p>
                        </div>
                      </div>
                      {typeof work[cardFields.rating] === 'number' &&
                        work.ratingSource !== 'legacy-default' && (
                          <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-accent tabular-nums">
                            <Star className="h-3 w-3 fill-current" strokeWidth={1.5} />
                            {work[cardFields.rating]}
                          </span>
                        )}
                    </button>
                  ))}
                </div>

                {remainingShelf > 0 && (
                  <button
                    type="button"
                    onClick={() => setShelfLimit((prev) => prev + PAGE_SIZE)}
                    className="min-h-[44px] w-full rounded-xl border border-line bg-card py-2 text-xs font-medium text-ink hover:border-accent hover:text-accent tabular-nums"
                  >
                    Carregar mais ({remainingShelf} restantes)
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* ABA 3: INSÍGNIAS DO ESPECTADOR */}
        {resolvedActiveTab === 'badges' && (
          <div className="px-4 sm:px-6 pt-4 space-y-4">
            <ReaderPassportWidget
              items={items}
              posts={posts}
              streakCount={streakCount}
            />

            {!gamificationEnabled ? (
              <p className="rounded-2xl border border-line bg-card py-6 text-center text-xs text-muted">
                {calmMode
                  ? 'Modo Calmo ativo: XP e contadores numéricos permanecem ocultos.'
                  : 'Gamificação desativada nas configurações do perfil.'}
              </p>
            ) : (
              <>
                <div className="rounded-2xl border border-line bg-card p-3.5 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
                      <span className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-[11px] font-bold text-accent-ink tabular-nums">
                        <Zap className="h-3 w-3" strokeWidth={1.5} />
                        {profileCfg.levelPrefix} {statsData.level}
                      </span>
                      <span className="text-muted font-medium">
                        {titleEvaluation.unlockedCount}/{titleEvaluation.totalCount} insígnias
                      </span>
                    </span>
                    <span className="text-[11px] text-subtle tabular-nums">
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
        )}
      </section>

      {/* Modal Seletor Rápido para a Vitrine Top 4 Favoritos da Vida */}
      {pickerSlot !== null && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 sm:items-center sm:p-4"
          onClick={() => setPickerSlot(null)}
          role="dialog"
          aria-modal="true"
          aria-label={`Escolher obra para Favorito Top #${pickerSlot}`}
        >
          <div
            className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-line bg-card p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 border-b border-line pb-3">
              <div>
                <h3 className="text-sm font-bold text-ink">
                  Escolher Favorito da Vida · Top #{pickerSlot}
                </h3>
                <p className="text-[11px] text-muted">
                  Selecione uma obra do seu acervo para destacar na vitrine
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPickerSlot(null)}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-line bg-app text-muted hover:text-ink"
              >
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>

            {backlogItems.some((w) => Number(w.favoriteRank) === pickerSlot) && (
              <button
                type="button"
                onClick={() => handleClearTop4Slot(pickerSlot)}
                className="flex min-h-[44px] w-full items-center justify-center rounded-xl border border-rose-500/30 bg-rose-500/10 text-xs font-semibold text-rose-400 hover:bg-rose-500/20"
              >
                Limpar posição #{pickerSlot}
              </button>
            )}

            {backlogItems.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted">
                Catalogue obras no seu acervo para escolher seus 4 favoritos da vida.
              </p>
            ) : (
              <div className="divide-y divide-line rounded-xl border border-line bg-app">
                {backlogItems.map((work) => {
                  const isCurrent = Number(work.favoriteRank) === pickerSlot;
                  return (
                    <button
                      key={work.id}
                      type="button"
                      onClick={() => handleAssignTop4Slot(pickerSlot, work)}
                      className={`flex min-h-[52px] w-full items-center justify-between gap-3 p-2.5 text-left transition-colors hover:bg-card ${
                        isCurrent ? 'bg-accent/10' : ''
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <CoverArt
                          item={work}
                          compact
                          className="h-12 w-8 shrink-0 rounded-md"
                        />
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-ink">
                            {work.title}
                          </p>
                          <p className="truncate text-[10px] text-muted">
                            {work.director || work.studio || work.releaseYear || ''}
                          </p>
                        </div>
                      </div>
                      <span className="shrink-0 rounded-lg border border-accent/40 bg-accent/15 px-2.5 py-1 text-[10px] font-semibold tabular-nums text-accent">
                        {isCurrent ? `Atual #${pickerSlot}` : `Fixar #${pickerSlot}`}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      <ProfileSettingsDrawer
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        returnFocusRef={settingsBtnRef}
        profile={profile}
        soundOn={soundOn}
        onToggleSound={() => {
          const next = !soundOn;
          setSoundEnabled(next);
          setSoundOn(next);
          if (next) playTactileSound('tap');
        }}
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
        }
      />

      {!onOpenThemeStudio && (
        <ThemeModal
          isOpen={themeModalOpen}
          onClose={() => setThemeModalOpen(false)}
          {...themeProps}
        />
      )}

      <ProfileEditModal
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        profile={profile}
        onSave={onUpdateProfile}
      />

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

      <footer className="flex flex-wrap items-center justify-center gap-3 pt-2 text-center">
        <button
          type="button"
          onClick={() => setReleaseModalOpen(true)}
          className="min-h-[44px] px-2 text-[11px] tabular-nums underline-offset-2 hover:underline"
          style={{ color: 'var(--text-secondary)' }}
        >
          Cine Códice {CODICE_RELEASE.label}
        </button>
        {onOpenAboutCredits && (
          <button
            type="button"
            onClick={onOpenAboutCredits}
            className="min-h-[44px] px-2 text-[11px] underline-offset-2 hover:underline"
            style={{ color: 'var(--text-secondary)' }}
          >
            Sobre / Créditos &amp; Fontes
          </button>
        )}
      </footer>

      <ReleaseHistoryModal
        isOpen={releaseModalOpen}
        onClose={() => setReleaseModalOpen(false)}
      />
    </div>
  );
}
