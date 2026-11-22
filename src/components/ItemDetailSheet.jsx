import {
  AlertCircle,
  Bookmark,
  CheckCircle2,
  Clapperboard,
  Download,
  Film,
  FolderOpen,
  GitBranch,
  Heart,
  MessageSquarePlus,
  Plus,
  Quote,
  RotateCcw,
  Send,
  Share2,
  SlidersHorizontal,
  Star,
  Tag,
  Trash2,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { domainConfig, getStatusList } from '../config/domainConfig';
import { useToast } from '../context/ToastContext';
import { searchReaderProfiles, sendDirectMessage } from '../services/codiceBackend';
import {
  buildMissingFranchiseEntryDraft,
  findFranchiseForItem,
} from '../services/franchiseEngine';
import {
  getDisplayTitles,
  getTodayLocalISO,
  getVerdictForScore,
  getVerdictMeta,
  isLoanOverdue,
  normalizeTagsList,
} from '../utils/backlogHelpers';
import { downloadWorkMarkdown } from '../utils/markdownExport';
import { BuddyReadPanel } from './BuddyReadPanel';
import { CollectionCreatorBar } from './CollectionCreatorBar';
import { CoverArt } from './CoverArt';
import { QuotesVaultTab } from './QuotesVaultTab';
import { SmartCatalogButton } from './SmartCatalogButton';
import { StatusBadge } from './StatusBadge';
import { TactileStatusFields } from './TactileStatusFields';
import { TechnicalAtmosphereSection } from './TechnicalAtmosphereSection';
import { WorkTypeSelector } from './WorkTypeSelector';

export function ItemDetailSheet({
  item,
  allItems = [],
  profile = null,
  posts = [],
  collections = [],
  geminiKey = '',
  viewerId = null,
  onClose,
  onUpdateItem,
  onSelectItem,
  onQuickCatalogItem,
  onToggleCollection,
  onCreateCollection,
  onRemoveItem,
  onOpenJournal,
  onOpenGeminiSettings,
  onRecommendToFeed,
  onSocialActivityChanged,
}) {
  const { showToast } = useToast();
  const [activeSheetTab, setActiveSheetTab] = useState('catalog');
  const [shareOpen, setShareOpen] = useState(false);
  const [shareNote, setShareNote] = useState('');
  const [sharePeers, setSharePeers] = useState([]);
  const [sendingPeerId, setSendingPeerId] = useState(null);
  const [tagInput, setTagInput] = useState('');
  const progressSectionRef = useRef(null);

  useEffect(() => {
    setActiveSheetTab('catalog');
    setShareOpen(false);
    setShareNote('');
    setTagInput('');
  }, [item?.id]);

  useEffect(() => {
    if (!shareOpen) return undefined;
    let cancelled = false;
    searchReaderProfiles('', { viewerId })
      .then((list) => {
        if (!cancelled) {
          setSharePeers(
            (Array.isArray(list) ? list : []).filter(
              (p) => !p.isSelf && p.allowDms !== false
            )
          );
        }
      })
      .catch(() => {
        if (!cancelled) setSharePeers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [shareOpen, viewerId]);

  const franchise = useMemo(
    () => (item ? findFranchiseForItem(item, allItems.length > 0 ? allItems : [item]) : null),
    [item, allItems]
  );

  if (!item) return null;

  const handleSendToPeer = async (peer) => {
    if (!peer?.id || sendingPeerId) return;
    setSendingPeerId(peer.id);
    try {
      await sendDirectMessage({
        recipientId: peer.id,
        content:
          shareNote.trim() ||
          `Indico "${item.title}" para sua fila na cinemateca.`,
        attachedWorkSnapshot: item,
        viewerId,
      });
      onSocialActivityChanged?.();
      showToast({
        message: `Indicação enviada para ${peer.displayName || peer.handle}`,
        type: 'success',
      });
      setShareOpen(false);
      setShareNote('');
    } catch (err) {
      showToast({
        message:
          err?.userMessage ||
          err?.message ||
          'Não foi possível enviar a indicação no chat.',
        type: 'error',
      });
    } finally {
      setSendingPeerId(null);
    }
  };

  const handlePublishToFeed = () => {
    onRecommendToFeed?.(item, shareNote.trim());
    setShareOpen(false);
    setShareNote('');
  };

  const statuses = getStatusList();
  const { ui, cardFields } = domainConfig;
  const notesKey = cardFields.notes;
  const genres = item[cardFields.genres] || [];
  const verdictMeta = item.verdict ? getVerdictMeta(item.verdict) : null;
  const quotesCount = Array.isArray(item.quotes) ? item.quotes.length : 0;
  const linkedPosts = posts.filter((post) => post.itemId === item.id);
  const displayTitles = getDisplayTitles(item, 'bilingual');
  const creatorLabel = item.director || item.studio || item.author || '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Ficha de ${item.title}`}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-[6px] border-x border-t border-line bg-card p-5 pb-8 no-scrollbar"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-[2px] bg-line" />

        <div className="flex gap-4">
          <CoverArt item={item} compact className="h-30 w-20 shrink-0 rounded-[4px]" />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-base font-semibold leading-snug text-ink">
                  {displayTitles.primary}
                </h3>
                {displayTitles.secondary && (
                  <p
                    className="mt-0.5 truncate text-xs italic"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {displayTitles.secondary}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={ui.detail.closeLabel}
                className="flex min-h-[40px] min-w-[40px] shrink-0 items-center justify-center rounded-full p-1 text-muted hover:bg-elevated hover:text-ink"
              >
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>
            <p className="mt-0.5 text-xs text-muted">
              {[creatorLabel, item.releaseYear, item.franchiseName || item.seriesName]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {genres.length > 0 && (
              <p className="mt-1 truncate text-[11px] text-subtle">
                {genres.slice(0, 3).join(' · ')}
              </p>
            )}
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <StatusBadge statusId={item.status} />
              {typeof item.rating === 'number' && (
                item.ratingSource === 'legacy-default' ? (
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateItem(item.id, {
                        rating: item.rating,
                        ratingSource: 'manual',
                        verdict: item.verdict || getVerdictForScore(item.rating),
                      })
                    }
                    title="Nota padrão criada automaticamente na versão anterior — toque para confirmar"
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-dashed border-line bg-app px-3 py-1 text-[10px] font-medium tabular-nums text-muted opacity-75 transition-opacity hover:border-accent hover:text-ink hover:opacity-100"
                  >
                    <Star className="h-3 w-3 text-subtle" strokeWidth={1.5} />
                    <span>{item.rating}/100 · nota padrão</span>
                    <span className="font-semibold text-accent">Confirmar</span>
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/15 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-accent">
                    <Star className="h-3 w-3 fill-current" strokeWidth={1.5} />
                    {item.rating}/100
                  </span>
                )
              )}
              {Number(item.rewatchCount) > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full border border-line bg-app px-2 py-0.5 text-[10px] font-medium tabular-nums text-ink">
                  <RotateCcw className="h-2.5 w-2.5 text-accent" strokeWidth={1.5} />
                  Rewatch #{item.rewatchCount}
                </span>
              )}
              {item.audioFormat && (
                <span className="rounded-[4px] border border-line bg-app px-2 py-0.5 text-[10px] text-muted">
                  {item.audioFormat}
                </span>
              )}
              {verdictMeta && (
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${verdictMeta.badgeClass}`}
                >
                  {verdictMeta.id}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Ações principais no topo: Atualizar Progresso & Indicar */}
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              setActiveSheetTab('catalog');
              requestAnimationFrame(() => {
                progressSectionRef.current?.scrollIntoView?.({
                  behavior: 'smooth',
                  block: 'center',
                });
              });
            }}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[4px] bg-accent px-3.5 py-2.5 text-xs font-semibold text-accent-ink transition-opacity hover:opacity-90"
          >
            <SlidersHorizontal className="h-4 w-4 shrink-0" strokeWidth={1.5} />
            <span>Atualizar Progresso</span>
          </button>

          <button
            type="button"
            onClick={() => setShareOpen((prev) => !prev)}
            aria-expanded={shareOpen}
            className={`flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[4px] border px-3.5 py-2 text-xs font-medium transition-colors ${
              shareOpen
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-line bg-app text-ink hover:border-accent hover:text-accent'
            }`}
          >
            <Share2 className="h-4 w-4 text-accent" strokeWidth={1.5} />
            <span>Indicar Obra</span>
          </button>
        </div>

        {shareOpen && (
          <div className="mt-2.5 space-y-3 rounded-[4px] border border-line bg-app p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-ink">
                Enviar indicação com comentário
              </span>
              <button
                type="button"
                onClick={() => setShareOpen(false)}
                aria-label="Fechar painel de indicação"
                className="rounded-[4px] p-1 text-subtle hover:text-ink"
              >
                <X className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            </div>

            <textarea
              rows={2}
              value={shareNote}
              onChange={(e) => setShareNote(e.target.value)}
              placeholder={`Por que você recomenda "${item.title}"?`}
              className="w-full resize-none rounded-[4px] border border-line bg-card px-2.5 py-2 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
            />

            {onRecommendToFeed && (
              <button
                type="button"
                onClick={handlePublishToFeed}
                className="flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-[4px] border border-accent bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent hover:text-accent-ink"
              >
                <MessageSquarePlus className="h-4 w-4" strokeWidth={1.5} />
                <span>Publicar no Mural</span>
              </button>
            )}

            <div className="space-y-1.5 border-t border-line pt-2">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted">
                Ou enviar no Chat 1:1 para:
              </p>
              {sharePeers.length === 0 ? (
                <p className="text-[11px] text-muted">
                  Nenhum amigo disponível para mensagens no momento.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {sharePeers.slice(0, 6).map((peer) => (
                    <button
                      key={peer.id}
                      type="button"
                      disabled={sendingPeerId === peer.id}
                      onClick={() => handleSendToPeer(peer)}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded-[4px] border border-line bg-card px-2.5 py-1 text-[11px] font-medium text-ink transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
                    >
                      <Send className="h-3 w-3 text-accent" strokeWidth={1.5} />
                      <span>{peer.displayName || peer.handle}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Abas da Obra: Ficha | Falas & Cenas | Sessão Conjunta */}
        <div className="mt-4 grid grid-cols-3 gap-1 rounded-2xl border border-line bg-app p-1">
          <button
            type="button"
            onClick={() => setActiveSheetTab('catalog')}
            className={`flex min-h-[40px] items-center justify-center gap-1 rounded-xl px-1.5 py-2 text-[11px] font-semibold transition-colors ${
              activeSheetTab === 'catalog'
                ? 'bg-accent text-accent-ink'
                : 'text-muted hover:text-ink'
            }`}
          >
            <Film className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
            <span className="truncate">Ficha</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveSheetTab('quotes')}
            className={`flex min-h-[40px] items-center justify-center gap-1 rounded-xl px-1.5 py-2 text-[11px] font-semibold transition-colors ${
              activeSheetTab === 'quotes'
                ? 'bg-accent text-accent-ink'
                : 'text-muted hover:text-ink'
            }`}
          >
            <Quote className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
            <span className="truncate">Falas</span>
            {quotesCount > 0 && (
              <span
                className={`rounded-full px-1.5 py-0.2 text-[10px] tabular-nums ${
                  activeSheetTab === 'quotes'
                    ? 'bg-black/20 text-accent-ink'
                    : 'bg-accent/15 text-accent'
                }`}
              >
                {quotesCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveSheetTab('buddy')}
            className={`flex min-h-[40px] items-center justify-center gap-1 rounded-xl px-1.5 py-2 text-[11px] font-semibold transition-colors ${
              activeSheetTab === 'buddy'
                ? 'bg-accent text-accent-ink'
                : 'text-muted hover:text-ink'
            }`}
          >
            <Users className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
            <span className="truncate">Conjunta</span>
          </button>
        </div>

        {activeSheetTab === 'buddy' ? (
          <div className="mt-4">
            <BuddyReadPanel item={item} profile={profile} />
          </div>
        ) : activeSheetTab === 'quotes' ? (
          <div className="mt-4">
            <QuotesVaultTab
              item={item}
              onUpdate={(updates) => onUpdateItem(item.id, updates)}
            />
          </div>
        ) : (
          <>
            <div className="mt-4">
              <WorkTypeSelector
                label={ui.detail.workTypeTitle}
                value={item.workType}
                onChange={(nextType) =>
                  onUpdateItem(item.id, { workType: nextType })
                }
              />
            </div>

            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-[10px] text-muted">
                  Direção / Criador
                </span>
                <input
                  type="text"
                  value={item.director || item.author || ''}
                  onChange={(e) =>
                    onUpdateItem(item.id, {
                      director: e.target.value,
                      author: e.target.value,
                    })
                  }
                  placeholder="Ex: Hayao Miyazaki"
                  className="min-h-[40px] w-full rounded-[4px] border border-line bg-app px-2.5 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-[10px] text-muted">
                  Estúdio / Rede
                </span>
                <input
                  type="text"
                  value={item.studio || ''}
                  onChange={(e) =>
                    onUpdateItem(item.id, { studio: e.target.value })
                  }
                  placeholder="Ex: Studio Ghibli, HBO"
                  className="min-h-[40px] w-full rounded-[4px] border border-line bg-app px-2.5 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-[10px] text-muted">
                  Franquia / Universo
                </span>
                <input
                  type="text"
                  value={item.franchiseName || item.seriesName || ''}
                  onChange={(e) =>
                    onUpdateItem(item.id, {
                      franchiseName: e.target.value,
                      seriesName: e.target.value,
                    })
                  }
                  placeholder="Ex: Evangelion, Duna..."
                  className="min-h-[40px] w-full rounded-[4px] border border-line bg-app px-2.5 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-[10px] text-muted">
                  Ano de lançamento
                </span>
                <input
                  type="number"
                  min="1895"
                  max="2099"
                  value={item.releaseYear || ''}
                  onChange={(e) =>
                    onUpdateItem(item.id, {
                      releaseYear: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                  placeholder="2001"
                  className="min-h-[40px] w-full rounded-[4px] border border-line bg-app px-2.5 text-xs tabular-nums text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
                />
              </label>
            </div>

            <div className="mt-4">
              <SmartCatalogButton
                item={item}
                geminiKey={geminiKey}
                onApplyFields={(updates) => onUpdateItem(item.id, updates)}
                onOpenGeminiSettings={() => {
                  onClose();
                  onOpenGeminiSettings?.();
                }}
              />
            </div>

            <label className="mt-3 block">
              <span className="mb-1 block text-[11px] font-medium text-muted">
                Sinopse (sem spoilers)
              </span>
              <textarea
                rows={2}
                value={item.synopsis || ''}
                onChange={(e) =>
                  onUpdateItem(item.id, { synopsis: e.target.value })
                }
                placeholder="Premissa sem spoilers da obra..."
                className="w-full resize-none rounded-xl border border-line bg-app px-3 py-2 text-xs leading-relaxed text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
              />
            </label>

            <div className="mt-4">
              <p className="mb-2 text-xs font-medium text-muted">
                {ui.detail.statusTitle}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {statuses.map((status) => {
                  const isSelected = item.inBacklog && item.status === status.id;
                  return (
                    <button
                      key={status.id}
                      type="button"
                      onClick={() =>
                        onUpdateItem(item.id, { status: status.id, inBacklog: true })
                      }
                      className={`flex min-h-[44px] items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
                        isSelected
                          ? 'border-accent bg-accent/15 text-ink'
                          : 'border-line bg-app text-muted hover:text-ink'
                      }`}
                    >
                      <span className={`h-2 w-2 rounded-full ${status.dotClass}`} />
                      {status.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div ref={progressSectionRef} className="mt-4 border-t border-line pt-4">
              <TactileStatusFields
                item={item}
                showAiActions
                geminiKey={geminiKey}
                linkedPosts={linkedPosts}
                readerDna={profile?.readerDna || null}
                onOpenGeminiSettings={() => {
                  onClose();
                  onOpenGeminiSettings?.();
                }}
                onChange={(updates) => onUpdateItem(item.id, updates)}
                onOpenJournal={() => {
                  onClose();
                  onOpenJournal?.(item.id);
                }}
              />
            </div>

            {/* Radar de Franquia, Sagas & Ordem Cronológica */}
            {franchise && franchise.timeline.length > 0 && (
              <section
                aria-label="Radar de Franquias e Ordem Cronológica"
                className="mt-4 rounded-xl border border-line bg-app p-3.5 space-y-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <GitBranch className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />
                    <div className="min-w-0">
                      <h4 className="truncate text-xs font-semibold text-ink">
                        Saga: {franchise.name}
                      </h4>
                      <p className="text-[10px] tabular-nums text-subtle">
                        {franchise.completedCount}/{franchise.totalCount} concluídas ({franchise.completionPct}%)
                      </p>
                    </div>
                  </div>
                  <span className="rounded-[4px] border border-accent/40 bg-accent/15 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-accent">
                    {franchise.completionPct}%
                  </span>
                </div>

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
                                className="truncate text-left text-xs font-medium text-ink hover:text-accent"
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
                                  showToast({
                                    message: `"${node.title}" adicionado à fila Quero Ver`,
                                    type: 'success',
                                  });
                                }
                              }}
                              className="inline-flex min-h-[34px] shrink-0 items-center gap-1 rounded-[4px] border border-accent bg-accent/15 px-2.5 py-1 text-[10px] font-semibold text-accent hover:bg-accent hover:text-accent-ink"
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
              </section>
            )}

            <div className="mt-4">
              <TechnicalAtmosphereSection
                item={item}
                onChange={(updates) => onUpdateItem(item.id, updates)}
              />
            </div>

            <section
              aria-label="Coleções personalizadas"
              className="mt-4 rounded-xl border border-line bg-card p-3 space-y-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink">
                  <FolderOpen className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                  <span>Coleções &amp; Mostras</span>
                </span>
                <span className="text-[10px] tabular-nums text-subtle">
                  {Array.isArray(item.collectionIds) ? item.collectionIds.length : 0} selecionada(s)
                </span>
              </div>

              {collections.length > 0 ? (
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {collections.map((col) => {
                    const checked =
                      Array.isArray(item.collectionIds) &&
                      item.collectionIds.map(String).includes(String(col.id));
                    return (
                      <label
                        key={col.id}
                        className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-[4px] border px-3 py-2 text-xs font-medium transition-colors ${
                          checked
                            ? 'border-accent bg-accent/10 text-ink'
                            : 'border-line bg-app text-muted hover:text-ink'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => onToggleCollection?.(item.id, col.id)}
                          className="h-4 w-4 accent-[var(--accent-color)]"
                        />
                        <span className="truncate">{col.name}</span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[11px] text-subtle">
                  Crie coleções como Animes Clássicos, Terror Anos 80 ou Para Ver no Fim de Semana.
                </p>
              )}

              {onCreateCollection && (
                <CollectionCreatorBar
                  collections={collections}
                  onCreateCollection={onCreateCollection}
                  onCreated={(created) => {
                    if (
                      created?.id &&
                      !(item.collectionIds || []).map(String).includes(String(created.id))
                    ) {
                      onToggleCollection?.(item.id, created.id);
                    }
                  }}
                />
              )}
            </section>

            <section
              aria-label="Tags livres e controle de mídia física emprestada"
              className="mt-4 rounded-xl border border-line bg-card p-3 space-y-3"
            >
              <div className="space-y-1.5">
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink">
                  <Tag className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                  <span>Tags livres</span>
                </span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && tagInput.trim()) {
                        e.preventDefault();
                        const nextTags = normalizeTagsList([
                          ...(Array.isArray(item.tags) ? item.tags : []),
                          tagInput.trim(),
                        ]);
                        onUpdateItem(item.id, { tags: nextTags });
                        setTagInput('');
                      }
                    }}
                    placeholder="Ex: imax, anos-80, ghibli..."
                    aria-label="Adicionar tag livre"
                    className="min-h-[38px] min-w-0 flex-1 rounded-[4px] border border-line bg-app px-2.5 py-1 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!tagInput.trim()) return;
                      const nextTags = normalizeTagsList([
                        ...(Array.isArray(item.tags) ? item.tags : []),
                        tagInput.trim(),
                      ]);
                      onUpdateItem(item.id, { tags: nextTags });
                      setTagInput('');
                    }}
                    className="min-h-[38px] rounded-[4px] border border-line bg-app px-3 text-xs font-medium text-ink hover:border-accent"
                  >
                    + Tag
                  </button>
                </div>
                {Array.isArray(item.tags) && item.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {item.tags.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() =>
                          onUpdateItem(item.id, {
                            tags: item.tags.filter((x) => x !== t),
                          })
                        }
                        title={`Remover tag #${t}`}
                        className="inline-flex min-h-[28px] items-center gap-1 rounded-[4px] border border-accent/40 bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-ink hover:border-accent"
                      >
                        <span>#{t}</span>
                        <X className="h-3 w-3 text-subtle" strokeWidth={1.5} />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t border-line pt-2.5 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink">
                    <UserCheck className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                    <span>Blu-ray / DVD Emprestado</span>
                  </span>
                  {isLoanOverdue(item) && (
                    <span className="inline-flex items-center gap-1 rounded-[4px] border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-500">
                      <AlertCircle className="h-3 w-3" strokeWidth={1.5} />
                      Emprestado há +30 dias
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={item.loanedTo || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      onUpdateItem(item.id, {
                        loanedTo: val,
                        loanedAt: val.trim() ? item.loanedAt || getTodayLocalISO() : null,
                      });
                    }}
                    placeholder="Emprestado para quem?"
                    aria-label="Nome de quem pegou a mídia emprestada"
                    className="min-h-[38px] rounded-[4px] border border-line bg-app px-2.5 py-1 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
                  />
                  <input
                    type="date"
                    value={item.loanedAt ? String(item.loanedAt).slice(0, 10) : ''}
                    onChange={(e) =>
                      onUpdateItem(item.id, { loanedAt: e.target.value || null })
                    }
                    aria-label="Data do empréstimo"
                    className="min-h-[38px] rounded-[4px] border border-line bg-app px-2.5 py-1 text-xs text-ink focus:border-accent focus:outline-none"
                  />
                </div>
              </div>
            </section>

            <label className="mt-4 block">
              <span className="mb-1.5 block text-xs font-medium text-muted">
                {ui.detail.notesLabel}
              </span>
              <textarea
                rows={3}
                value={item[notesKey] || ''}
                onChange={(e) =>
                  onUpdateItem(item.id, { [notesKey]: e.target.value })
                }
                placeholder={ui.detail.notesPlaceholder}
                className="w-full resize-none rounded-xl border border-line bg-app px-3 py-2.5 text-xs leading-relaxed text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
              />
            </label>

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() =>
                  onUpdateItem(item.id, { isFavorite: !item.isFavorite })
                }
                className={`flex min-h-[44px] items-center justify-center gap-2 rounded-xl border py-2.5 text-xs font-medium transition-colors ${
                  item.isFavorite
                    ? 'border-accent/60 bg-accent/15 text-accent'
                    : 'border-line bg-app text-muted hover:text-ink'
                }`}
              >
                <Heart
                  className="h-3.5 w-3.5"
                  fill={item.isFavorite ? 'currentColor' : 'none'}
                  strokeWidth={1.5}
                />
                {ui.detail.favoriteLabel}
              </button>

              <button
                type="button"
                onClick={() =>
                  onUpdateItem(item.id, { wantToReread: !item.wantToReread })
                }
                className={`flex min-h-[44px] items-center justify-center gap-2 rounded-xl border py-2.5 text-xs font-medium transition-colors ${
                  item.wantToReread
                    ? 'border-accent/60 bg-accent/15 text-accent'
                    : 'border-line bg-app text-muted hover:text-ink'
                }`}
              >
                <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} />
                <span>{item.wantToReread ? 'Quero rever (ativo)' : 'Quero rever'}</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  onUpdateItem(item.id, { isWishlist: !item.isWishlist })
                }
                className={`flex min-h-[44px] items-center justify-center gap-2 rounded-xl border py-2.5 text-xs font-medium transition-colors ${
                  item.isWishlist
                    ? 'border-accent/60 bg-accent/15 text-accent'
                    : 'border-line bg-app text-muted hover:text-ink'
                }`}
              >
                <Bookmark
                  className="h-3.5 w-3.5"
                  fill={item.isWishlist ? 'currentColor' : 'none'}
                  strokeWidth={1.5}
                />
                {ui.detail.wishlistLabel}
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                downloadWorkMarkdown(item);
                showToast({ message: 'Ficha exportada em Markdown (.md).', type: 'success' });
              }}
              className="mt-3 flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl border border-line bg-app py-2.5 text-xs font-medium text-ink transition-colors hover:border-accent"
            >
              <Download className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
              <span>Exportar crítica e ficha (.md)</span>
            </button>

            <button
              type="button"
              onClick={() => {
                onRemoveItem(item.id);
                onClose();
              }}
              className="mt-3 flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl border border-rose-500/20 bg-rose-500/10 py-2.5 text-xs font-medium text-rose-400 transition-colors hover:bg-rose-500/20"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
              {ui.detail.removeLabel}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
