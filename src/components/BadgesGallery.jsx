import { Award, Check, Lock, Search, Sparkles } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import {
  READER_TITLE_CATEGORIES,
  canPinTitleBadge,
} from '../services/readerTitlesEngine';
import { VectorIcon } from './VectorIcon';

const PAGE_SIZE = 20;

export function BadgesGallery({
  evaluation,
  onSelectAutoMode,
  onPinTitleBadge,
  compact = false,
}) {
  const [category, setCategory] = useState('all');
  const [onlyUnlocked, setOnlyUnlocked] = useState(false);
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const categoryTabRefs = useRef([]);

  const catalog = evaluation?.catalog || [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog
      .filter((badge) => {
        if (category !== 'all' && badge.category !== category) return false;
        if (onlyUnlocked && !badge.unlocked) return false;
        if (!q) return true;
        return (
          badge.name.toLowerCase().includes(q) ||
          badge.description.toLowerCase().includes(q)
        );
      })
      .sort(
        (a, b) =>
          Number(b.unlocked) - Number(a.unlocked) ||
          b.progressPct - a.progressPct
      );
  }, [catalog, category, onlyUnlocked, query]);

  if (!evaluation) return null;

  const { unlockedCount, resolvedActiveBadge, isAutoMode, livingTitle } =
    evaluation;
  const visibleItems = filtered.slice(0, visibleCount);
  const remaining = Math.max(0, filtered.length - visibleItems.length);

  const handleCategoryKeyDown = (e, idx) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    const nextIdx =
      (idx + dir + READER_TITLE_CATEGORIES.length) %
      READER_TITLE_CATEGORIES.length;
    const nextCat = READER_TITLE_CATEGORIES[nextIdx];
    setCategory(nextCat.id);
    setVisibleCount(PAGE_SIZE);
    categoryTabRefs.current[nextIdx]?.focus();
  };

  const handlePinAttempt = (badge) => {
    if (!badge?.unlocked || !canPinTitleBadge(badge, catalog)) {
      return;
    }
    onPinTitleBadge?.(badge);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-line bg-app p-2.5">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-ink">
            <Sparkles className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
            <span>Modo Automático (Título Vivo)</span>
          </p>
          <p className="truncate text-[11px] text-muted">
            {livingTitle
              ? `Ativo na sessão atual: ${livingTitle.name}`
              : 'Muda dinamicamente conforme o filme, série ou anime que você assiste.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onSelectAutoMode?.()}
          aria-pressed={isAutoMode}
          className={`min-h-[44px] shrink-0 rounded-[4px] border px-3 py-1 text-xs font-semibold transition-colors ${
            isAutoMode
              ? 'border-accent bg-accent text-accent-ink'
              : 'border-line bg-card text-muted hover:border-accent hover:text-ink'
          }`}
        >
          {isAutoMode ? 'Automático ativo' : 'Ativar automático'}
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="tablist"
          aria-label="Categorias de insígnias"
          className="flex flex-wrap gap-1"
        >
          {READER_TITLE_CATEGORIES.map((cat, idx) => {
            const active = category === cat.id;
            return (
              <button
                key={cat.id}
                ref={(el) => {
                  categoryTabRefs.current[idx] = el;
                }}
                type="button"
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                onClick={() => {
                  setCategory(cat.id);
                  setVisibleCount(PAGE_SIZE);
                }}
                onKeyDown={(e) => handleCategoryKeyDown(e, idx)}
                className={`min-h-[40px] rounded-[4px] border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  active
                    ? 'border-accent bg-accent/15 text-accent'
                    : 'border-line bg-app hover:text-ink'
                }`}
                style={!active ? { color: 'var(--text-secondary)' } : undefined}
              >
                {cat.label}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => {
            setOnlyUnlocked((p) => !p);
            setVisibleCount(PAGE_SIZE);
          }}
          aria-pressed={onlyUnlocked}
          className={`min-h-[40px] rounded-[4px] border px-2.5 py-1 text-[11px] font-medium tabular-nums transition-colors ${
            onlyUnlocked
              ? 'border-accent text-accent'
              : 'border-line text-muted hover:text-ink'
          }`}
        >
          Conquistadas ({unlockedCount})
        </button>
      </div>

      <label className="relative block">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle"
          strokeWidth={1.5}
        />
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setVisibleCount(PAGE_SIZE);
          }}
          placeholder="Filtrar insígnias por gênero, formato ou critério..."
          aria-label="Filtrar insígnias"
          className="min-h-[44px] w-full rounded-[4px] border border-line bg-app py-2 pl-9 pr-3 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
        />
      </label>

      {filtered.length === 0 ? (
        <div className="rounded-[4px] border border-line bg-app py-8 text-center text-xs text-muted">
          Nenhuma insígnia encontrada para este filtro.
        </div>
      ) : (
        <div className={compact ? 'space-y-2' : 'space-y-2'}>
          {visibleItems.map((badge) => {
            const isPinnedActive =
              badge.unlocked &&
              !isAutoMode &&
              (resolvedActiveBadge?.id === badge.id ||
                resolvedActiveBadge?.name === badge.name);
            const currentClamped = Math.min(badge.current, badge.target);

            return (
              <div
                key={badge.id}
                className={`group rounded-[4px] border p-3 ${
                  badge.unlocked
                    ? 'border-line bg-app'
                    : 'border-line bg-card'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <span
                      className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] border ${
                        badge.unlocked
                          ? 'border-accent/40 bg-card text-accent'
                          : 'border-line bg-app'
                      }`}
                      style={
                        !badge.unlocked
                          ? { color: 'var(--text-secondary)' }
                          : undefined
                      }
                    >
                      {badge.unlocked ? (
                        <VectorIcon name={badge.iconName} className="h-4 w-4" />
                      ) : (
                        <Lock className="h-3.5 w-3.5" strokeWidth={1.5} />
                      )}
                    </span>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <h3 className="text-xs font-semibold text-ink">
                          {badge.name}
                        </h3>
                        <span className="rounded-[2px] border border-line bg-card px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-subtle">
                          {badge.tier}
                        </span>
                      </div>
                      <p
                        className={`mt-0.5 text-[11px] ${
                          badge.unlocked
                            ? 'text-muted'
                            : 'text-subtle group-hover:text-ink group-focus-within:text-ink'
                        }`}
                      >
                        {badge.unlocked
                          ? badge.description
                          : `Como conquistar: ${badge.description}`}
                      </p>
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    {badge.unlocked ? (
                      <button
                        type="button"
                        onClick={() => handlePinAttempt(badge)}
                        className={`inline-flex min-h-[44px] items-center gap-1 rounded-[4px] border px-3 text-[11px] font-medium transition-colors ${
                          isPinnedActive
                            ? 'border-accent bg-accent text-accent-ink'
                            : 'border-line bg-card text-ink hover:border-accent hover:text-accent'
                        }`}
                      >
                        {isPinnedActive ? (
                          <>
                            <Check className="h-3 w-3" strokeWidth={1.5} />
                            <span>Fixada</span>
                          </>
                        ) : (
                          <>
                            <Award className="h-3 w-3 text-accent" strokeWidth={1.5} />
                            <span>Fixar</span>
                          </>
                        )}
                      </button>
                    ) : (
                      <button
                        type="button"
                        aria-disabled="true"
                        onClick={(e) => {
                          e.preventDefault();
                        }}
                        title={`Bloqueada — Como conquistar: ${badge.description}`}
                        aria-label={`${badge.name} bloqueada. Como conquistar: ${badge.description}`}
                        className="inline-flex min-h-[44px] cursor-not-allowed items-center gap-1 rounded-[4px] border border-line bg-app px-2.5 text-[11px] text-subtle focus:border-accent focus:text-ink focus:outline-none"
                      >
                        <Lock className="h-3 w-3" strokeWidth={1.5} />
                        <span>Bloqueada</span>
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-2 flex items-center gap-2">
                  <div
                    role="progressbar"
                    aria-label={`Progresso de ${badge.name}`}
                    aria-valuemin={0}
                    aria-valuemax={badge.target}
                    aria-valuenow={currentClamped}
                    className="h-[2px] flex-1 overflow-hidden rounded-[2px] bg-line"
                  >
                    <div
                      className="h-full transition-all duration-150"
                      style={{
                        width: `${badge.progressPct}%`,
                        backgroundColor: badge.unlocked
                          ? 'var(--accent-color)'
                          : 'var(--text-secondary)',
                      }}
                    />
                  </div>
                  <span className="text-[10px] tabular-nums text-muted">
                    {badge.current}/{badge.target}
                  </span>
                </div>
              </div>
            );
          })}

          {remaining > 0 && (
            <button
              type="button"
              onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
              className="min-h-[44px] w-full rounded-[4px] border border-line bg-card py-2 text-xs font-medium text-ink hover:border-accent hover:text-accent tabular-nums"
            >
              Carregar mais ({remaining} restantes)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
