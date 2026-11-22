import { CalendarDays } from 'lucide-react';
import { useMemo, useState } from 'react';
import { buildReadingHeatmap } from '../utils/readingCheckIn';

const LEVEL_STYLES = {
  0: 'color-mix(in srgb, var(--border-subtle) 45%, var(--bg-app))',
  1: 'color-mix(in srgb, var(--accent-color) 28%, var(--bg-app))',
  2: 'color-mix(in srgb, var(--accent-color) 52%, var(--bg-app))',
  3: 'color-mix(in srgb, var(--accent-color) 76%, var(--bg-app))',
  4: 'var(--accent-color)',
};

const PATTERN_FOR_LEVEL = {
  2: 'url(#codice-hm-pat-2)',
  3: 'url(#codice-hm-pat-3)',
  4: 'url(#codice-hm-pat-4)',
};

export function ReadingHeatmapWidget({
  readingSessions = [],
  streakHistory = [],
  dailyLogs = {},
}) {
  const [weeksSpan, setWeeksSpan] = useState(16);
  const [selectedCell, setSelectedCell] = useState(null);

  const heatmap = useMemo(
    () =>
      buildReadingHeatmap({
        readingSessions,
        streakHistory,
        dailyLogs,
        weeks: weeksSpan,
      }),
    [readingSessions, streakHistory, dailyLogs, weeksSpan]
  );

  const displayedCell = useMemo(() => {
    if (!selectedCell) {
      for (let c = heatmap.columns.length - 1; c >= 0; c -= 1) {
        for (let r = heatmap.columns[c].length - 1; r >= 0; r -= 1) {
          if (heatmap.columns[c][r].isToday) {
            return heatmap.columns[c][r];
          }
        }
      }
      return null;
    }
    for (const col of heatmap.columns) {
      const match = col.find((cell) => cell.date === selectedCell);
      if (match) return match;
    }
    return null;
  }, [heatmap, selectedCell]);

  const cellSize = 14;
  const gap = 3;
  const step = cellSize + gap;
  const svgWidth = Math.max(100, heatmap.columns.length * step - gap + 2);
  const svgHeight = 7 * step - gap + 2;
  const totalHours = Math.round(((heatmap.totalMinutes || 0) / 60) * 10) / 10;

  return (
    <section
      aria-label="Mapa de Calor de Sessões"
      className="rounded-2xl border border-line bg-card p-4 space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-accent" strokeWidth={1.5} />
          <div>
            <h2 className="text-sm font-semibold text-ink">
              Mapa de Calor Anual
            </h2>
            <p className="text-[11px] tabular-nums text-subtle">
              {heatmap.activeDays} {heatmap.activeDays === 1 ? 'dia ativo' : 'dias ativos'} ·{' '}
              {heatmap.totalMinutes} min ({totalHours}h) no período
            </p>
          </div>
        </div>

        <div
          role="group"
          aria-label="Período do mapa de calor"
          className="inline-flex rounded-[4px] border border-line bg-app p-0.5"
        >
          {[
            { weeks: 16, label: '16 sem.' },
            { weeks: 52, label: 'Ano' },
          ].map((option) => {
            const active = weeksSpan === option.weeks;
            return (
              <button
                key={option.weeks}
                type="button"
                aria-pressed={active}
                onClick={() => setWeeksSpan(option.weeks)}
                className={`min-h-[36px] rounded-[2px] px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  active
                    ? 'bg-accent text-accent-ink'
                    : 'text-muted hover:text-ink'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="overflow-x-auto pb-1 no-scrollbar">
        <svg
          role="grid"
          aria-label={`Grade de atividade das últimas ${weeksSpan} semanas`}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="block h-auto min-w-full"
          style={{ minHeight: `${Math.min(130, svgHeight)}px` }}
        >
          <defs>
            <pattern id="codice-hm-pat-2" width="4" height="4" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="0.65" fill="var(--bg-app)" fillOpacity="0.45" />
            </pattern>
            <pattern
              id="codice-hm-pat-3"
              width="4"
              height="4"
              patternTransform="rotate(45)"
              patternUnits="userSpaceOnUse"
            >
              <line x1="0" y1="0" x2="0" y2="4" stroke="var(--bg-app)" strokeOpacity="0.38" strokeWidth="1" />
            </pattern>
            <pattern
              id="codice-hm-pat-4"
              width="4"
              height="4"
              patternTransform="rotate(45)"
              patternUnits="userSpaceOnUse"
            >
              <line x1="0" y1="0" x2="0" y2="4" stroke="var(--accent-contrast, #ffffff)" strokeOpacity="0.32" strokeWidth="1" />
              <line x1="0" y1="2" x2="4" y2="2" stroke="var(--accent-contrast, #ffffff)" strokeOpacity="0.22" strokeWidth="0.7" />
            </pattern>
          </defs>

          {heatmap.columns.map((week, colIdx) => (
            <g key={week[0]?.date || colIdx} role="row">
              {week.map((cell, rowIdx) => {
                const isSelected = displayedCell?.date === cell.date;
                const x = 1 + colIdx * step;
                const y = 1 + rowIdx * step;
                const patternOverlay = !cell.isFuture ? PATTERN_FOR_LEVEL[cell.level] : null;
                return (
                  <g
                    key={cell.date}
                    role="gridcell"
                    tabIndex={cell.isFuture ? -1 : 0}
                    aria-label={cell.ariaLabel}
                    aria-selected={isSelected}
                    onClick={() => !cell.isFuture && setSelectedCell(cell.date)}
                    onFocus={() => !cell.isFuture && setSelectedCell(cell.date)}
                    onMouseEnter={() => !cell.isFuture && setSelectedCell(cell.date)}
                    onKeyDown={(e) => {
                      if (!cell.isFuture && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault();
                        setSelectedCell(cell.date);
                      }
                    }}
                    style={{
                      cursor: cell.isFuture ? 'default' : 'pointer',
                      opacity: cell.isFuture ? 0.25 : 1,
                    }}
                  >
                    <title>{cell.ariaLabel}</title>
                    <rect
                      x={x}
                      y={y}
                      width={cellSize}
                      height={cellSize}
                      rx="2"
                      fill={LEVEL_STYLES[cell.level] || LEVEL_STYLES[0]}
                      stroke={
                        isSelected
                          ? 'var(--accent-color)'
                          : cell.isToday
                            ? 'var(--text-primary)'
                            : 'transparent'
                      }
                      strokeWidth={isSelected || cell.isToday ? '1.3' : '0'}
                    />
                    {patternOverlay && (
                      <rect
                        x={x}
                        y={y}
                        width={cellSize}
                        height={cellSize}
                        rx="2"
                        fill={patternOverlay}
                        pointerEvents="none"
                      />
                    )}
                  </g>
                );
              })}
            </g>
          ))}
        </svg>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2.5 text-[11px]">
        <div className="min-w-0 text-muted" role="status">
          {displayedCell ? (
            <span className="tabular-nums">
              <strong className="font-semibold text-ink">
                {displayedCell.prettyDate}:
              </strong>{' '}
              {displayedCell.minutes > 0
                ? `${displayedCell.minutes} min em tela`
                : displayedCell.sessions > 0
                  ? 'Sessão registrada'
                  : 'Sem sessão registrada'}
              {displayedCell.episodes > 0 ? ` · ${displayedCell.episodes} ep(s)` : ''}
              {displayedCell.notes?.[0] ? ` · "${displayedCell.notes[0]}"` : ''}
            </span>
          ) : (
            <span>Toque ou navegue nos quadrados para ver os detalhes do dia.</span>
          )}
        </div>

        <div className="flex items-center gap-1 text-[10px] text-subtle" aria-hidden="true">
          <span>Menos</span>
          {[0, 1, 2, 3, 4].map((lvl) => (
            <span
              key={lvl}
              className="h-2.5 w-2.5 rounded-[2px]"
              style={{ backgroundColor: LEVEL_STYLES[lvl] }}
            />
          ))}
          <span>Mais</span>
        </div>
      </div>
    </section>
  );
}
