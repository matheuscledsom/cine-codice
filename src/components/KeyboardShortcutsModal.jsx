import { Keyboard, X } from 'lucide-react';
import { useEffect } from 'react';

const SHORTCUTS_LIST = [
  { keys: 'Ctrl + K / Cmd + K', description: 'Abrir Paleta de Comandos global' },
  { keys: '/', description: 'Focar busca rápida no Catálogo' },
  { keys: 'g  h', description: 'Ir para Início (Home)' },
  { keys: 'g  a', description: 'Ir para Catálogo / Estante' },
  { keys: 'g  m', description: 'Ir para Métricas' },
  { keys: 'n', description: 'Catalogar Nova Obra' },
  { keys: '?', description: 'Abrir ou fechar este guia de atalhos' },
  { keys: 'Esc', description: 'Fechar janelas e seleção ativa' },
];

export function KeyboardShortcutsModal({ isOpen, onClose }) {
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Atalhos de teclado do OmniPrism"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-[6px] border border-line bg-card p-5 space-y-4 text-ink"
      >
        <div className="flex items-center justify-between border-b border-line pb-3">
          <div className="flex items-center gap-2">
            <Keyboard className="h-4 w-4 text-accent" strokeWidth={1.5} />
            <h2 className="text-sm font-semibold">Atalhos de Teclado</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar guia de atalhos"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[4px] border border-line text-muted hover:text-ink"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>

        <ul className="divide-y divide-line">
          {SHORTCUTS_LIST.map((row) => (
            <li
              key={row.keys}
              className="flex items-center justify-between gap-3 py-2 text-xs"
            >
              <span className="text-muted">{row.description}</span>
              <kbd className="shrink-0 rounded-[4px] border border-line bg-app px-2 py-0.5 font-mono text-[11px] font-semibold text-ink">
                {row.keys}
              </kbd>
            </li>
          ))}
        </ul>

        <p className="text-[11px] text-subtle">
          Os atalhos de letra única ficam pausados automaticamente enquanto você digita em campos de texto ou formulários.
        </p>
      </div>
    </div>
  );
}
