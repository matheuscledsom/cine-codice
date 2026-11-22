import { Dices, Film, Play, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getWorkTypeConfig } from '../config/domainConfig';
import { getDisplayTitles, isEpisodicWork } from '../utils/backlogHelpers';
import {
  ROULETTE_FILTERS,
  buildWatchPickerPool,
  pickRandomQueuedWork,
  pickWeightedQueuedWork,
} from '../utils/readingCheckIn';
import { CoverArt } from './CoverArt';

export function OfflineBookPickerModal({
  isOpen,
  onClose,
  items = [],
  readerDna = null,
  onStartReading,
  onSelectItem,
}) {
  const [filter, setFilter] = useState('all');
  const [useDnaWeighting, setUseDnaWeighting] = useState(() => Boolean(readerDna));
  const [pickedItem, setPickedItem] = useState(null);
  const [matchedReason, setMatchedReason] = useState('');
  const [rollingPreview, setRollingPreview] = useState(null);
  const [isSpinning, setIsSpinning] = useState(false);
  const spinTimerRef = useRef(null);

  const pool = useMemo(
    () => buildWatchPickerPool({ items, filter }),
    [items, filter]
  );

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleEsc = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', handleEsc);
    return () => {
      window.removeEventListener('keydown', handleEsc);
      if (spinTimerRef.current) clearInterval(spinTimerRef.current);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (pickedItem && !pool.some((entry) => entry.id === pickedItem.id)) {
      setPickedItem(null);
    }
  }, [pool, pickedItem]);

  if (!isOpen) return null;

  const handleSpin = () => {
    if (spinTimerRef.current) clearInterval(spinTimerRef.current);

    if (pool.length === 0) {
      setPickedItem(null);
      setRollingPreview(null);
      return;
    }

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const result =
      readerDna && useDnaWeighting
        ? pickWeightedQueuedWork({
            items,
            filter,
            readerDna,
            lastPickedId: pickedItem?.id || null,
          })
        : {
            ...pickRandomQueuedWork({
              items,
              filter,
              lastPickedId: pickedItem?.id || null,
            }),
            matchedReason: '',
          };

    const { picked, matchedReason: nextReason } = result;

    if (prefersReduced || pool.length === 1) {
      setPickedItem(picked);
      setMatchedReason(nextReason || '');
      setRollingPreview(null);
      setIsSpinning(false);
      return;
    }

    setIsSpinning(true);
    let ticks = 0;
    spinTimerRef.current = setInterval(() => {
      const sample = pool[ticks % pool.length];
      setRollingPreview(sample);
      ticks += 1;
      if (ticks >= 5) {
        clearInterval(spinTimerRef.current);
        spinTimerRef.current = null;
        setRollingPreview(null);
        setPickedItem(picked);
        setMatchedReason(nextReason || '');
        setIsSpinning(false);
      }
    }, 75);
  };

  const activeDisplay = isSpinning && rollingPreview ? rollingPreview : pickedItem;
  const activeTitles = activeDisplay
    ? getDisplayTitles(activeDisplay, 'bilingual')
    : null;

  const handleStartNow = () => {
    if (!pickedItem) return;
    onStartReading?.(pickedItem);
    onClose?.();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Roleta O que assistir hoje"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-line bg-card p-5 space-y-4 no-scrollbar"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Dices className="h-4 w-4 text-accent" strokeWidth={1.5} />
            <div>
              <h3 className="text-sm font-semibold text-ink">
                O que assistir hoje?
              </h3>
              <p className="text-[11px] text-subtle">
                Roleta por tempo disponível da fila Quero Ver
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar roleta de sessão"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[4px] text-muted hover:bg-elevated hover:text-ink"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tempo disponível">
          {ROULETTE_FILTERS.map((f) => {
            const active = filter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setFilter(f.id);
                  setPickedItem(null);
                }}
                className={`inline-flex min-h-[44px] items-center rounded-[4px] border px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? 'border-accent bg-accent/15 text-accent'
                    : 'border-line bg-app text-muted hover:text-ink'
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <div className="flex flex-wrap items-center gap-2">
            <span className="tabular-nums">
              <strong className="font-semibold text-ink">{pool.length}</strong>{' '}
              {pool.length === 1 ? 'obra compatível' : 'obras compatíveis'}
            </span>
            {readerDna && (
              <button
                type="button"
                aria-pressed={useDnaWeighting}
                onClick={() => setUseDnaWeighting((v) => !v)}
                className={`min-h-[34px] rounded-[4px] border px-2 py-1 text-[11px] font-medium transition-colors ${
                  useDnaWeighting
                    ? 'border-accent bg-accent/15 text-ink'
                    : 'border-line bg-app text-muted hover:text-ink'
                }`}
              >
                Afinar pelo DNA
              </button>
            )}
          </div>
          <button
            type="button"
            disabled={pool.length === 0 || isSpinning}
            onClick={handleSpin}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[4px] bg-accent px-4 py-2 text-xs font-semibold text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-45"
          >
            <Dices className="h-4 w-4" strokeWidth={1.5} />
            <span>{pickedItem ? 'Girar Novamente' : 'Girar Roleta'}</span>
          </button>
        </div>

        {pool.length === 0 ? (
          <div className="rounded-[6px] border border-dashed border-line bg-app px-4 py-6 text-center">
            <Film className="mx-auto h-5 w-5 text-subtle" strokeWidth={1.5} />
            <p className="mt-2 text-xs font-medium text-ink">
              Nenhuma obra em Quero Ver neste tempo
            </p>
            <p className="mt-1 text-[11px] text-subtle">
              Troque para Qualquer duração ou adicione títulos em Quero Ver.
            </p>
          </div>
        ) : !activeDisplay ? (
          <div className="rounded-[6px] border border-line bg-app px-4 py-6 text-center">
            <Sparkles className="mx-auto h-5 w-5 text-accent" strokeWidth={1.5} />
            <p className="mt-2 text-xs text-muted">
              Toque em <strong className="text-ink">Girar Roleta</strong> para escolher a sessão de hoje.
            </p>
          </div>
        ) : (
          <div className="rounded-[6px] border border-accent/45 bg-app p-3.5 space-y-3">
            <div className="flex gap-3">
              <CoverArt item={activeDisplay} compact className="h-24 w-16 shrink-0 rounded-[4px]" />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="line-clamp-2 text-sm font-semibold text-ink">
                  {activeTitles?.primary || activeDisplay.title}
                </p>
                {activeTitles?.secondary && (
                  <p className="truncate text-[11px] italic text-subtle">
                    {activeTitles.secondary}
                  </p>
                )}
                <p className="truncate text-xs text-muted">
                  {activeDisplay.director ||
                    activeDisplay.studio ||
                    getWorkTypeConfig(activeDisplay.workType).shortLabel}
                </p>
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-[10px] tabular-nums text-subtle">
                  {isEpisodicWork(activeDisplay) ? (
                    activeDisplay.totalEpisodes > 0 && (
                      <span className="rounded-[2px] border border-line bg-card px-1.5 py-0.5">
                        {activeDisplay.totalEpisodes} eps
                      </span>
                    )
                  ) : (
                    activeDisplay.durationMinutes > 0 && (
                      <span className="rounded-[2px] border border-line bg-card px-1.5 py-0.5">
                        {activeDisplay.durationMinutes} min
                      </span>
                    )
                  )}
                  {activeDisplay.audioFormat && (
                    <span className="rounded-[2px] border border-line bg-card px-1.5 py-0.5">
                      {activeDisplay.audioFormat}
                    </span>
                  )}
                  {matchedReason && !isSpinning && (
                    <span className="rounded-[2px] border border-accent/40 bg-card px-1.5 py-0.5 font-medium text-accent">
                      Afinidade DNA: {matchedReason}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {!isSpinning && (
              <div className="flex flex-wrap gap-2 border-t border-line pt-3">
                <button
                  type="button"
                  onClick={handleStartNow}
                  className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-[4px] bg-accent px-3.5 py-2 text-xs font-semibold text-accent-ink transition-opacity hover:opacity-90"
                >
                  <Play className="h-3.5 w-3.5" strokeWidth={1.5} />
                  <span>Iniciar Sessão</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClose?.();
                    onSelectItem?.(pickedItem);
                  }}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-[4px] border border-line bg-card px-3.5 py-2 text-xs font-medium text-ink hover:border-accent"
                >
                  Ver Ficha
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
