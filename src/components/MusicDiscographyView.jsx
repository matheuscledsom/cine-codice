import { ChevronDown, ChevronRight, Disc3, Music, User } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  MUSIC_SCOPE_OPTIONS,
  buildMusicHierarchy,
} from '../lib/musicHierarchy.js';
import { computeAlbumTrackRatingPatch } from '../utils/catalogDraftHelpers.js';
import { formatTrackDuration } from '../services/multiDomainSearchService.js';
import { CoverArt } from './CoverArt';
import { StarRatingDisplay } from './StarRatingPicker';

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

  const hierarchy = useMemo(
    () => buildMusicHierarchy(items, { scope: activeScope }),
    [items, activeScope]
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

  const handleRateTrack = (work, track, trackIdx, score10) => {
    if (!onUpdateItem || !work?.id) return;
    const result = computeAlbumTrackRatingPatch(work, track, trackIdx, score10);
    if (!result) return;
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
          {hierarchy.totals.completedReleasesCount}/{hierarchy.totals.releasesCount} ouvidos
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
            const studioProg = artist.scopeCounts.studio;
            const totalProg = artist.scopeCounts.all;
            return (
              <div key={artist.id} className="py-3.5 space-y-3">
                <div className="flex items-center justify-between gap-2">
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
                        Estúdio: {studioProg.completed}/{studioProg.total} · Total:{' '}
                        {totalProg.completed}/{totalProg.total} ({artist.activeProgress.pct}%)
                      </p>
                    </div>
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

                {/* Barra de progresso transparente da discografia do artista */}
                <div className="h-1 w-full overflow-hidden rounded-full bg-line">
                  <div
                    className="h-full bg-accent transition-all duration-200"
                    style={{ width: `${Math.min(100, artist.activeProgress.pct)}%` }}
                  />
                </div>

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
                                  rel.averageTrackRating10 !== null
                                    ? `Média faixas ${rel.averageTrackRating10}/10`
                                    : null,
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </p>
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
