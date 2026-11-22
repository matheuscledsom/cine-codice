import {
  Award,
  Check,
  Clock,
  Cloud,
  Copy,
  Link2,
  MessagesSquare,
  QrCode,
  Search,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../../context/ToastContext';
import {
  buildInviteShareUrl,
  followReader,
  listLocalInviteContacts,
  listPendingFollowRequests,
  respondFollowRequest,
  searchReaderProfiles,
  unfollowReader,
} from '../../services/codiceBackend';
import { decodePublicProfileCard } from '../../services/peerProfileShare';
import { ActivityFeed } from './ActivityFeed';
import { DirectChatPanel } from './DirectChatDrawer';

const PAGE_SIZE = 20;

const SUB_TABS = [
  { id: 'feed', label: 'Feed dos Amigos' },
  { id: 'explore', label: 'Explorar & Convidar' },
  { id: 'chat', label: 'Chat Direto' },
];

export function CommunityScreen({
  viewerId = null,
  myProfile = null,
  myShelfItems = [],
  savedPeerCards = [],
  unreadDmCount = 0,
  backendMode = 'local',
  onOpenAuthModal,
  onOpenShareProfileCard,
  onOpenFriendCard,
  onRemoveFriendCard,
  onOpenUserProfile,
  onOpenDirectChat,
  onCopyBookToWishlist,
  onSocialChanged,
}) {
  const { showToast } = useToast();
  const [subTab, setSubTab] = useState('feed');
  const [query, setQuery] = useState('');
  const [readers, setReaders] = useState([]);
  const [localContacts, setLocalContacts] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [isLoading, setIsLoading] = useState(false);
  const [busyIds, setBusyIds] = useState({});
  const [chatTargetPeerId, setChatTargetPeerId] = useState(null);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [cardImportInput, setCardImportInput] = useState('');
  const tabRefs = useRef({});

  const loadDirectoryAndRequests = useCallback(async () => {
    setIsLoading(true);
    try {
      const [foundReaders, requests, contacts] = await Promise.all([
        searchReaderProfiles(query, { viewerId }),
        listPendingFollowRequests(viewerId),
        listLocalInviteContacts(),
      ]);
      setReaders(Array.isArray(foundReaders) ? foundReaders : []);
      setPendingRequests(Array.isArray(requests) ? requests : []);
      setLocalContacts(Array.isArray(contacts) ? contacts : []);
    } catch {
      setReaders([]);
      setPendingRequests([]);
      setLocalContacts([]);
    } finally {
      setIsLoading(false);
    }
  }, [query, viewerId]);

  useEffect(() => {
    loadDirectoryAndRequests();
  }, [loadDirectoryAndRequests]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [query]);

  const inviteUrl = useMemo(
    () => buildInviteShareUrl(myProfile?.handle || ''),
    [myProfile?.handle]
  );

  const filteredLocalContacts = useMemo(() => {
    const q = String(query || '').trim().toLowerCase();
    const directoryHandles = new Set(
      readers.map((r) => String(r.handle || '').toLowerCase()).filter(Boolean)
    );
    return localContacts.filter((c) => {
      const handle = String(c?.handle || '').toLowerCase();
      if (handle && directoryHandles.has(handle)) return false;
      if (!q) return true;
      return (
        String(c?.displayName || '').toLowerCase().includes(q) ||
        handle.includes(q)
      );
    });
  }, [localContacts, readers, query]);

  const visibleReaders = useMemo(
    () => readers.slice(0, visibleCount),
    [readers, visibleCount]
  );

  const handleCopyInviteLink = async () => {
    if (!inviteUrl) {
      showToast({
        message: 'Defina um @handle no seu perfil para gerar seu link de convite.',
        type: 'info',
      });
      return;
    }
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(inviteUrl);
        setCopiedInvite(true);
        setTimeout(() => setCopiedInvite(false), 2500);
        showToast({ message: 'Link de convite copiado.', type: 'success' });
        return;
      }
    } catch {
      // Fallback below
    }
    showToast({ message: `Convite: ${inviteUrl}`, type: 'info' });
  };

  const handleImportLiveCard = (e) => {
    e.preventDefault();
    const raw = cardImportInput.trim();
    if (!raw) return;
    const decoded = decodePublicProfileCard(raw);
    if (!decoded.ok) {
      showToast({
        message: decoded.error || 'Não foi possível validar esse Cartão Vivo.',
        type: 'error',
      });
      return;
    }
    setCardImportInput('');
    onOpenFriendCard?.(decoded.card);
  };

  const handleToggleFollow = async (reader) => {
    if (!reader?.id || busyIds[reader.id]) return;
    setBusyIds((prev) => ({ ...prev, [reader.id]: true }));
    try {
      if (reader.followStatus === 'approved' || reader.followStatus === 'pending') {
        await unfollowReader(reader.id, { viewerId });
        showToast({ message: 'Você deixou de seguir este leitor.', type: 'info' });
      } else {
        const res = await followReader(reader.id, { viewerId });
        showToast({
          message:
            res?.status === 'pending'
              ? 'Solicitação de vínculo enviada.'
              : `Seguindo ${reader.displayName || reader.handle}.`,
          type: 'success',
        });
      }
      await loadDirectoryAndRequests();
      onSocialChanged?.();
    } catch (err) {
      showToast({
        message: err?.userMessage || 'Não foi possível atualizar vínculo.',
        type: 'error',
      });
    } finally {
      setBusyIds((prev) => ({ ...prev, [reader.id]: false }));
    }
  };

  const handleRespondRequest = async (followerId, accept) => {
    if (!followerId) return;
    try {
      await respondFollowRequest(followerId, accept, { profileId: viewerId });
      showToast({
        message: accept ? 'Solicitação aprovada.' : 'Solicitação recusada.',
        type: accept ? 'success' : 'info',
      });
      await loadDirectoryAndRequests();
      onSocialChanged?.();
    } catch (err) {
      showToast({
        message: err?.userMessage || 'Não foi possível responder à solicitação.',
        type: 'error',
      });
    }
  };

  const handleTabKeyDown = (e, index) => {
    let nextIndex = null;
    if (e.key === 'ArrowRight') nextIndex = (index + 1) % SUB_TABS.length;
    else if (e.key === 'ArrowLeft')
      nextIndex = (index - 1 + SUB_TABS.length) % SUB_TABS.length;
    else if (e.key === 'Home') nextIndex = 0;
    else if (e.key === 'End') nextIndex = SUB_TABS.length - 1;

    if (nextIndex !== null) {
      e.preventDefault();
      const targetTab = SUB_TABS[nextIndex];
      setSubTab(targetTab.id);
      tabRefs.current[targetTab.id]?.focus();
    }
  };

  const handleStartDirectChat = (peerId) => {
    if (!peerId) return;
    setChatTargetPeerId(peerId);
    setSubTab('chat');
    if (onOpenDirectChat) {
      // Mantemos o fluxo unificado na aba Chat Direto quando dentro da Comunidade.
    }
  };

  const renderLocalModeBanner = (contextText) => {
    if (backendMode === 'supabase') return null;
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[4px] border border-line bg-surface px-4 py-3 text-xs">
        <div className="flex min-w-0 flex-1 items-start gap-2.5 text-muted">
          <Cloud className="mt-0.5 h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />
          <p className="leading-relaxed">
            <span className="font-medium text-ink">Rede Sem Servidor Ativa: </span>
            {contextText}
          </p>
        </div>
        {onOpenAuthModal && (
          <button
            type="button"
            onClick={onOpenAuthModal}
            className="min-h-[44px] shrink-0 rounded-[4px] border border-line bg-app px-3 py-1.5 text-xs font-medium text-muted hover:border-accent hover:text-ink transition-colors"
          >
            Sincronização Avançada (Supabase)
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6 pb-8">
      {/* Cabeçalho editorial */}
      <header className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-line">
        <div className="min-w-0 space-y-1">
          <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted font-medium">
            <Users className="w-3.5 h-3.5" strokeWidth={1.5} />
            <span>Rede Literária</span>
          </div>
          <h1 className="text-2xl font-serif font-semibold text-ink">
            Comunidade &amp; Leitores
          </h1>
          <p className="text-xs text-muted">
            Troque perfis e estantes por Link ou QR Code sem precisar criar conta ou servidor.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            if (onOpenShareProfileCard) {
              onOpenShareProfileCard();
            } else {
              handleCopyInviteLink();
            }
          }}
          className="min-h-[44px] px-3.5 py-2 rounded-[4px] border border-accent bg-accent text-xs font-semibold text-accent-ink hover:opacity-90 inline-flex items-center gap-2 transition-opacity"
        >
          <QrCode className="w-4 h-4" strokeWidth={1.5} />
          <span>Compartilhar Meu Perfil</span>
        </button>
      </header>

      {/* Navegação interna por 3 abas acessíveis */}
      <div
        role="tablist"
        aria-label="Seções da comunidade"
        className="flex items-center gap-1 border-b border-line overflow-x-auto no-scrollbar"
      >
        {SUB_TABS.map((tab, index) => {
          const isActive = subTab === tab.id;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                tabRefs.current[tab.id] = el;
              }}
              type="button"
              role="tab"
              id={`community-tab-${tab.id}`}
              aria-selected={isActive}
              aria-controls={`community-panel-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setSubTab(tab.id)}
              onKeyDown={(e) => handleTabKeyDown(e, index)}
              className={`min-h-[44px] px-3.5 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors inline-flex items-center gap-1.5 ${
                isActive
                  ? 'border-accent text-accent'
                  : 'border-transparent text-muted hover:text-ink'
              }`}
            >
              <span>{tab.label}</span>
              {tab.id === 'explore' && pendingRequests.length > 0 && (
                <span className="px-1.5 py-0.5 rounded-[2px] border border-accent text-accent text-[10px] tabular-nums font-semibold">
                  {pendingRequests.length}
                </span>
              )}
              {tab.id === 'chat' && unreadDmCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-[2px] bg-accent text-accent-ink text-[10px] tabular-nums font-semibold">
                  {unreadDmCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Aba 1: Feed dos Amigos */}
      {subTab === 'feed' && (
        <div
          id="community-panel-feed"
          role="tabpanel"
          aria-labelledby="community-tab-feed"
          className="space-y-4"
        >
          {renderLocalModeBanner(
            'você pode trocar perfis e estantes por Link ou QR Code livremente. A sincronização automática em tempo real (Supabase) é opcional nas Configurações.'
          )}
          <ActivityFeed
            viewerId={viewerId}
            onSelectProfile={(id) => onOpenUserProfile?.(id)}
          />
        </div>
      )}

      {/* Aba 2: Explorar & Convidar */}
      {subTab === 'explore' && (
        <div
          id="community-panel-explore"
          role="tabpanel"
          aria-labelledby="community-tab-explore"
          className="space-y-5"
        >
          {renderLocalModeBanner(
            'use Cartões Vivos (?card= / QR Code) para adicionar amigos sem servidor. Sincronização automática via Supabase é opcional.'
          )}

          {savedPeerCards.length > 0 && (
            <section className="space-y-2.5" aria-label="Amigos salvos por link ou QR Code">
              <p className="text-[11px] uppercase tracking-wider font-medium text-muted">
                Amigos Salvos por Link / QR Code ({savedPeerCards.length})
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {savedPeerCards.map((peerCard) => (
                  <div
                    key={peerCard.id || peerCard.handle}
                    className="flex items-center justify-between gap-2 rounded-[4px] border border-line bg-surface p-3"
                  >
                    <button
                      type="button"
                      onClick={() => onOpenFriendCard?.(peerCard)}
                      className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-panel text-xs font-serif font-semibold text-accent">
                        {peerCard.avatarInitials || 'LC'}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-ink">
                          {peerCard.displayName || peerCard.handle}
                        </p>
                        <p className="truncate text-[11px] tabular-nums text-subtle">
                          {peerCard.handle}
                          {peerCard.currentReading?.title
                            ? ` · ${peerCard.currentReading.title}`
                            : ''}
                        </p>
                      </div>
                    </button>
                    {onRemoveFriendCard && (
                      <button
                        type="button"
                        onClick={() =>
                          onRemoveFriendCard(peerCard.id || peerCard.handle)
                        }
                        aria-label={`Remover ${peerCard.displayName || peerCard.handle}`}
                        className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-[4px] text-subtle hover:text-ink"
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Card compacto de convite */}
          <div className="rounded-[4px] border border-line bg-surface p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <p className="text-xs font-semibold text-ink">
                Compartilhe seu Cartão Vivo (Link &amp; QR Code) ou @handle
              </p>
                <p className="truncate text-xs text-muted tabular-nums">
                  {inviteUrl || 'Configure um @handle em Editar Perfil para compartilhar'}
                  {myProfile?.userTag ? ` · Tag: ${myProfile.userTag}` : ''}
                </p>
              </div>
            <div className="flex flex-wrap items-center gap-2">
              {onOpenShareProfileCard && (
                <button
                  type="button"
                  onClick={onOpenShareProfileCard}
                  className="min-h-[44px] shrink-0 px-3 py-2 rounded-[4px] border border-accent bg-accent/15 text-xs font-medium text-accent hover:bg-accent hover:text-accent-ink inline-flex items-center gap-1.5 transition-colors"
                >
                  <QrCode className="w-3.5 h-3.5" strokeWidth={1.5} />
                  <span>QR Code &amp; Link</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleCopyInviteLink}
                className="min-h-[44px] shrink-0 px-3.5 py-2 rounded-[4px] border border-line bg-panel text-xs font-medium text-ink hover:border-accent hover:text-accent inline-flex items-center gap-1.5 transition-colors"
              >
                <Copy className="w-3.5 h-3.5 text-accent" strokeWidth={1.5} />
                <span>{copiedInvite ? 'Copiado' : 'Link @handle'}</span>
              </button>
            </div>
          </div>

          <form
            onSubmit={handleImportLiveCard}
            className="rounded-[4px] border border-line bg-surface p-3 flex flex-col sm:flex-row gap-2"
          >
            <input
              type="text"
              value={cardImportInput}
              onChange={(e) => setCardImportInput(e.target.value)}
              placeholder="Cole um link ?card= ou código de Cartão Vivo de amigo para confirmar e salvar..."
              aria-label="Colar link ou código de Cartão Vivo"
              className="min-h-[44px] min-w-0 flex-1 rounded-[4px] border border-line bg-panel px-3 py-2 text-xs text-ink placeholder:text-muted focus:border-accent focus:outline-none"
            />
            <button
              type="submit"
              disabled={!cardImportInput.trim()}
              className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-[4px] border border-line bg-panel px-3.5 py-2 text-xs font-medium text-ink hover:border-accent hover:text-accent disabled:opacity-50"
            >
              <Link2 className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
              <span>Visualizar Cartão</span>
            </button>
          </form>

          {/* Solicitações Pendentes */}
          {pendingRequests.length > 0 && (
            <section className="space-y-2" aria-label="Solicitações de seguimento">
              <p className="text-[11px] uppercase tracking-wider font-medium text-muted">
                Solicitações pendentes ({pendingRequests.length})
              </p>
              <div className="divide-y divide-line border border-line rounded-[4px] bg-surface">
                {pendingRequests.map((req) => {
                  const follower = req.followerProfile || {};
                  const displayName =
                    follower.displayName || follower.handle || 'Leitor';
                  return (
                    <div
                      key={req.followerId}
                      className="p-4 flex flex-wrap items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={() => onOpenUserProfile?.(req.followerId)}
                          className="text-sm font-medium text-ink hover:text-accent transition-colors text-left"
                        >
                          {displayName}
                        </button>
                        {follower.handle && (
                          <p className="text-xs text-muted tabular-nums">
                            {follower.handle}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleRespondRequest(req.followerId, true)}
                          className="min-h-[44px] px-3 py-2 rounded-[4px] border border-accent bg-accent text-accent-ink text-xs font-medium inline-flex items-center gap-1.5"
                        >
                          <Check className="w-4 h-4" strokeWidth={1.5} />
                          <span>Aceitar</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRespondRequest(req.followerId, false)}
                          className="min-h-[44px] px-3 py-2 rounded-[4px] border border-line text-muted hover:text-ink text-xs font-medium inline-flex items-center gap-1.5"
                        >
                          <X className="w-4 h-4" strokeWidth={1.5} />
                          <span>Recusar</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Busca no diretório */}
          <div className="relative">
            <Search
              className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              strokeWidth={1.5}
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nome, @handle ou #código..."
              aria-label="Buscar leitores na comunidade"
              className="w-full min-h-[44px] pl-9 pr-3 py-2 rounded-[4px] border border-line bg-surface text-sm text-ink placeholder:text-muted focus:outline-none focus:border-accent"
            />
          </div>

          {/* Contatos de convite salvos offline */}
          {filteredLocalContacts.length > 0 && (
            <section className="space-y-2" aria-label="Contatos recebidos por convite">
              <p className="text-[11px] uppercase tracking-wider font-medium text-muted">
                Contatos salvos por convite ({filteredLocalContacts.length})
              </p>
              <div className="divide-y divide-line border border-line rounded-[4px] bg-surface">
                {filteredLocalContacts.map((contact) => (
                  <div
                    key={contact.id}
                    className="p-3.5 flex items-center justify-between gap-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="w-9 h-9 rounded-full border border-line bg-panel flex items-center justify-center text-xs font-serif font-semibold text-ink shrink-0">
                        {contact.avatarInitials || 'LC'}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-serif font-semibold text-ink">
                          {contact.displayName || contact.handle}
                        </p>
                        <p className="truncate text-xs text-muted">
                          {contact.handle}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpenUserProfile?.(contact.id)}
                      className="min-h-[44px] shrink-0 px-3 py-2 rounded-[4px] border border-line text-xs font-medium text-ink hover:border-accent hover:text-accent transition-colors"
                    >
                      Ver Perfil
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Lista principal paginada (20 em 20) */}
          {isLoading ? (
            <div className="py-10 text-center text-xs text-muted border border-line rounded-[4px] bg-surface">
              Consultando diretório de leitores...
            </div>
          ) : visibleReaders.length === 0 ? (
            <div className="py-10 px-4 text-center text-xs text-muted border border-line rounded-[4px] bg-surface">
              Nenhum leitor encontrado para este filtro.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="divide-y divide-line border border-line rounded-[4px] bg-surface">
                {visibleReaders.map((reader) => {
                  const isBusy = Boolean(busyIds[reader.id]);
                  const initials =
                    reader.avatarInitials ||
                    String(reader.displayName || reader.handle || 'LC')
                      .slice(0, 2)
                      .toUpperCase();
                  return (
                    <div
                      key={reader.id}
                      className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        {reader.avatarUrl ? (
                          <img
                            src={reader.avatarUrl}
                            alt={reader.displayName || reader.handle}
                            className="w-11 h-11 rounded-full object-cover border border-line shrink-0"
                          />
                        ) : (
                          <div className="w-11 h-11 rounded-full border border-line bg-panel flex items-center justify-center text-xs font-serif font-semibold text-ink shrink-0">
                            {initials}
                          </div>
                        )}

                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <button
                              type="button"
                              onClick={() => onOpenUserProfile?.(reader.id)}
                              className="text-sm font-serif font-semibold text-ink hover:text-accent text-left transition-colors"
                            >
                              {reader.displayName || reader.handle}
                            </button>
                            <span className="text-xs text-muted tabular-nums">
                              {reader.userTag || reader.handle}
                            </span>
                            {reader.isSelf && (
                              <span className="text-[11px] uppercase tracking-wider text-accent font-medium">
                                Você
                              </span>
                            )}
                          </div>

                          {reader.gamificationEnabled !== false &&
                            reader.resolvedBadgeName && (
                              <div className="inline-flex items-center gap-1 text-[11px] font-medium text-accent">
                                <Award className="w-3.5 h-3.5" strokeWidth={1.5} />
                                <span>{reader.resolvedBadgeName}</span>
                              </div>
                            )}

                          {reader.bio && (
                            <p className="text-xs text-muted line-clamp-2 leading-relaxed">
                              {reader.bio}
                            </p>
                          )}

                          <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted tabular-nums pt-0.5">
                            <span>{reader.worksCount || 0} obras no acervo</span>
                            <span>{reader.readingCount || 0} em leitura</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => onOpenUserProfile?.(reader.id)}
                          className="min-h-[44px] px-3 py-2 rounded-[4px] border border-line text-xs font-medium text-ink hover:border-accent hover:text-accent transition-colors"
                        >
                          Ver Perfil
                        </button>

                        {!reader.isSelf && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleToggleFollow(reader)}
                              disabled={isBusy}
                              className={`min-h-[44px] px-3 py-2 rounded-[4px] border text-xs font-medium inline-flex items-center gap-1.5 transition-colors ${
                                reader.followStatus === 'approved'
                                  ? 'border-accent text-accent bg-accent/5'
                                  : reader.followStatus === 'pending'
                                  ? 'border-line text-muted bg-panel'
                                  : 'border-accent bg-accent text-accent-ink'
                              }`}
                            >
                              {reader.followStatus === 'approved' ? (
                                <>
                                  <UserCheck className="w-3.5 h-3.5" strokeWidth={1.5} />
                                  <span>Seguindo</span>
                                </>
                              ) : reader.followStatus === 'pending' ? (
                                <>
                                  <Clock className="w-3.5 h-3.5" strokeWidth={1.5} />
                                  <span>Solicitado</span>
                                </>
                              ) : (
                                <>
                                  <UserPlus className="w-3.5 h-3.5" strokeWidth={1.5} />
                                  <span>Seguir</span>
                                </>
                              )}
                            </button>

                            {reader.allowDms !== false && (
                              <button
                                type="button"
                                onClick={() => handleStartDirectChat(reader.id)}
                                aria-label={`Enviar mensagem para ${reader.displayName || reader.handle}`}
                                className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-[4px] border border-line text-muted hover:border-accent hover:text-accent transition-colors"
                              >
                                <MessagesSquare className="w-4 h-4" strokeWidth={1.5} />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {readers.length > visibleReaders.length && (
                <div className="flex justify-center pt-1">
                  <button
                    type="button"
                    onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
                    className="min-h-[44px] px-4 py-2 rounded-[4px] border border-line bg-surface text-xs font-medium text-ink hover:border-accent hover:text-accent transition-colors"
                  >
                    Carregar mais ({readers.length - visibleReaders.length} restantes)
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Aba 3: Chat Direto (Realtime ativo apenas quando esta aba está aberta) */}
      {subTab === 'chat' && (
        <div
          id="community-panel-chat"
          role="tabpanel"
          aria-labelledby="community-tab-chat"
        >
          <DirectChatPanel
            active={subTab === 'chat'}
            viewerId={viewerId}
            initialPeerId={chatTargetPeerId}
            myShelfItems={myShelfItems}
            backendMode={backendMode}
            onOpenAuthModal={onOpenAuthModal}
            onCopyBookToWishlist={onCopyBookToWishlist}
            onUnreadChanged={onSocialChanged}
            embedded
          />
        </div>
      )}
    </div>
  );
}
