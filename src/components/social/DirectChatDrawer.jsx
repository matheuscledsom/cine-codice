import {
  ArrowLeft,
  BookOpen,
  BookPlus,
  BookmarkPlus,
  Cloud,
  MessagesSquare,
  Send,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '../../context/ToastContext';
import {
  listDirectConversations,
  listDirectMessages,
  markConversationRead,
  MAX_SOCIAL_MESSAGE_CHARS,
  searchReaderProfiles,
  sendDirectMessage,
  subscribeDirectMessagesRealtime,
} from '../../services/codiceBackend';
import { CoverArt } from '../CoverArt';

function formatMessageTime(iso) {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function sortChronologically(list) {
  return [...(Array.isArray(list) ? list : [])].sort((a, b) => {
    const ta = new Date(a?.createdAt || 0).getTime();
    const tb = new Date(b?.createdAt || 0).getTime();
    if (ta !== tb) return ta - tb;
    return String(a?.id || '').localeCompare(String(b?.id || ''));
  });
}

export function DirectChatPanel({
  active = true,
  viewerId = null,
  initialPeerId = null,
  myShelfItems = [],
  backendMode = 'local',
  onOpenAuthModal,
  onCopyBookToWishlist,
  onUnreadChanged,
  onClose = null,
  embedded = false,
}) {
  const { showToast } = useToast();
  const [conversations, setConversations] = useState([]);
  const [peersDirectory, setPeersDirectory] = useState([]);
  const [activePeerId, setActivePeerId] = useState(initialPeerId || null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [bookPickerOpen, setBookPickerOpen] = useState(false);
  const [selectedBook, setSelectedBook] = useState(null);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const messagesEndRef = useRef(null);

  const loadConversations = useCallback(async () => {
    try {
      const [convs, peers] = await Promise.all([
        listDirectConversations({ viewerId }),
        searchReaderProfiles('', { viewerId }),
      ]);
      setConversations(Array.isArray(convs) ? convs : []);
      setPeersDirectory(
        (Array.isArray(peers) ? peers : []).filter((p) => p.id !== viewerId)
      );
    } catch {
      setConversations([]);
    }
  }, [viewerId]);

  const loadThread = useCallback(
    async (peerId) => {
      if (!peerId) {
        setMessages([]);
        return;
      }
      const list = await listDirectMessages(peerId, { viewerId });
      setMessages(sortChronologically(list));
      await markConversationRead(peerId, { viewerId });
      onUnreadChanged?.();
    },
    [viewerId, onUnreadChanged]
  );

  useEffect(() => {
    if (!active) {
      setBookPickerOpen(false);
      setSelectedBook(null);
      return;
    }
    loadConversations();
    if (initialPeerId) {
      setActivePeerId(initialPeerId);
    }
  }, [active, initialPeerId, loadConversations]);

  useEffect(() => {
    if (!active || !activePeerId) return;
    loadThread(activePeerId);
  }, [active, activePeerId, loadThread]);

  // Inicia Realtime sob demanda apenas enquanto o chat está ativo; cancela ao sair.
  useEffect(() => {
    if (!active || !viewerId) return undefined;

    const unsubscribe = subscribeDirectMessagesRealtime({
      viewerId,
      onMessage: (incomingMsg) => {
        if (!incomingMsg) return;
        const involvesActivePeer =
          activePeerId &&
          ((incomingMsg.senderId === viewerId &&
            incomingMsg.recipientId === activePeerId) ||
            (incomingMsg.senderId === activePeerId &&
              incomingMsg.recipientId === viewerId));

        if (involvesActivePeer) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === incomingMsg.id)) return prev;
            return sortChronologically([...prev, incomingMsg]);
          });
          if (incomingMsg.senderId === activePeerId) {
            markConversationRead(activePeerId, { viewerId })
              .then(() => onUnreadChanged?.())
              .catch(() => {});
          }
        }
        loadConversations();
        onUnreadChanged?.();
      },
    });

    return () => {
      unsubscribe?.();
    };
  }, [active, viewerId, activePeerId, loadConversations, onUnreadChanged]);

  useEffect(() => {
    if (!active || !activePeerId) return;
    messagesEndRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [active, activePeerId, messages.length]);

  const activePeer =
    conversations.find((c) => c.peerId === activePeerId)?.peerProfile ||
    peersDirectory.find((p) => p.id === activePeerId) ||
    null;

  const availablePeersForNewChat = peersDirectory.filter(
    (p) => !conversations.some((c) => c.peerId === p.id)
  );

  const recommendableBooks = myShelfItems
    .filter((i) => i && i.inBacklog !== false)
    .slice(0, 15);

  const handleSend = async (e) => {
    e?.preventDefault?.();
    if (!activePeerId || sendingRef.current) return;
    if (!draft.trim() && !selectedBook) return;
    if (draft.length > MAX_SOCIAL_MESSAGE_CHARS) {
      showToast({
        message: `Limite máximo de ${MAX_SOCIAL_MESSAGE_CHARS} caracteres por mensagem.`,
        type: 'error',
      });
      return;
    }

    sendingRef.current = true;
    setSending(true);
    try {
      await sendDirectMessage({
        recipientId: activePeerId,
        content: draft,
        attachedWorkSnapshot: selectedBook,
        viewerId,
      });
      setDraft('');
      setSelectedBook(null);
      setBookPickerOpen(false);
      await Promise.all([loadThread(activePeerId), loadConversations()]);
    } catch (err) {
      showToast({
        message: err?.userMessage || 'Não foi possível enviar a mensagem.',
        type: 'error',
      });
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  return (
    <div
      className={
        embedded
          ? 'flex min-h-[460px] flex-col rounded-[4px] border border-line bg-card text-ink'
          : 'flex h-full flex-col text-ink'
      }
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          {activePeerId && (
            <button
              type="button"
              onClick={() => setActivePeerId(null)}
              aria-label="Voltar para lista de conversas"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[4px] border border-line text-muted hover:text-ink"
            >
              <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
            </button>
          )}
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-ink">
              {activePeer ? activePeer.displayName : 'Mensagens Diretas'}
            </h2>
            <p className="truncate text-[11px] text-muted">
              {activePeer ? activePeer.handle : 'Chat 1:1 e recomendações'}
            </p>
          </div>
        </div>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar chat"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[4px] border border-line text-muted hover:text-ink"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        )}
      </div>

      {/* Aviso claro sobre Modo Local vs Supabase */}
      {backendMode !== 'supabase' && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-app px-4 py-2.5 text-xs">
          <div className="flex min-w-0 items-center gap-2 text-muted">
            <Cloud className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />
            <span className="leading-snug">
              Modo Local: mensagens ficam neste dispositivo até conectar o Supabase.
            </span>
          </div>
          {onOpenAuthModal && (
            <button
              type="button"
              onClick={onOpenAuthModal}
              className="min-h-[36px] shrink-0 rounded-[4px] border border-accent px-2.5 py-1 text-[11px] font-semibold text-accent hover:bg-accent/10"
            >
              Conectar Supabase
            </button>
          )}
        </div>
      )}

      {/* Lista de Conversas OR Thread */}
      {!activePeerId ? (
        <div className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar">
          {conversations.length === 0 ? (
            <div className="rounded-[4px] border border-line bg-app px-4 py-7 text-center space-y-1.5">
              <MessagesSquare
                className="mx-auto h-5 w-5 text-subtle"
                strokeWidth={1.5}
              />
              <p className="text-xs font-medium text-ink">
                Nenhuma conversa ativa ainda
              </p>
              <p className="text-[11px] text-muted">
                Escolha um amigo abaixo para conversar e recomendar filmes, séries ou animes.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-subtle">
                Conversas Recentes
              </p>
              {conversations.map((conv) => (
                <button
                  key={conv.peerId}
                  type="button"
                  onClick={() => setActivePeerId(conv.peerId)}
                  className="flex min-h-[52px] w-full items-center justify-between gap-2.5 rounded-[4px] border border-line bg-app p-2.5 text-left transition-colors hover:border-accent"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-card text-xs font-semibold text-accent">
                      {conv.peerProfile?.avatarInitials || 'LC'}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-ink">
                        {conv.peerProfile?.displayName || 'Leitor'}{' '}
                        <span className="font-normal text-muted">
                          {conv.peerProfile?.handle}
                        </span>
                      </p>
                      <p className="truncate text-[11px] text-muted">
                        {conv.lastMessage?.content}
                      </p>
                    </div>
                  </div>
                  {conv.unreadCount > 0 && (
                    <span className="shrink-0 rounded-[4px] bg-accent px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-accent-ink">
                      {conv.unreadCount}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {availablePeersForNewChat.length > 0 && (
            <div className="space-y-1.5 border-t border-line pt-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-subtle">
                Iniciar Nova Conversa
              </p>
              {availablePeersForNewChat.map((peer) => (
                <button
                  key={peer.id}
                  type="button"
                  onClick={() => setActivePeerId(peer.id)}
                  className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-[4px] border border-line bg-app px-3 py-2 text-left text-xs transition-colors hover:border-accent"
                >
                  <span className="truncate font-medium text-ink">
                    {peer.displayName}{' '}
                    <span className="text-muted">{peer.handle}</span>
                  </span>
                  <span className="text-[11px] text-accent">Conversar</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto p-4 space-y-2.5 no-scrollbar">
            {messages.length === 0 ? (
              <div className="py-10 text-center text-xs text-muted">
                Envie a primeira mensagem ou recomende um livro da sua estante.
              </div>
            ) : (
              messages.map((msg) => {
                const isMine = msg.senderId === viewerId;
                const book = msg.attachedWorkSnapshot || null;
                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-[6px] border px-3 py-2 text-xs space-y-2 ${
                        isMine
                          ? 'border-accent/50 bg-accent/10 text-ink'
                          : 'border-line bg-app text-ink'
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words leading-relaxed">
                        {msg.content}
                      </p>

                      {book && (
                        <div className="flex items-center gap-2.5 rounded-[4px] border border-line bg-card p-2">
                          <CoverArt
                            item={book}
                            compact
                            className="h-14 w-10 shrink-0 rounded-[2px]"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[11px] font-semibold text-ink">
                              {book.title}
                            </p>
                            {book.author && (
                              <p className="truncate text-[10px] text-muted">
                                {book.author}
                              </p>
                            )}
                            {!isMine && onCopyBookToWishlist && (
                              <button
                                type="button"
                                onClick={() => onCopyBookToWishlist(book)}
                                className="mt-1 inline-flex min-h-[32px] items-center gap-1 text-[10px] font-semibold text-accent hover:underline"
                              >
                                <BookmarkPlus className="h-3 w-3" strokeWidth={1.5} />
                                <span>Salvar em Desejos</span>
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    <span className="mt-0.5 text-[10px] tabular-nums text-subtle">
                      {formatMessageTime(msg.createdAt)}
                    </span>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {bookPickerOpen && (
            <div className="max-h-44 overflow-y-auto border-t border-line bg-app p-2.5 space-y-1 no-scrollbar">
              <div className="flex items-center justify-between text-[11px] font-medium text-muted">
                <span>Escolha uma obra da sua estante:</span>
                <button
                  type="button"
                  onClick={() => setBookPickerOpen(false)}
                  className="min-h-[32px] px-1 text-subtle hover:text-ink"
                >
                  Fechar
                </button>
              </div>
              {recommendableBooks.length === 0 ? (
                <p className="text-[11px] text-subtle">Sua estante está vazia.</p>
              ) : (
                recommendableBooks.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => {
                      setSelectedBook(b);
                      setBookPickerOpen(false);
                    }}
                    className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-[4px] border border-line bg-card px-2.5 py-1 text-left text-xs hover:border-accent"
                  >
                    <span className="flex min-w-0 items-center gap-1.5 truncate">
                      <BookOpen className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.5} />
                      <span className="truncate font-medium text-ink">{b.title}</span>
                    </span>
                    <span className="shrink-0 text-[10px] text-muted">
                      {b.author}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}

          <form
            onSubmit={handleSend}
            className="border-t border-line p-3 space-y-2"
          >
            {selectedBook && (
              <div className="flex items-center justify-between gap-2 rounded-[4px] border border-accent/40 bg-app px-2.5 py-1.5 text-[11px]">
                <span className="truncate font-medium text-accent">
                  Anexo: {selectedBook.title}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedBook(null)}
                  aria-label="Remover livro anexado"
                  className="flex min-h-[32px] min-w-[32px] items-center justify-center text-muted hover:text-ink"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              </div>
            )}

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setBookPickerOpen((p) => !p)}
                aria-label="Recomendar obra da estante"
                title="Recomendar obra da estante"
                className={`flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-[4px] border transition-colors ${
                  bookPickerOpen || selectedBook
                    ? 'border-accent text-accent'
                    : 'border-line bg-app text-muted hover:text-ink'
                }`}
              >
                <BookPlus className="h-4 w-4" strokeWidth={1.5} />
              </button>
              <input
                type="text"
                value={draft}
                maxLength={MAX_SOCIAL_MESSAGE_CHARS}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Escreva sua mensagem..."
                className="min-h-[44px] flex-1 rounded-[4px] border border-line bg-app px-3 py-1.5 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
              />
              <button
                type="submit"
                disabled={sending || (!draft.trim() && !selectedBook)}
                aria-label="Enviar mensagem"
                className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-[4px] bg-accent text-accent-ink disabled:opacity-50"
              >
                <Send className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>

            {draft.length >= 1500 && (
              <p className="text-right text-[10px] tabular-nums text-muted">
                {draft.length}/{MAX_SOCIAL_MESSAGE_CHARS}
              </p>
            )}
          </form>
        </>
      )}
    </div>
  );
}

export function DirectChatDrawer({
  isOpen,
  onClose,
  viewerId = null,
  initialPeerId = null,
  myShelfItems = [],
  backendMode = 'local',
  onOpenAuthModal,
  onCopyBookToWishlist,
  onUnreadChanged,
}) {
  const triggerRef = useRef(null);
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    triggerRef.current = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const frame = requestAnimationFrame(() => {
      const focusable = dialogRef.current?.querySelector(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      focusable?.focus?.();
    });

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose?.();
        return;
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const nodes = Array.from(
          dialogRef.current.querySelectorAll(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        );
        if (nodes.length === 0) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
      triggerRef.current?.focus?.();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-end bg-black/55 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Chat direto entre leitores"
        onClick={(e) => e.stopPropagation()}
        className="flex h-[100dvh] sm:h-[640px] w-full sm:w-[440px] flex-col rounded-none sm:rounded-[6px] border border-line bg-card text-ink pb-[env(safe-area-inset-bottom)]"
      >
        <DirectChatPanel
          active={isOpen}
          viewerId={viewerId}
          initialPeerId={initialPeerId}
          myShelfItems={myShelfItems}
          backendMode={backendMode}
          onOpenAuthModal={onOpenAuthModal}
          onCopyBookToWishlist={onCopyBookToWishlist}
          onUnreadChanged={onUnreadChanged}
          onClose={onClose}
        />
      </div>
    </div>
  );
}
