import {
  Award,
  BarChart2,
  CalendarRange,
  CheckCircle2,
  Clock,
  Film,
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
  const [breakdownTab, setBreakdownTab] = useState('format');

  const analytics = useMemo(() => computeSpectatorMetrics(items), [items]);
  const activeRanking = (
    rankingMode === 'creators' ? analytics.topCreators : analytics.topGenres
  ).slice(0, 5);

  return (
    <div className="space-y-3 pb-20">
      <header className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div>
          <h1
            className="text-xl font-bold text-ink sm:text-2xl"
            style={{ letterSpacing: '-0.02em', lineHeight: 1.15 }}
          >
            {stats.title}
          </h1>
          <p className="mt-0.5 text-xs text-subtle">
            Painel compacto de tempo em tela, episódios vistos e memória do catálogo
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onOpenWrapped && (
            <button
              type="button"
              onClick={onOpenWrapped}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-accent bg-accent/15 px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-accent hover:text-accent-ink"
            >
              <Sparkles className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
              <span>Cine Wrapped (PNG)</span>
            </button>
          )}
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-card text-accent">
            <BarChart2 className="h-4 w-4" strokeWidth={1.5} />
          </div>
        </div>
      </header>

      {analytics.totalCount === 0 && (
        <div className="rounded-xl border border-dashed border-line bg-card p-4 text-center">
          <p className="text-xs font-medium text-ink">{stats.emptyStatsTitle}</p>
          <p className="mt-0.5 text-[11px] text-subtle">
            {stats.emptyStatsDescription}
          </p>
        </div>
      )}

      {/* LINHA 1: 4 KPIs Horizontais Compactos ("Zero-Scroll") */}
      <section
        aria-label="Indicadores principais do espectador"
        className="grid grid-cols-2 gap-2.5 sm:grid-cols-4"
      >
        <div className="rounded-xl border border-line bg-card p-3">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-accent">
              Horas em Tela
            </span>
            <Clock className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
          </div>
          <p className="mt-1 text-xl font-bold tabular-nums text-ink sm:text-2xl">
            {analytics.watchedHours} h
          </p>
          <p className="text-[10px] tabular-nums text-muted">
            Tempo Acumulado em Tela · ~{analytics.equivalentDays}d
          </p>
        </div>

        <div className="rounded-xl border border-line bg-card p-3">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-subtle">
              Episódios Vistos
            </span>
            <Film className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
          </div>
          <p className="mt-1 text-xl font-bold tabular-nums text-ink sm:text-2xl">
            {analytics.episodesWatched}
          </p>
          <p className="text-[10px] tabular-nums text-muted">
            {analytics.inProgressCount} em andamento
          </p>
        </div>

        <div className="rounded-xl border border-line bg-card p-3">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-subtle">
              Obras Concluídas
            </span>
            <CheckCircle2 className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
          </div>
          <p className="mt-1 text-xl font-bold tabular-nums text-ink sm:text-2xl">
            {analytics.completedCount}
          </p>
          <p className="text-[10px] tabular-nums text-muted">
            de {analytics.totalCount} no catálogo
          </p>
        </div>

        <div className="rounded-xl border border-line bg-card p-3">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-subtle">
              Média Geral
            </span>
            <Star className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
          </div>
          <p className="mt-1 text-xl font-bold tabular-nums text-ink sm:text-2xl">
            {analytics.avgRating}
          </p>
          <p className="text-[10px] tabular-nums text-muted">
            {analytics.topDecade
              ? `Era: ${analytics.topDecade.label}`
              : stats.avgRatingLabel}
          </p>
        </div>
      </section>

      {/* LINHA 2: Grid 2 Colunas no Desktop / Empilhado Compacto no Mobile */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* Coluna A: Horas por Formato + Décadas (alternáveis em abas internas) */}
        <section
          aria-label="Distribuição por formato e década"
          className="rounded-xl border border-line bg-card p-4 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-ink">
                {breakdownTab === 'format'
                  ? 'Distribuição por Formato (Horas & Títulos)'
                  : 'Linha do Tempo por Década'}
              </h2>
              <span className="sr-only">
                Distribuição por Formato (Horas &amp; Títulos) · Linha do Tempo por Década
              </span>
            </div>

            <div className="inline-flex rounded-lg border border-line bg-app p-0.5">
              <button
                type="button"
                onClick={() => setBreakdownTab('format')}
                className={`min-h-[34px] rounded-md px-2.5 text-[11px] font-semibold transition-colors ${
                  breakdownTab === 'format'
                    ? 'bg-accent text-accent-ink'
                    : 'text-muted hover:text-ink'
                }`}
              >
                Formatos
              </button>
              <button
                type="button"
                onClick={() => setBreakdownTab('decades')}
                className={`min-h-[34px] rounded-md px-2.5 text-[11px] font-semibold transition-colors ${
                  breakdownTab === 'decades'
                    ? 'bg-accent text-accent-ink'
                    : 'text-muted hover:text-ink'
                }`}
              >
                Décadas
              </button>
            </div>
          </div>

          {breakdownTab === 'format' ? (
            <div className="space-y-2.5">
              {analytics.formatDistribution.map((fmt) => (
                <div
                  key={fmt.id}
                  className="rounded-lg border border-line bg-app px-3 py-2 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2 text-xs tabular-nums">
                    <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
                      <VectorIcon name={fmt.icon} className="h-3.5 w-3.5 text-accent" />
                      <span>{fmt.shortLabel}</span>
                    </span>
                    <span className="text-muted">
                      <strong className="text-accent">{fmt.watchedHours} h</strong> ·{' '}
                      <strong className="text-ink">{fmt.count}</strong>{' '}
                      {fmt.count === 1 ? 'obra' : 'obras'}
                      {fmt.episodesWatched > 0 ? ` · ${fmt.episodesWatched} eps` : ''}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
                    <div
                      className="h-full rounded-full bg-accent transition-all duration-300"
                      style={{ width: `${fmt.hoursBarPct || fmt.countBarPct}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : analytics.decadeDistribution.length === 0 ? (
            <p className="py-4 text-center text-xs text-subtle">
              Catalogue obras com ano de lançamento para ver as décadas.
            </p>
          ) : (
            <div className="space-y-2">
              {analytics.decadeDistribution.slice(0, 6).map((dec) => (
                <div key={dec.decade} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-xs tabular-nums">
                    <span className="inline-flex items-center gap-1 font-semibold text-ink">
                      <CalendarRange className="h-3 w-3 text-accent" strokeWidth={1.5} />
                      <span>{dec.label}</span>
                    </span>
                    <span className="text-muted">
                      <strong className="text-ink">{dec.count}</strong>{' '}
                      {dec.count === 1 ? 'obra' : 'obras'} ·{' '}
                      <strong className="text-accent">{dec.watchedHours} h</strong>
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
                    <div
                      className="h-full rounded-full bg-accent transition-all duration-300"
                      style={{ width: `${dec.barPct}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Coluna B: Top 5 Diretores / Estúdios / Gêneros */}
        <section
          aria-label="Top 5 diretores, estúdios e gêneros"
          className="rounded-xl border border-line bg-card p-4 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Award className="h-4 w-4 text-accent" strokeWidth={1.5} />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-ink">
                Top 5 · {rankingMode === 'creators' ? stats.creatorsTabLabel : stats.genresTabLabel}
              </h2>
            </div>

            <div className="inline-flex rounded-lg border border-line bg-app p-0.5">
              <button
                type="button"
                onClick={() => setRankingMode('creators')}
                className={`min-h-[34px] rounded-md px-2.5 text-[11px] font-semibold transition-colors ${
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
                className={`min-h-[34px] rounded-md px-2.5 text-[11px] font-semibold transition-colors ${
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
            <div className="space-y-2.5">
              {activeRanking.map((entry, index) => (
                <div key={entry.label} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-xs tabular-nums">
                    <span className="flex min-w-0 items-center gap-1.5 font-medium text-ink">
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
                      className="h-full rounded-full bg-accent transition-all duration-300"
                      style={{ width: `${entry.pct}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* LINHA 3: Mapa de Sessões Horizontal Compacto + Cine Wrapped (PNG) */}
      <div className="space-y-2.5">
        <ReadingHeatmapWidget
          readingSessions={readingSessions}
          streakHistory={streakHistory}
          dailyLogs={dailyLogs}
        />

        {onOpenWrapped && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-card px-4 py-2.5">
            <div className="flex items-center gap-2 text-xs text-muted">
              <Sparkles className="h-4 w-4 text-accent" strokeWidth={1.5} />
              <span>Exportar resumo visual do seu catálogo em alta definição</span>
            </div>
            <button
              type="button"
              onClick={onOpenWrapped}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-xs font-semibold text-accent-ink hover:opacity-90"
            >
              <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} />
              <span>Gerar Cine Wrapped (PNG)</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
