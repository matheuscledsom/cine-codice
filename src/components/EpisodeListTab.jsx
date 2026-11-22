import {
  AlertTriangle,
  Award,
  BarChart3,
  CalendarClock,
  Check,
  CheckCheck,
  Clapperboard,
  Eye,
  Film,
  Layers,
  Plus,
  RefreshCw,
  RotateCcw,
  Star,
  Table2,
  Trash2,
  TrendingDown,
  WifiOff,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  deleteEpisodeEvaluation,
  getEpisodeEvaluationsForWork,
  makeEpisodeEvalKey,
  saveEpisodeEvaluation,
} from '../api/cacheDb';
import { useToast } from '../context/ToastContext';
import {
  EPISODE_TAGS,
  MAX_EPISODE_REACTION_CHARS,
  buildEpisodeBarChartModel,
  computeEpisodeStats,
  computeVirtualEpisodeWindow,
  formatNextAiringBadge,
  needsManualRatingOverwriteConfirm,
} from '../lib/episodeStats';
import {
  formatEpisodeRating10,
  snapEpisodeRatingStep5,
} from '../lib/ratings';
import {
  fetchJikanEpisodes,
  fetchOmdbSeasonEpisodes,
  fetchTmdbEpisodeGroupDetails,
  fetchTmdbEpisodeGroups,
  fetchTmdbSeasonDetails,
  fetchTvMazeShowDetails,
} from '../services/cinemaApi';
import {
  getSeasonEpisodeCount,
  getVerdictForScore,
  makeEpisodeKey,
  normalizeEpisodeMap,
  normalizeFillerEpisodes,
  normalizeStoryArcs,
} from '../utils/backlogHelpers';
import { playTactileSound } from '../utils/soundEffects';

const ROW_VIRTUAL_HEIGHT = 96;
const QUICK_SCORE_OPTIONS = Array.from({ length: 21 }, (_, idx) => idx * 5);

function buildFallbackEpisodeNumbers(count) {
  return Array.from({ length: Math.max(1, count) }, (_, i) => ({
    number: i + 1,
    title: `Episódio ${i + 1}`,
    publicScore: null,
    jikanFiller: false,
    jikanRecap: false,
    airdate: '',
    runtime: null,
  }));
}

export function EpisodeListTab({
  item,
  tmdbKey = '',
  omdbKey = '',
  onUpdateItem,
}) {
  const { showToast } = useToast();
  const totalSeasons = Math.max(1, Number(item?.totalSeasons) || 1);

  const [selectedSeason, setSelectedSeason] = useState(() =>
    Math.max(1, Math.min(totalSeasons, Number(item?.currentSeason) || 1))
  );
  const [seasonCache, setSeasonCache] = useState({});
  const [loadingSeason, setLoadingSeason] = useState(false);
  const [seasonError, setSeasonError] = useState(false);
  const [offlineMeta, setOfflineMeta] = useState({ offline: false, dateLabel: '' });

  const [evaluationsMap, setEvaluationsMap] = useState(() => new Map());
  const [persistenceWarning, setPersistenceWarning] = useState('');

  const [editingEp, setEditingEp] = useState(null);
  const [evalDraft, setEvalDraft] = useState({
    rating: null,
    tag: null,
    reaction: '',
  });
  const [savingEval, setSavingEval] = useState(false);
  const [retryingSave, setRetryingSave] = useState(false);

  const [confirmOverwriteOpen, setConfirmOverwriteOpen] = useState(false);
  const [showChartTable, setShowChartTable] = useState(false);
  const [listScrollTop, setListScrollTop] = useState(0);

  // Sugestões opcionais de episode_groups do TMDB (nunca sobrescrevem storyArcs)
  const [tmdbGroups, setTmdbGroups] = useState([]);
  const [tmdbSuggestedArcs, setTmdbSuggestedArcs] = useState([]);
  const [newArcName, setNewArcName] = useState('');
  const [newArcStart, setNewArcStart] = useState('1');
  const [newArcEnd, setNewArcEnd] = useState('12');

  const abortRef = useRef(null);

  useEffect(() => {
    setSelectedSeason(
      Math.max(1, Math.min(Math.max(1, Number(item?.totalSeasons) || 1), Number(item?.currentSeason) || 1))
    );
    setSeasonCache({});
    setEditingEp(null);
    setConfirmOverwriteOpen(false);
    setPersistenceWarning('');
    setListScrollTop(0);
    setTmdbGroups([]);
    setTmdbSuggestedArcs([]);
  }, [item?.id, item?.totalSeasons, item?.currentSeason]);

  // Carrega avaliações duráveis deste item ao montar/trocar obra
  useEffect(() => {
    if (!item?.id) return undefined;
    let cancelled = false;
    getEpisodeEvaluationsForWork(item.id)
      .then((records) => {
        if (cancelled) return;
        const map = new Map();
        (Array.isArray(records) ? records : []).forEach((rec) => {
          map.set(`${rec.season}:${rec.episode}`, rec);
        });
        setEvaluationsMap(map);
      })
      .catch(() => {
        if (!cancelled) setEvaluationsMap(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [item?.id]);

  const watchedMap = useMemo(
    () => normalizeEpisodeMap(item?.watchedEpisodes),
    [item?.watchedEpisodes]
  );
  const fillerSet = useMemo(
    () => new Set(normalizeFillerEpisodes(item?.fillerEpisodes)),
    [item?.fillerEpisodes]
  );
  const userStoryArcs = useMemo(
    () => normalizeStoryArcs(item?.storyArcs),
    [item?.storyArcs]
  );

  const loadSeasonData = useCallback(
    async (seasonNum, { forceRefresh = false } = {}) => {
      if (!item?.id) return;
      if (!forceRefresh && seasonCache[seasonNum]?.loaded) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const tmdbId = item.ids?.tmdb || item.tmdbId;
      const imdbId = item.ids?.imdb || item.imdbId;
      const tvmazeId = item.ids?.tvmaze || item.tvmazeId;
      const malId = item.ids?.mal || item.malId;
      const hasAnyEpApi = Boolean(tmdbId || tvmazeId || malId || imdbId);

      if (!hasAnyEpApi) {
        setSeasonCache((prev) => ({
          ...prev,
          [seasonNum]: { loaded: true, episodes: [], partial: false },
        }));
        setLoadingSeason(false);
        setSeasonError(false);
        return;
      }

      setLoadingSeason(true);
      setSeasonError(false);
      setOfflineMeta({ offline: false, dateLabel: '' });

      try {
        const showStatus = item.animeStatus || item.showStatus || item.tmdbStatus || '';
        const mergedByNum = new Map();
        let anyOffline = false;
        let offlineDate = '';
        let anyAttemptedSuccess = false;
        let anyFailed = false;

        // 1. Base de episódios (máx. 2 em paralelo por etapa)
        if (item.workType === 'anime' && malId) {
          const jikanRes = await fetchJikanEpisodes(malId, {
            page: seasonNum,
            showStatus,
            allowStaleOffline: true,
            signal: controller.signal,
          });
          if (jikanRes && Array.isArray(jikanRes.episodes)) {
            anyAttemptedSuccess = true;
            if (jikanRes.isOfflineCache) {
              anyOffline = true;
              offlineDate = offlineDate || jikanRes.cacheDateLabel || '';
            }
            jikanRes.episodes.forEach((ep, idx) => {
              const num = ep.number || idx + 1;
              mergedByNum.set(num, {
                number: num,
                title: ep.title || `Episódio ${num}`,
                aired: ep.aired || '',
                publicScore: ep.score ?? null,
                jikanFiller: Boolean(ep.filler),
                jikanRecap: Boolean(ep.recap),
              });
            });
          } else {
            anyFailed = true;
          }
        } else if (tvmazeId) {
          const tvRes = await fetchTvMazeShowDetails(tvmazeId, {
            showStatus,
            allowStaleOffline: true,
            signal: controller.signal,
          });
          if (tvRes && Array.isArray(tvRes.episodeList)) {
            anyAttemptedSuccess = true;
            if (tvRes.isOfflineCache) {
              anyOffline = true;
              offlineDate = offlineDate || tvRes.cacheDateLabel || '';
            }
            tvRes.episodeList
              .filter((ep) => Number(ep.season) === seasonNum)
              .forEach((ep) => {
                mergedByNum.set(ep.number, {
                  number: ep.number,
                  title: ep.name || `Episódio ${ep.number}`,
                  airdate: ep.airdate || '',
                  runtime: ep.runtime || null,
                  imageUrl: ep.imageUrl || null,
                  summary: ep.summary || '',
                  publicScore: ep.rating ?? null,
                });
              });
          } else {
            anyFailed = true;
          }
        }

        // Fallback TMDB season quando não veio lista de episódios ainda
        if (mergedByNum.size === 0 && tmdbId) {
          const tmdbSeasonRes = await fetchTmdbSeasonDetails(tmdbId, seasonNum, {
            apiKey: tmdbKey,
            showStatus,
            allowStaleOffline: true,
            signal: controller.signal,
          });
          if (tmdbSeasonRes && Array.isArray(tmdbSeasonRes.episodes)) {
            anyAttemptedSuccess = true;
            if (tmdbSeasonRes.isOfflineCache) {
              anyOffline = true;
              offlineDate = offlineDate || tmdbSeasonRes.cacheDateLabel || '';
            }
            tmdbSeasonRes.episodes.forEach((ep) => {
              mergedByNum.set(ep.number, {
                number: ep.number,
                title: ep.name || `Episódio ${ep.number}`,
                airdate: ep.airdate || '',
                runtime: ep.runtime || null,
                imageUrl: ep.imageUrl || null,
                summary: ep.summary || '',
                publicScore: ep.rating ?? null,
              });
            });
          } else {
            anyFailed = true;
          }
        }

        // 2. Notas públicas de episódio via OMDb por temporada (quando IMDb disponível e série não-anime)
        if (imdbId && item.workType !== 'anime') {
          const omdbSeasonRes = await fetchOmdbSeasonEpisodes(imdbId, seasonNum, {
            apiKey: omdbKey,
            showStatus,
            allowStaleOffline: true,
            signal: controller.signal,
          });
          if (omdbSeasonRes?.ok && Array.isArray(omdbSeasonRes.episodes)) {
            anyAttemptedSuccess = true;
            if (omdbSeasonRes.isOfflineCache) {
              anyOffline = true;
              offlineDate = offlineDate || omdbSeasonRes.cacheDateLabel || '';
            }
            omdbSeasonRes.episodes.forEach((ep) => {
              if (!ep.number) return;
              const existing = mergedByNum.get(ep.number) || {
                number: ep.number,
                title: ep.title || `Episódio ${ep.number}`,
              };
              mergedByNum.set(ep.number, {
                ...existing,
                title: existing.title || ep.title || `Episódio ${ep.number}`,
                publicScore: ep.imdbRating ?? existing.publicScore ?? null,
                publicScoreSource: ep.imdbRating !== null ? 'IMDb' : existing.publicScoreSource || null,
              });
            });
          }
        }

        if (controller.signal.aborted) return;

        const sortedList = Array.from(mergedByNum.values()).sort((a, b) => a.number - b.number);
        setSeasonCache((prev) => ({
          ...prev,
          [seasonNum]: {
            loaded: true,
            episodes: sortedList,
            partial: anyFailed && anyAttemptedSuccess,
          },
        }));
        setOfflineMeta({ offline: anyOffline, dateLabel: offlineDate });
        setSeasonError(!anyAttemptedSuccess && anyFailed && sortedList.length === 0);
      } catch {
        if (!controller.signal.aborted) {
          setSeasonError(true);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoadingSeason(false);
        }
      }
    },
    [item, seasonCache, tmdbKey, omdbKey]
  );

  useEffect(() => {
    loadSeasonData(selectedSeason);
    return () => {
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, selectedSeason]);

  // Busca episode_groups do TMDB como sugestão de arcos apenas se TMDB ID existir
  useEffect(() => {
    const tmdbId = item?.ids?.tmdb || item?.tmdbId;
    if (!tmdbId || item?.workType === 'movie') return undefined;
    let cancelled = false;
    fetchTmdbEpisodeGroups(tmdbId, {
      apiKey: tmdbKey,
      showStatus: item?.tmdbStatus || '',
      allowStaleOffline: true,
    })
      .then((res) => {
        if (!cancelled && res?.ok && Array.isArray(res.groups)) {
          setTmdbGroups(res.groups.slice(0, 3));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [item?.id, item?.ids?.tmdb, item?.tmdbId, item?.workType, item?.tmdbStatus, tmdbKey]);

  const seasonCountFallback = getSeasonEpisodeCount(item, selectedSeason);
  const loadedSeason = seasonCache[selectedSeason];

  const seasonEpisodes = useMemo(() => {
    const list = loadedSeason?.episodes;
    if (Array.isArray(list) && list.length > 0) return list;
    if (Array.isArray(item?.episodeList)) {
      const filtered = item.episodeList
        .filter((ep) => Number(ep.season) === selectedSeason)
        .map((ep) => ({
          number: ep.number,
          title: ep.name || `Episódio ${ep.number}`,
          airdate: ep.airdate || '',
          runtime: ep.runtime || null,
          imageUrl: ep.imageUrl || null,
          summary: ep.summary || '',
          publicScore: ep.rating ?? null,
        }));
      if (filtered.length > 0) return filtered;
    }
    return buildFallbackEpisodeNumbers(seasonCountFallback);
  }, [loadedSeason, item?.episodeList, selectedSeason, seasonCountFallback]);

  const virtualWin = useMemo(
    () =>
      computeVirtualEpisodeWindow({
        totalCount: seasonEpisodes.length,
        scrollTop: listScrollTop,
        viewportHeight: 420,
        itemHeight: ROW_VIRTUAL_HEIGHT,
        overscan: 5,
      }),
    [seasonEpisodes.length, listScrollTop]
  );

  const visibleEpisodes = useMemo(() => {
    if (!virtualWin.virtualized) return seasonEpisodes;
    return seasonEpisodes.slice(virtualWin.startIndex, virtualWin.endIndex + 1);
  }, [seasonEpisodes, virtualWin]);

  const episodeStats = useMemo(
    () => computeEpisodeStats(Array.from(evaluationsMap.values()), item?.totalEpisodes),
    [evaluationsMap, item?.totalEpisodes]
  );

  const chartModel = useMemo(
    () => buildEpisodeBarChartModel(seasonEpisodes, evaluationsMap, selectedSeason),
    [seasonEpisodes, evaluationsMap, selectedSeason]
  );

  const nextAiringBadge = useMemo(() => formatNextAiringBadge(item), [item]);

  const seasonUserArcs = useMemo(
    () => userStoryArcs.filter((a) => Number(a.season) === selectedSeason),
    [userStoryArcs, selectedSeason]
  );

  const commitWatchedWithUndo = (nextMap, actionDescription) => {
    const prevSnapshot = {
      watchedEpisodes: { ...watchedMap },
      currentSeason: item.currentSeason || 1,
      currentEpisode: item.currentEpisode || 0,
    };
    const watchedCount = Object.values(nextMap).filter((st) => st === 'watched').length;
    onUpdateItem(item.id, {
      watchedEpisodes: nextMap,
      currentSeason: selectedSeason,
      currentEpisode: watchedCount,
    });
    showToast({
      message: actionDescription,
      type: 'success',
      duration: 6000,
      action: {
        label: 'Desfazer',
        onClick: () => {
          onUpdateItem(item.id, prevSnapshot);
          showToast({ message: 'Progresso anterior restaurado.', type: 'info' });
        },
      },
    });
  };

  const handleToggleWatched = (epNum) => {
    const key = makeEpisodeKey(selectedSeason, epNum);
    const nextMap = { ...watchedMap };
    const wasWatched = nextMap[key] === 'watched';
    if (wasWatched) {
      delete nextMap[key];
    } else {
      nextMap[key] = 'watched';
    }
    playTactileSound('page');
    commitWatchedWithUndo(
      nextMap,
      wasWatched
        ? `T${selectedSeason}E${epNum} desmarcado.`
        : `T${selectedSeason}E${epNum} marcado como assistido.`
    );
  };

  const handleMarkUpToHere = (epNum) => {
    const nextMap = { ...watchedMap };
    for (let i = 1; i <= epNum; i += 1) {
      nextMap[makeEpisodeKey(selectedSeason, i)] = 'watched';
    }
    playTactileSound('page');
    commitWatchedWithUndo(
      nextMap,
      `Episódios T${selectedSeason}E01–E${String(epNum).padStart(2, '0')} marcados.`
    );
  };

  const handleMarkWholeSeason = () => {
    const nextMap = { ...watchedMap };
    seasonEpisodes.forEach((ep) => {
      nextMap[makeEpisodeKey(selectedSeason, ep.number)] = 'watched';
    });
    playTactileSound('complete');
    commitWatchedWithUndo(
      nextMap,
      `Temporada ${selectedSeason} inteira marcada (${seasonEpisodes.length} eps).`
    );
  };

  const handleToggleUserFiller = (epNum) => {
    const key = makeEpisodeKey(selectedSeason, epNum);
    const prevFillers = Array.from(fillerSet);
    const nextSet = new Set(fillerSet);
    const added = !nextSet.has(key);
    if (added) nextSet.add(key);
    else nextSet.delete(key);

    onUpdateItem(item.id, { fillerEpisodes: Array.from(nextSet) });
    showToast({
      message: added
        ? `T${selectedSeason}E${epNum} marcado como filler seu.`
        : `T${selectedSeason}E${epNum} removido dos fillers.`,
      type: 'info',
      duration: 5000,
      action: {
        label: 'Desfazer',
        onClick: () => onUpdateItem(item.id, { fillerEpisodes: prevFillers }),
      },
    });
  };

  const openEditorForEpisode = (epNum) => {
    const mapKey = `${selectedSeason}:${epNum}`;
    const existing = evaluationsMap.get(mapKey);
    if (editingEp === epNum) {
      setEditingEp(null);
      return;
    }
    setEditingEp(epNum);
    setEvalDraft({
      rating: existing?.rating ?? null,
      tag: existing?.tag || null,
      reaction: existing?.reaction || '',
    });
  };

  const handleSaveEvaluation = async (epNum) => {
    if (!item?.id || savingEval) return;
    setSavingEval(true);
    const mapKey = `${selectedSeason}:${epNum}`;
    const previousRecord = evaluationsMap.get(mapKey) || null;

    const cleanRating =
      evalDraft.rating !== null && evalDraft.rating !== undefined
        ? snapEpisodeRatingStep5(evalDraft.rating)
        : null;

    try {
      const saved = await saveEpisodeEvaluation({
        evalKey: makeEpisodeEvalKey(item.id, selectedSeason, epNum),
        workId: item.id,
        season: selectedSeason,
        episode: epNum,
        rating: cleanRating,
        tag: evalDraft.tag || null,
        reaction: String(evalDraft.reaction || '').slice(0, MAX_EPISODE_REACTION_CHARS),
      });

      setEvaluationsMap((prev) => {
        const next = new Map(prev);
        next.set(mapKey, saved);
        return next;
      });

      if (!saved?.persisted) {
        const warnText =
          saved?.persistenceWarning ||
          'Avaliação NÃO foi salva no dispositivo (apenas cópia provisória em memória).';
        setPersistenceWarning(warnText);
        showToast({ message: warnText, type: 'error', duration: 7000 });
      } else {
        setPersistenceWarning('');
        showToast({
          message: `Avaliação de T${selectedSeason}E${epNum} salva.`,
          type: 'success',
          duration: 6000,
          action: {
            label: 'Desfazer',
            onClick: async () => {
              if (previousRecord) {
                const restored = await saveEpisodeEvaluation(previousRecord);
                setEvaluationsMap((prev) => {
                  const next = new Map(prev);
                  next.set(mapKey, restored);
                  return next;
                });
              } else {
                await deleteEpisodeEvaluation(item.id, selectedSeason, epNum);
                setEvaluationsMap((prev) => {
                  const next = new Map(prev);
                  next.delete(mapKey);
                  return next;
                });
              }
            },
          },
        });
      }
      setEditingEp(null);
    } catch {
      const fallbackMsg =
        'Erro ao salvar avaliação de episódio no IndexedDB. Os dados NÃO foram persistidos.';
      setPersistenceWarning(fallbackMsg);
      showToast({ message: fallbackMsg, type: 'error' });
    } finally {
      setSavingEval(false);
    }
  };

  const handleRetryProvisionalSaves = async () => {
    if (retryingSave) return;
    const provisionalEntries = Array.from(evaluationsMap.entries()).filter(
      ([, ev]) => Boolean(ev?.provisional)
    );
    if (provisionalEntries.length === 0) {
      setPersistenceWarning('');
      return;
    }

    setRetryingSave(true);
    let anyFailedWarning = '';
    const nextUpdates = [];
    try {
      for (const [mapKey, ev] of provisionalEntries) {
        const saved = await saveEpisodeEvaluation({
          ...ev,
          evalKey: ev.evalKey || makeEpisodeEvalKey(item?.id, ev.season, ev.episode),
          workId: ev.workId || item?.id,
        });
        nextUpdates.push([mapKey, saved]);
        if (!saved?.persisted && !anyFailedWarning) {
          anyFailedWarning =
            saved?.persistenceWarning ||
            'Avaliação continua apenas provisória em memória (IndexedDB indisponível ou cheio).';
        }
      }

      setEvaluationsMap((prev) => {
        const next = new Map(prev);
        for (const [k, record] of nextUpdates) {
          next.set(k, record);
        }
        return next;
      });

      if (anyFailedWarning) {
        setPersistenceWarning(anyFailedWarning);
        showToast({ message: anyFailedWarning, type: 'error', duration: 6000 });
      } else {
        setPersistenceWarning('');
        showToast({
          message: 'Avaliações provisórias gravadas no aparelho com sucesso.',
          type: 'success',
        });
      }
    } catch {
      const msg =
        'Falha ao tentar gravar novamente no IndexedDB. Os dados permanecem provisórios em memória.';
      setPersistenceWarning(msg);
      showToast({ message: msg, type: 'error' });
    } finally {
      setRetryingSave(false);
    }
  };

  const handleApplySeriesAverage = (confirmed = false) => {
    if (!episodeStats.canApplyAverageToSeries || episodeStats.averageRating100 === null) return;
    if (!confirmed && needsManualRatingOverwriteConfirm(item)) {
      setConfirmOverwriteOpen(true);
      return;
    }

    const prevRatingState = {
      rating: item.rating ?? null,
      ratingSource: item.ratingSource ?? null,
      verdict: item.verdict ?? null,
    };

    const nextScore = episodeStats.averageRating100;
    onUpdateItem(item.id, {
      rating: nextScore,
      ratingSource: 'episodes',
      verdict: getVerdictForScore(nextScore),
    });
    setConfirmOverwriteOpen(false);
    showToast({
      message: `Nota ${nextScore}/100 aplicada a partir dos episódios.`,
      type: 'success',
      duration: 6000,
      action: {
        label: 'Desfazer',
        onClick: () => onUpdateItem(item.id, prevRatingState),
      },
    });
  };

  const handleLoadSuggestedArcGroup = async (groupId) => {
    const res = await fetchTmdbEpisodeGroupDetails(groupId, {
      apiKey: tmdbKey,
      showStatus: item?.tmdbStatus || '',
      allowStaleOffline: true,
    });
    if (res?.ok && Array.isArray(res.arcs)) {
      setTmdbSuggestedArcs(res.arcs);
    }
  };

  const handleAddUserArc = (e) => {
    e.preventDefault();
    const clean = newArcName.trim();
    if (!clean) return;
    const maxEp = Math.max(1, seasonEpisodes.length);
    const sEp = Math.max(1, Math.min(maxEp, Number(newArcStart) || 1));
    const eEp = Math.max(sEp, Math.min(maxEp, Number(newArcEnd) || sEp));
    const prevArcs = [...userStoryArcs];
    const nextArcs = [
      ...prevArcs,
      {
        id: `arc-${Date.now()}`,
        name: clean,
        season: selectedSeason,
        startEp: sEp,
        endEp: eEp,
      },
    ];
    onUpdateItem(item.id, { storyArcs: nextArcs });
    setNewArcName('');
  };

  const renderEvaluationEditor = (epNum) => {
    const mapKey = `${selectedSeason}:${epNum}`;
    const existing = evaluationsMap.get(mapKey);
    return (
      <div className="space-y-3 rounded-[4px] border border-accent/50 bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold tabular-nums text-ink">
            Avaliar T{selectedSeason}E{String(epNum).padStart(2, '0')}
            {existing?.provisional ? ' · Provisório (não salvo)' : ''}
          </span>
          <button
            type="button"
            onClick={() => setEditingEp(null)}
            className="min-h-[44px] px-2 text-[11px] text-muted hover:text-ink"
          >
            Fechar
          </button>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-medium text-muted">Nota (0–10, passos de 0.5)</span>
            <span className="font-semibold tabular-nums text-accent">
              {evalDraft.rating !== null ? `${formatEpisodeRating10(evalDraft.rating)} / 10` : 'Sem nota'}
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setEvalDraft((prev) => ({ ...prev, rating: null }))}
              className={`min-h-[44px] rounded-[4px] border px-2 text-[11px] font-medium ${
                evalDraft.rating === null
                  ? 'border-accent bg-accent/15 text-ink'
                  : 'border-line bg-app text-muted'
              }`}
            >
              Sem nota
            </button>
            {QUICK_SCORE_OPTIONS.map((score100) => {
              const active = evalDraft.rating === score100;
              return (
                <button
                  key={score100}
                  type="button"
                  onClick={() => setEvalDraft((prev) => ({ ...prev, rating: score100 }))}
                  className={`min-h-[44px] min-w-[44px] rounded-[4px] border px-2 text-[11px] font-semibold tabular-nums ${
                    active
                      ? 'border-accent bg-accent text-accent-ink'
                      : 'border-line bg-app text-muted hover:text-ink'
                  }`}
                >
                  {formatEpisodeRating10(score100)}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1.5">
          <span className="block text-[11px] font-medium text-muted">Selo do episódio</span>
          <div className="flex flex-wrap gap-1.5">
            {EPISODE_TAGS.map((tagLabel) => {
              const active = evalDraft.tag === tagLabel;
              return (
                <button
                  key={tagLabel}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    setEvalDraft((prev) => ({
                      ...prev,
                      tag: prev.tag === tagLabel ? null : tagLabel,
                    }))
                  }
                  className={`min-h-[44px] rounded-[4px] border px-2.5 text-[11px] font-medium ${
                    active
                      ? 'border-accent bg-accent/15 text-ink'
                      : 'border-line bg-app text-muted hover:text-ink'
                  }`}
                >
                  {tagLabel}
                </button>
              );
            })}
          </div>
        </div>

        <label className="block space-y-1">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-medium text-muted">Reação (opcional)</span>
            <span className="tabular-nums text-subtle">
              {evalDraft.reaction.length}/{MAX_EPISODE_REACTION_CHARS}
            </span>
          </div>
          <textarea
            rows={2}
            maxLength={MAX_EPISODE_REACTION_CHARS}
            value={evalDraft.reaction}
            onChange={(e) =>
              setEvalDraft((prev) => ({
                ...prev,
                reaction: e.target.value.slice(0, MAX_EPISODE_REACTION_CHARS),
              }))
            }
            placeholder="Momento marcante ou impressão rápida..."
            className="w-full resize-none rounded-[4px] border border-line bg-app px-2.5 py-2 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
          />
        </label>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={savingEval}
            onClick={() => handleSaveEvaluation(epNum)}
            className="min-h-[44px] rounded-[4px] bg-accent px-4 text-xs font-semibold text-accent-ink hover:opacity-90 disabled:opacity-50"
          >
            {savingEval ? 'Salvando...' : 'Salvar Avaliação'}
          </button>
        </div>
      </div>
    );
  };

  const hasArcSource =
    userStoryArcs.length > 0 || tmdbGroups.length > 0 || tmdbSuggestedArcs.length > 0;

  return (
    <div className="space-y-4">
      {/* Regra Extra 3 + R11: alerta explícito caso IndexedDB esteja indisponível / cota esgotada */}
      {persistenceWarning && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-accent bg-app p-3 text-xs text-ink"
        >
          <div className="flex min-w-0 flex-1 items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-accent" strokeWidth={1.5} />
            <div className="min-w-0">
              <p className="font-semibold">Atenção: Provisório (não salvo) no IndexedDB</p>
              <p className="mt-0.5 text-[11px] text-muted">{persistenceWarning}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleRetryProvisionalSaves}
            disabled={retryingSave}
            className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-[4px] border border-accent bg-accent px-3 text-xs font-semibold text-accent-ink disabled:opacity-60"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${retryingSave ? 'animate-spin' : ''}`}
              strokeWidth={1.5}
            />
            <span>{retryingSave ? 'Salvando...' : 'Tentar de novo'}</span>
          </button>
        </div>
      )}

      {/* Estatísticas gerais de episódios + Top 3 + Pior + Botão aplicar média */}
      <section
        aria-label="Resumo das avaliações de episódios"
        className="space-y-3 rounded-[6px] border border-line bg-app p-3.5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold text-ink">Avaliações por Episódio</p>
            <p className="text-[11px] tabular-nums text-muted">{episodeStats.countLabel}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {nextAiringBadge && (
              <span className="inline-flex items-center gap-1 rounded-[4px] border border-accent/40 bg-accent/15 px-2 py-1 text-[11px] font-semibold tabular-nums text-accent">
                <CalendarClock className="h-3.5 w-3.5" strokeWidth={1.5} />
                {nextAiringBadge.text}
              </span>
            )}
            {episodeStats.averageRating10 !== null && (
              <span className="inline-flex items-center gap-1 rounded-[4px] border border-accent bg-card px-2.5 py-1 text-xs font-semibold tabular-nums text-ink">
                <Star className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                Média {episodeStats.averageRating10}/10
              </span>
            )}
          </div>
        </div>

        {(episodeStats.topEpisodes.length > 0 || episodeStats.worstEpisode) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {episodeStats.topEpisodes.length > 0 && (
              <div className="rounded-[4px] border border-line bg-card p-2.5 space-y-1">
                <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
                  <Award className="h-3 w-3 text-accent" strokeWidth={1.5} />
                  <span>Top {episodeStats.topEpisodes.length} episódios</span>
                </p>
                {episodeStats.topEpisodes.map((ev, i) => (
                  <p key={ev.evalKey} className="text-[11px] tabular-nums text-ink">
                    <strong className="text-accent">#{i + 1}</strong> T{ev.season}E{String(ev.episode).padStart(2, '0')} · {ev.rating10}/10
                    {ev.tag ? ` (${ev.tag})` : ''}
                  </p>
                ))}
              </div>
            )}

            {episodeStats.worstEpisode && (
              <div className="rounded-[4px] border border-line bg-card p-2.5 space-y-1">
                <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
                  <TrendingDown className="h-3 w-3 text-muted" strokeWidth={1.5} />
                  <span>Menor avaliação</span>
                </p>
                <p className="text-[11px] tabular-nums text-ink">
                  T{episodeStats.worstEpisode.season}E{String(episodeStats.worstEpisode.episode).padStart(2, '0')} · {episodeStats.worstEpisode.rating10}/10
                  {episodeStats.worstEpisode.tag ? ` (${episodeStats.worstEpisode.tag})` : ''}
                </p>
              </div>
            )}
          </div>
        )}

        <div className="space-y-2 border-t border-line pt-2.5">
          {!confirmOverwriteOpen ? (
            <button
              type="button"
              disabled={!episodeStats.canApplyAverageToSeries}
              onClick={() => handleApplySeriesAverage(false)}
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[4px] border border-accent bg-accent/15 px-3 text-xs font-semibold text-ink hover:bg-accent hover:text-accent-ink disabled:cursor-not-allowed disabled:border-line disabled:bg-card disabled:text-subtle"
            >
              <Star className="h-3.5 w-3.5" strokeWidth={1.5} />
              <span>Aplicar média na nota da série</span>
            </button>
          ) : (
            <div className="space-y-2 rounded-[4px] border border-accent bg-card p-2.5 text-xs">
              <p className="text-ink">
                Já existe nota manual (<strong className="tabular-nums">{item.rating}/100</strong>). Deseja substituir pela média dos episódios (<strong className="tabular-nums">{episodeStats.averageRating100}/100</strong>)?
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmOverwriteOpen(false)}
                  className="min-h-[44px] rounded-[4px] border border-line px-3 text-xs text-muted hover:text-ink"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => handleApplySeriesAverage(true)}
                  className="min-h-[44px] rounded-[4px] bg-accent px-3 text-xs font-semibold text-accent-ink"
                >
                  Confirmar substituição
                </button>
              </div>
            </div>
          )}
          {!episodeStats.canApplyAverageToSeries && (
            <p className="text-[10px] text-subtle">
              Avalie pelo menos 3 episódios para liberar o cálculo automático da nota da série.
            </p>
          )}
        </div>
      </section>

      {/* Seletor de Temporada & Ação em massa */}
      <section className="space-y-2.5 rounded-[6px] border border-line bg-app p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
            {Array.from({ length: totalSeasons }, (_, idx) => idx + 1).map((sNum) => (
              <button
                key={sNum}
                type="button"
                onClick={() => {
                  setSelectedSeason(sNum);
                  setListScrollTop(0);
                  setEditingEp(null);
                }}
                className={`min-h-[44px] min-w-[44px] shrink-0 rounded-[4px] border px-2.5 text-xs font-semibold tabular-nums transition-colors ${
                  selectedSeason === sNum
                    ? 'border-accent bg-accent text-accent-ink'
                    : 'border-line bg-card text-muted hover:text-ink'
                }`}
              >
                T{sNum}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                const nextTotal = totalSeasons + 1;
                const nextArr = Array.isArray(item?.episodesPerSeason)
                  ? [...item.episodesPerSeason]
                  : [];
                while (nextArr.length < totalSeasons) nextArr.push(12);
                nextArr.push(12);
                onUpdateItem(item.id, {
                  totalSeasons: nextTotal,
                  episodesPerSeason: nextArr,
                });
                setSelectedSeason(nextTotal);
                setListScrollTop(0);
              }}
              aria-label="Adicionar nova temporada"
              className="min-h-[44px] shrink-0 rounded-[4px] border border-dashed border-line bg-card px-2.5 text-xs font-medium text-accent hover:border-accent"
            >
              + Nova Temp
            </button>
          </div>

          <button
            type="button"
            onClick={handleMarkWholeSeason}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[4px] border border-line bg-card px-3 text-xs font-medium text-ink hover:border-accent"
          >
            <CheckCheck className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
            <span>Temporada inteira</span>
          </button>
        </div>

        {/* Estados assíncronos da temporada (D6) */}
        {loadingSeason && (
          <div className="space-y-2 motion-safe:animate-pulse" aria-label="Carregando episódios">
            {[1, 2, 3].map((idx) => (
              <div key={idx} className="h-16 rounded-[4px] border border-line bg-card" />
            ))}
          </div>
        )}

        {offlineMeta.offline && (
          <div
            role="status"
            className="flex items-center gap-1.5 rounded-[4px] border border-line bg-card px-2.5 py-1.5 text-[11px] tabular-nums text-muted"
          >
            <WifiOff className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
            <span>Modo offline — dados de {offlineMeta.dateLabel || 'cache'}.</span>
          </div>
        )}

        {seasonError && !loadingSeason && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-line bg-card px-3 py-2 text-xs text-muted"
          >
            <span>Não foi possível buscar detalhes dos episódios agora.</span>
            <button
              type="button"
              onClick={() => loadSeasonData(selectedSeason, { forceRefresh: true })}
              className="inline-flex min-h-[44px] items-center gap-1 rounded-[4px] border border-accent bg-accent/10 px-3 text-[11px] font-semibold text-accent"
            >
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.5} />
              <span>Tentar de novo</span>
            </button>
          </div>
        )}

        {/* Editor ancorado acima da lista se virtualizada (>100 episódios) */}
        {virtualWin.virtualized && editingEp !== null && renderEvaluationEditor(editingEp)}

        {virtualWin.virtualized && (
          <p className="text-[10px] tabular-nums text-subtle">
            Lista virtualizada ativa ({seasonEpisodes.length} episódios nesta temporada).
          </p>
        )}

        <div
          onScroll={(e) => {
            if (virtualWin.virtualized) {
              setListScrollTop(e.currentTarget.scrollTop);
            }
          }}
          className={
            virtualWin.virtualized
              ? 'max-h-[420px] overflow-y-auto pr-1 space-y-2'
              : 'space-y-2'
          }
        >
          {virtualWin.virtualized && virtualWin.paddingTop > 0 && (
            <div style={{ height: `${virtualWin.paddingTop}px` }} aria-hidden="true" />
          )}

          {visibleEpisodes.map((ep) => {
            const epKey = makeEpisodeKey(selectedSeason, ep.number);
            const isWatched = watchedMap[epKey] === 'watched';
            const isUserFiller = fillerSet.has(epKey);
            const ev = evaluationsMap.get(`${selectedSeason}:${ep.number}`);
            const matchedArc = seasonUserArcs.find(
              (a) => ep.number >= a.startEp && ep.number <= a.endEp
            );

            return (
              <div
                key={ep.number}
                className={`space-y-2 rounded-[4px] border px-3 py-2 ${
                  isWatched ? 'border-accent/50 bg-card' : 'border-line bg-card'
                } ${virtualWin.virtualized ? 'min-h-[88px]' : ''}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-semibold tabular-nums text-accent">
                        E{String(ep.number).padStart(2, '0')}
                      </span>
                      <span className="truncate text-xs font-medium text-ink">
                        {ep.title}
                      </span>
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] tabular-nums text-muted">
                      {ev?.rating !== null && ev?.rating !== undefined && (
                        <span className="rounded-[3px] border border-accent/40 bg-accent/15 px-1.5 py-0.5 font-semibold text-accent">
                          Sua nota {ev.rating10}/10
                        </span>
                      )}
                      {ev?.provisional && (
                        <span className="rounded-[3px] border border-accent bg-app px-1.5 py-0.5 font-semibold text-accent">
                          Provisório (não salvo)
                        </span>
                      )}
                      {ev?.tag && (
                        <span className="rounded-[3px] border border-line bg-app px-1.5 py-0.5 text-ink">
                          {ev.tag}
                        </span>
                      )}
                      {ep.publicScore !== null && ep.publicScore !== undefined && (
                        <span className="rounded-[3px] border border-line bg-app px-1.5 py-0.5 text-muted">
                          Público {Number(ep.publicScore).toFixed(1)}
                        </span>
                      )}
                      {ep.jikanFiller && (
                        <span className="rounded-[3px] border border-dashed border-line bg-app px-1.5 py-0.5 text-muted">
                          Sugestão Jikan: Filler
                        </span>
                      )}
                      {isUserFiller && (
                        <span className="rounded-[3px] border border-accent/50 bg-accent/10 px-1.5 py-0.5 font-medium text-ink">
                          Filler (seu)
                        </span>
                      )}
                      {matchedArc && (
                        <span className="rounded-[3px] border border-line bg-app px-1.5 py-0.5 text-subtle">
                          Arco: {matchedArc.name}
                        </span>
                      )}
                    </div>

                    {ev?.reaction && (
                      <p className="mt-1 line-clamp-2 text-[11px] italic text-muted">
                        &ldquo;{ev.reaction}&rdquo;
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleToggleWatched(ep.number)}
                      aria-pressed={isWatched}
                      aria-label={isWatched ? `Desmarcar episódio ${ep.number}` : `Marcar episódio ${ep.number} como assistido`}
                      className={`inline-flex min-h-[44px] items-center gap-1 rounded-[4px] border px-2.5 text-[11px] font-medium ${
                        isWatched
                          ? 'border-accent bg-accent text-accent-ink'
                          : 'border-line bg-app text-ink hover:border-accent'
                      }`}
                    >
                      <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
                      <span>{isWatched ? 'Assistido' : 'Assistir'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleMarkUpToHere(ep.number)}
                      title="Marcar todos até este episódio"
                      className="min-h-[44px] rounded-[4px] border border-line bg-app px-2 text-[11px] text-muted hover:border-accent hover:text-ink"
                    >
                      Até aqui
                    </button>

                    <button
                      type="button"
                      onClick={() => openEditorForEpisode(ep.number)}
                      className="inline-flex min-h-[44px] items-center gap-1 rounded-[4px] border border-line bg-app px-2.5 text-[11px] font-medium text-ink hover:border-accent"
                    >
                      <Star className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                      <span>Avaliar</span>
                    </button>

                    {item.workType === 'anime' && (
                      <button
                        type="button"
                        onClick={() => handleToggleUserFiller(ep.number)}
                        aria-pressed={isUserFiller}
                        title="Marcar ou desmarcar filler manual"
                        className={`min-h-[44px] rounded-[4px] border px-2 text-[11px] font-medium ${
                          isUserFiller
                            ? 'border-accent bg-accent/15 text-ink'
                            : 'border-line bg-app text-subtle hover:text-ink'
                        }`}
                      >
                        Filler
                      </button>
                    )}
                  </div>
                </div>

                {!virtualWin.virtualized && editingEp === ep.number && renderEvaluationEditor(ep.number)}
              </div>
            );
          })}

          {virtualWin.virtualized && virtualWin.paddingBottom > 0 && (
            <div style={{ height: `${virtualWin.paddingBottom}px` }} aria-hidden="true" />
          )}
        </div>
      </section>

      {/* Gráfico SVG de barras + alternativa acessível em tabela */}
      {chartModel.length > 0 && (
        <section
          aria-label="Gráfico de avaliações da temporada"
          className="space-y-2.5 rounded-[6px] border border-line bg-app p-3.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
              <BarChart3 className="h-4 w-4 text-accent" strokeWidth={1.5} />
              <span>Notas da Temporada {selectedSeason} (0–10)</span>
            </div>
            <button
              type="button"
              aria-expanded={showChartTable}
              onClick={() => setShowChartTable((prev) => !prev)}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[4px] border border-line bg-card px-2.5 text-[11px] font-medium text-ink hover:border-accent"
            >
              <Table2 className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
              <span>{showChartTable ? 'Ocultar tabela' : 'Ver tabela acessível'}</span>
            </button>
          </div>

          <div className="overflow-x-auto pb-1">
            {(() => {
              const barW = 28;
              const gap = 8;
              const chartH = 112;
              const svgW = Math.max(280, 32 + chartModel.length * (barW + gap));
              return (
                <svg
                  width={svgW}
                  height={148}
                  viewBox={`0 0 ${svgW} 148`}
                  role="img"
                  aria-label={`Gráfico de barras de episódios da temporada ${selectedSeason}`}
                  className="block"
                >
                  <line x1="24" y1="14" x2="24" y2={14 + chartH} stroke="currentColor" strokeOpacity="0.25" />
                  <text x="4" y="20" fontSize="9" fill="currentColor" fillOpacity="0.7">10</text>
                  <text x="8" y={14 + chartH / 2 + 3} fontSize="9" fill="currentColor" fillOpacity="0.7">5</text>
                  <text x="8" y={14 + chartH} fontSize="9" fill="currentColor" fillOpacity="0.7">0</text>

                  {chartModel.map((bar, idx) => {
                    const x = 30 + idx * (barW + gap);
                    if (bar.isMissing) {
                      const emptyH = Math.round(chartH * 0.45);
                      const y = 14 + (chartH - emptyH);
                      return (
                        <g key={bar.key}>
                          <rect
                            x={x}
                            y={y}
                            width={barW}
                            height={emptyH}
                            rx="2"
                            fill="none"
                            stroke="currentColor"
                            strokeOpacity="0.35"
                            strokeDasharray="3 2"
                          />
                          <text
                            x={x + barW / 2}
                            y={y - 4}
                            textAnchor="middle"
                            fontSize="9"
                            fill="currentColor"
                            fillOpacity="0.55"
                          >
                            —
                          </text>
                          <text
                            x={x + barW / 2}
                            y={14 + chartH + 14}
                            textAnchor="middle"
                            fontSize="9"
                            fill="currentColor"
                            fillOpacity="0.75"
                          >
                            {bar.shortLabel}
                          </text>
                        </g>
                      );
                    }
                    const filledH = Math.max(6, Math.round((bar.rating100 / 100) * chartH));
                    const y = 14 + (chartH - filledH);
                    return (
                      <g key={bar.key}>
                        <rect
                          x={x}
                          y={y}
                          width={barW}
                          height={filledH}
                          rx="2"
                          fill="var(--accent-color)"
                        />
                        <text
                          x={x + barW / 2}
                          y={y - 4}
                          textAnchor="middle"
                          fontSize="9"
                          fontWeight="600"
                          fill="currentColor"
                        >
                          {bar.rating10}
                        </text>
                        <text
                          x={x + barW / 2}
                          y={14 + chartH + 14}
                          textAnchor="middle"
                          fontSize="9"
                          fill="currentColor"
                          fillOpacity="0.85"
                        >
                          {bar.shortLabel}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              );
            })()}
          </div>

          {showChartTable && (
            <div className="overflow-x-auto rounded-[4px] border border-line bg-card">
              <table className="w-full text-left text-[11px] tabular-nums">
                <thead className="border-b border-line bg-app text-muted">
                  <tr>
                    <th className="px-2.5 py-2 font-semibold">Ep.</th>
                    <th className="px-2.5 py-2 font-semibold">Título</th>
                    <th className="px-2.5 py-2 font-semibold">Sua nota</th>
                    <th className="px-2.5 py-2 font-semibold">Público</th>
                    <th className="px-2.5 py-2 font-semibold">Selo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {chartModel.map((row) => (
                    <tr key={row.key}>
                      <td className="px-2.5 py-1.5 font-semibold text-ink">{row.shortLabel}</td>
                      <td className="px-2.5 py-1.5 text-ink">{row.title}</td>
                      <td className="px-2.5 py-1.5 font-medium text-accent">
                        {row.rating10 !== null ? `${row.rating10}/10` : 'Sem avaliação'}
                      </td>
                      <td className="px-2.5 py-1.5 text-muted">
                        {row.publicScore !== null ? Number(row.publicScore).toFixed(1) : '—'}
                      </td>
                      <td className="px-2.5 py-1.5 text-muted">{row.tag || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Arcos (exibe APENAS quando houver arcos do usuário OU episode_groups TMDB) */}
      {hasArcSource && (
        <section
          aria-label="Arcos da história"
          className="space-y-3 rounded-[6px] border border-line bg-app p-3.5"
        >
          <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
            <Layers className="h-4 w-4 text-accent" strokeWidth={1.5} />
            <span>Arcos &amp; Episódios</span>
          </div>

          {userStoryArcs.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                Seus arcos cadastrados
              </p>
              <div className="flex flex-wrap gap-1.5">
                {userStoryArcs.map((arc) => (
                  <span
                    key={arc.id}
                    className="inline-flex items-center gap-1.5 rounded-[4px] border border-accent/40 bg-card px-2.5 py-1 text-[11px] font-medium tabular-nums text-ink"
                  >
                    <span>
                      T{arc.season} · {arc.name} (E{arc.startEp}–E{arc.endEp})
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateItem(item.id, {
                          storyArcs: userStoryArcs.filter((a) => a.id !== arc.id),
                        })
                      }
                      aria-label={`Remover arco ${arc.name}`}
                      className="flex min-h-[44px] min-w-[44px] items-center justify-center text-subtle hover:text-ink"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {userStoryArcs.length > 0 && (
            <form onSubmit={handleAddUserArc} className="grid grid-cols-1 sm:grid-cols-4 gap-1.5">
              <input
                type="text"
                value={newArcName}
                onChange={(e) => setNewArcName(e.target.value)}
                placeholder={`Novo arco (T${selectedSeason})`}
                className="min-h-[44px] sm:col-span-2 rounded-[4px] border border-line bg-card px-2.5 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
              />
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min="1"
                  max={Math.max(1, seasonEpisodes.length)}
                  value={newArcStart}
                  onChange={(e) => setNewArcStart(e.target.value)}
                  aria-label="Início do arco"
                  className="min-h-[44px] w-full rounded-[4px] border border-line bg-card px-2 text-xs tabular-nums text-ink"
                />
                <span className="text-xs text-subtle">-</span>
                <input
                  type="number"
                  min="1"
                  max={Math.max(1, seasonEpisodes.length)}
                  value={newArcEnd}
                  onChange={(e) => setNewArcEnd(e.target.value)}
                  aria-label="Fim do arco"
                  className="min-h-[44px] w-full rounded-[4px] border border-line bg-card px-2 text-xs tabular-nums text-ink"
                />
              </div>
              <button
                type="submit"
                disabled={!newArcName.trim()}
                className="min-h-[44px] rounded-[4px] bg-accent px-3 text-xs font-semibold text-accent-ink disabled:opacity-45"
              >
                + Arco
              </button>
            </form>
          )}

          {tmdbGroups.length > 0 && (
            <div className="space-y-2 border-t border-line pt-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                Sugestões de agrupamento (TMDB)
              </p>
              <div className="flex flex-wrap gap-1.5">
                {tmdbGroups.map((grp) => (
                  <button
                    key={grp.id}
                    type="button"
                    onClick={() => handleLoadSuggestedArcGroup(grp.id)}
                    className="min-h-[44px] rounded-[4px] border border-dashed border-line bg-card px-2.5 text-[11px] font-medium text-ink hover:border-accent"
                  >
                    Ver sugestão: {grp.name} ({grp.groupCount})
                  </button>
                ))}
              </div>
              {tmdbSuggestedArcs.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {tmdbSuggestedArcs.map((arc) => (
                    <span
                      key={arc.id}
                      className="rounded-[4px] border border-dashed border-line bg-card px-2 py-1 text-[10px] tabular-nums text-muted"
                    >
                      Sugestão: {arc.name} (T{arc.season} E{arc.startEp}–E{arc.endEp})
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
