import { Award, ChevronDown, ChevronUp, RotateCcw, SlidersHorizontal, Star, X } from 'lucide-react';
import { useState } from 'react';
import {
  LIFE_WORK_LABEL,
  applyCriterionChange,
  applyCriterionStarChange,
  applyLifeWorkToggle,
  applyManualStarRating,
  criterionStarsToValue10,
  criterionValue10ToStars,
  formatCriterionValue10,
  formatStarsNumber,
  getCriteriaForDomain,
  resolveWorkRatingState,
} from '../lib/ratingModel.js';

function HalfAwareStarIcon({ fill = 0, size = 'md' }) {
  const dim =
    size === 'xs'
      ? 'h-4 w-4'
      : size === 'sm'
        ? 'h-3.5 w-3.5'
        : size === 'lg'
          ? 'h-6 w-6'
          : 'h-5 w-5';
  if (fill >= 1) {
    return (
      <Star
        className={`${dim} text-accent`}
        strokeWidth={1.5}
        fill="currentColor"
        aria-hidden="true"
      />
    );
  }
  if (fill >= 0.5) {
    return (
      <span className={`relative inline-block ${dim}`} aria-hidden="true">
        <Star className={`${dim} text-line`} strokeWidth={1.5} />
        <span className="absolute inset-y-0 left-0 w-1/2 overflow-hidden">
          <Star className={`${dim} text-accent`} strokeWidth={1.5} fill="currentColor" />
        </span>
      </span>
    );
  }
  return <Star className={`${dim} text-line`} strokeWidth={1.5} aria-hidden="true" />;
}

export function StarRatingDisplay({
  work,
  stars: explicitStars = null,
  lifeWork: explicitLifeWork = false,
  size = 'sm',
  showNumeric = true,
  showLifeWork = true,
  className = '',
}) {
  const resolved = work ? resolveWorkRatingState(work) : null;
  const stars = explicitStars !== null && explicitStars !== undefined ? explicitStars : resolved?.stars ?? null;
  const lifeWork = work ? resolved.lifeWork : Boolean(explicitLifeWork);
  const confirmed = work ? resolved.hasConfirmedRating : stars !== null;

  if (!confirmed || stars === null) return null;

  return (
    <span
      className={`inline-flex items-center gap-1 tabular-numerals ${className}`}
      aria-label={`Nota ${formatStarsNumber(stars)} de 5 estrelas${lifeWork ? `, ${LIFE_WORK_LABEL}` : ''}`}
    >
      <span className="inline-flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((idx) => {
          const diff = stars - (idx - 1);
          const fill = diff >= 1 ? 1 : diff >= 0.5 ? 0.5 : 0;
          return <HalfAwareStarIcon key={idx} fill={fill} size={size} />;
        })}
      </span>
      {showNumeric && (
        <span className="text-xs font-semibold text-ink tabular-numerals">
          {formatStarsNumber(stars)}
        </span>
      )}
      {showLifeWork && lifeWork && (
        <span
          className="inline-flex items-center gap-0.5 text-[11px] font-medium text-accent"
          title={LIFE_WORK_LABEL}
        >
          <Award className="h-3.5 w-3.5" strokeWidth={1.5} />
          <span className="sr-only">{LIFE_WORK_LABEL}</span>
        </span>
      )}
    </span>
  );
}

export function StarRatingPicker({
  domain = 'cinema',
  rating = null,
  ratingSource = null,
  reviewCriteria = null,
  reviewCriteria5 = null,
  ratingManualOverride = false,
  lifeWork = false,
  gameRating11 = null,
  onChange,
  defaultCriteriaOpen = false,
  compact = false,
  showClear = true,
}) {
  const [criteriaOpen, setCriteriaOpen] = useState(Boolean(defaultCriteriaOpen));

  const state = resolveWorkRatingState({
    domain,
    rating,
    ratingSource,
    reviewCriteria,
    reviewCriteria5,
    ratingManualOverride,
    lifeWork,
    gameRating11,
  });

  const criteriaDefs = getCriteriaForDomain(domain);
  const activeStars = state.hasConfirmedRating ? state.stars : null;
  const currentSnapshot = {
    domain,
    rating: state.score100,
    score100: state.score100,
    stars: state.stars,
    ratingSource,
    ratingManualOverride: state.isManualOverride,
    lifeWork: state.lifeWork,
    reviewCriteria: state.criteria.filledCount > 0 ? state.criteria.criteria : null,
    reviewCriteria5: state.criteria.filledCount > 0 ? state.criteria.criteria : null,
  };

  const emitPatch = (patch) => {
    if (typeof onChange === 'function') {
      onChange(patch);
    }
  };

  const handleSelectStar = (starValue) => {
    const nextValue = activeStars === starValue ? null : starValue;
    const next = applyManualStarRating(currentSnapshot, nextValue, { domain });
    emitPatch(next);
  };

  const handleToggleLifeWork = () => {
    const next = applyLifeWorkToggle(currentSnapshot, !state.lifeWork, { domain });
    emitPatch({
      ...currentSnapshot,
      ...next,
    });
  };

  const handleCriterionInput = (key, rawVal) => {
    const next = applyCriterionChange(currentSnapshot, {
      domain,
      key,
      value: rawVal,
    });
    emitPatch(next);
  };

  const handleCriterionStarSelect = (key, currentStars, starVal) => {
    const nextStars = currentStars === starVal ? null : starVal;
    const next = applyCriterionStarChange(currentSnapshot, {
      domain,
      key,
      stars: nextStars,
    });
    emitPatch(next);
  };

  const handleApplySuggestedStars = () => {
    if (state.criteria.suggestedStars === null) return;
    const next = applyManualStarRating(
      { ...currentSnapshot, ratingManualOverride: false },
      state.criteria.suggestedStars,
      { domain }
    );
    emitPatch({
      ...next,
      ratingManualOverride: false,
    });
  };

  return (
    <div className="space-y-3" data-testid="star-rating-picker">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          className="inline-flex items-center"
          role="group"
          aria-label="Avaliação de 0.5 a 5 estrelas"
        >
          {[1, 2, 3, 4, 5].map((idx) => {
            const halfVal = idx - 0.5;
            const fullVal = idx;
            const diff = activeStars !== null ? activeStars - (idx - 1) : 0;
            const fill = diff >= 1 ? 1 : diff >= 0.5 ? 0.5 : 0;

            return (
              <div
                key={idx}
                className="relative inline-flex min-h-[44px] min-w-[44px] items-center justify-center"
              >
                <HalfAwareStarIcon fill={fill} size={compact ? 'md' : 'lg'} />
                <button
                  type="button"
                  onClick={() => handleSelectStar(halfVal)}
                  className="absolute inset-y-0 left-0 w-1/2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  aria-label={`${halfVal.toFixed(1)} estrelas`}
                  aria-pressed={activeStars === halfVal}
                  title={`${halfVal.toFixed(1)} estrelas`}
                />
                <button
                  type="button"
                  onClick={() => handleSelectStar(fullVal)}
                  className="absolute inset-y-0 right-0 w-1/2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  aria-label={`${fullVal.toFixed(1)} estrelas`}
                  aria-pressed={activeStars === fullVal}
                  title={`${fullVal.toFixed(1)} estrelas`}
                />
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-ink tabular-numerals">
            {activeStars !== null ? `${formatStarsNumber(activeStars)} / 5.0` : 'Sem nota'}
          </span>
          {showClear && activeStars !== null && (
            <button
              type="button"
              onClick={() => handleSelectStar(activeStars)}
              className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[6px] text-muted transition-colors hover:bg-app hover:text-ink"
              aria-label="Limpar nota"
              title="Limpar nota"
            >
              <X className="h-4 w-4" strokeWidth={1.5} />
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleToggleLifeWork}
          aria-pressed={state.lifeWork}
          className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-[6px] border px-3 text-xs font-medium transition-colors ${
            state.lifeWork
              ? 'border-accent bg-accent text-accent-ink'
              : 'border-line bg-app text-muted hover:text-ink'
          }`}
        >
          <Award className="h-4 w-4" strokeWidth={1.5} />
          <span>{LIFE_WORK_LABEL}</span>
        </button>

        <button
          type="button"
          onClick={() => setCriteriaOpen((v) => !v)}
          aria-expanded={criteriaOpen}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[6px] border border-line bg-app px-3 text-xs font-medium text-muted transition-colors hover:text-ink"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.5} />
          <span>
            Avaliar por 5 critérios
            {state.criteria.filledCount > 0 ? ` (${state.criteria.filledCount}/5)` : ''}
          </span>
          {criteriaOpen ? (
            <ChevronUp className="h-3.5 w-3.5" strokeWidth={1.5} />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.5} />
          )}
        </button>
      </div>

      {criteriaOpen && (
        <div
          className="space-y-2.5 border-t border-line pt-3"
          data-testid="criteria-mini-stars-panel"
        >
          <p className="text-[11px] leading-snug text-muted">
            Toque nas mini-estrelas (0.5 a 5.0). Cada critério equivale a 1 estrela (20%) e critérios em branco não entram como zero.
          </p>

          <div className="divide-y divide-line">
            {criteriaDefs.map((def) => {
              const currentVal = state.criteria.criteria[def.key];
              const isFilled = currentVal !== null && currentVal !== undefined;
              const activeCriterionStars = criterionValue10ToStars(currentVal);

              return (
                <div
                  key={def.key}
                  data-testid={`criterion-row-${def.key}`}
                  className="flex items-center justify-between gap-2 py-0.5"
                >
                  <span
                    className="min-w-0 flex-1 truncate text-xs font-medium text-ink"
                    title={def.label}
                  >
                    <span className="sm:hidden">{def.shortLabel || def.label}</span>
                    <span className="hidden sm:inline">{def.label}</span>
                  </span>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <div
                      className="inline-flex items-center"
                      role="group"
                      aria-label={`${def.label} (0.5 a 5.0 estrelas)`}
                      data-testid={`criterion-stars-${def.key}`}
                    >
                      {[1, 2, 3, 4, 5].map((idx) => {
                        const halfVal = idx - 0.5;
                        const fullVal = idx;
                        const diff =
                          activeCriterionStars !== null
                            ? activeCriterionStars - (idx - 1)
                            : 0;
                        const fill = diff >= 1 ? 1 : diff >= 0.5 ? 0.5 : 0;

                        return (
                          <div
                            key={idx}
                            className="relative inline-flex min-h-[44px] w-7 items-center justify-center sm:w-8"
                          >
                            <HalfAwareStarIcon fill={fill} size="xs" />
                            <button
                              type="button"
                              onClick={() =>
                                handleCriterionStarSelect(
                                  def.key,
                                  activeCriterionStars,
                                  halfVal
                                )
                              }
                              className="absolute inset-y-0 left-0 w-1/2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                              aria-label={`${def.label}: ${halfVal.toFixed(1)} estrelas (${criterionStarsToValue10(halfVal)}/10)`}
                              aria-pressed={activeCriterionStars === halfVal}
                              title={`${halfVal.toFixed(1)} estrelas (${criterionStarsToValue10(halfVal)}/10)`}
                            />
                            <button
                              type="button"
                              onClick={() =>
                                handleCriterionStarSelect(
                                  def.key,
                                  activeCriterionStars,
                                  fullVal
                                )
                              }
                              className="absolute inset-y-0 right-0 w-1/2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                              aria-label={`${def.label}: ${fullVal.toFixed(1)} estrelas (${criterionStarsToValue10(fullVal)}/10)`}
                              aria-pressed={activeCriterionStars === fullVal}
                              title={`${fullVal.toFixed(1)} estrelas (${criterionStarsToValue10(fullVal)}/10)`}
                            />
                          </div>
                        );
                      })}
                    </div>

                    <span
                      data-testid={`criterion-val10-${def.key}`}
                      className="w-10 text-right text-[11px] font-medium text-muted tabular-numerals"
                    >
                      {formatCriterionValue10(currentVal)}
                    </span>

                    <button
                      type="button"
                      disabled={!isFilled}
                      onClick={() => handleCriterionInput(def.key, null)}
                      className="inline-flex min-h-[44px] w-7 items-center justify-center rounded-[6px] text-muted transition-colors hover:bg-app hover:text-ink disabled:opacity-25"
                      aria-label={`Limpar ${def.label}`}
                      title="Deixar sem nota"
                    >
                      <X className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {state.criteria.suggestedStars !== null && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2.5 text-xs">
              <span className="text-muted tabular-numerals">
                Média dos {state.criteria.filledCount} critério(s):{' '}
                <strong className="text-ink">
                  {formatStarsNumber(state.criteria.suggestedStars)} estrelas
                </strong>
                {state.isManualOverride ? ' (sobrescrita manualmente)' : ''}
              </span>

              {state.isManualOverride && (
                <button
                  type="button"
                  onClick={handleApplySuggestedStars}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[6px] border border-line bg-app px-3 text-xs font-medium text-ink hover:border-accent"
                >
                  <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} />
                  <span>Usar sugestão ({formatStarsNumber(state.criteria.suggestedStars)})</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
