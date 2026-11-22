import {
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clapperboard,
  Clock,
  Film,
  Layers,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Star,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { domainConfig } from '../config/domainConfig';
import { DNA_DIMENSIONS } from '../services/dnaScoring';
import {
  advanceEpisodeProgress,
  advanceMovieSeconds,
  calculateSmartRating,
  calculateWorkProgress,
  createDefaultReviewCriteria,
  formatFlexibleProgressMetric,
  formatSecondsToHms,
  getCompletionPace,
  getDropReasonMeta,
  getSeasonEpisodeCount,
  getTodayLocalISO,
  getVerdictForScore,
  getVerdictMeta,
  getWatchedMinutes,
  isEpisodicWork,
  makeEpisodeKey,
  normalizeEpisodeMap,
  normalizeFillerEpisodes,
  normalizeStoryArcs,
  parseTimeInputToSeconds,
} from '../utils/backlogHelpers';
import { playTactileSound } from '../utils/soundEffects';
import {
  SpoilerFreeRecapAction,
  SynthesisReviewAction,
} from './GeminiItemActions';
import { VectorIcon } from './VectorIcon';

const EPISODE_PAGE_SIZE = 50;

function MovieProgressPanel({ item, onChange }) {
  const totalSec =
    Number(item.totalSeconds) > 0
      ? Number(item.totalSeconds)
      : Number(item.durationMinutes) > 0
        ? Number(item.durationMinutes) * 60
        : 0;
  const currentSec = Math.max(0, Number(item.currentSeconds) || 0);
  const progressPct = calculateWorkProgress(item);

  const [timeDraft, setTimeDraft] = useState(() => formatSecondsToHms(currentSec));
  useEffect(() => {
    setTimeDraft(formatSecondsToHms(currentSec));
  }, [currentSec]);

  const applyTimeDraft = () => {
    const parsedSec = parseTimeInputToSeconds(timeDraft);
    const clampedSec = totalSec > 0 ? Math.min(totalSec, parsedSec) : parsedSec;
    onChange({
      currentSeconds: clampedSec,
      ...(totalSec > 0 && clampedSec >= totalSec
        ? { status: 'completed', completedDate: item.completedDate || getTodayLocalISO() }
        : {}),
    });
  };

  const handleQuickAdd = (mins) => {
    playTactileSound('page');
    const next = advanceMovieSeconds(item, mins);
    onChange({
      currentSeconds: next.currentSeconds,
      ...(next.totalSeconds && next.currentSeconds >= next.totalSeconds
        ? { status: 'completed', completedDate: item.completedDate || getTodayLocalISO() }
        : {}),
    });
  };

  const handleCompleteMovie = () => {
    playTactileSound('complete');
    onChange({
      status: 'completed',
      completedDate: item.completedDate || getTodayLocalISO(),
      currentSeconds: totalSec > 0 ? totalSec : currentSec,
    });
  };

  return (
    <div className="space-y-3 rounded-xl border border-line bg-app p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
          <Film className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
          <span>Minutagem da Sessão</span>
        </div>
        <span className="rounded-[4px] border border-accent/40 bg-accent/15 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-accent">
          {formatSecondsToHms(currentSec)}
          {totalSec > 0 ? ` / ${formatSecondsToHms(totalSec)}` : ''} · {progressPct}%
        </span>
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-card">
        <div
          className="h-full rounded-full bg-accent transition-all duration-300"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => handleQuickAdd(15)}
          className="inline-flex min-h-[44px] items-center justify-center gap-1 rounded-[4px] border border-line bg-card px-3 py-2 text-xs font-semibold tabular-nums text-ink transition-colors hover:border-accent hover:text-accent"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
          +15 min
        </button>

        <button
          type="button"
          onClick={() => handleQuickAdd(30)}
          className="inline-flex min-h-[44px] items-center justify-center gap-1 rounded-[4px] border border-line bg-card px-3 py-2 text-xs font-semibold tabular-nums text-ink transition-colors hover:border-accent hover:text-accent"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
          +30 min
        </button>

        <button
          type="button"
          onClick={handleCompleteMovie}
          className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-[4px] bg-accent px-3 py-2 text-xs font-semibold text-accent-ink transition-opacity hover:opacity-90"
        >
          <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.5} />
          <span>Concluir Sessão</span>
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
        <label className="block">
          <span className="mb-1 block text-[11px] text-muted">
            Posição atual (HH:MM:SS ou min)
          </span>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={timeDraft}
              onChange={(e) => setTimeDraft(e.target.value)}
              onBlur={applyTimeDraft}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  applyTimeDraft();
                }
              }}
              placeholder="01:14:20"
              className="min-h-[44px] w-full rounded-[4px] border border-line bg-card px-2.5 py-1.5 text-xs tabular-nums text-ink focus:border-accent focus:outline-none"
            />
          </div>
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] text-muted">
            Duração total (minutos)
          </span>
          <input
            type="number"
            min="1"
            max="1200"
            value={item.durationMinutes || (totalSec > 0 ? Math.round(totalSec / 60) : '')}
            onChange={(e) => {
              const mins = e.target.value ? Math.max(1, Number(e.target.value)) : null;
              onChange({
                durationMinutes: mins,
                totalSeconds: mins ? mins * 60 : null,
              });
            }}
            placeholder="Ex: 148"
            className="min-h-[44px] w-full rounded-[4px] border border-line bg-card px-2.5 py-1.5 text-xs tabular-nums text-ink focus:border-accent focus:outline-none"
          />
        </label>
      </div>
    </div>
  );
}

function EpisodicProgressPanel({ item, onChange }) {
  const totalSeasons = Math.max(1, Number(item.totalSeasons) || 1);
  const currentSeason = Math.max(1, Math.min(totalSeasons, Number(item.currentSeason) || 1));
  const [selectedSeason, setSelectedSeason] = useState(currentSeason);
  const [epMode, setEpMode] = useState('progress'); // 'progress' | 'filler' | 'arc'
  const [gridPage, setGridPage] = useState(0);
  const [arcName, setArcName] = useState('');
  const [arcStart, setArcStart] = useState('1');
  const [arcEnd, setArcEnd] = useState('12');

  useEffect(() => {
    setSelectedSeason(Math.max(1, Math.min(totalSeasons, Number(item.currentSeason) || 1)));
    setGridPage(0);
  }, [item.id, item.currentSeason, totalSeasons]);

  const watchedMap = useMemo(() => normalizeEpisodeMap(item.watchedEpisodes), [item.watchedEpisodes]);
  const fillerSet = useMemo(
    () => new Set(normalizeFillerEpisodes(item.fillerEpisodes)),
    [item.fillerEpisodes]
  );
  const storyArcs = useMemo(() => normalizeStoryArcs(item.storyArcs), [item.storyArcs]);

  const seasonEpCount = getSeasonEpisodeCount(item, selectedSeason);
  const totalPagesInSeason = Math.max(1, Math.ceil(seasonEpCount / EPISODE_PAGE_SIZE));
  const safePage = Math.min(totalPagesInSeason - 1, gridPage);
  const epRangeStart = safePage * EPISODE_PAGE_SIZE + 1;
  const epRangeEnd = Math.min(seasonEpCount, epRangeStart + EPISODE_PAGE_SIZE - 1);

  const progressPct = calculateWorkProgress(item);
  const metricText = formatFlexibleProgressMetric(item);

  const commitWatchedMap = (nextMap, overrideSeason = selectedSeason) => {
    const watchedEntries = Object.entries(nextMap).filter(([, st]) => st === 'watched');
    const watchedCount = watchedEntries.length;
    onChange({
      watchedEpisodes: nextMap,
      currentSeason: overrideSeason,
      currentEpisode: watchedCount > 0 ? watchedCount : item.currentEpisode || 0,
    });
  };

  const handleQuickAdvance = ({ addEpisodes = 0, addSeasons = 0 }) => {
    playTactileSound(addSeasons > 0 ? 'complete' : 'page');
    const next = advanceEpisodeProgress(item, { addEpisodes, addSeasons });
    onChange({
      currentSeason: next.currentSeason,
      currentEpisode: next.currentEpisode,
      watchedEpisodes: next.watchedEpisodes,
      ...(next.progress >= 100 && item.totalEpisodes > 0
        ? { status: 'completed', completedDate: item.completedDate || getTodayLocalISO() }
        : {}),
    });
  };

  const handleEpisodeClick = (epNum) => {
    const key = makeEpisodeKey(selectedSeason, epNum);
    if (epMode === 'filler') {
      const nextFillers = new Set(fillerSet);
      if (nextFillers.has(key)) nextFillers.delete(key);
      else nextFillers.add(key);
      onChange({ fillerEpisodes: Array.from(nextFillers) });
      return;
    }

    if (epMode === 'progress') {
      const curState = watchedMap[key] || 'pending';
      const nextState =
        curState === 'pending'
          ? 'watched'
          : curState === 'watched'
            ? 'watching'
            : 'pending';
      const nextMap = { ...watchedMap };
      if (nextState === 'pending') {
        delete nextMap[key];
      } else {
        nextMap[key] = nextState;
      }
      playTactileSound('page');
      commitWatchedMap(nextMap, selectedSeason);
    }
  };

  const handleMarkSeasonWatched = () => {
    playTactileSound('complete');
    const nextMap = { ...watchedMap };
    for (let ep = 1; ep <= seasonEpCount; ep += 1) {
      nextMap[makeEpisodeKey(selectedSeason, ep)] = 'watched';
    }
    commitWatchedMap(nextMap, selectedSeason);
  };

  const handleAddArc = (e) => {
    e.preventDefault();
    const clean = arcName.trim();
    if (!clean) return;
    const sEp = Math.max(1, Math.min(seasonEpCount, Number(arcStart) || 1));
    const eEp = Math.max(sEp, Math.min(seasonEpCount, Number(arcEnd) || sEp));
    const nextArcs = [
      ...storyArcs,
      {
        id: `arc-${Date.now()}`,
        name: clean,
        season: selectedSeason,
        startEp: sEp,
        endEp: eEp,
      },
    ];
    onChange({ storyArcs: nextArcs });
    setArcName('');
  };

  const seasonArcs = storyArcs.filter((a) => a.season === selectedSeason);

  return (
    <div className="space-y-3 rounded-xl border border-line bg-app p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
          <Clapperboard className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
          <span>Episódios &amp; Temporadas</span>
        </div>
        <span className="rounded-[4px] border border-accent/40 bg-accent/15 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-accent">
          {metricText}
        </span>
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-card">
        <div
          className="h-full rounded-full bg-accent transition-all duration-300"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => handleQuickAdvance({ addEpisodes: 1 })}
          className="inline-flex min-h-[44px] items-center justify-center gap-1 rounded-[4px] border border-line bg-card px-3 py-2 text-xs font-semibold tabular-nums text-ink transition-colors hover:border-accent hover:text-accent"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
          +1 Ep
        </button>

        <button
          type="button"
          onClick={() => handleQuickAdvance({ addEpisodes: 3 })}
          className="inline-flex min-h-[44px] items-center justify-center gap-1 rounded-[4px] border border-line bg-card px-3 py-2 text-xs font-semibold tabular-nums text-ink transition-colors hover:border-accent hover:text-accent"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
          +3 Eps
        </button>

        <button
          type="button"
          onClick={() => handleQuickAdvance({ addSeasons: 1 })}
          className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-[4px] border border-accent/45 bg-accent/15 px-3 py-2 text-xs font-semibold tabular-nums text-ink transition-colors hover:bg-accent/25"
        >
          <Layers className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
          <span>+1 Temp</span>
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <label className="block">
          <span className="mb-1 block text-[10px] text-muted">Temp. atual</span>
          <input
            type="number"
            min="1"
            max={totalSeasons}
            value={item.currentSeason || 1}
            onChange={(e) =>
              onChange({
                currentSeason: Math.max(1, Math.min(totalSeasons, Number(e.target.value) || 1)),
              })
            }
            className="min-h-[40px] w-full rounded-[4px] border border-line bg-card px-2 py-1 text-xs tabular-nums text-ink focus:border-accent focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] text-muted">Total temps.</span>
          <input
            type="number"
            min="1"
            value={item.totalSeasons || 1}
            onChange={(e) =>
              onChange({
                totalSeasons: Math.max(1, Number(e.target.value) || 1),
              })
            }
            className="min-h-[40px] w-full rounded-[4px] border border-line bg-card px-2 py-1 text-xs tabular-nums text-ink focus:border-accent focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] text-muted">Ep. assistidos</span>
          <input
            type="number"
            min="0"
            value={item.currentEpisode ?? 0}
            onChange={(e) =>
              onChange({
                currentEpisode: Math.max(0, Number(e.target.value) || 0),
              })
            }
            className="min-h-[40px] w-full rounded-[4px] border border-line bg-card px-2 py-1 text-xs tabular-nums text-ink focus:border-accent focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] text-muted">Total eps.</span>
          <input
            type="number"
            min="1"
            value={item.totalEpisodes || ''}
            onChange={(e) =>
              onChange({
                totalEpisodes: e.target.value ? Math.max(1, Number(e.target.value)) : null,
              })
            }
            placeholder="Ex: 24"
            className="min-h-[40px] w-full rounded-[4px] border border-line bg-card px-2 py-1 text-xs tabular-nums text-ink focus:border-accent focus:outline-none"
          />
        </label>
      </div>

      {/* Seletor de Temporada & Grade de Episódios */}
      <div className="space-y-2.5 border-t border-line pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1 overflow-x-auto no-scrollbar">
            {Array.from({ length: Math.min(totalSeasons, 24) }, (_, idx) => idx + 1).map(
              (seasonNum) => {
                const active = selectedSeason === seasonNum;
                return (
                  <button
                    key={seasonNum}
                    type="button"
                    onClick={() => {
                      setSelectedSeason(seasonNum);
                      setGridPage(0);
                    }}
                    className={`min-h-[38px] min-w-[42px] shrink-0 rounded-[4px] border px-2 text-xs font-semibold tabular-nums transition-colors ${
                      active
                        ? 'border-accent bg-accent text-accent-ink'
                        : 'border-line bg-card text-muted hover:text-ink'
                    }`}
                  >
                    T{seasonNum}
                  </button>
                );
              }
            )}
          </div>

          <div
            role="group"
            aria-label="Modo da grade de episódios"
            className="inline-flex rounded-[4px] border border-line bg-card p-0.5"
          >
            {[
              { id: 'progress', label: 'Status' },
              { id: 'filler', label: 'Fillers' },
              { id: 'arc', label: 'Arcos' },
            ].map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={epMode === m.id}
                onClick={() => setEpMode(m.id)}
                className={`min-h-[34px] rounded-[2px] px-2.5 py-1 text-[10px] font-semibold transition-colors ${
                  epMode === m.id
                    ? 'bg-accent text-accent-ink'
                    : 'text-muted hover:text-ink'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {epMode === 'filler' && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-line bg-card px-2.5 py-2 text-[11px]">
            <span className="text-muted">
              Toque nos episódios para marcar/desmarcar como filler ({fillerSet.size}).
            </span>
            <label className="flex min-h-[32px] cursor-pointer items-center gap-1.5 font-medium text-ink">
              <input
                type="checkbox"
                checked={Boolean(item.ignoreFillersInProgress)}
                onChange={(e) =>
                  onChange({ ignoreFillersInProgress: e.target.checked })
                }
                className="h-4 w-4 accent-[var(--accent-color)]"
              />
              <span>Ignorar fillers no %</span>
            </label>
          </div>
        )}

        {epMode === 'arc' && (
          <div className="space-y-2 rounded-[4px] border border-line bg-card p-2.5">
            <form onSubmit={handleAddArc} className="grid grid-cols-1 sm:grid-cols-4 gap-1.5">
              <input
                type="text"
                value={arcName}
                onChange={(e) => setArcName(e.target.value)}
                placeholder={`Nome do arco (T${selectedSeason})`}
                className="min-h-[38px] sm:col-span-2 rounded-[4px] border border-line bg-app px-2.5 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
              />
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min="1"
                  max={seasonEpCount}
                  value={arcStart}
                  onChange={(e) => setArcStart(e.target.value)}
                  aria-label="Episódio inicial do arco"
                  className="min-h-[38px] w-full rounded-[4px] border border-line bg-app px-2 text-xs tabular-nums text-ink focus:border-accent focus:outline-none"
                />
                <span className="text-xs text-subtle">-</span>
                <input
                  type="number"
                  min="1"
                  max={seasonEpCount}
                  value={arcEnd}
                  onChange={(e) => setArcEnd(e.target.value)}
                  aria-label="Episódio final do arco"
                  className="min-h-[38px] w-full rounded-[4px] border border-line bg-app px-2 text-xs tabular-nums text-ink focus:border-accent focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={!arcName.trim()}
                className="min-h-[38px] rounded-[4px] bg-accent px-2.5 text-xs font-semibold text-accent-ink disabled:opacity-45"
              >
                + Arco
              </button>
            </form>

            {seasonArcs.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {seasonArcs.map((arc) => (
                  <span
                    key={arc.id}
                    className="inline-flex items-center gap-1.5 rounded-[4px] border border-accent/40 bg-accent/10 px-2 py-1 text-[10px] font-medium tabular-nums text-ink"
                  >
                    <span>
                      {arc.name} (E{arc.startEp}–E{arc.endEp})
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        onChange({
                          storyArcs: storyArcs.filter((a) => a.id !== arc.id),
                        })
                      }
                      aria-label={`Remover arco ${arc.name}`}
                      className="text-subtle hover:text-ink"
                    >
                      <Trash2 className="h-3 w-3" strokeWidth={1.5} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {totalPagesInSeason > 1 && (
          <div className="flex flex-wrap items-center gap-1">
            {Array.from({ length: totalPagesInSeason }, (_, p) => {
              const pStart = p * EPISODE_PAGE_SIZE + 1;
              const pEnd = Math.min(seasonEpCount, pStart + EPISODE_PAGE_SIZE - 1);
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setGridPage(p)}
                  className={`min-h-[34px] rounded-[4px] border px-2 text-[10px] font-medium tabular-nums ${
                    safePage === p
                      ? 'border-accent bg-accent/15 text-accent'
                      : 'border-line bg-card text-muted'
                  }`}
                >
                  E{pStart}–{pEnd}
                </button>
              );
            })}
          </div>
        )}

        <div className="grid grid-cols-5 sm:grid-cols-6 gap-1.5">
          {Array.from(
            { length: Math.max(0, epRangeEnd - epRangeStart + 1) },
            (_, idx) => epRangeStart + idx
          ).map((epNum) => {
            const key = makeEpisodeKey(selectedSeason, epNum);
            const st = watchedMap[key] || 'pending';
            const isFiller = fillerSet.has(key);
            const matchedArc = seasonArcs.find(
              (a) => epNum >= a.startEp && epNum <= a.endEp
            );

            return (
              <button
                key={key}
                type="button"
                onClick={() => handleEpisodeClick(epNum)}
                title={[
                  `T${selectedSeason}E${epNum}`,
                  st === 'watched' ? 'Assistido' : st === 'watching' ? 'Assistindo' : 'Pendente',
                  isFiller ? 'Filler' : '',
                  matchedArc ? `Arco: ${matchedArc.name}` : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
                className={`relative flex min-h-[44px] flex-col items-center justify-center rounded-[4px] border px-1 py-1 text-xs font-semibold tabular-nums transition-colors ${
                  st === 'watched'
                    ? 'border-accent bg-accent/20 text-ink'
                    : st === 'watching'
                      ? 'border-dashed border-accent bg-card text-accent'
                      : 'border-line bg-card text-muted hover:border-accent/60 hover:text-ink'
                }`}
              >
                <span>{String(epNum).padStart(2, '0')}</span>
                <span className="flex items-center gap-0.5 text-[9px] leading-none">
                  {st === 'watched' && <Check className="h-2.5 w-2.5 text-accent" strokeWidth={2} />}
                  {st === 'watching' && <Play className="h-2.5 w-2.5 text-accent" strokeWidth={2} />}
                  {isFiller && <span className="font-bold text-amber-500">F</span>}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[10px] text-subtle">
          <span>Legenda: borda sólida = assistido · tracejada = assistindo · F = filler</span>
          <button
            type="button"
            onClick={handleMarkSeasonWatched}
            className="min-h-[34px] rounded-[4px] border border-line bg-card px-2.5 py-1 font-medium text-ink hover:border-accent"
          >
            Marcar T{selectedSeason} completa
          </button>
        </div>
      </div>
    </div>
  );
}

export function TactileStatusFields({
  item,
  onChange,
  showAiActions = false,
  geminiKey = '',
  linkedPosts = [],
  readerDna = null,
  onOpenGeminiSettings,
  onOpenJournal,
}) {
  const [dnaReviewOpen, setDnaReviewOpen] = useState(
    () => item.status === 'completed' || item.status === 'rewatching'
  );

  const status = item.status || 'queued';
  const episodic = isEpisodicWork(item);
  const hypeOptions = domainConfig.tactileOptions.hypeLevels || [];
  const dropReasons = domainConfig.tactileOptions.dropReasons || [];
  const verdicts = domainConfig.tactileOptions.verdicts || [];

  const criteria = item.reviewCriteria || createDefaultReviewCriteria(item.rating ?? 80);
  const rewatchCount = Math.max(0, Number(item.rewatchCount) || 0);
  const watchedMins = getWatchedMinutes(item);
  const pace = getCompletionPace(item.startDate, item.completedDate, watchedMins);

  const handleCriteriaChange = (dimId, rawVal) => {
    const numVal = Math.max(0, Math.min(100, Math.round(Number(rawVal) || 0)));
    const nextCriteria = { ...criteria, [dimId]: numVal };
    const nextRating = calculateSmartRating(nextCriteria, readerDna);
    const nextVerdict = getVerdictForScore(nextRating);
    onChange({
      reviewCriteria: nextCriteria,
      rating: nextRating,
      ratingSource: 'manual',
      ...(nextVerdict ? { verdict: nextVerdict } : {}),
    });
  };

  const handleStartRewatch = () => {
    playTactileSound('page');
    onChange({
      status: 'rewatching',
      rewatchCount: rewatchCount + 1,
      ...(episodic ? { currentSeason: 1, currentEpisode: 0, watchedEpisodes: {} } : { currentSeconds: 0 }),
    });
  };

  return (
    <div className="space-y-4">
      {showAiActions &&
        (status === 'playing' || status === 'paused' || status === 'rewatching') && (
          <SpoilerFreeRecapAction
            item={item}
            linkedPosts={linkedPosts}
            geminiKey={geminiKey}
            onOpenGeminiSettings={onOpenGeminiSettings}
          />
        )}

      {/* Controle de Progresso Tátil por Tipo */}
      {status !== 'queued' && status !== 'dropped' && (
        episodic ? (
          <EpisodicProgressPanel item={item} onChange={onChange} />
        ) : (
          <MovieProgressPanel item={item} onChange={onChange} />
        )
      )}

      {status === 'queued' && (
        <div className="space-y-3 rounded-xl border border-line bg-app p-3.5">
          <div>
            <p className="mb-2 text-xs font-medium text-muted">Prioridade na fila Quero Ver</p>
            <div className="flex flex-wrap gap-1.5">
              {hypeOptions.map((opt) => {
                const selected = (item.hype || 'medium') === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onChange({ hype: opt.id })}
                    className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-[4px] border px-2.5 py-1 text-xs font-medium transition-colors ${
                      selected
                        ? 'border-accent bg-accent/15 text-ink'
                        : 'border-line bg-card text-muted hover:text-ink'
                    }`}
                  >
                    <VectorIcon name={opt.icon} className="h-3.5 w-3.5 text-accent" />
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {episodic ? (
              <label className="block">
                <span className="mb-1 block text-[11px] text-muted">Total de episódios</span>
                <input
                  type="number"
                  min="1"
                  value={item.totalEpisodes || ''}
                  onChange={(e) =>
                    onChange({
                      totalEpisodes: e.target.value ? Math.max(1, Number(e.target.value)) : null,
                    })
                  }
                  placeholder="Ex: 12"
                  className="min-h-[40px] w-full rounded-[4px] border border-line bg-card px-2.5 text-xs tabular-nums text-ink focus:border-accent focus:outline-none"
                />
              </label>
            ) : (
              <label className="block">
                <span className="mb-1 block text-[11px] text-muted">Duração (min)</span>
                <input
                  type="number"
                  min="1"
                  value={item.durationMinutes || ''}
                  onChange={(e) => {
                    const mins = e.target.value ? Math.max(1, Number(e.target.value)) : null;
                    onChange({
                      durationMinutes: mins,
                      totalSeconds: mins ? mins * 60 : null,
                    });
                  }}
                  placeholder="Ex: 120"
                  className="min-h-[40px] w-full rounded-[4px] border border-line bg-card px-2.5 text-xs tabular-nums text-ink focus:border-accent focus:outline-none"
                />
              </label>
            )}
            <div className="flex items-end">
              <button
                type="button"
                onClick={() =>
                  onChange({
                    status: 'playing',
                    startDate: item.startDate || getTodayLocalISO(),
                  })
                }
                className="inline-flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-[4px] bg-accent px-3 text-xs font-semibold text-accent-ink"
              >
                <Play className="h-3.5 w-3.5" strokeWidth={1.5} />
                <span>Iniciar Sessão</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {status === 'paused' && (
        <div className="space-y-2.5 rounded-xl border border-line bg-app p-3.5">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink">
              <Pause className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
              <span>Sessão em Pausa</span>
            </span>
            <button
              type="button"
              onClick={() => onChange({ status: 'playing' })}
              className="min-h-[36px] rounded-[4px] bg-accent px-3 text-xs font-semibold text-accent-ink"
            >
              Retomar Sessão
            </button>
          </div>
          <input
            type="text"
            value={item.checkpoint || ''}
            onChange={(e) => onChange({ checkpoint: e.target.value })}
            placeholder="Em qual cena / episódio pausou?"
            className="min-h-[40px] w-full rounded-[4px] border border-line bg-card px-2.5 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
          />
        </div>
      )}

      {status === 'dropped' && (
        <div className="space-y-2.5 rounded-xl border border-line bg-app p-3.5">
          <p className="text-xs font-medium text-muted">Motivo de ter deixado</p>
          <div className="grid grid-cols-2 gap-1.5">
            {dropReasons.map((reason) => {
              const selected =
                item.dropReason === reason.id ||
                getDropReasonMeta(item.dropReason)?.id === reason.id;
              return (
                <button
                  key={reason.id}
                  type="button"
                  onClick={() => onChange({ dropReason: reason.id })}
                  className={`flex min-h-[40px] items-center gap-1.5 rounded-[4px] border px-2.5 py-1.5 text-left text-xs font-medium transition-colors ${
                    selected
                      ? 'border-accent bg-accent/15 text-ink'
                      : 'border-line bg-card text-muted hover:text-ink'
                  }`}
                >
                  <VectorIcon name={reason.icon} className="h-3.5 w-3.5 text-accent" />
                  <span className="truncate">{reason.label}</span>
                </button>
              );
            })}
          </div>
          <input
            type="text"
            value={item.checkpoint || ''}
            onChange={(e) => onChange({ checkpoint: e.target.value })}
            placeholder="Onde parou antes de abandonar (ex: Ep. 4 · 00:42:10)?"
            className="min-h-[40px] w-full rounded-[4px] border border-line bg-card px-2.5 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
          />
        </div>
      )}

      {/* Rewatch #N, Formato de Mídia & Áudio */}
      <div className="space-y-3 rounded-xl border border-line bg-app p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <RotateCcw className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
            <span className="text-xs font-semibold tabular-nums text-ink">
              Rewatch #{rewatchCount}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onChange({ rewatchCount: Math.max(0, rewatchCount - 1) })}
              disabled={rewatchCount <= 0}
              aria-label="Diminuir contador de rewatch"
              className="min-h-[36px] min-w-[36px] rounded-[4px] border border-line bg-card text-xs font-semibold text-ink disabled:opacity-40"
            >
              -1
            </button>
            <button
              type="button"
              onClick={() => onChange({ rewatchCount: rewatchCount + 1 })}
              aria-label="Aumentar contador de rewatch"
              className="min-h-[36px] min-w-[36px] rounded-[4px] border border-line bg-card text-xs font-semibold text-ink hover:border-accent"
            >
              +1
            </button>
            {status === 'completed' && (
              <button
                type="button"
                onClick={handleStartRewatch}
                className="min-h-[36px] rounded-[4px] border border-accent/50 bg-accent/15 px-2.5 text-xs font-semibold text-accent hover:bg-accent/25"
              >
                Reassistir Agora
              </button>
            )}
          </div>
        </div>

        <div className="space-y-2 border-t border-line pt-2.5">
          <div>
            <p className="mb-1.5 text-[11px] font-medium text-muted">Exibição / Mídia</p>
            <div className="flex flex-wrap gap-1.5">
              {domainConfig.mediaFormats.map((fmt) => {
                const active = item.format === fmt;
                return (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => onChange({ format: fmt })}
                    className={`min-h-[36px] rounded-[4px] border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      active
                        ? 'border-accent bg-accent/15 text-ink'
                        : 'border-line bg-card text-muted hover:text-ink'
                    }`}
                  >
                    {fmt}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-medium text-muted">Áudio / Edição</p>
            <div className="flex flex-wrap gap-1.5">
              {(domainConfig.audioFormatTags || ['Legendado', 'Dublado', 'Original', 'IMAX/4K']).map(
                (tag) => {
                  const active = item.audioFormat === tag;
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => onChange({ audioFormat: active ? '' : tag })}
                      className={`min-h-[36px] rounded-[4px] border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        active
                          ? 'border-accent bg-accent/15 text-ink'
                          : 'border-line bg-card text-muted hover:text-ink'
                      }`}
                    >
                      {tag}
                    </button>
                  );
                }
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 border-t border-line pt-2.5">
          <label className="block">
            <span className="mb-1 flex items-center gap-1 text-[10px] text-muted">
              <Calendar className="h-3 w-3" strokeWidth={1.5} />
              Início
            </span>
            <input
              type="date"
              value={item.startDate ? String(item.startDate).slice(0, 10) : ''}
              onChange={(e) => onChange({ startDate: e.target.value || null })}
              className="min-h-[38px] w-full rounded-[4px] border border-line bg-card px-2 text-xs text-ink focus:border-accent focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 flex items-center gap-1 text-[10px] text-muted">
              <Clock className="h-3 w-3" strokeWidth={1.5} />
              Conclusão {pace ? `(${pace.label})` : ''}
            </span>
            <input
              type="date"
              value={item.completedDate ? String(item.completedDate).slice(0, 10) : ''}
              onChange={(e) => onChange({ completedDate: e.target.value || null })}
              className="min-h-[38px] w-full rounded-[4px] border border-line bg-card px-2 text-xs text-ink focus:border-accent focus:outline-none"
            />
          </label>
        </div>
      </div>

      {/* Avaliação DNA do Espectador (8 Dimensões) & Veredito */}
      <div className="rounded-xl border border-line bg-app overflow-hidden">
        <button
          type="button"
          onClick={() => setDnaReviewOpen((v) => !v)}
          aria-expanded={dnaReviewOpen}
          className="flex min-h-[44px] w-full items-center justify-between px-3.5 py-2.5 text-left hover:bg-card/50"
        >
          <span className="flex items-center gap-2 text-xs font-semibold text-ink">
            <Star className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
            <span>Avaliação DNA (8 Dimensões)</span>
            {typeof item.rating === 'number' && (
              <span
                className={`rounded-[4px] border px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
                  item.ratingSource === 'legacy-default'
                    ? 'border-dashed border-line bg-card text-muted opacity-75'
                    : 'border-accent/40 bg-accent/15 text-accent'
                }`}
              >
                {item.rating}/100
                {item.ratingSource === 'legacy-default' ? ' · nota padrão' : ''}
              </span>
            )}
          </span>
          {dnaReviewOpen ? (
            <ChevronUp className="h-4 w-4 text-muted" strokeWidth={1.5} />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted" strokeWidth={1.5} />
          )}
        </button>

        {dnaReviewOpen && (
          <div className="space-y-3 border-t border-line p-3.5">
            {item.ratingSource === 'legacy-default' && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-dashed border-line bg-card px-3 py-2 text-[11px] text-muted">
                <span>
                  Esta nota 80 foi herdada automaticamente como padrão e não entra nas suas médias.
                </span>
                <button
                  type="button"
                  onClick={() =>
                    onChange({
                      rating: item.rating ?? 80,
                      ratingSource: 'manual',
                      verdict: item.verdict || getVerdictForScore(item.rating ?? 80),
                    })
                  }
                  className="min-h-[44px] rounded-[4px] border border-accent bg-accent/10 px-3 text-[11px] font-semibold text-accent hover:bg-accent hover:text-accent-ink"
                >
                  Confirmar nota {item.rating ?? 80}
                </button>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] text-muted">
                Ajuste os 8 critérios para calcular a nota ponderada pelo seu DNA:
              </span>
              <input
                type="number"
                min="0"
                max="100"
                aria-label="Nota final de 0 a 100"
                value={item.rating ?? ''}
                onChange={(e) => {
                  const val =
                    e.target.value === ''
                      ? null
                      : Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0)));
                  const verdict = val !== null ? getVerdictForScore(val) : null;
                  onChange({
                    rating: val,
                    ratingSource: val !== null ? 'manual' : null,
                    ...(verdict ? { verdict } : { verdict: null }),
                  });
                }}
                placeholder="0–100"
                className="min-h-[38px] w-20 rounded-[4px] border border-line bg-card px-2 text-center text-xs font-semibold tabular-nums text-ink focus:border-accent focus:outline-none"
              />
            </div>

            <div className="space-y-2.5">
              {DNA_DIMENSIONS.map((dim) => {
                const val = Number(criteria[dim.id] ?? 80);
                return (
                  <label key={dim.id} className="block space-y-1">
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="font-medium text-ink">{dim.label}</span>
                      <span className="font-semibold tabular-nums text-accent">{val}</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      value={val}
                      onChange={(e) => handleCriteriaChange(dim.id, e.target.value)}
                      aria-label={dim.label}
                      className="h-2 w-full cursor-pointer accent-[var(--accent-color)]"
                    />
                  </label>
                );
              })}
            </div>

            <div className="space-y-1.5 border-t border-line pt-2.5">
              <span className="block text-[11px] font-medium text-muted">Veredito de Cabine</span>
              <div className="flex flex-wrap gap-1.5">
                {verdicts.map((v) => {
                  const active =
                    item.verdict === v.id ||
                    getVerdictMeta(item.verdict)?.id === v.id;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => onChange({ verdict: v.id })}
                      className={`inline-flex min-h-[36px] items-center gap-1 rounded-[4px] border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        active
                          ? 'border-accent bg-accent/15 text-ink'
                          : 'border-line bg-card text-muted hover:text-ink'
                      }`}
                    >
                      <VectorIcon name={v.icon} className="h-3 w-3 text-accent" />
                      <span>{v.id}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {onOpenJournal && (
              <button
                type="button"
                onClick={onOpenJournal}
                className="inline-flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-[4px] border border-line bg-card px-3 text-xs font-medium text-ink hover:border-accent"
              >
                <Sparkles className="h-3.5 w-3.5 text-accent" strokeWidth={1.5} />
                <span>Registrar entrada no Diário de Sessões</span>
              </button>
            )}
          </div>
        )}
      </div>

      {showAiActions && (status === 'completed' || status === 'rewatching') && (
        <SynthesisReviewAction
          item={item}
          linkedPosts={linkedPosts}
          geminiKey={geminiKey}
          onApplyText={onChange}
          onOpenGeminiSettings={onOpenGeminiSettings}
        />
      )}
    </div>
  );
}
