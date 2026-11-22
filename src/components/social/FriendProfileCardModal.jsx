import {
  Award,
  BookmarkPlus,
  BookOpen,
  Check,
  Quote,
  Star,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';
import { useEffect } from 'react';
import { getWorkTypeConfig } from '../../config/domainConfig';

export function FriendProfileCardModal({
  isOpen,
  card,
  isAlreadySaved = false,
  onClose,
  onSaveFriend,
  onCopyBookToWishlist,
}) {
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !card) return null;

  const stats = card.stats || {};
  const topWorks = Array.isArray(card.topRatedWorks) ? card.topRatedWorks : [];
  const quotes = Array.isArray(card.publicQuotes) ? card.publicQuotes : [];

  const handleCopyWork = (work) => {
    if (!work?.title) return;
    onCopyBookToWishlist?.({
      id: work.id,
      title: work.title,
      author: work.author || '',
      workType: work.workType || 'book',
      releaseYear: work.releaseYear || null,
      rating: work.rating ?? null,
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Cartão de Perfil de ${card.displayName || card.handle}`}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-line bg-card p-5 space-y-4 no-scrollbar"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line pb-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-line bg-app text-sm font-serif font-semibold text-accent">
              {card.avatarInitials || 'LC'}
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-subtle">
                Cartão de Perfil do Amigo
              </p>
              <h2 className="truncate text-base font-semibold text-ink">
                {card.displayName}
              </h2>
              <p className="truncate text-xs tabular-nums text-muted">
                {card.userTag || card.handle}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar cartão do amigo"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[4px] text-muted hover:bg-elevated hover:text-ink"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>

        {(card.activeTitle || card.bio) && (
          <div className="space-y-1.5">
            {card.activeTitle && (
              <span className="inline-flex items-center gap-1 rounded-[4px] border border-line bg-app px-2 py-0.5 text-[11px] font-medium text-accent">
                <Award className="h-3 w-3" strokeWidth={1.5} />
                {card.activeTitle}
              </span>
            )}
            {card.bio && (
              <p className="text-xs leading-relaxed text-muted">{card.bio}</p>
            )}
          </div>
        )}

        <div className="grid grid-cols-4 gap-2 text-center">
          {[
            { label: 'Obras', val: stats.booksCount || 0 },
            { label: 'Concluídas', val: stats.completedCount || 0 },
            { label: 'Horas', val: stats.hoursWatched ?? stats.pagesRead ?? 0 },
            { label: 'Sequência', val: stats.streakCount || 0 },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-[4px] border border-line bg-app px-2 py-2"
            >
              <span className="block text-sm font-semibold tabular-nums text-ink">
                {stat.val}
              </span>
              <span className="block text-[10px] text-subtle">{stat.label}</span>
            </div>
          ))}
        </div>

        {card.currentReading && (
          <section className="rounded-[6px] border border-accent/35 bg-app p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-accent">
                <BookOpen className="h-3.5 w-3.5" strokeWidth={1.5} />
                Assistindo Agora
              </span>
              <span className="text-[11px] font-semibold tabular-nums text-ink">
                {card.currentReading.progressPct || 0}%
              </span>
            </div>
            <div>
              <p className="text-xs font-semibold text-ink">
                {card.currentReading.title}
              </p>
              {card.currentReading.author && (
                <p className="text-[11px] text-muted">
                  {card.currentReading.author}
                </p>
              )}
            </div>
            <div className="h-1 w-full overflow-hidden rounded-[2px] bg-line">
              <div
                className="h-full"
                style={{
                  width: `${card.currentReading.progressPct || 0}%`,
                  backgroundColor: 'var(--accent-color)',
                }}
              />
            </div>
            <button
              type="button"
              onClick={() => handleCopyWork(card.currentReading)}
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-[4px] border border-line bg-card px-3 py-1.5 text-xs font-medium text-ink hover:border-accent hover:text-accent"
            >
              <BookmarkPlus className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
              <span>Adicionar à Fila Quero Ver</span>
            </button>
          </section>
        )}

        {topWorks.length > 0 && (
          <section className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold text-ink">
              <Star className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
              Últimas Obras Avaliadas
            </h3>
            <div className="divide-y divide-line rounded-[6px] border border-line bg-app">
              {topWorks.map((work) => (
                <div
                  key={work.id}
                  className="flex items-center justify-between gap-2 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-ink">
                      {work.title}
                    </p>
                    <p className="truncate text-[11px] text-subtle">
                      {work.author || getWorkTypeConfig(work.workType).shortLabel}
                      {work.rating !== null ? ` · Nota ${work.rating}/100` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopyWork(work)}
                    aria-label={`Copiar ${work.title} para Lista de Desejos`}
                    className="inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-[4px] border border-line bg-card px-2.5 py-1.5 text-[11px] font-medium text-ink hover:border-accent hover:text-accent"
                  >
                    <BookmarkPlus className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                    <span>Desejos</span>
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {quotes.length > 0 && (
          <section className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold text-ink">
              <Quote className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
              Citações Públicas
            </h3>
            <div className="space-y-2">
              {quotes.map((q, idx) => (
                <blockquote
                  key={`${q.workTitle}-${idx}`}
                  className="rounded-[4px] border border-line bg-app p-3 text-xs text-muted"
                >
                  <p className="leading-relaxed text-ink">"{q.text}"</p>
                  {q.workTitle && (
                    <footer className="mt-1 text-[10px] text-subtle">
                      — {q.workTitle}
                      {q.location ? ` (${q.location})` : ''}
                    </footer>
                  )}
                </blockquote>
              ))}
            </div>
          </section>
        )}

        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          <button
            type="button"
            onClick={() => onSaveFriend?.(card)}
            className={`inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-[4px] border px-4 py-2 text-xs font-semibold transition-colors ${
              isAlreadySaved
                ? 'border-accent/50 bg-accent/15 text-accent'
                : 'border-accent bg-accent text-accent-ink hover:opacity-90'
            }`}
          >
            {isAlreadySaved ? (
              <>
                <UserCheck className="h-4 w-4" strokeWidth={1.5} />
                <span>Amigo Salvo na Rede</span>
              </>
            ) : (
              <>
                <UserPlus className="h-4 w-4" strokeWidth={1.5} />
                <span>Salvar Amigo na Minha Rede</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-[44px] items-center justify-center gap-1 rounded-[4px] border border-line bg-app px-3.5 py-2 text-xs font-medium text-ink hover:border-accent"
          >
            <Check className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
            <span>Fechar</span>
          </button>
        </div>
      </div>
    </div>
  );
}
