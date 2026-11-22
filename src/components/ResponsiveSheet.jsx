import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export function ResponsiveSheet({
  isOpen,
  onClose,
  title = '',
  subtitle = '',
  icon: Icon = null,
  ariaLabel = 'Painel lateral',
  headerActions = null,
  children,
}) {
  const sheetRef = useRef(null);
  const previousFocusRef = useRef(null);
  const touchStartYRef = useRef(null);
  const touchStartTimeRef = useRef(0);
  const [dragOffsetY, setDragOffsetY] = useState(0);

  useEffect(() => {
    if (!isOpen) return undefined;

    previousFocusRef.current = document.activeElement;
    const body = document.body;
    const prevOverflow = body.style.overflow;
    const prevPaddingRight = body.style.paddingRight;
    const scrollbarWidth =
      window.innerWidth - document.documentElement.clientWidth;

    body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`;
    }

    const focusTimer = setTimeout(() => {
      const target = sheetRef.current?.querySelector(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (target && typeof target.focus === 'function') {
        target.focus();
      } else {
        sheetRef.current?.focus();
      }
    }, 10);

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
        return;
      }
      if (e.key === 'Tab' && sheetRef.current) {
        const focusables = Array.from(
          sheetRef.current.querySelectorAll(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKeyDown);
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPaddingRight;
      setDragOffsetY(0);
      if (
        previousFocusRef.current &&
        typeof previousFocusRef.current.focus === 'function'
      ) {
        previousFocusRef.current.focus();
      }
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleTouchStart = (e) => {
    if (e.touches.length !== 1) return;
    touchStartYRef.current = e.touches[0].clientY;
    touchStartTimeRef.current = Date.now();
  };

  const handleTouchMove = (e) => {
    if (touchStartYRef.current === null || e.touches.length !== 1) return;
    const delta = e.touches[0].clientY - touchStartYRef.current;
    if (delta > 0) {
      setDragOffsetY(Math.min(delta, 260));
    }
  };

  const handleTouchEnd = () => {
    if (touchStartYRef.current === null) return;
    const elapsed = Math.max(1, Date.now() - touchStartTimeRef.current);
    const velocity = dragOffsetY / elapsed;
    if (dragOffsetY > 95 || velocity > 0.45) {
      setDragOffsetY(0);
      touchStartYRef.current = null;
      onClose?.();
      return;
    }
    setDragOffsetY(0);
    touchStartYRef.current = null;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 sm:items-stretch sm:justify-end"
      onClick={onClose}
    >
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel || title || 'Painel'}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={
          dragOffsetY > 0
            ? { transform: `translateY(${dragOffsetY}px)` }
            : undefined
        }
        className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[14px] border-t border-line bg-card text-ink sm:h-[100dvh] sm:max-h-[100dvh] sm:max-w-md sm:rounded-none sm:border-t-0 sm:border-l"
      >
        <div
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className="shrink-0 border-b border-line px-4 pt-2.5 pb-3"
        >
          <div
            aria-hidden="true"
            className="mx-auto mb-2.5 h-1 w-10 rounded-full bg-line sm:hidden"
          />
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              {Icon && (
                <Icon className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />
              )}
              <div className="min-w-0">
                {title && (
                  <h3 className="truncate text-sm font-semibold text-ink">
                    {title}
                  </h3>
                )}
                {subtitle && (
                  <p className="truncate text-[11px] text-subtle">{subtitle}</p>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {headerActions}
              <button
                type="button"
                onClick={onClose}
                aria-label="Fechar"
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[4px] text-muted hover:bg-elevated hover:text-ink"
              >
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] no-scrollbar">
          {children}
        </div>
      </div>
    </div>
  );
}
