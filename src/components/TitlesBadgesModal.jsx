import { X } from 'lucide-react';
import { useEffect } from 'react';
import { BadgesGallery } from './BadgesGallery';

export function TitlesBadgesModal({
  isOpen,
  onClose,
  evaluation,
  onSelectAutoMode,
  onPinTitleBadge,
}) {
  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen || !evaluation) return null;

  const { unlockedCount, totalCount, resolvedActiveBadge, isAutoMode } =
    evaluation;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Títulos e Insígnias do Leitor"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92dvh] w-full max-w-2xl flex-col rounded-t-[6px] border border-line bg-card text-ink sm:rounded-[6px] pb-[env(safe-area-inset-bottom)]"
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight text-ink tabular-nums">
              Títulos &amp; Insígnias ({unlockedCount}/{totalCount})
            </h2>
            <p className="mt-0.5 truncate text-xs text-muted">
              Ativa agora: <strong className="text-accent">{resolvedActiveBadge?.name}</strong>
              {isAutoMode ? ' · Automático' : ' · Fixado'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar títulos e insígnias"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[4px] border border-line text-muted hover:text-ink"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 no-scrollbar">
          <BadgesGallery
            evaluation={evaluation}
            onSelectAutoMode={onSelectAutoMode}
            onPinTitleBadge={onPinTitleBadge}
          />
        </div>
      </div>
    </div>
  );
}
