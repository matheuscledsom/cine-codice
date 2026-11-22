import { Bookmark, BookOpen, Send, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { domainConfig } from '../config/domainConfig';
import { MediaCarousel } from './MediaCarousel';

function formatShortDateTime(isoString) {
  if (!isoString) return '';
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(isoString));
  } catch {
    return '';
  }
}

export function PostDetailModal({
  post,
  profile,
  linkedItem = null,
  onClose,
  onSelectItem,
  onDeletePost,
  onAddComment,
  onDeleteComment,
}) {
  const [commentText, setCommentText] = useState('');

  if (!post) return null;

  const { postModal } = domainConfig.ui.profile;
  const fallbackItem = linkedItem || post.itemSnapshot;

  const handleSubmitComment = (e) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    onAddComment(post.id, commentText);
    setCommentText('');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl border-x border-t border-line bg-card p-5 pb-8 shadow-2xl no-scrollbar"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line" />

        {/* Header estilo Instagram */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-accent bg-app">
              {profile.avatarUrl ? (
                <img
                  src={profile.avatarUrl}
                  alt={profile.displayName}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-xs font-bold text-ink">
                  {profile.avatarInitials || 'AK'}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-ink">
                {profile.handle}
              </p>
              {post.itemTitle && (
                <button
                  type="button"
                  disabled={!linkedItem}
                  onClick={() => {
                    if (!linkedItem) return;
                    onClose();
                    onSelectItem?.(linkedItem);
                  }}
                  className="inline-flex max-w-full items-center gap-1 truncate text-[11px] text-accent hover:underline disabled:no-underline"
                >
                  <BookOpen className="h-3 w-3 shrink-0" />
                  <span className="truncate">{post.itemTitle}</span>
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                onDeletePost(post.id);
                onClose();
              }}
              aria-label={postModal.deletePostLabel}
              title={postModal.deletePostLabel}
              className="rounded-full p-1.5 text-muted hover:bg-rose-500/10 hover:text-rose-400"
            >
              <Trash2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label={domainConfig.ui.detail.closeLabel}
              className="rounded-full p-1.5 text-muted hover:bg-elevated hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Carrossel deslizável */}
        <div className="mt-3.5">
          <MediaCarousel
            media={post.media}
            fallbackItem={fallbackItem}
            aspectClass="aspect-square"
          />
        </div>

        {/* Título e Legenda */}
        <div className="mt-3.5 space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-ink">{post.title}</h3>
            <span className="shrink-0 text-[10px] text-subtle">
              {formatShortDateTime(post.createdAt)}
            </span>
          </div>
          {post.progressMarker && (
            <span className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-accent">
              <Bookmark className="h-2.5 w-2.5" />
              {post.progressMarker}
            </span>
          )}
          {post.caption && (
            <p className="text-xs leading-relaxed text-muted">{post.caption}</p>
          )}
        </div>

        {/* Storyline / Comentários Privados */}
        <div className="mt-5 border-t border-line pt-4">
          <p className="mb-3 text-xs font-semibold text-ink">
            {postModal.commentsTitle}
          </p>

          {(post.comments || []).length === 0 ? (
            <p className="rounded-xl border border-dashed border-line bg-app px-3 py-4 text-center text-[11px] text-subtle">
              {postModal.emptyComments}
            </p>
          ) : (
            <div className="space-y-2.5 border-l border-accent/35 pl-3">
              {post.comments.map((comment) => (
                <div
                  key={comment.id}
                  className="group relative rounded-xl border border-line bg-app px-3 py-2"
                >
                  <span className="absolute -left-[16.5px] top-3 h-2 w-2 rounded-full bg-accent" />
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs leading-relaxed text-ink">
                      {comment.text}
                    </p>
                    <button
                      type="button"
                      onClick={() => onDeleteComment(post.id, comment.id)}
                      aria-label="Remover atualização"
                      className="shrink-0 rounded p-0.5 text-subtle opacity-70 hover:text-rose-400 hover:opacity-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <span className="mt-1 block text-[10px] text-subtle">
                    {formatShortDateTime(comment.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={handleSubmitComment} className="mt-3 flex gap-2">
            <input
              type="text"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder={postModal.commentPlaceholder}
              className="flex-1 rounded-xl border border-line bg-app px-3 py-2 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
            />
            <button
              type="submit"
              disabled={!commentText.trim()}
              aria-label={postModal.commentSubmitLabel}
              className="inline-flex shrink-0 items-center justify-center rounded-xl bg-accent px-3.5 py-2 text-xs font-semibold text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
