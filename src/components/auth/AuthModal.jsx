import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Cloud,
  Eye,
  EyeOff,
  HardDrive,
  Loader2,
  LogIn,
  LogOut,
  Server,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  BackendError,
  clearSupabaseConfig,
  continueInLocalMode,
  getBackendMode,
  getSupabaseConfig,
  isServiceRoleKey,
  isSupabaseConfigured,
  listLocalProfiles,
  normalizeHandle,
  saveSupabaseConfig,
  setForceLocalMode,
  signInAccount,
  signOutAccount,
  signUpAccount,
  switchLocalProfile,
  testSupabaseConnection,
} from '../../services/codiceBackend';

export function AuthModal({
  isOpen,
  onClose,
  backendSession,
  currentWorkspace,
  onAuthSuccess,
}) {
  const [authTab, setAuthTab] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [localProfiles, setLocalProfiles] = useState([]);
  const [loadingProfiles, setLoadingProfiles] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [infoMessage, setInfoMessage] = useState('');

  const [serverConfigOpen, setServerConfigOpen] = useState(false);
  const [supabaseUrlInput, setSupabaseUrlInput] = useState('');
  const [supabaseKeyInput, setSupabaseKeyInput] = useState('');
  const [testingConn, setTestingConn] = useState(false);
  const [connTestResult, setConnTestResult] = useState(null);
  const [backendMode, setBackendMode] = useState(getBackendMode);
  const [hasRemoteConfig, setHasRemoteConfig] = useState(isSupabaseConfigured);
  const [remoteSource, setRemoteSource] = useState('none');

  const dialogRef = useRef(null);
  const urlInputRef = useRef(null);
  const authTabRefs = useRef([]);

  const refreshModalMeta = async () => {
    setLoadingProfiles(true);
    try {
      const cfg = getSupabaseConfig();
      setHasRemoteConfig(cfg.configured);
      setRemoteSource(cfg.source);
      setSupabaseUrlInput(cfg.url || '');
      setSupabaseKeyInput(cfg.anonKey || '');
      setBackendMode(getBackendMode());

      const list = await listLocalProfiles();
      setLocalProfiles(list);
    } catch {
      setLocalProfiles([]);
    } finally {
      setLoadingProfiles(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setErrorMessage('');
    setInfoMessage('');
    setConnTestResult(null);
    setPassword('');
    setShowPassword(false);
    refreshModalMeta();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const prevFocused = document.activeElement;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose?.();
        return;
      }
      if (event.key === 'Tab' && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (prevFocused && typeof prevFocused.focus === 'function') {
        prevFocused.focus();
      }
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isSupabaseMode = backendMode === 'supabase';

  const handleAuthError = (err) => {
    if (err instanceof BackendError) {
      setErrorMessage(err.userMessage);
    } else {
      setErrorMessage(err?.message || 'Não foi possível concluir a operação.');
    }
  };

  const handleSubmitForm = async (event) => {
    event.preventDefault();
    setErrorMessage('');
    setInfoMessage('');
    setSubmitting(true);

    try {
      if (authTab === 'login') {
        const res = await signInAccount({
          identifier: email,
          password,
          currentWorkspace,
        });
        await onAuthSuccess?.(res);
        onClose?.();
        return;
      }

      const res = await signUpAccount({
        email,
        password,
        handle: handle || displayName,
        displayName,
        currentWorkspace,
      });

      if (res.requiresEmailConfirmation) {
        setInfoMessage(
          'Conta criada! Verifique seu e-mail para confirmar o acesso e depois entre.'
        );
        setAuthTab('login');
        await refreshModalMeta();
        return;
      }

      await onAuthSuccess?.(res);
      onClose?.();
    } catch (err) {
      handleAuthError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleContinueLocal = async () => {
    setErrorMessage('');
    setInfoMessage('');
    setSubmitting(true);
    try {
      const res = await continueInLocalMode({ currentWorkspace });
      setBackendMode('local');
      await onAuthSuccess?.(res);
      onClose?.();
    } catch (err) {
      handleAuthError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSwitchProfile = async (targetUserId) => {
    setErrorMessage('');
    setInfoMessage('');
    setSubmitting(true);
    try {
      const res = await switchLocalProfile(targetUserId, { currentWorkspace });
      await onAuthSuccess?.(res);
      onClose?.();
    } catch (err) {
      handleAuthError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    setErrorMessage('');
    setInfoMessage('');
    setSubmitting(true);
    try {
      const res = await signOutAccount({ currentWorkspace });
      await onAuthSuccess?.(res);
      await refreshModalMeta();
      setInfoMessage('Sessão encerrada. Seus dados locais foram preservados.');
    } catch (err) {
      handleAuthError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleTestSupabase = async () => {
    setErrorMessage('');
    setInfoMessage('');
    setConnTestResult(null);
    if (isServiceRoleKey(supabaseKeyInput)) {
      setConnTestResult({
        ok: false,
        errorMessage:
          'Chave administrativa secreta recusada por segurança. Use apenas a chave pública (anon).',
      });
      return;
    }
    setTestingConn(true);
    const res = await testSupabaseConnection({
      url: supabaseUrlInput,
      anonKey: supabaseKeyInput,
    });
    setConnTestResult(res);
    setTestingConn(false);
  };

  const handleSaveSupabaseServer = (event) => {
    event.preventDefault();
    setErrorMessage('');
    setInfoMessage('');
    setConnTestResult(null);
    try {
      saveSupabaseConfig({
        url: supabaseUrlInput,
        anonKey: supabaseKeyInput,
      });
      setBackendMode(getBackendMode());
      setHasRemoteConfig(true);
      setRemoteSource('localStorage');
      setServerConfigOpen(false);
      setInfoMessage('Supabase conectado neste dispositivo. Entre ou crie sua conta na nuvem.');
    } catch (err) {
      handleAuthError(err);
    }
  };

  const handleResetSupabaseServer = () => {
    clearSupabaseConfig();
    setForceLocalMode(false);
    setHasRemoteConfig(false);
    setRemoteSource('none');
    setSupabaseUrlInput('');
    setSupabaseKeyInput('');
    setConnTestResult(null);
    setBackendMode('local');
    setInfoMessage('Conexão remota removida. Operando em Modo Local neste navegador.');
  };

  const handleOpenSupabaseForm = () => {
    setServerConfigOpen(true);
    setTimeout(() => urlInputRef.current?.focus(), 0);
  };

  const handleAuthTabKeyDown = (e, idx) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const nextIdx = (idx + 1) % 2;
    const nextTab = nextIdx === 0 ? 'login' : 'signup';
    setAuthTab(nextTab);
    setErrorMessage('');
    authTabRefs.current[nextIdx]?.focus();
  };

  const activeUser = backendSession?.user || null;
  const activeProfile = backendSession?.profile || null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="codice-auth-title"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92dvh] w-full max-w-md space-y-4 overflow-y-auto rounded-t-[6px] border border-line bg-card p-5 pb-[calc(2rem+env(safe-area-inset-bottom))] no-scrollbar sm:rounded-[6px]"
      >
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2
                id="codice-auth-title"
                className="text-base font-semibold tracking-tight text-ink"
              >
                Conta &amp; Sincronização
              </h2>
              <span className="inline-flex items-center gap-1 rounded-[4px] border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">
                {isSupabaseMode ? (
                  <Cloud className="h-3 w-3" strokeWidth={1.5} />
                ) : (
                  <HardDrive className="h-3 w-3" strokeWidth={1.5} />
                )}
                {isSupabaseMode ? 'Supabase Conectado' : 'Modo Local'}
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              O <strong className="text-ink">Modo Local</strong> guarda tudo só neste navegador.
              Para <strong className="text-ink">encontrar amigos, seguir e conversar entre celulares</strong>,
              conecte o Supabase gratuito.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar janela de conta e conexão"
            className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-[4px] border border-line text-muted hover:text-ink"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </header>

        {/* Sessão ativa */}
        {activeUser && activeProfile && (
          <div className="flex items-center justify-between gap-3 rounded-[4px] border border-line bg-app p-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-accent/60 bg-card text-xs font-bold text-ink">
                {activeProfile.avatarUrl ? (
                  <img
                    src={activeProfile.avatarUrl}
                    alt={activeProfile.displayName}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span>{activeProfile.avatarInitials || 'LC'}</span>
                )}
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-ink">
                  {activeProfile.displayName}
                </p>
                <p className="truncate text-[11px] text-muted">
                  {activeProfile.handle}
                  {activeUser.email ? ` · ${activeUser.email}` : ' · Navegador local'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleSignOut}
              disabled={submitting}
              className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-[4px] border border-line bg-card px-3 py-2 text-xs font-medium text-muted hover:border-accent hover:text-ink"
            >
              <LogOut className="h-3.5 w-3.5" strokeWidth={1.5} />
              <span>Sair</span>
            </button>
          </div>
        )}

        {/* Destaque Conectar Supabase quando não configurado */}
        {!isSupabaseMode && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-accent/40 bg-app p-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-ink">
                Rede social entre dispositivos
              </p>
              <p className="text-[11px] text-muted">
                Cole a URL e a chave pública anon do seu projeto Supabase gratuito.
              </p>
            </div>
            <button
              type="button"
              onClick={handleOpenSupabaseForm}
              className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-[4px] bg-accent px-3 py-2 text-xs font-semibold text-accent-ink hover:opacity-90"
            >
              <Cloud className="h-3.5 w-3.5" strokeWidth={1.5} />
              <span>Conectar Supabase</span>
            </button>
          </div>
        )}

        {errorMessage && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-[4px] border border-rose-500/35 bg-rose-500/10 p-3 text-xs text-rose-400"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.5} />
            <span>{errorMessage}</span>
          </div>
        )}

        {infoMessage && (
          <div
            role="status"
            className="flex items-start gap-2 rounded-[4px] border border-accent/40 bg-accent/10 p-3 text-xs text-accent"
          >
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.5} />
            <span>{infoMessage}</span>
          </div>
        )}

        {/* Conexão Supabase (URL https://*.supabase.co + anon key + Testar conexão) */}
        <div className="overflow-hidden rounded-[4px] border border-line bg-app">
          <button
            type="button"
            onClick={() => setServerConfigOpen((prev) => !prev)}
            aria-expanded={serverConfigOpen}
            className="flex min-h-[44px] w-full items-center justify-between gap-2 px-3.5 py-2 text-left text-xs font-medium text-ink hover:bg-card"
          >
            <span className="inline-flex items-center gap-2">
              <Server className="h-4 w-4 text-accent" strokeWidth={1.5} />
              <span>Conectar Supabase ({hasRemoteConfig ? 'Configurado' : 'Opcional'})</span>
            </span>
            <span className="text-[11px] text-accent">
              {serverConfigOpen ? 'Fechar' : 'Configurar'}
            </span>
          </button>

          {serverConfigOpen && (
            <form
              onSubmit={handleSaveSupabaseServer}
              className="space-y-2.5 border-t border-line p-3.5"
            >
              <p className="text-[11px] leading-relaxed text-muted">
                Use somente a chave pública <code className="text-ink">anon</code> do projeto.
                Chaves administrativas secretas são recusadas automaticamente.
                {remoteSource === 'env' ? ' Carregado atualmente via .env.' : ''}
              </p>

              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-muted">
                  Supabase URL
                </span>
                <input
                  ref={urlInputRef}
                  type="url"
                  value={supabaseUrlInput}
                  onChange={(e) => {
                    setSupabaseUrlInput(e.target.value);
                    setConnTestResult(null);
                  }}
                  placeholder="https://seu-projeto.supabase.co"
                  className="min-h-[44px] w-full rounded-[4px] border border-line bg-card px-3 py-2 font-mono text-[11px] text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-muted">
                  Chave Pública (anon)
                </span>
                <input
                  type="password"
                  autoComplete="off"
                  value={supabaseKeyInput}
                  onChange={(e) => {
                    setSupabaseKeyInput(e.target.value);
                    setConnTestResult(null);
                  }}
                  placeholder="eyJhbGci..."
                  className="min-h-[44px] w-full rounded-[4px] border border-line bg-card px-3 py-2 font-mono text-[11px] text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
                />
              </label>

              {connTestResult && (
                <div
                  role="status"
                  className={`rounded-[4px] border px-3 py-2 text-[11px] ${
                    connTestResult.ok
                      ? 'border-accent/40 bg-accent/10 text-ink'
                      : 'border-rose-500/35 bg-rose-500/10 text-rose-400'
                  }`}
                >
                  {connTestResult.ok
                    ? `Conexão verificada com sucesso (${connTestResult.latencyMs} ms).`
                    : connTestResult.errorMessage}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleTestSupabase}
                  disabled={testingConn}
                  className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-[4px] border border-line bg-card px-3 py-2 text-xs font-medium text-ink hover:border-accent hover:text-accent disabled:opacity-55"
                >
                  <Activity className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                  <span>{testingConn ? 'Testando...' : 'Testar conexão'}</span>
                </button>

                <button
                  type="submit"
                  className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-[4px] bg-accent px-3 py-2 text-xs font-semibold text-accent-ink hover:opacity-90"
                >
                  Salvar &amp; Conectar
                </button>

                {hasRemoteConfig && !isSupabaseMode && (
                  <button
                    type="button"
                    onClick={() => {
                      setForceLocalMode(false);
                      setBackendMode(getBackendMode());
                      setInfoMessage('Modo nuvem Supabase reativado.');
                    }}
                    className="inline-flex min-h-[44px] items-center justify-center rounded-[4px] border border-accent/50 bg-accent/10 px-3 py-2 text-xs font-semibold text-accent"
                  >
                    Reativar Nuvem
                  </button>
                )}

                {remoteSource === 'localStorage' && (
                  <button
                    type="button"
                    onClick={handleResetSupabaseServer}
                    aria-label="Remover configuração Supabase"
                    className="inline-flex min-h-[44px] items-center justify-center gap-1 rounded-[4px] border border-line bg-card px-3 py-2 text-xs font-medium text-rose-400 hover:border-rose-500/40"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                    <span>Limpar</span>
                  </button>
                )}
              </div>
            </form>
          )}
        </div>

        {/* Alternador Entrar / Novo Perfil */}
        <div
          role="tablist"
          aria-label="Tipo de acesso"
          className="grid grid-cols-2 rounded-[4px] border border-line bg-app p-1"
        >
          <button
            ref={(el) => {
              authTabRefs.current[0] = el;
            }}
            type="button"
            role="tab"
            aria-selected={authTab === 'login'}
            tabIndex={authTab === 'login' ? 0 : -1}
            onClick={() => {
              setAuthTab('login');
              setErrorMessage('');
            }}
            onKeyDown={(e) => handleAuthTabKeyDown(e, 0)}
            className={`flex min-h-[44px] items-center justify-center gap-1.5 rounded-[2px] px-3 text-xs font-semibold transition-colors ${
              authTab === 'login'
                ? 'bg-accent text-accent-ink'
                : 'text-muted hover:text-ink'
            }`}
          >
            <LogIn className="h-4 w-4" strokeWidth={1.5} />
            <span>Entrar</span>
          </button>

          <button
            ref={(el) => {
              authTabRefs.current[1] = el;
            }}
            type="button"
            role="tab"
            aria-selected={authTab === 'signup'}
            tabIndex={authTab === 'signup' ? 0 : -1}
            onClick={() => {
              setAuthTab('signup');
              setErrorMessage('');
            }}
            onKeyDown={(e) => handleAuthTabKeyDown(e, 1)}
            className={`flex min-h-[44px] items-center justify-center gap-1.5 rounded-[2px] px-3 text-xs font-semibold transition-colors ${
              authTab === 'signup'
                ? 'bg-accent text-accent-ink'
                : 'text-muted hover:text-ink'
            }`}
          >
            <UserPlus className="h-4 w-4" strokeWidth={1.5} />
            <span>{isSupabaseMode ? 'Criar Conta' : 'Novo Perfil Local'}</span>
          </button>
        </div>

        <form onSubmit={handleSubmitForm} className="space-y-3">
          {authTab === 'signup' && (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted">
                  Nome
                </span>
                <input
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Ex.: Mariana Silva"
                  className="min-h-[44px] w-full rounded-[4px] border border-line bg-app px-3 py-2 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted">
                  @handle
                </span>
                <input
                  type="text"
                  required
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  onBlur={() => {
                    if (handle.trim()) {
                      setHandle(normalizeHandle(handle, displayName));
                    }
                  }}
                  placeholder="@marianasilva"
                  className="min-h-[44px] w-full rounded-[4px] border border-line bg-app px-3 py-2 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
                />
              </label>
            </div>
          )}

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">
              {authTab === 'login' && !isSupabaseMode ? 'E-mail ou @handle' : 'E-mail'}
            </span>
            <input
              type={authTab === 'signup' || isSupabaseMode ? 'email' : 'text'}
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={
                authTab === 'login' && !isSupabaseMode
                  ? 'voce@exemplo.com ou @handle'
                  : 'voce@exemplo.com'
              }
              className="min-h-[44px] w-full rounded-[4px] border border-line bg-app px-3 py-2 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">
              Senha
            </span>
            <div className="relative flex items-center">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                minLength={authTab === 'signup' ? 6 : undefined}
                autoComplete={
                  authTab === 'signup' ? 'new-password' : 'current-password'
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                className="min-h-[44px] w-full rounded-[4px] border border-line bg-app py-2 pl-3 pr-11 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                className="absolute right-1 flex min-h-[40px] min-w-[40px] items-center justify-center rounded-[4px] text-subtle hover:text-ink"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4 text-accent" strokeWidth={1.5} />
                ) : (
                  <Eye className="h-4 w-4" strokeWidth={1.5} />
                )}
              </button>
            </div>
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[4px] bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink hover:opacity-90 disabled:opacity-60"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
            ) : authTab === 'login' ? (
              <LogIn className="h-4 w-4" strokeWidth={1.5} />
            ) : (
              <UserPlus className="h-4 w-4" strokeWidth={1.5} />
            )}
            <span>
              {authTab === 'login'
                ? isSupabaseMode
                  ? 'Entrar no Códice (Nuvem)'
                  : 'Entrar neste Navegador'
                : isSupabaseMode
                  ? 'Criar Conta no Supabase'
                  : 'Salvar Perfil Neste Navegador'}
            </span>
          </button>
        </form>

        <button
          type="button"
          onClick={handleContinueLocal}
          disabled={submitting}
          className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[4px] border border-line bg-app px-4 py-2 text-xs font-semibold text-ink hover:border-accent"
        >
          <HardDrive className="h-4 w-4 text-accent" strokeWidth={1.5} />
          <span>Continuar em Modo Local</span>
        </button>

        {/* Perfis Locais no IndexedDB */}
        <section
          aria-label="Perfis salvos neste navegador"
          className="space-y-2.5 rounded-[4px] border border-line bg-app p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink">
              <Users className="h-4 w-4 text-accent" strokeWidth={1.5} />
              <span>Perfis neste Navegador</span>
            </span>
            <span className="text-[11px] tabular-nums text-subtle">
              {localProfiles.length} {localProfiles.length === 1 ? 'perfil' : 'perfis'}
            </span>
          </div>

          {loadingProfiles ? (
            <p className="py-1 text-xs text-muted">Carregando perfis...</p>
          ) : localProfiles.length === 0 ? (
            <p className="py-1 text-xs text-muted">
              Nenhum perfil salvo neste navegador ainda.
            </p>
          ) : (
            <div className="max-h-40 space-y-2 overflow-y-auto pr-0.5">
              {localProfiles.map((prof) => (
                <div
                  key={prof.id}
                  className={`flex items-center justify-between gap-2 rounded-[4px] border px-3 py-2 ${
                    prof.isActive
                      ? 'border-accent/50 bg-accent/10'
                      : 'border-line bg-card'
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-app text-[11px] font-bold text-ink">
                      {prof.avatarUrl ? (
                        <img
                          src={prof.avatarUrl}
                          alt={prof.displayName}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span>{prof.avatarInitials || 'LC'}</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-ink">
                        {prof.displayName}
                      </p>
                      <p className="truncate text-[10px] text-muted tabular-nums">
                        {prof.handle} · {prof.workCount}{' '}
                        {prof.workCount === 1 ? 'obra' : 'obras'}
                      </p>
                    </div>
                  </div>

                  {prof.isActive ? (
                    <span className="shrink-0 rounded-[4px] bg-accent px-2.5 py-1 text-[10px] font-semibold text-accent-ink">
                      Ativo
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleSwitchProfile(prof.id)}
                      disabled={submitting}
                      className="min-h-[40px] shrink-0 rounded-[4px] border border-line bg-app px-3 py-1 text-[11px] font-medium text-ink hover:border-accent hover:text-accent"
                    >
                      Alternar
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
