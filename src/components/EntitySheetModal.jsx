import { Plus, RefreshCw, Search, User } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getStatusConfigForDomain,
  inferDomainFromWork,
  normalizeDomainId,
} from '../config/domainConfig';
import {
  ENTITY_ROLE_LABELS,
  findCatalogWorksForEntity,
} from '../lib/entityHelpers';
import { formatStarsNumber } from '../lib/ratingModel';
import { searchCinemaMedia } from '../services/cinemaApi';
import { searchWorksByDomain } from '../services/multiDomainSearchService';
import { findCatalogDuplicate } from '../utils/catalogDraftHelpers';
import { CoverArt } from './CoverArt';
import { ResponsiveSheet } from './ResponsiveSheet';
import { StarRatingDisplay } from './StarRatingPicker';

export function EntitySheetModal({
  entity = null,
  allItems = [],
  tmdbKey = '',
  onClose,
  onSelectWork,
  onQuickCatalogCandidate,
}) {
  const isOpen = Boolean(entity && entity.name);
  const entityName = String(entity?.name || '').trim();
  const entityRole = entity?.role || 'director';
  const entityDomain = normalizeDomainId(entity?.domain || 'cinema');
  const roleLabel = ENTITY_ROLE_LABELS[entityRole] || 'Entidade';

  const [externalResults, setExternalResults] = useState([]);
  const [loadingExternal, setLoadingExternal] = useState(false);
  const [externalError, setExternalError] = useState(false);
  const abortRef = useRef(null);

  const localData = useMemo(
    () =>
      isOpen
        ? findCatalogWorksForEntity(allItems, {
            name: entityName,
            role: entityRole,
            domain: 'all',
          })
        : { works: [], stats: { total: 0, completed: 0, averageStars: null } },
    [isOpen, allItems, entityName, entityRole]
  );

  useEffect(() => {
    if (!isOpen || entityName.length < 2) {
      setExternalResults([]);
      setLoadingExternal(false);
      setExternalError(false);
      return undefined;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoadingExternal(true);
    setExternalError(false);
    setExternalResults([]);

    const run = async () => {
      try {
        if (entityDomain === 'cinema') {
          const res = await searchCinemaMedia(entityName, {
            filter: 'all',
            tmdbApiKey: tmdbKey,
            signal: controller.signal,
            onPartialResults: (p) => {
              if (!controller.signal.aborted && Array.isArray(p?.results)) {
                setExternalResults(p.results.slice(0, 12));
                setLoadingExternal(false);
              }
            },
          });
          if (!controller.signal.aborted) {
            setExternalResults((res.results || []).slice(0, 12));
          }
        } else {
          const res = await searchWorksByDomain(entityDomain, entityName, {
            signal: controller.signal,
            mediaTypeFilter: 'all',
            onPartialResults: (p) => {
              if (!controller.signal.aborted && Array.isArray(p?.results)) {
                setExternalResults(p.results.slice(0, 12));
                setLoadingExternal(false);
              }
            },
          });
          if (!controller.signal.aborted) {
            setExternalResults((res.results || []).slice(0, 12));
          }
        }
      } catch (err) {
        if (err?.name !== 'AbortError' && !controller.signal.aborted) {
          setExternalError(true);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoadingExternal(false);
        }
      }
    };

    run();
    return () => {
      controller.abort();
    };
  }, [isOpen, entityName, entityDomain, tmdbKey]);

  const uncatalogedExternal = useMemo(
    () =>
      externalResults.filter(
        (cand) => !findCatalogDuplicate(cand, allItems)
      ),
    [externalResults, allItems]
  );

  return (
    <ResponsiveSheet
      isOpen={isOpen}
      onClose={onClose}
      title={entityName}
      subtitle={`${roleLabel} · ${localData.stats.total} no catálogo · ${localData.stats.completed} concluída(s)${
        localData.stats.averageStars !== null
          ? ` · média ${formatStarsNumber(localData.stats.averageStars)}`
          : ''
      }`}
      icon={User}
      ariaLabel={`Página da entidade ${entityName}`}
    >
      <div className="space-y-5 p-1" data-testid="entity-sheet-modal">
        {/* Obras já catalogadas no acervo local */}
        <section className="space-y-2.5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
            No seu catálogo ({localData.works.length})
          </h3>
          {localData.works.length === 0 ? (
            <p className="text-xs text-muted">
              Nenhuma obra associada a {entityName} no seu catálogo ainda.
            </p>
          ) : (
            <div className="divide-y divide-line border-y border-line">
              {localData.works.map((work) => {
                const wDomain = inferDomainFromWork(work);
                const st = getStatusConfigForDomain(work.status, wDomain);
                return (
                  <button
                    key={work.id}
                    type="button"
                    onClick={() => {
                      onClose?.();
                      onSelectWork?.(work);
                    }}
                    className="flex min-h-[60px] w-full items-center gap-3 py-2.5 text-left hover:opacity-90"
                  >
                    <CoverArt
                      item={work}
                      compact
                      className={`w-10 shrink-0 rounded-[6px] ${
                        wDomain === 'music' ? 'aspect-square' : 'aspect-[2/3]'
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-editorial truncate text-sm font-semibold text-ink">
                        {work.title}
                      </p>
                      <p className="text-xs tabular-nums text-muted">
                        {[work.releaseYear || null, st?.label || null].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <StarRatingDisplay work={work} size="sm" showNumeric />
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Busca filtrada nas APIs externas */}
        <section className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
              <Search className="h-3.5 w-3.5" strokeWidth={1.5} />
              <span>Explorar nas fontes externas</span>
            </h3>
            {loadingExternal && (
              <RefreshCw className="h-3.5 w-3.5 animate-spin text-accent" strokeWidth={1.5} />
            )}
          </div>

          {externalError ? (
            <p className="text-xs text-muted">
              Não foi possível consultar fontes externas agora.
            </p>
          ) : !loadingExternal && uncatalogedExternal.length === 0 ? (
            <p className="text-xs text-muted">
              Nenhum título adicional encontrado nas fontes externas para {entityName}.
            </p>
          ) : (
            <div className="divide-y divide-line border-y border-line">
              {uncatalogedExternal.map((cand) => {
                const cDomain = normalizeDomainId(cand.domain || entityDomain);
                return (
                  <div
                    key={cand.id}
                    className="flex items-center justify-between gap-3 py-2.5"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <CoverArt
                        item={cand}
                        compact
                        className={`w-10 shrink-0 rounded-[6px] ${
                          cDomain === 'music' ? 'aspect-square' : 'aspect-[2/3]'
                        }`}
                      />
                      <div className="min-w-0">
                        <p className="font-editorial truncate text-sm font-semibold text-ink">
                          {cand.title}
                        </p>
                        <p className="truncate text-xs tabular-nums text-muted">
                          {[cand.creator || cand.director, cand.releaseYear, cand.sourceBadge]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>
                    </div>
                    {onQuickCatalogCandidate && (
                      <button
                        type="button"
                        onClick={() => onQuickCatalogCandidate(cand)}
                        className="inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-[6px] border border-line bg-card px-3 text-xs font-semibold text-ink hover:border-muted"
                      >
                        <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                        <span>Adicionar</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </ResponsiveSheet>
  );
}
