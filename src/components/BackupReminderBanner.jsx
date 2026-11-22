import { Download, ShieldAlert, X } from 'lucide-react';
import { useState } from 'react';

export function BackupReminderBanner({
  daysWithoutBackup = 7,
  onSaveBackupNow,
  onDismiss,
}) {
  const [busy, setBusy] = useState(false);

  const handleSave = async () => {
    if (busy || !onSaveBackupNow) return;
    setBusy(true);
    try {
      await onSaveBackupNow();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      role="status"
      aria-label="Aviso de cópia de segurança"
      className="flex flex-wrap items-center justify-between gap-3 rounded-[6px] border border-accent/40 bg-card px-3.5 py-3 text-xs"
    >
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <ShieldAlert
          className="mt-0.5 h-4 w-4 shrink-0 text-accent"
          strokeWidth={1.5}
        />
        <div className="min-w-0">
          <p className="font-semibold text-ink tabular-nums">
            Sem cópia de segurança há {daysWithoutBackup}{' '}
            {daysWithoutBackup === 1 ? 'dia' : 'dias'}
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
            Salve uma cópia assinada (SHA-256) no aparelho, Drive ou WhatsApp para evitar perdas.
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={handleSave}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[4px] bg-accent px-3 py-2 text-xs font-semibold text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-55"
        >
          <Download className="h-3.5 w-3.5" strokeWidth={1.5} />
          <span>{busy ? 'Gerando...' : 'Salvar Cópia Agora'}</span>
        </button>

        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Ocultar aviso temporariamente"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[4px] border border-line bg-app text-subtle hover:text-ink"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        )}
      </div>
    </section>
  );
}
