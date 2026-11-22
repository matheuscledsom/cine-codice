import { Check, KeyRound, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '../context/ToastContext';
import {
  AI_PROVIDER_META,
  runMultiSmartCataloging,
} from '../services/aiProvider';
import { runLocalSmartCataloging } from '../services/cinemaCatalogFallback';
import {
  AiPrivacyNoticeBanner,
  useExternalAiNotice,
} from './AiPrivacyNotice';

export function SmartCatalogButton({
  item,
  geminiKey = '',
  onApplyFields,
  onOpenGeminiSettings,
}) {
  const { showToast } = useToast();
  const { activeProvider, shouldShowNotice, acknowledgeNotice } =
    useExternalAiNotice(geminiKey);
  const [isLoading, setIsLoading] = useState(false);
  const [statusNotice, setStatusNotice] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [doneMode, setDoneMode] = useState('');
  const [optionalAiOpen, setOptionalAiOpen] = useState(false);

  const hasExternalAi = Boolean(activeProvider);

  const applyLocalFallback = async (reason = '') => {
    const localRes = await runLocalSmartCataloging(item);
    onApplyFields(localRes.updates);
    setDoneMode('local');
    setStatusNotice(
      reason
        ? `${reason} Metadados, gêneros e sinopse aplicados — gerado localmente.`
        : 'Gêneros, atmosfera e sinopse estruturada aplicados — gerado localmente.'
    );
    showToast({
      message: 'Ficha completada — gerado localmente',
      type: 'success',
    });
    setTimeout(() => setDoneMode(''), 3500);
  };

  const handleRun = async () => {
    setErrorMsg('');
    setStatusNotice('');
    setDoneMode('');

    if (!item?.title?.trim() && !item?.imdbId) {
      setErrorMsg('Informe ao menos o título da obra para catalogar.');
      return;
    }

    setIsLoading(true);
    try {
      if (!hasExternalAi) {
        await applyLocalFallback('');
        return;
      }

      if (shouldShowNotice) {
        acknowledgeNotice();
      }

      const enriched = await runMultiSmartCataloging({
        item,
        overrideKeys: geminiKey ? { gemini: geminiKey } : null,
      });
      const updates = {};

      if (enriched.synopsis) {
        updates.synopsis = enriched.synopsis;
      }

      if (enriched.genres?.length) {
        updates.genres = Array.from(
          new Set([...(item.genres || []), ...enriched.genres])
        ).slice(0, 4);
      }

      if (enriched.atmosphere?.length) {
        updates.atmosphere = Array.from(
          new Set([...(item.atmosphere || []), ...enriched.atmosphere])
        );
      }

      if (enriched.franchiseName && !item.franchiseName) {
        updates.franchiseName = enriched.franchiseName;
      }
      if (enriched.director && !item.director) {
        updates.director = enriched.director;
        updates.author = enriched.director;
      }
      if (enriched.studio && !item.studio) {
        updates.studio = enriched.studio;
      }

      onApplyFields(updates);
      const providerLabel =
        AI_PROVIDER_META[enriched.provider]?.label || activeProvider?.label || 'IA';
      setDoneMode(providerLabel);
      showToast({
        message: enriched.fromCache
          ? `Ficha carregada do cache local (${providerLabel})`
          : `Ficha completada com ${providerLabel}`,
        type: 'success',
      });
      setTimeout(() => setDoneMode(''), 3000);
    } catch (error) {
      if (error?.code === 'AUTH_ERROR') {
        setErrorMsg(
          error.userMessage || 'Chave inválida ou sem permissão. Verifique nas configurações.'
        );
        return;
      }
      try {
        await applyLocalFallback(
          error?.userMessage || 'Provedores de IA indisponíveis no momento.'
        );
      } catch (localErr) {
        setErrorMsg(
          localErr?.message ||
            error?.userMessage ||
            'Não foi possível completar a catalogação.'
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      {shouldShowNotice && (
        <AiPrivacyNoticeBanner
          provider={activeProvider}
          onAcknowledge={acknowledgeNotice}
        />
      )}

      <button
        type="button"
        onClick={handleRun}
        disabled={isLoading}
        className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[4px] border border-accent/45 bg-accent/10 px-3 py-2 text-xs font-semibold text-ink transition-colors hover:bg-accent/20 disabled:opacity-55"
      >
        {doneMode ? (
          <>
            <Check className="h-4 w-4 text-accent" strokeWidth={1.5} />
            <span>
              {doneMode === 'local'
                ? 'Ficha completada — gerado localmente'
                : `Ficha completada com ${doneMode}`}
            </span>
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4 text-accent" strokeWidth={1.5} />
            <span>
              {isLoading
                ? hasExternalAi
                  ? `Catalogando com ${activeProvider.label}...`
                  : 'Aplicando catalogação local...'
                : hasExternalAi
                  ? `Catalogação Inteligente (${activeProvider.label})`
                  : 'Preenchimento Inteligente Local'}
            </span>
          </>
        )}
      </button>

      {statusNotice && (
        <div
          role="status"
          className="rounded-[4px] border border-line bg-app px-3 py-2 text-[11px] text-muted space-y-2"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>{statusNotice}</span>
            {!hasExternalAi && onOpenGeminiSettings && (
              <button
                type="button"
                aria-expanded={optionalAiOpen}
                onClick={() => setOptionalAiOpen((v) => !v)}
                className="min-h-[34px] text-[10px] font-medium text-accent hover:underline"
              >
                {optionalAiOpen ? 'Ocultar IA opcional' : 'IA externa (opcional)'}
              </button>
            )}
          </div>
          {optionalAiOpen && !hasExternalAi && onOpenGeminiSettings && (
            <div className="flex items-center justify-between gap-2 border-t border-line pt-2">
              <span className="text-[10px] text-subtle">
                Catalogação já funciona 100% offline. Conecte uma chave apenas se desejar sínteses extras.
              </span>
              <button
                type="button"
                onClick={onOpenGeminiSettings}
                className="inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-[4px] border border-line px-2 py-1 text-[10px] font-medium text-accent hover:border-accent"
              >
                <KeyRound className="h-3 w-3" strokeWidth={1.5} />
                Configurar IA
              </button>
            </div>
          )}
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-line bg-app px-3 py-2 text-[11px] text-ink"
        >
          <span>{errorMsg}</span>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => applyLocalFallback('')}
              className="inline-flex min-h-[36px] items-center rounded-[4px] border border-line bg-card px-2.5 py-1 text-[10px] font-medium text-ink hover:border-accent"
            >
              Gerar localmente
            </button>
            {onOpenGeminiSettings && (
              <button
                type="button"
                onClick={onOpenGeminiSettings}
                className="inline-flex min-h-[36px] items-center gap-1 rounded-[4px] bg-accent px-2.5 py-1 text-[10px] font-semibold text-accent-ink"
              >
                <KeyRound className="h-3 w-3" strokeWidth={1.5} />
                Configurar Chave
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
