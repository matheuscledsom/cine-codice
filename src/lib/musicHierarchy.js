/**
 * Hierarquia Musical SOUND (v2.4.0 Fase 4.3).
 *
 * Agrupa obras musicais em:
 *   Banda / Artista -> Discografia -> Álbuns / EPs / Singles -> Faixas
 * Separando escopos transparentes:
 *   - studio: Álbuns de Estúdio
 *   - eps_singles: EPs / Singles
 *   - live_compilations: Ao Vivo / Coletâneas
 *   - all: Todos
 */

import { inferDomainFromWork } from '../config/domainConfig.js';
import { resolveWorkRatingState } from './ratingModel.js';
import { makeAlbumTrackKey, normalizeTrackRatingsMap } from '../utils/catalogDraftHelpers.js';

export const MUSIC_SCOPE_OPTIONS = Object.freeze([
  Object.freeze({ id: 'all', label: 'Todos' }),
  Object.freeze({ id: 'studio', label: 'Estúdio' }),
  Object.freeze({ id: 'eps_singles', label: 'EPs / Singles' }),
  Object.freeze({ id: 'live_compilations', label: 'Ao Vivo / Coletâneas' }),
]);

const LIVE_COMPILATION_REGEX =
  /\b(live|ao\s+vivo|unplugged|ac[uú]stico|concert|show|colet[aâ]nea|compilation|greatest\s+hits|best\s+of|anthology|antologia|collection|rarities)\b/i;

const EP_SINGLE_REGEX = /\b(ep|single|faixa\s+individual|demo|maxi[- ]?single)\b/i;

function normalizeKey(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

export function classifyMusicReleaseScope(work = {}) {
  const workType = String(work?.workType || work?.mediaType || '').toLowerCase();
  const format = String(work?.releaseFormat || '').trim();
  const title = String(work?.title || '').trim();
  const combined = `${format} ${title}`;

  if (
    workType === 'live_show' ||
    workType === 'concert' ||
    workType === 'discography' ||
    LIVE_COMPILATION_REGEX.test(combined)
  ) {
    return 'live_compilations';
  }

  if (
    workType === 'ep_single' ||
    workType === 'track' ||
    EP_SINGLE_REGEX.test(format) ||
    /\s-\s(EP|Single)$/i.test(title)
  ) {
    return 'eps_singles';
  }

  return 'studio';
}

export function buildReleaseTracksView(work = {}) {
  const ratingsMap = normalizeTrackRatingsMap(work.trackRatings);
  const rawTracks = Array.isArray(work.tracks) ? work.tracks : [];
  const sourceTracks =
    rawTracks.length > 0
      ? rawTracks
      : work.workType === 'track'
        ? [{ number: 1, title: work.title, durationMs: work.durationMs || null }]
        : [];

  const tracks = sourceTracks.map((tr, idx) => {
    const key = makeAlbumTrackKey(tr, idx);
    const score =
      ratingsMap[key] !== undefined
        ? ratingsMap[key]
        : tr?.rating10 !== null && tr?.rating10 !== undefined && Number.isFinite(Number(tr.rating10))
          ? Number(tr.rating10)
          : work.workType === 'track' && work.trackRating10 !== null && work.trackRating10 !== undefined
            ? Number(work.trackRating10)
            : null;
    return {
      key,
      index: idx,
      number: Number(tr?.number) || idx + 1,
      title: String(tr?.title || `Faixa ${idx + 1}`).trim(),
      durationMs: Number(tr?.durationMs) > 0 ? Number(tr.durationMs) : null,
      rating10: score,
    };
  });

  const ratedTracks = tracks.filter((t) => typeof t.rating10 === 'number');
  const averageTrackRating10 =
    ratedTracks.length > 0
      ? Math.round((ratedTracks.reduce((acc, t) => acc + t.rating10, 0) / ratedTracks.length) * 10) / 10
      : null;

  return {
    tracks,
    totalTracks: tracks.length,
    ratedTracksCount: ratedTracks.length,
    averageTrackRating10,
  };
}

/**
 * Constrói a hierarquia completa Banda / Artista -> Discografia -> Álbuns/EPs/Singles -> Faixas.
 */
export function buildMusicHierarchy(items = [], { scope = 'all' } = {}) {
  const musicWorks = (Array.isArray(items) ? items : []).filter(
    (w) => w && w.inBacklog !== false && inferDomainFromWork(w) === 'music'
  );

  const artistMap = new Map();

  for (const work of musicWorks) {
    const artistName =
      String(work.creator || work.artist || work.director || '').trim() || 'Artista desconhecido';
    const artistKey = normalizeKey(artistName) || 'artista-desconhecido';
    if (!artistMap.has(artistKey)) {
      artistMap.set(artistKey, {
        id: artistKey,
        artistName,
        allReleases: [],
      });
    }
    const releaseScope = classifyMusicReleaseScope(work);
    const tracksView = buildReleaseTracksView(work);
    const ratingState = resolveWorkRatingState(work);

    artistMap.get(artistKey).allReleases.push({
      id: work.id,
      work,
      title: work.title,
      releaseYear: Number(work.releaseYear) || null,
      scope: releaseScope,
      completed: work.status === 'completed',
      ratingState,
      ...tracksView,
    });
  }

  const artists = [];
  for (const group of artistMap.values()) {
    group.allReleases.sort((a, b) => {
      const ya = a.releaseYear ?? 9999;
      const yb = b.releaseYear ?? 9999;
      if (ya !== yb) return ya - yb;
      return String(a.title || '').localeCompare(String(b.title || ''), 'pt-BR');
    });

    const scopeCounts = {
      studio: { completed: 0, total: 0 },
      eps_singles: { completed: 0, total: 0 },
      live_compilations: { completed: 0, total: 0 },
      all: { completed: 0, total: group.allReleases.length },
    };

    for (const rel of group.allReleases) {
      scopeCounts[rel.scope].total += 1;
      if (rel.completed) {
        scopeCounts[rel.scope].completed += 1;
        scopeCounts.all.completed += 1;
      }
    }

    const filteredReleases =
      scope === 'all'
        ? group.allReleases
        : group.allReleases.filter((r) => r.scope === scope);

    if (scope !== 'all' && filteredReleases.length === 0) {
      continue;
    }

    const activeProgress = scopeCounts[scope] || scopeCounts.all;
    const progressPct =
      activeProgress.total > 0
        ? Math.round((activeProgress.completed / activeProgress.total) * 100)
        : 0;

    artists.push({
      id: group.id,
      artistName: group.artistName,
      coverWork: filteredReleases[0]?.work || group.allReleases[0]?.work || null,
      releases: filteredReleases,
      allReleasesCount: group.allReleases.length,
      scopeCounts,
      activeProgress: {
        ...activeProgress,
        pct: progressPct,
      },
    });
  }

  artists.sort((a, b) => {
    if (b.releases.length !== a.releases.length) {
      return b.releases.length - a.releases.length;
    }
    return a.artistName.localeCompare(b.artistName, 'pt-BR');
  });

  const totals = {
    artistsCount: artists.length,
    releasesCount: artists.reduce((acc, a) => acc + a.releases.length, 0),
    completedReleasesCount: artists.reduce((acc, a) => acc + a.activeProgress.completed, 0),
  };

  return {
    scope,
    artists,
    totals,
  };
}
