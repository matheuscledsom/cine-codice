import {
  Award,
  BookmarkPlus,
  BookOpen,
  Clock,
  Lock,
  MessagesSquare,
  Star,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useToast } from '../../context/ToastContext';
import {
  followReader,
  getReaderProfileBundle,
  unfollowReader,
} from '../../services/codiceBackend';
import { CoverArt } from '../CoverArt';
import { ProfileWall } from './ProfileWall';

function computeReadingProgress(item) {
  const total = Number(item?.totalPages || 0);
  const current = Number(item?.currentPage || 0);
  if (total > 0 && current >= 0) {
    return Math.min(100, Math.max(0, Math.round((current / total) * 100)));
  }
  const pct = Number(item?.progress || 0);
  if (!Number.isNaN(pct) && pct > 0) {
    return Math.min(100, Math.max(0, Math.round(pct)));
  }
  return 0;
}

export function UserProfileModal({
  isOpen,
  profileId,
  viewerId = null,
  onClose,
  onOpenDirectChat,
  onCopyBookToWishlist,
  onSelectPeerProfile,
  onFollowChanged,
}) {
  const { showToast } = useToast();
  const [bundle, setBundle] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isFollowBusy, setIsFollowBusy] = useState(false);

  const loadBundle = useCallback(async () => {
    if (!isOpen || !profileId) return;
    setIsLoading(true);
    setErrorMsg('');
    try {
      const data = await getReaderProfileBundle(profileId, { viewerId });
      setBundle(data);
    } catch (err) {
      setBundle(null);
      setErrorMsg(
        err?.userMessage || err?.message || 'Não foi possível carregar este perfil.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [isOpen, profileId, viewerId]);

  useEffect(() => {
    loadBundle();
  }, [loadBundle]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleToggleFollow = async () => {
    if (!bundle?.profile?.id || isFollowBusy) return;
    setIsFollowBusy(true);
    try {
      if (bundle.followStatus === 'approved' || bundle.followStatus === 'pending') {
        await unfollowReader(bundle.profile.id, { viewerId });
        showToast({ message: 'Você deixou de seguir este leitor.', type: 'info' });
      } else {
        const rel = await followReader(bundle.profile.id, { viewerId });
        showToast({
          message:
            rel?.status === 'pending'
              ? 'Solicitação enviada para aprovação.'
              : 'Agora você segue este leitor.',
          type: 'success',
        });
      }
      await loadBundle();
      onFollowChanged?.();
    } catch (err) {
      showToast({
        message: err?.userMessage || 'Não foi possível atualizar vínculo.',
        type: 'error',
      });
    } finally {
      setIsFollowBusy(false);
    }
  };

  const handleCopyWishlist = (work) => {
    if (!work) return;
    onCopyBookToWishlist?.(work);
  };

  const profile = bundle?.profile || null;
  const permissions = bundle?.permissions || {};

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={profile ? `Perfil de ${profile.displayName || profile.handle}` : 'Perfil do leitor'}
    >
      <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto bg-panel border border-line rounded-t-[6px] sm:rounded-[6px] flex flex-col">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-4 py-3 bg-panel border-b border-line">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wider text-muted font-medium">
              Ficha de Leitor
            </p>
            <h2 className="text-base font-serif font-semibold text-ink truncate">
              {profile ? profile.displayName || profile.handle : 'Carregando...'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar ficha do leitor"
            className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-[4px] border border-line text-muted hover:text-ink transition-colors"
          >
            <X className="w-4 h-4" strokeWidth={1.5} />
          </button>
        </div>

        <div className="p-4 space-y-6">
          {isLoading && (
            <div className="py-12 text-center text-sm text-muted">
              Carregando perfil e acervo...
            </div>
          )}

          {!isLoading && errorMsg && (
            <div className="p-4 border border-line rounded-[4px] bg-surface text-sm text-ink">
              {errorMsg}
            </div>
          )}

          {!isLoading && !errorMsg && bundle && profile && (
            <>
              {/* Identidade do Leitor */}
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-5 border-b border-line">
                <div className="flex items-start gap-3 min-w-0">
                  {profile.avatarUrl ? (
                    <img
                      src={profile.avatarUrl}
                      alt={profile.displayName || profile.handle}
                      className="w-14 h-14 rounded-[4px] object-cover border border-line shrink-0"
                    />
                  ) : (
                    <div className="w-14 h-14 rounded-[4px] border border-line bg-surface flex items-center justify-center text-sm font-serif font-semibold text-ink shrink-0">
                      {profile.avatarInitials ||
                        String(profile.displayName || profile.handle || 'LC')
                          .slice(0, 2)
                          .toUpperCase()}
                    </div>
                  )}

                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-serif font-semibold text-ink">
                        {profile.displayName || profile.handle}
                      </h3>
                      <span className="text-xs text-muted tabular-nums">
                        {profile.handle}
                      </span>
                    </div>

                    {profile.gamificationEnabled !== false && bundle.resolvedBadgeName && (
                      <div className="inline-flex items-center gap-1.5 text-xs font-medium text-accent">
                        <Award className="w-3.5 h-3.5" strokeWidth={1.5} />
                        <span>{bundle.resolvedBadgeName}</span>
                      </div>
                    )}

                    {profile.bio && (
                      <p className="text-xs text-muted leading-relaxed pt-1">
                        {profile.bio}
                      </p>
                    )}

                    <div className="flex items-center gap-4 pt-1 text-xs text-muted tabular-nums">
                      <span>
                        <strong className="text-ink font-medium">
                          {bundle.followerCount}
                        </strong>{' '}
                        seguidores
                      </span>
                      <span>
                        <strong className="text-ink font-medium">
                          {bundle.followingCount}
                        </strong>{' '}
                        seguindo
                      </span>
                    </div>
                  </div>
                </div>

                {!permissions.isOwner && (
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {permissions.canFollow && (
                      <button
                        type="button"
                        onClick={handleToggleFollow}
                        disabled={isFollowBusy}
                        className={`min-h-[44px] px-3.5 py-2 rounded-[4px] border text-xs font-medium inline-flex items-center gap-1.5 transition-colors ${
                          bundle.followStatus === 'approved'
                            ? 'border-accent text-accent bg-accent/5'
                            : bundle.followStatus === 'pending'
                            ? 'border-line text-muted bg-surface'
                            : 'border-accent bg-accent text-white'
                        }`}
                      >
                        {bundle.followStatus === 'approved' ? (
                          <>
                            <UserCheck className="w-4 h-4" strokeWidth={1.5} />
                            <span>Seguindo</span>
                          </>
                        ) : bundle.followStatus === 'pending' ? (
                          <>
                            <Clock className="w-4 h-4" strokeWidth={1.5} />
                            <span>Solicitado</span>
                          </>
                        ) : (
                          <>
                            <UserPlus className="w-4 h-4" strokeWidth={1.5} />
                            <span>Seguir</span>
                          </>
                        )}
                      </button>
                    )}

                    {permissions.canSendDm && onOpenDirectChat && (
                      <button
                        type="button"
                        onClick={() => onOpenDirectChat(profile.id)}
                        className="min-h-[44px] px-3.5 py-2 rounded-[4px] border border-line bg-surface text-xs font-medium text-ink hover:border-accent hover:text-accent inline-flex items-center gap-1.5 transition-colors"
                      >
                        <MessagesSquare className="w-4 h-4" strokeWidth={1.5} />
                        <span>Mensagem</span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              {bundle.restricted ? (
                <div className="p-6 border border-line rounded-[4px] bg-surface flex flex-col items-center text-center gap-2">
                  <Lock className="w-5 h-5 text-muted" strokeWidth={1.5} />
                  <p className="text-sm font-medium text-ink">
                    {bundle.reason || 'Acesso restrito a este acervo.'}
                  </p>
                  <p className="text-xs text-muted max-w-sm">
                    Respeitamos as preferências de privacidade deste leitor.
                  </p>
                </div>
              ) : (
                <>
                  {/* Lendo Agora */}
                  <section className="space-y-3 pb-5 border-b border-line">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-medium uppercase tracking-wider text-muted flex items-center gap-1.5">
                        <BookOpen className="w-4 h-4" strokeWidth={1.5} />
                        <span>Lendo Agora</span>
                      </h4>
                      <span className="text-xs text-muted tabular-nums">
                        {bundle.readingNow.length}{' '}
                        {bundle.readingNow.length === 1 ? 'obra' : 'obras'}
                      </span>
                    </div>

                    {bundle.readingNow.length === 0 ? (
                      <p className="text-xs text-muted py-2">
                        Nenhuma leitura em andamento registrada no momento.
                      </p>
                    ) : (
                      <div className="divide-y divide-line border border-line rounded-[4px] bg-surface">
                        {bundle.readingNow.map((work) => {
                          const pct = computeReadingProgress(work);
                          return (
                            <div
                              key={work.id}
                              className="p-3 flex items-center gap-3"
                            >
                              <div className="w-10 h-14 shrink-0 rounded-[2px] overflow-hidden border border-line">
                                <CoverArt item={work} compact />
                              </div>
                              <div className="min-w-0 flex-1 space-y-1.5">
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-ink truncate">
                                    {work.title}
                                  </p>
                                  {work.originalTitle &&
                                    work.originalTitle.trim().toLowerCase() !==
                                      String(work.title || '').trim().toLowerCase() && (
                                      <p className="text-[11px] text-muted truncate italic">
                                        {work.originalTitle}
                                      </p>
                                    )}
                                  <p className="text-xs text-muted truncate">
                                    {work.creator || work.author || 'Autor não informado'}
                                  </p>
                                </div>
                                <div className="space-y-1">
                                  <div className="h-[2px] w-full bg-line overflow-hidden">
                                    <div
                                      className="h-full bg-accent transition-all"
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                  <div className="flex items-center justify-between text-[11px] text-muted tabular-nums">
                                    <span>
                                      {work.totalPages
                                        ? `p. ${work.currentPage || 0} de ${work.totalPages}`
                                        : 'Em andamento'}
                                    </span>
                                    <span className="text-accent font-medium">{pct}%</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>

                  {/* Últimas Avaliações */}
                  <section className="space-y-3 pb-5 border-b border-line">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-medium uppercase tracking-wider text-muted flex items-center gap-1.5">
                        <Star className="w-4 h-4" strokeWidth={1.5} />
                        <span>Últimas Avaliações</span>
                      </h4>
                      <span className="text-xs text-muted tabular-nums">
                        {bundle.latestReviews.length}
                      </span>
                    </div>

                    {bundle.latestReviews.length === 0 ? (
                      <p className="text-xs text-muted py-2">
                        Nenhuma resenha ou nota pública ainda.
                      </p>
                    ) : (
                      <div className="divide-y divide-line border border-line rounded-[4px] bg-surface">
                        {bundle.latestReviews.map((rev) => (
                          <div key={rev.id} className="p-3 space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-medium text-ink truncate">
                                {rev.title}
                              </p>
                              {typeof rev.rating === 'number' && (
                                <span className="text-xs font-medium text-accent tabular-nums inline-flex items-center gap-1 shrink-0">
                                  <Star className="w-3.5 h-3.5" strokeWidth={1.5} />
                                  {rev.rating.toFixed(1)}
                                </span>
                              )}
                            </div>
                            {rev.verdict && (
                              <p className="text-[11px] uppercase tracking-wider text-muted">
                                {rev.verdict}
                              </p>
                            )}
                            {rev.notes && (
                              <p className="text-xs text-muted leading-relaxed">
                                {rev.notes}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  {/* Estante Pública */}
                  <section className="space-y-3 pb-5 border-b border-line">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-medium uppercase tracking-wider text-muted">
                        Estante Pública
                      </h4>
                      <span className="text-xs text-muted tabular-nums">
                        {bundle.publicShelf.length}{' '}
                        {bundle.publicShelf.length === 1 ? 'título' : 'títulos'}
                      </span>
                    </div>

                    {bundle.publicShelf.length === 0 ? (
                      <p className="text-xs text-muted py-2">
                        Esta estante ainda está vazia.
                      </p>
                    ) : (
                      <div className="divide-y divide-line border border-line rounded-[4px] bg-surface max-h-72 overflow-y-auto">
                        {bundle.publicShelf.map((work) => (
                          <div
                            key={work.id}
                            className="p-2.5 flex items-center justify-between gap-3"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="w-8 h-12 shrink-0 rounded-[2px] overflow-hidden border border-line">
                                <CoverArt item={work} compact />
                              </div>
                              <div className="min-w-0">
                                <p className="text-xs font-medium text-ink truncate">
                                  {work.title}
                                </p>
                                <p className="text-[11px] text-muted truncate">
                                  {work.creator || work.author || 'Sem autor'}
                                </p>
                              </div>
                            </div>

                            {!permissions.isOwner && onCopyBookToWishlist && (
                              <button
                                type="button"
                                onClick={() => handleCopyWishlist(work)}
                                className="min-h-[44px] px-2.5 py-1.5 rounded-[4px] border border-line text-[11px] font-medium text-ink hover:border-accent hover:text-accent inline-flex items-center gap-1 shrink-0 transition-colors"
                              >
                                <BookmarkPlus className="w-3.5 h-3.5" strokeWidth={1.5} />
                                <span>Copiar para Lista de Desejos</span>
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  {/* Mural */}
                  <section className="space-y-3">
                    <ProfileWall
                      profileId={profile.id}
                      viewerId={viewerId}
                      isOwner={Boolean(permissions.isOwner)}
                      canPostWall={Boolean(permissions.canPostWall)}
                      allowWallPosts={profile.allowWallPosts !== false}
                      onSelectAuthor={(authorId) => onSelectPeerProfile?.(authorId)}
                      onWallMutated={loadBundle}
                    />
                  </section>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
