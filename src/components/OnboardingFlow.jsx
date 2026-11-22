import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  CheckCircle2,
  Clapperboard,
  Compass,
  Disc,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Film,
  KeyRound,
  MonitorPlay,
  Moon,
  Palette,
  Play,
  Quote,
  Sparkles,
  Sun,
  Target,
  Tv,
  Upload,
  User,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { domainConfig } from '../config/domainConfig';
import {
  CRITERION_OPTIONS,
  GENRE_OPTIONS,
  normalizeFavoriteGenres,
  normalizePreferredCriteria,
  toggleCriterionInList,
} from '../utils/readerPreferences';

const FOCUS_OPTIONS = [
  { id: 'Cinéfilo Curador', icon: Film },
  { id: 'Maratonista de Séries', icon: Tv },
  { id: 'Curador de Animes', icon: Clapperboard },
  { id: 'Pesquisador de Cinema', icon: Compass },
  { id: 'Espectador Casual', icon: Play },
];

const GOAL_PRESETS = [12, 24, 52, 100];

const FORMAT_OPTIONS = [
  { id: 'Streaming', icon: MonitorPlay },
  { id: 'Cinema', icon: Film },
  { id: 'Blu-ray / 4K', icon: Disc },
  { id: 'VHS / DVD', icon: Tv },
];

const ATMOSPHERE_OPTIONS = [
  { id: 'Película Clara', mode: 'parchment', bg: '#FAF8F5', accent: '#8B5CF6', icon: Sun },
  { id: 'Sala Noturna', mode: 'night_library', bg: '#121316', accent: '#8B5CF6', icon: Moon },
  { id: 'Cinema OLED', mode: 'oled', bg: '#000000', accent: '#8B5CF6', icon: Sparkles },
  { id: 'Cabine Noir', preset: 'dark-academia', bg: '#161310', accent: '#C89B54', icon: Palette },
];

const TUTORIAL_AREAS = [
  {
    title: 'Busca Multi-Fonte Sem Travas',
    desc: 'Consulte AniList, MAL, TVmaze, TMDB, IMDb, Wikidata e Internet Archive ao mesmo tempo com pôster HD e episódios.',
    icon: Clapperboard,
  },
  {
    title: 'Minutagem, Episódios & Sagas',
    desc: 'Marque 01:14:20 nos filmes, grade de episódios com fillers e arcos nas séries/animes e linha do tempo de franquias.',
    icon: Film,
  },
  {
    title: 'Bilhetes de Cinema 1080x1350',
    desc: 'Salve diálogos marcantes com minutagem e gere cartões editoriais e Cine Wrapped PNG com seu tema.',
    icon: Quote,
  },
  {
    title: '6 Temas Reais & DNA do Espectador',
    desc: 'Escolha entre Pastel Glass, XP, Aero, Manga Ink ou Modo Foco e calibre os 8 eixos do seu gosto cinematográfico.',
    icon: Palette,
  },
  {
    title: 'Roleta por Tempo & Curador IA',
    desc: 'Filtre o que assistir em 25 min, 50 min ou 2h+ cruzando com o DNA ou pergunte ao Curador IA.',
    icon: Compass,
  },
  {
    title: 'Blindagem Tripla & Compartilhamento',
    desc: 'Tudo salvo localmente com backup JSON SHA-256, espelho de emergência, QR Code (?card=) e sincronia opcional.',
    icon: Download,
  },
];

export function OnboardingFlow({
  isOpen,
  canDismiss = false,
  profile,
  geminiKey = '',
  onSelectThemeMode,
  onApplyThemePreset,
  onChangeAccentColor,
  onSaveGeminiKey,
  onImportBackup,
  onComplete,
  onDismiss,
}) {
  const [step, setStep] = useState(1);
  const [displayName, setDisplayName] = useState('');
  const [age, setAge] = useState('');
  const [readerFocus, setReaderFocus] = useState('Cinéfilo Curador');
  const [annualGoal, setAnnualGoal] = useState(24);
  const [preferredFormat, setPreferredFormat] = useState('Streaming');
  const [preferredCriteria, setPreferredCriteria] = useState(['Roteiro & Ritmo']);
  const [preferredAtmosphere, setPreferredAtmosphere] = useState('Cinema OLED');
  const [favoriteGenres, setFavoriteGenres] = useState([]);
  const [draftGeminiKey, setDraftGeminiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [backupError, setBackupError] = useState('');

  const fileInputRef = useRef(null);
  const latestInitRef = useRef({ profile, geminiKey });
  latestInitRef.current = { profile, geminiKey };

  useEffect(() => {
    if (!isOpen) return;
    const { profile: currentProfile, geminiKey: currentKey } =
      latestInitRef.current;

    setStep(1);
    setDisplayName(
      currentProfile?.displayName && currentProfile.displayName !== 'aihkaze'
        ? currentProfile.displayName
        : ''
    );
    setAge(currentProfile?.age ? String(currentProfile.age) : '');
    setReaderFocus(currentProfile?.readerFocus || 'Cinéfilo Curador');
    setAnnualGoal(Number(currentProfile?.annualGoal) || 24);
    setPreferredFormat(currentProfile?.preferredFormat || 'Streaming');
    setPreferredCriteria(
      normalizePreferredCriteria(
        currentProfile?.preferredCriteria ?? currentProfile?.preferred_criteria,
        currentProfile?.preferredCriterion ?? currentProfile?.preferred_criterion
      )
    );
    setPreferredAtmosphere(
      currentProfile?.preferredAtmosphere || 'Cinema OLED'
    );
    setFavoriteGenres(normalizeFavoriteGenres(currentProfile?.favoriteGenres));
    setDraftGeminiKey(currentKey || '');
    setShowKey(false);
    setBackupError('');
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !canDismiss) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onDismiss?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, canDismiss, onDismiss]);

  if (!isOpen) return null;

  const progressPct = (step / 5) * 100;

  const handleSelectAtmosphere = (opt) => {
    setPreferredAtmosphere(opt.id);
    if (opt.preset) {
      onApplyThemePreset?.(opt.preset);
    } else if (opt.mode) {
      onSelectThemeMode?.(opt.mode);
      if (opt.accent) {
        onChangeAccentColor?.(opt.accent);
      }
    }
  };

  const toggleGenre = (genre) => {
    setFavoriteGenres((prev) =>
      prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre]
    );
  };

  const toggleCriterion = (criterion) => {
    setPreferredCriteria((prev) => toggleCriterionInList(prev, criterion));
  };

  const handleRestoreFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBackupError('');

    const result = await onImportBackup?.(file);
    if (result?.ok) {
      onDismiss?.();
    } else {
      setBackupError(result?.error || 'Não foi possível importar o arquivo JSON.');
    }
  };

  const handleSaveKeyAndContinue = () => {
    if (draftGeminiKey.trim()) {
      onSaveGeminiKey?.(draftGeminiKey.trim());
    }
    setStep(5);
  };

  const handleFinish = () => {
    const cleanName = displayName.trim();
    if (draftGeminiKey.trim() && draftGeminiKey.trim() !== geminiKey) {
      onSaveGeminiKey?.(draftGeminiKey.trim());
    }

    onComplete({
      ...(cleanName ? { displayName: cleanName } : {}),
      age: age.trim(),
      readerFocus,
      annualGoal: Math.max(1, Number(annualGoal) || 24),
      preferredFormat,
      preferredCriteria,
      preferredCriterion: preferredCriteria.join(', '),
      preferredAtmosphere,
      favoriteGenres,
      onboardingCompleted: true,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-app text-ink">
      <div className="mx-auto flex h-full w-full max-w-md flex-col sm:border-x sm:border-line/60">
        <header className="px-4 pt-4 pb-3 border-b border-line">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2 min-w-0">
              <Film className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />
              <span className="text-xs font-semibold tracking-tight text-ink">
                {domainConfig.appName}
              </span>
              <span className="hidden sm:inline text-[11px] text-subtle truncate">
                {domainConfig.signature}
              </span>
              <span className="rounded-full border border-line bg-card px-2 py-0.5 text-[10px] font-medium tabular-nums text-muted">
                Etapa {step}/5
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              {step < 5 && (
                <button
                  type="button"
                  onClick={() => setStep((prev) => Math.min(5, prev + 1))}
                  className="rounded-lg px-2 py-1 text-[11px] font-medium text-muted hover:text-ink"
                >
                  Pular etapa
                </button>
              )}
              {canDismiss && (
                <button
                  type="button"
                  onClick={onDismiss}
                  aria-label="Fechar tutorial"
                  className="rounded-full p-1 text-muted hover:bg-card hover:text-ink"
                >
                  <X className="h-4 w-4" strokeWidth={1.5} />
                </button>
              )}
            </div>
          </div>

          <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-accent transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-5 no-scrollbar">
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-accent/30 bg-accent/15 text-accent">
                  <User className="h-5 w-5" strokeWidth={1.5} />
                </div>
                <h1 className="mt-3 text-lg font-semibold tracking-tight text-ink">
                  Bem-vindo à sua Cinemateca Física Curada
                </h1>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  Organize filmes, séries e animes 100% no seu aparelho com controle de minutagem, episódios, franquias e backup portátil em JSON.
                </p>
              </div>

              <div className="space-y-3">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-muted">
                    Como prefere ser chamado?
                  </span>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Seu nome ou apelido na cabine"
                    className="w-full rounded-2xl border border-line bg-card px-3.5 py-3 text-sm text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
                  />
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-muted">
                    Idade (opcional)
                  </span>
                  <input
                    type="number"
                    min="1"
                    max="120"
                    value={age}
                    onChange={(e) => setAge(e.target.value)}
                    placeholder="Ex: 24"
                    className="w-full rounded-2xl border border-line bg-card px-3.5 py-3 text-sm text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
                  />
                </label>
              </div>

              <div className="rounded-2xl border border-dashed border-line bg-card p-3.5">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex min-h-[44px] w-full items-center justify-center gap-2 text-xs font-medium text-muted transition-colors hover:text-accent"
                >
                  <Upload className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                  <span>Já tenho um backup (.json) — Restaurar cinemateca</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={handleRestoreFile}
                  className="hidden"
                />
                {backupError && (
                  <p className="mt-2 text-center text-[11px] text-rose-400">
                    {backupError}
                  </p>
                )}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-ink">
                  Perfil do Espectador
                </h2>
                <p className="mt-1 text-xs text-muted">
                  Personalize metas, mídia favorita e atmosfera visual inicial.
                </p>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium text-muted">
                  1. Qual é o seu foco principal?
                </p>
                <div className="grid grid-cols-1 gap-2">
                  {FOCUS_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    const isSelected = readerFocus === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setReaderFocus(opt.id)}
                        className={`flex min-h-[44px] items-center gap-3 rounded-2xl border px-3.5 py-2.5 text-left text-xs font-medium transition-colors ${
                          isSelected
                            ? 'border-accent bg-accent/15 text-ink'
                            : 'border-line bg-card text-muted hover:text-ink'
                        }`}
                      >
                        <Icon
                          className={`h-4 w-4 shrink-0 ${
                            isSelected ? 'text-accent' : 'text-subtle'
                          }`}
                          strokeWidth={1.5}
                        />
                        <span>{opt.id}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-muted">
                    <Target className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                    2. Meta anual de obras
                  </p>
                  <input
                    type="number"
                    min="1"
                    max="999"
                    value={annualGoal}
                    onChange={(e) => setAnnualGoal(e.target.value)}
                    aria-label="Meta anual personalizada"
                    className="w-16 rounded-lg border border-line bg-card px-2 py-1 text-right text-xs font-semibold tabular-nums text-ink focus:border-accent focus:outline-none"
                  />
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {GOAL_PRESETS.map((goal) => {
                    const isSelected = Number(annualGoal) === goal;
                    return (
                      <button
                        key={goal}
                        type="button"
                        onClick={() => setAnnualGoal(goal)}
                        className={`min-h-[44px] rounded-xl border py-2.5 text-xs font-semibold tabular-nums transition-colors ${
                          isSelected
                            ? 'border-accent bg-accent/15 text-ink'
                            : 'border-line bg-card text-muted hover:text-ink'
                        }`}
                      >
                        {goal}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium text-muted">
                  3. Onde você mais assiste
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {FORMAT_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    const isSelected = preferredFormat === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setPreferredFormat(opt.id)}
                        className={`flex min-h-[44px] items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-[11px] font-medium transition-colors ${
                          isSelected
                            ? 'border-accent bg-accent/15 text-ink'
                            : 'border-line bg-card text-muted hover:text-ink'
                        }`}
                      >
                        <Icon
                          className={`h-3.5 w-3.5 shrink-0 ${
                            isSelected ? 'text-accent' : 'text-subtle'
                          }`}
                          strokeWidth={1.5}
                        />
                        <span className="truncate">{opt.id}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-1.5">
                  <p className="text-xs font-medium text-muted">
                    4. Critério que você mais valoriza
                  </p>
                  <span
                    className="text-[11px]"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    Selecione um ou mais
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {CRITERION_OPTIONS.map((criterion) => {
                    const isSelected = preferredCriteria.includes(criterion);
                    return (
                      <button
                        key={criterion}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => toggleCriterion(criterion)}
                        className={`flex min-h-[44px] items-center gap-2 rounded-[4px] border px-3 py-2 text-left text-[11px] font-medium transition-colors ${
                          isSelected
                            ? 'border-accent bg-accent/15 text-ink'
                            : 'border-line bg-card hover:text-ink'
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

              <div>
                <p className="mb-2 text-xs font-medium text-muted">
                  5. Atmosfera visual inicial (aplica ao vivo)
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {ATMOSPHERE_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    const isSelected = preferredAtmosphere === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => handleSelectAtmosphere(opt)}
                        className={`flex min-h-[44px] items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-[11px] font-medium transition-colors ${
                          isSelected
                            ? 'border-accent bg-accent/15 text-ink'
                            : 'border-line bg-card text-muted hover:text-ink'
                        }`}
                      >
                        <span
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line"
                          style={{ backgroundColor: opt.bg }}
                        >
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: opt.accent }}
                          />
                        </span>
                        <span className="flex-1 truncate">{opt.id}</span>
                        <Icon
                          className={`h-3 w-3 shrink-0 ${
                            isSelected ? 'text-accent' : 'text-subtle'
                          }`}
                          strokeWidth={1.5}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-ink">
                  Gêneros Favoritos
                </h2>
                <p className="mt-1 text-xs text-muted">
                  Selecione quantos preferir para afinar o Curador da Sessão e sua Roleta.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {GENRE_OPTIONS.map((genre) => {
                  const isSelected = favoriteGenres.includes(genre);
                  return (
                    <button
                      key={genre}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => toggleGenre(genre)}
                      className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-[4px] border px-3 py-2 text-xs font-medium transition-colors ${
                        isSelected
                          ? 'border-accent bg-accent/15 text-ink'
                          : 'border-line bg-card hover:text-ink'
                      }`}
                      style={!isSelected ? { color: 'var(--text-secondary)' } : undefined}
                    >
                      {isSelected && <Check className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />}
                      {genre}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-accent/30 bg-accent/15 text-accent">
                <Sparkles className="h-5 w-5" strokeWidth={1.5} />
              </div>
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-ink">
                  Inteligência Google Gemini Gratuita (Opcional)
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  O Cine Códice já funciona 100% offline. Se desejar, adicione sua chave gratuita do Gemini para curadoria por humor, recapitulação sem spoilers e críticas estruturadas.
                </p>
              </div>

              <div className="space-y-2 rounded-2xl border border-line bg-card p-3.5 text-xs text-muted">
                <p className="font-semibold text-ink">
                  Como gerar sua chave gratuita:
                </p>
                <ol className="list-decimal space-y-1.5 pl-4 leading-relaxed">
                  <li>Acesse o Google AI Studio pelo botão abaixo.</li>
                  <li>Clique em &quot;Create API Key&quot; usando sua conta Google.</li>
                  <li>Cole a chave aqui — ela fica salva só neste dispositivo.</li>
                </ol>
                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 font-semibold text-accent hover:underline"
                >
                  <KeyRound className="h-3.5 w-3.5" strokeWidth={1.5} />
                  Abrir Google AI Studio
                  <ExternalLink className="h-3 w-3" strokeWidth={1.5} />
                </a>
              </div>

              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-muted">
                  Chave da API (opcional agora)
                </span>
                <div className="relative flex items-center">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={draftGeminiKey}
                    onChange={(e) => setDraftGeminiKey(e.target.value)}
                    placeholder="AIza..."
                    className="min-h-[44px] w-full rounded-xl border border-line bg-card py-2.5 pl-3 pr-10 font-mono text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((prev) => !prev)}
                    aria-label={showKey ? 'Ocultar chave' : 'Mostrar chave'}
                    className="absolute right-2.5 rounded p-1 text-subtle hover:text-ink"
                  >
                    {showKey ? (
                      <EyeOff className="h-4 w-4" strokeWidth={1.5} />
                    ) : (
                      <Eye className="h-4 w-4" strokeWidth={1.5} />
                    )}
                  </button>
                </div>
              </label>

              <button
                type="button"
                onClick={() => setStep(5)}
                className="min-h-[44px] w-full rounded-xl border border-line bg-card py-2.5 text-xs font-medium text-muted hover:text-ink"
              >
                Configurar depois
              </button>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-ink">
                  Guia Rápido do {domainConfig.appName}
                </h2>
                <p className="mt-1 text-xs text-muted">
                  Tudo o que você pode usar na sua {domainConfig.appSubtitle.toLowerCase()}:
                </p>
              </div>

              <div className="space-y-2.5">
                {TUTORIAL_AREAS.map((area) => {
                  const Icon = area.icon;
                  return (
                    <div
                      key={area.title}
                      className="flex items-start gap-3 rounded-2xl border border-line bg-card p-3"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-accent/30 bg-accent/15 text-accent">
                        <Icon className="h-4 w-4" strokeWidth={1.5} />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-xs font-semibold text-ink">
                          {area.title}
                        </h3>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
                          {area.desc}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <footer className="border-t border-line bg-app px-4 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))]">
          <div className="flex items-center gap-2.5">
            {step > 1 && (
              <button
                type="button"
                onClick={() => setStep((prev) => Math.max(1, prev - 1))}
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-2xl border border-line bg-card px-4 py-3 text-xs font-semibold text-ink hover:border-accent/50"
              >
                <ArrowLeft className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                Voltar
              </button>
            )}

            {step < 5 ? (
              <button
                type="button"
                onClick={() =>
                  step === 4
                    ? handleSaveKeyAndContinue()
                    : setStep((prev) => Math.min(5, prev + 1))
                }
                className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-2xl bg-accent py-3 text-sm font-semibold text-accent-ink transition-opacity hover:opacity-90"
              >
                <span>{step === 4 && draftGeminiKey.trim() ? 'Salvar e Continuar' : 'Continuar'}</span>
                <ArrowRight className="h-4 w-4" strokeWidth={1.5} />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleFinish}
                className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-2xl bg-accent py-3 text-sm font-semibold text-accent-ink transition-opacity hover:opacity-90"
              >
                <CheckCircle2 className="h-4 w-4" strokeWidth={1.5} />
                <span>Entrar na Cinemateca</span>
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
