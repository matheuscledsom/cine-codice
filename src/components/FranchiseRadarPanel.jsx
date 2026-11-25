import { Check, CheckCircle2, Compass, GitBranch, Link2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { inferDomainFromWork } from '../config/domainConfig';
import { getManualEntityMeta, saveManualEntityMeta } from '../lib/entityHelpers';
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
import { fetchIgdbFranchiseGames } from '../services/gameDepthService';
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
  const [remoteGameEntries, setRemoteGameEntries] = useState([]);
  const [remoteGameSource, setRemoteGameSource] = useState(null);
  const [loadingRemoteGames, setLoadingRemoteGames] = useState(false);
  const [activeGroupTab, setActiveGroupTab] = useState('all');
  const [activeTierTab, setActiveTierTab] = useState('all');
  const [activeStatusTab, setActiveStatusTab] = useState('all');
  const [editingTotal, setEditingTotal] = useState(false);
  const [mainTotalInput, setMainTotalInput] = useState('');
  const [universeTotalInput, setUniverseTotalInput] = useState('');
  const [manualMetaVersion, setManualMetaVersion] = useState(0);
  const [universeOpen, setUniverseOpen] = useState(false);
  const [universeKeywords, setUniverseKeywords] = useState([]);
  const [activeKeyword, setActiveKeyword] = useState(null);
  const [universeSuggestionsRaw, setUniverseSuggestionsRaw] = useState([]);
  const [loadingUniverse, setLoadingUniverse] = useState(false);

  const itemDomain = inferDomainFromWork(item || {});
  const franchiseIdentityName = String(
    item?.belongsToCollection?.name?.replace(/\s*Collection$/i, '') ||
      item?.franchiseName ||
      franchise?.name ||
      ''
  ).trim();

  const manualMeta = useMemo(
    () =>
      franchiseIdentityName
        ? getManualEntityMeta({
            name: franchiseIdentityName,
            domain: itemDomain,
            role: 'franchise',
          })
        : null,
    [franchiseIdentityName, itemDomain, manualMetaVersion]
  );

  useEffect(() => {
    setMainTotalInput(manualMeta?.mainSeriesTotal ? String(manualMeta.mainSeriesTotal) : '');
    setUniverseTotalInput(manualMeta?.universeTotal ? String(manualMeta.universeTotal) : '');
  }, [manualMeta]);

  useEffect(() => {
    setActiveGroupTab('all');
    setActiveTierTab('all');
    setActiveStatusTab('all');
    setEditingTotal(false);
    setRemoteCollectionParts([]);
    setRemoteGameEntries([]);
    setRemoteGameSource(null);
    setUniverseOpen(false);
    setUniverseKeywords([]);
    setActiveKeyword(null);
    setUniverseSuggestionsRaw([]);

    let cancelled = false;
    const colId = item?.belongsToCollection?.id;
    if (item?.workType === 'movie' && colId) {
      fetchTmdbCollectionParts(colId, { apiKey: tmdbKey })
        .then((parts) => {
          if (!cancelled && Array.isArray(parts) && parts.length > 0) {
            setRemoteCollectionParts(parts);
          }
        })
        .catch(() => {});
    } else if (itemDomain === 'games' && (item?.franchiseName || item?.rawgId || item?.ids?.rawg)) {
      setLoadingRemoteGames(true);
      fetchIgdbFranchiseGames({
        franchiseName: item.franchiseName || '',
        rawgId: item.rawgId || item.ids?.rawg || null,
      })
        .then((res) => {
          if (!cancelled && res?.available && Array.isArray(res.games) && res.games.length > 0) {
            setRemoteGameEntries(res.games);
            setRemoteGameSource(res.source || 'IGDB');
          }
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setLoadingRemoteGames(false);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [
    item?.id,
    item?.workType,
    item?.belongsToCollection?.id,
    item?.franchiseName,
    item?.rawgId,
    item?.ids?.rawg,
    itemDomain,
    tmdbKey,
  ]);

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
        ? buildUnifiedFranchiseModel(item, allItems, remoteCollectionParts, {
            remoteEntries: remoteGameEntries,
            manualMeta,
            sourceLabel: remoteGameSource,
            sourceIsComplete: Boolean(
              remoteGameEntries.length > 0 || remoteCollectionParts.length > 0
            ),
          })
        : null,
    [item, allItems, remoteCollectionParts, remoteGameEntries, manualMeta, remoteGameSource]
  );

  const handleSaveManualTotals = (event) => {
    event?.preventDefault();
    if (!franchiseIdentityName) return;
    const mainVal = Number(String(mainTotalInput || '').trim());
    const uniVal = Number(String(universeTotalInput || '').trim());
    saveManualEntityMeta(
      { name: franchiseIdentityName, domain: itemDomain, role: 'franchise' },
      {
        seriesName: franchiseIdentityName,
        mainSeriesTotal: Number.isFinite(mainVal) && mainVal > 0 ? Math.round(mainVal) : null,
        universeTotal: Number.isFinite(uniVal) && uniVal > 0 ? Math.round(uniVal) : null,
      }
    );
    setManualMetaVersion((v) => v + 1);
    setEditingTotal(false);
  };

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

  const tierFilteredEntries =
    activeTierTab === 'all'
      ? groupFilteredEntries
      : groupFilteredEntries.filter(
          (entry) => inferFranchiseTier(entry) === activeTierTab
        );

  const visibleEntries =
    activeStatusTab === 'all'
      ? tierFilteredEntries
      : tierFilteredEntries.filter((entry) => {
          if (activeStatusTab === 'completed') return Boolean(entry.isCompleted || entry.localState === 'completed');
          if (activeStatusTab === 'in_catalog') {
            return Boolean(entry.isCataloged && !(entry.isCompleted || entry.localState === 'completed'));
          }
          if (activeStatusTab === 'missing') return !entry.isCataloged;
          return true;
        });

  const statusCounts = {
    all: tierFilteredEntries.length,
    completed: tierFilteredEntries.filter((e) => e.isCompleted || e.localState === 'completed').length,
    in_catalog: tierFilteredEntries.filter(
      (e) => e.isCataloged && !(e.isCompleted || e.localState === 'completed')
    ).length,
    missing: tierFilteredEntries.filter((e) => !e.isCataloged).length,
  };

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
              {model.sourceLabel ? ` · Fonte: ${model.sourceLabel}` : ''}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {loadingRemoteGames && (
            <RefreshCw className="h-3.5 w-3.5 animate-spin text-accent" strokeWidth={1.5} />
          )}
          {stats?.hasComparative && stats.rankLabel && (
            <span className="text-xs font-semibold tabular-nums text-ink">
              {stats.rankLabel}
              {stats.franchiseAverageRating !== null
                ? ` · Média ${stats.franchiseAverageRating}`
                : ''}
            </span>
          )}
          {franchiseIdentityName && (
            <button
              type="button"
              onClick={() => setEditingTotal((prev) => !prev)}
              className="inline-flex min-h-[44px] items-center rounded-[4px] border border-line bg-card px-2.5 text-[11px] font-medium text-ink hover:border-accent"
            >
              {editingTotal ? 'Fechar total' : 'Definir total'}
            </button>
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

      {editingTotal && (
        <form
          onSubmit={handleSaveManualTotals}
          className="grid grid-cols-1 gap-2 rounded-[6px] border border-line bg-card p-3 sm:grid-cols-2"
        >
          <label className="block space-y-1">
            <span className="text-[11px] text-muted">Total Linha Principal</span>
            <input
              type="number"
              min="1"
              max="999"
              value={mainTotalInput}
              onChange={(e) => setMainTotalInput(e.target.value)}
              placeholder="Ex.: 5"
              className="min-h-[44px] w-full rounded-[6px] border border-line bg-app px-2.5 text-xs text-ink focus:border-accent focus:outline-none"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] text-muted">Total Universo Completo (opcional)</span>
            <input
              type="number"
              min="1"
              max="9999"
              value={universeTotalInput}
              onChange={(e) => setUniverseTotalInput(e.target.value)}
              placeholder="Ex.: 12"
              className="min-h-[44px] w-full rounded-[6px] border border-line bg-app px-2.5 text-xs text-ink focus:border-accent focus:outline-none"
            />
          </label>
          <div className="flex items-center gap-2 sm:col-span-2">
            <button
              type="submit"
              className="inline-flex min-h-[44px] items-center gap-1 rounded-[6px] bg-accent px-3 text-xs font-semibold text-accent-ink"
            >
              <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
              <span>Salvar total</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMainTotalInput('');
                setUniverseTotalInput('');
                saveManualEntityMeta(
                  { name: franchiseIdentityName, domain: itemDomain, role: 'franchise' },
                  { mainSeriesTotal: null, universeTotal: null }
                );
                setManualMetaVersion((v) => v + 1);
                setEditingTotal(false);
              }}
              className="inline-flex min-h-[44px] items-center rounded-[6px] border border-line bg-app px-3 text-xs font-medium text-muted hover:text-ink"
            >
              Total aberto
            </button>
          </div>
        </form>
      )}

      {/* Dois indicadores transparentes: Linha Principal vs Universo Completo (só exibe % se o total for conhecido) */}
      {scopeProgress && (
        <div
          className="grid grid-cols-1 gap-2.5 border-y border-line py-3 sm:grid-cols-2"
          data-testid="franchise-scope-progress"
        >
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-xs tabular-nums">
              <span className="font-semibold text-ink">Linha Principal</span>
              <span className="font-semibold text-ink">
                {scopeProgress.mainline.displayLabel}
              </span>
            </div>
            {!scopeProgress.mainline.isOpenEnded && typeof scopeProgress.mainline.pct === 'number' && (
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
                <div
                  className="h-full bg-accent transition-all duration-200"
                  style={{ width: `${Math.min(100, scopeProgress.mainline.pct)}%` }}
                />
              </div>
            )}
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-xs tabular-nums">
              <span className="font-medium text-muted">Universo Completo</span>
              <span className="font-medium text-muted">
                {scopeProgress.universe.displayLabel}
              </span>
            </div>
            {!scopeProgress.universe.isOpenEnded && typeof scopeProgress.universe.pct === 'number' && (
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
                <div
                  className="h-full bg-muted transition-all duration-200"
                  style={{ width: `${Math.min(100, scopeProgress.universe.pct)}%` }}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Filtro rápido: Concluídas · No catálogo · Faltantes */}
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filtrar obras por estado">
        {[
          { id: 'all', label: `Todas (${statusCounts.all})` },
          { id: 'completed', label: `Concluídas (${statusCounts.completed})` },
          { id: 'in_catalog', label: `No catálogo (${statusCounts.in_catalog})` },
          { id: 'missing', label: `Faltantes (${statusCounts.missing})` },
        ].map((tab) => {
          const active = activeStatusTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveStatusTab(tab.id)}
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
                        const baseDraft = buildMissingFranchiseEntryDraft(
                          effectiveFranchise || { name: model.sagaName },
                          node
                        );
                        const draft =
                          itemDomain === 'games' || itemDomain === 'reading'
                            ? {
                                ...(baseDraft || {}),
                                domain: itemDomain,
                                workType:
                                  node.workType || (itemDomain === 'games' ? 'game' : 'book'),
                                title: node.title,
                                creator: node.creator || item.creator || '',
                                releaseYear: node.releaseYear || null,
                                coverUrl: node.coverUrl || null,
                                platforms: node.platforms || [],
                                editionType: node.editionType || (itemDomain === 'games' ? 'Jogo' : ''),
                                franchiseName: model.sagaName,
                                franchiseTier: node.franchiseTier || 'mainline',
                                ids: node.ids || {},
                                igdbId: node.igdbId || null,
                                rawgId: node.rawgId || null,
                                status: 'queued',
                                isWishlist: true,
                                inBacklog: true,
                              }
                            : baseDraft;
                        if (draft) {
                          onQuickCatalogItem(draft);
                          onShowToast?.({
                            message: `"${node.title}" adicionado ao catálogo.`,
                            type: 'success',
                          });
                        }
                      }}
                      className="inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-[4px] border border-accent bg-accent/15 px-2.5 py-1 text-[10px] font-semibold text-accent hover:bg-accent hover:text-accent-ink"
                    >
                      <Plus className="h-3 w-3" strokeWidth={1.5} />
                      <span>+ Catalogar</span>
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
