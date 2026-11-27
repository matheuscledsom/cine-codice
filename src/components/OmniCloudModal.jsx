import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Cloud,
  CloudOff,
  History,
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
  hydrateSupabaseConfigFromServer,
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
  onConfirmFirstSync,
  onCancelFirstSync,
  onRestorePreSyncSnapshot,
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [restoringSnap, setRestoringSnap] = useState(false);
  const [retryingAutoConfig, setRetryingAutoConfig] = useState(false);
  const [formError, setFormError] = useState('');

  const [configState, setConfigState] = useState(() => getSupabaseConfig());
  const [showAdvancedConfig, setShowAdvancedConfig] = useState(false);
  const [urlInput, setUrlInput] = useState(() => getSupabaseConfig().url || '');
  const [anonKeyInput, setAnonKeyInput] = useState(
    () => getSupabaseConfig().anonKey || ''
  );
  const [configError, setConfigError] = useState('');

  useEffect(() => {
    if (!isOpen) return undefined;
    const latestCfg = getSupabaseConfig();
    setConfigState(latestCfg);
    // Entrada manual fica sempre recolhida por padrão (opção avançada)
    setShowAdvancedConfig(false);
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
  }, [isOpen, onClose, cloudState?.configured]);

  if (!isOpen) return null;

  const isAuthenticated = Boolean(cloudState?.authenticated && cloudState?.user);
  const isSyncing = Boolean(cloudState?.syncing);
  const isOffline = Boolean(cloudState?.offline);
  const isSessionExpired = Boolean(cloudState?.sessionExpired);
  const pendingCount = Math.max(0, Number(cloudState?.pendingCount) || 0);
  const firstSyncPreview = cloudState?.firstSyncPreview || null;
  const preSyncSnapshotId = cloudState?.preSyncSnapshotId || null;
  const tombstoneMode = cloudState?.tombstoneMode || 'soft_delete';

  const handleSaveConfig = (e) => {
    e.preventDefault();
    setConfigError('');
    const res = saveSupabaseConfig({ url: urlInput, anonKey: anonKeyInput });
    if (!res.ok) {
      setConfigError(res.error || 'Configuração Supabase inválida.');
      return;
    }
    setConfigState(res.config);
    setShowAdvancedConfig(false);
    onConfigChanged?.();
  };

  const handleClearLocalConfig = () => {
    clearSupabaseConfig();
    const fresh = getSupabaseConfig();
    setConfigState(fresh);
    setUrlInput(fresh.url || '');
    setAnonKeyInput(fresh.anonKey || '');
    onConfigChanged?.();
  };

  const handleRefreshAutoConfig = async () => {
    setRetryingAutoConfig(true);
    setConfigError('');
    try {
      const res = await hydrateSupabaseConfigFromServer({ forceRefresh: true });
      const fresh = getSupabaseConfig();
      setConfigState(fresh);
      setUrlInput(fresh.url || '');
      setAnonKeyInput(fresh.anonKey || '');
      if (!res.ok && res.error) {
        setConfigError(res.error);
      } else {
        setShowAdvancedConfig(false);
        onConfigChanged?.();
      }
    } finally {
      setRetryingAutoConfig(false);
    }
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

  const handleConfirmMerge = async () => {
    setSubmitting(true);
    try {
      await onConfirmFirstSync?.();
    } finally {
      setSubmitting(false);
    }
  };

  const handleRestoreSnap = async () => {
    if (!preSyncSnapshotId || !onRestorePreSyncSnapshot) return;
    setRestoringSnap(true);
    try {
      await onRestorePreSyncSnapshot(preSyncSnapshotId);
    } finally {
      setRestoringSnap(false);
    }
  };

  const statusMeta = isAuthenticated
    ? isOffline
      ? {
          label:
            pendingCount > 0
              ? `Offline (${pendingCount} pendência${pendingCount === 1 ? '' : 's'})`
              : 'Modo Offline (Sessão Salva)',
          icon: WifiOff,
          detail:
            pendingCount > 0
              ? 'Suas alterações ficaram salvas na fila local e serão enviadas automaticamente ao reconectar.'
              : 'Alterações salvas no IndexedDB local serão enviadas ao reconectar.',
        }
      : isSyncing
        ? {
            label: 'Sincronizando com a nuvem...',
            icon: RefreshCw,
            detail: 'Mesclando Cinema, Livros, Games e Música pelo registro mais recente.',
          }
        : cloudState?.error
          ? {
              label:
                pendingCount > 0
                  ? `Atenção · ${pendingCount} pendência${pendingCount === 1 ? '' : 's'}`
                  : 'Falha na última sincronização',
              icon: AlertTriangle,
              detail: `Última sincronização bem-sucedida: ${formatSyncDateLabel(cloudState?.lastSyncAt)}`,
            }
          : {
              label:
                pendingCount > 0
                  ? `Sincronizando (${pendingCount} na fila)`
                  : 'Sincronizado na Nuvem',
              icon: CheckCircle2,
              detail: `Última sincronização: ${formatSyncDateLabel(cloudState?.lastSyncAt)}`,
            }
    : isSessionExpired
      ? {
          label: 'Sessão Expirada',
          icon: AlertTriangle,
          detail:
            'Entre novamente com e-mail e senha para retomar a sincronização. Seus dados locais continuam intactos.',
        }
      : {
          label: 'Local Offline',
          icon: CloudOff,
          detail:
            'Seus dados permanecem 100% locais no IndexedDB até você entrar com sua conta.',
        };

  const StatusIcon = statusMeta.icon;
  const configSourceLabel = configState.hasEnvConfig
    ? 'Automática (.env)'
    : configState.source === 'server'
      ? 'Automática (servidor)'
      : configState.source === 'localStorage'
        ? 'Manual (neste aparelho)'
        : 'Aguardando servidor';

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
              <p
                role="alert"
                className="mt-2 rounded-[4px] border border-accent/40 bg-card px-2.5 py-2 text-[11px] font-medium leading-relaxed text-accent"
              >
                {cloudState.error}
              </p>
            )}
            {tombstoneMode === 'compat_hard_delete' && isAuthenticated && (
              <p className="mt-1.5 text-[10px] leading-relaxed text-subtle">
                Modo compatível ativo (coluna <code className="text-ink">deleted_at</code> ainda não aplicada no Supabase).
              </p>
            )}
          </div>

          {/* Resumo da 1ª conexão antes de aplicar mesclagem */}
          {firstSyncPreview && (
            <div
              role="region"
              aria-label="Resumo antes de mesclar catálogo"
              data-testid="first-sync-preview-card"
              className="space-y-3 rounded-[6px] border border-accent bg-app p-3.5"
            >
              <div className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">
                  Prévia da 1ª sincronização neste aparelho
                </p>
                <p className="text-xs font-semibold tabular-nums text-ink">
                  {firstSyncPreview.summaryText}
                </p>
                <p className="text-[11px] leading-relaxed text-muted">
                  Nenhuma obra mais nova será sobrescrita. Um snapshot de segurança será salvo automaticamente antes de aplicar.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={submitting || isSyncing}
                  onClick={handleConfirmMerge}
                  className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-[4px] bg-accent px-3 text-xs font-semibold text-accent-ink hover:opacity-90 disabled:opacity-50"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${submitting || isSyncing ? 'animate-spin' : ''}`}
                    strokeWidth={1.5}
                  />
                  <span>Aplicar Mesclagem</span>
                </button>
                <button
                  type="button"
                  disabled={submitting || isSyncing}
                  onClick={() => onCancelFirstSync?.()}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-[4px] border border-line bg-card px-3 text-xs font-medium text-muted hover:text-ink"
                >
                  Agora não
                </button>
              </div>
            </div>
          )}

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
                    4 domínios (Cinema, Livros, Games e Música) ·{' '}
                    <code className="text-ink">public.catalog_works</code>
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

              {preSyncSnapshotId && onRestorePreSyncSnapshot && (
                <button
                  type="button"
                  disabled={restoringSnap || isSyncing}
                  onClick={handleRestoreSnap}
                  data-testid="restore-presync-snapshot-btn"
                  className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-[4px] border border-line bg-card px-3 text-xs font-medium text-ink hover:border-accent disabled:opacity-50"
                >
                  <History className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                  <span>
                    {restoringSnap
                      ? 'Restaurando snapshot...'
                      : 'Restaurar snapshot anterior à 1ª sincronização'}
                  </span>
                </button>
              )}
            </div>
          ) : (
            <form
              onSubmit={handleLoginSubmit}
              className="space-y-3 rounded-[6px] border border-line bg-app p-3"
            >
              <div className="flex items-center gap-1.5">
                <Cloud className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                <h3 className="text-xs font-semibold text-ink">
                  Entrar na Conta OmniPrism
                </h3>
              </div>

              {!configState.isConfigured && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-line bg-card px-2.5 py-2 text-[11px] text-muted">
                  <span>
                    Configuração automática indisponível neste ambiente. Tente buscar novamente ou abra as opções avançadas abaixo.
                  </span>
                  <button
                    type="button"
                    disabled={retryingAutoConfig || isOffline}
                    onClick={handleRefreshAutoConfig}
                    className="min-h-[36px] text-[11px] font-semibold text-accent hover:underline disabled:opacity-50"
                  >
                    {retryingAutoConfig ? 'Buscando...' : 'Tentar conexão automática'}
                  </button>
                </div>
              )}

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
                <p role="alert" className="text-[11px] font-medium text-accent">
                  {formError}
                </p>
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
                  {submitting ? 'Conectando e sincronizando...' : 'Entrar e Sincronizar'}
                </span>
              </button>
            </form>
          )}

          {/* Opção avançada recolhida para chaves manuais do Supabase */}
          <div className="rounded-[6px] border border-line bg-app">
            <button
              type="button"
              onClick={() => setShowAdvancedConfig((prev) => !prev)}
              aria-expanded={showAdvancedConfig}
              className="flex min-h-[44px] w-full items-center justify-between gap-2 px-3 py-2 text-left"
            >
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted">
                <KeyRound className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                <span>Avançado · Conexão Supabase ({configSourceLabel})</span>
              </span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-muted transition-transform ${
                  showAdvancedConfig ? 'rotate-180' : ''
                }`}
                strokeWidth={1.5}
              />
            </button>

            {showAdvancedConfig && (
              <div className="border-t border-line p-3 space-y-2.5">
                {configState.hasEnvConfig ? (
                  <p className="text-[11px] leading-relaxed text-muted">
                    A URL e a chave pública estão definidas automaticamente pelo ambiente de build.
                  </p>
                ) : (
                  <form onSubmit={handleSaveConfig} className="space-y-2.5">
                    <p className="text-[11px] leading-relaxed text-muted">
                      Normalmente você não precisa preencher nada aqui — o aplicativo busca a configuração pública automaticamente do servidor.
                    </p>
                    <div>
                      <label
                        htmlFor="omniprism-sb-url"
                        className="block text-[10px] font-medium uppercase tracking-wider text-subtle"
                      >
                        Project URL
                      </label>
                      <input
                        id="omniprism-sb-url"
                        type="url"
                        value={urlInput}
                        onChange={(e) => setUrlInput(e.target.value)}
                        placeholder="https://seu-projeto.supabase.co"
                        className="mt-1 min-h-[44px] w-full rounded-[4px] border border-line bg-card px-2.5 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="omniprism-sb-key"
                        className="block text-[10px] font-medium uppercase tracking-wider text-subtle"
                      >
                        Anon / Publishable Key (pública)
                      </label>
                      <input
                        id="omniprism-sb-key"
                        type="password"
                        value={anonKeyInput}
                        onChange={(e) => setAnonKeyInput(e.target.value)}
                        placeholder="sb_publishable_... ou eyJ..."
                        className="mt-1 min-h-[44px] w-full rounded-[4px] border border-line bg-card px-2.5 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
                      />
                    </div>
                    {configError && (
                      <p role="alert" className="text-[11px] text-accent">
                        {configError}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="submit"
                        className="min-h-[44px] flex-1 rounded-[4px] bg-accent px-3 text-xs font-semibold text-accent-ink hover:opacity-90"
                      >
                        Salvar Manualmente
                      </button>
                      <button
                        type="button"
                        disabled={retryingAutoConfig || isOffline}
                        onClick={handleRefreshAutoConfig}
                        className="min-h-[44px] rounded-[4px] border border-line bg-card px-3 text-xs font-medium text-ink hover:border-accent disabled:opacity-50"
                      >
                        {retryingAutoConfig ? 'Buscando...' : 'Usar Automático'}
                      </button>
                      {configState.source === 'localStorage' && (
                        <button
                          type="button"
                          onClick={handleClearLocalConfig}
                          className="min-h-[44px] rounded-[4px] border border-line bg-card px-3 text-xs font-medium text-muted hover:text-ink"
                        >
                          Limpar
                        </button>
                      )}
                    </div>
                  </form>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
