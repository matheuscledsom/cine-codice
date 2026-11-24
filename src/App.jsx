import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Cloud, CloudOff, Download, RefreshCw, WifiOff } from 'lucide-react';
import { getAllEpisodeEvaluations, importEpisodeEvaluations } from './api/cacheDb';
import { BottomNav } from './components/BottomNav';
import { ErrorBoundary } from './components/ErrorBoundary';
import { OmniLogo } from './components/OmniLogo';
import { PwaUpdateBanner } from './components/PwaUpdateBanner';
import { SkeletonScreen } from './components/SkeletonScreen';
import {
  domainConfig,
  getDomainMeta,
  getStatusLabelForDomain,
  inferDomainFromWork,
  normalizeDomainId,
} from './config/domainConfig';
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
  loadEmergencyMirror,
  mergeSnapshots,
  requestPersistentStorage,
  restoreSnapshotWithSafety,
  saveAutoSnapshot,
  saveEmergencyMirror,
  shareOrDownloadSignedBackup,
  verifyAutoSnapshotIntegrity,
} from './services/backupEngine';
import {
  bootstrapBackend,
  getBackendMode,
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
  cacheCoverImageToSupabaseStorage,
  cancelPendingCloudDelete,
  deleteWorksFromCloud,
  getActiveSupabaseSession,
  pushWorksToCloud,
  readSyncMeta,
  signInWithEmailPassword,
  signOutFromCloud,
  subscribeToAuthChanges,
  subscribeToCatalogRealtime,
  syncCatalogWithSupabase,
} from './services/omniSyncService';
import { getSupabaseConfig } from './services/supabaseClient';
import { evaluateReaderTitles } from './services/readerTitlesEngine';
import {
  advanceEpisodeProgress,
  advanceMovieSeconds,
  getTodayLocalISO,
  isEpisodicWork,
} from './utils/backlogHelpers';
import { computeDomainQuickActionPatch } from './utils/catalogDraftHelpers';
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
const ProfileScreen = lazy(() =>
  import('./screens/ProfileScreen').then((m) => ({ default: m.ProfileScreen }))
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
const WorkDetailPage = lazy(() =>
  import('./components/WorkDetailPage').then((m) => ({
    default: m.WorkDetailPage,
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
const OmniCloudModal = lazy(() =>
  import('./components/OmniCloudModal').then((m) => ({
    default: m.OmniCloudModal,
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
  const [backupModalOpen, setBackupModalOpen] = useState(false);
  const [themeModalOpen, setThemeModalOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [importCatalogOpen, setImportCatalogOpen] = useState(false);
  const [wrappedOpen, setWrappedOpen] = useState(false);
  const [wrappedScope, setWrappedScope] = useState('domain');
  const [globalRouletteOpen, setGlobalRouletteOpen] = useState(false);
  const [aboutCreditsOpen, setAboutCreditsOpen] = useState(false);
  const [cloudModalOpen, setCloudModalOpen] = useState(false);
  const [pwaUpdateAvailable, setPwaUpdateAvailable] = useState(false);
  const [cloudSyncState, setCloudSyncState] = useState(() => ({
    configured: getSupabaseConfig().isConfigured,
    authenticated: false,
    user: null,
    syncing: false,
    offline: typeof navigator !== 'undefined' ? navigator.onLine === false : false,
    lastSyncAt: readSyncMeta().lastSyncAt,
    error: null,
  }));
  const [migrationState, setMigrationState] = useState(initBootMigrationState);
  const bootMigrationPromiseRef = useRef(null);
  const [requestedCollectionId, setRequestedCollectionId] = useState(null);
  const [requestedCreatorQuery, setRequestedCreatorQuery] = useState('');
  const [requestedAddQuery, setRequestedAddQuery] = useState('');
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
  const [backupReminderDismissed, setBackupReminderDismissed] = useState(false);
  const [backupReminderTick, setBackupReminderTick] = useState(0);

  const perfDebugEnabled = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search || '').get('perf') === '1';
  }, []);

  const { showToast } = useToast();

  const {
    mode,
    bgTintColor,
    font,
    texture,
    density,
    motion,
    fontScale,
    dyslexiaSpacing,
    bgColor,
    accentColor,
    hasCustomBg,
    setMode,
    setBgTintColor,
    setFont,
    setTexture,
    setDensity,
    setMotion,
    setFontScale,
    setDyslexiaSpacing,
    setCustomBgColor,
    setCustomAccentColor,
    resetCustomColors,
  } = useTheme();

  const [activeDomain, setActiveDomain] = useState(() => {
    try {
      if (typeof localStorage === 'undefined') return 'cinema';
      const saved = localStorage.getItem('omniprism_active_domain_v1');
      return saved ? normalizeDomainId(saved) : 'cinema';
    } catch {
      return 'cinema';
    }
  });
  const activeDomainMeta = useMemo(() => getDomainMeta(activeDomain), [activeDomain]);
  const initialTintAppliedRef = useRef(false);

  useEffect(() => {
    if (initialTintAppliedRef.current) return;
    initialTintAppliedRef.current = true;
    if (!bgTintColor) {
      setCustomAccentColor(null);
      setBgTintColor(getDomainMeta(activeDomain).tintHex);
    }
  }, [activeDomain, bgTintColor, setBgTintColor, setCustomAccentColor]);

  const handleSelectDomain = useCallback(
    (nextDomain) => {
      const clean = normalizeDomainId(nextDomain);
      setActiveDomain(clean);
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('omniprism_active_domain_v1', clean);
        }
      } catch {
        // Ignora erro de storage
      }
      setCustomAccentColor(null);
      setBgTintColor(getDomainMeta(clean).tintHex);
    },
    [setBgTintColor, setCustomAccentColor]
  );

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
    storageError,
    retryPersistStorage,
  } = useBacklog(profile?.readerDna || null, {
    migrationLocked: migrationState.locked,
  });
  const [secondaryStorageWarning, setSecondaryStorageWarning] = useState('');

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

  const itemsRef = useRef(items);
  itemsRef.current = items;
  const realtimeUnsubRef = useRef(null);
  const cloudApplyingRemoteRef = useRef(false);
  const lastPushedMapRef = useRef(new Map());
  const initialSyncDoneForUserRef = useRef(null);

  const attachRealtimeForUser = useCallback(
    (userId) => {
      if (realtimeUnsubRef.current) {
        realtimeUnsubRef.current();
        realtimeUnsubRef.current = null;
      }
      if (!userId) return;
      realtimeUnsubRef.current = subscribeToCatalogRealtime({
        userId,
        getCurrentWorks: () => itemsRef.current,
        onRemoteWorksMerged: (mergedWorks) => {
          const nextMap = new Map();
          mergedWorks.forEach((w) => {
            if (w?.id) nextMap.set(String(w.id), w.updatedAt || '');
          });
          lastPushedMapRef.current = nextMap;
          cloudApplyingRemoteRef.current = true;
          replaceWorkspaceData({ items: mergedWorks });
          setCloudSyncState((prev) => ({
            ...prev,
            lastSyncAt: new Date().toISOString(),
            error: null,
          }));
        },
      });
    },
    [replaceWorkspaceData]
  );

  const runCloudSyncNow = useCallback(
    async ({ localWorksOverride = null, silent = true } = {}) => {
      const cfg = getSupabaseConfig();
      const offlineNow =
        typeof navigator !== 'undefined' && navigator.onLine === false;

      if (!cfg.isConfigured) {
        setCloudSyncState((prev) => ({
          ...prev,
          configured: false,
          syncing: false,
          offline: offlineNow,
        }));
        return { ok: false, unconfigured: true };
      }

      if (offlineNow) {
        setCloudSyncState((prev) => ({
          ...prev,
          configured: true,
          syncing: false,
          offline: true,
        }));
        return { ok: false, offline: true };
      }

      setCloudSyncState((prev) => ({
        ...prev,
        configured: true,
        syncing: true,
        offline: false,
        error: null,
      }));

      const res = await syncCatalogWithSupabase({
        localWorksOverride: localWorksOverride ?? itemsRef.current,
      });

      if (res.ok) {
        const nextMap = new Map();
        (res.works || []).forEach((w) => {
          if (w?.id) nextMap.set(String(w.id), w.updatedAt || '');
        });
        lastPushedMapRef.current = nextMap;
        cloudApplyingRemoteRef.current = true;
        replaceWorkspaceData({ items: res.works || [] });
        setCloudSyncState({
          configured: true,
          authenticated: true,
          user: res.user || null,
          syncing: false,
          offline: false,
          lastSyncAt: res.syncedAt,
          error: null,
        });
        if (!silent) {
          showToast({
            message: `Catálogo sincronizado com Supabase (${(res.works || []).length} obras).`,
            type: 'success',
          });
        }
        return res;
      }

      setCloudSyncState((prev) => ({
        ...prev,
        configured: true,
        syncing: false,
        offline: Boolean(res.offline),
        authenticated: res.unauthenticated ? false : prev.authenticated,
        user: res.unauthenticated ? null : prev.user,
        error:
          res.offline || res.unauthenticated || res.unconfigured
            ? null
            : res.error || null,
      }));
      return res;
    },
    [replaceWorkspaceData, showToast]
  );

  useEffect(() => {
    if (migrationState.locked) return undefined;
    let active = true;

    const bootstrapCloudAuth = async () => {
      const cfg = getSupabaseConfig();
      const offlineNow =
        typeof navigator !== 'undefined' && navigator.onLine === false;

      if (!cfg.isConfigured) {
        if (active) {
          setCloudSyncState((prev) => ({
            ...prev,
            configured: false,
            authenticated: false,
            user: null,
            offline: offlineNow,
          }));
        }
        return;
      }

      const sessionRes = await getActiveSupabaseSession();
      if (!active) return;

      const user = sessionRes.user || null;
      setCloudSyncState((prev) => ({
        ...prev,
        configured: true,
        authenticated: Boolean(user),
        user,
        offline: offlineNow,
      }));

      if (user?.id) {
        attachRealtimeForUser(user.id);
        if (initialSyncDoneForUserRef.current !== user.id) {
          initialSyncDoneForUserRef.current = user.id;
          runCloudSyncNow({ localWorksOverride: itemsRef.current, silent: true }).catch(
            () => {}
          );
        }
      }
    };

    bootstrapCloudAuth();

    const unsubAuth = subscribeToAuthChanges((_event, session) => {
      if (!active) return;
      const user = session?.user || null;
      setCloudSyncState((prev) => ({
        ...prev,
        authenticated: Boolean(user),
        user,
      }));
      if (user?.id) {
        attachRealtimeForUser(user.id);
        if (initialSyncDoneForUserRef.current !== user.id) {
          initialSyncDoneForUserRef.current = user.id;
          runCloudSyncNow({ localWorksOverride: itemsRef.current, silent: true }).catch(
            () => {}
          );
        }
      } else {
        initialSyncDoneForUserRef.current = null;
        if (realtimeUnsubRef.current) {
          realtimeUnsubRef.current();
          realtimeUnsubRef.current = null;
        }
      }
    });

    const onOnline = () => {
      setCloudSyncState((prev) => ({ ...prev, offline: false }));
      if (initialSyncDoneForUserRef.current) {
        runCloudSyncNow({ localWorksOverride: itemsRef.current, silent: true }).catch(
          () => {}
        );
      }
    };
    const onOffline = () => {
      setCloudSyncState((prev) => ({ ...prev, offline: true, syncing: false }));
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('online', onOnline);
      window.addEventListener('offline', onOffline);
    }

    return () => {
      active = false;
      unsubAuth();
      if (realtimeUnsubRef.current) {
        realtimeUnsubRef.current();
        realtimeUnsubRef.current = null;
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', onOnline);
        window.removeEventListener('offline', onOffline);
      }
    };
  }, [migrationState.locked, attachRealtimeForUser, runCloudSyncNow]);

  useEffect(() => {
    if (
      migrationState.locked ||
      !cloudSyncState.authenticated ||
      cloudSyncState.offline
    ) {
      return undefined;
    }

    if (cloudApplyingRemoteRef.current) {
      cloudApplyingRemoteRef.current = false;
      return undefined;
    }

    const changedWorks = items.filter((w) => {
      if (!w?.id) return false;
      return lastPushedMapRef.current.get(String(w.id)) !== (w.updatedAt || '');
    });

    if (changedWorks.length === 0) return undefined;

    const timer = setTimeout(() => {
      pushWorksToCloud(changedWorks)
        .then((res) => {
          if (res?.ok) {
            changedWorks.forEach((w) => {
              lastPushedMapRef.current.set(String(w.id), w.updatedAt || '');
            });
            setCloudSyncState((prev) => ({
              ...prev,
              lastSyncAt: new Date().toISOString(),
              error: null,
            }));
          }
        })
        .catch(() => {});
    }, 650);

    return () => clearTimeout(timer);
  }, [
    items,
    migrationState.locked,
    cloudSyncState.authenticated,
    cloudSyncState.offline,
  ]);

  const handleCloudSignIn = useCallback(
    async ({ email, password }) => {
      const authRes = await signInWithEmailPassword({ email, password });
      if (!authRes.ok) {
        return authRes;
      }
      const user = authRes.user;
      if (user?.id) {
        initialSyncDoneForUserRef.current = user.id;
        attachRealtimeForUser(user.id);
      }
      setCloudSyncState((prev) => ({
        ...prev,
        configured: true,
        authenticated: Boolean(user),
        user,
        error: null,
      }));
      await runCloudSyncNow({ localWorksOverride: itemsRef.current, silent: false });
      return { ok: true, user };
    },
    [attachRealtimeForUser, runCloudSyncNow]
  );

  const handleCloudSignOut = useCallback(async () => {
    initialSyncDoneForUserRef.current = null;
    if (realtimeUnsubRef.current) {
      realtimeUnsubRef.current();
      realtimeUnsubRef.current = null;
    }
    await signOutFromCloud();
    lastPushedMapRef.current.clear();
    setCloudSyncState((prev) => ({
      ...prev,
      authenticated: false,
      user: null,
      syncing: false,
      error: null,
    }));
    showToast({
      message: 'Conta desconectada. Seus dados continuam salvos localmente.',
      type: 'info',
    });
  }, [showToast]);

  const handleCloudConfigChanged = useCallback(async () => {
    const cfg = getSupabaseConfig();
    setCloudSyncState((prev) => ({
      ...prev,
      configured: cfg.isConfigured,
    }));
    if (cfg.isConfigured) {
      const sessionRes = await getActiveSupabaseSession();
      if (sessionRes.user?.id) {
        initialSyncDoneForUserRef.current = sessionRes.user.id;
        attachRealtimeForUser(sessionRes.user.id);
        runCloudSyncNow({ localWorksOverride: itemsRef.current, silent: true }).catch(
          () => {}
        );
      }
    }
  }, [attachRealtimeForUser, runCloudSyncNow]);

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
      setPwaUpdateAvailable(true);
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
          document.querySelector('input[aria-label="Buscar obras no catálogo"]')?.focus();
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
    const itemId = String(newItem?.id || createUuid());
    const itemWithId = { ...newItem, id: itemId };
    addItem(itemWithId);
    const itemDomain = inferDomainFromWork(itemWithId);
    const completedLabel = getStatusLabelForDomain('completed', itemDomain);
    showToast({
      message:
        newItem?.status === 'completed'
          ? `Obra catalogada como ${completedLabel}`
          : 'Obra salva no catálogo',
      type: 'success',
    });

    if (itemWithId.coverUrl) {
      cacheCoverImageToSupabaseStorage(itemWithId)
        .then((cacheRes) => {
          if (cacheRes?.ok && cacheRes.url) {
            updateItem(itemId, {
              coverUrl: cacheRes.url,
              coverSources: Array.from(
                new Set(
                  [
                    cacheRes.url,
                    ...(Array.isArray(itemWithId.coverSources)
                      ? itemWithId.coverSources
                      : []),
                    itemWithId.coverUrl,
                  ].filter(Boolean)
                )
              ),
            });
          }
        })
        .catch(() => {});
    }
  };

  const handleUpdateItem = (id, updates) => {
    const prev = items.find((entry) => entry.id === id);
    updateItem(id, updates);
    if (updates?.status === 'completed' && prev?.status !== 'completed') {
      const doneLabel = getStatusLabelForDomain(
        'completed',
        inferDomainFromWork(prev || updates)
      );
      showToast({
        message: `Status atualizado para ${doneLabel}`,
        type: 'success',
      });
    }
  };

  const handleBatchRemoveWithCloud = useCallback(
    (ids = []) => {
      const snap = batchRemoveItems(ids);
      if (Array.isArray(ids) && ids.length > 0) {
        deleteWorksFromCloud(ids).catch(() => {});
      }
      return snap;
    },
    [batchRemoveItems]
  );

  const handleRestoreRemovedWithCloud = useCallback(
    (snap) => {
      restoreRemovedItems(snap);
      const restoredWorks = snap?.removedItems || [];
      restoredWorks.forEach((w) => {
        if (w?.id) cancelPendingCloudDelete(w.id);
      });
      if (restoredWorks.length > 0) {
        pushWorksToCloud(restoredWorks).catch(() => {});
      }
    },
    [restoreRemovedItems]
  );

  const handleRemoveItem = (id) => {
    const snap = handleBatchRemoveWithCloud([id]);
    showToast({
      message: 'Obra removida do catálogo',
      type: 'info',
      duration: 8000,
      action:
        snap?.removedItems?.length > 0
          ? {
              label: 'Desfazer',
              onClick: () => {
                handleRestoreRemovedWithCloud(snap);
                showToast({ message: 'Obra restaurada no catálogo', type: 'success' });
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
      const restored = await restoreSnapshotWithSafety({
        currentWorkspace: {
          items,
          profile,
          posts,
          streak: streakData,
          readingSessions,
          collections,
          episodeEvaluations: currentEvals,
        },
        incomingSnapshot,
        mode: modeArg,
        saveSnapshotFn: saveAutoSnapshot,
      });

      if (!restored?.ok || !restored.workspace) return;
      const nextWs = restored.workspace;

      replaceWorkspaceData({
        items: nextWs.items || [],
        readingSessions: nextWs.readingSessions || [],
        collections: nextWs.collections || [],
      });
      restoreSocialBackup({
        profile: nextWs.profile,
        posts: nextWs.posts || [],
      });
      restoreStreakBackup(
        nextWs.streak || { count: 0, lastDate: null, history: [] }
      );
      if (
        Array.isArray(nextWs.episodeEvaluations) &&
        nextWs.episodeEvaluations.length > 0
      ) {
        await importEpisodeEvaluations(nextWs.episodeEvaluations).catch(() => {});
      }
      showToast({
        message:
          restored.mode === 'replace'
            ? `Catálogo restaurado (${(nextWs.items || []).length} obras)`
            : `Backup mesclado com snapshot prévio (${(nextWs.items || []).length} obras no catálogo)`,
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

  const mirrorRecoveryDoneRef = useRef(false);

  useEffect(() => {
    if (migrationState.locked) return undefined;
    let cancelled = false;

    const syncLocalMirrors = async () => {
      let episodeEvaluations = await getAllEpisodeEvaluations().catch(() => []);
      if (!mirrorRecoveryDoneRef.current) {
        mirrorRecoveryDoneRef.current = true;
        if (episodeEvaluations.length === 0) {
          const mirror = loadEmergencyMirror();
          if (mirror.ok && Array.isArray(mirror.episodeEvaluations) && mirror.episodeEvaluations.length > 0) {
            await importEpisodeEvaluations(mirror.episodeEvaluations).catch(() => {});
            episodeEvaluations = mirror.episodeEvaluations;
          }
        }
      }
      if (cancelled) return;

      const db = buildCodiceDatabase({
        items,
        profile,
        posts,
        streak: streakData,
        readingSessions,
        collections,
        episodeEvaluations,
      });
      const dbRes = persistCodiceDatabase(db);
      if (!dbRes?.persisted) {
        setSecondaryStorageWarning(
          dbRes?.warning ||
            'Falha ao gravar cópia relacional no localStorage: alterações recentes estão provisórias até liberar espaço ou exportar backup.'
        );
      } else {
        setSecondaryStorageWarning((prev) => (prev ? '' : prev));
      }

      const mirrorOk = saveEmergencyMirror({
        items,
        profile,
        collections,
        streak: streakData,
        readingSessions,
        episodeEvaluations,
      });
      if (!mirrorOk && dbRes?.persisted) {
        setSecondaryStorageWarning(
          'Cota do localStorage atingida ao atualizar o espelho de emergência LZW. Exporte um backup (.json) por segurança.'
        );
      }
    };

    syncLocalMirrors();
    return () => {
      cancelled = true;
    };
  }, [migrationState.locked, items, profile, posts, streakData, readingSessions, collections]);

  useEffect(() => {
    requestPersistentStorage().catch(() => {});
  }, []);

  useEffect(() => {
    if (migrationState.locked || !items || items.length === 0) return undefined;
    Promise.all([listAutoSnapshots(), getAllEpisodeEvaluations().catch(() => [])])
      .then(([snaps, episodeEvaluations]) => {
        if (!Array.isArray(snaps) || snaps.length === 0) {
          return saveAutoSnapshot(
            {
              items,
              profile,
              posts,
              streak: streakData,
              readingSessions,
              collections,
              episodeEvaluations,
            },
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
    ({
      workId = null,
      minutes = 0,
      episodes = 0,
      note = '',
      allowCompletion = true,
    } = {}) => {
      const cleanMinutes = Math.max(0, Math.round(Number(minutes) || 0));
      const cleanEpisodes = Math.max(0, Math.round(Number(episodes) || 0));
      const cleanNote = String(note || '').trim();
      if (cleanMinutes <= 0 && cleanEpisodes <= 0 && !cleanNote) return;

      const targetWork = workId ? items.find((entry) => entry.id === workId) : null;

      let prevSnapshot = null;
      if (targetWork) {
        prevSnapshot = {
          status: targetWork.status,
          startDate: targetWork.startDate || null,
          completedDate: targetWork.completedDate || null,
          currentSeason: targetWork.currentSeason ?? 1,
          currentEpisode: targetWork.currentEpisode ?? 0,
          watchedEpisodes: targetWork.watchedEpisodes || {},
          currentSeconds: targetWork.currentSeconds ?? 0,
          totalSeconds: targetWork.totalSeconds ?? null,
          progress: targetWork.progress ?? 0,
          updatedAt: targetWork.updatedAt || targetWork.createdAt || null,
        };

        const episodic = isEpisodicWork(targetWork);
        const updates = {
          updatedAt: new Date().toISOString(),
          ...(targetWork.status === 'queued'
            ? { status: 'playing', startDate: targetWork.startDate || getTodayLocalISO() }
            : {}),
        };

        if (cleanEpisodes > 0 && episodic) {
          const next = advanceEpisodeProgress(targetWork, { addEpisodes: cleanEpisodes });
          updates.currentSeason = next.currentSeason;
          updates.currentEpisode = next.currentEpisode;
          updates.watchedEpisodes = next.watchedEpisodes;
          updates.progress = next.progress;
          if (allowCompletion && targetWork.totalEpisodes > 0 && next.progress >= 100) {
            updates.status = 'completed';
            updates.completedDate = getTodayLocalISO();
          }
        } else if (cleanMinutes > 0 && !episodic) {
          const next = advanceMovieSeconds(targetWork, cleanMinutes);
          updates.currentSeconds = next.currentSeconds;
          if (next.totalSeconds) updates.totalSeconds = next.totalSeconds;
          updates.progress = next.progress;
          if (allowCompletion && next.totalSeconds && next.currentSeconds >= next.totalSeconds) {
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
        duration: 6000,
        action:
          targetWork && prevSnapshot
            ? {
                label: 'Desfazer',
                onClick: () => {
                  updateItem(targetWork.id, prevSnapshot);
                },
              }
            : null,
      });
    },
    [items, updateItem, addReadingSession, registerToday, showToast]
  );

  const handleQuickAdvanceWork = useCallback(
    (work, options = {}) => {
      if (!work?.id) return;
      const { allowCompletion = true, actionType = null } = options || {};
      const workDomain = inferDomainFromWork(work);

      if (workDomain === 'reading' || workDomain === 'games' || workDomain === 'music') {
        const resolvedAction =
          actionType ||
          (workDomain === 'reading'
            ? 'reading_pages'
            : workDomain === 'games'
              ? 'games_1h'
              : 'music_listen');
        const plan = computeDomainQuickActionPatch(work, resolvedAction, {
          allowCompletion,
        });
        if (!plan) return;
        updateItem(work.id, plan.patch);
        registerToday?.();
        showToast({
          message: plan.toastMessage,
          type: 'success',
          duration: 6000,
          action: {
            label: 'Desfazer',
            onClick: () => {
              updateItem(work.id, plan.undoSnapshot);
            },
          },
        });
        return;
      }

      if (isEpisodicWork(work)) {
        const dur = Number(work.episodeDurationMinutes) || (work.workType === 'anime' ? 24 : 45);
        handleQuickReadingCheckIn({
          workId: work.id,
          episodes: 1,
          minutes: dur,
          allowCompletion,
        });
      } else {
        handleQuickReadingCheckIn({
          workId: work.id,
          minutes: 20,
          allowCompletion,
        });
      }
    },
    [handleQuickReadingCheckIn, updateItem, registerToday, showToast]
  );

  const handleStartPickedWork = useCallback(
    (work) => {
      if (!work?.id) return;
      const workDomain = inferDomainFromWork(work);
      const activeStatusLabel = getStatusLabelForDomain('playing', workDomain);
      updateItem(work.id, {
        status: 'playing',
        inBacklog: true,
        startDate: work.startDate || getTodayLocalISO(),
      });
      setSelectedItemId(work.id);
      showToast({
        message: `"${work.title}" movida para ${activeStatusLabel}`,
        type: 'success',
      });
    },
    [updateItem, showToast]
  );

  const activeViewerId =
    backendSession?.user?.id || backendSession?.profile?.id || profile?.id || null;

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
      }),
    [items, profile, readingSessions, streakCount, posts]
  );

  const resolvedTitleBadge = titleEvaluation?.resolvedActiveBadge?.name || '';

  useEffect(() => {
    if (!backendReady || !titleEvaluation?.stalePinnedCleared) return;
    updateProfile({ activeTitleBadge: 'auto' });
  }, [backendReady, titleEvaluation?.stalePinnedCleared, updateProfile]);

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
          message: `"${work.title}" já faz parte da seu catálogo.`,
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
      const queueLabel = getStatusLabelForDomain('queued', inferDomainFromWork(work));
      showToast({
        message: `"${work.title}" adicionada à fila ${queueLabel}.`,
        type: 'success',
      });
    },
    [items, addItem, showToast]
  );

  const handleNavigateAdd = useCallback(
    (initialQuery = '', targetDomain = null) => {
      if (targetDomain && targetDomain !== 'all') {
        handleSelectDomain(targetDomain);
      }
      if (typeof initialQuery === 'string' && initialQuery.trim()) {
        setRequestedAddQuery(initialQuery.trim());
      }
      setActiveTab('add');
    },
    [handleSelectDomain]
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
        visibility: 'private',
      });
      showToast({
        message: `"${work.title}" registrada no Diário`,
        type: 'success',
      });
    },
    [addPost, showToast]
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
              list: 'Catálogo',
              community: 'Rede',
              profile: 'Perfil',
            }[activeTab] || activeTab
          }
        </div>
        <header
          aria-label="Barra superior OmniPrism"
          className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-line/70 bg-app/90 px-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 backdrop-blur-md sm:px-6"
        >
          <button
            type="button"
            onClick={() => setActiveTab('home')}
            className="inline-flex min-h-[44px] items-center gap-2 text-left text-ink transition-opacity hover:opacity-85"
          >
            <OmniLogo size={22} className="text-ink" />
            <span className="text-sm font-semibold tracking-tight text-ink">
              {domainConfig.appName}
            </span>
            <span className="hidden sm:inline rounded-full border border-line bg-card px-2 py-0.5 text-[10px] font-medium text-accent">
              {activeDomainMeta.tabLabel || activeDomainMeta.shortLabel}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setCloudModalOpen(true)}
            aria-label="Status de sincronização na nuvem OmniPrism"
            className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors ${
              cloudSyncState.authenticated
                ? cloudSyncState.offline
                  ? 'border-line bg-card text-muted hover:border-accent'
                  : 'border-accent/45 bg-accent/10 text-ink hover:border-accent'
                : 'border-line bg-card text-muted hover:border-accent hover:text-ink'
            }`}
          >
            {cloudSyncState.syncing ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 animate-spin text-accent" strokeWidth={1.5} />
                <span>Sincronizando...</span>
              </>
            ) : cloudSyncState.authenticated ? (
              cloudSyncState.offline ? (
                <>
                  <WifiOff className="h-3.5 w-3.5 text-muted" strokeWidth={1.5} />
                  <span>Offline (Salvo local)</span>
                </>
              ) : (
                <>
                  <Cloud className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                  <span>Sincronizado Supabase</span>
                </>
              )
            ) : (
              <>
                <CloudOff className="h-3.5 w-3.5 text-subtle" strokeWidth={1.5} />
                <span>Local Offline</span>
              </>
            )}
          </button>
        </header>
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
              className="min-h-[44px] rounded-[4px] border border-accent bg-accent/10 px-3 text-[11px] font-semibold text-accent hover:bg-accent hover:text-accent-ink"
            >
              Salvar Cópia
            </button>
          </div>
        )}
        <main
          id="main-content"
          tabIndex={-1}
          className="px-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:px-6 pt-[max(1rem,env(safe-area-inset-top))] pb-[calc(6rem+env(safe-area-inset-bottom))] focus:outline-none"
        >
          {(storageError?.warning || secondaryStorageWarning) && (
            <div
              role="alert"
              data-testid="storage-quota-alert"
              className="mb-4 flex w-full flex-col gap-2.5 rounded-[4px] border border-accent bg-card p-3 text-xs text-ink sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 flex-1 items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />
                <div className="min-w-0 break-words">
                  <p className="font-semibold">
                    Atenção: Provisório (não salvo no localStorage)
                  </p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
                    {storageError?.warning || secondaryStorageWarning}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={async () => {
                    const primaryRes = retryPersistStorage();
                    const epEvals = await getAllEpisodeEvaluations().catch(() => []);
                    const db = buildCodiceDatabase({
                      items,
                      profile,
                      posts,
                      streak: streakData,
                      readingSessions,
                      collections,
                      episodeEvaluations: epEvals,
                    });
                    const dbRes = persistCodiceDatabase(db);
                    const mirrorOk = saveEmergencyMirror({
                      items,
                      profile,
                      collections,
                      streak: streakData,
                      readingSessions,
                      episodeEvaluations: epEvals,
                    });
                    if (primaryRes.persisted && dbRes.persisted && mirrorOk) {
                      setSecondaryStorageWarning('');
                      showToast({
                        message: 'Catálogo gravado no aparelho com sucesso.',
                        type: 'success',
                      });
                    } else if (!dbRes.persisted) {
                      setSecondaryStorageWarning(dbRes.warning || 'Falha ao gravar cópia relacional.');
                    }
                  }}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[4px] border border-accent bg-accent px-3 text-xs font-semibold text-accent-ink"
                >
                  <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} />
                  <span>Tentar de novo</span>
                </button>
                <button
                  type="button"
                  onClick={handleSaveBackupCopyNow}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[4px] border border-line bg-app px-3 text-xs font-semibold text-ink hover:border-accent"
                >
                  <Download className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                  <span>Baixar cópia (.json)</span>
                </button>
              </div>
            </div>
          )}
          <ErrorBoundary
            key={activeTab}
            screenName={
              {
                home: 'Início',
                stats: 'Métricas',
                add: 'Catalogar',
                list: 'Catálogo',
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
                  themeMode={mode}
                  activeDomain={activeDomain}
                  onSelectDomain={handleSelectDomain}
                  tmdbKey={aiConfig.tmdbKey}
                  geminiKey={geminiKey}
                  backupReminder={backupReminder}
                  onSaveBackupNow={handleSaveBackupCopyNow}
                  onDismissBackupReminder={() => setBackupReminderDismissed(true)}
                  onQuickAdvanceWork={handleQuickAdvanceWork}
                  onUpdateItem={handleUpdateItem}
                  onStartPickedWork={handleStartPickedWork}
                  onSelectItem={handleSelectOrAddFromRecommendation}
                  onAddToWishlist={handleCopyWorkToWishlist}
                  onCatalogFranchiseEntry={handleAddItem}
                  onNavigateList={() => setActiveTab('list')}
                  onNavigateAdd={handleNavigateAdd}
                  onOpenGeminiSettings={() => setGeminiModalOpen(true)}
                  onOpenThemeStudio={() => setThemeModalOpen(true)}
                />
              )}
              {activeTab === 'stats' && (
                <StatsScreen
                  items={items}
                  activeDomain={activeDomain}
                  onSelectDomain={handleSelectDomain}
                  themeMode={mode}
                  readingSessions={readingSessions}
                  streakHistory={history}
                  dailyLogs={dailyLogs}
                  onOpenWrapped={(scopeArg) => {
                    setWrappedScope(scopeArg === 'global' ? 'global' : 'domain');
                    setWrappedOpen(true);
                  }}
                />
              )}
              {activeTab === 'add' && (
                <AddScreen
                  items={items}
                  geminiKey={geminiKey}
                  tmdbKey={aiConfig.tmdbKey}
                  omdbKey={aiConfig.omdbKey}
                  activeDomain={activeDomain}
                  onSelectDomain={handleSelectDomain}
                  themeMode={mode}
                  onAddItem={handleAddItem}
                  onUpdateItem={handleUpdateItem}
                  onSelectExisting={(item) => setSelectedItemId(item.id)}
                  onOpenGeminiSettings={() => setGeminiModalOpen(true)}
                  onOpenImportCatalog={() => setImportCatalogOpen(true)}
                  requestedSearchQuery={requestedAddQuery}
                  onConsumeRequestedSearchQuery={() => setRequestedAddQuery('')}
                />
              )}
              {activeTab === 'list' && (
                <ListScreen
                  items={items}
                  profile={profile}
                  collections={collections}
                  activeDomain={activeDomain}
                  onSelectDomain={handleSelectDomain}
                  themeMode={mode}
                  onCreateCollection={createCollection}
                  onDeleteCollection={deleteCollection}
                  onMoveCollection={moveCollection}
                  onMoveCollectionWork={moveCollectionWork}
                  onBatchUpdateItems={batchUpdateItems}
                  onBatchRemoveItems={handleBatchRemoveWithCloud}
                  onRestoreRemovedItems={handleRestoreRemovedWithCloud}
                  onStartPickedWork={handleStartPickedWork}
                  onSelectItem={(item) => setSelectedItemId(item.id)}
                  onOpenCommandPalette={() => setPaletteOpen(true)}
                  onNavigateAdd={handleNavigateAdd}
                  requestedCollectionId={requestedCollectionId}
                  onConsumeRequestedCollection={() => setRequestedCollectionId(null)}
                  requestedCreatorQuery={requestedCreatorQuery}
                  onConsumeRequestedCreatorQuery={() => setRequestedCreatorQuery('')}
                  tmdbKey={aiConfig.tmdbKey}
                  onAddItem={handleAddItem}
                />
              )}
              {activeTab === 'profile' && (
                <ProfileScreen
                  items={items}
                  profile={profile}
                  posts={posts}
                  readingSessions={readingSessions}
                  streakCount={streakCount}
                  themeMode={mode}
                  activeDomain={activeDomain}
                  onSelectDomain={handleSelectDomain}
                  geminiKey={geminiKey}
                  hasGeminiKey={aiConfig.hasAnyAiKey || hasGeminiKey}
                  aiConfig={aiConfig}
                  backupReminder={backupReminder}
                  onSaveBackupNow={handleSaveBackupCopyNow}
                  onDismissBackupReminder={() => setBackupReminderDismissed(true)}
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
                    bgTintColor,
                    font,
                    texture,
                    density,
                    motion,
                    fontScale,
                    dyslexiaSpacing,
                    bgColor,
                    accentColor,
                    hasCustomBg,
                    onSelectMode: setMode,
                    onChangeBgTintColor: setBgTintColor,
                    onSelectFont: setFont,
                    onSelectTexture: setTexture,
                    onSelectDensity: setDensity,
                    onSelectMotion: setMotion,
                    onSelectFontScale: setFontScale,
                    onToggleDyslexia: setDyslexiaSpacing,
                    onChangeBgColor: setCustomBgColor,
                    onChangeAccentColor: setCustomAccentColor,
                    onResetTheme: resetCustomColors,
                  }}
                  onUpdateProfile={(updates) =>
                    handleUpdateProfileWithSync(updates, 'Perfil atualizado')
                  }
                  onUpdateItem={handleUpdateItem}
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
                  cloudState={cloudSyncState}
                  onOpenCloudModal={() => setCloudModalOpen(true)}
                />
              )}
            </Suspense>
          </ErrorBoundary>
        </main>

        <BottomNav
          activeTab={activeTab}
          onChangeTab={setActiveTab}
        />

        <Suspense fallback={null}>
          {Boolean(selectedItem) && (
            <WorkDetailPage
              key={selectedItem.id}
              item={selectedItem}
              allItems={items}
              profile={profile}
              posts={posts}
              collections={collections}
              geminiKey={geminiKey}
              tmdbKey={aiConfig.tmdbKey}
              omdbKey={aiConfig.omdbKey}
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
              onFilterByCreator={(creatorName) => {
                setSelectedItemId(null);
                setRequestedCreatorQuery(String(creatorName || '').trim());
                setActiveTab('list');
              }}
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
              onChangeAccentColor={setCustomAccentColor}
              onSaveGeminiKey={saveApiKey}
              onImportBackup={handleImportBackup}
              onComplete={(updates) => {
                handleUpdateProfileWithSync(updates, 'Perfil salvo');
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

          {themeModalOpen && (
            <ThemeModal
              isOpen={themeModalOpen}
              onClose={() => setThemeModalOpen(false)}
              mode={mode}
              bgTintColor={bgTintColor}
              font={font}
              texture={texture}
              density={density}
              motion={motion}
              bgColor={bgColor}
              accentColor={accentColor}
              hasCustomBg={hasCustomBg}
              onSelectMode={setMode}
              onChangeBgTintColor={setBgTintColor}
              onSelectFont={setFont}
              onSelectTexture={setTexture}
              onSelectDensity={setDensity}
              onSelectMotion={setMotion}
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
                setMode(mode === 'dark' ? 'sepia' : 'dark');
              }}
            />
          )}

          {globalRouletteOpen && (
            <OfflineBookPickerModal
              isOpen={globalRouletteOpen}
              onClose={() => setGlobalRouletteOpen(false)}
              items={items}
              domain={activeDomain}
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
                  message: `${inserted.length} obra(s) importada(s) para o catálogo.`,
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
              activeDomain={activeDomain}
              scope={wrappedScope}
            />
          )}

          {aboutCreditsOpen && (
            <AboutCreditsModal
              isOpen={aboutCreditsOpen}
              onClose={() => setAboutCreditsOpen(false)}
            />
          )}

          {cloudModalOpen && (
            <OmniCloudModal
              isOpen={cloudModalOpen}
              onClose={() => setCloudModalOpen(false)}
              cloudState={cloudSyncState}
              worksCount={items.length}
              onSignIn={handleCloudSignIn}
              onSignOut={handleCloudSignOut}
              onSyncNow={() =>
                runCloudSyncNow({ localWorksOverride: itemsRef.current, silent: false })
              }
              onConfigChanged={handleCloudConfigChanged}
            />
          )}

          {perfDebugEnabled && <PerfOverlay />}
        </Suspense>

        <PwaUpdateBanner
          visible={pwaUpdateAvailable}
          onUpdate={() => {
            setPwaUpdateAvailable(false);
            window.__codiceApplySwUpdate?.();
          }}
          onDismiss={() => setPwaUpdateAvailable(false)}
        />
      </div>
    </div>
  );
}

export default App;
