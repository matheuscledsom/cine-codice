import { Award, MessageSquare, Pin, Send, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '../../context/ToastContext';
import {
  createWallPost,
  deleteWallPost,
  listWallPosts,
  MAX_SOCIAL_MESSAGE_CHARS,
  togglePinWallPost,
} from '../../services/codiceBackend';

function formatWallDateTime(iso) {
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

export function ProfileWall({
  profileId,
  viewerId = null,
  isOwner = false,
  canPostWall = true,
  allowWallPosts = true,
  onSelectAuthor,
  onWallMutated,
}) {
  const { showToast } = useToast();
  const [posts, setPosts] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const sendingRef = useRef(false);

  const loadPosts = useCallback(async () => {
    if (!profileId) return;
    setIsLoading(true);
    try {
      const list = await listWallPosts(profileId, { viewerId });
      setPosts(list);
    } catch {
      setPosts([]);
    } finally {
      setIsLoading(false);
    }
  }, [profileId, viewerId]);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (sendingRef.current) return;
    const clean = draft.trim();
    if (!clean) return;
    if (clean.length > MAX_SOCIAL_MESSAGE_CHARS) {
      showToast({
        message: `Limite máximo de ${MAX_SOCIAL_MESSAGE_CHARS} caracteres no mural.`,
        type: 'error',
      });
      return;
    }
    sendingRef.current = true;
    setSubmitting(true);
    try {
      await createWallPost(profileId, clean, { viewerId });
      setDraft('');
      await loadPosts();
      onWallMutated?.();
      showToast({ message: 'Recado publicado no mural.', type: 'success' });
    } catch (err) {
      showToast({
        message: err?.userMessage || err?.message || 'Erro ao publicar recado.',
        type: 'error',
      });
    } finally {
      sendingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleTogglePin = async (postId) => {
    try {
      await togglePinWallPost(postId, { viewerId });
      await loadPosts();
    } catch (err) {
      showToast({
        message: err?.userMessage || 'Não foi possível fixar o recado.',
        type: 'error',
      });
    }
  };

  const handleDelete = async (postId) => {
    try {
      await deleteWallPost(postId, { viewerId });
      await loadPosts();
      onWallMutated?.();
    } catch (err) {
      showToast({
        message: err?.userMessage || 'Não foi possível excluir o recado.',
        type: 'error',
      });
    }
  };

  return (
    <section aria-label="Mural de Recados da Cinemateca" className="space-y-3">
      {!allowWallPosts && !isOwner ? (
        <div className="rounded-[4px] border border-line bg-app px-4 py-4 text-center text-xs text-muted">
          Este espectador desativou novos recados no mural.
        </div>
      ) : canPostWall ? (
        <form onSubmit={handleSubmit} className="space-y-2">
          <textarea
            rows={2}
            value={draft}
            maxLength={MAX_SOCIAL_MESSAGE_CHARS}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Deixe uma recomendação de filme, série, anime ou recado..."
            className="w-full resize-none rounded-[4px] border border-line bg-app px-3 py-2 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] tabular-nums text-muted">
              {draft.length >= 1500 ? `${draft.length}/${MAX_SOCIAL_MESSAGE_CHARS}` : ''}
            </span>
            <button
              type="submit"
              disabled={submitting || !draft.trim()}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[4px] bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Send className="h-3.5 w-3.5" strokeWidth={1.5} />
              <span>{submitting ? 'Enviando...' : 'Escrever no mural'}</span>
            </button>
          </div>
        </form>
      ) : null}

      {isLoading ? (
        <div className="h-16 rounded-[4px] border border-line bg-app opacity-50" />
      ) : posts.length === 0 ? (
        <div className="rounded-[4px] border border-line bg-app px-4 py-7 text-center space-y-1">
          <MessageSquare
            className="mx-auto h-5 w-5 text-subtle"
            strokeWidth={1.5}
          />
          <p className="text-xs font-medium text-ink">Mural sem recados ainda</p>
          <p className="text-[11px] text-muted">
            Recomendações e notas de outros leitores aparecerão aqui com identificação de autor.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-line rounded-[6px] border border-line bg-app">
          {posts.map((post) => {
            const canDelete =
              isOwner || (viewerId && post.authorId === viewerId);
            return (
              <article key={post.id} className="p-3 space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-card text-[10px] font-semibold text-accent">
                      {post.authorAvatarUrl ? (
                        <img
                          src={post.authorAvatarUrl}
                          alt={post.authorDisplayName}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        post.authorAvatarInitials || 'LC'
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-xs font-semibold text-ink">
                          {post.authorDisplayName}
                        </span>
                        <button
                          type="button"
                          onClick={() => onSelectAuthor?.(post.authorId)}
                          className="truncate text-[11px] font-medium text-accent hover:underline"
                        >
                          {post.authorHandle}
                        </button>
                        {post.authorActiveTitleBadge && (
                          <span className="inline-flex items-center gap-1 rounded-[4px] border border-line bg-card px-1.5 py-0.5 text-[10px] text-muted">
                            <Award className="h-2.5 w-2.5 text-accent" strokeWidth={1.5} />
                            {post.authorActiveTitleBadge}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] tabular-nums text-subtle">
                        {formatWallDateTime(post.createdAt)}
                        {post.pinned ? ' · Fixado no topo' : ''}
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    {isOwner && (
                      <button
                        type="button"
                        onClick={() => handleTogglePin(post.id)}
                        aria-label={post.pinned ? 'Desafixar recado' : 'Fixar recado'}
                        title={post.pinned ? 'Desafixar' : 'Fixar no topo'}
                        className={`flex min-h-[34px] min-w-[34px] items-center justify-center rounded-[4px] border transition-colors ${
                          post.pinned
                            ? 'border-accent text-accent'
                            : 'border-line text-muted hover:text-ink'
                        }`}
                      >
                        <Pin className="h-3.5 w-3.5" strokeWidth={1.5} />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => handleDelete(post.id)}
                        aria-label="Excluir recado do mural"
                        className="flex min-h-[34px] min-w-[34px] items-center justify-center rounded-[4px] border border-line text-muted transition-colors hover:border-rose-500/40 hover:text-rose-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                      </button>
                    )}
                  </div>
                </div>

                <p className="text-xs leading-relaxed text-ink whitespace-pre-wrap">
                  {post.content}
                </p>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
