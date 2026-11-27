import {
  Activity,
  Check,
  Cloud,
  Copy,
  Database,
  HardDrive,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RELATIONAL_DB_VERSION } from '../api/limits';
import { CODICE_RELEASE } from '../config/versioning';
import {
  buildDiagnosticsReportText,
  collectStorageEstimate,
  computeCatalogDiagnosticsSummary,
} from '../lib/diagnosticsHelpers';
import {
  MAX_LOCAL_ERROR_ENTRIES,
  clearLocalErrorLog,
  formatLocalErrorLogForCopy,
  getLocalErrorLog,
} from '../lib/errorLogger';
import {
  getPendingSyncCount,
  getTombstoneSyncMode,
  readSyncQueue,
} from '../services/omniSyncService';
import { getSupabaseConfig } from '../services/supabaseClient';
import { ApiStatusPanel } from './ApiStatusPanel';

async function copyTextToClipboard(text) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  if (typeof document !== 'undefined') {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  }
  return false;
}

export function DiagnosticsPanel({
  items = [],
  authenticated = false,
  cloudState = null,
  onOpenCloudModal,
  onOpenReleaseNotes,
}) {
  const [storageInfo, setStorageInfo] = useState(null);
  const [loadingStorage, setLoadingStorage] = useState(true);
  const [errorLog, setErrorLog] = useState(() => getLocalErrorLog());
  const [copiedMode, setCopiedMode] = useState('');

  const catalogSummary = useMemo(
    () => computeCatalogDiagnosticsSummary(items),
    [items]
  );

  const refreshDiagnostics = useCallback(async () => {
    setLoadingStorage(true);
    try {
      const est = await collectStorageEstimate();
      setStorageInfo(est);
    } finally {
      setLoadingStorage(false);
    }
    setErrorLog(getLocalErrorLog());
  }, []);

  useEffect(() => {
    refreshDiagnostics();
  }, [refreshDiagnostics]);

  const handleCopyErrors = async () => {
    const text = formatLocalErrorLogForCopy(errorLog);
    const ok = await copyTextToClipboard(text).catch(() => false);
    if (ok) {
      setCopiedMode('errors');
      setTimeout(() => setCopiedMode((c) => (c === 'errors' ? '' : c)), 2500);
    }
  };

  const handleCopyFullReport = async () => {
    const text = buildDiagnosticsReportText({
      release: CODICE_RELEASE,
      schemaVersion: RELATIONAL_DB_VERSION,
      catalogSummary,
      storageSummary: storageInfo,
      errorLog,
    });
    const ok = await copyTextToClipboard(text).catch(() => false);
    if (ok) {
      setCopiedMode('full');
      setTimeout(() => setCopiedMode((c) => (c === 'full' ? '' : c)), 2500);
    }
  };

  const handleClearErrors = () => {
    clearLocalErrorLog();
    setErrorLog([]);
  };

  const isOnline = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;

  return (
    <div className="divide-y divide-line" data-testid="diagnostics-panel">
      {/* Versão & Privacidade Local */}
      <section className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-accent" strokeWidth={1.5} aria-hidden="true" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink">
              Diagnóstico do Aplicativo
            </h3>
          </div>
          <button
            type="button"
            onClick={refreshDiagnostics}
            disabled={loadingStorage}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[6px] border border-line bg-app px-3 text-xs font-medium text-ink hover:border-muted disabled:opacity-55"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loadingStorage ? 'animate-spin' : ''}`}
              strokeWidth={1.5}
              aria-hidden="true"
            />
            <span>Atualizar</span>
          </button>
        </div>

        <p className="inline-flex items-start gap-2 text-xs leading-relaxed text-muted">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} aria-hidden="true" />
          <span>
            100% local no dispositivo: nenhuma métrica ou log de erro é enviado para servidores externos.
          </span>
        </p>

        <dl className="grid grid-cols-2 gap-2 text-xs tabular-nums">
          <div className="rounded-[6px] border border-line bg-app p-3">
            <dt className="text-[11px] text-subtle">Versão</dt>
            <dd className="mt-0.5 font-semibold text-ink">
              OmniPrism {CODICE_RELEASE.label}
            </dd>
            {onOpenReleaseNotes && (
              <button
                type="button"
                onClick={onOpenReleaseNotes}
                className="mt-1 text-[11px] font-medium text-accent underline-offset-2 hover:underline"
              >
                Novidades da versão
              </button>
            )}
          </div>
          <div className="rounded-[6px] border border-line bg-app p-3">
            <dt className="text-[11px] text-subtle">Schema Local &amp; Rede</dt>
            <dd className="mt-0.5 font-semibold text-ink">
              IndexedDB v{RELATIONAL_DB_VERSION}
            </dd>
            <span className="mt-0.5 block text-[11px] text-muted">
              {isOnline ? 'Conexão online' : 'Modo offline'}
            </span>
          </div>
        </dl>
      </section>

      {/* Tamanho do Catálogo */}
      <section className="space-y-2.5 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink">
            <Database className="h-4 w-4 text-accent" strokeWidth={1.5} aria-hidden="true" />
            <span>Tamanho do Catálogo</span>
          </span>
          <span className="text-xs font-semibold tabular-nums text-ink">
            {catalogSummary.backlogWorks} obras · {catalogSummary.approxPayloadFormatted}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs tabular-nums sm:grid-cols-4">
          <div className="rounded-[6px] border border-line bg-app px-2.5 py-2">
            <span className="block text-[11px] text-subtle">Cinema</span>
            <span className="font-semibold text-ink">{catalogSummary.byDomain.cinema}</span>
          </div>
          <div className="rounded-[6px] border border-line bg-app px-2.5 py-2">
            <span className="block text-[11px] text-subtle">Leitura</span>
            <span className="font-semibold text-ink">{catalogSummary.byDomain.reading}</span>
          </div>
          <div className="rounded-[6px] border border-line bg-app px-2.5 py-2">
            <span className="block text-[11px] text-subtle">Games</span>
            <span className="font-semibold text-ink">{catalogSummary.byDomain.games}</span>
          </div>
          <div className="rounded-[6px] border border-line bg-app px-2.5 py-2">
            <span className="block text-[11px] text-subtle">Música</span>
            <span className="font-semibold text-ink">{catalogSummary.byDomain.music}</span>
          </div>
        </div>
      </section>

      {/* Uso de Armazenamento */}
      <section className="space-y-2.5 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink">
            <HardDrive className="h-4 w-4 text-accent" strokeWidth={1.5} aria-hidden="true" />
            <span>Uso de Storage</span>
          </span>
          {storageInfo?.usagePercent !== null && storageInfo?.usagePercent !== undefined && (
            <span className="text-xs tabular-nums text-muted">
              {storageInfo.usagePercent}% da cota
            </span>
          )}
        </div>

        <dl className="grid grid-cols-1 gap-2 text-xs tabular-nums sm:grid-cols-3">
          <div className="rounded-[6px] border border-line bg-app p-2.5">
            <dt className="text-[11px] text-subtle">Uso total (IndexedDB + Cache)</dt>
            <dd className="mt-0.5 font-semibold text-ink">
              {storageInfo?.formattedUsage || 'Calculando...'}
            </dd>
          </div>
          <div className="rounded-[6px] border border-line bg-app p-2.5">
            <dt className="text-[11px] text-subtle">Cota do navegador</dt>
            <dd className="mt-0.5 font-semibold text-ink">
              {storageInfo?.formattedQuota || 'Calculando...'}
            </dd>
          </div>
          <div className="rounded-[6px] border border-line bg-app p-2.5">
            <dt className="text-[11px] text-subtle">localStorage</dt>
            <dd className="mt-0.5 font-semibold text-ink">
              {storageInfo?.formattedLocalStorage || '0 B'} ({storageInfo?.localStorageKeys ?? 0} chaves)
            </dd>
          </div>
        </dl>

        <p className="text-[11px] text-subtle">
          Armazenamento persistente:{' '}
          <strong className="font-medium text-ink">
            {storageInfo?.persisted === true
              ? 'Ativo (protegido contra limpeza automática)'
              : storageInfo?.persisted === false
                ? 'Padrão do navegador'
                : 'Não informado pelo navegador'}
          </strong>
        </p>
      </section>

      {/* Saúde da Sincronização na Nuvem */}
      <section className="space-y-2.5 p-4" data-testid="diagnostics-cloud-sync">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink">
            <Cloud className="h-4 w-4 text-accent" strokeWidth={1.5} aria-hidden="true" />
            <span>Sincronização &amp; Fila Offline</span>
          </span>
          {onOpenCloudModal && (
            <button
              type="button"
              onClick={onOpenCloudModal}
              className="inline-flex min-h-[44px] items-center rounded-[6px] border border-line bg-app px-3 text-xs font-medium text-ink hover:border-accent"
            >
              Abrir Nuvem
            </button>
          )}
        </div>
        {(() => {
          const sbCfg = getSupabaseConfig();
          const syncQueue = readSyncQueue();
          const pending = cloudState?.pendingCount ?? getPendingSyncCount();
          const mode = cloudState?.tombstoneMode || getTombstoneSyncMode();
          const syncError = cloudState?.error || syncQueue.lastError || null;
          return (
            <div className="space-y-2 text-xs">
              <dl className="grid grid-cols-2 gap-2 tabular-nums">
                <div className="rounded-[6px] border border-line bg-app p-2.5">
                  <dt className="text-[11px] text-subtle">Configuração Supabase</dt>
                  <dd className="mt-0.5 font-semibold text-ink">
                    {sbCfg.hasEnvConfig
                      ? 'Automática (.env)'
                      : sbCfg.source === 'server'
                        ? 'Automática (/api/config)'
                        : sbCfg.isConfigured
                          ? 'Manual local'
                          : 'Não configurada'}
                  </dd>
                </div>
                <div className="rounded-[6px] border border-line bg-app p-2.5">
                  <dt className="text-[11px] text-subtle">Fila Pendente / Exclusões</dt>
                  <dd className="mt-0.5 font-semibold text-ink">
                    {pending} pendência{pending === 1 ? '' : 's'} ·{' '}
                    {mode === 'soft_delete' ? 'Tombstones ativos' : 'Modo compatível'}
                  </dd>
                </div>
              </dl>
              {syncError && (
                <p
                  role="alert"
                  className="rounded-[6px] border border-accent/40 bg-app px-3 py-2 text-[11px] leading-relaxed text-accent"
                >
                  {syncError}
                </p>
              )}
            </div>
          );
        })()}
      </section>

      {/* Status das Fontes */}
      <section className="space-y-2.5 p-4">
        <ApiStatusPanel authenticated={authenticated} />
      </section>

      {/* Log local dos últimos 50 erros (copiável) */}
      <section className="space-y-3 p-4" data-testid="diagnostics-error-log">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-ink">
              Log Local de Erros ({errorLog.length}/{MAX_LOCAL_ERROR_ENTRIES})
            </h3>
            <p className="text-[11px] text-subtle">
              Últimos {MAX_LOCAL_ERROR_ENTRIES} eventos gravados no aparelho (chaves e tokens ocultados).
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleCopyErrors}
            data-testid="copy-error-log-button"
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[6px] bg-accent px-3.5 text-xs font-semibold text-accent-ink hover:opacity-90"
          >
            {copiedMode === 'errors' ? (
              <Check className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <Copy className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
            )}
            <span>{copiedMode === 'errors' ? 'Log copiado' : 'Copiar log'}</span>
          </button>

          <button
            type="button"
            onClick={handleCopyFullReport}
            data-testid="copy-full-diagnostics-button"
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[6px] border border-line bg-app px-3 text-xs font-medium text-ink hover:border-muted"
          >
            {copiedMode === 'full' ? (
              <Check className="h-3.5 w-3.5 text-accent" strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <Copy className="h-3.5 w-3.5 text-muted" strokeWidth={1.5} aria-hidden="true" />
            )}
            <span>{copiedMode === 'full' ? 'Diagnóstico copiado' : 'Copiar relatório completo'}</span>
          </button>

          {errorLog.length > 0 && (
            <button
              type="button"
              onClick={handleClearErrors}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[6px] border border-line bg-app px-3 text-xs font-medium text-muted hover:text-ink"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
              <span>Limpar</span>
            </button>
          )}
        </div>

        {errorLog.length === 0 ? (
          <p className="border-y border-line py-4 text-xs text-muted">
            Nenhum erro local registrado.
          </p>
        ) : (
          <div className="max-h-60 divide-y divide-line overflow-y-auto rounded-[6px] border border-line bg-app">
            {errorLog.map((entry, idx) => (
              <div key={`${entry.timestamp}-${idx}`} className="px-3 py-2 text-[11px]">
                <div className="flex items-center justify-between gap-2 text-subtle tabular-nums">
                  <span className="font-semibold text-ink">{entry.source}</span>
                  <span>{String(entry.timestamp || '').replace('T', ' ').slice(0, 19)}</span>
                </div>
                <p className="mt-0.5 break-words text-muted">{entry.message}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
