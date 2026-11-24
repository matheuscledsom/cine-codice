import { RefreshCw, X } from 'lucide-react';

export function PwaUpdateBanner({ visible = false, onUpdate, onDismiss }) {
  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="pwa-update-banner"
      className="fixed bottom-20 left-1/2 z-50 flex w-[calc(100%-24px)] max-w-md -translate-x-1/2 items-center justify-between gap-2 rounded-[6px] border border-line bg-card px-3.5 py-2 shadow-lg sm:bottom-5"
    >
      <div className="min-w-0">
        <p className="text-xs font-semibold text-ink">Nova versão disponível</p>
        <p className="truncate text-[11px] text-muted">
          Atualize para aplicar as melhorias sem perder seus dados.
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onUpdate}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[6px] bg-accent px-3 text-xs font-semibold text-accent-ink transition-opacity hover:opacity-90"
        >
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} />
          <span>Atualizar</span>
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[6px] text-muted transition-colors hover:bg-app hover:text-ink"
          aria-label="Fechar aviso de atualização"
        >
          <X className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}
