import { Check } from 'lucide-react';
import { memo, useRef } from 'react';
import {
  getStatusConfig,
  getWorkTypeLabel,
  inferDomainFromWork,
} from '../config/domainConfig';
import {
  calculateWorkProgress,
  getDisplayTitles,
} from '../utils/backlogHelpers';
import { CoverArt } from './CoverArt';
import { StarRatingDisplay } from './StarRatingPicker';

export const WorkCard = memo(function WorkCard({
  item,
  titleMode = 'bilingual',
  priority = false,
  selectionMode = false,
  selected = false,
  onSelectItem,
  onLongPressItem,
}) {
  const domain = inferDomainFromWork(item);
  const status = getStatusConfig(item.status, domain);
  const itemPct = calculateWorkProgress(item);
  const isInProgress = item.status === 'playing' || item.status === 'rewatching';
  const pressTimerRef = useRef(null);
  const longPressedRef = useRef(false);

  const titles = getDisplayTitles(item, titleMode);
  const creatorLabel =
    item.creator || item.director || item.studio || item.author || getWorkTypeLabel(item, domain);

  const clearPress = () => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  };

  return (
    <div className="group flex flex-col text-left" style={{ contain: 'layout paint' }}>
      <button
        type="button"
        onClick={() => {
          if (longPressedRef.current) {
            longPressedRef.current = false;
            return;
          }
          onSelectItem?.(item);
        }}
        onPointerDown={() => {
          if (!onLongPressItem) return;
          longPressedRef.current = false;
          clearPress();
          pressTimerRef.current = setTimeout(() => {
            longPressedRef.current = true;
            onLongPressItem(item);
          }, 520);
        }}
        onPointerUp={clearPress}
        onPointerCancel={clearPress}
        onPointerLeave={clearPress}
        aria-pressed={selectionMode ? selected : undefined}
        className="text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-[6px]"
      >
        <div className="relative overflow-hidden rounded-[6px]">
          <CoverArt
            item={item}
            compact
            priority={priority}
            className={`${domain === 'music' ? 'aspect-square' : 'aspect-[2/3]'} w-full rounded-[6px] transition-transform duration-150 group-hover:scale-[1.015] ${
              selected ? 'ring-2 ring-accent' : ''
            }`}
          />

          {/* Indicador fino de status no topo extremo (sem poluir a capa) */}
          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-[2px]"
            style={{ backgroundColor: status?.color || 'transparent' }}
          />

          {selectionMode && (
            <span
              className={`absolute left-1.5 top-2 flex h-6 w-6 items-center justify-center rounded-[6px] border ${
                selected
                  ? 'border-accent bg-accent text-accent-ink'
                  : 'border-white/75 bg-black/60 text-white'
              }`}
            >
              {selected && <Check className="h-3.5 w-3.5" strokeWidth={2} />}
            </span>
          )}

          {/* Barra de progresso na base somente quando em andamento */}
          {isInProgress && itemPct > 0 && (
            <div
              className="absolute inset-x-0 bottom-0 h-[3px] bg-black/50"
              aria-hidden="true"
            >
              <div
                className="h-full bg-accent transition-all duration-200"
                style={{ width: `${Math.min(100, itemPct)}%` }}
              />
            </div>
          )}
        </div>

        <div className="mt-2 space-y-0.5 px-0.5">
          <p className="font-editorial line-clamp-2 text-[13px] font-semibold leading-snug text-ink transition-colors group-hover:text-accent">
            {titles.primary}
          </p>
          {titles.secondary && (
            <p className="truncate text-[10px] italic text-subtle">{titles.secondary}</p>
          )}
          <p className="truncate text-[11px] text-muted">{creatorLabel}</p>
          <div className="pt-0.5 opacity-90 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <StarRatingDisplay work={item} size="sm" showNumeric />
          </div>
        </div>
      </button>
    </div>
  );
});
