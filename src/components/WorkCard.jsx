import { Check } from 'lucide-react';
import { memo, useRef } from 'react';
import {
  getStatusConfig,
  getWorkTypeLabel,
  inferDomainFromWork,
} from '../config/domainConfig';
import {
  calculateWorkProgress,
  formatCatalogCardFormatBadge,
  getDisplayTitles,
} from '../utils/backlogHelpers';
import { CoverArt } from './CoverArt';

export const WorkCard = memo(function WorkCard({
  item,
  titleMode = 'bilingual',
  priority = false,
  selectionMode = false,
  selected = false,
  onSelectItem,
  onLongPressItem,
}) {
  const status = getStatusConfig(item.status);
  const domain = inferDomainFromWork(item);
  const itemPct = calculateWorkProgress(item);
  const formatBadge = formatCatalogCardFormatBadge(item);
  const pressTimerRef = useRef(null);
  const longPressedRef = useRef(false);

  const titles = getDisplayTitles(item, titleMode);
  const creatorLabel =
    item.creator || item.director || item.studio || item.author || getWorkTypeLabel(item, domain);
  const subMeta =
    domain === 'games'
      ? [
          item.editionType && item.editionType !== 'Original' ? item.editionType : '',
          item.storeOrLauncher || item.buildOrCharacter || '',
        ]
          .filter(Boolean)
          .join(' · ')
      : domain === 'music'
        ? item.workType === 'track'
          ? item.albumName || item.subgenre || ''
          : item.favoriteTrack || item.subgenre || ''
        : domain === 'reading'
          ? item.bookFormat || ''
          : '';

  const displayRatingBadge =
    domain === 'games' &&
    item.gameRating11 !== null &&
    item.gameRating11 !== undefined &&
    Number.isFinite(Number(item.gameRating11))
      ? `${item.gameRating11}/11`
      : domain === 'music' &&
          item.workType === 'track' &&
          item.trackRating10 !== null &&
          item.trackRating10 !== undefined &&
          Number.isFinite(Number(item.trackRating10))
        ? `${item.trackRating10}/10`
        : typeof item.rating === 'number'
          ? String(item.rating)
          : null;

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
        className="text-left focus:outline-none"
      >
        <div className="relative overflow-hidden rounded-[4px]">
          <CoverArt
            item={item}
            compact
            priority={priority}
            className={`aspect-[2/3] w-full rounded-[4px] transition-transform duration-150 group-hover:scale-[1.02] group-hover:border-accent/60 ${
              selected ? 'ring-2 ring-accent' : ''
            }`}
          />

          {selectionMode && (
            <span
              className={`absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-[4px] border ${
                selected
                  ? 'border-accent bg-accent text-accent-ink'
                  : 'border-white/70 bg-black/55 text-white'
              }`}
            >
              {selected && <Check className="h-3.5 w-3.5" strokeWidth={2} />}
            </span>
          )}

          {!selectionMode && (
            <span
              data-testid="catalog-format-badge"
              className="absolute left-1.5 top-1.5 max-w-[78%] truncate rounded-[3px] border border-white/15 bg-black/75 px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-white backdrop-blur-xs"
            >
              {formatBadge.label}
            </span>
          )}

          {displayRatingBadge !== null && (
            <span className="absolute right-1.5 top-1.5 rounded-[3px] border border-line bg-app/90 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-ink">
              {displayRatingBadge}
            </span>
          )}

          {(itemPct > 0 || item.status === 'completed') && (
            <div className="absolute inset-x-0 bottom-0 h-[3px] bg-black/50">
              <div
                className="h-full transition-all duration-200"
                style={{
                  width: `${item.status === 'completed' ? 100 : Math.min(100, itemPct)}%`,
                  backgroundColor: status?.color || 'var(--accent-color)',
                }}
              />
            </div>
          )}
        </div>

        <div className="mt-1.5 space-y-0.5 px-0.5">
          <p className="line-clamp-2 text-[11px] font-semibold leading-snug text-ink transition-colors group-hover:text-accent">
            {titles.primary}
          </p>
          {titles.secondary && (
            <p className="truncate text-[9px] italic text-subtle">{titles.secondary}</p>
          )}
          <p className="truncate text-[10px] text-muted">{creatorLabel}</p>
          {subMeta && (
            <p className="truncate text-[9px] font-medium text-subtle">{subMeta}</p>
          )}
        </div>
      </button>
    </div>
  );
});
