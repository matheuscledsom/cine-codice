import {
  CheckCircle2,
  Cloud,
  CloudOff,
  KeyRound,
  LogOut,
  RefreshCw,
  ShieldCheck,
  WifiOff,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  clearSupabaseConfig,
  getSupabaseConfig,
  saveSupabaseConfig,
} from '../services/supabaseClient';
import { OmniLogo } from './OmniLogo';

function formatSyncDateLabel(iso) {
  if (!iso) return 'Ainda não sincronizado';
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return String(iso).slice(0, 16).replace('T', ' ');
  }
}

export function OmniCloudModal({
  isOpen,
  onClose,
  cloudState = {},
  worksCount = 0,
  onSignIn,
  onSignOut,
  onSyncNow,
  onConfigChanged,
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const [configState, setConfigState] = useState(() => getSupabaseConfig());
  const [showConfigEditor, setShowConfigEditor] = useState(
    () => !getSupabaseConfig().isConfigured
  );
  const [urlInput, setUrlInput] = useState(() => getSupabaseConfig().url || '');
  const [anonKeyInput, setAnonKeyInput] = useState(
    () => getSupabaseConfig().anonKey || ''
  );
  const [configError, setConfigError] = useState('');

  useEffect(() => {
    if (!isOpen) return undefined;
    const latestCfg = getSupabaseConfig();
    setConfigState(latestCfg);
    if (!latestCfg.isConfigured) {
      setShowConfigEditor(true);
    }
    setUrlInput(latestCfg.url || '');
    setAnonKeyInput(latestCfg.anonKey || '');
    setFormError('');
    setConfigError('');

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isAuthenticated = Boolean(cloudState?.authenticated && cloudState?.user);
  const isSyncing = Boolean(cloudState?.syncing);
  const isOffline = Boolean(cloudState?.offline);

  const handleSaveConfig = (e) => {
    e.preventDefault();
    setConfigError('');
    const res = saveSupabaseConfig({ url: urlInput, anonKey: anonKeyInput });
    if (!res.ok) {
      setConfigError(res.error || 'Configuração Supabase inválida.');
      return;
    }
    setConfigState(res.config);
    setShowConfigEditor(false);
    onConfigChanged?.();
  };

  const handleClearLocalConfig = () => {
    clearSupabaseConfig();
    const fresh = getSupabaseConfig();
    setConfigState(fresh);
    setUrlInput(fresh.url || '');
    setAnonKeyInput(fresh.anonKey || '');
    setShowConfigEditor(!fresh.isConfigured);
    onConfigChanged?.();
  };

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!email.trim() || !password) {
      setFormError('Informe e-mail e senha da sua conta.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await onSignIn?.({ email: email.trim(), password });
      if (res && !res.ok) {
        setFormError(res.error || 'Não foi possível conectar.');
      } else {
        setPassword('');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const statusMeta = isAuthenticated
    ? isOffline
      ? {
          label: 'Modo Offline (Sessão Salva)',
          icon: WifiOff,
          detail: 'Alterações salvas no IndexedDB local serão enviadas ao reconectar.',
        }
      : isSyncing
        ? {
            label: 'Sincronizando Supabase...',
            icon: RefreshCw,
            detail: 'Mesclando catálogo local e nuvem (domain = cinema).',
          }
        : {
            label: 'Sincronizado Supabase',
            icon: CheckCircle2,
            detail: `Última sincronização: ${formatSyncDateLabel(cloudState?.lastSyncAt)}`,
          }
    : {
        label: 'Local Offline',
        icon: CloudOff,
        detail: 'Seus dados permanecem 100% locais no IndexedDB até você conectar uma conta.',
      };

  const StatusIcon = statusMeta.icon;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Nuvem e Conta OmniPrism"
    >
      <div
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-[8px] border border-line bg-card p-5 pb-7 text-ink sm:rounded-[8px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-2 border-b border-line pb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <OmniLogo size={24} className="text-ink" />
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-ink">
                Nuvem &amp; Conta OmniPrism
              </h2>
              <p className="text-[11px] text-muted">
                Sincronização privada local-first · PC e celular
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar janela Nuvem e Conta"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[4px] border border-line text-muted hover:text-ink"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>

        <div className="space-y-4">
          {/* Status atual */}
          <div className="rounded-[6px] border border-line bg-app p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-2 text-xs font-semibold text-ink">
                <StatusIcon
                  className={`h-4 w-4 shrink-0 text-accent ${isSyncing ? 'animate-spin' : ''}`}
                  strokeWidth={1.5}
                />
                <span>{statusMeta.label}</span>
              </span>
              <span className="rounded-[4px] border border-line bg-card px-2 py-0.5 text-[10px] font-medium tabular-nums text-muted">
                {worksCount} {worksCount === 1 ? 'obra' : 'obras'}
              </span>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
              {statusMeta.detail}
            </p>
            {cloudState?.error && (
              <p className="mt-1.5 text-[11px] font-medium text-accent">
                {cloudState.error}
              </p>
            )}
          </div>

          {/* Configuração Supabase (env ou fallback localStorage) */}
          <div className="rounded-[6px] border border-line bg-app p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink">
                <KeyRound className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                <span>Projeto Supabase</span>
              </span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted">
                  {configState.hasEnvConfig
                    ? 'Via .env (Vite)'
                    : configState.source === 'localStorage'
                      ? 'Salvo neste aparelho'
                      : 'Não configurado'}
                </span>
                {!configState.hasEnvConfig && (
                  <button
                    type="button"
                    onClick={() => setShowConfigEditor((prev) => !prev)}
                    className="min-h-[32px] text-[11px] font-medium text-accent hover:underline"
                  >
                    {showConfigEditor ? 'Ocultar' : 'Editar'}
                  </button>
                )}
              </div>
            </div>

            {showConfigEditor && !configState.hasEnvConfig && (
              <form onSubmit={handleSaveConfig} className="space-y-2 pt-1">
                <div>
                  <label
                    htmlFor="omniprism-sb-url"
                    className="block text-[10px] font-medium uppercase tracking-wider text-subtle"
                  >
                    Project URL (VITE_SUPABASE_URL)
                  </label>
                  <input
                    id="omniprism-sb-url"
                    type="url"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder="https://seu-projeto.supabase.co"
                    className="mt-1 min-h-[40px] w-full rounded-[4px] border border-line bg-card px-2.5 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
                  />
                </div>
                <div>
                  <label
                    htmlFor="omniprism-sb-key"
                    className="block text-[10px] font-medium uppercase tracking-wider text-subtle"
                  >
                    Anon / Publishable Key (VITE_SUPABASE_ANON_KEY)
                  </label>
                  <input
                    id="omniprism-sb-key"
                    type="password"
                    value={anonKeyInput}
                    onChange={(e) => setAnonKeyInput(e.target.value)}
                    placeholder="sb_publishable_... ou eyJ..."
                    className="mt-1 min-h-[40px] w-full rounded-[4px] border border-line bg-card px-2.5 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
                  />
                </div>
                {configError && (
                  <p className="text-[11px] text-accent">{configError}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="submit"
                    className="min-h-[40px] flex-1 rounded-[4px] bg-accent px-3 text-xs font-semibold text-accent-ink hover:opacity-90"
                  >
                    Salvar Conexão Local
                  </button>
                  {configState.source === 'localStorage' && (
                    <button
                      type="button"
                      onClick={handleClearLocalConfig}
                      className="min-h-[40px] rounded-[4px] border border-line bg-card px-3 text-xs font-medium text-muted hover:text-ink"
                    >
                      Limpar
                    </button>
                  )}
                </div>
              </form>
            )}
          </div>

          {/* Conta autenticada ou formulário de login */}
          {isAuthenticated ? (
            <div className="space-y-3 rounded-[6px] border border-line bg-app p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-subtle">
                    Conta Conectada
                  </p>
                  <p className="truncate text-xs font-semibold text-ink">
                    {cloudState.user?.email || 'Conta OmniPrism'}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted">
                    Tabela: <code className="text-ink">public.catalog_works</code> · Domínio:{' '}
                    <code className="text-ink">cinema</code>
                  </p>
                </div>
                <ShieldCheck className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={isSyncing || isOffline}
                  onClick={() => onSyncNow?.()}
                  className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-[4px] bg-accent px-3 text-xs font-semibold text-accent-ink hover:opacity-90 disabled:opacity-50"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`}
                    strokeWidth={1.5}
                  />
                  <span>Sincronizar Agora</span>
                </button>
                <button
                  type="button"
                  onClick={() => onSignOut?.()}
                  className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-[4px] border border-line bg-card px-3 text-xs font-medium text-ink hover:border-accent"
                >
                  <LogOut className="h-3.5 w-3.5 text-muted" strokeWidth={1.5} />
                  <span>Sair</span>
                </button>
              </div>
            </div>
          ) : (
            <form
              onSubmit={handleLoginSubmit}
              className="space-y-3 rounded-[6px] border border-line bg-app p-3"
            >
              <div className="flex items-center gap-1.5">
                <Cloud className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                <h3 className="text-xs font-semibold text-ink">
                  Entrar na Conta Única (Supabase Auth)
                </h3>
              </div>

              <div>
                <label
                  htmlFor="omniprism-auth-email"
                  className="block text-[10px] font-medium uppercase tracking-wider text-subtle"
                >
                  E-mail
                </label>
                <input
                  id="omniprism-auth-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="seu@email.com"
                  disabled={!configState.isConfigured || submitting}
                  className="mt-1 min-h-[44px] w-full rounded-[4px] border border-line bg-card px-3 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none disabled:opacity-50"
                />
              </div>

              <div>
                <label
                  htmlFor="omniprism-auth-password"
                  className="block text-[10px] font-medium uppercase tracking-wider text-subtle"
                >
                  Senha
                </label>
                <input
                  id="omniprism-auth-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Sua senha"
                  disabled={!configState.isConfigured || submitting}
                  className="mt-1 min-h-[44px] w-full rounded-[4px] border border-line bg-card px-3 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none disabled:opacity-50"
                />
              </div>

              {formError && (
                <p className="text-[11px] font-medium text-accent">{formError}</p>
              )}

              <button
                type="submit"
                disabled={!configState.isConfigured || submitting || isOffline}
                className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[4px] bg-accent px-4 text-xs font-semibold text-accent-ink hover:opacity-90 disabled:opacity-50"
              >
                {submitting ? (
                  <RefreshCw className="h-4 w-4 animate-spin" strokeWidth={1.5} />
                ) : (
                  <Cloud className="h-4 w-4" strokeWidth={1.5} />
                )}
                <span>
                  {submitting ? 'Conectando e enviando catálogo...' : 'Conectar e Sincronizar'}
                </span>
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
