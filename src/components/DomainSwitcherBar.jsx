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
            className={`inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-[6px] border px-3 py-1.5 text-xs font-semibold tabular-nums transition-colors ${
              activeDomain === 'all'
                ? 'border-accent bg-accent text-accent-ink'
                : 'border-line bg-card text-muted hover:text-ink'
            }`}
          >
            <Layers className="h-3.5 w-3.5" strokeWidth={1.5} />
            <span>Todos</span>
            <span className="text-[11px] font-semibold tabular-nums opacity-80">
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
              style={
                active
                  ? {
                      borderColor: portal.palette.accent,
                      backgroundColor: portal.palette.accent,
                      color: portal.palette.accentContrast,
                    }
                  : undefined
              }
              className={`inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-[6px] border px-3 py-1.5 text-xs font-semibold tabular-nums transition-colors ${
                active ? '' : 'border-line bg-card text-muted hover:text-ink'
              }`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
              <span>{portal.tabLabel || portal.shortLabel}</span>
              <span className="text-[11px] font-semibold tabular-nums opacity-80">
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
          className={`flex min-h-[46px] items-center justify-between gap-2 rounded-[6px] border px-3 py-2 text-left transition-colors ${
            activeDomain === 'all'
              ? 'border-accent bg-accent text-accent-ink'
              : 'border-line bg-card text-muted hover:text-ink'
          }`}
        >
          <span className="inline-flex min-w-0 items-center gap-2">
            <Layers className="h-4 w-4 shrink-0" strokeWidth={1.5} />
            <span className="truncate text-xs font-semibold">Todos</span>
          </span>
          <span className="shrink-0 text-xs font-semibold tabular-nums opacity-80">
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
            style={
              isActive
                ? {
                    backgroundColor: portal.palette.accent,
                    borderColor: portal.palette.accent,
                    color: portal.palette.accentContrast,
                  }
                : undefined
            }
            className={`flex min-h-[46px] items-center justify-between gap-2 rounded-[6px] border px-3 py-2 text-left transition-colors ${
              isActive
                ? ''
                : 'border-line bg-card text-muted hover:text-ink'
            }`}
          >
            <span className="inline-flex min-w-0 items-center gap-2">
              <PortalIcon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
              <span className="truncate text-xs font-semibold">
                {portal.tabLabel || portal.shortLabel}
              </span>
            </span>

            <span className="shrink-0 text-xs font-semibold tabular-nums opacity-80">
              {portal.count}
            </span>
          </button>
        );
      })}
    </section>
  );
}
