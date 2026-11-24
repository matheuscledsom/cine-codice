import { CheckCircle2, Compass, GitBranch, Link2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  FRANCHISE_TIER_OPTIONS,
  UNCLASSIFIED_FRANCHISE_TIER,
  getFranchiseTierMeta,
  inferFranchiseTier,
} from '../lib/franchiseTier';
import { buildMissingFranchiseEntryDraft } from '../services/franchiseEngine';
import {
  buildUnifiedFranchiseModel,
  buildUniverseSuggestionsModel,
  fetchTmdbCollectionParts,
  fetchTmdbUniverseSuggestionsByKeyword,
  fetchTmdbWorkKeywords,
} from '../services/franchiseService';
import { StatusBadge } from './StatusBadge';

const MANUAL_RELATION_OPTIONS = [
  { id: 'SEQUEL', label: 'Sequência' },
  { id: 'PREQUEL', label: 'Prequel' },
  { id: 'SPIN_OFF', label: 'Spin-off' },
  { id: 'SIDE_STORY', label: 'História Paralela / OVA' },
  { id: 'SPECIAL', label: 'Especial' },
  { id: 'MOVIE', label: 'Filme do Universo' },
];

export function FranchiseRadarPanel({
  item,
  allItems = [],
  franchise = null,
  tmdbKey = '',
  onSelectItem,
  onQuickCatalogItem,
  onUpdateItem,
  onShowToast,
}) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [selectedTargetId, setSelectedTargetId] = useState('');
  const [manualTitle, setManualTitle] = useState('');
  const [relationType, setRelationType] = useState('SPIN_OFF');
  const [remoteCollectionParts, setRemoteCollectionParts] = useState([]);
  const [activeGroupTab, setActiveGroupTab] = useState('all');
  const [activeTierTab, setActiveTierTab] = useState('all');
  const [universeOpen, setUniverseOpen] = useState(false);
  const [universeKeywords, setUniverseKeywords] = useState([]);
  const [activeKeyword, setActiveKeyword] = useState(null);
  const [universeSuggestionsRaw, setUniverseSuggestionsRaw] = useState([]);
  const [loadingUniverse, setLoadingUniverse] = useState(false);

  useEffect(() => {
    setActiveGroupTab('all');
    setActiveTierTab('all');
    setRemoteCollectionParts([]);
    setUniverseOpen(false);
    setUniverseKeywords([]);
    setActiveKeyword(null);
    setUniverseSuggestionsRaw([]);
    const colId = item?.belongsToCollection?.id;
    if (item?.workType === 'movie' && colId) {
      let cancelled = false;
      fetchTmdbCollectionParts(colId, { apiKey: tmdbKey })
        .then((parts) => {
          if (!cancelled && Array.isArray(parts) && parts.length > 0) {
            setRemoteCollectionParts(parts);
          }
        })
        .catch(() => {});
      return () => {
        cancelled = true;
      };
    }
    return undefined;
  }, [item?.id, item?.workType, item?.belongsToCollection?.id, tmdbKey]);

  const universeSuggestions = useMemo(
    () => buildUniverseSuggestionsModel(universeSuggestionsRaw, allItems),
    [universeSuggestionsRaw, allItems]
  );

  const handleLoadUniverseKeywords = async () => {
    if (!item || loadingUniverse) return;
    setUniverseOpen(true);
    setLoadingUniverse(true);
    try {
      const kws = await fetchTmdbWorkKeywords(item, { apiKey: tmdbKey });
      setUniverseKeywords(kws);
      const preferred = kws.find((k) => k.isUniverseHint) || kws[0] || null;
      if (preferred) {
        setActiveKeyword(preferred);
        const res = await fetchTmdbUniverseSuggestionsByKeyword(preferred.id, {
          keywordName: preferred.name,
          apiKey: tmdbKey,
        });
        setUniverseSuggestionsRaw(res.suggestions || []);
      }
    } finally {
      setLoadingUniverse(false);
    }
  };

  const handlePickUniverseKeyword = async (kw) => {
    if (!kw?.id || loadingUniverse) return;
    setActiveKeyword(kw);
    setLoadingUniverse(true);
    try {
      const res = await fetchTmdbUniverseSuggestionsByKeyword(kw.id, {
        keywordName: kw.name,
        apiKey: tmdbKey,
      });
      setUniverseSuggestionsRaw(res.suggestions || []);
    } finally {
      setLoadingUniverse(false);
    }
  };

  const model = useMemo(
    () =>
      item
        ? buildUnifiedFranchiseModel(
            item,
            allItems,
            remoteCollectionParts
          )
        : null,
    [item, allItems, remoteCollectionParts]
  );

  if (!item || !model) return null;

  const existingManualLinks = Array.isArray(item.franchiseLinks) ? item.franchiseLinks : [];
  const otherCatalogItems = (Array.isArray(allItems) ? allItems : []).filter(
    (entry) => entry && entry.id !== item.id && entry.inBacklog !== false
  );

  const handleAddManualLink = (e) => {
    e.preventDefault();
    const targetWork = selectedTargetId
      ? otherCatalogItems.find((c) => c.id === selectedTargetId) || null
      : null;
    const resolvedTitle = (targetWork?.title || manualTitle).trim();
    if (!resolvedTitle) return;

    const newLink = {
      targetWorkId: targetWork?.id || null,
      title: resolvedTitle,
      workType: targetWork?.workType || (relationType === 'MOVIE' ? 'movie' : 'series'),
      relationType,
      tmdbId: targetWork?.ids?.tmdb || targetWork?.tmdbId || null,
      anilistId: targetWork?.ids?.anilist || targetWork?.anilistId || null,
    };

    const nextLinks = [...existingManualLinks, newLink];
    onUpdateItem?.(item.id, { franchiseLinks: nextLinks });
    setSelectedTargetId('');
    setManualTitle('');
    setLinkOpen(false);
    onShowToast?.({ message: `Vínculo "${resolvedTitle}" adicionado.`, type: 'success' });
  };

  const handleRemoveManualLink = (idx) => {
    const nextLinks = existingManualLinks.filter((_, i) => i !== idx);
    onUpdateItem?.(item.id, { franchiseLinks: nextLinks });
  };

  const effectiveFranchise = franchise || model.baseFranchise;
  const stats = effectiveFranchise?.stats || null;
  const scopeProgress = model.scopeProgress || null;
  const currentWorkTier = inferFranchiseTier(item);

  const groupFilteredEntries =
    model.mode === 'series-universe' && activeGroupTab !== 'all'
      ? model.groups?.find((g) => g.id === activeGroupTab)?.entries || []
      : model.entries;

  const visibleEntries =
    activeTierTab === 'all'
      ? groupFilteredEntries
      : groupFilteredEntries.filter(
          (entry) => inferFranchiseTier(entry) === activeTierTab
        );

  return (
    <section
      aria-label={model.sectionTitle}
      data-testid="franchise-radar-panel"
      className="mt-4 rounded-[6px] border border-line bg-app p-4 space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <GitBranch className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />
          <div className="min-w-0">
            <h4 className="font-editorial truncate text-sm font-semibold text-ink">
              {model.sectionTitle} · {model.sagaName}
            </h4>
            <p className="text-xs font-medium tabular-nums text-muted">
              {model.progressHeader}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {stats?.hasComparative && stats.rankLabel && (
            <span className="text-xs font-semibold tabular-nums text-ink">
              {stats.rankLabel}
              {stats.franchiseAverageRating !== null
                ? ` · Média ${stats.franchiseAverageRating}`
                : ''}
            </span>
          )}
          <button
            type="button"
            onClick={() => setLinkOpen((prev) => !prev)}
            className="inline-flex min-h-[44px] items-center gap-1 rounded-[4px] border border-line bg-card px-2.5 text-[11px] font-medium text-ink hover:border-accent"
          >
            <Link2 className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
            <span>Vincular</span>
          </button>
        </div>
      </div>

      {/* Dois indicadores transparentes: Linha Principal vs Universo Completo (v2.4.0 Fase 4.2) */}
      {scopeProgress && (
        <div
          className="grid grid-cols-1 gap-2.5 border-y border-line py-3 sm:grid-cols-2"
          data-testid="franchise-scope-progress"
        >
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-xs tabular-nums">
              <span className="font-semibold text-ink">Linha Principal</span>
              <span className="font-semibold text-ink">
                {scopeProgress.mainline.label} · {scopeProgress.mainline.pct}%
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
              <div
                className="h-full bg-accent transition-all duration-200"
                style={{ width: `${Math.min(100, scopeProgress.mainline.pct)}%` }}
              />
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-xs tabular-nums">
              <span className="font-medium text-muted">Universo Completo</span>
              <span className="font-medium text-muted">
                {scopeProgress.universe.label} · {scopeProgress.universe.pct}%
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
              <div
                className="h-full bg-muted transition-all duration-200"
                style={{ width: `${Math.min(100, scopeProgress.universe.pct)}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Classificação de escopo da obra atual + filtro por escopo */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filtrar por escopo da franquia">
          {[
            { id: 'all', label: `Todos (${scopeProgress?.counts?.all ?? model.entries.length})` },
            { id: 'mainline', label: `Linha Principal (${scopeProgress?.counts?.mainline ?? 0})` },
            { id: 'spinoff', label: `Spin-off (${scopeProgress?.counts?.spinoff ?? 0})` },
            { id: 'companion', label: `Guias & Extras (${scopeProgress?.counts?.companion ?? 0})` },
          ].map((tab) => {
            const active = activeTierTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveTierTab(tab.id)}
                className={`min-h-[44px] rounded-[6px] border px-2.5 text-xs font-medium tabular-nums transition-colors ${
                  active
                    ? 'border-accent bg-accent text-accent-ink'
                    : 'border-line bg-card text-muted hover:text-ink'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {onUpdateItem && item?.id && (
          <div className="flex flex-wrap items-center gap-1 text-[11px]">
            <span className="text-subtle">Escopo desta obra:</span>
            {FRANCHISE_TIER_OPTIONS.map((opt) => {
              const active = currentWorkTier === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    onUpdateItem(item.id, { franchiseTier: opt.id });
                    onShowToast?.({
                      message: `Escopo definido: ${opt.shortLabel}`,
                      type: 'success',
                    });
                  }}
                  aria-pressed={active}
                  title={opt.label}
                  className={`min-h-[44px] rounded-[6px] border px-2 text-[11px] font-medium ${
                    active
                      ? 'border-accent bg-accent text-accent-ink'
                      : 'border-line bg-card text-muted hover:text-ink'
                  }`}
                >
                  {opt.shortLabel}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Abas / Grupos para Séries & Animes ("Obras do Mesmo Universo") */}
      {model.mode === 'series-universe' && Array.isArray(model.groups) && (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setActiveGroupTab('all')}
            className={`min-h-[44px] rounded-[6px] border px-2.5 py-1 text-xs font-semibold tabular-nums ${
              activeGroupTab === 'all'
                ? 'border-accent bg-accent text-accent-ink'
                : 'border-line bg-card text-muted hover:text-ink'
            }`}
          >
            Todas ({model.completedCount}/{model.totalCount})
          </button>
          {model.groups.map((grp) => (
            <button
              key={grp.id}
              type="button"
              onClick={() => setActiveGroupTab(grp.id)}
              className={`min-h-[44px] rounded-[6px] border px-2.5 py-1 text-xs font-medium tabular-nums ${
                activeGroupTab === grp.id
                  ? 'border-accent bg-accent text-accent-ink'
                  : 'border-line bg-card text-muted hover:text-ink'
              }`}
            >
              {grp.label} ({grp.completedCount}/{grp.totalCount})
            </button>
          ))}
        </div>
      )}

      {linkOpen && (
        <form
          onSubmit={handleAddManualLink}
          className="space-y-2 rounded-[4px] border border-accent/40 bg-card p-3"
        >
          <p className="text-[11px] font-semibold text-ink">
            Vincular série, filme ou spin-off manualmente
          </p>

          {otherCatalogItems.length > 0 && (
            <select
              value={selectedTargetId}
              onChange={(e) => setSelectedTargetId(e.target.value)}
              aria-label="Escolher obra do catálogo"
              className="min-h-[44px] w-full rounded-[4px] border border-line bg-app px-2.5 text-xs text-ink focus:border-accent focus:outline-none"
            >
              <option value="">Selecionar obra já cadastrada (opcional)...</option>
              {otherCatalogItems.slice(0, 60).map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.title}
                </option>
              ))}
            </select>
          )}

          {!selectedTargetId && (
            <input
              type="text"
              value={manualTitle}
              onChange={(e) => setManualTitle(e.target.value)}
              placeholder="Ou digite o título relacionado (ex: Better Call Saul)"
              className="min-h-[44px] w-full rounded-[4px] border border-line bg-app px-2.5 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
            />
          )}

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={relationType}
              onChange={(e) => setRelationType(e.target.value)}
              aria-label="Tipo de relação na franquia"
              className="min-h-[44px] flex-1 rounded-[4px] border border-line bg-app px-2.5 text-xs text-ink"
            >
              {MANUAL_RELATION_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>

            <button
              type="submit"
              disabled={!selectedTargetId && !manualTitle.trim()}
              className="min-h-[44px] rounded-[4px] bg-accent px-4 text-xs font-semibold text-accent-ink disabled:opacity-45"
            >
              Salvar vínculo
            </button>
          </div>
        </form>
      )}

      {existingManualLinks.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {existingManualLinks.map((lnk, idx) => (
            <span
              key={`${lnk.title}-${idx}`}
              className="inline-flex items-center gap-1 rounded-[4px] border border-line bg-card px-2 py-0.5 text-[10px] text-muted"
            >
              <span>Vínculo: {lnk.title}</span>
              <button
                type="button"
                onClick={() => handleRemoveManualLink(idx)}
                aria-label={`Remover vínculo ${lnk.title}`}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center text-subtle hover:text-ink"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            </span>
          ))}
        </div>
      )}

      {visibleEntries.length > 0 && (
        <div className="space-y-1.5">
          {visibleEntries.map((node, idx) => {
            const isCurrent = node.id === item.id;
            return (
              <div
                key={node.id || `${node.title}-${idx}`}
                className={`flex items-center justify-between gap-2 rounded-[4px] border px-2.5 py-2 ${
                  isCurrent
                    ? 'border-accent bg-accent/10'
                    : 'border-line bg-card'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-semibold tabular-nums text-subtle">
                      {String(idx + 1).padStart(2, '0')}.
                    </span>
                    {node.isCompleted && (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.5} />
                    )}
                    {node.isCataloged && !isCurrent && onSelectItem ? (
                      <button
                        type="button"
                        onClick={() => onSelectItem(node.item)}
                        className="min-h-[44px] truncate text-left text-xs font-medium text-ink hover:text-accent"
                      >
                        {node.title}
                      </button>
                    ) : (
                      <span className="truncate text-xs font-medium text-ink">
                        {node.title}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-subtle tabular-nums">
                    {[
                      node.entryKind,
                      node.releaseYear,
                      node.totalEpisodes ? `${node.totalEpisodes} eps` : '',
                      node.catalogStateLabel,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>

                {node.isCataloged ? (
                  <div className="flex items-center gap-1.5">
                    {node.userRating !== null && (
                      <span className="rounded-[4px] border border-accent/40 bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-accent">
                        {node.userRating}/100
                      </span>
                    )}
                    <StatusBadge statusId={node.status} size="xs" />
                  </div>
                ) : (
                  onQuickCatalogItem && (
                    <button
                      type="button"
                      onClick={() => {
                        const draft = buildMissingFranchiseEntryDraft(
                          effectiveFranchise || { name: model.sagaName },
                          node
                        );
                        if (draft) {
                          onQuickCatalogItem(draft);
                          onShowToast?.({
                            message: `"${node.title}" adicionado à fila Quero Ver`,
                            type: 'success',
                          });
                        }
                      }}
                      className="inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-[4px] border border-accent bg-accent/15 px-2.5 py-1 text-[10px] font-semibold text-accent hover:bg-accent hover:text-accent-ink"
                    >
                      <Plus className="h-3 w-3" strokeWidth={1.5} />
                      <span>+ Adicionar</span>
                    </button>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Sugestões de Universo via TMDB keyword/discover (padrão: Não classificado até confirmação) */}
      {(item.tmdbId || item.ids?.tmdb) && (item.workType === 'movie' || item.workType === 'series') && (
        <div
          className="space-y-2.5 border-t border-line pt-3"
          data-testid="tmdb-universe-suggestions"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink">
                <Compass className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                <span>Sugestões de Universo (TMDB)</span>
              </p>
              <p className="text-[11px] text-subtle">
                Coleções cobrem sequências diretas; sugestões por palavra-chave entram como &quot;Não classificado&quot; até você confirmar.
              </p>
            </div>
            <button
              type="button"
              onClick={handleLoadUniverseKeywords}
              disabled={loadingUniverse}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[6px] border border-line bg-card px-3 text-xs font-medium text-ink hover:border-accent disabled:opacity-55"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 text-accent ${loadingUniverse ? 'animate-spin' : ''}`}
                strokeWidth={1.5}
              />
              <span>{universeOpen ? 'Atualizar sugestões' : 'Explorar universo'}</span>
            </button>
          </div>

          {universeOpen && (
            <div className="space-y-2.5">
              {universeKeywords.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {universeKeywords.slice(0, 8).map((kw) => {
                    const isPicked = activeKeyword?.id === kw.id;
                    return (
                      <button
                        key={kw.id}
                        type="button"
                        onClick={() => handlePickUniverseKeyword(kw)}
                        className={`min-h-[44px] rounded-[6px] border px-2.5 text-xs font-medium ${
                          isPicked
                            ? 'border-accent bg-accent text-accent-ink'
                            : 'border-line bg-card text-muted hover:text-ink'
                        }`}
                      >
                        {kw.name}
                      </button>
                    );
                  })}
                </div>
              )}

              {loadingUniverse ? (
                <div className="h-14 animate-pulse rounded-[6px] border border-line bg-card" />
              ) : universeSuggestions.length === 0 ? (
                <p className="text-xs text-muted">
                  Nenhuma sugestão encontrada para esta palavra-chave no TMDB.
                </p>
              ) : (
                <div className="divide-y divide-line rounded-[6px] border border-line bg-card">
                  {universeSuggestions.slice(0, 12).map((sug) => {
                    const tierMeta = getFranchiseTierMeta(sug.franchiseTier);
                    return (
                      <div
                        key={sug.id}
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate text-xs font-medium text-ink">
                              {sug.title}
                            </span>
                            <span className="rounded-[4px] border border-line bg-app px-1.5 py-0.5 text-[10px] text-muted">
                              {tierMeta.shortLabel}
                            </span>
                          </div>
                          <p className="text-[10px] tabular-nums text-subtle">
                            {[
                              sug.workType === 'series' ? 'Série' : 'Filme',
                              sug.releaseYear,
                              sug.catalogStateLabel,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        </div>

                        {sug.isCataloged && sug.item && onUpdateItem ? (
                          <div className="flex flex-wrap items-center gap-1">
                            {FRANCHISE_TIER_OPTIONS.map((opt) => (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() => {
                                  onUpdateItem(sug.item.id, {
                                    franchiseTier: opt.id,
                                    franchiseName:
                                      sug.item.franchiseName ||
                                      activeKeyword?.name ||
                                      model.sagaName,
                                  });
                                  onShowToast?.({
                                    message: `"${sug.title}" confirmado como ${opt.shortLabel}`,
                                    type: 'success',
                                  });
                                }}
                                className={`min-h-[44px] rounded-[6px] border px-2 text-[10px] font-medium ${
                                  sug.franchiseTier === opt.id
                                    ? 'border-accent bg-accent text-accent-ink'
                                    : 'border-line bg-app text-muted hover:text-ink'
                                }`}
                              >
                                {opt.shortLabel}
                              </button>
                            ))}
                          </div>
                        ) : (
                          onQuickCatalogItem && (
                            <button
                              type="button"
                              onClick={() => {
                                onQuickCatalogItem({
                                  title: sug.title,
                                  originalTitle: sug.originalTitle,
                                  tmdbId: sug.tmdbId,
                                  ids: sug.tmdbId ? { tmdb: sug.tmdbId } : undefined,
                                  domain: 'cinema',
                                  workType: sug.workType,
                                  releaseYear: sug.releaseYear,
                                  coverUrl: sug.coverUrl,
                                  backdropUrl: sug.backdropUrl,
                                  synopsis: sug.synopsis,
                                  franchiseName: activeKeyword?.name || model.sagaName,
                                  franchiseTier: UNCLASSIFIED_FRANCHISE_TIER,
                                  status: 'queued',
                                  inBacklog: true,
                                });
                                onShowToast?.({
                                  message: `"${sug.title}" adicionado como Não classificado`,
                                  type: 'success',
                                });
                              }}
                              className="inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-[6px] border border-line bg-app px-3 text-xs font-medium text-ink hover:border-accent"
                            >
                              <Plus className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                              <span>Adicionar</span>
                            </button>
                          )
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
