import {
  BarChart3,
  Command,
  Download,
  Film,
  FolderOpen,
  Home,
  Library,
  Palette,
  Plus,
  Search,
  User,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildCommandPaletteEntries } from './commandPaletteSearch';

const ICON_MAP = {
  home: Home,
  film: Film,
  plus: Plus,
  stats: BarChart3,
  users: Users,
  user: User,
  palette: Palette,
  library: Library,
  command: Command,
  download: Download,
  folder: FolderOpen,
};

export function CommandPalette({
  isOpen,
  onClose,
  items = [],
  collections = [],
  onNavigateTab,
  onSelectItem,
  onSelectCollection,
  onOpenThemeStudio,
  onOpenRoulette,
  onExportBackup,
  onToggleFocusTheme,
}) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);

  const results = useMemo(
    () =>
      buildCommandPaletteEntries({
        query,
        items,
        collections,
        onNavigateTab,
        onSelectItem,
        onSelectCollection,
        onOpenThemeStudio,
        onOpenRoulette,
        onExportBackup,
        onToggleFocusTheme,
      }),
    [
      query,
      items,
      collections,
      onNavigateTab,
      onSelectItem,
      onSelectCollection,
      onOpenThemeStudio,
      onOpenRoulette,
      onExportBackup,
      onToggleFocusTheme,
    ]
  );

  useEffect(() => {
    if (!isOpen) return undefined;
    const prevFocus = document.activeElement;
    setQuery('');
    setActiveIndex(0);
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      cancelAnimationFrame(id);
      if (prevFocus && typeof prevFocus.focus === 'function') {
        prevFocus.focus();
      }
    };
  }, [isOpen]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (!isOpen) return null;

  const activeEntry = results[activeIndex] || null;

  const handleExecute = (entry) => {
    if (!entry) return;
    onClose?.();
    entry.run?.();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose?.();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (results.length > 0) {
        setActiveIndex((prev) => (prev + 1) % results.length);
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length > 0) {
        setActiveIndex((prev) => (prev - 1 + results.length) % results.length);
      }
      return;
    }
    if (e.key === 'Enter' && activeEntry) {
      e.preventDefault();
      handleExecute(activeEntry);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Paleta de Comandos e Busca Global"
      onClick={onClose}
      className="fixed inset-0 z-[65] flex items-start justify-center bg-black/60 p-4 pt-14 sm:pt-20"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        className="w-full max-w-lg overflow-hidden rounded-[6px] border border-line bg-card text-ink"
        style={{ boxShadow: 'var(--elev-4)' }}
      >
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls="codice-command-listbox"
            aria-activedescendant={activeEntry ? `cmd-opt-${activeEntry.id}` : undefined}
            aria-label="Buscar obras, coleções ou comandos"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar filmes, séries, animes, coleções... (Ctrl+K)"
            className="min-h-[44px] min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-subtle focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar paleta de comandos"
            className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-[4px] border border-line text-muted hover:text-ink"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>

        <ul
          id="codice-command-listbox"
          role="listbox"
          aria-label="Resultados e comandos"
          className="max-h-[60dvh] divide-y divide-line overflow-y-auto no-scrollbar"
        >
          {results.length === 0 ? (
            <li className="px-4 py-8 text-center text-xs text-muted">
              Nenhuma obra ou comando encontrado para &quot;{query}&quot;.
            </li>
          ) : (
            results.map((entry, idx) => {
              const Icon = ICON_MAP[entry.iconKey] || Film;
              const isSelected = idx === activeIndex;
              return (
                <li
                  key={entry.id}
                  id={`cmd-opt-${entry.id}`}
                  role="option"
                  aria-selected={isSelected}
                >
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => handleExecute(entry)}
                    className={`flex min-h-[46px] w-full items-center justify-between gap-3 px-3.5 py-2 text-left transition-colors ${
                      isSelected ? 'bg-accent/15 text-ink' : 'bg-card text-ink hover:bg-app'
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <Icon
                        className={`h-4 w-4 shrink-0 ${isSelected ? 'text-accent' : 'text-subtle'}`}
                        strokeWidth={1.5}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-medium text-ink">
                          {entry.label}
                        </span>
                        {entry.hint && (
                          <span className="block truncate text-[10px] text-muted">
                            {entry.hint}
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-[4px] border border-line bg-app px-1.5 py-0.5 text-[10px] text-subtle">
                      {entry.kind}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
