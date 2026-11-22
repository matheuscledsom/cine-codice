import { FolderPlus, Plus } from 'lucide-react';
import { useState } from 'react';
import { COLLECTION_SUGGESTIONS } from '../utils/collections';

export function CollectionCreatorBar({
  collections = [],
  onCreateCollection,
  onCreated,
  placeholder = 'Nome da nova coleção...',
}) {
  const [name, setName] = useState('');

  const availableSuggestions = COLLECTION_SUGGESTIONS.filter(
    (suggestion) =>
      !(Array.isArray(collections) ? collections : []).some(
        (col) => col.name.toLowerCase() === suggestion.toLowerCase()
      )
  );

  const submitName = (rawName) => {
    const clean = String(rawName || '').trim();
    if (!clean || !onCreateCollection) return;
    const outcome = onCreateCollection(clean);
    setName('');
    if (outcome?.created) {
      onCreated?.(outcome.created);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <div className="relative min-w-0 flex-1">
          <FolderPlus
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle"
            strokeWidth={1.5}
          />
          <input
            type="text"
            maxLength={50}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submitName(name);
              }
            }}
            placeholder={placeholder}
            aria-label="Nome da nova coleção personalizada"
            className="min-h-[44px] w-full rounded-[4px] border border-line bg-app py-1.5 pl-8 pr-3 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
          />
        </div>
        <button
          type="button"
          disabled={!name.trim()}
          onClick={() => submitName(name)}
          className="inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-[4px] bg-accent px-3 py-2 text-xs font-semibold text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-45"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
          <span>Criar</span>
        </button>
      </div>

      {availableSuggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-subtle">Sugestões:</span>
          {availableSuggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => submitName(suggestion)}
              className="inline-flex min-h-[34px] items-center gap-1 rounded-[4px] border border-line bg-app px-2 py-1 text-[10px] font-medium text-muted transition-colors hover:border-accent hover:text-ink"
            >
              <Plus className="h-2.5 w-2.5 text-accent" strokeWidth={1.5} />
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
