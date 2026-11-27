import {
  Activity,
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Clock,
  RefreshCw,
  Server,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  API_STATUS_SOURCES,
  loadServerApiStatus,
  probeApiSource,
} from '../services/apiStatusService';
import {
  getCircuitBreakerState,
  getDomainProviders,
  loadProviderPreferences,
  moveProviderPriority,
  setProviderEnabled,
} from '../services/providerRegistry';

function StatusIndicator({ state, testing, disabled }) {
  if (testing) {
    return (
      <span className="inline-flex items-center gap-1 rounded-[4px] border border-line bg-card px-2 py-0.5 text-[10px] font-medium text-muted">
        <RefreshCw className="h-3 w-3 animate-spin text-accent" strokeWidth={1.5} aria-hidden="true" />
        <span>Testando</span>
      </span>
    );
  }

  if (disabled) {
    return (
      <span className="inline-flex items-center gap-1 rounded-[4px] border border-line bg-card px-2 py-0.5 text-[10px] font-medium text-subtle">
        <Clock className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
        <span>Desativada</span>
      </span>
    );
  }

  if (state === 'online') {
    return (
      <span className="inline-flex items-center gap-1 rounded-[4px] border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">
        <CheckCircle2 className="h-3 w-3" strokeWidth={1.5} aria-hidden="true" />
        <span>OK</span>
      </span>
    );
  }

  if (state === 'not_configured') {
    return (
      <span className="inline-flex items-center gap-1 rounded-[4px] border border-line bg-card px-2 py-0.5 text-[10px] font-medium text-muted">
        <AlertCircle className="h-3 w-3 text-subtle" strokeWidth={1.5} aria-hidden="true" />
        <span>Sem chave · Não configurado</span>
      </span>
    );
  }

  if (state === 'missing_key') {
    return (
      <span className="inline-flex items-center gap-1 rounded-[4px] border border-line bg-card px-2 py-0.5 text-[10px] font-medium text-muted">
        <AlertCircle className="h-3 w-3 text-subtle" strokeWidth={1.5} aria-hidden="true" />
        <span>Sem chave</span>
      </span>
    );
  }

  if (state === 'error' || state === 'circuit_open') {
    return (
      <span className="inline-flex items-center gap-1 rounded-[4px] border border-line bg-card px-2 py-0.5 text-[10px] font-medium text-ink">
        <XCircle className="h-3 w-3 text-muted" strokeWidth={1.5} aria-hidden="true" />
        <span>{state === 'circuit_open' ? 'Pausada (5 min)' : 'Erro'}</span>
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
      lastfm: { configured: false },
      rawg: { configured: false },
      igdb: { configured: false },
      googleBooks: { configured: false },
      steamAchievements: { configured: false },
      retroachievements: { configured: false },
    },
  });
  const [providerPrefs, setProviderPrefs] = useState(() => loadProviderPreferences());
  const [resultsById, setResultsById] = useState({});
  const [testingIds, setTestingIds] = useState({});
  const [testingAll, setTestingAll] = useState(false);

  const orderedSources = useMemo(() => {
    const gamesIds = getDomainProviders('games').map((p) => p.id);
    const readingIds = getDomainProviders('reading').map((p) => p.id);
    const musicIds = getDomainProviders('music').map((p) => p.id);
    const rankMap = new Map();
    [...gamesIds, ...readingIds, ...musicIds].forEach((id, idx) => {
      if (!rankMap.has(id)) rankMap.set(id, idx);
    });
    return [...API_STATUS_SOURCES].sort((a, b) => {
      const aGames = a.domainId === 'games' ? 0 : 1;
      const bGames = b.domainId === 'games' ? 0 : 1;
      if (aGames !== bGames) return aGames - bGames;
      const rA = rankMap.has(a.id) ? rankMap.get(a.id) : 999;
      const rB = rankMap.has(b.id) ? rankMap.get(b.id) : 999;
      return rA - rB;
    });
  }, [providerPrefs]);

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
        lastfm: { configured: Boolean(res.providers?.lastfm?.configured) },
        rawg: { configured: Boolean(res.providers?.rawg?.configured) },
        igdb: { configured: Boolean(res.providers?.igdb?.configured) },
        googleBooks: { configured: Boolean(res.providers?.googleBooks?.configured) },
        steamAchievements: { configured: Boolean(res.providers?.steamAchievements?.configured) },
        retroachievements: { configured: Boolean(res.providers?.retroachievements?.configured) },
      },
    });
  }, []);

  useEffect(() => {
    refreshServerStatus();
  }, [authenticated, refreshServerStatus]);

  const handleToggleProvider = (sourceId, currentlyEnabled) => {
    const nextPrefs = setProviderEnabled(sourceId, !currentlyEnabled);
    setProviderPrefs(nextPrefs);
  };

  const handleMoveProvider = (domainId, sourceId, direction) => {
    moveProviderPriority(domainId, sourceId, direction);
    setProviderPrefs(loadProviderPreferences());
  };

  const handleTestSingle = async (sourceId) => {
    setTestingIds((prev) => ({ ...prev, [sourceId]: true }));
    try {
      if (
        sourceId === 'tmdb' ||
        sourceId === 'omdb' ||
        sourceId === 'lastfm' ||
        sourceId === 'rawg' ||
        sourceId === 'igdb' ||
        sourceId === 'googleBooks' ||
        sourceId === 'steamAchievements' ||
        sourceId === 'retroachievements'
      ) {
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
      for (const source of orderedSources) {
        if (providerPrefs.disabled?.[source.id] === true) continue;
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
        Ative, desative ou reordene a prioridade de cada fonte. Nenhuma chave de API é exibida ou editada neste painel.
      </p>

      <div className="space-y-1.5">
        {orderedSources.map((source) => {
          const enabled = providerPrefs.disabled?.[source.id] !== true;
          const result = resultsById[source.id] || null;
          const isTesting = Boolean(testingIds[source.id]);
          const circuit = getCircuitBreakerState(source.id);
          const serverConfigured = source.supportsServerProxy
            ? Boolean(serverStatus.providers?.[source.id]?.configured)
            : null;
          const domainQueue = source.domainId ? getDomainProviders(source.domainId) : [];
          const domainIdx = domainQueue.findIndex((p) => p.id === source.id);
          const canReorder = domainIdx !== -1 && domainQueue.length > 1;

          const effectiveState =
            result?.state ||
            (circuit.isOpen
              ? 'circuit_open'
              : source.serverOnlySecret && serverStatus.checked && !serverConfigured
                ? 'not_configured'
                : 'idle');

          return (
            <div
              key={source.id}
              data-testid={`api-source-row-${source.id}`}
              className={`flex flex-col gap-1.5 rounded-[4px] border border-line bg-app px-3 py-2 ${
                !enabled ? 'opacity-70' : ''
              }`}
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
                  <StatusIndicator
                    state={effectiveState}
                    testing={isTesting}
                    disabled={!enabled}
                  />
                  {canReorder && (
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        disabled={domainIdx <= 0}
                        onClick={() => handleMoveProvider(source.domainId, source.id, 'up')}
                        aria-label={`Subir prioridade de ${source.label}`}
                        className="inline-flex min-h-[34px] min-w-[28px] items-center justify-center rounded-[4px] border border-line bg-card text-muted hover:text-ink disabled:opacity-35"
                      >
                        <ArrowUp className="h-3 w-3" strokeWidth={1.5} />
                      </button>
                      <button
                        type="button"
                        disabled={domainIdx >= domainQueue.length - 1}
                        onClick={() => handleMoveProvider(source.domainId, source.id, 'down')}
                        aria-label={`Descer prioridade de ${source.label}`}
                        className="inline-flex min-h-[34px] min-w-[28px] items-center justify-center rounded-[4px] border border-line bg-card text-muted hover:text-ink disabled:opacity-35"
                      >
                        <ArrowDown className="h-3 w-3" strokeWidth={1.5} />
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    aria-label={`${enabled ? 'Desativar' : 'Ativar'} ${source.label}`}
                    onClick={() => handleToggleProvider(source.id, enabled)}
                    className={`inline-flex min-h-[34px] items-center rounded-[4px] border px-2 py-1 text-[10px] font-semibold transition-colors ${
                      enabled
                        ? 'border-accent/40 bg-accent/15 text-accent'
                        : 'border-line bg-card text-subtle'
                    }`}
                  >
                    {enabled ? 'Ativa' : 'Desativada'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTestSingle(source.id)}
                    disabled={isTesting || testingAll || !enabled}
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
                          : source.optionalServerKey
                            ? 'Não (modo público)'
                            : !source.serverOnlySecret &&
                                source.id !== 'tmdb' &&
                                source.id !== 'omdb'
                              ? 'Sem chave (proxy ativo)'
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
