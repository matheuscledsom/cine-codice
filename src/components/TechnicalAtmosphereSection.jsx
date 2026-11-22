import { ChevronDown, ChevronUp, Plus, SlidersHorizontal, Tag, X } from 'lucide-react';
import { useState } from 'react';
import { domainConfig } from '../config/domainConfig';
import { VectorIcon } from './VectorIcon';

export function TechnicalAtmosphereSection({
  item,
  onChange,
  defaultExpanded = false,
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [tropeInput, setTropeInput] = useState('');

  const { detail } = domainConfig.ui;
  const selectedAtmosphere = Array.isArray(item.atmosphere) ? item.atmosphere : [];
  const selectedTropes = Array.isArray(item.tropes) ? item.tropes : [];

  const toggleAtmosphere = (vibeId) => {
    const exists = selectedAtmosphere.includes(vibeId);
    const next = exists
      ? selectedAtmosphere.filter((v) => v !== vibeId)
      : [...selectedAtmosphere, vibeId];
    onChange({ atmosphere: next });
  };

  const toggleTrope = (trope) => {
    const exists = selectedTropes.includes(trope);
    const next = exists
      ? selectedTropes.filter((t) => t !== trope)
      : [...selectedTropes, trope];
    onChange({ tropes: next });
  };

  const handleAddCustomTrope = () => {
    const clean = tropeInput.trim();
    if (!clean) return;
    if (!selectedTropes.some((t) => t.toLowerCase() === clean.toLowerCase())) {
      onChange({ tropes: [...selectedTropes, clean] });
    }
    setTropeInput('');
  };

  const activeCount = selectedAtmosphere.length + selectedTropes.length;

  return (
    <div className="rounded-2xl border border-line bg-app overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between px-3.5 py-3 text-left transition-colors hover:bg-card/60"
      >
        <span className="flex items-center gap-2 text-xs font-semibold text-ink">
          <SlidersHorizontal className="h-3.5 w-3.5 text-accent" />
          {detail.atmosphereSectionTitle}
          {activeCount > 0 && (
            <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
              {activeCount}
            </span>
          )}
        </span>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-muted" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted" />
        )}
      </button>

      {expanded && (
        <div className="space-y-4 border-t border-line px-3.5 py-3.5">
          <div>
            <p className="mb-2 text-[11px] font-medium text-muted">
              {detail.atmosphereLabel}
            </p>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {domainConfig.atmosphereOptions.map((vibe) => {
                const isSelected = selectedAtmosphere.includes(vibe.id);
                return (
                  <button
                    key={vibe.id}
                    type="button"
                    onClick={() => toggleAtmosphere(vibe.id)}
                    className={`flex items-center gap-1.5 rounded-xl border px-2.5 py-2 text-left text-xs font-medium transition-colors ${
                      isSelected
                        ? 'border-accent bg-accent/15 text-ink'
                        : 'border-line bg-card text-muted hover:text-ink'
                    }`}
                  >
                    <VectorIcon
                      name={vibe.icon}
                      className={`h-3.5 w-3.5 shrink-0 ${
                        isSelected ? 'text-accent' : 'text-subtle'
                      }`}
                    />
                    <span className="truncate">{vibe.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-muted">
              <Tag className="h-3 w-3 text-accent" />
              {detail.tropesLabel}
            </p>

            {selectedTropes.length > 0 && (
              <div className="mb-2.5 flex flex-wrap gap-1.5">
                {selectedTropes.map((trope) => (
                  <span
                    key={trope}
                    className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/15 px-2.5 py-1 text-[11px] font-medium text-ink"
                  >
                    {trope}
                    <button
                      type="button"
                      onClick={() => toggleTrope(trope)}
                      aria-label={`Remover ${trope}`}
                      className="rounded-full p-0.5 text-accent hover:bg-accent/20"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="flex gap-1.5">
              <input
                type="text"
                value={tropeInput}
                onChange={(e) => setTropeInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddCustomTrope();
                  }
                }}
                placeholder={detail.tropePlaceholder}
                className="flex-1 rounded-xl border border-line bg-card px-3 py-2 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
              />
              <button
                type="button"
                onClick={handleAddCustomTrope}
                aria-label="Adicionar tropo"
                className="inline-flex shrink-0 items-center justify-center rounded-xl border border-line bg-card px-3 text-accent hover:border-accent"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-2 flex flex-wrap gap-1.5">
              {domainConfig.suggestedTropes
                .filter((t) => !selectedTropes.includes(t))
                .slice(0, 6)
                .map((trope) => (
                  <button
                    key={trope}
                    type="button"
                    onClick={() => toggleTrope(trope)}
                    className="rounded-full border border-line bg-card px-2 py-0.5 text-[10px] text-muted transition-colors hover:border-accent/50 hover:text-ink"
                  >
                    + {trope}
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
