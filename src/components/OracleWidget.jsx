import { ArrowRight, Compass, KeyRound, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { normalizeViewerFocusList } from '../lib/migrations';
import {
  getOracleConfigForDomain,
  scopeOracleItemsForDomain,
} from '../lib/oracleDomainConfig';
import { AI_PROVIDER_META, runMultiCollectionOracle } from '../services/aiProvider';
import { generateOfflineRecommendations } from '../services/recommendationEngine';
import { getDisplayTitles } from '../utils/backlogHelpers';
import { formatPreferredCriteriaText } from '../utils/readerPreferences';
import {
  AiPrivacyNoticeBanner,
  useExternalAiNotice,
} from './AiPrivacyNotice';
import { VectorIcon } from './VectorIcon';

export function OracleWidget({
  items = [],
  activeDomain = 'cinema',
  profile = null,
  geminiKey = '',
  onSelectItem,
  onOpenGeminiSettings,
}) {
  const { activeProvider, shouldShowNotice, acknowledgeNotice } =
    useExternalAiNotice(geminiKey);
  const oracleCfg = useMemo(
    () => getOracleConfigForDomain(activeDomain),
    [activeDomain]
  );

  const [selectedMood, setSelectedMood] = useState(oracleCfg.presets[0].id);
  const [customMood, setCustomMood] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [infoNotice, setInfoNotice] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    setSelectedMood(oracleCfg.presets[0].id);
    setResult(null);
    setInfoNotice('');
  }, [oracleCfg]);

  const { scopedItems, queuedItems, completedItems } = useMemo(
    () => scopeOracleItemsForDomain(items, activeDomain),
    [items, activeDomain]
  );
  const hasExternalAi = Boolean(activeProvider);

  const handleConsult = async () => {
    setInfoNotice('');

    if (queuedItems.length === 0) {
      setResult(null);
      setInfoNotice(oracleCfg.emptyQueueNotice);
      return;
    }

    const moodQuery = customMood.trim() || selectedMood;

    if (!hasExternalAi) {
      const offlineRec = generateOfflineRecommendations({
        items: scopedItems,
        profile,
        mood: moodQuery,
      });
      setResult(offlineRec);
      setInfoNotice('Curadoria gerada localmente cruzando notas >= 80 e sua fila.');
      return;
    }

    if (shouldShowNotice) {
      acknowledgeNotice();
    }

    setIsLoading(true);
    try {
      const resolvedFocusList = normalizeViewerFocusList(
        profile?.viewerFocus ?? profile?.viewer_focus,
        profile?.readerFocus ?? profile?.reader_focus
      );
      const recommendation = await runMultiCollectionOracle({
        mood: `[${oracleCfg.title}] ${moodQuery}`,
        queuedItems,
        completedItems,
        favoriteGenres: profile?.favoriteGenres || [],
        viewerFocus: resolvedFocusList,
        readerFocus: resolvedFocusList[0] || '',
        preferredCriterion: formatPreferredCriteriaText(profile),
        overrideKeys: geminiKey ? { gemini: geminiKey } : null,
      });
      const providerLabel =
        AI_PROVIDER_META[recommendation.provider]?.label || activeProvider.label;
      setResult({ ...recommendation, mode: recommendation.provider });
      setInfoNotice(`Sugestão gerada via ${providerLabel}.`);
    } catch (error) {
      const fallbackRec = generateOfflineRecommendations({
        items: scopedItems,
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
      aria-label={oracleCfg.title}
      data-testid="oracle-widget"
      data-domain={oracleCfg.domain}
      className="rounded-[6px] border border-line bg-card p-3.5"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] border border-line bg-app text-accent">
            <Compass className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-xs font-semibold tracking-tight text-ink">
              {oracleCfg.title}
            </h2>
            <p className="truncate text-[11px] tabular-nums text-subtle">
              {oracleCfg.subtitle} ({queuedItems.length})
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleConsult}
          disabled={isLoading}
          className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-[6px] bg-accent px-3.5 py-2 text-xs font-semibold text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
          <span>
            {isLoading
              ? 'Analisando...'
              : hasExternalAi
                ? oracleCfg.aiActionLabel
                : oracleCfg.actionLabel}
          </span>
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
        {oracleCfg.presets.map((preset) => {
          const isSelected = !customMood.trim() && selectedMood === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                setCustomMood('');
                setSelectedMood(preset.id);
              }}
              className={`inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-[6px] border px-3 py-1.5 text-xs font-medium transition-colors ${
                isSelected
                  ? 'border-accent bg-accent/15 text-ink'
                  : 'border-line bg-app text-muted hover:text-ink'
              }`}
            >
              <VectorIcon
                name={preset.icon}
                className={`h-3.5 w-3.5 ${isSelected ? 'text-accent' : 'text-subtle'}`}
              />
              <span>{preset.label}</span>
            </button>
          );
        })}
      </div>

      <input
        type="text"
        value={customMood}
        onChange={(e) => setCustomMood(e.target.value)}
        placeholder={oracleCfg.placeholder}
        aria-label={oracleCfg.placeholder}
        className="mt-2.5 min-h-[44px] w-full rounded-[6px] border border-line bg-app px-3 py-2 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
      />

      {infoNotice && (
        <div
          role="status"
          className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-[6px] border border-line bg-app px-3 py-2 text-xs text-muted"
        >
          <span>{infoNotice}</span>
          {onOpenGeminiSettings && (
            <button
              type="button"
              onClick={onOpenGeminiSettings}
              className="inline-flex min-h-[44px] items-center gap-1 rounded-[6px] border border-line px-2.5 text-xs font-medium text-accent hover:border-accent"
            >
              <KeyRound className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
              <span>{hasExternalAi ? 'Provedores IA' : 'Ativar IA (opcional)'}</span>
            </button>
          )}
        </div>
      )}

      {result && primaryItem && (
        <div className="mt-3 space-y-2.5 border-t border-line pt-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">
                {result.headline}
              </p>
              <button
                type="button"
                onClick={() => onSelectItem?.(primaryItem)}
                className="mt-0.5 inline-flex min-h-[44px] items-center gap-1.5 text-left font-editorial text-base font-semibold text-ink hover:text-accent"
              >
                <VectorIcon
                  name={oracleCfg.iconName}
                  className="h-4 w-4 shrink-0 text-accent"
                />
                <span className="truncate">{primaryTitles?.primary}</span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
              </button>
              {primaryTitles?.secondary && (
                <p
                  className="truncate text-xs italic"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {primaryTitles.secondary}
                </p>
              )}
              {(primaryItem.creator || primaryItem.director || primaryItem.studio || primaryItem.author) && (
                <p className="text-xs text-muted">
                  {primaryItem.creator || primaryItem.director || primaryItem.studio || primaryItem.author}
                </p>
              )}
            </div>
          </div>

          {result.reason && (
            <p className="text-xs leading-relaxed text-muted">
              {result.reason}
            </p>
          )}

          {result.alternatives?.length > 0 && (
            <div className="space-y-1 border-t border-line pt-2">
              <p className="text-[11px] font-medium text-subtle">
                {oracleCfg.alternativesHeading}
              </p>
              {result.alternatives.map((alt) => {
                const altItem = queuedItems.find((i) => i.id === alt.id);
                if (!altItem) return null;
                return (
                  <button
                    key={alt.id}
                    type="button"
                    onClick={() => onSelectItem?.(altItem)}
                    className="flex min-h-[44px] w-full items-baseline justify-between gap-2 rounded-[6px] px-2 py-1 text-left text-xs hover:bg-app"
                  >
                    <span className="truncate font-editorial font-medium text-ink">
                      {altItem.title}
                    </span>
                    <span className="truncate text-[11px] text-subtle">
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
