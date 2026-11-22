import {
  Check,
  Cloud,
  Cpu,
  Database,
  Feather,
  FileSpreadsheet,
  FileText,
  Film,
  Globe,
  HardDrive,
  Info,
  Keyboard,
  Lock,
  MessageSquare,
  MessagesSquare,
  Palette,
  PenLine,
  Plus,
  RotateCcw,
  Settings,
  Shield,
  SlidersHorizontal,
  Upload,
  Users,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { domainConfig } from '../config/domainConfig';
import { SOCIAL_ENABLED } from '../config/flags';
import { CODICE_RELEASE } from '../config/versioning';
import { THEME_MODES } from '../data/themePresets';
import { FONT_SCALE_OPTIONS } from '../design/themeEngine';
import {
  getConfiguredGoogleClientId,
  setConfiguredGoogleClientId,
} from '../services/googleDriveBackup';
import { InstallAppBanner } from './InstallAppBanner';
import {
  DNA_DENSITY_OPTIONS,
  DNA_DIMENSIONS,
  DNA_EXCLUSION_PRESETS,
  DNA_PACING_OPTIONS,
  createDefaultReaderDna,
  normalizeReaderDna,
} from '../services/dnaScoring';
import {
  CRITERION_OPTIONS,
  FOCUS_OPTIONS_META,
  getOrderedGenreGroups,
  getStructuredGenresByGroup,
  normalizeFavoriteGenreObjects,
  normalizePreferredCriteria,
  normalizeViewerFocusList,
  toggleCriterionInList,
  toggleStructuredGenre,
  toggleViewerFocusInList,
} from '../utils/readerPreferences';

export const SETTINGS_TABS = [
  { id: 'appearance', hash: '#settings-appearance', label: 'Aparência', icon: Palette },
  { id: 'dna', hash: '#settings-dna', label: 'DNA Espectador', icon: SlidersHorizontal },
  {
    id: 'privacy',
    hash: '#settings-privacy',
    label: SOCIAL_ENABLED ? 'Privacidade' : 'Modo Calmo',
    icon: Shield,
  },
  { id: 'data', hash: '#settings-data', label: 'Dados & APIs', icon: Database },
];

const VISIBILITY_OPTIONS = [
  {
    id: 'public',
    label: 'Público',
    description: 'Qualquer espectador no Cine Códice pode ver seu perfil e catálogo.',
    icon: Globe,
  },
  {
    id: 'followers',
    label: 'Apenas Seguidores',
    description: 'Somente quem segue você acompanha suas atividades.',
    icon: Users,
  },
  {
    id: 'private',
    label: 'Privado',
    description: 'Arquivo pessoal reservado apenas para você.',
    icon: Lock,
  },
];

function resolveTabFromHash(rawHash = '') {
  const clean = String(rawHash || '').trim().toLowerCase();
  const matched = SETTINGS_TABS.find((t) => t.hash === clean);
  return matched ? matched.id : 'appearance';
}

function PrivacySwitchRow({ icon: Icon, label, description, checked, onToggle }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onToggle}
      className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-[4px] border border-line bg-app px-3 py-2.5 text-left transition-colors hover:border-accent/50"
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />
        <div className="min-w-0">
          <span className="block text-xs font-medium text-ink">{label}</span>
          {description && (
            <span className="mt-0.5 block text-[11px] leading-snug text-muted">
              {description}
            </span>
          )}
        </div>
      </div>

      <span
        aria-hidden="true"
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors ${
          checked ? 'border-accent bg-accent' : 'border-line bg-elevated'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full transition-transform ${
            checked ? 'translate-x-5.5 bg-accent-ink' : 'translate-x-1 bg-subtle'
          }`}
        />
      </span>
    </button>
  );
}

export function ProfileSettingsDrawer({
  isOpen,
  onClose,
  returnFocusRef,
  profile,
  backendSession = null,
  soundOn = false,
  onToggleSound,
  onOpenAuthModal,
  onUpdateProfile,
  onOpenThemeStudio,
  themeProps = null,
  onReopenOnboarding,
  onOpenGeminiSettings,
  onExportBackup,
  onExportCsv,
  onExportMarkdown,
  onExportBibtex,
  onImportBackupClick,
  onOpenBackupModal,
  onOpenImportCatalog,
  onOpenShortcuts,
  onOpenAboutCredits,
  aiPanelSlot = null,
}) {
  const drawerRef = useRef(null);
  const closeBtnRef = useRef(null);
  const tabRefs = useRef([]);
  const [activeTab, setActiveTab] = useState(() =>
    typeof window !== 'undefined' ? resolveTabFromHash(window.location.hash) : 'appearance'
  );
  const [exclusionInput, setExclusionInput] = useState('');
  const [googleClientIdInput, setGoogleClientIdInput] = useState(() =>
    getConfiguredGoogleClientId()
  );
  const { ui } = domainConfig;
  const { profile: profileCfg } = ui;

  const isSupabaseMode = backendSession?.mode === 'supabase';
  const gamificationEnabled = profile?.gamificationEnabled !== false;
  const privacyLevel = profile?.privacyLevel || 'public';
  const activeVisibilityMeta =
    VISIBILITY_OPTIONS.find((opt) => opt.id === privacyLevel) ||
    VISIBILITY_OPTIONS[0];
  const selectedCriteria = normalizePreferredCriteria(
    profile?.preferredCriteria ?? profile?.preferred_criteria,
    profile?.preferredCriterion ?? profile?.preferred_criterion
  );
  const selectedGenreObjects = normalizeFavoriteGenreObjects(
    profile?.favoriteGenres ?? profile?.favorite_genres
  );
  const selectedGenreIds = new Set(selectedGenreObjects.map((g) => g.id));
  const selectedFocusList = normalizeViewerFocusList(
    profile?.viewerFocus ?? profile?.viewer_focus,
    profile?.readerFocus ?? profile?.reader_focus
  );
  const orderedGenreGroups = getOrderedGenreGroups(selectedFocusList);
  const outrosGenreObjects = selectedGenreObjects.filter((g) => g.group === 'outros');
  const readerDna = normalizeReaderDna(profile?.readerDna ?? profile?.reader_dna);

  const selectTab = (tabId) => {
    setActiveTab(tabId);
    const meta = SETTINGS_TABS.find((t) => t.id === tabId);
    if (meta && typeof window !== 'undefined' && typeof window.history?.replaceState === 'function') {
      const nextUrl = `${window.location.pathname}${window.location.search || ''}${meta.hash}`;
      window.history.replaceState(null, '', nextUrl);
    }
  };

  const handleTabKeyDown = (e, idx) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    const nextIdx = (idx + dir + SETTINGS_TABS.length) % SETTINGS_TABS.length;
    selectTab(SETTINGS_TABS[nextIdx].id);
    tabRefs.current[nextIdx]?.focus();
  };

  const handleToggleCriterion = (criterion) => {
    const next = toggleCriterionInList(selectedCriteria, criterion);
    onUpdateProfile?.({
      preferredCriteria: next,
      preferredCriterion: next.join(', '),
    });
  };

  const handleToggleFocus = (focusId) => {
    const nextFocus = toggleViewerFocusInList(selectedFocusList, focusId, {
      allowEmpty: false,
    });
    onUpdateProfile?.({
      viewerFocus: nextFocus,
      readerFocus: nextFocus[0] || 'Cinéfilo Curador',
    });
  };

  const handleToggleGenre = (entry) => {
    const next = toggleStructuredGenre(selectedGenreObjects, entry);
    onUpdateProfile?.({ favoriteGenres: next });
  };

  const updateDna = (patch) => {
    const nextDna = normalizeReaderDna({
      ...readerDna,
      ...patch,
      weights: {
        ...readerDna.weights,
        ...(patch.weights || {}),
      },
    });
    onUpdateProfile?.({ readerDna: nextDna });
  };

  const toggleExclusionTerm = (term) => {
    const clean = String(term || '').trim();
    if (!clean) return;
    const exists = readerDna.exclusions.some(
      (e) => e.toLowerCase() === clean.toLowerCase()
    );
    const nextExclusions = exists
      ? readerDna.exclusions.filter((e) => e.toLowerCase() !== clean.toLowerCase())
      : [...readerDna.exclusions, clean];
    updateDna({ exclusions: nextExclusions });
  };

  const handleAddExclusionSubmit = (e) => {
    e.preventDefault();
    const clean = exclusionInput.trim();
    if (!clean) return;
    if (!readerDna.exclusions.some((item) => item.toLowerCase() === clean.toLowerCase())) {
      updateDna({ exclusions: [...readerDna.exclusions, clean] });
    }
    setExclusionInput('');
  };

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return undefined;
    if (window.location.hash) {
      setActiveTab(resolveTabFromHash(window.location.hash));
    }
    const onHashChange = () => {
      if (window.location.hash.startsWith('#settings-')) {
        setActiveTab(resolveTabFromHash(window.location.hash));
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const prevFocused = returnFocusRef?.current || document.activeElement;
    closeBtnRef.current?.focus();

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose?.();
        return;
      }
      if (e.key === 'Tab' && drawerRef.current) {
        const focusables = drawerRef.current.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (prevFocused && typeof prevFocused.focus === 'function') {
        prevFocused.focus();
      }
    };
  }, [isOpen, onClose, returnFocusRef]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/60"
      onClick={onClose}
    >
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Configurações do Perfil e Sistema"
        onClick={(e) => e.stopPropagation()}
        className="flex h-[100dvh] w-full max-w-md flex-col border-l border-line bg-card text-ink pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
      >
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-accent" strokeWidth={1.5} />
            <h2 className="text-sm font-semibold tracking-tight text-ink">
              Configurações
            </h2>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="Fechar configurações"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[4px] border border-line text-muted hover:text-ink"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>

        {/* 4 Abas Fixas no Topo sincronizadas com hash */}
        <div
          role="tablist"
          aria-label="Seções de configurações"
          className="grid shrink-0 grid-cols-4 border-b border-line bg-app"
        >
          {SETTINGS_TABS.map((tab, idx) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                ref={(el) => {
                  tabRefs.current[idx] = el;
                }}
                type="button"
                role="tab"
                id={`settings-tab-${tab.id}`}
                aria-selected={active}
                aria-controls={`settings-panel-${tab.id}`}
                tabIndex={active ? 0 : -1}
                onClick={() => selectTab(tab.id)}
                onKeyDown={(e) => handleTabKeyDown(e, idx)}
                className={`flex min-h-[46px] flex-col items-center justify-center gap-0.5 border-b-2 px-1 py-1.5 text-[10px] font-medium transition-colors ${
                  active
                    ? 'border-accent bg-card text-ink'
                    : 'border-transparent text-muted hover:text-ink'
                }`}
              >
                <Icon
                  className={`h-3.5 w-3.5 ${active ? 'text-accent' : 'text-subtle'}`}
                  strokeWidth={1.5}
                />
                <span className="truncate">{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar">
          {/* ABA 1: APARENCIA */}
          {activeTab === 'appearance' && (
            <div
              role="tabpanel"
              id="settings-panel-appearance"
              aria-labelledby="settings-tab-appearance"
              className="space-y-4 p-4"
            >
              <button
                type="button"
                aria-label="Temas & Aparência"
                onClick={() => {
                  onClose?.();
                  onOpenThemeStudio?.();
                }}
                className="flex min-h-[48px] w-full items-center justify-between gap-2 rounded-[4px] border border-accent/45 bg-accent/10 px-3 py-2.5 text-left text-xs font-semibold text-ink hover:bg-accent/15"
              >
                <span className="inline-flex items-center gap-2">
                  <Palette className="h-4 w-4 text-accent" strokeWidth={1.5} />
                  <span>
                    Temas &amp; Aparência
                    {themeProps?.mode && (
                      <span className="ml-1.5 text-[10px] font-normal text-subtle">
                        (
                        {THEME_MODES.find(
                          (item) => item.id === themeProps.mode
                        )?.shortLabel || themeProps.mode}
                        )
                      </span>
                    )}
                  </span>
                </span>
                <span className="text-[11px] font-medium text-accent">Abrir estúdio</span>
              </button>

              {themeProps && (
                <div className="space-y-2 rounded-[4px] border border-line bg-app p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-ink">
                      Tamanho global da fonte
                    </span>
                    <div className="inline-flex rounded-[4px] border border-line bg-card p-0.5">
                      {FONT_SCALE_OPTIONS.map((opt) => {
                        const active = (themeProps.fontScale || 'normal') === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            aria-pressed={active}
                            onClick={() => themeProps.onSelectFontScale?.(opt.id)}
                            className={`min-h-[34px] rounded-[2px] px-2.5 text-[11px] font-medium transition-colors ${
                              active ? 'bg-accent text-accent-ink' : 'text-muted hover:text-ink'
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <PrivacySwitchRow
                    icon={Feather}
                    label="Espaçamento para Dislexia"
                    description="Amplia distância entre letras, palavras e entrelinhas na interface."
                    checked={Boolean(themeProps.dyslexiaSpacing)}
                    onToggle={() =>
                      themeProps.onToggleDyslexia?.(!themeProps.dyslexiaSpacing)
                    }
                  />
                </div>
              )}

              <div className="divide-y divide-line rounded-[4px] border border-line bg-app">
                <button
                  type="button"
                  onClick={onToggleSound}
                  role="switch"
                  aria-checked={soundOn}
                  className="flex min-h-[44px] w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-ink hover:bg-card"
                >
                  <span className="inline-flex items-center gap-2.5">
                    {soundOn ? (
                      <Volume2 className="h-4 w-4 text-accent" strokeWidth={1.5} />
                    ) : (
                      <VolumeX className="h-4 w-4 text-subtle" strokeWidth={1.5} />
                    )}
                    <span>Efeitos Sonoros Táteis</span>
                  </span>
                  <span className="text-[11px] text-muted">
                    {soundOn ? 'Ativo' : 'Mudo'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClose?.();
                    onReopenOnboarding?.();
                  }}
                  className="flex min-h-[44px] w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-medium text-ink hover:bg-card"
                >
                  <Film className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />
                  <span>Reabrir Boas-Vindas e Tutorial</span>
                </button>
              </div>

              <InstallAppBanner variant="settings" />

              <p className="pt-2 text-center text-[10px] tabular-nums text-subtle">
                Cine Códice {CODICE_RELEASE.label}
              </p>
            </div>
          )}

          {/* ABA 2: DNA DO ESPECTADOR (8 DIMENSOES + PREFERENCIAS) */}
          {activeTab === 'dna' && (
            <div
              role="tabpanel"
              id="settings-panel-dna"
              aria-labelledby="settings-tab-dna"
              className="divide-y divide-line"
            >
              <section className="space-y-3 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-ink">
                      DNA do Espectador (8 Dimensões)
                    </h3>
                    <p className="mt-0.5 text-[11px] text-muted">
                      Ajuste o peso de cada eixo nas suas recomendações locais.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      updateDna({ weights: createDefaultReaderDna().weights })
                    }
                    title="Restaurar pesos neutros"
                    className="inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-[4px] border border-line bg-app px-2 py-1 text-[11px] font-medium text-muted hover:text-ink"
                  >
                    <RotateCcw className="h-3 w-3 text-accent" strokeWidth={1.5} />
                    <span>Neutro</span>
                  </button>
                </div>

                <div className="space-y-2.5">
                  {DNA_DIMENSIONS.map((dim) => {
                    const value = readerDna.weights[dim.id] ?? 50;
                    return (
                      <div
                        key={dim.id}
                        className="rounded-[4px] border border-line bg-app px-3 py-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <label
                            htmlFor={`dna-slider-${dim.id}`}
                            className="text-xs font-medium text-ink"
                          >
                            {dim.label}
                          </label>
                          <span className="text-xs font-semibold tabular-nums text-accent">
                            {value}
                          </span>
                        </div>
                        <input
                          id={`dna-slider-${dim.id}`}
                          type="range"
                          min={0}
                          max={100}
                          step={5}
                          value={value}
                          onChange={(e) =>
                            updateDna({
                              weights: { [dim.id]: Number(e.target.value) },
                            })
                          }
                          aria-label={`${dim.label}: ${value} de 100`}
                          className="mt-1.5 h-2 w-full cursor-pointer accent-[var(--accent-color)]"
                        />
                        <p className="mt-1 text-[10px] text-subtle">{dim.description}</p>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="space-y-3 p-4">
                <div>
                  <p className="mb-1.5 text-[11px] font-medium text-muted">Ritmo Preferido</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {DNA_PACING_OPTIONS.map((opt) => {
                      const active = readerDna.pacingPreference === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() => updateDna({ pacingPreference: opt.id })}
                          className={`min-h-[42px] rounded-[4px] border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                            active
                              ? 'border-accent bg-accent/15 text-ink'
                              : 'border-line bg-app text-muted hover:text-ink'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <p className="mb-1.5 text-[11px] font-medium text-muted">
                    Densidade / Extensão
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {DNA_DENSITY_OPTIONS.map((opt) => {
                      const active = readerDna.densityPreference === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() => updateDna({ densityPreference: opt.id })}
                          className={`min-h-[42px] rounded-[4px] border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                            active
                              ? 'border-accent bg-accent/15 text-ink'
                              : 'border-line bg-app text-muted hover:text-ink'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <p className="mb-1.5 text-[11px] font-medium text-muted">
                    Gatilhos &amp; Exclusões (filtrados das recomendações)
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {DNA_EXCLUSION_PRESETS.map((preset) => {
                      const active = readerDna.exclusions.some(
                        (e) => e.toLowerCase() === preset.toLowerCase()
                      );
                      return (
                        <button
                          key={preset}
                          type="button"
                          aria-pressed={active}
                          onClick={() => toggleExclusionTerm(preset)}
                          className={`min-h-[38px] rounded-[4px] border px-2.5 py-1 text-[11px] font-medium ${
                            active
                              ? 'border-accent bg-accent/15 text-ink'
                              : 'border-line bg-app text-muted hover:text-ink'
                          }`}
                        >
                          {preset}
                        </button>
                      );
                    })}
                  </div>

                  <form onSubmit={handleAddExclusionSubmit} className="mt-2 flex gap-1.5">
                    <input
                      type="text"
                      value={exclusionInput}
                      onChange={(e) => setExclusionInput(e.target.value)}
                      placeholder="Adicionar tema ou gatilho para evitar..."
                      aria-label="Adicionar termo de exclusão"
                      maxLength={48}
                      className="min-h-[42px] min-w-0 flex-1 rounded-[4px] border border-line bg-app px-2.5 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
                    />
                    <button
                      type="submit"
                      aria-label="Adicionar exclusão"
                      className="inline-flex min-h-[42px] min-w-[44px] items-center justify-center rounded-[4px] border border-line bg-app px-3 text-accent hover:border-accent"
                    >
                      <Plus className="h-4 w-4" strokeWidth={1.5} />
                    </button>
                  </form>

                  {readerDna.exclusions.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {readerDna.exclusions.map((term) => (
                        <button
                          key={term}
                          type="button"
                          onClick={() => toggleExclusionTerm(term)}
                          className="inline-flex min-h-[32px] items-center gap-1 rounded-[4px] border border-accent/40 bg-accent/10 px-2 py-0.5 text-[11px] text-ink"
                        >
                          <span>{term}</span>
                          <X className="h-3 w-3 text-accent" strokeWidth={1.5} />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </section>

              <section className="space-y-3.5 p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-ink">
                  Preferências de Sessão &amp; Gêneros
                </h3>
                <div>
                  <div className="mb-1.5 flex items-baseline justify-between gap-2">
                    <p className="text-[11px] font-medium text-muted">
                      Focos de visualização
                    </p>
                    <span
                      className="text-[10px]"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      1 ou mais
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {FOCUS_OPTIONS_META.map((opt) => {
                      const isSelected = selectedFocusList.includes(opt.id);
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => handleToggleFocus(opt.id)}
                          className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-[4px] border px-2.5 py-1.5 text-left text-[11px] font-medium transition-colors ${
                            isSelected
                              ? 'border-accent bg-accent/15 text-ink'
                              : 'border-line bg-app hover:text-ink'
                          }`}
                          style={!isSelected ? { color: 'var(--text-secondary)' } : undefined}
                        >
                          {isSelected && (
                            <Check className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.5} />
                          )}
                          <span>{opt.id}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 flex items-baseline justify-between gap-2">
                    <p className="text-[11px] font-medium text-muted">
                      Critérios que você mais valoriza
                    </p>
                    <span
                      className="text-[10px]"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      1 ou mais
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {CRITERION_OPTIONS.map((criterion) => {
                      const isSelected = selectedCriteria.includes(criterion);
                      return (
                        <button
                          key={criterion}
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => handleToggleCriterion(criterion)}
                          className={`flex min-h-[44px] items-center gap-1.5 rounded-[4px] border px-2.5 py-1.5 text-left text-[11px] font-medium transition-colors ${
                            isSelected
                              ? 'border-accent bg-accent/15 text-ink'
                              : 'border-line bg-app hover:text-ink'
                          }`}
                          style={!isSelected ? { color: 'var(--text-secondary)' } : undefined}
                        >
                          {isSelected && (
                            <Check className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.5} />
                          )}
                          <span className="leading-snug">{criterion}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-3">
                  <p className="text-[11px] font-medium tabular-nums text-muted">
                    Gêneros Favoritos ({selectedGenreObjects.length})
                  </p>
                  {orderedGenreGroups.map((group) => {
                    const { genres, tags } = getStructuredGenresByGroup(group.id);
                    return (
                      <div key={group.id} className="space-y-1.5 rounded-[4px] border border-line bg-app p-2.5">
                        <p className="text-[11px] font-semibold text-ink">{group.label}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {genres.map((entry) => {
                            const isSelected = selectedGenreIds.has(entry.id);
                            return (
                              <button
                                key={entry.id}
                                type="button"
                                aria-pressed={isSelected}
                                onClick={() => handleToggleGenre(entry)}
                                className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-[4px] border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                                  isSelected
                                    ? 'border-accent bg-accent/15 text-ink'
                                    : 'border-line bg-card hover:text-ink'
                                }`}
                                style={!isSelected ? { color: 'var(--text-secondary)' } : undefined}
                              >
                                {isSelected && (
                                  <Check className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.5} />
                                )}
                                <span>{entry.label}</span>
                              </button>
                            );
                          })}
                        </div>
                        {tags.length > 0 && (
                          <div className="space-y-1 pt-1.5 border-t border-line/60">
                            <p className="text-[10px] font-medium uppercase tracking-wider text-subtle">
                              Tags de Anime (Demografias &amp; Temas)
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {tags.map((entry) => {
                                const isSelected = selectedGenreIds.has(entry.id);
                                return (
                                  <button
                                    key={entry.id}
                                    type="button"
                                    aria-pressed={isSelected}
                                    onClick={() => handleToggleGenre(entry)}
                                    className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-[4px] border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                                      isSelected
                                        ? 'border-accent bg-accent/15 text-ink'
                                        : 'border-line bg-card hover:text-ink'
                                    }`}
                                    style={!isSelected ? { color: 'var(--text-secondary)' } : undefined}
                                  >
                                    {isSelected && (
                                      <Check className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.5} />
                                    )}
                                    <span>{entry.label}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {outrosGenreObjects.length > 0 && (
                    <div className="space-y-1.5 rounded-[4px] border border-dashed border-line bg-app p-2.5">
                      <p className="text-[11px] font-semibold text-muted">
                        Outros (preservados do perfil anterior)
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {outrosGenreObjects.map((entry) => (
                          <button
                            key={entry.id}
                            type="button"
                            aria-pressed={true}
                            onClick={() => handleToggleGenre(entry)}
                            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[4px] border border-accent bg-accent/15 px-2.5 py-1.5 text-[11px] font-medium text-ink"
                          >
                            <Check className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.5} />
                            <span>{entry.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}

          {/* ABA 3: EXPERIÊNCIA & CONTA */}
          {activeTab === 'privacy' && (
            <div
              role="tabpanel"
              id="settings-panel-privacy"
              aria-labelledby="settings-tab-privacy"
              className="divide-y divide-line"
            >
              {SOCIAL_ENABLED && (
                <section className="space-y-2.5 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      {isSupabaseMode ? (
                        <Cloud className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />
                      ) : (
                        <HardDrive className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />
                      )}
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-ink">
                        Sincronização em Tempo Real (Avançado)
                      </h3>
                    </div>
                    <span className="rounded-[4px] border border-line bg-app px-2 py-0.5 text-[10px] font-medium text-accent">
                      {isSupabaseMode ? 'Supabase Ativo' : 'Local / Sem Servidor'}
                    </span>
                  </div>

                  <p className="text-[11px] leading-relaxed text-muted">
                    {isSupabaseMode
                      ? 'Sincronização automática em tempo real e rede na nuvem ativas entre dispositivos.'
                      : 'Seus filmes, séries e animes ficam protegidos no aparelho e você já pode trocar perfis por Link ou QR Code sem conta. Conecte o Supabase apenas se quiser sincronização automática em tempo real.'}
                  </p>

                  <button
                    type="button"
                    onClick={() => {
                      onClose?.();
                      onOpenAuthModal?.();
                    }}
                    className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[4px] border border-line bg-app px-3 py-2 text-xs font-medium text-ink transition-colors hover:border-accent hover:text-accent"
                  >
                    {isSupabaseMode ? (
                      <>
                        <Cloud className="h-4 w-4 text-accent" strokeWidth={1.5} />
                        <span>Gerenciar Sincronização Supabase</span>
                      </>
                    ) : (
                      <>
                        <Users className="h-4 w-4 text-accent" strokeWidth={1.5} />
                        <span>Perfis Locais / Sincronização Supabase</span>
                      </>
                    )}
                  </button>
                </section>
              )}

              <section className="space-y-3 p-4">
                {SOCIAL_ENABLED && (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink">
                        <Shield className="h-4 w-4 text-accent" strokeWidth={1.5} />
                        <span>Privacidade &amp; Gamificação</span>
                      </span>
                      <span className="text-[11px] text-muted">
                        {activeVisibilityMeta.label}
                      </span>
                    </div>

                    <div
                      role="radiogroup"
                      aria-label="Visibilidade do perfil"
                      className="grid grid-cols-3 gap-1.5"
                    >
                      {VISIBILITY_OPTIONS.map((option) => {
                        const Icon = option.icon;
                        const isSelected = privacyLevel === option.id;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            role="radio"
                            aria-checked={isSelected}
                            onClick={() => onUpdateProfile?.({ privacyLevel: option.id })}
                            className={`flex min-h-[44px] items-center justify-center gap-1.5 rounded-[4px] border px-2 py-2 text-[11px] font-medium transition-colors ${
                              isSelected
                                ? 'border-accent bg-accent/15 text-ink'
                                : 'border-line bg-app text-muted hover:text-ink'
                            }`}
                          >
                            <Icon
                              className={`h-3.5 w-3.5 shrink-0 ${
                                isSelected ? 'text-accent' : 'text-subtle'
                              }`}
                              strokeWidth={1.5}
                            />
                            <span className="truncate">{option.label}</span>
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[11px] text-subtle">
                      {activeVisibilityMeta.description}
                    </p>
                  </>
                )}

                <div className="space-y-2">
                  {SOCIAL_ENABLED && (
                    <>
                      <PrivacySwitchRow
                        icon={PenLine}
                        label="Permitir recados no mural"
                        description="Outros espectadores podem deixar mensagens públicas no seu perfil."
                        checked={profile?.allowWallPosts !== false}
                        onToggle={() =>
                          onUpdateProfile?.({
                            allowWallPosts: !(profile?.allowWallPosts !== false),
                          })
                        }
                      />
                      <PrivacySwitchRow
                        icon={MessageSquare}
                        label="Permitir comentários"
                        description="Habilita comentários nas suas notas e mural."
                        checked={profile?.allowComments !== false}
                        onToggle={() =>
                          onUpdateProfile?.({
                            allowComments: !(profile?.allowComments !== false),
                          })
                        }
                      />
                      <PrivacySwitchRow
                        icon={MessagesSquare}
                        label="Receber mensagens no chat"
                        description="Permite iniciar conversas diretas com você."
                        checked={profile?.allowDms !== false}
                        onToggle={() =>
                          onUpdateProfile?.({
                            allowDms: !(profile?.allowDms !== false),
                          })
                        }
                      />
                    </>
                  )}
                  <PrivacySwitchRow
                    icon={Zap}
                    label="Ativar Gamificação (XP, Níveis e Insígnias)"
                    description="Exibe horas assistidas, sequência e patente do catálogo."
                    checked={gamificationEnabled}
                    onToggle={() =>
                      onUpdateProfile?.({
                        gamificationEnabled: !gamificationEnabled,
                      })
                    }
                  />
                  <PrivacySwitchRow
                    icon={Feather}
                    label="Modo Calmo (Sem Contadores)"
                    description="Oculta streaks, XP, metas numéricas e insígnias para assistir no seu ritmo."
                    checked={Boolean(profile?.calmMode)}
                    onToggle={() =>
                      onUpdateProfile?.({
                        calmMode: !profile?.calmMode,
                      })
                    }
                  />
                </div>
              </section>
            </div>
          )}

          {/* ABA 4: DADOS & IA */}
          {activeTab === 'data' && (
            <div
              role="tabpanel"
              id="settings-panel-data"
              aria-labelledby="settings-tab-data"
              className="divide-y divide-line"
            >
              <section className="space-y-2 p-4">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-accent" strokeWidth={1.5} />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-ink">
                    Backup, Criptografia (.ccodex) &amp; Nuvem
                  </h3>
                </div>
                <div className="space-y-2 rounded-[4px] border border-line bg-app p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink">
                      <Cloud className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                      <span>Google Drive Pessoal (drive.appdata)</span>
                    </span>
                    <span className="text-[10px] text-muted">Client-Side OAuth</span>
                  </div>
                  <input
                    type="text"
                    value={googleClientIdInput}
                    onChange={(e) => {
                      setGoogleClientIdInput(e.target.value);
                      setConfiguredGoogleClientId(e.target.value);
                    }}
                    placeholder="VITE_GOOGLE_CLIENT_ID (ex: 12345.apps.googleusercontent.com)"
                    aria-label="Google Client ID para backup no Google Drive"
                    className="min-h-[38px] w-full rounded-[4px] border border-line bg-card px-2.5 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      onClose?.();
                      onOpenBackupModal?.();
                    }}
                    className="flex min-h-[40px] w-full items-center justify-center gap-2 rounded-[4px] border border-accent bg-accent/15 px-3 py-2 text-xs font-semibold text-accent hover:bg-accent/25"
                  >
                    <Cloud className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                    <span>Abrir Backup .ccodex (GZIP + AES-GCM) &amp; Google Drive</span>
                  </button>
                </div>
                <div className="divide-y divide-line rounded-[4px] border border-line bg-app">
                  <button
                    type="button"
                    onClick={() => {
                      onExportBackup?.();
                      onClose?.();
                    }}
                    className="flex min-h-[44px] w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-medium text-ink hover:bg-card"
                  >
                    <Database className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />
                    <span>{profileCfg.backup.exportLabel}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onExportCsv?.();
                      onClose?.();
                    }}
                    className="flex min-h-[44px] w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-medium text-ink hover:bg-card"
                  >
                    <FileSpreadsheet className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />
                    <span>{profileCfg.backup.exportCsvLabel}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      (onExportMarkdown || onExportBibtex)?.();
                      onClose?.();
                    }}
                    className="flex min-h-[44px] w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-medium text-ink hover:bg-card"
                  >
                    <FileText className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />
                    <span>Exportar Catálogo Markdown (.md)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onClose?.();
                      if (onOpenBackupModal) {
                        onOpenBackupModal();
                      } else {
                        onImportBackupClick?.();
                      }
                    }}
                    className="flex min-h-[44px] w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-medium text-ink hover:bg-card"
                  >
                    <Upload className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />
                    <span>
                      {onOpenBackupModal
                        ? 'Restaurar Backup e Snapshots'
                        : profileCfg.backup.importLabel}
                    </span>
                  </button>
                  {onOpenImportCatalog && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose?.();
                        onOpenImportCatalog();
                      }}
                      className="flex min-h-[44px] w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-medium text-ink hover:bg-card"
                    >
                      <FileSpreadsheet className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />
                      <span>Importar CSV (Letterboxd / IMDb / MAL / Lista)</span>
                    </button>
                  )}
                  {onOpenShortcuts && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose?.();
                        onOpenShortcuts();
                      }}
                      className="flex min-h-[44px] w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-medium text-ink hover:bg-card"
                    >
                      <Keyboard className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />
                      <span>Atalhos de Teclado (?)</span>
                    </button>
                  )}
                  {onOpenAboutCredits && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose?.();
                        onOpenAboutCredits();
                      }}
                      className="flex min-h-[44px] w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-medium text-ink hover:bg-card"
                    >
                      <Info className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />
                      <span>Sobre, Créditos &amp; Fontes (TMDB, OMDb, AniList...)</span>
                    </button>
                  )}
                </div>
              </section>

              <section className="space-y-2.5 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink">
                    <Cpu className="h-4 w-4 text-accent" strokeWidth={1.5} />
                    <span>Chaves de API (TMDB, OMDb &amp; IA)</span>
                  </span>
                  {onOpenGeminiSettings && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose?.();
                        onOpenGeminiSettings();
                      }}
                      className="min-h-[36px] text-[11px] font-medium text-accent hover:underline"
                    >
                      Abrir em modal
                    </button>
                  )}
                </div>
                {aiPanelSlot}
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
