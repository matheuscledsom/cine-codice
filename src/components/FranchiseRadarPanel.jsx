import { CheckCircle2, GitBranch, Link2, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { buildMissingFranchiseEntryDraft } from '../services/franchiseEngine';
import {
  buildDeterministicFranchiseOrUniverseModel,
  fetchTmdbCollectionParts,
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

  useEffect(() => {
    setActiveGroupTab('all');
    setRemoteCollectionParts([]);
    const colId = item?.belongsToCollection?.id;
    if (item?.workType === 'movie' && colId) {
      let cancelled = false;
      fetchTmdbCollectionParts(colId)
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
  }, [item?.id, item?.workType, item?.belongsToCollection?.id]);

  const model = useMemo(
    () =>
      item
        ? buildDeterministicFranchiseOrUniverseModel(
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

  const visibleEntries =
    model.mode === 'series-universe' && activeGroupTab !== 'all'
      ? model.groups?.find((g) => g.id === activeGroupTab)?.entries || []
      : model.entries;

  return (
    <section
      aria-label={model.sectionTitle}
      className="mt-4 rounded-xl border border-line bg-app p-3.5 space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <GitBranch className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />
          <div className="min-w-0">
            <h4 className="truncate text-xs font-semibold text-ink">
              {model.sectionTitle} · {model.sagaName}
            </h4>
            <p className="text-[11px] font-medium tabular-nums text-accent">
              {model.progressHeader}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {stats?.hasComparative && stats.rankLabel && (
            <span className="rounded-[4px] border border-accent/40 bg-accent/15 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-accent">
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

      {/* Abas / Grupos para Séries & Animes ("Obras do Mesmo Universo") */}
      {model.mode === 'series-universe' && Array.isArray(model.groups) && (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setActiveGroupTab('all')}
            className={`min-h-[36px] rounded-[4px] border px-2.5 py-1 text-[11px] font-semibold tabular-nums ${
              activeGroupTab === 'all'
                ? 'border-accent bg-accent/15 text-ink'
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
              className={`min-h-[36px] rounded-[4px] border px-2.5 py-1 text-[11px] font-medium tabular-nums ${
                activeGroupTab === grp.id
                  ? 'border-accent bg-accent/15 text-ink'
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
    </section>
  );
}
