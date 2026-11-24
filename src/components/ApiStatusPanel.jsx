import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock,
  RefreshCw,
  Server,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  API_STATUS_SOURCES,
  loadServerApiStatus,
  probeApiSource,
} from '../services/apiStatusService';

function StatusIndicator({ state, testing }) {
  if (testing) {
    return (
      <span className="inline-flex items-center gap-1 rounded-[4px] border border-line bg-card px-2 py-0.5 text-[10px] font-medium text-muted">
        <RefreshCw className="h-3 w-3 animate-spin text-accent" strokeWidth={1.5} aria-hidden="true" />
        <span>Testando</span>
      </span>
    );
  }

  if (state === 'online') {
    return (
      <span className="inline-flex items-center gap-1 rounded-[4px] border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">
        <CheckCircle2 className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
        <span>Online</span>
      </span>
    );
  }

  if (state === 'missing_key') {
    return (
      <span className="inline-flex items-center gap-1 rounded-[4px] border border-line bg-card px-2 py-0.5 text-[10px] font-medium text-muted">
        <AlertCircle className="h-3 w-3 text-subtle" strokeWidth={1.5} aria-hidden="true" />
        <span>Sem credencial</span>
      </span>
    );
  }

  if (state === 'error') {
    return (
      <span className="inline-flex items-center gap-1 rounded-[4px] border border-line bg-card px-2 py-0.5 text-[10px] font-medium text-ink">
        <XCircle className="h-3 w-3 text-muted" strokeWidth={1.5} aria-hidden="true" />
        <span>Indisponível</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-[4px] border border-line bg-card px-2 py-0.5 text-[10px] font-medium text-subtle">
      <Clock className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
      <span>Aguardando</span>
    </span>
  );
}

export function ApiStatusPanel({ authenticated = false }) {
  const [serverStatus, setServerStatus] = useState({
    loading: false,
    checked: false,
    reachable: false,
    devMode: false,
    providers: {
      tmdb: { configured: false },
      omdb: { configured: false },
    },
  });
  const [resultsById, setResultsById] = useState({});
  const [testingIds, setTestingIds] = useState({});
  const [testingAll, setTestingAll] = useState(false);

  const refreshServerStatus = useCallback(async () => {
    setServerStatus((prev) => ({ ...prev, loading: true }));
    const res = await loadServerApiStatus();
    setServerStatus({
      loading: false,
      checked: true,
      reachable: Boolean(res.reachable),
      devMode: Boolean(res.devMode),
      providers: {
        tmdb: { configured: Boolean(res.providers?.tmdb?.configured) },
        omdb: { configured: Boolean(res.providers?.omdb?.configured) },
      },
    });
  }, []);

  useEffect(() => {
    refreshServerStatus();
  }, [authenticated, refreshServerStatus]);

  const handleTestSingle = async (sourceId) => {
    setTestingIds((prev) => ({ ...prev, [sourceId]: true }));
    try {
      if (sourceId === 'tmdb' || sourceId === 'omdb') {
        await refreshServerStatus();
      }
      const res = await probeApiSource(sourceId);
      setResultsById((prev) => ({ ...prev, [sourceId]: res }));
    } finally {
      setTestingIds((prev) => ({ ...prev, [sourceId]: false }));
    }
  };

  const handleTestAll = async () => {
    if (testingAll) return;
    setTestingAll(true);
    try {
      await refreshServerStatus();
      for (const source of API_STATUS_SOURCES) {
        setTestingIds((prev) => ({ ...prev, [source.id]: true }));
        const res = await probeApiSource(source.id);
        setResultsById((prev) => ({ ...prev, [source.id]: res }));
        setTestingIds((prev) => ({ ...prev, [source.id]: false }));
      }
    } finally {
      setTestingAll(false);
    }
  };

  return (
    <div className="space-y-2.5" data-testid="api-status-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-accent" strokeWidth={1.5} aria-hidden="true" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-ink">
            Status das APIs
          </h3>
        </div>

        <button
          type="button"
          onClick={handleTestAll}
          disabled={testingAll}
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-[4px] border border-line bg-app px-2.5 py-1 text-[11px] font-medium text-ink transition-colors hover:border-accent hover:text-accent disabled:opacity-55"
        >
          <Activity className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} aria-hidden="true" />
          <span>{testingAll ? 'Testando...' : 'Testar todas'}</span>
        </button>
      </div>

      <p className="text-[11px] leading-relaxed text-muted">
        Verifique a disponibilidade e o tempo de resposta de cada fonte de catálogo.
        Nenhuma chave de API é exibida neste painel.
      </p>

      <div className="space-y-1.5">
        {API_STATUS_SOURCES.map((source) => {
          const result = resultsById[source.id] || null;
          const isTesting = Boolean(testingIds[source.id]);
          const serverConfigured = source.supportsServerProxy
            ? Boolean(serverStatus.providers?.[source.id]?.configured)
            : null;

          return (
            <div
              key={source.id}
              className="flex flex-col gap-1.5 rounded-[4px] border border-line bg-app px-3 py-2"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-semibold text-ink">{source.label}</span>
                    <span className="rounded-[2px] border border-line bg-card px-1.5 py-0.5 text-[10px] text-subtle">
                      {source.domainLabel}
                    </span>
                  </div>
                  <span className="block truncate text-[10px] text-subtle">{source.host}</span>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  {result && typeof result.latencyMs === 'number' && (
                    <span className="text-[10px] tabular-nums text-muted">
                      {result.latencyMs} ms
                    </span>
                  )}
                  <StatusIndicator state={result?.state || 'idle'} testing={isTesting} />
                  <button
                    type="button"
                    onClick={() => handleTestSingle(source.id)}
                    disabled={isTesting || testingAll}
                    aria-label={`Testar ${source.label}`}
                    className="inline-flex min-h-[34px] items-center justify-center rounded-[4px] border border-line bg-card px-2.5 py-1 text-[11px] font-medium text-ink transition-colors hover:border-accent hover:text-accent disabled:opacity-55"
                  >
                    Testar
                  </button>
                </div>
              </div>

              {source.supportsServerProxy && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-1.5 text-[10px] text-muted">
                  <span>
                    Configurado no servidor:{' '}
                    <strong className="font-semibold text-ink">
                      {serverStatus.loading && !serverStatus.checked
                        ? 'Verificando...'
                        : serverConfigured
                          ? 'Sim'
                          : 'Não'}
                    </strong>
                  </span>
                  {result?.message && (
                    <span className="truncate text-subtle">{result.message}</span>
                  )}
                </div>
              )}

              {!source.supportsServerProxy && result?.message && (
                <p className="text-[10px] text-subtle">{result.message}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
