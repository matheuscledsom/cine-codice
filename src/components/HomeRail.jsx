import { ChevronLeft, ChevronRight, RefreshCw, WifiOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export function HomeRail({
  title,
  icon: Icon = null,
  count = null,
  headerAction = null,
  isEmpty = false,
  hideWhenEmpty = true,
  loading = false,
  error = '',
  offlineDateLabel = '',
  partialNotice = '',
  onRetry = null,
  emptyContent = null,
  ariaLabel,
  onBecomeVisible = null,
  children,
}) {
  const sectionRef = useRef(null);
  const trackRef = useRef(null);
  const [hasEnteredViewport, setHasEnteredViewport] = useState(
    () => typeof IntersectionObserver === 'undefined'
  );

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      setHasEnteredViewport(true);
      onBecomeVisible?.();
      return undefined;
    }
    const el = sectionRef.current;
    if (!el || hasEnteredViewport) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setHasEnteredViewport(true);
          observer.disconnect();
          onBecomeVisible?.();
        }
      },
      { rootMargin: '140px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasEnteredViewport, onBecomeVisible]);

  if (hideWhenEmpty && !loading && !error && isEmpty && !emptyContent) {
    return null;
  }

  const scrollTrackBy = (direction) => {
    const el = trackRef.current;
    if (!el) return;
    const step = Math.max(220, Math.round(el.clientWidth * 0.75));
    if (typeof el.scrollBy === 'function') {
      el.scrollBy({ left: direction * step, behavior: 'smooth' });
    } else {
      el.scrollLeft += direction * step;
    }
  };

  return (
    <section
      ref={sectionRef}
      aria-label={ariaLabel || title}
      className="space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {Icon && <Icon className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />}
          <h2 className="truncate text-sm font-semibold tracking-tight text-ink">
            {title}
          </h2>
          {typeof count === 'number' && count > 0 && (
            <span className="text-[11px] font-medium tabular-nums text-subtle">
              ({count})
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {offlineDateLabel && (
            <span className="inline-flex items-center gap-1 rounded-[4px] border border-line bg-app px-2 py-0.5 text-[10px] font-medium tabular-nums text-muted">
              <WifiOff className="h-3 w-3 shrink-0" strokeWidth={1.5} />
              <span>dados de {offlineDateLabel}</span>
            </span>
          )}
          {headerAction}
          {!loading && !error && !isEmpty && (
            <div className="hidden sm:flex items-center gap-1">
              <button
                type="button"
                onClick={() => scrollTrackBy(-1)}
                aria-label={`Rolar ${title} para a esquerda`}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[4px] border border-line bg-card text-muted transition-colors hover:border-accent hover:text-ink"
              >
                <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
              </button>
              <button
                type="button"
                onClick={() => scrollTrackBy(1)}
                aria-label={`Rolar ${title} para a direita`}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[4px] border border-line bg-card text-muted transition-colors hover:border-accent hover:text-ink"
              >
                <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>
          )}
        </div>
      </div>

      {partialNotice && (
        <p className="text-[11px] text-subtle">{partialNotice}</p>
      )}

      {loading ? (
        <div
          className="flex gap-3 overflow-hidden"
          aria-busy="true"
          aria-label={`Carregando ${title}`}
        >
          {[0, 1, 2, 3].map((idx) => (
            <div
              key={idx}
              className="w-36 sm:w-40 shrink-0 space-y-2 rounded-[6px] border border-line bg-card p-2.5"
            >
              <div className="aspect-[2/3] w-full animate-pulse rounded-[4px] bg-app" />
              <div className="h-3 w-4/5 animate-pulse rounded bg-app" />
              <div className="h-2.5 w-1/2 animate-pulse rounded bg-app" />
            </div>
          ))}
        </div>
      ) : error && isEmpty ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[6px] border border-line bg-card p-3.5 text-xs text-muted">
          <span>{error}</span>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[4px] border border-accent bg-accent/10 px-3 text-xs font-semibold text-accent hover:bg-accent hover:text-accent-ink"
            >
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} />
              <span>Tentar de novo</span>
            </button>
          )}
        </div>
      ) : isEmpty ? (
        emptyContent
      ) : !hasEnteredViewport ? (
        <div className="h-40 rounded-[6px] border border-line bg-card/60" aria-hidden="true" />
      ) : (
        <div
          ref={trackRef}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') {
              e.preventDefault();
              scrollTrackBy(1);
            } else if (e.key === 'ArrowLeft') {
              e.preventDefault();
              scrollTrackBy(-1);
            }
          }}
          className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 no-scrollbar focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {children}
        </div>
      )}
    </section>
  );
}
