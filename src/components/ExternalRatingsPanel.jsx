import {
  AlertTriangle,
  Award,
  BarChart3,
  KeyRound,
  RefreshCw,
  WifiOff,
} from 'lucide-react';
import { computeWorkCritiqueBadge } from '../lib/ratingBadges';
import { buildExternalRatingsViewModel } from '../lib/ratings';

function formatVotesCompact(votes) {
  const n = Number(votes);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

export function ExternalRatingsPanel({
  item,
  loading = false,
  failedSources = [],
  omdbMissingKey = false,
  isOfflineCache = false,
  cacheDateLabel = '',
  hasAttempted = false,
  onRetryRefresh,
  onOpenApiSettings,
}) {
  if (!item) return null;

  const vm = buildExternalRatingsViewModel(item, {
    loading,
    failedSources,
    omdbMissingKey,
    isOfflineCache,
    cacheDateLabel,
    hasAttempted,
  });
  const critiqueBadge = computeWorkCritiqueBadge(item);

  const showBadges = vm.badges.length > 0;
  const showSkeletons = vm.skeletonSourceIds.length > 0;

  return (
    <section
      aria-label="Notas do Público e Comparativo"
      className="mt-4 space-y-3 rounded-[6px] border border-line bg-app p-3.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <BarChart3 className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />
          <h4 className="text-xs font-semibold uppercase tracking-wider text-ink">
            Notas do Público
          </h4>
        </div>

        {vm.hasAnyIds && onRetryRefresh && (
          <button
            type="button"
            disabled={loading}
            onClick={onRetryRefresh}
            aria-label="Atualizar notas públicas"
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[4px] border border-line bg-card px-3 text-[11px] font-medium text-ink transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 text-accent ${loading ? 'motion-safe:animate-spin' : ''}`}
              strokeWidth={1.5}
            />
            <span>{loading ? 'Buscando...' : 'Atualizar'}</span>
          </button>
        )}
      </div>

      {/* Selos individuais por fonte + skeletons individuais enquanto carrega */}
      {(showBadges || showSkeletons) && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {vm.badges.map((badge) => {
            const votesShort = formatVotesCompact(badge.votes);
            const dateLabel = badge.fetchedDateLabel || vm.cacheDateLabel;
            return (
              <div
                key={badge.id}
                className="flex flex-col justify-between rounded-[4px] border border-line bg-card px-2.5 py-2 min-w-0"
              >
                <div className="flex items-baseline justify-between gap-1.5">
                  <span className="truncate text-[11px] font-medium text-muted">
                    {badge.label}
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-ink">
                    {badge.formattedValue}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-1 text-[10px] tabular-nums text-subtle">
                  <span>
                    {dateLabel ? `Coletado ${dateLabel}` : 'Fonte pública'}
                  </span>
                  {votesShort && <span>{votesShort}</span>}
                </div>
              </div>
            );
          })}

          {vm.skeletonSourceIds.map((sk) => (
            <div
              key={`sk-${sk.id}`}
              aria-label={`Carregando nota ${sk.label}`}
              className="flex flex-col justify-between rounded-[4px] border border-line/70 bg-card px-2.5 py-2 motion-safe:animate-pulse"
            >
              <div className="flex items-center justify-between gap-1.5">
                <span className="text-[11px] font-medium text-subtle">{sk.label}</span>
                <span className="h-4 w-9 rounded bg-elevated" />
              </div>
              <div className="mt-1.5 h-2.5 w-16 rounded bg-elevated/80" />
            </div>
          ))}
        </div>
      )}

      {/* Estado offline servindo cache */}
      {vm.state === 'offline' && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-line bg-card px-3 py-2 text-[11px] text-muted"
        >
          <span className="inline-flex items-center gap-1.5 tabular-nums">
            <WifiOff className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.5} />
            <span>
              Sem conexão — exibindo dados de {vm.cacheDateLabel || 'cache anterior'}.
            </span>
          </span>
        </div>
      )}

      {/* Estado de erro completo (0 selos obtidos) */}
      {vm.state === 'error' && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-line bg-card px-3 py-2.5 text-xs text-muted"
        >
          <span className="inline-flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />
            <span>Não foi possível carregar as notas públicas agora.</span>
          </span>
          {onRetryRefresh && (
            <button
              type="button"
              onClick={onRetryRefresh}
              className="min-h-[44px] rounded-[4px] border border-accent bg-accent/10 px-3 text-[11px] font-semibold text-accent hover:bg-accent hover:text-accent-ink"
            >
              Tentar de novo
            </button>
          )}
        </div>
      )}

      {/* Estado vazio (nenhuma fonte disponível após busca ou obra manual sem IDs) */}
      {vm.state === 'empty' && !loading && (
        <p className="rounded-[4px] border border-dashed border-line bg-card px-3 py-2.5 text-[11px] text-muted">
          {vm.hasAnyIds
            ? 'Nenhuma nota pública encontrada para esta obra nas fontes consultadas.'
            : 'Obra cadastrada sem identificador externo (TMDB, IMDb, AniList ou MAL).'}
        </p>
      )}

      {/* Aviso parcial de falha isolada de fonte */}
      {vm.state === 'partial' && vm.failedSources.length > 0 && !loading && (
        <p className="text-[11px] text-muted">
          Algumas fontes não responderam ({vm.failedSources.join(', ').toUpperCase()}).
        </p>
      )}

      {/* Aviso claro quando a OMDb está sem chave configurada (D3) */}
      {vm.omdbMissingKey && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-line bg-card px-3 py-2 text-[11px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <KeyRound className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.5} />
            <span>
              Notas de IMDb, Rotten Tomatoes e Metacritic precisam de chave gratuita da OMDb.
            </span>
          </span>
          {onOpenApiSettings && (
            <button
              type="button"
              onClick={onOpenApiSettings}
              className="min-h-[44px] rounded-[4px] border border-line bg-app px-3 text-[11px] font-semibold text-accent hover:border-accent"
            >
              Configurar chave OMDb
            </button>
          )}
        </div>
      )}

      {/* Comparativo "Sua Nota vs. Público" (apenas nota confirmada != legacy-default + >= 1 fonte) */}
      {vm.comparison && (
        <div
          aria-label="Sua Nota vs. Público"
          className="rounded-[4px] border border-accent/35 bg-card px-3 py-2.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-semibold text-ink">
              Sua Nota vs. Público
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {critiqueBadge && (
                <span className="inline-flex items-center gap-1 rounded-[4px] border border-accent bg-accent/20 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-accent">
                  <Award className="h-3 w-3" strokeWidth={1.5} />
                  <span>
                    {critiqueBadge.label} ({critiqueBadge.detail})
                  </span>
                </span>
              )}
              <span className="rounded-[4px] border border-accent/40 bg-accent/15 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-accent">
                {vm.comparison.alignmentText}
              </span>
            </div>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-4 text-[11px] tabular-nums text-muted">
            <span>
              Sua nota:{' '}
              <strong className="font-semibold text-ink">
                {vm.comparison.userScore100}/100
              </strong>
            </span>
            <span>
              Público ({vm.comparison.sourceCount}{' '}
              {vm.comparison.sourceCount === 1 ? 'fonte' : 'fontes'}):{' '}
              <strong className="font-semibold text-ink">
                {vm.comparison.publicAverage100}/100
              </strong>
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
