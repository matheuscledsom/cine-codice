import { GitBranch, Layers, X } from 'lucide-react';
import { useEffect } from 'react';
import {
  CODICE_RELEASE,
  RELEASE_HISTORY,
  VERSIONING_RULES,
} from '../config/versioning';

export function ReleaseHistoryModal({ isOpen, onClose }) {
  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/65 p-0 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Histórico de versões do OmniPrism"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-lg flex-col rounded-t-[6px] sm:rounded-[6px] border border-line bg-card text-ink"
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted font-medium">
              <GitBranch className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
              <span>Novidades da versão</span>
            </p>
            <h2 className="text-base font-semibold tracking-tight text-ink tabular-nums">
              OmniPrism {CODICE_RELEASE.label}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar histórico de versões"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[4px] border border-line text-muted transition-colors hover:text-ink"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 no-scrollbar">
          {/* Regra Semântica + Nominal */}
          <div className="rounded-[4px] border border-line bg-app p-3.5 space-y-2">
            <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink">
              <Layers className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
              <span>Convenção de Releases</span>
            </p>
            <ul className="space-y-1.5 text-[11px] leading-relaxed text-muted">
              <li>
                <strong className="text-ink">Patch / Minor:</strong>{' '}
                {VERSIONING_RULES.patchMinor}
              </li>
              <li>
                <strong className="text-ink">Major:</strong>{' '}
                {VERSIONING_RULES.major}
              </li>
            </ul>
          </div>

          {/* Linha do tempo das versões */}
          <div className="divide-y divide-line rounded-[4px] border border-line bg-app">
            {RELEASE_HISTORY.map((entry, idx) => (
              <div key={entry.version} className="p-3.5 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-ink tabular-nums">
                      {entry.label}
                    </span>
                    {idx === 0 && (
                      <span className="rounded-[2px] border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
                        Atual
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] tabular-nums text-subtle">
                    {entry.date}
                  </span>
                </div>

                <p className="text-xs leading-relaxed text-muted">
                  {entry.summary}
                </p>

                {Array.isArray(entry.highlights) && entry.highlights.length > 0 && (
                  <ul className="space-y-1 pt-1 border-t border-line">
                    {entry.highlights.map((item) => (
                      <li
                        key={item}
                        className="text-[11px] leading-snug text-muted"
                      >
                        • {item}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
