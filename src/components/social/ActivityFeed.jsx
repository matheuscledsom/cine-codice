import { Award, BookOpen, Heart, MessageCircle, Send, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useToast } from '../../context/ToastContext';
import {
  MAX_SOCIAL_MESSAGE_CHARS,
  addSocialComment,
  deleteSocialComment,
  listActivityFeed,
  togglePostReaction,
} from '../../services/codiceBackend';

const PAGE_SIZE = 20;

function formatActivityDate(iso) {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ActivityFeed({
  viewerId = null,
  onSelectProfile,
}) {
  const { showToast } = useToast();
  const [feed, setFeed] = useState([]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedComments, setExpandedComments] = useState({});
  const [commentDrafts, setCommentDrafts] = useState({});

  const refreshFeed = useCallback(async () => {
    setIsLoading(true);
    try {
      const rows = await listActivityFeed({ viewerId });
      setFeed(rows);
    } catch {
      setFeed([]);
    } finally {
      setIsLoading(false);
    }
  }, [viewerId]);

  useEffect(() => {
    refreshFeed();
  }, [refreshFeed]);

  const handleToggleLike = async (item) => {
    const res = await togglePostReaction({
      targetType: 'journal',
      targetId: item.id,
      viewerId,
    });
    setFeed((prev) =>
      prev.map((row) =>
        row.id === item.id
          ? { ...row, viewerLiked: res.liked, likesCount: res.count }
          : row
      )
    );
  };

  const handleAddComment = async (item) => {
    const text = String(commentDrafts[item.id] || '').trim();
    if (!text) return;
    try {
      const saved = await addSocialComment({
        targetType: 'journal',
        targetId: item.id,
        content: text,
        ownerProfileId: item.ownerId,
        viewerId,
      });
      setCommentDrafts((prev) => ({ ...prev, [item.id]: '' }));
      setFeed((prev) =>
        prev.map((row) =>
          row.id === item.id
            ? { ...row, comments: [...(row.comments || []), saved] }
            : row
        )
      );
    } catch (err) {
      showToast({
        message: err?.userMessage || 'Não foi possível enviar o comentário.',
        type: 'error',
      });
    }
  };

  const handleDeleteComment = async (itemId, commentId) => {
    try {
      await deleteSocialComment(commentId, { viewerId });
      setFeed((prev) =>
        prev.map((row) =>
          row.id === itemId
            ? {
                ...row,
                comments: (row.comments || []).filter((c) => c.id !== commentId),
              }
            : row
        )
      );
    } catch (err) {
      showToast({
        message: err?.userMessage || 'Não foi possível excluir.',
        type: 'error',
      });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-2.5" aria-busy="true">
        {[1, 2].map((k) => (
          <div
            key={k}
            className="h-28 rounded-[6px] border border-line bg-card opacity-50"
          />
        ))}
      </div>
    );
  }

  if (feed.length === 0) {
    return (
      <div className="rounded-[6px] border border-line bg-card px-5 py-10 text-center space-y-2">
        <BookOpen className="mx-auto h-5 w-5 text-subtle" strokeWidth={1.5} />
        <p className="text-xs font-semibold text-ink">
          Sem atividades recentes no feed
        </p>
        <p className="text-[11px] text-muted">
          Siga leitores na aba Explorar ou publique notas no seu Diário para acompanhar aqui.
        </p>
      </div>
    );
  }

  const visibleFeed = feed.slice(0, visibleCount);
  const remainingCount = Math.max(0, feed.length - visibleFeed.length);

  return (
    <div className="space-y-3">
      {visibleFeed.map((entry) => {
        const owner = entry.ownerProfile || {};
        const commentsOpen = Boolean(expandedComments[entry.id]);
        const commentList = entry.comments || [];

        return (
          <article
            key={entry.id}
            className="rounded-[6px] border border-line bg-card p-3.5 space-y-2.5"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-app text-[11px] font-semibold text-accent">
                  {owner.avatarUrl ? (
                    <img
                      src={owner.avatarUrl}
                      alt={owner.displayName}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    owner.avatarInitials || 'LC'
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-xs font-semibold text-ink">
                      {owner.displayName}
                    </span>
                    <button
                      type="button"
                      onClick={() => onSelectProfile?.(owner.id)}
                      className="truncate text-[11px] font-medium text-accent hover:underline"
                    >
                      {owner.handle}
                    </button>
                    {owner.gamificationEnabled !== false && owner.resolvedBadgeName && (
                      <span className="inline-flex items-center gap-1 rounded-[4px] border border-line bg-app px-1.5 py-0.5 text-[10px] text-muted">
                        <Award className="h-2.5 w-2.5 text-accent" strokeWidth={1.5} />
                        {owner.resolvedBadgeName}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] tabular-nums text-subtle">
                    {formatActivityDate(entry.createdAt)}
                    {entry.itemTitle ? ` · ${entry.itemTitle}` : ''}
                    {entry.progressMarker ? ` · ${entry.progressMarker}` : ''}
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <h3 className="text-xs font-semibold text-ink">{entry.title}</h3>
              {entry.caption && (
                <p className="text-xs leading-relaxed text-muted whitespace-pre-wrap">
                  {entry.caption}
                </p>
              )}
            </div>

            <div className="flex items-center gap-2 border-t border-line pt-2">
              <button
                type="button"
                onClick={() => handleToggleLike(entry)}
                aria-pressed={entry.viewerLiked}
                className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-[4px] border px-2.5 text-[11px] font-medium tabular-nums transition-colors ${
                  entry.viewerLiked
                    ? 'border-accent bg-accent/15 text-accent'
                    : 'border-line bg-app text-muted hover:text-ink'
                }`}
              >
                <Heart
                  className={`h-3.5 w-3.5 ${entry.viewerLiked ? 'fill-current' : ''}`}
                  strokeWidth={1.5}
                />
                <span>{entry.likesCount || 0}</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  setExpandedComments((prev) => ({
                    ...prev,
                    [entry.id]: !commentsOpen,
                  }))
                }
                aria-expanded={commentsOpen}
                className="inline-flex min-h-[34px] items-center gap-1.5 rounded-[4px] border border-line bg-app px-2.5 text-[11px] font-medium tabular-nums text-muted hover:border-accent hover:text-ink"
              >
                <MessageCircle className="h-3.5 w-3.5" strokeWidth={1.5} />
                <span>{commentList.length} Comentários</span>
              </button>
            </div>

            {commentsOpen && (
              <div className="space-y-2 border-t border-line pt-2.5">
                {commentList.length === 0 ? (
                  <p className="text-[11px] text-subtle">
                    Nenhum comentário ainda.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {commentList.map((c) => {
                      const canDel =
                        viewerId &&
                        (c.authorId === viewerId || entry.ownerId === viewerId);
                      return (
                        <div
                          key={c.id}
                          className="flex items-start justify-between gap-2 rounded-[4px] border border-line bg-app px-2.5 py-2"
                        >
                          <div className="min-w-0">
                            <p className="text-[11px]">
                              <button
                                type="button"
                                onClick={() => onSelectProfile?.(c.authorId)}
                                className="font-semibold text-accent hover:underline"
                              >
                                {c.authorHandle}
                              </button>{' '}
                              <span className="text-ink">{c.content}</span>
                            </p>
                            <p className="text-[10px] tabular-nums text-subtle">
                              {formatActivityDate(c.createdAt)}
                            </p>
                          </div>
                          {canDel && (
                            <button
                              type="button"
                              onClick={() => handleDeleteComment(entry.id, c.id)}
                              aria-label="Excluir comentário"
                              className="p-1 text-subtle hover:text-rose-400"
                            >
                              <Trash2 className="h-3 w-3" strokeWidth={1.5} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {entry.allowComments ? (
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      maxLength={MAX_SOCIAL_MESSAGE_CHARS}
                      value={commentDrafts[entry.id] || ''}
                      onChange={(e) =>
                        setCommentDrafts((prev) => ({
                          ...prev,
                          [entry.id]: e.target.value,
                        }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddComment(entry);
                        }
                      }}
                      placeholder="Escrever comentário..."
                      className="min-h-[44px] flex-1 rounded-[4px] border border-line bg-app px-2.5 py-1.5 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => handleAddComment(entry)}
                      aria-label="Enviar comentário"
                      className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[4px] bg-accent px-2.5 text-accent-ink"
                    >
                      <Send className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </button>
                  </div>
                ) : (
                  <p className="text-[11px] text-subtle">
                    Comentários restritos neste perfil.
                  </p>
                )}
              </div>
            )}
          </article>
        );
      })}

      {remainingCount > 0 && (
        <button
          type="button"
          onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
          className="min-h-[44px] w-full rounded-[4px] border border-line bg-card py-2 text-xs font-medium text-ink hover:border-accent hover:text-accent tabular-nums"
        >
          Carregar mais ({remainingCount} restantes)
        </button>
      )}
    </div>
  );
}
