import { ArrowRight, Compass, Film, KeyRound, Sparkles } from 'lucide-react';
import { useState } from 'react';
import {
  AI_PROVIDER_META,
  runMultiCollectionOracle,
} from '../services/aiProvider';
import { generateOfflineRecommendations } from '../services/recommendationEngine';
import { getDisplayTitles } from '../utils/backlogHelpers';
import { formatPreferredCriteriaText } from '../utils/readerPreferences';
import {
  AiPrivacyNoticeBanner,
  useExternalAiNotice,
} from './AiPrivacyNotice';
import { VectorIcon } from './VectorIcon';

const MOOD_PRESETS = [
  { id: 'Imersão Épica', label: 'Imersão Épica', icon: 'Mountain' },
  { id: 'Sessão Leve', label: 'Sessão Leve', icon: 'Feather' },
  { id: 'Suspense Sombrio', label: 'Suspense / Noir', icon: 'Moon' },
  { id: 'Drama & Reflexão', label: 'Drama & Reflexão', icon: 'Compass' },
  { id: 'Maratona Sci-Fi / Anime', label: 'Sci-Fi & Mecha', icon: 'Cpu' },
];

export function OracleWidget({
  items = [],
  profile = null,
  geminiKey = '',
  onSelectItem,
  onOpenGeminiSettings,
}) {
  const { activeProvider, shouldShowNotice, acknowledgeNotice } =
    useExternalAiNotice(geminiKey);
  const [selectedMood, setSelectedMood] = useState(MOOD_PRESETS[0].id);
  const [customMood, setCustomMood] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [infoNotice, setInfoNotice] = useState('');
  const [result, setResult] = useState(null);

  const backlogItems = items.filter((item) => item.inBacklog);
  const queuedItems = backlogItems.filter((item) => item.status === 'queued');
  const completedItems = backlogItems.filter((item) => item.status === 'completed');
  const hasExternalAi = Boolean(activeProvider);

  const handleConsult = async () => {
    setInfoNotice('');

    if (queuedItems.length === 0) {
      setResult(null);
      setInfoNotice(
        'Adicione pelo menos uma obra em "Quero Ver" para sugerir uma sessão.'
      );
      return;
    }

    const moodQuery = customMood.trim() || selectedMood;

    if (!hasExternalAi) {
      const offlineRec = generateOfflineRecommendations({
        items,
        profile,
        mood: moodQuery,
      });
      setResult(offlineRec);
      setInfoNotice('Curadoria gerada localmente cruzando notas >= 80 e fila Quero Ver.');
      return;
    }

    if (shouldShowNotice) {
      acknowledgeNotice();
    }

    setIsLoading(true);
    try {
      const recommendation = await runMultiCollectionOracle({
        mood: moodQuery,
        queuedItems,
        completedItems,
        favoriteGenres: profile?.favoriteGenres || [],
        readerFocus: profile?.readerFocus || '',
        preferredCriterion: formatPreferredCriteriaText(profile),
        overrideKeys: geminiKey ? { gemini: geminiKey } : null,
      });
      const providerLabel =
        AI_PROVIDER_META[recommendation.provider]?.label || activeProvider.label;
      setResult({ ...recommendation, mode: recommendation.provider });
      setInfoNotice(`Sugestão gerada via ${providerLabel}.`);
    } catch (error) {
      const fallbackRec = generateOfflineRecommendations({
        items,
        profile,
        mood: moodQuery,
      });
      setResult(fallbackRec);
      if (error?.code === 'AUTH_ERROR') {
        setInfoNotice(`${error.userMessage} Exibindo sugestão — gerado localmente.`);
      } else {
        setInfoNotice('Provedores indisponíveis no momento. Exibindo — gerado localmente.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const primaryItem = result?.primaryId
    ? queuedItems.find((item) => item.id === result.primaryId) ?? null
    : null;
  const primaryTitles = primaryItem
    ? getDisplayTitles(primaryItem, 'bilingual')
    : null;

  return (
    <section
      aria-label="Programador de Sessão"
      className="rounded-[6px] border border-line bg-card p-3.5"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-[4px] border border-line bg-app text-accent">
            <Compass className="h-4 w-4" strokeWidth={1.5} />
          </div>
          <div>
            <h2 className="text-xs font-semibold tracking-tight text-ink">
              Curador da Sessão
            </h2>
            <p className="text-[10px] tabular-nums text-subtle">
              Cruza clima, DNA e fila Quero Ver ({queuedItems.length})
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleConsult}
          disabled={isLoading}
          className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-[4px] bg-accent px-3 py-1.5 text-[11px] font-semibold text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} />
          {isLoading
            ? 'Analisando...'
            : hasExternalAi
              ? 'Consultar Curador'
              : 'Sugerir Sessão'}
        </button>
      </div>

      {shouldShowNotice && (
        <div className="mt-2.5">
          <AiPrivacyNoticeBanner
            provider={activeProvider}
            onAcknowledge={acknowledgeNotice}
          />
        </div>
      )}

      <div className="mt-3 flex gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
        {MOOD_PRESETS.map((preset) => {
          const isSelected = !customMood.trim() && selectedMood === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                setCustomMood('');
                setSelectedMood(preset.id);
              }}
              className={`inline-flex min-h-[38px] shrink-0 items-center gap-1.5 rounded-[4px] border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                isSelected
                  ? 'border-accent bg-accent/15 text-accent'
                  : 'border-line bg-app text-muted hover:text-ink'
              }`}
            >
              <VectorIcon
                name={preset.icon}
                className={`h-3 w-3 ${isSelected ? 'text-accent' : 'text-subtle'}`}
              />
              {preset.label}
            </button>
          );
        })}
      </div>

      <input
        type="text"
        value={customMood}
        onChange={(e) => setCustomMood(e.target.value)}
        placeholder="Ou descreva o clima (ex: suspense de 90 min para ver hoje à noite)..."
        className="mt-2.5 min-h-[44px] w-full rounded-[4px] border border-line bg-app px-3 py-2 text-[11px] text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
      />

      {infoNotice && (
        <div
          role="status"
          className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-line bg-app px-3 py-2 text-[11px] text-muted"
        >
          <span>{infoNotice}</span>
          {onOpenGeminiSettings && (
            <button
              type="button"
              onClick={onOpenGeminiSettings}
              className="inline-flex min-h-[36px] items-center gap-1 rounded-[4px] border border-line px-2 py-1 text-[10px] font-medium text-accent hover:border-accent"
            >
              <KeyRound className="h-3 w-3" strokeWidth={1.5} />
              {hasExternalAi ? 'Provedores IA' : 'Ativar IA (opcional)'}
            </button>
          )}
        </div>
      )}

      {result && primaryItem && (
        <div className="mt-3 space-y-2.5 rounded-[4px] border border-accent/40 bg-app p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-accent">
                {result.headline}
              </p>
              <button
                type="button"
                onClick={() => onSelectItem?.(primaryItem)}
                className="mt-0.5 inline-flex items-center gap-1.5 text-left text-sm font-semibold text-ink hover:text-accent"
              >
                <Film className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.5} />
                <span className="truncate">{primaryTitles?.primary}</span>
                <ArrowRight className="h-3 w-3 shrink-0" strokeWidth={1.5} />
              </button>
              {primaryTitles?.secondary && (
                <p
                  className="truncate text-[11px] italic"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {primaryTitles.secondary}
                </p>
              )}
              {(primaryItem.director || primaryItem.studio || primaryItem.author) && (
                <p className="text-[11px] text-muted">
                  {primaryItem.director || primaryItem.studio || primaryItem.author}
                </p>
              )}
            </div>
          </div>

          {result.reason && (
            <p className="text-[11px] leading-relaxed text-muted">
              {result.reason}
            </p>
          )}

          {result.alternatives?.length > 0 && (
            <div className="space-y-1 border-t border-line pt-2">
              <p className="text-[10px] font-medium text-subtle">
                Outras opções da sua estante:
              </p>
              {result.alternatives.map((alt) => {
                const altItem = queuedItems.find((i) => i.id === alt.id);
                if (!altItem) return null;
                return (
                  <button
                    key={alt.id}
                    type="button"
                    onClick={() => onSelectItem?.(altItem)}
                    className="flex min-h-[38px] w-full items-baseline justify-between gap-2 rounded-[4px] px-2 py-1 text-left text-[11px] hover:bg-card"
                  >
                    <span className="truncate font-medium text-ink">
                      {altItem.title}
                    </span>
                    <span className="truncate text-[10px] text-subtle">
                      {alt.why}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
