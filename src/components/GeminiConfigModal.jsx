import { Sparkles, X } from 'lucide-react';
import { useEffect } from 'react';
import { AiProvidersPanel } from './AiProvidersPanel';
import { useAiConfig } from '../hooks/useAiConfig';

export function GeminiConfigModal({
  isOpen,
  onClose,
  apiKey,
  aiConfig = null,
  onSaveKey,
  onClearKey,
}) {
  const localConfig = useAiConfig();

  const keys = aiConfig?.keys || {
    ...localConfig.keys,
    ...(apiKey ? { gemini: apiKey } : {}),
  };
  const preferences = aiConfig?.preferences || localConfig.preferences;

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSaveProviderKey = (providerId, rawKey) => {
    const saved = aiConfig?.saveProviderKey
      ? aiConfig.saveProviderKey(providerId, rawKey)
      : localConfig.saveProviderKey(providerId, rawKey);
    if (providerId === 'gemini' && onSaveKey) {
      onSaveKey(saved);
    }
    return saved;
  };

  const handleClearProviderKey = (providerId) => {
    if (aiConfig?.clearProviderKey) {
      aiConfig.clearProviderKey(providerId);
    } else {
      localConfig.clearProviderKey(providerId);
    }
    if (providerId === 'gemini' && onClearKey) {
      onClearKey();
    }
  };

  const handleUpdatePreferences = (nextPrefs) => {
    if (aiConfig?.updatePreferences) {
      return aiConfig.updatePreferences(nextPrefs);
    }
    return localConfig.updatePreferences(nextPrefs);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Configuração de Inteligência Artificial e Busca"
    >
      <div
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-[6px] border border-line bg-card p-5 pb-8 sm:rounded-[6px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between border-b border-line pb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent" strokeWidth={1.5} />
            <h3 className="text-base font-semibold text-ink">
              Inteligência Artificial &amp; Busca
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar configuração de IA"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[4px] border border-line text-muted hover:text-ink"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>

        <AiProvidersPanel
          keys={keys}
          preferences={preferences}
          onSaveKey={handleSaveProviderKey}
          onClearKey={handleClearProviderKey}
          onUpdatePreferences={handleUpdatePreferences}
        />

        <div className="mt-4 flex justify-end border-t border-line pt-3">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-[4px] bg-accent px-5 py-2 text-xs font-semibold text-accent-ink hover:opacity-90"
          >
            Concluir
          </button>
        </div>
      </div>
    </div>
  );
}
