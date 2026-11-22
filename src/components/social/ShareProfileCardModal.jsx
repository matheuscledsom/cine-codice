import { Award, BookOpen, Check, Copy, QrCode, Share2, ShieldCheck, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../context/ToastContext';
import {
  buildProfileCardQrSvg,
  buildProfileCardShareUrl,
  decodePublicProfileCard,
  encodePublicProfileCard,
} from '../../services/peerProfileShare';

export function ShareProfileCardModal({
  isOpen,
  onClose,
  profile = {},
  items = [],
  activeTitleName = '',
  streakCount = 0,
}) {
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);

  const shareBundle = useMemo(() => {
    if (!isOpen) return null;
    const token = encodePublicProfileCard({
      profile,
      items,
      titleName: activeTitleName,
      streakCount,
    });
    const shareUrl = buildProfileCardShareUrl(token);
    const decoded = decodePublicProfileCard(token);
    let qr = null;
    try {
      qr = buildProfileCardQrSvg(shareUrl, { size: 224, margin: 2 });
    } catch {
      qr = null;
    }
    return {
      token,
      shareUrl,
      card: decoded.ok ? decoded.card : null,
      qr,
      qrDataUri: qr
        ? `data:image/svg+xml;utf8,${encodeURIComponent(qr.svg)}`
        : '',
    };
  }, [isOpen, profile, items, activeTitleName, streakCount]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !shareBundle) return null;

  const handleCopyLink = async () => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareBundle.shareUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
        showToast({
          message: 'Link do seu Cartão Vivo copiado.',
          type: 'success',
        });
        return;
      }
    } catch {
      // Fallback
    }
    showToast({
      message: 'Copie o link exibido abaixo para compartilhar.',
      type: 'info',
    });
  };

  const handleNativeShare = async () => {
    const title = `${shareBundle.card?.displayName || 'Espectador'} · Cine Códice`;
    const text = shareBundle.card?.currentReading
      ? `Veja minha cinemateca e sessão atual (${shareBundle.card.currentReading.title}) no Cine Códice.`
      : 'Veja meu Cartão de Espectador e indicações no Cine Códice.';

    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title,
          text,
          url: shareBundle.shareUrl,
        });
        return;
      } catch (err) {
        if (err?.name === 'AbortError') return;
      }
    }
    await handleCopyLink();
  };

  const card = shareBundle.card;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Compartilhar Meu Perfil"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-line bg-card p-5 space-y-4 no-scrollbar"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 border-b border-line pb-3">
          <div className="flex items-center gap-2">
            <QrCode className="h-4 w-4 text-accent" strokeWidth={1.5} />
            <div>
              <h2 className="text-sm font-semibold text-ink">
                Compartilhar Meu Perfil
              </h2>
              <p className="text-[11px] text-subtle">
                Funciona via link ou QR Code sem conta e sem servidor
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar janela de compartilhamento"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[4px] text-muted hover:bg-elevated hover:text-ink"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>

        {/* QR Code SVG nativo em área clara para leitura fácil na câmera */}
        <div className="flex flex-col items-center justify-center rounded-[6px] border border-line bg-app p-4 space-y-2.5">
          {shareBundle.qrDataUri ? (
            <div className="rounded-[4px] border border-black/10 bg-white p-3">
              <img
                src={shareBundle.qrDataUri}
                alt={`QR Code do perfil ${card?.handle || ''}`}
                className="h-48 w-48 select-none"
              />
            </div>
          ) : (
            <p className="py-8 text-xs text-muted">
              Não foi possível gerar o QR Code para este tamanho de cartão.
            </p>
          )}
          <p className="text-center text-[11px] text-muted">
            Peça para um amigo apontar a câmera para importar seu cartão na hora.
          </p>
        </div>

        {/* Prévia do conteúdo público incluído */}
        {card && (
          <div className="rounded-[6px] border border-line bg-app p-3.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">
                  {card.displayName}
                </p>
                <p className="truncate text-xs text-subtle tabular-nums">
                  {card.handle}
                </p>
              </div>
              {card.activeTitle && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-[4px] border border-line bg-card px-2 py-0.5 text-[10px] font-medium text-accent">
                  <Award className="h-3 w-3" strokeWidth={1.5} />
                  {card.activeTitle}
                </span>
              )}
            </div>

            <div className="flex flex-wrap gap-3 text-[11px] tabular-nums text-muted">
              <span>{card.stats.booksCount} obras</span>
              <span>{card.stats.completedCount} concluídas</span>
              <span>{card.topRatedWorks.length} notas</span>
              <span>{card.publicQuotes.length} falas</span>
            </div>

            {card.currentReading && (
              <p className="flex items-center gap-1.5 text-[11px] text-ink">
                <BookOpen className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.5} />
                <span className="truncate">
                  Assistindo: <strong>{card.currentReading.title}</strong> ({card.currentReading.progressPct}%)
                </span>
              </p>
            )}
          </div>
        )}

        <div className="flex items-start gap-2 rounded-[4px] border border-line bg-app px-3 py-2 text-[11px] text-muted">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.5} />
          <span>
            Apenas dados públicos de leitura vão no link. Chaves de IA e arquivos privados nunca são incluídos.
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleNativeShare}
            className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-[4px] bg-accent px-4 py-2 text-xs font-semibold text-accent-ink transition-opacity hover:opacity-90"
          >
            <Share2 className="h-4 w-4" strokeWidth={1.5} />
            <span>Enviar Link do Meu Perfil</span>
          </button>

          <button
            type="button"
            onClick={handleCopyLink}
            aria-label="Copiar link do meu perfil"
            className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-[4px] border border-line bg-app px-3.5 py-2 text-xs font-medium text-ink hover:border-accent"
          >
            {copied ? (
              <Check className="h-4 w-4 text-accent" strokeWidth={1.5} />
            ) : (
              <Copy className="h-4 w-4 text-accent" strokeWidth={1.5} />
            )}
            <span>{copied ? 'Copiado' : 'Copiar'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
