import { Check, Plus, RefreshCw, Search, User } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getStatusConfigForDomain,
  inferDomainFromWork,
  normalizeDomainId,
} from '../config/domainConfig';
import {
  computeEntityCompleteness,
  ENTITY_ROLE_LABELS,
  findCatalogWorksForEntity,
  getManualEntityMeta,
  saveManualEntityMeta,
} from '../lib/entityHelpers';
import { buildManualExternalIds } from '../lib/manualWorkLink';
import { formatStarsNumber } from '../lib/ratingModel';
import { searchCinemaMedia } from '../services/cinemaApi';
import { createUuid } from '../services/codiceDatabase';
import { searchWorksByDomain } from '../services/multiDomainSearchService';
import { findCatalogDuplicate } from '../utils/catalogDraftHelpers';
import { CoverArt } from './CoverArt';
import { ResponsiveSheet } from './ResponsiveSheet';
import { StarRatingDisplay } from './StarRatingPicker';

const ENTITY_DEFAULT_WORK_TYPE = {
  reading: 'book',
  games: 'game',
  music: 'album',
  cinema: 'movie',
  animes: 'anime',
};

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
  const [entityMeta, setEntityMeta] = useState(null);
  const [editingTotal, setEditingTotal] = useState(false);
  const [totalInput, setTotalInput] = useState('');
  const [seriesInput, setSeriesInput] = useState('');
  const [showManualAddForm, setShowManualAddForm] = useState(false);
  const [manualTitle, setManualTitle] = useState('');
  const [manualYear, setManualYear] = useState('');
  const [manualVolume, setManualVolume] = useState('');
  const [manualSeries, setManualSeries] = useState('');
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
    if (!isOpen || !entityName) {
      setEntityMeta(null);
      setEditingTotal(false);
      setShowManualAddForm(false);
      return;
    }
    const stored = getManualEntityMeta({
      name: entityName,
      domain: entityDomain,
      role: entityRole,
    });
    setEntityMeta(stored);
    setTotalInput(stored?.mainSeriesTotal ? String(stored.mainSeriesTotal) : '');
    setSeriesInput(stored?.seriesName || '');
    setManualSeries(stored?.seriesName || '');
    setEditingTotal(false);
    setShowManualAddForm(false);
    setManualTitle('');
    setManualYear('');
    setManualVolume('');
  }, [isOpen, entityName, entityDomain, entityRole]);

  const completeness = useMemo(
    () =>
      computeEntityCompleteness({
        works: localData.works,
        mainSeriesTotal: entityMeta?.mainSeriesTotal ?? null,
      }),
    [localData.works, entityMeta]
  );

  const queueActionLabel = entityDomain === 'reading' ? 'Quero ler' : 'Na fila';

  const handleSaveEntityTotal = (event) => {
    event?.preventDefault();
    const parsed = Number(String(totalInput || '').trim());
    const validTotal = Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
    const saved = saveManualEntityMeta(
      { name: entityName, domain: entityDomain, role: entityRole },
      { mainSeriesTotal: validTotal, seriesName: seriesInput.trim() }
    );
    setEntityMeta(saved);
    setTotalInput(saved?.mainSeriesTotal ? String(saved.mainSeriesTotal) : '');
    setEditingTotal(false);
  };

  const handleClearEntityTotal = () => {
    const saved = saveManualEntityMeta(
      { name: entityName, domain: entityDomain, role: entityRole },
      { mainSeriesTotal: null, seriesName: seriesInput.trim() }
    );
    setEntityMeta(saved);
    setTotalInput('');
    setEditingTotal(false);
  };

  const handleCreateManualMissingWork = (event) => {
    event?.preventDefault();
    const cleanTitle = manualTitle.trim();
    if (!cleanTitle || !onQuickCatalogCandidate) return;
    const parsedYear = Number(String(manualYear || '').trim());
    const cleanYear =
      Number.isFinite(parsedYear) && parsedYear >= 1000 && parsedYear <= 2100
        ? Math.round(parsedYear)
        : null;
    const manualId = createUuid();
    const cleanSeries = manualSeries.trim() || entityMeta?.seriesName || '';
    const cleanVolume = manualVolume.trim();

    onQuickCatalogCandidate({
      id: manualId,
      domain: entityDomain,
      workType: ENTITY_DEFAULT_WORK_TYPE[entityDomain] || 'book',
      title: cleanTitle,
      creator: entityName,
      director: entityName,
      author: entityDomain === 'reading' ? entityName : undefined,
      releaseYear: cleanYear,
      franchiseName: cleanSeries || undefined,
      seriesVolume: cleanVolume || undefined,
      status: 'queued',
      isWishlist: true,
      inBacklog: true,
      isManual: true,
      ids: buildManualExternalIds(manualId),
      sourceBadge: 'Cadastro manual',
    });

    setManualTitle('');
    setManualYear('');
    setManualVolume('');
    setShowManualAddForm(false);
  };

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

        {/* Completude local / saga definida manualmente */}
        <section className="rounded-[8px] border border-line bg-surface p-3 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
                Completude{entityMeta?.seriesName ? ` · ${entityMeta.seriesName}` : ''}
              </h3>
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-ink">
                {completeness.isOpenEnded
                  ? `${completeness.completed} concluída(s) · total aberto`
                  : `Linha Principal ${completeness.completed} / ${completeness.mainSeriesTotal} · ${completeness.pct}%`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setEditingTotal((prev) => !prev)}
              className="inline-flex min-h-[44px] items-center rounded-[6px] border border-line bg-card px-3 text-xs font-semibold text-ink hover:border-muted"
            >
              {editingTotal
                ? 'Fechar'
                : completeness.isOpenEnded
                  ? 'Definir total'
                  : 'Editar total'}
            </button>
          </div>

          {!completeness.isOpenEnded && (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-void">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{ width: `${completeness.pct}%` }}
              />
            </div>
          )}

          {editingTotal && (
            <form onSubmit={handleSaveEntityTotal} className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className="text-xs text-muted">Total na saga / linha principal</span>
                <input
                  type="number"
                  min="1"
                  max="999"
                  value={totalInput}
                  onChange={(e) => setTotalInput(e.target.value)}
                  placeholder="Ex.: 5"
                  className="min-h-[44px] w-full rounded-[6px] border border-line bg-void px-3 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-muted">Nome da saga (opcional)</span>
                <input
                  type="text"
                  value={seriesInput}
                  onChange={(e) => setSeriesInput(e.target.value)}
                  placeholder="Ex.: Trilogia inicial"
                  className="min-h-[44px] w-full rounded-[6px] border border-line bg-void px-3 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none"
                />
              </label>
              <div className="flex items-center gap-2 sm:col-span-2">
                <button
                  type="submit"
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[6px] bg-accent px-3.5 text-xs font-semibold text-on-accent"
                >
                  <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
                  <span>Salvar total</span>
                </button>
                {!completeness.isOpenEnded && (
                  <button
                    type="button"
                    onClick={handleClearEntityTotal}
                    className="inline-flex min-h-[44px] items-center rounded-[6px] border border-line bg-card px-3 text-xs font-semibold text-muted hover:text-ink"
                  >
                    Deixar aberto
                  </button>
                )}
              </div>
            </form>
          )}
        </section>

        {/* Adicionar obra faltante manualmente em Quero ler / Na fila */}
        {onQuickCatalogCandidate && (
          <section className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setShowManualAddForm((prev) => !prev)}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[6px] border border-line bg-card px-3 text-xs font-semibold text-ink hover:border-muted"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                <span>Adicionar obra faltante ({queueActionLabel})</span>
              </button>
            </div>

            {showManualAddForm && (
              <form
                onSubmit={handleCreateManualMissingWork}
                className="grid grid-cols-1 gap-2 rounded-[8px] border border-line bg-surface p-3 sm:grid-cols-3"
              >
                <label className="block space-y-1 sm:col-span-3">
                  <span className="text-xs text-muted">Título da obra *</span>
                  <input
                    type="text"
                    required
                    value={manualTitle}
                    onChange={(e) => setManualTitle(e.target.value)}
                    placeholder={`Nova obra de ${entityName}`}
                    className="min-h-[44px] w-full rounded-[6px] border border-line bg-void px-3 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs text-muted">Ano (opcional)</span>
                  <input
                    type="number"
                    min="1000"
                    max="2100"
                    value={manualYear}
                    onChange={(e) => setManualYear(e.target.value)}
                    placeholder="2025"
                    className="min-h-[44px] w-full rounded-[6px] border border-line bg-void px-3 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs text-muted">Volume (opcional)</span>
                  <input
                    type="text"
                    value={manualVolume}
                    onChange={(e) => setManualVolume(e.target.value)}
                    placeholder="Vol. 2"
                    className="min-h-[44px] w-full rounded-[6px] border border-line bg-void px-3 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs text-muted">Saga (opcional)</span>
                  <input
                    type="text"
                    value={manualSeries}
                    onChange={(e) => setManualSeries(e.target.value)}
                    placeholder="Nome da saga"
                    className="min-h-[44px] w-full rounded-[6px] border border-line bg-void px-3 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none"
                  />
                </label>
                <div className="flex items-center gap-2 sm:col-span-3">
                  <button
                    type="submit"
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[6px] bg-accent px-3.5 text-xs font-semibold text-on-accent"
                  >
                    <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                    <span>Salvar como {queueActionLabel}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowManualAddForm(false)}
                    className="inline-flex min-h-[44px] items-center rounded-[6px] border border-line bg-card px-3 text-xs font-semibold text-muted hover:text-ink"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            )}
          </section>
        )}

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
              Não foi possível consultar fontes externas agora. Os dados locais continuam disponíveis acima.
            </p>
          ) : !loadingExternal && uncatalogedExternal.length === 0 ? (
            <p className="text-xs text-muted">
              Ficha alimentada pelo seu catálogo local — nenhum título adicional encontrado nas fontes externas para {entityName}.
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
