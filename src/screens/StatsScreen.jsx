import {
  Award,
  BarChart2,
  CalendarRange,
  CheckCircle2,
  Clock,
  Film,
  Layers,
  Sparkles,
  Star,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { ReadingHeatmapWidget } from '../components/ReadingHeatmapWidget';
import { VectorIcon } from '../components/VectorIcon';
import { domainConfig } from '../config/domainConfig';
import { computeSpectatorMetrics } from '../lib/statsEngine';

export function StatsScreen({
  items = [],
  readingSessions = [],
  streakHistory = [],
  dailyLogs = {},
  onOpenWrapped,
}) {
  const { ui } = domainConfig;
  const { stats } = ui;
  const [rankingMode, setRankingMode] = useState('creators');

  const analytics = useMemo(() => computeSpectatorMetrics(items), [items]);
  const activeRanking =
    rankingMode === 'creators' ? analytics.topCreators : analytics.topGenres;

  return (
    <div className="space-y-4 pb-24">
      <header className="flex flex-wrap items-center justify-between gap-2 pt-2">
        <div>
          <h1
            className="text-xl font-bold text-ink sm:text-2xl"
            style={{ letterSpacing: '-0.02em', lineHeight: 1.15 }}
          >
            {stats.title}
          </h1>
          <p className="mt-0.5 text-xs text-subtle">
            Tempo em tela, episódios assistidos e memória acumulada da seu catálogo
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onOpenWrapped && (
            <button
              type="button"
              onClick={onOpenWrapped}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-accent bg-accent/15 px-3.5 py-2 text-xs font-semibold text-ink transition-colors hover:bg-accent hover:text-accent-ink"
            >
              <Sparkles className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
              <span>Cine Wrapped</span>
            </button>
          )}
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-card text-accent">
            <BarChart2 className="h-4 w-4" strokeWidth={1.5} />
          </div>
        </div>
      </header>

      {analytics.totalCount === 0 && (
        <div className="rounded-2xl border border-dashed border-line bg-card p-5 text-center">
          <p className="text-xs font-medium text-ink">{stats.emptyStatsTitle}</p>
          <p className="mt-0.5 text-[11px] text-subtle">
            {stats.emptyStatsDescription}
          </p>
        </div>
      )}

      {/* 1. HERO DE TEMPO ACUMULADO (Bento Grid Editorial) */}
      <section
        aria-label="Hero de tempo e volume acumulados"
        className="rounded-2xl border border-line bg-card p-5 space-y-4"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-accent">
              <Clock className="h-3.5 w-3.5" strokeWidth={1.5} />
              <span>Tempo Acumulado em Tela</span>
            </span>
            <p
              className="mt-1.5 text-3xl font-bold tabular-nums text-ink sm:text-4xl"
              style={{ letterSpacing: '-0.02em', lineHeight: 1.1 }}
            >
              {analytics.watchedHours} h
            </p>
            <p className="mt-1 text-xs tabular-nums text-muted">
              ~{analytics.equivalentDays} dias de cinema acumulados ({analytics.watchedMinutes} min)
            </p>
          </div>

          {analytics.topDecade && (
            <div className="rounded-xl border border-line bg-app px-3.5 py-2.5 text-right">
              <span className="block text-[10px] font-medium uppercase tracking-wider text-subtle">
                Era mais assistida
              </span>
              <span className="mt-0.5 block text-sm font-bold tabular-nums text-accent">
                {analytics.topDecade.label}
              </span>
              <span className="block text-[11px] tabular-nums text-muted">
                {analytics.topDecade.count}{' '}
                {analytics.topDecade.count === 1 ? 'obra' : 'obras'} ·{' '}
                {analytics.topDecade.watchedHours} h
              </span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2.5">
          <div className="rounded-xl border border-line bg-app p-3.5">
            <Film className="h-4 w-4 text-accent" strokeWidth={1.5} />
            <span className="mt-2 block text-lg font-bold tracking-tight tabular-nums text-ink">
              {analytics.episodesWatched}
            </span>
            <span className="mt-0.5 block text-[11px] text-subtle">
              Episódios Assistidos
            </span>
          </div>

          <div className="rounded-xl border border-line bg-app p-3.5">
            <CheckCircle2 className="h-4 w-4 text-accent" strokeWidth={1.5} />
            <span className="mt-2 block text-lg font-bold tracking-tight tabular-nums text-ink">
              {analytics.completedCount}
            </span>
            <span className="mt-0.5 block text-[11px] text-subtle">
              Obras Concluídas
            </span>
          </div>

          <div className="rounded-xl border border-line bg-app p-3.5">
            <Star className="h-4 w-4 text-accent" strokeWidth={1.5} />
            <span className="mt-2 block text-lg font-bold tracking-tight tabular-nums text-ink">
              {analytics.avgRating}
            </span>
            <span className="mt-0.5 block text-[11px] text-subtle">
              {stats.avgRatingLabel}
            </span>
          </div>
        </div>
      </section>

      {/* 2. DISTRIBUIÇÃO POR FORMATO (HORAS & TÍTULOS) */}
      <section
        aria-label="Distribuição por formato em horas e títulos"
        className="rounded-2xl border border-line bg-card p-5 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-ink">
              Distribuição por Formato (Horas &amp; Títulos)
            </h2>
            <p className="text-[11px] text-subtle">
              Comparativo entre Filmes, Séries e Animes no seu histórico
            </p>
          </div>
          <span className="text-xs font-medium tabular-nums text-muted">
            {analytics.totalCount}{' '}
            {analytics.totalCount === 1 ? 'título no catálogo' : 'títulos no catálogo'}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {analytics.formatDistribution.map((fmt) => (
            <div
              key={fmt.id}
              className="rounded-xl border border-line bg-app p-3.5 space-y-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink">
                  <VectorIcon name={fmt.icon} className="h-4 w-4 text-accent" />
                  <span>{fmt.shortLabel}</span>
                </span>
                <span className="text-xs font-bold tabular-nums text-accent">
                  {fmt.watchedHours} h
                </span>
              </div>

              <div className="flex items-center justify-between text-[11px] tabular-nums text-muted">
                <span>
                  <strong className="text-ink">{fmt.count}</strong>{' '}
                  {fmt.count === 1 ? 'obra' : 'obras'}
                </span>
                <span>
                  {fmt.episodesWatched > 0
                    ? `${fmt.episodesWatched} eps`
                    : `${fmt.completedCount} concl.`}
                </span>
              </div>

              <div className="h-2 w-full overflow-hidden rounded-full bg-line">
                <div
                  className="h-full rounded-full bg-accent transition-all duration-500 ease-out"
                  style={{ width: `${fmt.hoursBarPct || fmt.countBarPct}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 3. LINHA DO TEMPO POR DÉCADA */}
      <section
        aria-label="Linha do tempo por década"
        className="rounded-2xl border border-line bg-card p-5 space-y-3.5"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CalendarRange className="h-4 w-4 text-accent" strokeWidth={1.5} />
            <div>
              <h2 className="text-sm font-semibold text-ink">
                Linha do Tempo por Década
              </h2>
              <p className="text-[11px] text-subtle">
                Épocas do cinema e da animação mais presentes nas suas sessões
              </p>
            </div>
          </div>
        </div>

        {analytics.decadeDistribution.length === 0 ? (
          <p className="py-4 text-center text-xs text-subtle">
            Catalogue obras com ano de lançamento para visualizar sua distribuição por década.
          </p>
        ) : (
          <div className="space-y-3">
            {analytics.decadeDistribution.map((dec) => (
              <div key={dec.decade} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-xs tabular-nums">
                  <span className="font-semibold text-ink">{dec.label}</span>
                  <span className="text-muted">
                    <strong className="font-semibold text-ink">{dec.count}</strong>{' '}
                    {dec.count === 1 ? 'obra' : 'obras'} ·{' '}
                    <span className="font-semibold text-accent">
                      {dec.watchedHours} h
                    </span>
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-line">
                  <div
                    className="h-full rounded-full bg-accent transition-all duration-500 ease-out"
                    style={{ width: `${dec.barPct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 4. TOP DIRETORES, ESTÚDIOS & GÊNEROS (Baseado em horas acumuladas e obras) */}
      <section
        aria-label="Top diretores, estúdios e gêneros"
        className="rounded-2xl border border-line bg-card p-5 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Award className="h-4 w-4 text-accent" strokeWidth={1.5} />
            <h2 className="text-sm font-semibold text-ink">
              {stats.topRankingTitle}
            </h2>
          </div>

          <div className="flex rounded-xl border border-line bg-app p-1">
            <button
              type="button"
              onClick={() => setRankingMode('creators')}
              className={`min-h-[44px] rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                rankingMode === 'creators'
                  ? 'bg-accent text-accent-ink'
                  : 'text-muted hover:text-ink'
              }`}
            >
              {stats.creatorsTabLabel}
            </button>
            <button
              type="button"
              onClick={() => setRankingMode('genres')}
              className={`min-h-[44px] rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                rankingMode === 'genres'
                  ? 'bg-accent text-accent-ink'
                  : 'text-muted hover:text-ink'
              }`}
            >
              {stats.genresTabLabel}
            </button>
          </div>
        </div>

        {activeRanking.length === 0 ? (
          <p className="py-6 text-center text-xs text-subtle">
            {stats.topEmptyMessage}
          </p>
        ) : (
          <div className="space-y-3">
            {activeRanking.map((entry, index) => (
              <div key={entry.label} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-xs tabular-nums">
                  <span className="flex min-w-0 items-center gap-2 font-medium text-ink">
                    <span className="w-5 shrink-0 text-[11px] font-semibold text-accent">
                      #{index + 1}
                    </span>
                    <span className="truncate">{entry.label}</span>
                  </span>
                  <span className="shrink-0 text-muted">
                    <strong className="font-semibold text-accent">
                      {entry.hours} h
                    </strong>{' '}
                    ·{' '}
                    <strong className="font-semibold text-ink">
                      {entry.count}
                    </strong>{' '}
                    {entry.count === 1 ? stats.countSingular : stats.countPlural}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
                  <div
                    className="h-full rounded-full bg-accent transition-all duration-500 ease-out"
                    style={{ width: `${entry.pct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 5. MAPA DE SESSÕES (Dias com sessão registrada) */}
      <ReadingHeatmapWidget
        readingSessions={readingSessions}
        streakHistory={streakHistory}
        dailyLogs={dailyLogs}
      />

      {/* Panorama do Catálogo por Status */}
      <section className="rounded-2xl border border-line bg-card p-5 space-y-3.5">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-accent" strokeWidth={1.5} />
          <h2 className="text-sm font-semibold text-ink">
            {stats.statusDistributionTitle}
          </h2>
        </div>

        <div className="space-y-3">
          {analytics.statusCounts.map((status) => (
            <div key={status.id} className="space-y-1.5">
              <div className="flex items-center justify-between text-xs tabular-nums">
                <span className="inline-flex items-center gap-2 text-muted">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: status.color }}
                  />
                  {status.label}
                </span>
                <span className="font-medium text-muted">
                  <strong className="font-semibold text-ink">
                    {status.count}
                  </strong>
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-line">
                <div
                  className="h-full rounded-full transition-all duration-500 ease-out"
                  style={{
                    width: `${status.pct}%`,
                    backgroundColor: status.color,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
