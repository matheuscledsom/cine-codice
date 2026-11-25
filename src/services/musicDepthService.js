/**
 * Serviços de profundidade musical (v2.5.0 Fase B):
 * - MusicBrainz: estritamente limitado a 1 req/s via `apiRequest(provider: 'musicbrainz')` + cache persistente.
 * - Last.fm: exclusivamente via proxy `/api/lastfm` (secret LASTFM_API_KEY no Cloudflare),
 *   degradando sem quebrar quando não configurado.
 */

import { getCachedEntry, setCachedEntry } from '../api/cacheDb.js';
import { apiRequest } from '../api/httpClient.js';
import { API_TIMEOUT_MS, CACHE_STORES, CACHE_TTL_MS } from '../api/limits.js';
import {
  SUBGENRE_TAG_MIN_VOTES,
  categorizeMusicBrainzReleaseGroups,
  filterMusicBrainzStudioAlbums,
  normalizeMusicKey,
  selectTopSubgenreTags,
} from '../lib/musicDepth.js';
import { fetchLastfmViaProxy } from './apiProxyClient.js';

const MB_CACHE_TTL_MS = CACHE_TTL_MS.relations || 7 * 24 * 60 * 60 * 1000;
const LASTFM_CACHE_TTL_MS = CACHE_TTL_MS.relations || 7 * 24 * 60 * 60 * 1000;

/**
 * Busca release-groups de estúdio (`primary-type: Album`, sem `secondary-types`) no MusicBrainz
 * com cache e limite de 1 requisição por segundo (`provider: 'musicbrainz'`).
 */
export async function fetchMusicBrainzArtistStudioAlbums(
  artistName,
  {
    artistMbid = '',
    fetchImpl = fetch,
    nowFn = Date.now,
    sleepFn = undefined,
    signal = undefined,
    idbFactory = null,
    forceRefresh = false,
  } = {}
) {
  const cleanArtist = String(artistName || '').trim();
  const cleanMbid = String(artistMbid || '').trim();
  const normArtist = normalizeMusicKey(cleanArtist);
  if (!normArtist && !cleanMbid) {
    return { available: false, source: null, fetchedAt: null, artistMbid: null, albums: [] };
  }

  const cacheKey = `mb:studio-albums:${cleanMbid || normArtist}`;
  if (!forceRefresh) {
    const cached = await getCachedEntry(CACHE_STORES.relations, cacheKey, {
      idbFactory,
      now: nowFn(),
    }).catch(() => null);
    if (cached?.hit && cached.data && !cached.expired) {
      return { ...cached.data, fromCache: true };
    }
  }

  try {
    let resolvedMbid = cleanMbid;

    if (!resolvedMbid) {
      const searchUrl = `https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(
        `artist:"${cleanArtist}"`
      )}&fmt=json&limit=3`;
      const searchRes = await apiRequest(searchUrl, {
        provider: 'musicbrainz',
        headers: { Accept: 'application/json' },
        fetchImpl,
        nowFn,
        sleepFn,
        signal,
        timeoutMs: API_TIMEOUT_MS,
        maxRetries: 1,
      });
      if (!searchRes?.ok) {
        return { available: false, source: null, fetchedAt: null, artistMbid: null, albums: [] };
      }
      const searchJson = await searchRes.json().catch(() => null);
      const artists = Array.isArray(searchJson?.artists) ? searchJson.artists : [];
      const exact =
        artists.find((a) => normalizeMusicKey(a?.name) === normArtist) || artists[0] || null;
      resolvedMbid = String(exact?.id || '').trim();
    }

    if (!resolvedMbid) {
      return { available: false, source: null, fetchedAt: null, artistMbid: null, albums: [] };
    }

    const rgUrl = `https://musicbrainz.org/ws/2/release-group?artist=${encodeURIComponent(
      resolvedMbid
    )}&type=album&fmt=json&limit=100`;
    const rgRes = await apiRequest(rgUrl, {
      provider: 'musicbrainz',
      headers: { Accept: 'application/json' },
      fetchImpl,
      nowFn,
      sleepFn,
      signal,
      timeoutMs: API_TIMEOUT_MS,
      maxRetries: 1,
    });

    if (!rgRes?.ok) {
      return {
        available: false,
        source: null,
        fetchedAt: null,
        artistMbid: resolvedMbid,
        albums: [],
      };
    }

    const rgJson = await rgRes.json().catch(() => null);
    const rawGroups = Array.isArray(rgJson?.['release-groups']) ? rgJson['release-groups'] : [];
    const studioAlbums = filterMusicBrainzStudioAlbums(rawGroups);
    const allReleases = categorizeMusicBrainzReleaseGroups(rawGroups);

    const payload = {
      available: true,
      source: 'MusicBrainz',
      fetchedAt: new Date(nowFn()).toISOString(),
      artistMbid: resolvedMbid,
      totalStudioAlbums: studioAlbums.length,
      albums: studioAlbums,
      allReleases,
      fromCache: false,
    };

    await setCachedEntry(CACHE_STORES.relations, cacheKey, payload, {
      ttlMs: MB_CACHE_TTL_MS,
      idbFactory,
      now: nowFn(),
    }).catch(() => {});

    return payload;
  } catch (err) {
    if (err?.name === 'AbortError' || signal?.aborted) {
      throw err;
    }
    return { available: false, source: null, fetchedAt: null, artistMbid: null, albums: [] };
  }
}

/**
 * Busca a discografia categorizada completa no MusicBrainz (Estúdio, Ao Vivo, EPs/Singles, Coletâneas)
 * respeitando 1 req/s + cache persistente.
 */
export async function fetchMusicBrainzArtistFullDiscography(
  artistName,
  {
    artistMbid = '',
    fetchImpl = fetch,
    nowFn = Date.now,
    sleepFn = undefined,
    signal = undefined,
    idbFactory = null,
    forceRefresh = false,
  } = {}
) {
  const cleanArtist = String(artistName || '').trim();
  const cleanMbid = String(artistMbid || '').trim();
  const normArtist = normalizeMusicKey(cleanArtist);
  if (!normArtist && !cleanMbid) {
    return {
      available: false,
      source: null,
      fetchedAt: null,
      artistMbid: null,
      albums: [],
      allReleases: [],
    };
  }

  const cacheKey = `mb:full-discography:${cleanMbid || normArtist}`;
  if (!forceRefresh) {
    const cached = await getCachedEntry(CACHE_STORES.relations, cacheKey, {
      idbFactory,
      now: nowFn(),
    }).catch(() => null);
    if (cached?.hit && cached.data && !cached.expired) {
      return { ...cached.data, fromCache: true };
    }
  }

  try {
    let resolvedMbid = cleanMbid;
    let resolvedArtistName = cleanArtist;

    if (!resolvedMbid) {
      const searchUrl = `https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(
        `artist:"${cleanArtist}"`
      )}&fmt=json&limit=3`;
      const searchRes = await apiRequest(searchUrl, {
        provider: 'musicbrainz',
        headers: { Accept: 'application/json' },
        fetchImpl,
        nowFn,
        sleepFn,
        signal,
        timeoutMs: API_TIMEOUT_MS,
        maxRetries: 1,
      });
      if (!searchRes?.ok) {
        return {
          available: false,
          source: null,
          fetchedAt: null,
          artistMbid: null,
          albums: [],
          allReleases: [],
        };
      }
      const searchJson = await searchRes.json().catch(() => null);
      const artists = Array.isArray(searchJson?.artists) ? searchJson.artists : [];
      const exact =
        artists.find((a) => normalizeMusicKey(a?.name) === normArtist) || artists[0] || null;
      resolvedMbid = String(exact?.id || '').trim();
      resolvedArtistName = String(exact?.name || cleanArtist).trim();
    }

    if (!resolvedMbid) {
      return {
        available: false,
        source: null,
        fetchedAt: null,
        artistMbid: null,
        albums: [],
        allReleases: [],
      };
    }

    const rgUrl = `https://musicbrainz.org/ws/2/release-group?artist=${encodeURIComponent(
      resolvedMbid
    )}&fmt=json&limit=100`;
    const rgRes = await apiRequest(rgUrl, {
      provider: 'musicbrainz',
      headers: { Accept: 'application/json' },
      fetchImpl,
      nowFn,
      sleepFn,
      signal,
      timeoutMs: API_TIMEOUT_MS,
      maxRetries: 1,
    });

    if (!rgRes?.ok) {
      return {
        available: false,
        source: null,
        fetchedAt: null,
        artistMbid: resolvedMbid,
        albums: [],
        allReleases: [],
      };
    }

    const rgJson = await rgRes.json().catch(() => null);
    const rawGroups = Array.isArray(rgJson?.['release-groups']) ? rgJson['release-groups'] : [];
    const studioAlbums = filterMusicBrainzStudioAlbums(rawGroups);
    const allReleases = categorizeMusicBrainzReleaseGroups(rawGroups).map((rel) => ({
      ...rel,
      creator: resolvedArtistName,
      artist: resolvedArtistName,
      director: resolvedArtistName,
    }));

    const payload = {
      available: true,
      source: 'MusicBrainz',
      fetchedAt: new Date(nowFn()).toISOString(),
      artistMbid: resolvedMbid,
      artistName: resolvedArtistName,
      totalStudioAlbums: studioAlbums.length,
      totalReleases: allReleases.length,
      albums: studioAlbums,
      allReleases,
      fromCache: false,
    };

    await setCachedEntry(CACHE_STORES.relations, cacheKey, payload, {
      ttlMs: MB_CACHE_TTL_MS,
      idbFactory,
      now: nowFn(),
    }).catch(() => {});

    return payload;
  } catch (err) {
    if (err?.name === 'AbortError' || signal?.aborted) {
      throw err;
    }
    return {
      available: false,
      source: null,
      fetchedAt: null,
      artistMbid: null,
      albums: [],
      allReleases: [],
    };
  }
}

/**
 * Busca subgêneros sugeridos (2 a 3 tags mais votadas acima do limite mínimo)
 * via proxy autenticado `/api/lastfm` (`album.getTopTags` -> fallback `artist.getTopTags`).
 * Degrada silenciosamente sem quebrar se `LASTFM_API_KEY` não estiver configurado no servidor.
 */
export async function fetchLastfmSubgenres({
  artist = '',
  album = '',
  minVotes = SUBGENRE_TAG_MIN_VOTES,
  maxTags = 3,
  fetchImpl = fetch,
  nowFn = Date.now,
  signal = undefined,
  accessToken = '',
  supabaseClient = null,
  storage = null,
  forceProxy = null,
  isDev = undefined,
  idbFactory = null,
  forceRefresh = false,
} = {}) {
  const cleanArtist = String(artist || '').trim();
  const cleanAlbum = String(album || '').trim();
  if (!cleanArtist) {
    return { ok: false, notConfigured: false, source: null, tags: [] };
  }

  const cacheKey = `lastfm:subgenres:${normalizeMusicKey(cleanArtist)}:${normalizeMusicKey(cleanAlbum)}`;
  if (!forceRefresh) {
    const cached = await getCachedEntry(CACHE_STORES.relations, cacheKey, {
      idbFactory,
      now: nowFn(),
    }).catch(() => null);
    if (cached?.hit && cached.data && !cached.expired) {
      return { ...cached.data, fromCache: true };
    }
  }

  const proxyOpts = {
    fetchImpl,
    nowFn,
    signal,
    accessToken,
    supabaseClient,
    storage,
    forceProxy,
    ...(isDev !== undefined ? { isDev } : {}),
  };

  let notConfigured = false;
  let rawTags = [];

  if (cleanAlbum) {
    const albumOutcome = await fetchLastfmViaProxy(
      'album.getTopTags',
      { artist: cleanArtist, album: cleanAlbum, autocorrect: '1' },
      proxyOpts
    );
    if (albumOutcome.notConfigured) {
      notConfigured = true;
    } else if (albumOutcome.ok) {
      const list = albumOutcome.data?.toptags?.tag;
      rawTags = Array.isArray(list) ? list : list ? [list] : [];
    }
  }

  let selected = selectTopSubgenreTags(rawTags, {
    minVotes,
    maxTags,
    excludeNames: [cleanArtist, cleanAlbum],
  });

  if (selected.length < 2 && !notConfigured) {
    const artistOutcome = await fetchLastfmViaProxy(
      'artist.getTopTags',
      { artist: cleanArtist, autocorrect: '1' },
      proxyOpts
    );
    if (artistOutcome.notConfigured) {
      notConfigured = true;
    } else if (artistOutcome.ok) {
      const list = artistOutcome.data?.toptags?.tag;
      const artistTags = Array.isArray(list) ? list : list ? [list] : [];
      selected = selectTopSubgenreTags([...rawTags, ...artistTags], {
        minVotes,
        maxTags,
        excludeNames: [cleanArtist, cleanAlbum],
      });
    }
  }

  if (notConfigured && selected.length === 0) {
    return {
      ok: false,
      notConfigured: true,
      source: null,
      tags: [],
      fromCache: false,
    };
  }

  const result = {
    ok: selected.length > 0,
    notConfigured: false,
    source: selected.length > 0 ? 'Last.fm' : null,
    tags: selected,
    fromCache: false,
  };

  if (selected.length > 0) {
    await setCachedEntry(CACHE_STORES.relations, cacheKey, result, {
      ttlMs: LASTFM_CACHE_TTL_MS,
      idbFactory,
      now: nowFn(),
    }).catch(() => {});
  }

  return result;
}
