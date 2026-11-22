import { Info } from 'lucide-react';
import { useState } from 'react';
import {
  getActiveExternalProviderInfo,
  hasSeenAiPrivacyNotice,
  markAiPrivacyNoticeSeen,
} from '../services/aiProvider';

export function useExternalAiNotice(geminiKeyProp = '') {
  const activeProvider = getActiveExternalProviderInfo(
    geminiKeyProp ? { gemini: geminiKeyProp } : null
  );
  const [dismissed, setDismissed] = useState(() =>
    activeProvider ? hasSeenAiPrivacyNotice(activeProvider.id) : true
  );

  const shouldShowNotice = Boolean(
    activeProvider && !dismissed && !hasSeenAiPrivacyNotice(activeProvider.id)
  );

  const acknowledgeNotice = () => {
    if (activeProvider) {
      markAiPrivacyNoticeSeen(activeProvider.id);
    } else {
      markAiPrivacyNoticeSeen('any');
    }
    setDismissed(true);
  };

  return {
    activeProvider,
    shouldShowNotice,
    acknowledgeNotice,
  };
}

export function AiPrivacyNoticeBanner({ provider, onAcknowledge }) {
  if (!provider) return null;
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-line bg-app px-3 py-2 text-[11px] text-muted"
    >
      <span className="inline-flex min-w-0 items-start gap-2">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.5} />
        <span>
          Aviso único: ao consultar IA externa, título e sinopse (máx. 2.000 caracteres) são enviados somente para{' '}
          <strong className="font-medium text-ink">{provider.label}</strong> ({provider.host}).
        </span>
      </span>
      <button
        type="button"
        onClick={onAcknowledge}
        className="min-h-[36px] shrink-0 rounded-[4px] border border-line bg-card px-2.5 py-1 text-[11px] font-medium text-accent hover:border-accent"
      >
        Entendi
      </button>
    </div>
  );
}
