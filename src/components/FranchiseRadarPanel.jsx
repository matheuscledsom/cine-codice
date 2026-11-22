import { CheckCircle2, GitBranch, Link2, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { buildMissingFranchiseEntryDraft } from '../services/franchiseEngine';
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

  if (!item) return null;

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
    onShowToast?.({ message: `Vínculo "${resolvedTitle}" adicionado à franquia.`, type: 'success' });
  };

  const handleRemoveManualLink = (idx) => {
    const nextLinks = existingManualLinks.filter((_, i) => i !== idx);
    onUpdateItem?.(item.id, { franchiseLinks: nextLinks });
  };

  const stats = franchise?.stats || null;
  const breakdown = stats?.breakdown || null;
  const breakdownPills = breakdown
    ? [
        breakdown.movies.total > 0 && `Filmes ${breakdown.movies.completed}/${breakdown.movies.total}`,
        breakdown.ovas.total > 0 && `OVAs ${breakdown.ovas.completed}/${breakdown.ovas.total}`,
        breakdown.specials.total > 0 && `Especiais ${breakdown.specials.completed}/${breakdown.specials.total}`,
        breakdown.spinOffs.total > 0 && `Spin-offs ${breakdown.spinOffs.completed}/${breakdown.spinOffs.total}`,
      ].filter(Boolean)
    : [];

  return (
    <section
      aria-label="Radar de Franquias e Ordem Cronológica"
      className="mt-4 rounded-xl border border-line bg-app p-3.5 space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <GitBranch className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />
          <div className="min-w-0">
            <h4 className="truncate text-xs font-semibold text-ink">
              {franchise ? `Saga: ${franchise.name}` : 'Franquia & Universos'}
            </h4>
            {franchise && (
              <p className="text-[10px] tabular-nums text-subtle">
                Universo: {franchise.completedCount}/{franchise.totalCount} assistidas ({franchise.completionPct}%)
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {franchise && stats?.hasComparative && stats.rankLabel && (
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

      {breakdownPills.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {breakdownPills.map((text) => (
            <span
              key={text}
              className="rounded-[4px] border border-line bg-card px-2 py-0.5 text-[10px] font-medium tabular-nums text-muted"
            >
              {text}
            </span>
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

      {franchise && franchise.timeline.length > 0 && (
        <div className="space-y-1.5">
          {franchise.timeline.map((node, idx) => {
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
                    {[node.entryKind, node.releaseYear, node.totalEpisodes ? `${node.totalEpisodes} eps` : '']
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>

                {node.isCataloged ? (
                  <StatusBadge statusId={node.status} size="xs" />
                ) : (
                  onQuickCatalogItem && (
                    <button
                      type="button"
                      onClick={() => {
                        const draft = buildMissingFranchiseEntryDraft(franchise, node);
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
                      <span>+ Catalogar</span>
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
