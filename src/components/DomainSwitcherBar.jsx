import { BookOpen, Film, Gamepad2, Layers, Music } from 'lucide-react';
import { useMemo } from 'react';
import {
  OMNIPRISM_DOMAINS,
  inferDomainFromWork,
} from '../config/domainConfig';
import { buildDomainPortalPalette } from '../utils/themeTokens';

const DOMAIN_ICONS = {
  Film,
  BookOpen,
  Gamepad2,
  Music,
};

export function DomainSwitcherBar({
  activeDomain = 'cinema',
  onSelectDomain,
  items = [],
  themeMode = 'dark',
  includeAll = false,
  compact = false,
  ariaLabel = 'Portais de Domínio OmniPrism',
}) {
  const countsByDomain = useMemo(() => {
    const counts = { all: 0, cinema: 0, reading: 0, games: 0, music: 0 };
    for (const item of Array.isArray(items) ? items : []) {
      if (!item || item.inBacklog === false) continue;
      counts.all += 1;
      const d = inferDomainFromWork(item);
      if (d in counts) counts[d] += 1;
    }
    return counts;
  }, [items]);

  const portals = useMemo(
    () =>
      OMNIPRISM_DOMAINS.map((domain) => ({
        ...domain,
        count: countsByDomain[domain.id] || 0,
        palette: buildDomainPortalPalette(domain.tintHex, themeMode),
      })),
    [countsByDomain, themeMode]
  );

  if (compact) {
    return (
      <div
        role="tablist"
        aria-label={ariaLabel}
        className="flex gap-1.5 overflow-x-auto pb-0.5 no-scrollbar"
      >
        {includeAll && (
          <button
            type="button"
            role="tab"
            aria-selected={activeDomain === 'all'}
            onClick={() => onSelectDomain?.('all')}
            className={`inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-[6px] border px-3 py-1.5 text-xs font-semibold tabular-nums transition-colors ${
              activeDomain === 'all'
                ? 'border-accent bg-accent/15 text-ink'
                : 'border-line bg-card text-muted hover:text-ink'
            }`}
          >
            <Layers className="h-3.5 w-3.5 text-accent" strokeWidth={1.75} />
            <span>Todos</span>
            <span className="rounded-full bg-app px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted">
              {countsByDomain.all}
            </span>
          </button>
        )}
        {portals.map((portal) => {
          const Icon = DOMAIN_ICONS[portal.icon] || Film;
          const active = activeDomain === portal.id;
          return (
            <button
              key={portal.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelectDomain?.(portal.id)}
              style={{
                borderColor: active ? portal.palette.accent : portal.palette.border,
                backgroundColor: active ? portal.palette.surface : undefined,
              }}
              className={`inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-[6px] border px-3 py-1.5 text-xs font-semibold tabular-nums transition-colors ${
                active ? 'text-ink' : 'bg-card text-muted hover:text-ink'
              }`}
            >
              <Icon
                className="h-3.5 w-3.5 shrink-0"
                style={{ color: portal.palette.accent }}
                strokeWidth={1.75}
              />
              <span>{portal.tabLabel || portal.shortLabel}</span>
              <span
                className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
                style={{
                  backgroundColor: active
                    ? portal.palette.accent
                    : portal.palette.elevated,
                  color: active
                    ? portal.palette.accentContrast
                    : portal.palette.accent,
                }}
              >
                {portal.count}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <section
      role="tablist"
      aria-label={ariaLabel}
      className={`grid gap-2 ${includeAll ? 'grid-cols-2 sm:grid-cols-5' : 'grid-cols-2 sm:grid-cols-4'}`}
    >
      {includeAll && (
        <button
          type="button"
          role="tab"
          aria-selected={activeDomain === 'all'}
          onClick={() => onSelectDomain?.('all')}
          className={`group flex min-h-[46px] items-center justify-between gap-2 rounded-[6px] border px-3 py-2 text-left transition-colors ${
            activeDomain === 'all'
              ? 'border-accent bg-accent/15 shadow-sm'
              : 'border-line bg-card hover:bg-elevated/60'
          }`}
        >
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <Layers className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.75} />
            <span className="truncate text-xs font-semibold text-ink">Todos</span>
          </span>
          <span className="inline-flex shrink-0 items-center rounded-full bg-app px-2 py-0.5 text-[10px] font-semibold tabular-nums text-muted">
            {countsByDomain.all}
          </span>
        </button>
      )}
      {portals.map((portal) => {
        const PortalIcon = DOMAIN_ICONS[portal.icon] || Film;
        const isActive = activeDomain === portal.id;
        return (
          <button
            key={portal.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelectDomain?.(portal.id)}
            style={{
              backgroundColor: isActive ? portal.palette.surface : undefined,
              borderColor: isActive ? portal.palette.accent : portal.palette.border,
            }}
            className={`group flex min-h-[46px] items-center justify-between gap-2 rounded-[6px] border px-3 py-2 text-left transition-colors ${
              isActive ? 'shadow-sm' : 'bg-card hover:bg-elevated/60'
            }`}
          >
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px]"
                style={{
                  backgroundColor: portal.palette.elevated,
                  color: portal.palette.accent,
                }}
              >
                <PortalIcon className="h-3.5 w-3.5" strokeWidth={1.75} />
              </span>
              <span className="truncate text-xs font-semibold text-ink">
                {portal.tabLabel || portal.shortLabel}
              </span>
            </span>

            <span
              className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums"
              style={{
                backgroundColor: isActive
                  ? portal.palette.accent
                  : portal.palette.elevated,
                color: isActive
                  ? portal.palette.accentContrast
                  : portal.palette.accent,
              }}
            >
              {portal.count}
            </span>
          </button>
        );
      })}
    </section>
  );
}
