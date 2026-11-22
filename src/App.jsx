import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, UserCheck, UserPlus, X } from 'lucide-react';
import { getAllEpisodeEvaluations, importEpisodeEvaluations } from './api/cacheDb';
import { BottomNav } from './components/BottomNav';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SkeletonScreen } from './components/SkeletonScreen';
import { domainConfig } from './config/domainConfig';
import { useToast } from './context/ToastContext';
import { GraphicFilters } from './design/GraphicFilters';
import { useAiConfig } from './hooks/useAiConfig';
import { readRawBacklogStorageState, useBacklog } from './hooks/useBacklog';
import { useReadingStreak } from './hooks/useReadingStreak';
import { useSocialProfile } from './hooks/useSocialProfile';
import { useTheme } from './hooks/useTheme';
import {
  CURRENT_MIGRATION_VERSION,
  MIGRATION_VERSION_KEY,
  executeAtomicWorkspaceMigration,
  migrateProfileData,
  migrateWorkItem,
  needsWorkspaceMigration,
} from './lib/migrations';
import {
  getBackupReminderStatus,
  listAutoSnapshots,
  mergeSnapshots,
  requestPersistentStorage,
  saveAutoSnapshot,
  saveEmergencyMirror,
  shareOrDownloadSignedBackup,
  verifyAutoSnapshotIntegrity,
} from './services/backupEngine';
import {
  bootstrapBackend,
  ensureLocalCommunitySeeded,
  followReader,
  getBackendMode,
  getUnreadMessagesCount,
  listDirectConversations,
  listDirectMessages,
  listWallPosts,
  parseInviteHandleParam,
  resolveInviteProfile,
  syncActiveWorkspaceToBackend,
  updateActiveProfileInBackend,
} from './services/codiceBackend';
import {
  CODICE_DB_STORAGE_KEY,
  buildCodiceDatabase,
  createUuid,
  persistCodiceDatabase,
} from './services/codiceDatabase';
import {
  decodePublicProfileCard,
  listSavedPeerCards,
  removeSavedPeerCard,
  savePeerProfileCard,
} from './services/peerProfileShare';
import { evaluateReaderTitles } from './services/readerTitlesEngine';
import {
  advanceEpisodeProgress,
  advanceMovieSeconds,
  getTodayLocalISO,
  isEpisodicWork,
} from './utils/backlogHelpers';
import { HomeScreen } from './screens/HomeScreen';

const StatsScreen = lazy(() =>
  import('./screens/StatsScreen').then((m) => ({ default: m.StatsScreen }))
);
const AddScreen = lazy(() =>
  import('./screens/AddScreen').then((m) => ({ default: m.AddScreen }))
);
const ListScreen = lazy(() =>
  import('./screens/ListScreen').then((m) => ({ default: m.ListScreen }))
);
const CommunityScreen = lazy(() =>
  import('./components/social/CommunityScreen').then((m) => ({
    default: m.CommunityScreen,
  }))
);
const ProfileScreen = lazy(() =>
  import('./screens/ProfileScreen').then((m) => ({ default: m.ProfileScreen }))
);
const AuthModal = lazy(() =>
  import('./components/auth/AuthModal').then((m) => ({ default: m.AuthModal }))
);
const BackupRestoreModal = lazy(() =>
  import('./components/BackupRestoreModal').then((m) => ({
    default: m.BackupRestoreModal,
  }))
);
const GeminiConfigModal = lazy(() =>
  import('./components/GeminiConfigModal').then((m) => ({
    default: m.GeminiConfigModal,
  }))
);
const ItemDetailSheet = lazy(() =>
  import('./components/ItemDetailSheet').then((m) => ({
    default: m.ItemDetailSheet,
  }))
);
const JournalComposerModal = lazy(() =>
  import('./components/JournalComposerModal').then((m) => ({
    default: m.JournalComposerModal,
  }))
);
const OnboardingFlow = lazy(() =>
  import('./components/OnboardingFlow').then((m) => ({
    default: m.OnboardingFlow,
  }))
);
const ThemeModal = lazy(() =>
  import('./components/ThemeModal').then((m) => ({ default: m.ThemeModal }))
);
const DirectChatDrawer = lazy(() =>
  import('./components/social/DirectChatDrawer').then((m) => ({
    default: m.DirectChatDrawer,
  }))
);
const FriendProfileCardModal = lazy(() =>
  import('./components/social/FriendProfileCardModal').then((m) => ({
    default: m.FriendProfileCardModal,
  }))
);
const ShareProfileCardModal = lazy(() =>
  import('./components/social/ShareProfileCardModal').then((m) => ({
    default: m.ShareProfileCardModal,
  }))
);
const UserProfileModal = lazy(() =>
  import('./components/social/UserProfileModal').then((m) => ({
    default: m.UserProfileModal,
  }))
);
const PerfOverlay = lazy(() =>
  import('./components/PerfOverlay').then((m) => ({ default: m.PerfOverlay }))
);
const CommandPalette = lazy(() =>
  import('./components/CommandPalette').then((m) => ({
    default: m.CommandPalette,
  }))
);
const KeyboardShortcutsModal = lazy(() =>
  import('./components/KeyboardShortcutsModal').then((m) => ({
    default: m.KeyboardShortcutsModal,
  }))
);
const ImportCatalogModal = lazy(() =>
  import('./components/ImportCatalogModal').then((m) => ({
    default: m.ImportCatalogModal,
  }))
);
const WrappedModal = lazy(() =>
  import('./components/WrappedModal').then((m) => ({
    default: m.WrappedModal,
  }))
);
const OfflineBookPickerModal = lazy(() =>
  import('./components/OfflineBookPickerModal').then((m) => ({
    default: m.OfflineBookPickerModal,
  }))
);
const AboutCreditsModal = lazy(() =>
  import('./components/AboutCreditsModal').then((m) => ({
    default: m.AboutCreditsModal,
  }))
);

function readRawWorkspaceSnapshotForMigration() {
  if (typeof localStorage === 'undefined') {
    return { hasExistingUserData: false, storedMigrationVersion: CURRENT_MIGRATION_VERSION, rawWorkspace: null };
  }
  try {
    const storedMigrationVersion =
      Number(localStorage.getItem(MIGRATION_VERSION_KEY) || 0) || 0;
    const rawBacklog = readRawBacklogStorageState();
    let rawProfile = null;
    try {
      const profileStr = localStorage.getItem(domainConfig.profileStorageKey);
      if (profileStr) rawProfile = JSON.parse(profileStr);
    } catch {
      rawProfile = null;
    }
    if (!rawProfile && rawBacklog.storedDb?.tables?.user_profile) {
      const dbProfile = rawBacklog.storedDb.tables.user_profile;
      rawProfile = Array.isArray(dbProfile) ? (dbProfile[0] || null) : dbProfile;
    }

    let rawPosts = [];
    try {
      const postsStr = localStorage.getItem(domainConfig.postsStorageKey);
      if (postsStr) {
        const parsed = JSON.parse(postsStr);
        if (Array.isArray(parsed)) rawPosts = parsed;
      }
    } catch {
      rawPosts = [];
    }

    const hasExistingUserData = Boolean(rawBacklog.hasStoredItems || rawProfile);
    if (!hasExistingUserData) {
      return {
        hasExistingUserData: false,
        storedMigrationVersion,
        rawWorkspace: null,
      };
    }

    return {
      hasExistingUserData: true,
      storedMigrationVersion,
      rawWorkspace: {
        items: rawBacklog.items || [],
        profile: rawProfile,
        posts: rawPosts,
      },
    };
  } catch {
    return {
      hasExistingUserData: false,
      storedMigrationVersion: 0,
      rawWorkspace: null,
    };
  }
}

function initBootMigrationState() {
  const probe = readRawWorkspaceSnapshotForMigration();
  if (!probe.hasExistingUserData || !probe.rawWorkspace) {
    return { locked: false, warning: null, status: 'up-to-date' };
  }
  const needed = needsWorkspaceMigration(
    probe.rawWorkspace,
    probe.storedMigrationVersion
  );
  return {
    locked: needed,
    warning: null,
    status: needed ? 'pending' : 'up-to-date',
  };
}

export function App() {
  const [activeTab, setActiveTab] = useState('home');
  const [selectedItemId, setSelectedItemId] = useState(null);
  const [geminiModalOpen, setGeminiModalOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [backupModalOpen, setBackupModalOpen] = useState(false);
  const [themeModalOpen, setThemeModalOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [importCatalogOpen, setImportCatalogOpen] = useState(false);
  const [wrappedOpen, setWrappedOpen] = useState(false);
  const [globalRouletteOpen, setGlobalRouletteOpen] = useState(false);
  const [aboutCreditsOpen, setAboutCreditsOpen] = useState(false);
  const [migrationState, setMigrationState] = useState(initBootMigrationState);
  const bootMigrationPromiseRef = useRef(null);
  const [requestedCollectionId, setRequestedCollectionId] = useState(null);
  const [privateStorageMode, setPrivateStorageMode] = useState(false);
  const [onboardingReopened, setOnboardingReopened] = useState(false);
  const [backendReady, setBackendReady] = useState(false);
  const [backendSession, setBackendSession] = useState(() => ({
    mode: getBackendMode(),
    authenticated: false,
    user: null,
    profile: null,
  }));
  const [journalComposer, setJournalComposer] = useState({
    open: false,
    itemId: null,
  });
  const [viewingUserProfileId, setViewingUserProfileId] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatPeerId, setChatPeerId] = useState(null);
  const [unreadDmCount, setUnreadDmCount] = useState(0);
  const [socialCounts, setSocialCounts] = useState({
    wallPostsCount: 0,
    chatMessagesCount: 0,
  });
  const [pendingInviteHandle, setPendingInviteHandle] = useState(null);
  const [inviteCandidate, setInviteCandidate] = useState(null);
  const [inviteFollowBusy, setInviteFollowBusy] = useState(false);
  const [shareProfileModalOpen, setShareProfileModalOpen] = useState(false);
  const [friendCardModal, setFriendCardModal] = useState(null);
  const [savedPeerCards, setSavedPeerCards] = useState(() => listSavedPeerCards());
  const [backupReminderDismissed, setBackupReminderDismissed] = useState(false);
  const [backupReminderTick, setBackupReminderTick] = useState(0);

  const perfDebugEnabled = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search || '').get('perf') === '1';
  }, []);

  const { showToast } = useToast();

  const {
    mode,
    font,
    texture,
    density,
    motion,
    fontScale,
    dyslexiaSpacing,
    presetId,
    specialThemeId,
    pastelSubpaletteId,
    pastelCustomColor,
    bgColor,
    accentColor,
    hasCustomBg,
    setMode,
    setFont,
    setTexture,
    setDensity,
    setMotion,
    setFontScale,
    setDyslexiaSpacing,
    applyPreset,
    applySpecialTheme,
    selectPastelSubpalette,
    setPastelCustomColor,
    setCustomBgColor,
    setCustomAccentColor,
    resetCustomColors,
  } = useTheme();

  const aiConfig = useAiConfig();
  const geminiKey = aiConfig.geminiKey;
  const hasGeminiKey = aiConfig.hasGeminiKey;
  const saveApiKey = useCallback(
    (key) => aiConfig.saveProviderKey('gemini', key),
    [aiConfig]
  );
  const clearApiKey = useCallback(
    () => aiConfig.clearProviderKey('gemini'),
    [aiConfig]
  );

  const {
    profile,
    posts,
    updateProfile,
    addPost,
    deletePost,
    addPostComment,
    deletePostComment,
    restoreSocialBackup,
  } = useSocialProfile({ migrationLocked: migrationState.locked });

  const {
    items,
    readingSessions,
    collections,
    addItem,
    batchAddItems,
    updateItem,
    batchUpdateItems,
    batchRemoveItems,
    restoreRemovedItems,
    createCollection,
    deleteCollection,
    moveCollection,
    moveCollectionWork,
    toggleWorkCollection,
    addReadingSession,
    replaceWorkspaceData,
    exportBackup,
    exportCatalogCsv,
    exportCatalogMarkdown,
    importBackup,
  } = useBacklog(profile?.readerDna || null, {
    migrationLocked: migrationState.locked,
  });

  const {
    streakData,
    streakCount,
    loggedToday,
    isPaused,
    history,
    dailyLogs,
    restDaysRemaining,
    isRestDayToday,
    useRestDay,
    registerToday,
    restoreStreakBackup,
  } = useReadingStreak();

  const bootSnapshotRef = useRef({
    profile,
    items,
    posts,
    streak: streakData,
    readingSessions,
  });

  useEffect(() => {
    let active = true;
    bootstrapBackend(bootSnapshotRef.current)
      .then((res) => {
        if (!active) return;
        setBackendSession({
          mode: res.mode,
          authenticated: Boolean(res.authenticated),
          user: res.user || null,
          profile: res.profile || null,
        });
        if (res.mode === 'supabase' && res.profile) {
          restoreSocialBackup({ profile: res.profile });
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setBackendReady(true);
      });
    return () => {
      active = false;
    };
  }, [restoreSocialBackup]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onSwUpdate = () => {
      showToast({
        message: 'Nova versão disponível — Atualizar',
        type: 'info',
        duration: 0,
        action: {
          label: 'Atualizar',
          onClick: () => {
            window.__codiceApplySwUpdate?.();
          },
        },
      });
    };
    window.addEventListener('codice:pwa-update-available', onSwUpdate);
    return () => window.removeEventListener('codice:pwa-update-available', onSwUpdate);
  }, [showToast]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('indexedDB' in window)) {
      setPrivateStorageMode(true);
      return;
    }
    try {
      const probe = window.indexedDB.open('cine_codice_probe_v1', 1);
      probe.onerror = () => setPrivateStorageMode(true);
      probe.onsuccess = () => {
        try {
          probe.result?.close?.();
        } catch {
          // Ignora
        }
      };
    } catch {
      setPrivateStorageMode(true);
    }
  }, []);

  useEffect(() => {
    if (migrationState.status !== 'pending') return undefined;
    let active = true;

    const runMigration = async () => {
      if (!bootMigrationPromiseRef.current) {
        bootMigrationPromiseRef.current = (async () => {
          const probe = readRawWorkspaceSnapshotForMigration();
          if (!probe.hasExistingUserData || !probe.rawWorkspace) {
            return { status: 'up-to-date', workspace: null };
          }
          const episodeEvaluations = await getAllEpisodeEvaluations().catch(() => []);
          const rawWorkspace = {
            ...probe.rawWorkspace,
            streak: streakData,
            readingSessions,
            collections,
            episodeEvaluations,
          };

          return executeAtomicWorkspaceMigration({
            rawWorkspace,
            storedMigrationVersion: probe.storedMigrationVersion,
            saveSnapshotFn: saveAutoSnapshot,
            verifySnapshotFn: verifyAutoSnapshotIntegrity,
            commitFn: async (migrated) => {
              if (typeof localStorage === 'undefined') return;
              const prevStorage = localStorage.getItem(domainConfig.storageKey);
              const prevProfile = localStorage.getItem(domainConfig.profileStorageKey);
              const prevDb = localStorage.getItem(CODICE_DB_STORAGE_KEY);
              const prevVersion = localStorage.getItem(MIGRATION_VERSION_KEY);

              try {
                localStorage.setItem(
                  domainConfig.storageKey,
                  JSON.stringify(migrated.items)
                );
                if (migrated.profile) {
                  localStorage.setItem(
                    domainConfig.profileStorageKey,
                    JSON.stringify(migrated.profile)
                  );
                }
                const db = buildCodiceDatabase({
                  items: migrated.items,
                  profile: migrated.profile || null,
                  posts: migrated.posts || [],
                  streak: migrated.streak || null,
                  readingSessions: migrated.readingSessions || [],
                  collections: migrated.collections || [],
                  episodeEvaluations: migrated.episodeEvaluations || [],
                });
                localStorage.setItem(CODICE_DB_STORAGE_KEY, JSON.stringify(db));
                localStorage.setItem(
                  MIGRATION_VERSION_KEY,
                  String(CURRENT_MIGRATION_VERSION)
                );
              } catch (err) {
                const restoreKey = (k, prevVal) => {
                  if (prevVal === null) localStorage.removeItem(k);
                  else localStorage.setItem(k, prevVal);
                };
                try {
                  restoreKey(domainConfig.storageKey, prevStorage);
                  restoreKey(domainConfig.profileStorageKey, prevProfile);
                  restoreKey(CODICE_DB_STORAGE_KEY, prevDb);
                  restoreKey(MIGRATION_VERSION_KEY, prevVersion);
                } catch {
                  // Silencioso
                }
                throw err;
              }
            },
          });
        })();
      }

      const result = await bootMigrationPromiseRef.current;
      if (!active) return;

      if (result.status === 'migrated' || result.status === 'up-to-date') {
        if (result.workspace?.items) {
          replaceWorkspaceData({ items: result.workspace.items });
        }
        if (result.workspace?.profile) {
          restoreSocialBackup({ profile: result.workspace.profile });
        }
        setMigrationState({
          locked: false,
          warning: null,
          status: result.status,
        });
      } else {
        setMigrationState({
          locked: true,
          warning:
            result.warning ||
            'Não foi possível validar o snapshot antes da migração. Seus dados antigos permanecem intactos.',
          status: 'aborted',
        });
      }
    };

    runMigration();
    return () => {
      active = false;
    };
  }, [
    migrationState.status,
    streakData,
    readingSessions,
    collections,
    replaceWorkspaceData,
    restoreSocialBackup,
  ]);

  useEffect(() => {
    if (!backendReady || migrationState.locked) return undefined;
    const timer = setTimeout(() => {
      syncActiveWorkspaceToBackend({
        profile,
        items,
        posts,
        streak: streakData,
        readingSessions,
      }).catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [
    backendReady,
    migrationState.locked,
    profile,
    items,
    posts,
    streakData,
    readingSessions,
  ]);

  const handleUpdateProfileWithSync = useCallback(
    (updates, toastMessage = 'Perfil atualizado') => {
      updateProfile(updates);
      const mergedProfile = { ...profile, ...updates };
      updateActiveProfileInBackend(mergedProfile)
        .then((synced) => {
          if (synced) {
            setBackendSession((prev) => ({ ...prev, profile: synced }));
          }
        })
        .catch(() => {});
      if (toastMessage) {
        showToast({ message: toastMessage, type: 'success' });
      }
    },
    [profile, updateProfile, showToast]
  );

  const handleAuthSuccess = useCallback(
    (result) => {
      if (!result) return;
      setBackendSession({
        mode: result.mode || getBackendMode(),
        authenticated: Boolean(result.user),
        user: result.user || null,
        profile: result.profile || null,
      });

      if (result.profile && result.workspace) {
        replaceWorkspaceData({
          items: result.workspace.items || [],
          readingSessions: result.workspace.readingSessions || [],
        });
        restoreSocialBackup({
          profile: result.profile,
          posts: result.workspace.posts || [],
        });
        restoreStreakBackup(
          result.workspace.streak || { count: 0, lastDate: null, history: [] }
        );
        showToast({
          message:
            result.mode === 'supabase'
              ? `Conectado como ${result.profile.handle}`
              : `Perfil ativo: ${result.profile.handle}`,
          type: 'success',
        });
      } else if (result.authenticated === false) {
        showToast({ message: 'Sessão encerrada', type: 'info' });
      }
    },
    [replaceWorkspaceData, restoreSocialBackup, restoreStreakBackup, showToast]
  );

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedItemId) ?? null,
    [items, selectedItemId]
  );

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    let gChordUntil = 0;
    const handleGlobalKeys = (e) => {
      if ((e.ctrlKey || e.metaKey) && String(e.key || '').toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
        return;
      }

      if (paletteOpen || importCatalogOpen || themeModalOpen || backupModalOpen) {
        return;
      }

      const tag = e.target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) {
        return;
      }

      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setShortcutsOpen((prev) => !prev);
        return;
      }

      const lowerKey = String(e.key || '').toLowerCase();
      const now = Date.now();
      if (gChordUntil > now) {
        gChordUntil = 0;
        if (lowerKey === 'h') {
          e.preventDefault();
          setActiveTab('home');
          return;
        }
        if (lowerKey === 'a') {
          e.preventDefault();
          setActiveTab('list');
          return;
        }
        if (lowerKey === 'm') {
          e.preventDefault();
          setActiveTab('stats');
          return;
        }
      }

      if (lowerKey === 'g' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        gChordUntil = now + 900;
        return;
      }

      if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setActiveTab('list');
        requestAnimationFrame(() => {
          document.querySelector('input[aria-label="Buscar obras no acervo"]')?.focus();
        });
        return;
      }

      if (lowerKey === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey && !shortcutsOpen) {
        e.preventDefault();
        setActiveTab('add');
      }
    };
    window.addEventListener('keydown', handleGlobalKeys);
    return () => window.removeEventListener('keydown', handleGlobalKeys);
  }, [paletteOpen, importCatalogOpen, themeModalOpen, backupModalOpen, shortcutsOpen]);

  const handleAddItem = (newItem) => {
    addItem(newItem);
    showToast({
      message:
        newItem?.status === 'completed'
          ? 'Obra catalogada como Concluída'
          : 'Obra salva na cinemateca',
      type: 'success',
    });
  };

  const handleUpdateItem = (id, updates) => {
    const prev = items.find((entry) => entry.id === id);
    updateItem(id, updates);
    if (updates?.status === 'completed' && prev?.status !== 'completed') {
      showToast({
        message: 'Sessão concluída com sucesso',
        type: 'success',
      });
    }
  };

  const handleRemoveItem = (id) => {
    const snap = batchRemoveItems([id]);
    showToast({
      message: 'Obra removida do acervo',
      type: 'info',
      duration: 8000,
      action:
        snap?.removedItems?.length > 0
          ? {
              label: 'Desfazer',
              onClick: () => {
                restoreRemovedItems(snap);
                showToast({ message: 'Obra restaurada no acervo', type: 'success' });
              },
            }
          : undefined,
    });
  };

  const handleOpenJournalComposer = (itemId = null) => {
    setJournalComposer({ open: true, itemId });
  };

  const handlePublishPost = (postData) => {
    addPost(postData);
    setActiveTab('profile');
    showToast({ message: 'Registro salvo no Diário de Sessões', type: 'success' });
  };

  const handleExportBackup = async () => {
    await exportBackup({ profile, posts, streak: streakData });
    showToast({
      message: 'Backup assinado (.json + SHA-256) exportado',
      type: 'success',
    });
  };

  const handleExportCsv = () => {
    exportCatalogCsv({ profile, posts, streak: streakData });
    showToast({ message: 'Catálogo (.csv) exportado', type: 'success' });
  };

  const handleExportMarkdown = () => {
    exportCatalogMarkdown({ profile, posts, streak: streakData });
    showToast({ message: 'Catálogo Markdown (.md) exportado', type: 'success' });
  };

  const handleImportBackup = async (file) => {
    const result = await importBackup(file);
    if (result.ok) {
      restoreSocialBackup({ profile: result.profile, posts: result.posts });
      restoreStreakBackup(result.streak);
      const orphanCount = result.integrity?.orphanCount || 0;
      showToast({
        message:
          orphanCount > 0
            ? `Backup restaurado (${result.count} obras, ${orphanCount} órfão(s) sinalizado(s))`
            : `Backup restaurado (${result.count} obras)`,
        type: 'success',
      });
    } else {
      showToast({ message: result.error, type: 'error' });
    }
    return result;
  };

  const handleApplyRestoreSnapshot = useCallback(
    async (incomingSnapshot, modeArg = 'merge') => {
      if (!incomingSnapshot) return;
      const currentEvals = await getAllEpisodeEvaluations().catch(() => []);

      if (modeArg === 'replace') {
        await saveAutoSnapshot(
          {
            items,
            profile,
            posts,
            streak: streakData,
            readingSessions,
            collections,
            episodeEvaluations: currentEvals,
          },
          { reason: 'pre-restore', label: 'Pré-restauração automática', force: true }
        ).catch(() => {});

        const migratedItems = (incomingSnapshot.items || []).map((entry) =>
          migrateWorkItem(entry)
        );
        const migratedProfile = incomingSnapshot.profile
          ? migrateProfileData(incomingSnapshot.profile)
          : undefined;

        replaceWorkspaceData({
          items: migratedItems,
          readingSessions: incomingSnapshot.readingSessions || [],
          collections: incomingSnapshot.collections || [],
        });
        restoreSocialBackup({
          profile: migratedProfile,
          posts: incomingSnapshot.posts || [],
        });
        restoreStreakBackup(
          incomingSnapshot.streak || { count: 0, lastDate: null, history: [] }
        );
        if (
          Array.isArray(incomingSnapshot.episodeEvaluations) &&
          incomingSnapshot.episodeEvaluations.length > 0
        ) {
          await importEpisodeEvaluations(incomingSnapshot.episodeEvaluations).catch(() => {});
        }
        showToast({
          message: `Cinemateca restaurada (${migratedItems.length} obras)`,
          type: 'success',
        });
        return;
      }

      const merged = mergeSnapshots(
        {
          items,
          profile,
          posts,
          streak: streakData,
          readingSessions,
          collections,
          episodeEvaluations: currentEvals,
        },
        incomingSnapshot
      );
      const migratedMergedItems = (merged.items || []).map((entry) =>
        migrateWorkItem(entry)
      );
      replaceWorkspaceData({
        items: migratedMergedItems,
        readingSessions: merged.readingSessions,
        collections: merged.collections || [],
      });
      restoreSocialBackup({
        profile: merged.profile ? migrateProfileData(merged.profile) : merged.profile,
        posts: merged.posts,
      });
      restoreStreakBackup(merged.streak);
      if (
        Array.isArray(merged.episodeEvaluations) &&
        merged.episodeEvaluations.length > 0
      ) {
        await importEpisodeEvaluations(merged.episodeEvaluations).catch(() => {});
      }
      showToast({
        message: `Backup mesclado com sucesso (${migratedMergedItems.length} obras no acervo)`,
        type: 'success',
      });
    },
    [
      items,
      profile,
      posts,
      streakData,
      readingSessions,
      collections,
      replaceWorkspaceData,
      restoreSocialBackup,
      restoreStreakBackup,
      showToast,
    ]
  );

  useEffect(() => {
    if (migrationState.locked) return;
    const db = buildCodiceDatabase({
      items,
      profile,
      posts,
      streak: streakData,
      readingSessions,
      collections,
    });
    persistCodiceDatabase(db);
    saveEmergencyMirror({
      items,
      collections,
      streak: streakData,
      readingSessions,
    });
  }, [migrationState.locked, items, profile, posts, streakData, readingSessions, collections]);

  useEffect(() => {
    requestPersistentStorage().catch(() => {});
  }, []);

  useEffect(() => {
    if (migrationState.locked || !items || items.length === 0) return undefined;
    listAutoSnapshots()
      .then((snaps) => {
        if (!Array.isArray(snaps) || snaps.length === 0) {
          return saveAutoSnapshot(
            { items, profile, posts, streak: streakData, readingSessions, collections },
            { reason: 'auto', label: 'Recuperação automática do espelho local' }
          );
        }
        return null;
      })
      .catch(() => {});
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [migrationState.locked]);

  useEffect(() => {
    if (migrationState.locked || !items || items.length === 0) return undefined;
    const timer = setTimeout(async () => {
      const episodeEvaluations = await getAllEpisodeEvaluations().catch(() => []);
      saveAutoSnapshot(
        {
          items,
          profile,
          posts,
          streak: streakData,
          readingSessions,
          collections,
          episodeEvaluations,
        },
        { reason: 'auto', label: 'Auto-snapshot automático' }
      ).catch(() => {});
    }, 8000);
    return () => clearTimeout(timer);
  }, [
    migrationState.locked,
    items,
    profile,
    posts,
    streakData,
    readingSessions,
    collections,
  ]);

  const handleRegisterToday = () => {
    registerToday();
    showToast({ message: 'Constância de sessões registrada hoje', type: 'success' });
  };

  const handleQuickReadingCheckIn = useCallback(
    ({ workId = null, minutes = 0, episodes = 0, note = '' } = {}) => {
      const cleanMinutes = Math.max(0, Math.round(Number(minutes) || 0));
      const cleanEpisodes = Math.max(0, Math.round(Number(episodes) || 0));
      const cleanNote = String(note || '').trim();
      if (cleanMinutes <= 0 && cleanEpisodes <= 0 && !cleanNote) return;

      const targetWork = workId ? items.find((entry) => entry.id === workId) : null;

      if (targetWork) {
        const episodic = isEpisodicWork(targetWork);
        const updates = {
          updatedAt: new Date().toISOString(),
          ...(targetWork.status === 'queued' ? { status: 'playing', startDate: getTodayLocalISO() } : {}),
        };

        if (cleanEpisodes > 0 && episodic) {
          const next = advanceEpisodeProgress(targetWork, { addEpisodes: cleanEpisodes });
          updates.currentSeason = next.currentSeason;
          updates.currentEpisode = next.currentEpisode;
          updates.watchedEpisodes = next.watchedEpisodes;
          updates.progress = next.progress;
          if (targetWork.totalEpisodes > 0 && next.progress >= 100) {
            updates.status = 'completed';
            updates.completedDate = getTodayLocalISO();
          }
        } else if (cleanMinutes > 0 && !episodic) {
          const next = advanceMovieSeconds(targetWork, cleanMinutes);
          updates.currentSeconds = next.currentSeconds;
          if (next.totalSeconds) updates.totalSeconds = next.totalSeconds;
          updates.progress = next.progress;
          if (next.totalSeconds && next.currentSeconds >= next.totalSeconds) {
            updates.status = 'completed';
            updates.completedDate = getTodayLocalISO();
          }
        }

        updateItem(targetWork.id, updates);

        addReadingSession({
          workId: targetWork.id,
          minutesWatched: cleanMinutes,
          episodesWatched: cleanEpisodes,
          durationSeconds: cleanMinutes * 60,
          notes:
            cleanEpisodes > 0 && !cleanNote
              ? `+${cleanEpisodes} episódio(s)`
              : cleanNote,
        });
        registerToday({ note: cleanNote });
      } else {
        registerToday({
          standalonePages: cleanMinutes,
          standaloneSessions: 1,
          note: cleanNote,
        });
      }

      showToast({
        message:
          cleanEpisodes > 0
            ? `+${cleanEpisodes} ${cleanEpisodes === 1 ? 'episódio registrado' : 'episódios registrados'}`
            : cleanMinutes > 0
              ? `+${cleanMinutes} min registrados hoje`
              : 'Impressão de sessão salva',
        type: 'success',
      });
    },
    [items, updateItem, addReadingSession, registerToday, showToast]
  );

  const handleQuickAdvanceWork = useCallback(
    (work) => {
      if (!work?.id) return;
      if (isEpisodicWork(work)) {
        const dur = Number(work.episodeDurationMinutes) || (work.workType === 'anime' ? 24 : 45);
        handleQuickReadingCheckIn({ workId: work.id, episodes: 1, minutes: dur });
      } else {
        handleQuickReadingCheckIn({ workId: work.id, minutes: 15 });
      }
    },
    [handleQuickReadingCheckIn]
  );

  const handleStartPickedWork = useCallback(
    (work) => {
      if (!work?.id) return;
      updateItem(work.id, {
        status: 'playing',
        inBacklog: true,
        startDate: work.startDate || getTodayLocalISO(),
      });
      setSelectedItemId(work.id);
      showToast({
        message: `"${work.title}" iniciada em Exibição`,
        type: 'success',
      });
    },
    [updateItem, showToast]
  );

  const activeViewerId =
    backendSession?.user?.id || backendSession?.profile?.id || profile?.id || null;

  const refreshSocialSignals = useCallback(() => {
    if (!backendReady) return;
    ensureLocalCommunitySeeded()
      .then(() =>
        Promise.all([
          getUnreadMessagesCount({ viewerId: activeViewerId }),
          listWallPosts(activeViewerId || 'local-default', {
            viewerId: activeViewerId,
          }),
          listDirectConversations({ viewerId: activeViewerId }),
        ])
      )
      .then(async ([unread, wallList, convs]) => {
        setUnreadDmCount(Number(unread) || 0);
        let msgCount = 0;
        if (Array.isArray(convs) && convs.length > 0) {
          const threads = await Promise.all(
            convs.map((c) =>
              listDirectMessages(c.peerId, { viewerId: activeViewerId }).catch(() => [])
            )
          );
          msgCount = threads.reduce(
            (sum, list) =>
              sum +
              (Array.isArray(list)
                ? list.filter((m) => m.senderId === (activeViewerId || 'local-default')).length
                : 0),
            0
          );
        }
        setSocialCounts({
          wallPostsCount: Array.isArray(wallList) ? wallList.length : 0,
          chatMessagesCount: msgCount,
        });
      })
      .catch(() => {});
  }, [backendReady, activeViewerId]);

  useEffect(() => {
    refreshSocialSignals();
  }, [refreshSocialSignals]);

  const titleEvaluation = useMemo(
    () =>
      evaluateReaderTitles({
        items,
        profile,
        readingSessions,
        streakCount,
        posts,
        wallPostsCount: socialCounts.wallPostsCount,
        chatMessagesCount: socialCounts.chatMessagesCount,
      }),
    [items, profile, readingSessions, streakCount, posts, socialCounts]
  );

  const resolvedTitleBadge = titleEvaluation?.resolvedActiveBadge?.name || '';

  useEffect(() => {
    if (!backendReady || !titleEvaluation?.stalePinnedCleared) return;
    updateProfile({ activeTitleBadge: 'auto' });
  }, [backendReady, titleEvaluation?.stalePinnedCleared, updateProfile]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search || '');
    const hasInvite = params.has('invite');
    const hasCard = params.has('card');
    if (!hasInvite && !hasCard) return;

    const rawInvite = hasInvite ? params.get('invite') : null;
    const rawCard = hasCard ? params.get('card') : null;
    const parsedHandle = rawInvite ? parseInviteHandleParam(rawInvite) : null;

    params.delete('invite');
    params.delete('card');
    const nextSearch = params.toString();
    const cleanUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash || ''}`;
    if (typeof window.history?.replaceState === 'function') {
      window.history.replaceState({}, '', cleanUrl);
    }

    if (rawCard) {
      const decoded = decodePublicProfileCard(rawCard);
      if (decoded.ok) {
        setFriendCardModal(decoded.card);
      } else {
        showToast({
          message: decoded.error || 'Link de cartão de perfil inválido.',
          type: 'error',
        });
      }
    }

    if (parsedHandle) {
      setPendingInviteHandle(parsedHandle);
    }
  }, [showToast]);

  const backupReminder = useMemo(() => {
    if (backupReminderDismissed) {
      return { shouldRemind: false, daysWithoutBackup: 0 };
    }
    const backlogCount = items.filter((item) => item && item.inBacklog !== false).length;
    return getBackupReminderStatus({
      itemCount: backlogCount,
      nowMs: Date.now() + backupReminderTick * 0,
    });
  }, [items, backupReminderDismissed, backupReminderTick]);

  const handleSaveBackupCopyNow = useCallback(async () => {
    try {
      const episodeEvaluations = await getAllEpisodeEvaluations().catch(() => []);
      const res = await shareOrDownloadSignedBackup({
        items,
        profile,
        posts,
        streak: streakData,
        readingSessions,
        collections,
        episodeEvaluations,
      });
      setBackupReminderTick((t) => t + 1);
      if (res.method === 'share') {
        showToast({ message: 'Cópia de segurança compartilhada.', type: 'success' });
      } else if (res.method === 'download') {
        showToast({
          message: 'Cópia de segurança (.json + SHA-256) salva no aparelho.',
          type: 'success',
        });
      }
    } catch {
      showToast({
        message: 'Não foi possível gerar a cópia agora.',
        type: 'error',
      });
    }
  }, [items, profile, posts, streakData, readingSessions, collections, showToast]);

  const handleSavePeerCard = useCallback(
    (card) => {
      if (!card) return;
      const next = savePeerProfileCard(card);
      setSavedPeerCards(next);
      showToast({
        message: `${card.displayName || card.handle} salvo na sua Rede local.`,
        type: 'success',
      });
    },
    [showToast]
  );

  const handleRemovePeerCard = useCallback(
    (cardIdOrHandle) => {
      const next = removeSavedPeerCard(cardIdOrHandle);
      setSavedPeerCards(next);
      showToast({ message: 'Contato removido da lista salva.', type: 'info' });
    },
    [showToast]
  );

  useEffect(() => {
    if (!backendReady || !pendingInviteHandle) return undefined;
    let active = true;
    resolveInviteProfile(pendingInviteHandle, { viewerId: activeViewerId })
      .then((resolved) => {
        if (!active) return;
        setPendingInviteHandle(null);
        if (resolved) {
          setInviteCandidate(resolved);
        } else {
          showToast({
            message: `Convite ${pendingInviteHandle} não encontrado.`,
            type: 'info',
          });
        }
      })
      .catch(() => {
        if (active) setPendingInviteHandle(null);
      });

    return () => {
      active = false;
    };
  }, [backendReady, pendingInviteHandle, activeViewerId, showToast]);

  useEffect(() => {
    if (!inviteCandidate) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        setInviteCandidate(null);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [inviteCandidate]);

  const handleOpenDirectChat = useCallback((peerId = null) => {
    setChatPeerId(peerId || null);
    setChatOpen(true);
  }, []);

  const handleCopyWorkToWishlist = useCallback(
    (work) => {
      if (!work?.title) return;
      const alreadyExists = items.some(
        (i) =>
          String(i.title || '').trim().toLowerCase() ===
          String(work.title || '').trim().toLowerCase()
      );
      if (alreadyExists) {
        showToast({
          message: `"${work.title}" já faz parte da sua cinemateca.`,
          type: 'info',
        });
        return;
      }
      addItem({
        ...work,
        id: createUuid(),
        status: 'queued',
        isWishlist: true,
        inBacklog: true,
        currentSeconds: 0,
        currentEpisode: 0,
        currentSeason: 1,
        progress: 0,
        rating: null,
        verdict: null,
        notes: work.notes ? `Referência externa: ${work.notes}` : '',
        addedAt: new Date().toISOString(),
      });
      showToast({
        message: `"${work.title}" adicionada à sua fila Quero Ver.`,
        type: 'success',
      });
    },
    [items, addItem, showToast]
  );

  const handleRecommendWorkToFeed = useCallback(
    (work, noteText = '') => {
      if (!work?.title) return;
      const creator = work.director || work.studio || work.author || '';
      addPost({
        itemId: work.id || null,
        itemTitle: work.title,
        itemSnapshot: {
          title: work.title,
          director: creator,
          author: creator,
          coverUrl: work.coverUrl || null,
        },
        title: `Indicação de sessão: ${work.title}`,
        caption:
          noteText ||
          `Recomendo assistir "${work.title}"${creator ? ` (${creator})` : ''}.`,
        visibility: profile?.privacyLevel === 'private' ? 'private' : 'public',
      });
      refreshSocialSignals();
      showToast({
        message: `"${work.title}" registrada no Diário`,
        type: 'success',
      });
    },
    [addPost, profile?.privacyLevel, refreshSocialSignals, showToast]
  );

  const handleSelectOrAddFromRecommendation = useCallback(
    (recItem) => {
      if (!recItem) return;
      const existing = items.find(
        (i) =>
          i.id === recItem.id ||
          String(i.title || '').trim().toLowerCase() ===
            String(recItem.title || '').trim().toLowerCase()
      );
      if (existing) {
        setSelectedItemId(existing.id);
      } else {
        handleCopyWorkToWishlist(recItem);
      }
    },
    [items, handleCopyWorkToWishlist]
  );

  const handleUseRestDay = useCallback(() => {
    const ok = useRestDay();
    if (ok) {
      showToast({
        message: 'Dia de descanso gentil registrado — sua sequência está protegida.',
        type: 'info',
      });
    }
  }, [useRestDay, showToast]);

  const streakProps = {
    streakCount,
    loggedToday,
    isPaused,
    history,
    restDaysRemaining,
    isRestDayToday,
    onUseRestDay: handleUseRestDay,
    onRegisterToday: handleRegisterToday,
  };

  const textureClass =
    texture === 'paper'
      ? 'app-texture-paper'
      : texture === 'grid'
        ? 'app-texture-grid'
        : texture === 'glow'
          ? 'app-texture-glow'
          : '';

  return (
    <div className="relative min-h-screen bg-app text-ink transition-colors duration-200">
      <GraphicFilters />
      {textureClass && (
        <div
          aria-hidden="true"
          className={`app-texture-overlay ${textureClass}`}
        />
      )}
      <div className="relative z-10 mx-auto min-h-screen max-w-md md:max-w-2xl lg:max-w-4xl bg-transparent sm:border-x sm:border-line/60">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-[4px] focus:bg-accent focus:px-3 focus:py-2 focus:text-xs focus:font-semibold focus:text-accent-ink"
        >
          Ir para o conteúdo principal
        </a>
        <div role="status" aria-live="polite" className="sr-only">
          Tela ativa: {
            {
              home: 'Início',
              stats: 'Métricas',
              add: 'Catalogar',
              list: 'Acervo',
              community: 'Rede',
              profile: 'Perfil',
            }[activeTab] || activeTab
          }
        </div>
        {migrationState.warning && (
          <div
            role="alert"
            className="mx-4 sm:mx-6 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-accent bg-card px-3 py-2.5 text-xs text-ink"
          >
            <span className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />
              <span>{migrationState.warning}</span>
            </span>
            <button
              type="button"
              onClick={handleSaveBackupCopyNow}
              className="min-h-[44px] rounded-[4px] border border-accent bg-accent/10 px-3 text-[11px] font-semibold text-accent hover:bg-accent hover:text-accent-ink"
            >
              Salvar Cópia
            </button>
          </div>
        )}
        {privateStorageMode && (
          <div
            role="status"
            className="mx-4 sm:mx-6 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-line bg-card px-3 py-2 text-xs text-muted"
          >
            <span>
              Modo privado ou IndexedDB indisponível. Exporte uma cópia de segurança antes de fechar.
            </span>
            <button
              type="button"
              onClick={handleSaveBackupCopyNow}
              className="min-h-[36px] rounded-[4px] border border-accent bg-accent/10 px-2.5 text-[11px] font-semibold text-accent hover:bg-accent hover:text-accent-ink"
            >
              Salvar Cópia
            </button>
          </div>
        )}
        <main
          id="main-content"
          tabIndex={-1}
          className="px-4 sm:px-6 pt-4 pb-[env(safe-area-inset-bottom)] focus:outline-none"
        >
          <ErrorBoundary
            key={activeTab}
            screenName={
              {
                home: 'Início',
                stats: 'Métricas',
                add: 'Catalogar',
                list: 'Acervo',
                community: 'Rede',
                profile: 'Perfil',
              }[activeTab] || 'esta tela'
            }
            onOpenBackup={() => setBackupModalOpen(true)}
          >
            <Suspense fallback={<SkeletonScreen variant={activeTab} />}>
              {activeTab === 'home' && (
                <HomeScreen
                  items={items}
                  profile={profile}
                  streakProps={streakProps}
                  readingSessions={readingSessions}
                  dailyLogs={dailyLogs}
                  resolvedBadgeName={resolvedTitleBadge}
                  viewerId={activeViewerId}
                  geminiKey={geminiKey}
                  backupReminder={backupReminder}
                  onSaveBackupNow={handleSaveBackupCopyNow}
                  onDismissBackupReminder={() => setBackupReminderDismissed(true)}
                  onQuickCheckIn={handleQuickReadingCheckIn}
                  onQuickAdvanceWork={handleQuickAdvanceWork}
                  onStartPickedWork={handleStartPickedWork}
                  onSelectItem={handleSelectOrAddFromRecommendation}
                  onAddToWishlist={handleCopyWorkToWishlist}
                  onCatalogFranchiseEntry={handleAddItem}
                  onNavigateList={() => setActiveTab('list')}
                  onNavigateAdd={() => setActiveTab('add')}
                  onOpenGeminiSettings={() => setGeminiModalOpen(true)}
                  onOpenThemeStudio={() => setThemeModalOpen(true)}
                />
              )}
              {activeTab === 'stats' && (
                <StatsScreen
                  items={items}
                  readingSessions={readingSessions}
                  streakHistory={history}
                  dailyLogs={dailyLogs}
                  onOpenWrapped={() => setWrappedOpen(true)}
                />
              )}
              {activeTab === 'add' && (
                <AddScreen
                  items={items}
                  geminiKey={geminiKey}
                  tmdbKey={aiConfig.tmdbKey}
                  onAddItem={handleAddItem}
                  onSelectExisting={(item) => setSelectedItemId(item.id)}
                  onOpenGeminiSettings={() => setGeminiModalOpen(true)}
                  onOpenImportCatalog={() => setImportCatalogOpen(true)}
                />
              )}
              {activeTab === 'list' && (
                <ListScreen
                  items={items}
                  profile={profile}
                  collections={collections}
                  onCreateCollection={createCollection}
                  onDeleteCollection={deleteCollection}
                  onMoveCollection={moveCollection}
                  onMoveCollectionWork={moveCollectionWork}
                  onBatchUpdateItems={batchUpdateItems}
                  onBatchRemoveItems={batchRemoveItems}
                  onRestoreRemovedItems={restoreRemovedItems}
                  onStartPickedWork={handleStartPickedWork}
                  onSelectItem={(item) => setSelectedItemId(item.id)}
                  onOpenCommandPalette={() => setPaletteOpen(true)}
                  onNavigateAdd={() => setActiveTab('add')}
                  requestedCollectionId={requestedCollectionId}
                  onConsumeRequestedCollection={() => setRequestedCollectionId(null)}
                />
              )}
              {activeTab === 'community' && (
                <CommunityScreen
                  viewerId={activeViewerId}
                  myProfile={profile}
                  myShelfItems={items}
                  savedPeerCards={savedPeerCards}
                  unreadDmCount={unreadDmCount}
                  backendMode={backendSession?.mode || 'local'}
                  onOpenAuthModal={() => setAuthModalOpen(true)}
                  onOpenShareProfileCard={() => setShareProfileModalOpen(true)}
                  onOpenFriendCard={(card) => setFriendCardModal(card)}
                  onRemoveFriendCard={handleRemovePeerCard}
                  onOpenUserProfile={(id) => setViewingUserProfileId(id)}
                  onOpenDirectChat={handleOpenDirectChat}
                  onCopyBookToWishlist={handleCopyWorkToWishlist}
                  onSocialChanged={refreshSocialSignals}
                />
              )}
              {activeTab === 'profile' && (
                <ProfileScreen
                  items={items}
                  profile={profile}
                  posts={posts}
                  readingSessions={readingSessions}
                  streakCount={streakCount}
                  viewerId={activeViewerId}
                  wallPostsCount={socialCounts.wallPostsCount}
                  chatMessagesCount={socialCounts.chatMessagesCount}
                  geminiKey={geminiKey}
                  hasGeminiKey={aiConfig.hasAnyAiKey || hasGeminiKey}
                  aiConfig={aiConfig}
                  backendSession={backendSession}
                  backupReminder={backupReminder}
                  onSaveBackupNow={handleSaveBackupCopyNow}
                  onDismissBackupReminder={() => setBackupReminderDismissed(true)}
                  onOpenShareProfileCard={() => setShareProfileModalOpen(true)}
                  onOpenCommunity={() => setActiveTab('community')}
                  onOpenAuthModal={() => setAuthModalOpen(true)}
                  onOpenGeminiSettings={() => setGeminiModalOpen(true)}
                  onOpenThemeStudio={() => setThemeModalOpen(true)}
                  onOpenImportCatalog={() => setImportCatalogOpen(true)}
                  onOpenShortcuts={() => setShortcutsOpen(true)}
                  onSaveGeminiKey={(key) => {
                    saveApiKey(key);
                    showToast({
                      message: key ? 'Chave Google Gemini salva' : 'Chave Gemini removida',
                      type: 'success',
                    });
                  }}
                  onReopenOnboarding={() => setOnboardingReopened(true)}
                  themeProps={{
                    mode,
                    font,
                    texture,
                    density,
                    motion,
                    fontScale,
                    dyslexiaSpacing,
                    presetId,
                    specialThemeId,
                    pastelSubpaletteId,
                    pastelCustomColor,
                    bgColor,
                    accentColor,
                    hasCustomBg,
                    onSelectMode: setMode,
                    onSelectFont: setFont,
                    onSelectTexture: setTexture,
                    onSelectDensity: setDensity,
                    onSelectMotion: setMotion,
                    onSelectFontScale: setFontScale,
                    onToggleDyslexia: setDyslexiaSpacing,
                    onApplyPreset: applyPreset,
                    onApplySpecialTheme: applySpecialTheme,
                    onSelectPastelSubpalette: selectPastelSubpalette,
                    onChangePastelColor: setPastelCustomColor,
                    onChangeBgColor: setCustomBgColor,
                    onChangeAccentColor: setCustomAccentColor,
                    onResetTheme: resetCustomColors,
                  }}
                  onUpdateProfile={(updates) =>
                    handleUpdateProfileWithSync(updates, 'Perfil atualizado')
                  }
                  onSelectItem={(item) => setSelectedItemId(item.id)}
                  onOpenJournalComposer={handleOpenJournalComposer}
                  onDeletePost={deletePost}
                  onAddPostComment={addPostComment}
                  onDeletePostComment={deletePostComment}
                  onExportBackup={handleExportBackup}
                  onExportCsv={handleExportCsv}
                  onExportBibtex={handleExportMarkdown}
                  onImportBackup={handleImportBackup}
                  onOpenBackupModal={() => setBackupModalOpen(true)}
                  onOpenAboutCredits={() => setAboutCreditsOpen(true)}
                  onWallMutated={refreshSocialSignals}
                  onSelectPeerProfile={(id) => setViewingUserProfileId(id)}
                />
              )}
            </Suspense>
          </ErrorBoundary>
        </main>

        <BottomNav
          activeTab={activeTab === 'community' ? 'profile' : activeTab}
          onChangeTab={setActiveTab}
          unreadDmCount={unreadDmCount}
        />

        <Suspense fallback={null}>
          {Boolean(selectedItem) && (
            <ItemDetailSheet
              item={selectedItem}
              allItems={items}
              profile={profile}
              posts={posts}
              collections={collections}
              geminiKey={geminiKey}
              viewerId={activeViewerId}
              onClose={() => setSelectedItemId(null)}
              onUpdateItem={handleUpdateItem}
              onSelectItem={(next) => {
                if (next?.id) setSelectedItemId(next.id);
              }}
              onQuickCatalogItem={handleAddItem}
              onToggleCollection={toggleWorkCollection}
              onCreateCollection={createCollection}
              onRemoveItem={handleRemoveItem}
              onOpenJournal={handleOpenJournalComposer}
              onOpenGeminiSettings={() => setGeminiModalOpen(true)}
              onRecommendToFeed={handleRecommendWorkToFeed}
              onSocialActivityChanged={refreshSocialSignals}
            />
          )}

          {journalComposer.open && (
            <JournalComposerModal
              isOpen={journalComposer.open}
              onClose={() => setJournalComposer({ open: false, itemId: null })}
              items={items}
              initialItemId={journalComposer.itemId}
              onPublish={handlePublishPost}
            />
          )}

          {geminiModalOpen && (
            <GeminiConfigModal
              isOpen={geminiModalOpen}
              onClose={() => setGeminiModalOpen(false)}
              apiKey={geminiKey}
              aiConfig={aiConfig}
              onSaveKey={(key) => {
                saveApiKey(key);
                showToast({
                  message: key ? 'Chave Google Gemini salva' : 'Chave Gemini removida',
                  type: 'success',
                });
              }}
              onClearKey={() => {
                clearApiKey();
                showToast({ message: 'Chave Gemini removida', type: 'info' });
              }}
            />
          )}

          {(!profile.onboardingCompleted || onboardingReopened) && (
            <OnboardingFlow
              isOpen={!profile.onboardingCompleted || onboardingReopened}
              canDismiss={Boolean(profile.onboardingCompleted)}
              profile={profile}
              geminiKey={geminiKey}
              onSelectThemeMode={setMode}
              onApplyThemePreset={applyPreset}
              onChangeAccentColor={setCustomAccentColor}
              onSaveGeminiKey={saveApiKey}
              onImportBackup={handleImportBackup}
              onComplete={(updates) => {
                handleUpdateProfileWithSync(updates, 'Perfil do espectador salvo');
                setOnboardingReopened(false);
              }}
              onDismiss={() => setOnboardingReopened(false)}
            />
          )}

          {backupModalOpen && (
            <BackupRestoreModal
              isOpen={backupModalOpen}
              onClose={() => setBackupModalOpen(false)}
              currentWorkspace={{
                items,
                profile,
                posts,
                streak: streakData,
                readingSessions,
                collections,
              }}
              onExportBackup={handleExportBackup}
              onExportCsv={handleExportCsv}
              onExportBibtex={handleExportMarkdown}
              onApplyRestore={handleApplyRestoreSnapshot}
            />
          )}

          {authModalOpen && (
            <AuthModal
              isOpen={authModalOpen}
              onClose={() => setAuthModalOpen(false)}
              backendSession={backendSession}
              currentWorkspace={{
                profile,
                items,
                posts,
                streak: streakData,
                readingSessions,
              }}
              onAuthSuccess={handleAuthSuccess}
            />
          )}

          {Boolean(viewingUserProfileId) && (
            <UserProfileModal
              isOpen={Boolean(viewingUserProfileId)}
              profileId={viewingUserProfileId}
              viewerId={activeViewerId}
              onClose={() => setViewingUserProfileId(null)}
              onOpenDirectChat={(peerId) => {
                setViewingUserProfileId(null);
                handleOpenDirectChat(peerId);
              }}
              onCopyBookToWishlist={handleCopyWorkToWishlist}
              onSelectPeerProfile={(id) => setViewingUserProfileId(id)}
              onFollowChanged={refreshSocialSignals}
            />
          )}

          {chatOpen && (
            <DirectChatDrawer
              isOpen={chatOpen}
              onClose={() => setChatOpen(false)}
              viewerId={activeViewerId}
              initialPeerId={chatPeerId}
              myShelfItems={items}
              backendMode={backendSession?.mode || 'local'}
              onOpenAuthModal={() => setAuthModalOpen(true)}
              onCopyBookToWishlist={handleCopyWorkToWishlist}
              onUnreadChanged={refreshSocialSignals}
            />
          )}

          {shareProfileModalOpen && (
            <ShareProfileCardModal
              isOpen={shareProfileModalOpen}
              onClose={() => setShareProfileModalOpen(false)}
              profile={profile}
              items={items}
              activeTitleName={resolvedTitleBadge}
              streakCount={streakCount}
            />
          )}

          {Boolean(friendCardModal) && (
            <FriendProfileCardModal
              isOpen={Boolean(friendCardModal)}
              card={friendCardModal}
              isAlreadySaved={Boolean(
                friendCardModal &&
                  savedPeerCards.some(
                    (c) =>
                      String(c.handle || '').toLowerCase() ===
                      String(friendCardModal.handle || '').toLowerCase()
                  )
              )}
              onClose={() => setFriendCardModal(null)}
              onSaveFriend={handleSavePeerCard}
              onCopyBookToWishlist={handleCopyWorkToWishlist}
            />
          )}

          {themeModalOpen && (
            <ThemeModal
              isOpen={themeModalOpen}
              onClose={() => setThemeModalOpen(false)}
              mode={mode}
              font={font}
              texture={texture}
              density={density}
              motion={motion}
              presetId={presetId}
              specialThemeId={specialThemeId}
              pastelSubpaletteId={pastelSubpaletteId}
              pastelCustomColor={pastelCustomColor}
              bgColor={bgColor}
              accentColor={accentColor}
              hasCustomBg={hasCustomBg}
              onSelectMode={setMode}
              onSelectFont={setFont}
              onSelectTexture={setTexture}
              onSelectDensity={setDensity}
              onSelectMotion={setMotion}
              onApplyPreset={applyPreset}
              onApplySpecialTheme={applySpecialTheme}
              onSelectPastelSubpalette={selectPastelSubpalette}
              onChangePastelColor={setPastelCustomColor}
              onChangeBgColor={setCustomBgColor}
              onChangeAccentColor={setCustomAccentColor}
              onResetTheme={resetCustomColors}
            />
          )}

          {paletteOpen && (
            <CommandPalette
              isOpen={paletteOpen}
              onClose={() => setPaletteOpen(false)}
              items={items}
              collections={collections}
              onNavigateTab={setActiveTab}
              onSelectItem={(item) => {
                if (item?.id) setSelectedItemId(item.id);
              }}
              onSelectCollection={(colId) => {
                setRequestedCollectionId(colId);
                setActiveTab('list');
              }}
              onOpenThemeStudio={() => setThemeModalOpen(true)}
              onOpenRoulette={() => setGlobalRouletteOpen(true)}
              onExportBackup={handleSaveBackupCopyNow}
              onToggleFocusTheme={() => {
                if (specialThemeId === 'focus-dim') {
                  setMode(mode || 'oled');
                } else {
                  applySpecialTheme('focus-dim');
                }
              }}
            />
          )}

          {globalRouletteOpen && (
            <OfflineBookPickerModal
              isOpen={globalRouletteOpen}
              onClose={() => setGlobalRouletteOpen(false)}
              items={items}
              readerDna={profile?.readerDna || null}
              onStartReading={handleStartPickedWork}
              onSelectItem={(item) => {
                if (item?.id) setSelectedItemId(item.id);
              }}
            />
          )}

          {shortcutsOpen && (
            <KeyboardShortcutsModal
              isOpen={shortcutsOpen}
              onClose={() => setShortcutsOpen(false)}
            />
          )}

          {importCatalogOpen && (
            <ImportCatalogModal
              isOpen={importCatalogOpen}
              onClose={() => setImportCatalogOpen(false)}
              existingItems={items}
              onCommitImport={(records) => {
                const inserted = batchAddItems(records);
                showToast({
                  message: `${inserted.length} obra(s) importada(s) para a cinemateca.`,
                  type: 'success',
                });
                if (inserted.length > 0) setActiveTab('list');
              }}
            />
          )}

          {wrappedOpen && (
            <WrappedModal
              isOpen={wrappedOpen}
              onClose={() => setWrappedOpen(false)}
              items={items}
              profile={profile}
              streakCount={streakCount}
            />
          )}

          {aboutCreditsOpen && (
            <AboutCreditsModal
              isOpen={aboutCreditsOpen}
              onClose={() => setAboutCreditsOpen(false)}
            />
          )}

          {perfDebugEnabled && <PerfOverlay />}
        </Suspense>

        {inviteCandidate && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
            onClick={() => setInviteCandidate(null)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Confirmação de convite"
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-[6px] border border-line bg-card p-5 text-ink space-y-4"
            >
              <div className="flex items-start justify-between gap-3 border-b border-line pb-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                    Convite recebido
                  </p>
                  <h2 className="text-base font-serif font-semibold text-ink">
                    Conectar com este perfil?
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setInviteCandidate(null)}
                  aria-label="Fechar convite"
                  className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[4px] border border-line text-muted hover:text-ink"
                >
                  <X className="h-4 w-4" strokeWidth={1.5} />
                </button>
              </div>

              <div className="flex items-center gap-3 rounded-[4px] border border-line bg-app p-3">
                {inviteCandidate.avatarUrl ? (
                  <img
                    src={inviteCandidate.avatarUrl}
                    alt={inviteCandidate.displayName || inviteCandidate.handle}
                    className="h-12 w-12 shrink-0 rounded-full border border-line object-cover"
                  />
                ) : (
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-line bg-card text-sm font-serif font-semibold text-accent">
                    {inviteCandidate.avatarInitials || 'CC'}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-serif font-semibold text-ink">
                    {inviteCandidate.displayName || inviteCandidate.handle}
                  </p>
                  <p className="truncate text-xs text-muted tabular-nums">
                    {inviteCandidate.handle}
                  </p>
                </div>
              </div>

              {Boolean(
                inviteCandidate.isLocalContact ||
                  String(inviteCandidate.id || '').startsWith('contact:')
              ) && (
                <p className="rounded-[4px] border border-line bg-app px-3 py-2 text-xs text-muted leading-relaxed">
                  Convite salvo na lista local de contatos. Conecte o Supabase para seguir em tempo real.
                </p>
              )}

              <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    const targetId = inviteCandidate.id;
                    setInviteCandidate(null);
                    if (targetId) setViewingUserProfileId(targetId);
                  }}
                  className="min-h-[44px] rounded-[4px] border border-line px-3.5 py-2 text-xs font-medium text-ink hover:border-accent hover:text-accent"
                >
                  Ver perfil
                </button>

                {inviteCandidate.isLocalContact ||
                String(inviteCandidate.id || '').startsWith('contact:') ? (
                  <button
                    type="button"
                    onClick={() => {
                      setInviteCandidate(null);
                      setAuthModalOpen(true);
                    }}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[4px] border border-accent bg-accent px-3.5 py-2 text-xs font-medium text-accent-ink"
                  >
                    <UserCheck className="h-4 w-4" strokeWidth={1.5} />
                    <span>Conectar Supabase</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={inviteFollowBusy}
                    onClick={async () => {
                      if (inviteFollowBusy) return;
                      setInviteFollowBusy(true);
                      try {
                        const res = await followReader(inviteCandidate.id, {
                          viewerId: activeViewerId,
                        });
                        showToast({
                          message:
                            res?.status === 'pending'
                              ? 'Solicitação enviada.'
                              : `Você começou a seguir ${inviteCandidate.displayName || inviteCandidate.handle}.`,
                          type: 'success',
                        });
                        refreshSocialSignals();
                        setInviteCandidate(null);
                      } catch (err) {
                        showToast({
                          message:
                            err?.userMessage ||
                            'Não foi possível seguir este perfil.',
                          type: 'error',
                        });
                      } finally {
                        setInviteFollowBusy(false);
                      }
                    }}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[4px] border border-accent bg-accent px-3.5 py-2 text-xs font-medium text-accent-ink disabled:opacity-50"
                  >
                    <UserPlus className="h-4 w-4" strokeWidth={1.5} />
                    <span>{inviteFollowBusy ? 'Seguindo...' : 'Seguir'}</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
