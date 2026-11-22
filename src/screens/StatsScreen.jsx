import { BarChart2, Clock, Film, Sparkles, Star } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ReadingHeatmapWidget } from '../components/ReadingHeatmapWidget';
import { VectorIcon } from '../components/VectorIcon';
import { domainConfig, getStatusList } from '../config/domainConfig';
import {
  getCompletionPace,
  getWatchedEpisodesCount,
  getWatchedMinutes,
  isEpisodicWork,
} from '../utils/backlogHelpers';

function getEstimatedQueuedMinutes(item) {
  if (!item) return 0;
  if (isEpisodicWork(item)) {
    const eps = Math.max(1, Number(item.totalEpisodes) || 12);
    const epDur = Number(item.episodeDurationMinutes) || (item.workType === 'anime' ? 24 : 45);
    return eps * epDur;
  }
  return (
    Number(item.durationMinutes) ||
    Math.round((Number(item.totalSeconds) || 0) / 60) ||
    110
  );
}

export function StatsScreen({
  items = [],
  readingSessions = [],
  streakHistory = [],
  dailyLogs = {},
  onOpenWrapped,
}) {
  const { ui, cardFields, workTypes } = domainConfig;
  const { stats } = ui;
  const statuses = getStatusList();
  const [rankingMode, setRankingMode] = useState('creators');

  const analytics = useMemo(() => {
    const backlogItems = items.filter((item) => item && item.inBacklog !== false);
    const totalCount = backlogItems.length;
    const completedItems = backlogItems.filter((item) => item.status === 'completed');
    const completedCount = completedItems.length;
    const completionRate =
      totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

    const watchedMinutes = backlogItems.reduce(
      (sum, item) => sum + getWatchedMinutes(item),
      0
    );
    const watchedHours = Math.round((watchedMinutes / 60) * 10) / 10;

    const episodesWatched = backlogItems.reduce(
      (sum, item) => sum + getWatchedEpisodesCount(item),
      0
    );

    const queuedEstimatedMinutes = backlogItems
      .filter((item) => item.status === 'queued')
      .reduce((sum, item) => sum + getEstimatedQueuedMinutes(item), 0);
    const queuedHours = Math.round((queuedEstimatedMinutes / 60) * 10) / 10;

    const maxHoursBar = Math.max(watchedHours, queuedHours, 1);

    const rated = backlogItems.filter(
      (item) => typeof item[cardFields.rating] === 'number'
    );
    const avgRating = rated.length
      ? Math.round(
          rated.reduce((sum, item) => sum + item[cardFields.rating], 0) / rated.length
        )
      : null;

    const lifeFavoritesTotal = backlogItems.filter((item) => item.isPlatinum).length;

    const paces = completedItems
      .map((item) =>
        getCompletionPace(item.startDate, item.completedDate, getWatchedMinutes(item))
      )
      .filter(Boolean);

    const avgDays = paces.length
      ? Math.round(
          (paces.reduce((sum, pace) => sum + pace.days, 0) / paces.length) * 10
        ) / 10
      : null;

    const statusCounts = statuses.map((status) => {
      const count = backlogItems.filter((item) => item.status === status.id).length;
      const pct = totalCount > 0 ? Math.round((count / totalCount) * 100) : 0;
      return { ...status, count, pct };
    });

    const workTypeCounts = workTypes.map((type) => {
      const count = backlogItems.filter(
        (item) => (item.workType || 'movie') === type.id
      ).length;
      const pct = totalCount > 0 ? Math.round((count / totalCount) * 100) : 0;
      return { ...type, count, pct };
    });

    const buildRanking = (extractKeys) => {
      const map = new Map();
      backlogItems.forEach((item) => {
        const keys = extractKeys(item);
        const mins = getWatchedMinutes(item);
        keys.forEach((key) => {
          const current = map.get(key) || { label: key, count: 0, mins: 0 };
          map.set(key, {
            label: key,
            count: current.count + 1,
            mins: current.mins + mins,
          });
        });
      });

      const sorted = Array.from(map.values())
        .sort((a, b) => b.count - a.count || b.mins - a.mins)
        .slice(0, 5);

      const maxCount = sorted[0]?.count || 1;
      return sorted.map((entry) => ({
        ...entry,
        pct: Math.round((entry.count / maxCount) * 100),
      }));
    };

    const topCreators = buildRanking((item) => {
      const raw = item.director || item.studio || item[cardFields.creator] || '';
      return raw
        ? String(raw)
            .split(/[;,]/)
            .map((c) => c.trim())
            .filter(Boolean)
        : [];
    });

    const topGenres = buildRanking((item) =>
      Array.isArray(item[cardFields.genres]) ? item[cardFields.genres] : []
    );

    return {
      totalCount,
      completedCount,
      completionRate,
      watchedHours,
      watchedMinutes,
      episodesWatched,
      queuedHours,
      watchedBarPct:
        watchedHours > 0 ? Math.max(4, Math.round((watchedHours / maxHoursBar) * 100)) : 0,
      queuedBarPct:
        queuedHours > 0 ? Math.max(4, Math.round((queuedHours / maxHoursBar) * 100)) : 0,
      avgRating: avgRating !== null ? `${avgRating}/100` : '—',
      lifeFavoritesTotal,
      avgDays: avgDays !== null ? `${avgDays} d` : '—',
      statusCounts,
      workTypeCounts,
      topCreators,
      topGenres,
    };
  }, [
    items,
    statuses,
    workTypes,
    cardFields.creator,
    cardFields.rating,
    cardFields.genres,
  ]);

  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset =
    circumference - (analytics.completionRate / 100) * circumference;

  const activeRanking =
    rankingMode === 'creators' ? analytics.topCreators : analytics.topGenres;

  return (
    <div className="space-y-4 pb-24">
      <header className="flex flex-wrap items-center justify-between gap-2 pt-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">
            {stats.title}
          </h1>
          <p className="mt-0.5 text-xs text-subtle">{stats.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {onOpenWrapped && (
            <button
              type="button"
              onClick={onOpenWrapped}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[4px] border border-accent bg-accent/15 px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-accent hover:text-accent-ink"
            >
              <Sparkles className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
              <span>Cine Wrapped</span>
            </button>
          )}
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-card text-accent">
            <BarChart2 className="h-4 w-4" strokeWidth={1.5} />
          </div>
        </div>
      </header>

      {analytics.totalCount === 0 && (
        <div className="rounded-2xl border border-dashed border-line bg-card p-4 text-center">
          <p className="text-xs font-medium text-ink">{stats.emptyStatsTitle}</p>
          <p className="mt-0.5 text-[11px] text-subtle">
            {stats.emptyStatsDescription}
          </p>
        </div>
      )}

      {/* Sala de Projeção */}
      <section className="rounded-2xl border border-line bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink">
          {stats.hallOfFameTitle}
        </h2>
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-line bg-app p-3">
            <Star className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
            <span className="mt-2 block text-base font-semibold tracking-tight tabular-nums text-ink">
              {analytics.avgRating}
            </span>
            <span className="mt-0.5 block text-[10px] text-subtle">
              {stats.avgRatingLabel}
            </span>
          </div>

          <div className="rounded-xl border border-line bg-app p-3">
            <Film className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
            <span className="mt-2 block text-base font-semibold tracking-tight tabular-nums text-ink">
              {analytics.episodesWatched}
            </span>
            <span className="mt-0.5 block text-[10px] text-subtle">
              {stats.episodesWatchedLabel}
            </span>
          </div>

          <div className="rounded-xl border border-line bg-app p-3">
            <Clock className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
            <span className="mt-2 block text-base font-semibold tracking-tight tabular-nums text-ink">
              {analytics.avgDays}
            </span>
            <span className="mt-0.5 block text-[10px] text-subtle">
              Média p/ concluir
            </span>
          </div>
        </div>
      </section>

      <ReadingHeatmapWidget
        readingSessions={readingSessions}
        streakHistory={streakHistory}
        dailyLogs={dailyLogs}
      />

      {/* Tempo em Tela */}
      <section className="rounded-2xl border border-line bg-card p-4">
        <div className="mb-3.5">
          <h2 className="text-sm font-semibold text-ink">
            {stats.timeBalanceTitle}
          </h2>
          <p className="text-[11px] text-subtle">{stats.timeBalanceSubtitle}</p>
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs tabular-nums">
              <span className="text-muted">{stats.watchedHoursLabel}</span>
              <span className="font-semibold text-accent">
                {analytics.watchedHours} {stats.hoursUnit}
              </span>
            </div>
            <svg viewBox="0 0 100 6" className="h-2.5 w-full overflow-hidden rounded-full">
              <rect x="0" y="0" width="100" height="6" rx="3" fill="var(--border-subtle)" />
              <rect
                x="0"
                y="0"
                width={analytics.watchedBarPct}
                height="6"
                rx="3"
                fill="var(--accent-color)"
                className="transition-all duration-500 ease-out"
              />
            </svg>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs tabular-nums">
              <span className="text-muted">{stats.queuedHoursLabel}</span>
              <span className="font-semibold text-ink">
                {analytics.queuedHours} {stats.hoursUnit}
              </span>
            </div>
            <svg viewBox="0 0 100 6" className="h-2.5 w-full overflow-hidden rounded-full">
              <rect x="0" y="0" width="100" height="6" rx="3" fill="var(--border-subtle)" />
              <rect
                x="0"
                y="0"
                width={analytics.queuedBarPct}
                height="6"
                rx="3"
                fill="var(--text-subtle)"
                className="transition-all duration-500 ease-out"
              />
            </svg>
          </div>
        </div>
      </section>

      {/* Taxa de Conclusão */}
      <section className="rounded-2xl border border-line bg-card p-4">
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-ink">
            {stats.completionRateTitle}
          </h2>
          <p className="text-[11px] text-subtle">
            {stats.completionRateSubtitle}
          </p>
        </div>

        <div className="flex items-center gap-5">
          <div className="relative h-28 w-28 shrink-0">
            <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
              <circle
                cx="60"
                cy="60"
                r={radius}
                fill="none"
                stroke="var(--border-subtle)"
                strokeWidth="12"
              />
              <circle
                cx="60"
                cy="60"
                r={radius}
                fill="none"
                stroke="var(--accent-color)"
                strokeWidth="12"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                className="transition-all duration-700 ease-out"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl font-semibold tracking-tight tabular-nums text-ink">
                {analytics.completionRate}%
              </span>
            </div>
          </div>

          <div className="flex-1 space-y-2.5">
            <div className="flex items-center justify-between rounded-xl border border-line bg-app px-3 py-2 tabular-nums">
              <span className="text-xs text-muted">{stats.completedLabel}</span>
              <span className="text-sm font-semibold text-accent">
                {analytics.completedCount}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-line bg-app px-3 py-2 tabular-nums">
              <span className="text-xs text-muted">{stats.totalLabel}</span>
              <span className="text-sm font-semibold text-ink">
                {analytics.totalCount}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Distribuição por Formato */}
      <section className="rounded-2xl border border-line bg-card p-4">
        <h2 className="mb-3.5 text-sm font-semibold text-ink">
          {stats.workTypeDistributionTitle}
        </h2>
        <div className="grid grid-cols-3 gap-2">
          {analytics.workTypeCounts.map((type) => (
            <div
              key={type.id}
              className="rounded-xl border border-line bg-app p-3"
            >
              <VectorIcon name={type.icon} className="h-3.5 w-3.5 text-accent" />
              <span className="mt-2 block text-base font-semibold tracking-tight tabular-nums text-ink">
                {type.count}
              </span>
              <span className="mt-0.5 block truncate text-[10px] text-subtle">
                {type.shortLabel}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Distribuição por Status */}
      <section className="rounded-2xl border border-line bg-card p-4">
        <h2 className="mb-3.5 text-sm font-semibold text-ink">
          {stats.statusDistributionTitle}
        </h2>

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
                  </strong>{' '}
                  ({status.pct}%)
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

      {/* Top Direção / Estúdios & Gêneros */}
      <section className="rounded-2xl border border-line bg-card p-4">
        <div className="mb-3.5 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">
            {stats.topRankingTitle}
          </h2>

          <div className="flex rounded-xl border border-line bg-app p-0.5">
            <button
              type="button"
              onClick={() => setRankingMode('creators')}
              className={`min-h-[34px] rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors ${
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
              className={`min-h-[34px] rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors ${
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
                    <span className="w-4 shrink-0 text-[11px] text-subtle">
                      #{index + 1}
                    </span>
                    <span className="truncate">{entry.label}</span>
                  </span>
                  <span className="shrink-0 text-muted">
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
    </div>
  );
}
