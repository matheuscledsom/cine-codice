import { BookmarkPlus, Check, Compass, Dices, RefreshCw, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchOnboardingGenreSuggestions,
  resolveCuratedSuggestions,
} from '../services/cinemaApi';
import { buildHomeCinemaRecommendations } from '../services/recommendationEngine';
import { getDisplayTitles } from '../utils/backlogHelpers';
import { CoverArt } from './CoverArt';
import { HomeRail } from './HomeRail';
import { OracleWidget } from './OracleWidget';

function normalizeKey(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function RecommendationsSection({
  items = [],
  profile = null,
  tmdbKey = '',
  geminiKey = '',
  onAddToWishlist,
  onSelectItem,
  onNavigateAdd,
  onOpenRoulette,
  onOpenGeminiSettings,
}) {
  const [excludeIds, setExcludeIds] = useState([]);
  const [dismissedIds, setDismissedIds] = useState([]);
  const [externalPool, setExternalPool] = useState([]);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverError, setDiscoverError] = useState('');
  const [offlineDateLabel, setOfflineDateLabel] = useState('');
  const [partialNotice, setPartialNotice] = useState('');
  const [oracleOpen, setOracleOpen] = useState(false);
  const [resolvedCoverMap, setResolvedCoverMap] = useState({});

  const hasFetchedExternalRef = useRef(false);
  const resolvingIdsRef = useRef(new Set());

  const loadExternalDiscover = useCallback(
    async ({ forceRefresh = false } = {}) => {
      if (discoverLoading) return;
      if (!forceRefresh && hasFetchedExternalRef.current) return;
      hasFetchedExternalRef.current = true;
      setDiscoverLoading(true);
      setDiscoverError('');
      setPartialNotice('');

      try {
        const res = await fetchOnboardingGenreSuggestions(profile, items, {
          tmdbApiKey: tmdbKey,
          forceRefresh,
          allowStaleOffline: true,
        });

        setExternalPool(Array.isArray(res?.results) ? res.results : []);
        setOfflineDateLabel(res?.isOfflineCache ? res.cacheDateLabel || 'local' : '');

        if (res?.allFailed) {
          setDiscoverError('Fontes externas indisponíveis no momento.');
        } else if (res?.partial) {
          setPartialNotice('Algumas fontes externas não responderam; exibindo sugestões disponíveis.');
        }
      } catch {
        setDiscoverError('Não foi possível atualizar sugestões externas agora.');
      } finally {
        setDiscoverLoading(false);
      }
    },
    [discoverLoading, items, profile, tmdbKey]
  );

  const { recommendations: localRecs, totalCandidates } = useMemo(
    () =>
      buildHomeCinemaRecommendations({
        items,
        profile,
        limit: 8,
        excludeIds,
        dismissedIds,
      }),
    [items, profile, excludeIds, dismissedIds]
  );

  const combinedRecommendations = useMemo(() => {
    const dismissedSet = new Set(dismissedIds);
    const excludeSet = new Set(excludeIds);
    const catalogTitleSet = new Set(
      (Array.isArray(items) ? items : [])
        .filter((w) => w && w.inBacklog !== false)
        .flatMap((w) => [normalizeKey(w.title), normalizeKey(w.originalTitle)])
        .filter(Boolean)
    );

    const seenKeys = new Set();
    const merged = [];

    for (const rec of localRecs) {
      const tk = normalizeKey(rec.item?.title);
      if (tk) seenKeys.add(tk);
      merged.push(rec);
    }

    for (const extItem of externalPool) {
      if (!extItem?.id || !extItem?.title) continue;
      if (dismissedSet.has(extItem.id) || excludeSet.has(extItem.id)) continue;
      const tk = normalizeKey(extItem.title);
      if (!tk || seenKeys.has(tk) || catalogTitleSet.has(tk)) continue;
      seenKeys.add(tk);

      const sourceLabel = extItem.mergedSources?.[0] || extItem.sourceBadge || 'Catálogo';
      merged.push({
        id: extItem.id,
        item: extItem,
        score: 85,
        reason: `${sourceLabel} · Pelos seus gêneros favoritos`,
        alreadyInBacklog: false,
        sourceKind: 'external-discover',
      });
    }

    return merged.slice(0, 10).map((rec) => {
      const patched = resolvedCoverMap[rec.id];
      if (!patched) return rec;
      return {
        ...rec,
        item: {
          ...rec.item,
          ...patched,
        },
      };
    });
  }, [dismissedIds, excludeIds, externalPool, items, localRecs, resolvedCoverMap]);

  useEffect(() => {
    const missing = combinedRecommendations
      .map((r) => r.item)
      .filter(
        (it) =>
          it?.id &&
          !resolvingIdsRef.current.has(it.id) &&
          !(typeof it.coverUrl === 'string' && /^https:\/\//i.test(it.coverUrl.trim()))
      );
    if (missing.length === 0) return undefined;
    missing.forEach((it) => resolvingIdsRef.current.add(it.id));

    let cancelled = false;
    resolveCuratedSuggestions(missing, { tmdbApiKey: tmdbKey })
      .then((resolvedList) => {
        if (cancelled || !Array.isArray(resolvedList)) return;
        const updates = {};
        resolvedList.forEach((resItem) => {
          if (resItem?.id && resItem?.coverUrl) {
            updates[resItem.id] = {
              coverUrl: resItem.coverUrl,
              ...(resItem.backdropUrl ? { backdropUrl: resItem.backdropUrl } : {}),
              ...(resItem.synopsis ? { synopsis: resItem.synopsis } : {}),
            };
          }
        });
        if (Object.keys(updates).length > 0) {
          setResolvedCoverMap((prev) => ({ ...prev, ...updates }));
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [combinedRecommendations, tmdbKey]);

  const handleRefresh = () => {
    const shownIds = combinedRecommendations.map((r) => r.id);
    if (shownIds.length === 0 || excludeIds.length + shownIds.length >= totalCandidates + externalPool.length) {
      setExcludeIds(shownIds.length < totalCandidates ? shownIds : []);
    } else {
      setExcludeIds((prev) => Array.from(new Set([...prev, ...shownIds])));
    }
    loadExternalDiscover({ forceRefresh: true });
  };

  const handleDismiss = (recId) => {
    if (!recId) return;
    setDismissedIds((prev) => (prev.includes(recId) ? prev : [...prev, recId]));
  };

  const headerActions = (
    <div className="flex flex-wrap items-center gap-1.5">
      {onOpenRoulette && (
        <button
          type="button"
          onClick={onOpenRoulette}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[4px] border border-accent/45 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-ink transition-colors hover:bg-accent/20"
        >
          <Dices className="h-4 w-4 text-accent" strokeWidth={1.5} />
          <span>O que assistir hoje?</span>
        </button>
      )}
      <button
        type="button"
        onClick={() => setOracleOpen((prev) => !prev)}
        aria-expanded={oracleOpen}
        className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-[4px] border px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
          oracleOpen
            ? 'border-accent bg-accent/15 text-accent'
            : 'border-line bg-card text-muted hover:border-accent hover:text-ink'
        }`}
      >
        <Sparkles className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
        <span>Curador</span>
      </button>
      {(totalCandidates > 0 || externalPool.length > 0) && (
        <button
          type="button"
          onClick={handleRefresh}
          aria-label="Atualizar indicações"
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[4px] border border-line bg-card px-2.5 text-[11px] font-medium text-ink transition-colors hover:border-accent hover:text-accent"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 text-accent ${discoverLoading ? 'animate-spin' : ''}`}
            strokeWidth={1.5}
          />
        </button>
      )}
    </div>
  );

  const emptyBox = (
    <div className="rounded-[6px] border border-line bg-card px-4 py-6 text-center space-y-2.5">
      <Compass className="mx-auto h-5 w-5 text-muted" strokeWidth={1.5} />
      <div className="space-y-1">
        <p className="text-xs font-semibold text-ink">
          Nenhuma indicação compatível no momento
        </p>
        <p
          className="mx-auto max-w-sm text-[11px] leading-relaxed"
          style={{ color: 'var(--text-secondary)' }}
        >
          {dismissedIds.length > 0
            ? 'Você dispensou todas as indicações compatíveis com suas preferências no momento.'
            : 'Explore o catálogo ou gire a roleta para descobrir algo da sua fila Quero Ver.'}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
        {dismissedIds.length > 0 && (
          <button
            type="button"
            onClick={() => setDismissedIds([])}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[4px] border border-accent bg-accent/15 px-3 py-2 text-xs font-medium text-accent transition-opacity hover:opacity-90"
          >
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} />
            <span>Restaurar dispensadas</span>
          </button>
        )}
        {onNavigateAdd && (
          <button
            type="button"
            onClick={onNavigateAdd}
            className="inline-flex min-h-[44px] items-center rounded-[4px] border border-line bg-app px-3 py-2 text-xs font-medium text-ink hover:border-accent hover:text-accent"
          >
            Catalogar nova obra
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <HomeRail
        title="Sugestões do DNA / Quero Ver"
        icon={Compass}
        count={combinedRecommendations.length}
        headerAction={headerActions}
        isEmpty={combinedRecommendations.length === 0}
        hideWhenEmpty={false}
        loading={discoverLoading && combinedRecommendations.length === 0}
        error={combinedRecommendations.length === 0 ? discoverError : ''}
        offlineDateLabel={offlineDateLabel}
        partialNotice={partialNotice}
        onRetry={() => loadExternalDiscover({ forceRefresh: true })}
        onBecomeVisible={() => loadExternalDiscover({ forceRefresh: false })}
        emptyContent={emptyBox}
      >
        {combinedRecommendations.map((rec) => {
          const { item, reason, alreadyInBacklog } = rec;
          const titles = getDisplayTitles(item, 'bilingual');

          return (
            <article
              key={rec.id}
              className="flex w-64 sm:w-72 shrink-0 snap-start gap-3 rounded-[6px] border border-line bg-card p-3 transition-colors hover:border-accent/50"
            >
              <div className="aspect-[2/3] w-20 shrink-0 overflow-hidden rounded-[4px] border border-line">
                <CoverArt item={item} compact className="h-full w-full object-cover" />
              </div>

              <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
                <div className="space-y-0.5">
                  <div className="flex items-start justify-between gap-1">
                    <h3 className="min-w-0 flex-1 line-clamp-2 text-xs font-semibold leading-snug text-ink">
                      {titles.primary}
                    </h3>
                    <button
                      type="button"
                      onClick={() => handleDismiss(rec.id)}
                      aria-label="Dispensar indicação"
                      title="Dispensar indicação"
                      className="-mr-1.5 -mt-1.5 flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-[4px] transition-colors hover:bg-app hover:text-ink"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      <X className="h-4 w-4" strokeWidth={1.5} />
                    </button>
                  </div>
                  {titles.secondary && (
                    <p
                      className="truncate text-[10px] italic"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {titles.secondary}
                    </p>
                  )}
                  {(item.director || item.studio) && (
                    <p className="truncate text-[11px] text-muted">
                      {item.director || item.studio}
                    </p>
                  )}
                  <p className="pt-1 line-clamp-2 text-[11px] leading-snug text-accent">
                    {reason}
                  </p>
                </div>

                <div className="pt-1">
                  {alreadyInBacklog ? (
                    <button
                      type="button"
                      onClick={() => onSelectItem?.(item)}
                      className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-[4px] border border-line bg-app px-2.5 py-1.5 text-[11px] font-medium text-ink transition-colors hover:border-accent hover:text-accent"
                    >
                      <Check className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                      <span>Na fila · Abrir</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onAddToWishlist?.(item)}
                      className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-[4px] border border-accent/40 bg-accent/10 px-2.5 py-1.5 text-[11px] font-medium text-accent transition-colors hover:bg-accent hover:text-accent-ink"
                    >
                      <BookmarkPlus className="h-3.5 w-3.5" strokeWidth={1.5} />
                      <span>Quero Ver</span>
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </HomeRail>

      {oracleOpen && (
        <OracleWidget
          items={items}
          profile={profile}
          geminiKey={geminiKey}
          onSelectItem={onSelectItem}
          onOpenGeminiSettings={onOpenGeminiSettings}
        />
      )}
    </div>
  );
}
