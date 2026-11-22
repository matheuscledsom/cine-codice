import {
  Check,
  Copy,
  FileText,
  Film,
  KeyRound,
  Sparkles,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { useToast } from '../context/ToastContext';
import {
  AI_PROVIDER_META,
  runMultiReviewOrAbstractSynthesis,
  runMultiSpoilerFreeRecap,
} from '../services/aiProvider';
import {
  buildLocalReviewOrAbstractSynthesis,
  buildLocalSpoilerFreeRecap,
} from '../services/cinemaCatalogFallback';
import {
  AiPrivacyNoticeBanner,
  useExternalAiNotice,
} from './AiPrivacyNotice';

export function SpoilerFreeRecapAction({
  item,
  linkedPosts = [],
  geminiKey = '',
  onOpenGeminiSettings,
}) {
  const { activeProvider, shouldShowNotice, acknowledgeNotice } =
    useExternalAiNotice(geminiKey);
  const [isLoading, setIsLoading] = useState(false);
  const [recapText, setRecapText] = useState('');
  const [modeNote, setModeNote] = useState('');

  const hasExternalAi = Boolean(activeProvider);

  const handleGenerateRecap = async () => {
    setModeNote('');
    if (!hasExternalAi) {
      setRecapText(buildLocalSpoilerFreeRecap({ item, linkedPosts }));
      setModeNote(
        'Gerado localmente com sua minutagem, episódios vistos e anotações de sessão.'
      );
      return;
    }

    if (shouldShowNotice) {
      acknowledgeNotice();
    }

    setIsLoading(true);
    try {
      const output = await runMultiSpoilerFreeRecap({
        item,
        linkedPosts,
        overrideKeys: geminiKey ? { gemini: geminiKey } : null,
      });
      setRecapText(output.text);
      const label = AI_PROVIDER_META[output.provider]?.label || activeProvider.label;
      setModeNote(
        output.fromCache ? `Carregado do cache local (${label}).` : `Gerado via ${label}.`
      );
    } catch (error) {
      setRecapText(buildLocalSpoilerFreeRecap({ item, linkedPosts }));
      setModeNote(
        error?.code === 'AUTH_ERROR'
          ? `${error.userMessage} Exibindo síntese — gerado localmente.`
          : 'Provedores indisponíveis. Exibindo síntese sem spoilers — gerado localmente.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-2.5">
      {shouldShowNotice && (
        <AiPrivacyNoticeBanner
          provider={activeProvider}
          onAcknowledge={acknowledgeNotice}
        />
      )}

      <button
        type="button"
        onClick={handleGenerateRecap}
        disabled={isLoading}
        className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[4px] border border-accent/45 bg-accent/10 py-2.5 text-xs font-semibold text-ink transition-colors hover:bg-accent/20 disabled:opacity-55"
      >
        <Film className="h-4 w-4 text-accent" strokeWidth={1.5} />
        <span>
          {isLoading
            ? 'Recapitulando sem spoilers...'
            : hasExternalAi
              ? `Recapitulação Sem Spoilers (${activeProvider.label})`
              : 'Recapitulação Sem Spoilers (Local)'}
        </span>
      </button>

      {modeNote && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-line bg-app px-3 py-2 text-[11px] text-muted"
        >
          <span>{modeNote}</span>
          {onOpenGeminiSettings && (
            <button
              type="button"
              onClick={onOpenGeminiSettings}
              className="inline-flex min-h-[36px] items-center gap-1 rounded-[4px] border border-line px-2 py-1 text-[10px] font-medium text-accent hover:border-accent"
            >
              <KeyRound className="h-3 w-3" strokeWidth={1.5} />
              Configurar Chaves
            </button>
          )}
        </div>
      )}

      {recapText && (
        <div className="space-y-2 rounded-[4px] border border-accent/35 bg-app p-3.5">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-accent">
              <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} />
              Recapitulação Sem Spoilers
            </span>
            <button
              type="button"
              onClick={() => setRecapText('')}
              aria-label="Fechar recapitulação"
              className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-[4px] text-subtle hover:text-ink"
            >
              <X className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          </div>
          <p className="whitespace-pre-line text-xs leading-relaxed text-muted">
            {recapText}
          </p>
        </div>
      )}
    </div>
  );
}

export function SynthesisReviewAction({
  item,
  linkedPosts = [],
  geminiKey = '',
  onApplyText,
  onOpenGeminiSettings,
}) {
  const { showToast } = useToast();
  const { activeProvider, shouldShowNotice, acknowledgeNotice } =
    useExternalAiNotice(geminiKey);
  const [targetField, setTargetField] = useState('notes');
  const [isLoading, setIsLoading] = useState(false);
  const [synthesisText, setSynthesisText] = useState('');
  const [modeNote, setModeNote] = useState('');
  const [copied, setCopied] = useState(false);
  const [applied, setApplied] = useState(false);

  const hasExternalAi = Boolean(activeProvider);

  const handleSynthesize = async () => {
    setModeNote('');
    setApplied(false);

    if (!hasExternalAi) {
      setSynthesisText(buildLocalReviewOrAbstractSynthesis({ item, linkedPosts }));
      setModeNote(
        'Crítica estruturada localmente com base em suas notas, falas e avaliação.'
      );
      return;
    }

    if (shouldShowNotice) {
      acknowledgeNotice();
    }

    setIsLoading(true);
    try {
      const output = await runMultiReviewOrAbstractSynthesis({
        item,
        linkedPosts,
        overrideKeys: geminiKey ? { gemini: geminiKey } : null,
      });
      setSynthesisText(output.text);
      const label = AI_PROVIDER_META[output.provider]?.label || activeProvider.label;
      setModeNote(
        output.fromCache ? `Carregado do cache local (${label}).` : `Gerado via ${label}.`
      );
    } catch (error) {
      setSynthesisText(buildLocalReviewOrAbstractSynthesis({ item, linkedPosts }));
      setModeNote(
        error?.code === 'AUTH_ERROR'
          ? `${error.userMessage} Exibindo rascunho — gerado localmente.`
          : 'Provedores indisponíveis. Exibindo rascunho estruturado — gerado localmente.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!synthesisText) return;
    try {
      await navigator.clipboard.writeText(synthesisText);
      setCopied(true);
      showToast({ message: 'Crítica copiada', type: 'success' });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback silencioso
    }
  };

  const handleApply = () => {
    if (!synthesisText || !onApplyText) return;
    if (targetField === 'fichamento') {
      onApplyText({ fichamento: synthesisText });
    } else {
      onApplyText({ notes: synthesisText });
    }
    setApplied(true);
    showToast({
      message:
        targetField === 'fichamento'
          ? 'Notas de cena atualizadas'
          : 'Crítica salva na ficha',
      type: 'success',
    });
    setTimeout(() => setApplied(false), 2200);
  };

  return (
    <div className="space-y-2.5 rounded-[4px] border border-line bg-app p-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink">
          <FileText className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
          Crítica &amp; Notas de Sessão
        </span>
        <div className="flex rounded-[4px] border border-line bg-card p-0.5">
          <button
            type="button"
            onClick={() => setTargetField('notes')}
            className={`min-h-[32px] rounded-[2px] px-2 py-0.5 text-[10px] font-medium transition-colors ${
              targetField === 'notes'
                ? 'bg-accent text-accent-ink'
                : 'text-muted hover:text-ink'
            }`}
          >
            Crítica
          </button>
          <button
            type="button"
            onClick={() => setTargetField('fichamento')}
            className={`min-h-[32px] rounded-[2px] px-2 py-0.5 text-[10px] font-medium transition-colors ${
              targetField === 'fichamento'
                ? 'bg-accent text-accent-ink'
                : 'text-muted hover:text-ink'
            }`}
          >
            Direção/Cena
          </button>
        </div>
      </div>

      {shouldShowNotice && (
        <AiPrivacyNoticeBanner
          provider={activeProvider}
          onAcknowledge={acknowledgeNotice}
        />
      )}

      <button
        type="button"
        onClick={handleSynthesize}
        disabled={isLoading}
        className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[4px] border border-accent/45 bg-accent/10 py-2.5 text-xs font-semibold text-ink transition-colors hover:bg-accent/20 disabled:opacity-55"
      >
        <Sparkles className="h-4 w-4 text-accent" strokeWidth={1.5} />
        <span>
          {isLoading
            ? `Sintetizando com ${activeProvider?.label || 'IA'}...`
            : targetField === 'fichamento'
              ? 'Estruturar Notas de Direção & Cena'
              : 'Montar Crítica Cinematográfica'}
        </span>
      </button>

      {modeNote && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-line bg-card px-3 py-2 text-[11px] text-muted"
        >
          <span>{modeNote}</span>
          {onOpenGeminiSettings && (
            <button
              type="button"
              onClick={onOpenGeminiSettings}
              className="inline-flex min-h-[36px] items-center gap-1 rounded-[4px] border border-line px-2 py-1 text-[10px] font-medium text-accent hover:border-accent"
            >
              <KeyRound className="h-3 w-3" strokeWidth={1.5} />
              Configurar Chaves
            </button>
          )}
        </div>
      )}

      {synthesisText && (
        <div className="space-y-2.5 rounded-[4px] border border-accent/35 bg-card p-3">
          <p className="whitespace-pre-line text-xs leading-relaxed text-muted">
            {synthesisText}
          </p>
          <div className="flex gap-2 border-t border-line pt-2.5">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-[4px] border border-line bg-app py-1.5 text-[11px] font-medium text-ink hover:border-accent"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                  Copiado
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                  Copiar
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleApply}
              className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-[4px] bg-accent py-1.5 text-[11px] font-semibold text-accent-ink hover:opacity-90"
            >
              {applied ? (
                <>
                  <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
                  Aplicado
                </>
              ) : (
                <span>
                  {targetField === 'fichamento' ? 'Salvar Notas de Cena' : 'Salvar Crítica'}
                </span>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
