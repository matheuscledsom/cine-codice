import {
  Award,
  BarChart2,
  Globe2,
  Layers,
  Sparkles,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { DomainSwitcherBar } from '../components/DomainSwitcherBar';
import { ReadingHeatmapWidget } from '../components/ReadingHeatmapWidget';
import { VectorIcon } from '../components/VectorIcon';
import { getDomainMeta, normalizeDomainId } from '../config/domainConfig';
import {
  computeDomainStatsMetrics,
  computeGlobalOmniMetrics,
} from '../utils/profileMetrics';

const DOMAIN_STATS_COPY = {
  cinema: {
    subtitle:
      'Tempo Acumulado em Tela, Episódios Vistos, Obras Concluídas e Média Geral do catálogo audiovisual',
    emptyTitle: 'Sem métricas de Cinema & Séries ainda',
    emptyDescription:
      'Catalogue seu primeiro filme, série ou anime para acompanhar horas, episódios e décadas.',
    distributionAria: 'Distribuição por formato e década',
    rankingAria: 'Top 5 diretores, estúdios e gêneros',
    wrappedDescription: 'Exportar resumo visual do seu catálogo em alta definição',
  },
  reading: {
    subtitle: 'Páginas lidas, capítulos, formatos de leitura e autores mais lidos',
    emptyTitle: 'Sem métricas de Leitura & Acadêmico ainda',
    emptyDescription:
      'Catalogue seu primeiro livro, mangá, paper ou obra técnica para acompanhar seu ritmo.',
    distributionAria: 'Distribuição por tipo de leitura e formato',
    rankingAria: 'Top 5 autores e gêneros de leitura',
    wrappedDescription: 'Exportar resumo visual das suas leituras em alta definição',
  },
  games: {
    subtitle: 'Horas jogadas, zerados/100%, plataformas, edições e notas na escala 0–11',
    emptyTitle: 'Sem métricas de Games ainda',
    emptyDescription:
      'Catalogue seu primeiro jogo, remake ou expansão para acompanhar plataformas e campanhas.',
    distributionAria: 'Distribuição por plataforma e tipo de edição',
    rankingAria: 'Top 5 franquias e gêneros de games',
    wrappedDescription: 'Exportar resumo visual da sua jornada gamer em alta definição',
  },
  music: {
    subtitle: 'Álbuns, faixas, escutas acumuladas, subgêneros e artistas mais ouvidos',
    emptyTitle: 'Sem métricas de Música ainda',
    emptyDescription:
      'Catalogue seu primeiro álbum, faixa individual ou show ao vivo para ver sua discografia.',
    distributionAria: 'Distribuição por subgênero e formato musical',
    rankingAria: 'Top 5 artistas, bandas e subgêneros',
    wrappedDescription: 'Exportar resumo visual das suas audições em alta definição',
  },
  global: {
    subtitle: 'Panorama consolidado dos 4 portais do OmniPrism (Cinema, Leitura, Games e Música)',
    emptyTitle: 'Seu catálogo OmniPrism ainda está vazio',
    emptyDescription:
      'Catalogue obras em qualquer um dos 4 portais para visualizar sua visão global.',
    distributionAria: 'Distribuição global pelos 4 portais e status',
    rankingAria: 'Top 5 criadores e gêneros globais',
    wrappedDescription: 'Exportar resumo visual global do OmniPrism em alta definição',
  },
};

export function StatsScreen({
  items = [],
  activeDomain = 'cinema',
  onSelectDomain,
  themeMode = 'dark',
  readingSessions = [],
  streakHistory = [],
  dailyLogs = {},
  onOpenWrapped,
}) {
  const cleanDomain = normalizeDomainId(activeDomain);
  const domainMeta = useMemo(() => getDomainMeta(cleanDomain), [cleanDomain]);
  const [viewScope, setViewScope] = useState('domain');
  const [rankingMode, setRankingMode] = useState('primary');
  const [breakdownTab, setBreakdownTab] = useState('primary');

  useEffect(() => {
    setRankingMode('primary');
    setBreakdownTab('primary');
  }, [cleanDomain, viewScope]);

  const effectiveScopeKey = viewScope === 'global' ? 'global' : cleanDomain;
  const copy = DOMAIN_STATS_COPY[effectiveScopeKey] || DOMAIN_STATS_COPY.cinema;

  const analytics = useMemo(
    () =>
      viewScope === 'global'
        ? computeGlobalOmniMetrics(items)
        : computeDomainStatsMetrics(items, cleanDomain),
    [items, viewScope, cleanDomain]
  );

  const activeDistributionRows =
    breakdownTab === 'primary'
      ? analytics.distribution.primaryRows
      : analytics.distribution.secondaryRows;

  const activeDistributionTitle =
    breakdownTab === 'primary'
      ? analytics.distribution.primaryTitle
      : analytics.distribution.secondaryTitle;

  const activeDistributionEmpty =
    breakdownTab === 'primary'
      ? analytics.distribution.primaryEmptyMessage
      : analytics.distribution.secondaryEmptyMessage;

  const activeRankingRows = (
    rankingMode === 'primary'
      ? analytics.ranking.primaryRows
      : analytics.ranking.secondaryRows
  ).slice(0, 5);

  const activeRankingHeading =
    rankingMode === 'primary'
      ? analytics.ranking.primaryTabLabel
      : analytics.ranking.secondaryTabLabel;

  const handleOpenWrappedScoped = () => {
    onOpenWrapped?.(viewScope === 'global' ? 'global' : 'domain');
  };

  return (
    <div className="space-y-3 pb-20">
      <header className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div>
          <h1
            className="text-xl font-bold text-ink sm:text-2xl"
            style={{ letterSpacing: '-0.02em', lineHeight: 1.15 }}
          >
            Métricas · {viewScope === 'global' ? 'Visão Global OmniPrism' : domainMeta.label}
          </h1>
          <p className="mt-0.5 text-xs text-subtle">{copy.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {onOpenWrapped && (
            <button
              type="button"
              onClick={handleOpenWrappedScoped}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-accent bg-accent/15 px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-accent hover:text-accent-ink"
            >
              <Sparkles className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
              <span>Omni Wrapped (PNG)</span>
            </button>
          )}
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-card text-accent">
            <BarChart2 className="h-4 w-4" strokeWidth={1.5} />
          </div>
        </div>
      </header>

      {/* Alternador Domínio Ativo vs Visão Global OmniPrism + Portais */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div
            role="tablist"
            aria-label="Escopo das métricas"
            className="inline-flex rounded-[6px] border border-line bg-card p-0.5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={viewScope === 'domain'}
              onClick={() => setViewScope('domain')}
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-[6px] px-3 text-xs font-semibold transition-colors ${
                viewScope === 'domain'
                  ? 'bg-accent text-accent-ink'
                  : 'text-muted hover:text-ink'
              }`}
            >
              <Layers className="h-3.5 w-3.5" strokeWidth={1.5} />
              <span>{domainMeta.label}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewScope === 'global'}
              onClick={() => setViewScope('global')}
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-[6px] px-3 text-xs font-semibold transition-colors ${
                viewScope === 'global'
                  ? 'bg-accent text-accent-ink'
                  : 'text-muted hover:text-ink'
              }`}
            >
              <Globe2 className="h-3.5 w-3.5" strokeWidth={1.5} />
              <span>Visão Global OmniPrism</span>
            </button>
          </div>

          {analytics.openProgressCount > 0 && (
            <span className="text-xs font-medium tabular-nums text-muted">
              {analytics.openProgressCount}{' '}
              {analytics.openProgressCount === 1 ? 'obra em' : 'obras em'} Progresso aberto
            </span>
          )}
        </div>

        {onSelectDomain && (
          <DomainSwitcherBar
            compact
            activeDomain={cleanDomain}
            onSelectDomain={(nextDom) => {
              setViewScope('domain');
              onSelectDomain(nextDom);
            }}
            items={items}
            themeMode={themeMode}
          />
        )}
      </div>

      {analytics.totalCount === 0 && (
        <div className="border-y border-line py-4">
          <p className="text-sm text-muted">{copy.emptyTitle}</p>
        </div>
      )}

      {/* LINHA 1: 4 KPIs Horizontais Compactos ("Zero-Scroll") */}
      <section
        aria-label={`Indicadores principais de ${
          viewScope === 'global' ? 'Visão Global OmniPrism' : domainMeta.label
        }`}
        className="grid grid-cols-2 gap-2.5 sm:grid-cols-4"
      >
        {analytics.kpis.map((kpi) => (
          <div key={kpi.id} className="rounded-[6px] border border-line bg-card p-3">
            <div className="flex items-center justify-between gap-1">
              <span
                className={`text-[10px] font-semibold uppercase tracking-wider ${
                  kpi.highlight ? 'text-accent' : 'text-subtle'
                }`}
              >
                {kpi.label}
              </span>
              <VectorIcon name={kpi.icon} className="h-3.5 w-3.5 shrink-0 text-accent" />
            </div>
            <p className="mt-1 text-xl font-bold tabular-nums text-ink sm:text-2xl">
              {kpi.value}
            </p>
            <p className="text-[10px] tabular-nums text-muted">{kpi.sub}</p>
          </div>
        ))}
      </section>

      {/* LINHA 2: Grid 2 Colunas no Desktop / Empilhado Compacto no Mobile */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* Coluna A: Distribuição Dinâmica por Domínio */}
        <section
          aria-label={copy.distributionAria}
          className="rounded-xl border border-line bg-card p-4 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-ink">
                {activeDistributionTitle}
              </h2>
              {effectiveScopeKey === 'cinema' && (
                <span className="sr-only">
                  Distribuição por Formato (Horas &amp; Títulos) · Linha do Tempo por Década
                </span>
              )}
            </div>

            <div className="inline-flex rounded-lg border border-line bg-app p-0.5">
              <button
                type="button"
                onClick={() => setBreakdownTab('primary')}
                className={`min-h-[44px] rounded-[6px] px-3 text-xs font-semibold transition-colors ${
                  breakdownTab === 'primary'
                    ? 'bg-accent text-accent-ink'
                    : 'text-muted hover:text-ink'
                }`}
              >
                {analytics.distribution.primaryTabLabel}
              </button>
              <button
                type="button"
                onClick={() => setBreakdownTab('secondary')}
                className={`min-h-[44px] rounded-[6px] px-3 text-xs font-semibold transition-colors ${
                  breakdownTab === 'secondary'
                    ? 'bg-accent text-accent-ink'
                    : 'text-muted hover:text-ink'
                }`}
              >
                {analytics.distribution.secondaryTabLabel}
              </button>
            </div>
          </div>

          {activeDistributionRows.length === 0 ? (
            <p className="py-4 text-center text-xs text-subtle">
              {activeDistributionEmpty}
            </p>
          ) : (
            <div className="space-y-2.5">
              {activeDistributionRows.map((row) => (
                <div
                  key={row.key}
                  className="rounded-lg border border-line bg-app px-3 py-2 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2 text-xs tabular-nums">
                    <span className="inline-flex min-w-0 items-center gap-1.5 font-semibold text-ink">
                      <VectorIcon
                        name={row.icon || 'Layers'}
                        className="h-3.5 w-3.5 shrink-0 text-accent"
                      />
                      <span className="truncate">{row.label}</span>
                    </span>
                    <span className="shrink-0 text-muted">
                      <strong className="text-accent">{row.primaryMetric}</strong> ·{' '}
                      <span className="text-ink">{row.secondaryMetric}</span>
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
                    <div
                      className="h-full rounded-full bg-accent transition-all duration-300"
                      style={{ width: `${row.barPct}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Coluna B: Top 5 Dinâmico (Diretores / Estúdios / Autores / Franquias / Artistas & Gêneros) */}
        <section
          aria-label={copy.rankingAria}
          className="rounded-xl border border-line bg-card p-4 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Award className="h-4 w-4 text-accent" strokeWidth={1.5} />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-ink">
                Top 5 · {activeRankingHeading}
              </h2>
            </div>

            <div className="inline-flex rounded-lg border border-line bg-app p-0.5">
              <button
                type="button"
                onClick={() => setRankingMode('primary')}
                className={`min-h-[44px] rounded-[6px] px-3 text-xs font-semibold transition-colors ${
                  rankingMode === 'primary'
                    ? 'bg-accent text-accent-ink'
                    : 'text-muted hover:text-ink'
                }`}
              >
                {analytics.ranking.primaryTabLabel}
              </button>
              <button
                type="button"
                onClick={() => setRankingMode('secondary')}
                className={`min-h-[44px] rounded-[6px] px-3 text-xs font-semibold transition-colors ${
                  rankingMode === 'secondary'
                    ? 'bg-accent text-accent-ink'
                    : 'text-muted hover:text-ink'
                }`}
              >
                {analytics.ranking.secondaryTabLabel}
              </button>
            </div>
          </div>

          {activeRankingRows.length === 0 ? (
            <p className="py-6 text-center text-xs text-subtle">
              Sem dados suficientes ainda.
            </p>
          ) : (
            <div className="space-y-2.5">
              {activeRankingRows.map((entry, index) => (
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
                        {entry.metricText}
                      </strong>{' '}
                      ·{' '}
                      <strong className="font-semibold text-ink">
                        {entry.count}
                      </strong>{' '}
                      {entry.countLabel}
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

      {/* LINHA 3: Mapa de Sessões Horizontal Compacto + Omni Wrapped (PNG) */}
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
              <span>{copy.wrappedDescription}</span>
            </div>
            <button
              type="button"
              onClick={handleOpenWrappedScoped}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[6px] bg-accent px-4 py-2 text-xs font-semibold text-accent-ink hover:opacity-90"
            >
              <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} />
              <span>Gerar Omni Wrapped (PNG)</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
