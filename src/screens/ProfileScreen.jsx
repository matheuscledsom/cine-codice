import {
  Award,
  Camera,
  Film,
  Layers,
  Link2,
  PenLine,
  Plus,
  QrCode,
  Settings,
  Share2,
  Star,
  X,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AiProvidersPanel } from '../components/AiProvidersPanel';
import { BackupReminderBanner } from '../components/BackupReminderBanner';
import { BadgesGallery } from '../components/BadgesGallery';
import { CoverArt } from '../components/CoverArt';
import { PostDetailModal } from '../components/PostDetailModal';
import { ProfileEditModal } from '../components/ProfileEditModal';
import { ProfileSettingsDrawer } from '../components/ProfileSettingsDrawer';
import { ReaderPassportWidget } from '../components/ReaderPassportWidget';
import { ReleaseHistoryModal } from '../components/ReleaseHistoryModal';
import { ThemeModal } from '../components/ThemeModal';
import { TitlesBadgesModal } from '../components/TitlesBadgesModal';
import { ProfileWall } from '../components/social/ProfileWall';
import { domainConfig } from '../config/domainConfig';
import { CODICE_RELEASE } from '../config/versioning';
import { useToast } from '../context/ToastContext';
import { useAiConfig } from '../hooks/useAiConfig';
import {
  buildInviteShareUrl,
  getFollowSummaryLists,
} from '../services/codiceBackend';
import {
  evaluateReaderTitles,
  pinTitleBadge,
} from '../services/readerTitlesEngine';
import { getWatchedEpisodesCount, getWatchedMinutes } from '../utils/backlogHelpers';
import {
  isSoundEnabled,
  playTactileSound,
  setSoundEnabled,
} from '../utils/soundEffects';

const PROFILE_TAB_SESSION_KEY = 'codice_profile_active_tab_v1';
const PAGE_SIZE = 20;

const PROFILE_TABS_IDS = ['journal', 'wall', 'shelf', 'badges'];

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
  viewerId = null,
  storedReaderBooksCount = 0,
  wallPostsCount = 0,
  chatMessagesCount = 0,
  themeProps,
  geminiKey = '',
  hasGeminiKey = false,
  aiConfig = null,
  backendSession = null,
  backupReminder = null,
  onSaveBackupNow,
  onDismissBackupReminder,
  onOpenShareProfileCard,
  onOpenCommunity,
  onOpenAuthModal,
  onOpenGeminiSettings,
  onOpenThemeStudio,
  onSaveGeminiKey,
  onReopenOnboarding,
  onUpdateProfile,
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
  onWallMutated,
  onSelectPeerProfile,
}) {
  const { showToast } = useToast();
  const { ui, cardFields } = domainConfig;
  const { profile: profileCfg } = ui;

  const [activeTab, setActiveTab] = useState(loadSessionActiveTab);
  const [journalLimit, setJournalLimit] = useState(PAGE_SIZE);
  const [shelfLimit, setShelfLimit] = useState(PAGE_SIZE);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [themeModalOpen, setThemeModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [titlesModalOpen, setTitlesModalOpen] = useState(false);
  const [releaseModalOpen, setReleaseModalOpen] = useState(false);
  const [connectionsModal, setConnectionsModal] = useState(null);
  const [followSummary, setFollowSummary] = useState({
    followers: [],
    following: [],
  });
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
  const connectionsReturnRef = useRef(null);
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

  const refreshFollowLists = useCallback(() => {
    const targetId = profile?.id || viewerId;
    if (!targetId) return;
    getFollowSummaryLists(targetId, { viewerId: viewerId || targetId })
      .then((res) => setFollowSummary(res))
      .catch(() => {});
  }, [profile?.id, viewerId]);

  useEffect(() => {
    refreshFollowLists();
  }, [refreshFollowLists]);

  useEffect(() => {
    if (!feedback) return undefined;
    const timer = setTimeout(() => setFeedback(null), 3000);
    return () => clearTimeout(timer);
  }, [feedback]);

  useEffect(() => {
    if (!connectionsModal) return undefined;
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setConnectionsModal(null);
        connectionsReturnRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [connectionsModal]);

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
        wallPostsCount,
        chatMessagesCount,
        storedReaderBooksCount,
      }),
    [
      items,
      profile,
      readingSessions,
      streakCount,
      posts,
      wallPostsCount,
      chatMessagesCount,
      storedReaderBooksCount,
    ]
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

  const handleShareInvite = async () => {
    const shareUrl = buildInviteShareUrl(profile?.handle || '@espectador');
    const title = `${profile?.displayName || profile?.handle || 'Espectador'} no Cine Códice`;
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title,
          text: `Acompanhe minha cinemateca no Cine Códice (${profile?.handle || ''})`,
          url: shareUrl,
        });
        return;
      } catch {
        // Fallback para copiar caso compartilhamento seja cancelado
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast({
        message: 'Link de convite copiado para a área de transferência.',
        type: 'success',
      });
    } catch {
      setFeedback({ type: 'success', text: `Convite: ${shareUrl}` });
    }
  };

  const tabs = useMemo(
    () => [
      { id: 'journal', label: 'Publicações & Diário' },
      { id: 'wall', label: `Mural (${wallPostsCount})` },
      { id: 'shelf', label: 'Estante Pública' },
      { id: 'badges', label: calmMode ? 'Passaporte' : 'Insígnias' },
    ],
    [wallPostsCount, calmMode]
  );

  const handleTabKeyDown = (e, idx) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    const nextIdx = (idx + dir + tabs.length) % tabs.length;
    setActiveTab(tabs[nextIdx].id);
    tabRefs.current[nextIdx]?.focus();
  };

  const visibleJournalPosts = posts.slice(0, journalLimit);
  const remainingJournal = Math.max(0, posts.length - visibleJournalPosts.length);

  const visibleShelfWorks = backlogItems.slice(0, shelfLimit);
  const remainingShelf = Math.max(0, backlogItems.length - visibleShelfWorks.length);

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

      {/* Cabeçalho Editorial (Estilo Letterboxd / Goodreads) */}
      <header className="-mx-4 sm:-mx-6">
        <div
          className="relative aspect-[3/1] w-full overflow-hidden border-y border-line"
          style={{ backgroundColor: 'var(--bg-elevated, var(--bg-card))' }}
        >
          {profile.coverUrl && (
            <img
              src={profile.coverUrl}
              alt="Capa do perfil"
              className="h-full w-full object-cover"
            />
          )}
        </div>

        <div className="px-4 sm:px-6 space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div
              className="-mt-10 relative z-10 flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 bg-card"
              style={{ borderColor: 'var(--bg-app)' }}
            >
              {profile.avatarUrl ? (
                <img
                  src={profile.avatarUrl}
                  alt={profile.displayName || profile.handle}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-lg font-bold tracking-tight text-ink">
                  {profile.avatarInitials || 'AK'}
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={() => onOpenJournalComposer?.(null)}
              aria-label={profileCfg.newPostLabel}
              className="mt-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-[4px] border border-accent bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink hover:opacity-90"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
              <span>{profileCfg.newPostLabel}</span>
            </button>
          </div>

          {/* Nome, @handle, bio e 1 insígnia ativa */}
          <div className="min-w-0 space-y-1">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <h1 className="min-w-0 truncate text-lg font-semibold tracking-tight text-ink">
                {profile.displayName || profile.handle}
              </h1>
              <span className="min-w-0 truncate text-xs text-subtle tabular-nums">
                {profile.handle}
              </span>
            </div>

            {gamificationEnabled && titleEvaluation.resolvedActiveBadge?.name && (
              <div className="pt-0.5">
                <span className="inline-flex max-w-full items-center gap-1 rounded-[4px] border border-line bg-card px-2 py-0.5 text-[11px] font-medium text-accent">
                  <Award className="h-3 w-3 shrink-0" strokeWidth={1.5} />
                  <span className="truncate">
                    {titleEvaluation.resolvedActiveBadge.name}
                  </span>
                </span>
              </div>
            )}

            {profile.bio && (
              <p className="line-clamp-3 text-xs leading-relaxed text-muted">
                {profile.bio}
              </p>
            )}

            {profile.linkLabel && (
              <a
                href={profile.linkUrl || '#'}
                target="_blank"
                rel="noreferrer"
                className="inline-flex max-w-full items-center gap-1 text-[11px] font-medium text-accent hover:underline"
              >
                <Link2 className="h-3 w-3 shrink-0" strokeWidth={1.5} />
                <span className="truncate">{profile.linkLabel}</span>
              </a>
            )}
          </div>

          {/* Métricas clicáveis como <button> reais */}
          <div className="flex flex-wrap items-center gap-1.5 border-y border-line py-2 text-xs tabular-nums">
            <button
              type="button"
              onClick={() => setActiveTab('shelf')}
              aria-label={`Ver ${backlogItems.length} obras catalogadas`}
              className="min-h-[44px] rounded-[4px] px-2 py-1 text-left font-medium text-ink hover:text-accent"
            >
              <strong>{backlogItems.length}</strong>{' '}
              <span style={{ color: 'var(--text-secondary)' }}>Obras</span>
            </button>
            <span aria-hidden="true" className="text-subtle">
              ·
            </span>
            <button
              type="button"
              onClick={(e) => {
                connectionsReturnRef.current = e.currentTarget;
                setConnectionsModal({ tab: 'followers' });
              }}
              aria-label={`Ver ${followSummary.followers.length} seguidores`}
              className="min-h-[44px] rounded-[4px] px-2 py-1 text-left font-medium text-ink hover:text-accent"
            >
              <strong>{followSummary.followers.length}</strong>{' '}
              <span style={{ color: 'var(--text-secondary)' }}>Seguidores</span>
            </button>
            <span aria-hidden="true" className="text-subtle">
              ·
            </span>
            <button
              type="button"
              onClick={(e) => {
                connectionsReturnRef.current = e.currentTarget;
                setConnectionsModal({ tab: 'following' });
              }}
              aria-label={`Ver ${followSummary.following.length} perfis seguindo`}
              className="min-h-[44px] rounded-[4px] px-2 py-1 text-left font-medium text-ink hover:text-accent"
            >
              <strong>{followSummary.following.length}</strong>{' '}
              <span style={{ color: 'var(--text-secondary)' }}>Seguindo</span>
            </button>
          </div>

          {/* Barra de ações compacta com 3 botões */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setEditModalOpen(true)}
              className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-[4px] border border-line bg-card px-3 py-2 text-xs font-medium text-ink hover:border-accent hover:text-accent"
            >
              <PenLine className="h-3.5 w-3.5" strokeWidth={1.5} />
              <span className="truncate">{profileCfg.editProfileLabel}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (onOpenShareProfileCard) {
                  onOpenShareProfileCard();
                } else {
                  handleShareInvite();
                }
              }}
              className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-[4px] border border-line bg-card px-3 py-2 text-xs font-medium text-ink hover:border-accent hover:text-accent"
            >
              <QrCode className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
              <span className="truncate">Compartilhar Meu Perfil</span>
            </button>

            <button
              ref={settingsBtnRef}
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label="Configurações"
              aria-expanded={settingsOpen}
              title="Configurações"
              className={`flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-[4px] border transition-colors ${
                hasAnyAiConfigured
                  ? 'border-accent/50 bg-card text-accent'
                  : 'border-line bg-card hover:border-accent hover:text-ink'
              }`}
              style={!hasAnyAiConfigured ? { color: 'var(--text-secondary)' } : undefined}
            >
              <Settings className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>

          {onOpenCommunity && (
            <button
              type="button"
              onClick={onOpenCommunity}
              className="flex min-h-[40px] w-full items-center justify-between gap-2 rounded-[4px] border border-line bg-app px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:border-accent"
            >
              <span>Rede &amp; Amigos (@handle#XXXX)</span>
              <span className="text-[11px] font-medium text-accent">Abrir</span>
            </button>
          )}
        </div>
      </header>

      {/* Abas acessíveis (Publicações & Diário, Mural, Estante Pública, Insígnias) */}
      <section className="-mx-4 sm:-mx-6 pt-1">
        <div
          role="tablist"
          aria-label="Seções do perfil"
          className="grid border-y border-line"
          style={{
            gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))`,
          }}
        >
          {tabs.map((tab, idx) => {
            const isActive = activeTab === tab.id;
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
                className={`relative flex min-h-[44px] items-center justify-center px-1.5 py-2.5 text-[11px] font-medium transition-colors ${
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

        {/* Monte apenas o conteúdo da aba ativa */}
        {activeTab === 'journal' && (
          <div className="px-4 sm:px-6 pt-4">
            {posts.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 rounded-[4px] border border-line bg-card px-4 py-8 text-center">
                <p className="text-xs text-muted">
                  Nenhuma publicação ou nota no diário ainda.
                </p>
                <button
                  type="button"
                  onClick={() => onOpenJournalComposer?.(null)}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[4px] bg-accent px-4 py-2 text-xs font-semibold text-accent-ink"
                >
                  <Camera className="h-3.5 w-3.5" strokeWidth={1.5} />
                  <span>{profileCfg.emptyJournalCta}</span>
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-1">
                  {visibleJournalPosts.map((post) => {
                    const firstMedia = post.media?.[0];
                    const hasMultiple = (post.media?.length || 0) > 1;
                    const linked = post.itemId
                      ? items.find((i) => i.id === post.itemId)
                      : null;
                    const fallbackItem = linked || post.itemSnapshot;

                    return (
                      <button
                        key={post.id}
                        type="button"
                        onClick={() => setSelectedPostId(post.id)}
                        className="group relative aspect-square overflow-hidden rounded-[2px] border border-line bg-card text-left"
                      >
                        {firstMedia?.type === 'image' || firstMedia?.type === 'gif' ? (
                          <img
                            src={firstMedia.url}
                            alt={post.title}
                            className="h-full w-full object-cover"
                          />
                        ) : firstMedia?.type === 'video' ? (
                          <div className="flex h-full w-full flex-col items-center justify-center bg-elevated p-2 text-center">
                            <Film className="h-5 w-5 text-accent" strokeWidth={1.5} />
                            <span className="mt-1 line-clamp-2 text-[10px] font-medium text-ink">
                              {post.title}
                            </span>
                          </div>
                        ) : fallbackItem ? (
                          <CoverArt
                            item={fallbackItem}
                            compact
                            className="h-full w-full rounded-none border-0"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-elevated p-2 text-center">
                            <span className="line-clamp-3 text-[10px] font-medium text-ink">
                              {post.title}
                            </span>
                          </div>
                        )}

                        {post.progressMarker && (
                          <span className="absolute left-1 top-1 max-w-[74%] truncate rounded-[2px] bg-black/75 px-1.5 py-0.5 text-[9px] font-medium text-accent">
                            {post.progressMarker}
                          </span>
                        )}

                        <div className="absolute inset-x-0 bottom-0 bg-black/75 px-1.5 py-1">
                          <p className="truncate text-[10px] font-medium text-white">
                            {post.title}
                          </p>
                        </div>

                        {hasMultiple && (
                          <span className="absolute right-1 top-1 rounded-[2px] bg-black/70 p-1 text-white">
                            <Layers className="h-3 w-3" strokeWidth={1.5} />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                {remainingJournal > 0 && (
                  <button
                    type="button"
                    onClick={() => setJournalLimit((prev) => prev + PAGE_SIZE)}
                    className="min-h-[44px] w-full rounded-[4px] border border-line bg-card py-2 text-xs font-medium text-ink hover:border-accent hover:text-accent tabular-nums"
                  >
                    Carregar mais ({remainingJournal} restantes)
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'wall' && (
          <div className="px-4 sm:px-6 pt-4">
            <ProfileWall
              profileId={profile?.id}
              viewerId={viewerId || profile?.id}
              isOwner
              canPostWall={profile?.allowWallPosts !== false}
              allowWallPosts={profile?.allowWallPosts !== false}
              onSelectAuthor={(authorId) => onSelectPeerProfile?.(authorId)}
              onWallMutated={onWallMutated}
            />
          </div>
        )}

        {activeTab === 'shelf' && (
          <div className="px-4 sm:px-6 pt-4">
            {backlogItems.length === 0 ? (
              <p className="rounded-[4px] border border-line bg-card py-8 text-center text-xs text-muted">
                Nenhuma obra catalogada na estante ainda.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="divide-y divide-line rounded-[4px] border border-line bg-card">
                  {visibleShelfWorks.map((work) => (
                    <button
                      key={work.id}
                      type="button"
                      onClick={() => onSelectItem?.(work)}
                      className="flex min-h-[56px] w-full items-center justify-between gap-3 p-2.5 text-left hover:bg-app"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <CoverArt
                          item={work}
                          compact
                          className="h-12 w-8 shrink-0 rounded-[2px]"
                        />
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-ink">
                            {work.title}
                          </p>
                          <p className="truncate text-[11px] text-muted">
                            {work.director || work.studio || work[cardFields.creator] || 'Direção não informada'}
                          </p>
                        </div>
                      </div>
                      {typeof work[cardFields.rating] === 'number' && (
                        <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-accent tabular-nums">
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
                    className="min-h-[44px] w-full rounded-[4px] border border-line bg-card py-2 text-xs font-medium text-ink hover:border-accent hover:text-accent tabular-nums"
                  >
                    Carregar mais ({remainingShelf} restantes)
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'badges' && (
          <div className="px-4 sm:px-6 pt-4 space-y-4">
            <ReaderPassportWidget
              items={items}
              posts={posts}
              streakCount={streakCount}
            />

            {!gamificationEnabled ? (
              <p className="rounded-[4px] border border-line bg-card py-6 text-center text-xs text-muted">
                {calmMode
                  ? 'Modo Calmo ativo: XP e contadores numéricos permanecem ocultos.'
                  : 'Gamificação desativada nas configurações do perfil.'}
              </p>
            ) : (
              <>
                <div className="rounded-[4px] border border-line bg-card p-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
                      <span className="inline-flex items-center gap-1 rounded-[2px] bg-accent px-2 py-0.5 text-[11px] font-bold text-accent-ink tabular-nums">
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
                    aria-label="Progresso de XP do leitor"
                    aria-valuemin={0}
                    aria-valuemax={statsData.xpPerLevel}
                    aria-valuenow={statsData.currentLevelXp}
                    className="h-[2px] w-full overflow-hidden rounded-[2px] bg-line"
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

      {/* Modal de Seguidores / Seguindo */}
      {connectionsModal && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
          onClick={() => setConnectionsModal(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={
              connectionsModal.tab === 'followers' ? 'Seguidores' : 'Seguindo'
            }
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[85dvh] w-full max-w-md flex-col rounded-t-[6px] border border-line bg-card text-ink sm:rounded-[6px] pb-[env(safe-area-inset-bottom)]"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div className="flex gap-1" role="tablist" aria-label="Conexões">
                <button
                  type="button"
                  role="tab"
                  aria-selected={connectionsModal.tab === 'followers'}
                  onClick={() => setConnectionsModal({ tab: 'followers' })}
                  className={`min-h-[40px] rounded-[4px] px-3 text-xs font-medium ${
                    connectionsModal.tab === 'followers'
                      ? 'bg-accent text-accent-ink'
                      : 'text-muted hover:text-ink'
                  }`}
                >
                  Seguidores ({followSummary.followers.length})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={connectionsModal.tab === 'following'}
                  onClick={() => setConnectionsModal({ tab: 'following' })}
                  className={`min-h-[40px] rounded-[4px] px-3 text-xs font-medium ${
                    connectionsModal.tab === 'following'
                      ? 'bg-accent text-accent-ink'
                      : 'text-muted hover:text-ink'
                  }`}
                >
                  Seguindo ({followSummary.following.length})
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  setConnectionsModal(null);
                  connectionsReturnRef.current?.focus();
                }}
                aria-label="Fechar conexões"
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[4px] border border-line text-muted hover:text-ink"
              >
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 no-scrollbar">
              {(() => {
                const list =
                  connectionsModal.tab === 'followers'
                    ? followSummary.followers
                    : followSummary.following;
                if (list.length === 0) {
                  return (
                    <p className="py-8 text-center text-xs text-muted">
                      {connectionsModal.tab === 'followers'
                        ? 'Nenhum seguidor ainda.'
                        : 'Você ainda não segue outros perfis.'}
                    </p>
                  );
                }
                return (
                  <div className="divide-y divide-line rounded-[4px] border border-line bg-app">
                    {list.map((peer) => (
                      <button
                        key={peer.id}
                        type="button"
                        onClick={() => {
                          setConnectionsModal(null);
                          onSelectPeerProfile?.(peer.id);
                        }}
                        className="flex min-h-[52px] w-full items-center gap-3 p-2.5 text-left hover:bg-card"
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-card text-xs font-semibold text-accent">
                          {peer.avatarUrl ? (
                            <img
                              src={peer.avatarUrl}
                              alt={peer.displayName || peer.handle}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            peer.avatarInitials || 'LC'
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-ink">
                            {peer.displayName || peer.handle}
                          </p>
                          <p className="truncate text-[11px] text-subtle">
                            {peer.handle}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      <ProfileSettingsDrawer
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        returnFocusRef={settingsBtnRef}
        profile={profile}
        backendSession={backendSession}
        soundOn={soundOn}
        onToggleSound={() => {
          const next = !soundOn;
          setSoundEnabled(next);
          setSoundOn(next);
          if (next) playTactileSound('tap');
        }}
        onOpenAuthModal={onOpenAuthModal}
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
