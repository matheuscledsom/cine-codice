import { ChevronDown, ChevronRight, Disc3, EyeOff, Music, RefreshCw, User } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  MUSIC_SCOPE_OPTIONS,
  buildMusicHierarchy,
} from '../lib/musicHierarchy.js';
import { fetchMusicBrainzArtistStudioAlbums } from '../services/musicDepthService.js';
import { formatTrackDuration } from '../services/multiDomainSearchService.js';
import { computeAlbumTrackRatingPatch } from '../utils/catalogDraftHelpers.js';
import { CoverArt } from './CoverArt';
import { StarRatingDisplay } from './StarRatingPicker';

const MB_EXCLUDED_STORAGE_KEY = 'omniprism_mb_excluded_albums_v1';

function readExcludedMap() {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(MB_EXCLUDED_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeExcludedMap(nextMap) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(MB_EXCLUDED_STORAGE_KEY, JSON.stringify(nextMap));
    }
  } catch {
    // Ignora quota
  }
}

export function MusicDiscographyView({
  items = [],
  onSelectItem,
  onUpdateItem,
  onOpenEntity,
  onShowToast,
}) {
  const [activeScope, setActiveScope] = useState('all');
  const [expandedArtists, setExpandedArtists] = useState({});
  const [expandedReleases, setExpandedReleases] = useState({});
  const [mbAlbumsByArtist, setMbAlbumsByArtist] = useState({});
  const [loadingMbByArtist, setLoadingMbByArtist] = useState({});
  const [excludedByArtist, setExcludedByArtist] = useState(() => readExcludedMap());

  const hierarchy = useMemo(
    () =>
      buildMusicHierarchy(items, {
        scope: activeScope,
        mbStudioAlbumsByArtist: mbAlbumsByArtist,
        excludedAlbumKeysByArtist: excludedByArtist,
      }),
    [items, activeScope, mbAlbumsByArtist, excludedByArtist]
  );

  const toggleArtist = (artistId) => {
    setExpandedArtists((prev) => ({
      ...prev,
      [artistId]: prev[artistId] === undefined ? false : !prev[artistId],
    }));
  };

  const toggleRelease = (releaseId) => {
    setExpandedReleases((prev) => ({
      ...prev,
      [releaseId]: !prev[releaseId],
    }));
  };

  const handleLoadMusicBrainzCompleteness = async (artist) => {
    if (!artist?.id || loadingMbByArtist[artist.id]) return;
    setLoadingMbByArtist((prev) => ({ ...prev, [artist.id]: true }));
    try {
      const res = await fetchMusicBrainzArtistStudioAlbums(artist.artistName);
      setMbAlbumsByArtist((prev) => ({ ...prev, [artist.id]: res }));
      if (!res.available) {
        onShowToast?.({
          message: `MusicBrainz indisponível para "${artist.artistName}". Exibindo apenas a contagem local.`,
          type: 'info',
        });
      }
    } finally {
      setLoadingMbByArtist((prev) => ({ ...prev, [artist.id]: false }));
    }
  };

  const handleToggleExcludeAlbum = (artistId, excludeKey, linkedWork = null) => {
    if (linkedWork?.id && onUpdateItem) {
      const nextExcluded = !linkedWork.excludeFromDiscography;
      onUpdateItem(linkedWork.id, { excludeFromDiscography: nextExcluded });
      onShowToast?.({
        message: nextExcluded
          ? `"${linkedWork.title}" marcado como "não conta" na completude.`
          : `"${linkedWork.title}" incluído novamente na completude.`,
        type: 'info',
      });
    }
    if (!excludeKey) return;
    setExcludedByArtist((prev) => {
      const list = Array.isArray(prev[artistId]) ? prev[artistId] : [];
      const exists = list.includes(excludeKey);
      const nextList = exists
        ? list.filter((k) => k !== excludeKey)
        : [...list, excludeKey];
      const nextMap = { ...prev, [artistId]: nextList };
      writeExcludedMap(nextMap);
      return nextMap;
    });
  };

  const handleRateTrack = (work, track, trackIdx, score10) => {
    if (!onUpdateItem || !work?.id) return;
    const result = computeAlbumTrackRatingPatch(work, track, trackIdx, score10);
    if (!result) return;
    // Avaliar faixa NUNCA sobrescreve a estrela manual do álbum
    onUpdateItem(work.id, result.patch);
    onShowToast?.({
      message: result.toastMessage,
      type: 'info',
      duration: 6000,
      action: {
        label: 'Desfazer',
        onClick: () => onUpdateItem(work.id, result.undoSnapshot),
      },
    });
  };

  return (
    <section
      aria-label="Discografia por Banda e Artista"
      data-testid="music-discography-view"
      className="space-y-4"
    >
      {/* Escopos transparentes de discografia */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="tablist"
          aria-label="Escopo da discografia"
          className="flex flex-wrap gap-1.5"
        >
          {MUSIC_SCOPE_OPTIONS.map((opt) => {
            const active = activeScope === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveScope(opt.id)}
                className={`min-h-[44px] rounded-[6px] border px-3 text-xs font-semibold transition-colors ${
                  active
                    ? 'border-accent bg-accent text-accent-ink'
                    : 'border-line bg-card text-muted hover:text-ink'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        <span className="text-xs tabular-nums text-muted">
          {hierarchy.totals.artistsCount}{' '}
          {hierarchy.totals.artistsCount === 1 ? 'artista' : 'artistas'} ·{' '}
          {hierarchy.totals.completedReleasesCount} ouvidos ({hierarchy.totals.releasesCount} no catálogo)
        </span>
      </div>

      {hierarchy.artists.length === 0 ? (
        <p className="border-y border-line py-6 text-sm text-muted">
          Nenhum lançamento musical neste escopo ainda.
        </p>
      ) : (
        <div className="divide-y divide-line border-y border-line">
          {hierarchy.artists.map((artist) => {
            const isOpen = expandedArtists[artist.id] !== false;
            const comp = artist.completeness;
            const derivedDiscog = artist.derivedAlbumsAverage;
            const isLoadingMb = Boolean(loadingMbByArtist[artist.id]);

            return (
              <div key={artist.id} className="py-3.5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => toggleArtist(artist.id)}
                    aria-expanded={isOpen}
                    className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2.5 text-left"
                  >
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.5} />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.5} />
                    )}
                    <div className="min-w-0 flex-1">
                      <h3 className="font-editorial truncate text-base font-semibold text-ink">
                        {artist.artistName}
                      </h3>
                      <p className="text-xs tabular-nums text-muted">
                        {comp?.mode === 'musicbrainz'
                          ? `${comp.label} (${comp.pct}%) · ${comp.sourceLabel}`
                          : comp?.label || `${artist.activeProgress.completed} concluído(s) · ${artist.activeProgress.total} no catálogo`}
                      </p>
                      {derivedDiscog?.average !== null && (
                        <p className="text-[11px] tabular-nums text-subtle">
                          Média derivada: {derivedDiscog.average}/5 ({derivedDiscog.coverageLabel}
                          {derivedDiscog.provisional ? ' · provisória' : ''})
                        </p>
                      )}
                    </div>
                  </button>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleLoadMusicBrainzCompleteness(artist)}
                      disabled={isLoadingMb}
                      data-testid="musicbrainz-completeness-btn"
                      className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-[6px] border border-line bg-card px-3 text-xs font-medium text-ink hover:border-accent disabled:opacity-55"
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 text-accent ${isLoadingMb ? 'animate-spin' : ''}`}
                        strokeWidth={1.5}
                      />
                      <span>Completude (MusicBrainz)</span>
                    </button>

                    {onOpenEntity && (
                      <button
                        type="button"
                        onClick={() =>
                          onOpenEntity({
                            name: artist.artistName,
                            role: 'artist',
                            domain: 'music',
                          })
                        }
                        className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-[6px] border border-line bg-card px-3 text-xs font-medium text-ink hover:border-muted"
                      >
                        <User className="h-3.5 w-3.5 text-muted" strokeWidth={1.5} />
                        <span>Artista</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Barra de completude exibida SOMENTE quando o total vem do MusicBrainz */}
                {comp?.mode === 'musicbrainz' && typeof comp.pct === 'number' && (
                  <div className="space-y-2" data-testid="musicbrainz-completeness-panel">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
                      <div
                        className="h-full bg-accent transition-all duration-200"
                        style={{ width: `${Math.min(100, comp.pct)}%` }}
                      />
                    </div>
                    {comp.items.length > 0 && (
                      <div className="divide-y divide-line rounded-[6px] border border-line bg-app">
                        {comp.items.map((mbItem) => (
                          <div
                            key={mbItem.key}
                            className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs ${
                              mbItem.excluded ? 'opacity-60' : ''
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium text-ink">
                                {mbItem.title}
                                {mbItem.releaseYear ? ` (${mbItem.releaseYear})` : ''}
                              </p>
                              <p className="text-[11px] text-subtle">
                                {mbItem.excluded
                                  ? 'Marcado como "não conta"'
                                  : mbItem.completed
                                    ? 'Ouvido no catálogo'
                                    : mbItem.inCatalog
                                      ? 'No catálogo'
                                      : 'Não catalogado · MusicBrainz'}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                handleToggleExcludeAlbum(
                                  artist.id,
                                  mbItem.excludeKey,
                                  mbItem.work
                                )
                              }
                              aria-pressed={mbItem.excluded}
                              className={`inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-[6px] border px-2.5 text-[11px] font-medium ${
                                mbItem.excluded
                                  ? 'border-accent bg-accent/15 text-ink'
                                  : 'border-line bg-card text-muted hover:text-ink'
                              }`}
                            >
                              <EyeOff className="h-3.5 w-3.5" strokeWidth={1.5} />
                              <span>{mbItem.excluded ? 'Voltar a contar' : 'Não conta'}</span>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {isOpen && (
                  <div className="space-y-2.5 pl-2 sm:pl-5">
                    {artist.releases.map((rel) => {
                      const tracksOpen = Boolean(expandedReleases[rel.id]);
                      const scopeLabel =
                        rel.scope === 'studio'
                          ? 'Estúdio'
                          : rel.scope === 'eps_singles'
                            ? 'EP / Single'
                            : 'Ao Vivo / Coletânea';
                      const derived = rel.derivedTracksAverage;

                      return (
                        <div
                          key={rel.id}
                          className="rounded-[6px] border border-line bg-card p-3 space-y-2.5"
                        >
                          <div className="flex items-start gap-3">
                            <button
                              type="button"
                              onClick={() => onSelectItem?.(rel.work)}
                              className="w-14 shrink-0 overflow-hidden rounded-[6px]"
                            >
                              <CoverArt
                                item={rel.work}
                                compact
                                className="aspect-square w-full rounded-[6px]"
                              />
                            </button>

                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <button
                                  type="button"
                                  onClick={() => onSelectItem?.(rel.work)}
                                  className="min-w-0 text-left"
                                >
                                  <p className="font-editorial truncate text-sm font-semibold text-ink hover:text-accent">
                                    {rel.title}
                                  </p>
                                </button>
                                <StarRatingDisplay work={rel.work} size="sm" showNumeric />
                              </div>

                              <p className="text-xs tabular-nums text-muted">
                                {[
                                  rel.releaseYear || null,
                                  scopeLabel,
                                  rel.totalTracks > 0 ? `${rel.totalTracks} faixas` : null,
                                  rel.work?.excludeFromDiscography ? 'Não conta na completude' : null,
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </p>

                              {derived && derived.average !== null && (
                                <p className="text-[11px] tabular-nums text-subtle">
                                  Média das faixas: {derived.average}/10 ({derived.coverageLabel}
                                  {derived.provisional ? ' · provisória' : ''})
                                </p>
                              )}
                            </div>

                            {rel.totalTracks > 0 && (
                              <button
                                type="button"
                                onClick={() => toggleRelease(rel.id)}
                                aria-expanded={tracksOpen}
                                className="inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-[6px] border border-line bg-app px-2.5 text-xs font-medium text-ink"
                              >
                                <Disc3 className="h-3.5 w-3.5 text-muted" strokeWidth={1.5} />
                                <span>Faixas</span>
                              </button>
                            )}
                          </div>

                          {tracksOpen && rel.tracks.length > 0 && (
                            <div className="divide-y divide-line border-t border-line pt-2">
                              {rel.tracks.map((tr) => (
                                <div
                                  key={tr.key}
                                  className="flex flex-wrap items-center justify-between gap-2 py-1.5"
                                >
                                  <div className="flex min-w-0 flex-1 items-center gap-2">
                                    <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-subtle">
                                      {tr.number}.
                                    </span>
                                    <Music className="h-3 w-3 shrink-0 text-subtle" strokeWidth={1.5} />
                                    <span className="truncate text-xs text-ink">{tr.title}</span>
                                    {tr.durationMs && (
                                      <span className="shrink-0 text-[11px] tabular-nums text-subtle">
                                        {formatTrackDuration(tr.durationMs)}
                                      </span>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-1">
                                    {[6, 7, 8, 9, 10].map((score) => {
                                      const active = tr.rating10 === score;
                                      return (
                                        <button
                                          key={score}
                                          type="button"
                                          onClick={() =>
                                            handleRateTrack(rel.work, tr, tr.index, score)
                                          }
                                          aria-label={`Nota ${score} para faixa ${tr.title}`}
                                          aria-pressed={active}
                                          className={`min-h-[44px] min-w-[36px] rounded-[6px] border text-xs font-semibold tabular-nums transition-colors ${
                                            active
                                              ? 'border-accent bg-accent text-accent-ink'
                                              : 'border-line bg-app text-muted hover:text-ink'
                                          }`}
                                        >
                                          {score}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
