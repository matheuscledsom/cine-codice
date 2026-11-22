import { Check, Star } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { domainConfig } from '../config/domainConfig';
import { calculateWorkProgress, getDisplayTitles } from '../utils/backlogHelpers';
import { extractDominantColor, hashFallbackPalette } from './dominantColor.js';
import { computeSpineMetrics } from './spineMetrics.js';

export { computeSpineMetrics };

function TapeSpine({
  item,
  titleMode,
  selected = false,
  selectionMode = false,
  onSelect,
  onLongPress,
}) {
  const key = String(item.id || item.title || 'cine');
  const initialPalette = useMemo(() => hashFallbackPalette(key), [key]);
  const [palette, setPalette] = useState(initialPalette);
  const pressTimerRef = useRef(null);
  const longPressedRef = useRef(false);

  const coverCandidate =
    item.coverUrl ||
    (Array.isArray(item.coverCandidates) ? item.coverCandidates[0] : null) ||
    null;

  useEffect(() => {
    let active = true;
    setPalette(initialPalette);
    if (coverCandidate) {
      extractDominantColor(coverCandidate, key).then((resolved) => {
        if (active && resolved) setPalette(resolved);
      });
    }
    return () => {
      active = false;
    };
  }, [coverCandidate, initialPalette, key]);

  const metrics = useMemo(() => computeSpineMetrics(item), [item]);
  const titles = getDisplayTitles(item, titleMode);
  const creator = item[domainConfig.cardFields.creator] || item.studio || '';
  const progress = calculateWorkProgress(item);
  const typeTag =
    item.workType === 'anime' ? 'ANM' : item.workType === 'series' ? 'SER' : 'VHS';

  const clearPressTimer = () => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  };

  const handlePointerDown = () => {
    longPressedRef.current = false;
    if (!onLongPress) return;
    clearPressTimer();
    pressTimerRef.current = setTimeout(() => {
      longPressedRef.current = true;
      onLongPress(item);
    }, 450);
  };

  const handleClick = () => {
    if (longPressedRef.current) {
      longPressedRef.current = false;
      return;
    }
    onSelect?.(item);
  };

  return (
    <button
      type="button"
      onPointerDown={handlePointerDown}
      onPointerUp={clearPressTimer}
      onPointerLeave={clearPressTimer}
      onPointerCancel={clearPressTimer}
      onClick={handleClick}
      aria-label={`${titles.primary}${creator ? ` por ${creator}` : ''}${progress > 0 ? `, ${progress}% concluído` : ''}`}
      aria-pressed={selectionMode ? selected : undefined}
      title={`${titles.primary}${creator ? ` · ${creator}` : ''}`}
      style={{
        width: `${metrics.width}px`,
        height: `${metrics.height}px`,
        backgroundColor: palette.bg,
        color: palette.fg,
        borderColor: selected ? 'var(--accent-color)' : 'rgba(0,0,0,0.28)',
      }}
      className={`group relative flex shrink-0 flex-col items-center justify-between overflow-hidden rounded-t-[3px] rounded-b-[1px] border-2 py-2 text-left transition-transform duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent hover:-translate-y-1.5 ${
        selected ? 'ring-2 ring-accent -translate-y-1.5' : ''
      }`}
    >
      {/* Etiqueta superior da lombada VHS/Blu-ray */}
      <span
        className="rounded-[2px] px-1 py-0.5 text-[7px] font-bold tracking-wider uppercase"
        style={{
          backgroundColor: 'rgba(0,0,0,0.22)',
          color: palette.fg,
        }}
      >
        {typeTag}
      </span>

      {/* Título vertical da fita / caixa */}
      <div
        className="my-1 flex min-h-0 flex-1 items-center justify-center overflow-hidden px-0.5"
        style={{
          writingMode: 'vertical-rl',
          transform: 'rotate(180deg)',
        }}
      >
        <span className="max-h-full truncate text-[10px] font-semibold tracking-tight leading-none">
          {titles.primary}
        </span>
      </div>

      {/* Sinais discretos de seleção / estrela / progresso */}
      <div className="flex flex-col items-center gap-1">
        {selected ? (
          <Check className="h-3 w-3 shrink-0" strokeWidth={2} />
        ) : item.isPlatinum ? (
          <Star className="h-2.5 w-2.5 shrink-0 fill-current opacity-85" strokeWidth={1.5} />
        ) : (
          <span
            aria-hidden="true"
            className="h-1 w-3/4 rounded-full opacity-45"
            style={{ backgroundColor: palette.accent || palette.fg }}
          />
        )}
        {progress > 0 && (
          <span
            aria-hidden="true"
            className="block h-1 w-4 overflow-hidden rounded-full bg-black/30"
          >
            <span
              className="block h-full"
              style={{
                width: `${Math.min(100, progress)}%`,
                backgroundColor: palette.fg,
              }}
            />
          </span>
        )}
      </div>
    </button>
  );
}

export function SpineRenderer({
  items = [],
  titleMode = 'bilingual',
  selectedIds = [],
  selectionMode = false,
  groupByTheme = true,
  onSelectItem,
  onLongPressItem,
}) {
  const shelves = useMemo(() => {
    if (!groupByTheme) {
      const chunkSize = 11;
      const rows = [];
      for (let i = 0; i < items.length; i += chunkSize) {
        rows.push({
          label: `Prateleira ${rows.length + 1}`,
          items: items.slice(i, i + chunkSize),
        });
      }
      return rows;
    }

    const byTheme = new Map();
    for (const item of items) {
      const themeLabel =
        item.primaryGenre ||
        (Array.isArray(item.genres) && item.genres[0]) ||
        (item.workType === 'anime'
          ? 'Animes'
          : item.workType === 'series'
            ? 'Séries'
            : 'Catálogo Geral');
      if (!byTheme.has(themeLabel)) byTheme.set(themeLabel, []);
      byTheme.get(themeLabel).push(item);
    }

    return Array.from(byTheme.entries())
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'pt-BR'))
      .map(([label, rowItems]) => ({ label, items: rowItems }));
  }, [items, groupByTheme]);

  if (!items.length) return null;

  return (
    <div className="space-y-6" role="region" aria-label="Estante de fitas e Blu-ray por tema">
      {shelves.map((shelf, rowIdx) => (
        <div key={`${shelf.label}-${rowIdx}`} className="relative">
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
              {shelf.label}
            </span>
            <span className="text-[10px] tabular-nums text-subtle">
              {shelf.items.length} {shelf.items.length === 1 ? 'fita' : 'fitas'}
            </span>
          </div>
          <div className="flex items-end gap-1.5 overflow-x-auto px-2 pt-2 pb-0.5 no-scrollbar">
            {shelf.items.map((item) => (
              <TapeSpine
                key={item.id}
                item={item}
                titleMode={titleMode}
                selected={selectedIds.includes(item.id)}
                selectionMode={selectionMode}
                onSelect={onSelectItem}
                onLongPress={onLongPressItem}
              />
            ))}
          </div>
          {/* Prateleira desenhada pelo tema */}
          <div
            aria-hidden="true"
            className="h-3 w-full rounded-[3px] border border-line bg-elevated"
            style={{
              boxShadow: 'var(--elev-1)',
            }}
          />
        </div>
      ))}
    </div>
  );
}
