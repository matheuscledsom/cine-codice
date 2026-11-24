import { ImageDown, Sparkles, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { VectorIcon } from './VectorIcon';
import { domainConfig, getDomainMeta } from '../config/domainConfig';
import { buildWrappedSummary } from '../utils/wrappedStats';

export async function generateWrappedCardPng(summary, readerName = 'Curador OmniPrism') {
  if (typeof document === 'undefined' || !summary) return false;
  const rootStyle = getComputedStyle(document.documentElement);
  const bgApp = rootStyle.getPropertyValue('--bg-app').trim() || '#09090B';
  const bgCard = rootStyle.getPropertyValue('--bg-card').trim() || '#141417';
  const borderSubtle = rootStyle.getPropertyValue('--border-subtle').trim() || '#27272A';
  const textPrimary = rootStyle.getPropertyValue('--text-primary').trim() || '#FAFAFA';
  const textMuted = rootStyle.getPropertyValue('--text-muted').trim() || '#A1A1AA';
  const accentColor = rootStyle.getPropertyValue('--accent-color').trim() || '#8B5CF6';
  const fontFamily =
    rootStyle.getPropertyValue('--font-app').trim() || '"Newsreader Variable", Georgia, serif';

  const WIDTH = 1080;
  const HEIGHT = 1350;
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = bgApp;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = bgCard;
  ctx.fillRect(64, 64, WIDTH - 128, HEIGHT - 128);
  ctx.strokeStyle = borderSubtle;
  ctx.lineWidth = 2;
  ctx.strokeRect(64, 64, WIDTH - 128, HEIGHT - 128);

  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 3;
  ctx.strokeRect(86, 86, WIDTH - 172, HEIGHT - 172);

  const LEFT = 132;
  ctx.fillStyle = accentColor;
  ctx.font = `700 22px ${fontFamily}`;
  ctx.fillText(summary.brandTitle || 'OMNI WRAPPED · OMNIPRISM', LEFT, 152);

  ctx.fillStyle = textPrimary;
  ctx.font = `700 48px ${fontFamily}`;
  ctx.fillText(String(summary.periodLabel || '').slice(0, 34), LEFT, 224);

  ctx.fillStyle = textMuted;
  ctx.font = `400 26px ${fontFamily}`;
  ctx.fillText(`Catálogo pessoal de ${readerName}`, LEFT, 272);

  ctx.fillStyle = borderSubtle;
  ctx.fillRect(LEFT, 312, WIDTH - LEFT * 2, 2);

  const metrics = [
    { label: summary.completedLabel || 'OBRAS CONCLUÍDAS', value: String(summary.completedCount) },
    {
      label: summary.primaryMetricLabel || 'DESTAQUE QUANTITATIVO',
      value: summary.primaryMetricValue || `${summary.hoursWatched}h`,
    },
    { label: summary.genreLabel || 'GÊNERO PRINCIPAL', value: summary.topGenre },
    { label: summary.creatorLabel || 'CRIADOR EM DESTAQUE', value: summary.topCreator },
    { label: 'CONSTÂNCIA', value: `${summary.streakCount} dias` },
    {
      label: summary.domain === 'games' ? 'NOTA MÉDIA (0–11)' : 'NOTA MÉDIA',
      value: summary.avgRatingDisplay || (summary.avgRating !== null ? `${summary.avgRating}/100` : 'Sem notas'),
    },
  ];

  let y = 394;
  metrics.forEach((m) => {
    ctx.fillStyle = textMuted;
    ctx.font = `600 18px ${fontFamily}`;
    ctx.fillText(m.label, LEFT, y);

    ctx.fillStyle = textPrimary;
    ctx.font = `700 36px ${fontFamily}`;
    ctx.fillText(String(m.value).slice(0, 34), LEFT, y + 46);

    ctx.fillStyle = borderSubtle;
    ctx.fillRect(LEFT, y + 72, WIDTH - LEFT * 2, 1);
    y += 116;
  });

  ctx.fillStyle = accentColor;
  ctx.font = `600 20px ${fontFamily}`;
  ctx.fillText('DESTAQUE DO CATÁLOGO', LEFT, HEIGHT - 208);

  ctx.fillStyle = textPrimary;
  ctx.font = `700 38px ${fontFamily}`;
  ctx.fillText(String(summary.topWorkTitle).slice(0, 38), LEFT, HEIGHT - 154);

  return new Promise((resolve) => {
    const filename =
      summary.fileSlug || `omniprism-wrapped-${domainConfig.currentYear}.png`;
    if (canvas.toBlob) {
      canvas.toBlob((blob) => {
        if (!blob) {
          resolve(false);
          return;
        }
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        resolve(true);
      }, 'image/png');
    } else {
      resolve(false);
    }
  });
}

export function WrappedModal({
  isOpen,
  onClose,
  items = [],
  profile = null,
  streakCount = 0,
  activeDomain = 'cinema',
  scope = 'domain',
}) {
  const [period, setPeriod] = useState('year');
  const [wrappedScope, setWrappedScope] = useState(scope);
  const [exporting, setExporting] = useState(false);

  const effectiveDomain = wrappedScope === 'global' ? 'global' : activeDomain;
  const domainMeta = effectiveDomain === 'global' ? null : getDomainMeta(effectiveDomain);

  const summary = useMemo(
    () =>
      buildWrappedSummary({
        items,
        streakCount,
        period,
        domain: effectiveDomain,
      }),
    [items, streakCount, period, effectiveDomain]
  );

  if (!isOpen) return null;

  const handleExport = async () => {
    setExporting(true);
    try {
      await generateWrappedCardPng(
        summary,
        profile?.displayName || profile?.handle || 'Curador OmniPrism'
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Omni Wrapped — Retrospectiva OmniPrism"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-[6px] border border-line bg-card p-5 space-y-4 text-ink no-scrollbar"
      >
        <div className="flex items-center justify-between border-b border-line pb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent" strokeWidth={1.5} />
            <div>
              <h2 className="text-sm font-semibold">
                Omni Wrapped · {domainMeta ? domainMeta.shortLabel : 'Global'}
              </h2>
              <p className="text-[11px] text-subtle">
                Retrospectiva offline · {summary.domainLabel}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar Omni Wrapped"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[4px] border border-line text-muted hover:text-ink"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <div className="grid grid-cols-2 rounded-[4px] border border-line bg-app p-0.5">
            {[
              { id: 'domain', label: getDomainMeta(activeDomain).shortLabel },
              { id: 'global', label: 'Global' },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setWrappedScope(opt.id)}
                className={`min-h-[36px] rounded-[2px] text-[11px] font-medium transition-colors ${
                  wrappedScope === opt.id
                    ? 'bg-accent text-accent-ink'
                    : 'text-muted hover:text-ink'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 rounded-[4px] border border-line bg-app p-0.5">
            {[
              { id: 'year', label: `Ano ${domainConfig.currentYear}` },
              { id: 'all', label: 'Tudo' },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setPeriod(opt.id)}
                className={`min-h-[36px] rounded-[2px] text-[11px] font-medium transition-colors ${
                  period === opt.id ? 'bg-accent text-accent-ink' : 'text-muted hover:text-ink'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <article className="rounded-[6px] border-2 border-accent/60 bg-app p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-line pb-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-accent">
              {summary.periodLabel}
            </span>
            <VectorIcon
              name={domainMeta?.icon || 'Sparkles'}
              className="h-4 w-4 text-accent"
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-[4px] border border-line bg-card p-2.5">
              <span className="block text-[10px] uppercase text-subtle">
                {summary.completedLabel}
              </span>
              <span className="text-lg font-semibold tabular-nums text-ink">
                {summary.completedCount}
              </span>
            </div>
            <div className="rounded-[4px] border border-line bg-card p-2.5">
              <span className="block text-[10px] uppercase text-subtle">
                {summary.primaryMetricLabel}
              </span>
              <span className="truncate block text-sm font-semibold tabular-nums text-ink">
                {summary.primaryMetricValue}
              </span>
            </div>
            <div className="rounded-[4px] border border-line bg-card p-2.5">
              <span className="block text-[10px] uppercase text-subtle">
                {summary.genreLabel}
              </span>
              <span className="truncate block text-xs font-semibold text-ink">
                {summary.topGenre}
              </span>
            </div>
            <div className="rounded-[4px] border border-line bg-card p-2.5">
              <span className="block text-[10px] uppercase text-subtle">
                {summary.creatorLabel}
              </span>
              <span className="truncate block text-xs font-semibold text-ink">
                {summary.topCreator}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 rounded-[4px] border border-line bg-card px-3 py-2">
            <div className="min-w-0">
              <span className="block text-[10px] uppercase text-subtle">Destaque</span>
              <span className="truncate block text-xs font-semibold text-ink">
                {summary.topWorkTitle}
              </span>
            </div>
            <span className="shrink-0 text-xs font-semibold tabular-nums text-accent">
              {summary.avgRatingDisplay}
            </span>
          </div>
        </article>

        <button
          type="button"
          disabled={exporting}
          onClick={handleExport}
          className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[4px] bg-accent px-4 text-xs font-semibold text-accent-ink hover:opacity-90 disabled:opacity-45"
        >
          <ImageDown className="h-4 w-4" strokeWidth={1.5} />
          <span>{exporting ? 'Gerando cartão PNG...' : 'Exportar Omni Wrapped (1080×1350)'}</span>
        </button>
      </div>
    </div>
  );
}
