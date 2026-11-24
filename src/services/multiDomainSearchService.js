import {
  normalizeDomainId,
  normalizeWorkTypeForDomain,
} from '../config/domainConfig.js';

const REQUEST_TIMEOUT_MS = 7500;

function isBrowserOffline() {
  if (typeof navigator === 'undefined') return false;
  return navigator.onLine === false;
}

function normalizeSearchKey(title, creator = '') {
  const norm = (str) =>
    String(str || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  return `${norm(title)}::${norm(creator)}`;
}

function normalizeHttpsUrl(url) {
  const clean = String(url || '').trim();
  if (!clean || !/^https?:\/\//i.test(clean)) return null;
  return clean.replace(/^http:\/\//i, 'https://');
}

async function fetchJsonSafe(url, { signal, fetchImpl, headers = {} } = {}) {
  const fn = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!fn) throw new Error('Fetch indisponível');

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = setTimeout(() => controller?.abort(), REQUEST_TIMEOUT_MS);

  const onOuterAbort = () => controller?.abort();
  if (signal && controller) {
    if (signal.aborted) {
      clearTimeout(timeoutId);
      throw new Error('AbortError');
    }
    signal.addEventListener('abort', onOuterAbort, { once: true });
  }

  try {
    const res = await fn(url, {
      method: 'GET',
      headers,
      signal: controller?.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timeoutId);
    if (signal) {
      signal.removeEventListener('abort', onOuterAbort);
    }
  }
}

function deduplicateDomainCandidates(candidates = []) {
  const byKey = new Map();
  for (const item of candidates) {
    if (!item || !item.title) continue;
    const key = normalizeSearchKey(item.title, item.creator || item.director || '');
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
      continue;
    }
    byKey.set(key, {
      ...existing,
      coverUrl: existing.coverUrl || item.coverUrl || null,
      synopsis:
        (existing.synopsis || '').length >= (item.synopsis || '').length
          ? existing.synopsis
          : item.synopsis,
      releaseYear: existing.releaseYear || item.releaseYear || null,
      totalPages: existing.totalPages || item.totalPages || null,
      isbnOrDoi: existing.isbnOrDoi || item.isbnOrDoi || '',
      genres:
        Array.isArray(existing.genres) && existing.genres.length > 0
          ? existing.genres
          : item.genres || [],
      ids: { ...(item.ids || {}), ...(existing.ids || {}) },
      mergedSources: Array.from(
        new Set([...(existing.mergedSources || []), ...(item.mergedSources || [])])
      ),
    });
  }
  return Array.from(byKey.values());
}

/**
 * Busca gratuita para Leitura & Acadêmico (Open Library + Google Books).
 */
export async function searchReadingWorks(
  query,
  { signal, fetchImpl, mediaTypeFilter = 'all' } = {}
) {
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) return { ok: true, results: [], offline: false, partialFailure: false };
  if (isBrowserOffline()) {
    return { ok: false, results: [], offline: true, partialFailure: false };
  }

  const encoded = encodeURIComponent(cleanQuery);
  const olUrl = `https://openlibrary.org/search.json?q=${encoded}&limit=10`;
  const gbUrl = `https://www.googleapis.com/books/v1/volumes?q=${encoded}&maxResults=10`;

  const [olRes, gbRes] = await Promise.allSettled([
    fetchJsonSafe(olUrl, { signal, fetchImpl }),
    fetchJsonSafe(gbUrl, { signal, fetchImpl }),
  ]);

  const candidates = [];
  let failedCount = 0;

  if (olRes.status === 'fulfilled' && Array.isArray(olRes.value?.docs)) {
    for (const doc of olRes.value.docs) {
      const title = String(doc.title || '').trim();
      if (!title) continue;
      const author = Array.isArray(doc.author_name) ? doc.author_name.slice(0, 2).join(', ') : '';
      const coverUrl = doc.cover_i
        ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`
        : null;
      const subjects = Array.isArray(doc.subject) ? doc.subject.slice(0, 4).map(String) : [];
      const isMangaHint = subjects.some((s) => /manga|comic|graphic novel/i.test(s));
      const defaultType =
        mediaTypeFilter !== 'all'
          ? normalizeWorkTypeForDomain(mediaTypeFilter, 'reading')
          : isMangaHint
            ? 'manga'
            : 'book';
      const firstSentence = Array.isArray(doc.first_sentence)
        ? doc.first_sentence[0]
        : typeof doc.first_sentence === 'string'
          ? doc.first_sentence
          : '';

      candidates.push({
        id: `ol-${String(doc.key || title).replace(/[^a-z0-9_-]/gi, '')}`,
        domain: 'reading',
        workType: defaultType,
        title,
        creator: author,
        director: author,
        releaseYear: Number(doc.first_publish_year) || null,
        coverUrl,
        synopsis: String(firstSentence || '').trim(),
        totalPages: Number(doc.number_of_pages_median) > 0 ? Math.round(Number(doc.number_of_pages_median)) : null,
        pagesRead: 0,
        chaptersRead: 0,
        isbnOrDoi: Array.isArray(doc.isbn) && doc.isbn[0] ? String(doc.isbn[0]) : '',
        bookFormat: 'Físico',
        genres: subjects,
        ids: { openlibrary: doc.key || null },
        sourceBadge: 'Open Library',
        mergedSources: ['Open Library'],
      });
    }
  } else {
    failedCount += 1;
  }

  if (gbRes.status === 'fulfilled' && Array.isArray(gbRes.value?.items)) {
    for (const vol of gbRes.value.items) {
      const info = vol?.volumeInfo || {};
      const title = String(info.title || '').trim();
      if (!title) continue;
      const author = Array.isArray(info.authors) ? info.authors.slice(0, 2).join(', ') : '';
      const rawThumb = info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || '';
      const coverUrl = normalizeHttpsUrl(rawThumb);
      const isbnObj =
        (Array.isArray(info.industryIdentifiers) ? info.industryIdentifiers : []).find(
          (i) => i.type === 'ISBN_13' || i.type === 'ISBN_10'
        ) || null;
      const genres = Array.isArray(info.categories) ? info.categories.slice(0, 4).map(String) : [];
      const isMangaHint = genres.some((g) => /manga|comics|graphic/i.test(g));
      const defaultType =
        mediaTypeFilter !== 'all'
          ? normalizeWorkTypeForDomain(mediaTypeFilter, 'reading')
          : isMangaHint
            ? 'manga'
            : 'book';

      candidates.push({
        id: `gb-${String(vol.id || title).replace(/[^a-z0-9_-]/gi, '')}`,
        domain: 'reading',
        workType: defaultType,
        title,
        creator: author,
        director: author,
        releaseYear: info.publishedDate ? Number(String(info.publishedDate).slice(0, 4)) || null : null,
        coverUrl,
        synopsis: String(info.description || '').trim(),
        totalPages: Number(info.pageCount) > 0 ? Math.round(Number(info.pageCount)) : null,
        pagesRead: 0,
        chaptersRead: 0,
        isbnOrDoi: isbnObj?.identifier ? String(isbnObj.identifier) : '',
        bookFormat: 'Físico',
        genres,
        ids: { googleBooks: vol.id || null },
        sourceBadge: 'Google Books',
        mergedSources: ['Google Books'],
      });
    }
  } else {
    failedCount += 1;
  }

  return {
    ok: failedCount < 2,
    results: deduplicateDomainCandidates(candidates).slice(0, 18),
    offline: false,
    partialFailure: failedCount === 1,
  };
}

/**
 * Busca gratuita para Games (CheapShark + FreeToGame + Wikidata).
 */
export async function searchGamesWorks(
  query,
  { signal, fetchImpl, mediaTypeFilter = 'all' } = {}
) {
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) return { ok: true, results: [], offline: false, partialFailure: false };
  if (isBrowserOffline()) {
    return { ok: false, results: [], offline: true, partialFailure: false };
  }

  const encoded = encodeURIComponent(cleanQuery);
  const cheapSharkUrl = `https://www.cheapshark.com/api/1.0/games?title=${encoded}&limit=12`;
  const wikidataUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encoded}&language=pt&uselang=pt&limit=8&format=json&origin=*`;
  const freeToGameUrl = 'https://www.freetogame.com/api/games';

  const [csRes, wdRes, ftgRes] = await Promise.allSettled([
    fetchJsonSafe(cheapSharkUrl, { signal, fetchImpl }),
    fetchJsonSafe(wikidataUrl, { signal, fetchImpl }),
    fetchJsonSafe(freeToGameUrl, { signal, fetchImpl }),
  ]);

  const candidates = [];
  let failedCount = 0;
  const resolvedType =
    mediaTypeFilter !== 'all'
      ? normalizeWorkTypeForDomain(mediaTypeFilter, 'games')
      : 'game';

  if (csRes.status === 'fulfilled' && Array.isArray(csRes.value)) {
    for (const g of csRes.value) {
      const title = String(g.external || '').trim();
      if (!title) continue;
      const steamId = g.steamAppID ? String(g.steamAppID).trim() : '';
      const coverUrl = steamId
        ? `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${steamId}/library_600x900.jpg`
        : normalizeHttpsUrl(g.thumb);
      candidates.push({
        id: `cs-${String(g.gameID || title)}`,
        domain: 'games',
        workType: resolvedType,
        title,
        creator: '',
        director: '',
        releaseYear: null,
        coverUrl,
        coverSources: [coverUrl, normalizeHttpsUrl(g.thumb)].filter(Boolean),
        platform: 'PC',
        hoursPlayed: 0,
        completionType: 'História Principal',
        storeOrLauncher: steamId ? 'Steam' : 'Nuuvem',
        buildOrCharacter: '',
        genres: [],
        ids: {
          cheapshark: g.gameID || null,
          ...(steamId ? { steam: steamId } : {}),
        },
        sourceBadge: 'CheapShark / Steam',
        mergedSources: ['CheapShark'],
      });
    }
  } else {
    failedCount += 1;
  }

  if (ftgRes.status === 'fulfilled' && Array.isArray(ftgRes.value)) {
    const qLower = cleanQuery.toLowerCase();
    const matches = ftgRes.value
      .filter((g) => String(g?.title || '').toLowerCase().includes(qLower))
      .slice(0, 6);
    for (const g of matches) {
      candidates.push({
        id: `ftg-${g.id}`,
        domain: 'games',
        workType: resolvedType,
        title: String(g.title || '').trim(),
        creator: String(g.developer || g.publisher || '').trim(),
        director: String(g.developer || g.publisher || '').trim(),
        releaseYear: g.release_date ? Number(String(g.release_date).slice(0, 4)) || null : null,
        coverUrl: normalizeHttpsUrl(g.thumbnail),
        synopsis: String(g.short_description || '').trim(),
        platform: /browser/i.test(String(g.platform || '')) ? 'PC' : 'PC',
        hoursPlayed: 0,
        completionType: 'Multiplayer / Ranked',
        storeOrLauncher: 'Steam',
        buildOrCharacter: '',
        genres: g.genre ? [String(g.genre)] : [],
        ids: { freetogame: g.id },
        sourceBadge: 'FreeToGame',
        mergedSources: ['FreeToGame'],
      });
    }
  } else {
    failedCount += 1;
  }

  if (wdRes.status === 'fulfilled' && Array.isArray(wdRes.value?.search)) {
    for (const ent of wdRes.value.search) {
      const desc = String(ent.description || '');
      if (!/jogo|game|video game|rpg|expansão|dlc/i.test(desc)) continue;
      const title = String(ent.label || '').trim();
      if (!title) continue;
      candidates.push({
        id: `wd-${ent.id}`,
        domain: 'games',
        workType: /dlc|expans/i.test(desc) ? 'dlc' : resolvedType,
        title,
        creator: '',
        director: '',
        synopsis: desc,
        platform: 'PC',
        hoursPlayed: 0,
        completionType: 'História Principal',
        storeOrLauncher: 'Steam',
        buildOrCharacter: '',
        genres: [],
        ids: { wikidata: ent.id },
        sourceBadge: 'Wikidata',
        mergedSources: ['Wikidata'],
      });
    }
  } else {
    failedCount += 1;
  }

  return {
    ok: failedCount < 3,
    results: deduplicateDomainCandidates(candidates).slice(0, 18),
    offline: false,
    partialFailure: failedCount > 0 && failedCount < 3,
  };
}

/**
 * Busca gratuita para Música (iTunes Search API + MusicBrainz API).
 */
export async function searchMusicWorks(
  query,
  { signal, fetchImpl, mediaTypeFilter = 'all' } = {}
) {
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) return { ok: true, results: [], offline: false, partialFailure: false };
  if (isBrowserOffline()) {
    return { ok: false, results: [], offline: true, partialFailure: false };
  }

  const encoded = encodeURIComponent(cleanQuery);
  const itunesUrl = `https://itunes.apple.com/search?term=${encoded}&entity=album&limit=12`;
  const mbUrl = `https://musicbrainz.org/ws/2/release-group?query=${encoded}&fmt=json&limit=10`;

  const [itRes, mbRes] = await Promise.allSettled([
    fetchJsonSafe(itunesUrl, { signal, fetchImpl }),
    fetchJsonSafe(mbUrl, {
      signal,
      fetchImpl,
      headers: { Accept: 'application/json' },
    }),
  ]);

  const candidates = [];
  let failedCount = 0;

  if (itRes.status === 'fulfilled' && Array.isArray(itRes.value?.results)) {
    for (const alb of itRes.value.results) {
      const title = String(alb.collectionName || '').trim();
      if (!title) continue;
      const artist = String(alb.artistName || '').trim();
      const rawArt = String(alb.artworkUrl100 || '').trim();
      const highResArt = rawArt
        ? normalizeHttpsUrl(rawArt.replace(/100x100bb/i, '600x600bb'))
        : null;
      const isSingleOrEp =
        / - (Single|EP)$/i.test(title) || Number(alb.trackCount) <= 5;
      const defaultType =
        mediaTypeFilter !== 'all'
          ? normalizeWorkTypeForDomain(mediaTypeFilter, 'music')
          : isSingleOrEp
            ? 'ep_single'
            : 'album';
      const primaryGenre = String(alb.primaryGenreName || '').trim();

      candidates.push({
        id: `itunes-${alb.collectionId || title}`,
        domain: 'music',
        workType: defaultType,
        title,
        creator: artist,
        director: artist,
        releaseYear: alb.releaseDate ? Number(String(alb.releaseDate).slice(0, 4)) || null : null,
        coverUrl: highResArt,
        genres: primaryGenre ? [primaryGenre] : [],
        subgenre: primaryGenre,
        releaseFormat: /live|ao vivo/i.test(title) ? 'Ao Vivo' : 'Álbum de Estúdio',
        favoriteTrack: '',
        listenCount: 0,
        tracks: [],
        trackCount: Number(alb.trackCount) || null,
        ids: { itunes: alb.collectionId || null },
        sourceBadge: 'iTunes',
        mergedSources: ['iTunes'],
      });
    }
  } else {
    failedCount += 1;
  }

  if (mbRes.status === 'fulfilled' && Array.isArray(mbRes.value?.['release-groups'])) {
    for (const rg of mbRes.value['release-groups']) {
      const title = String(rg.title || '').trim();
      if (!title) continue;
      const artist = Array.isArray(rg['artist-credit'])
        ? rg['artist-credit'].map((c) => c?.name || c?.artist?.name).filter(Boolean).join(', ')
        : '';
      const primaryType = String(rg['primary-type'] || '').toLowerCase();
      const defaultType =
        mediaTypeFilter !== 'all'
          ? normalizeWorkTypeForDomain(mediaTypeFilter, 'music')
          : primaryType === 'ep' || primaryType === 'single'
            ? 'ep_single'
            : 'album';
      const tags = Array.isArray(rg.tags)
        ? rg.tags
            .slice(0, 4)
            .map((t) => String(t?.name || '').trim())
            .filter(Boolean)
        : [];
      const coverUrl = rg.id
        ? `https://coverartarchive.org/release-group/${rg.id}/front-500`
        : null;

      candidates.push({
        id: `mb-${rg.id}`,
        domain: 'music',
        workType: defaultType,
        title,
        creator: artist,
        director: artist,
        releaseYear: rg['first-release-date']
          ? Number(String(rg['first-release-date']).slice(0, 4)) || null
          : null,
        coverUrl,
        genres: tags,
        subgenre: tags[0] || '',
        releaseFormat: /live/i.test(title) ? 'Ao Vivo' : 'Álbum de Estúdio',
        favoriteTrack: '',
        listenCount: 0,
        tracks: [],
        ids: { musicbrainz: rg.id },
        sourceBadge: 'MusicBrainz',
        mergedSources: ['MusicBrainz'],
      });
    }
  } else {
    failedCount += 1;
  }

  return {
    ok: failedCount < 2,
    results: deduplicateDomainCandidates(candidates).slice(0, 18),
    offline: false,
    partialFailure: failedCount === 1,
  };
}

/**
 * Busca a lista de faixas de um álbum/EP via iTunes Lookup ou MusicBrainz.
 */
export async function fetchMusicReleaseTracks(
  candidate = {},
  { signal, fetchImpl } = {}
) {
  if (isBrowserOffline()) return [];
  const itunesId = candidate?.ids?.itunes;
  if (itunesId) {
    try {
      const payload = await fetchJsonSafe(
        `https://itunes.apple.com/lookup?id=${encodeURIComponent(itunesId)}&entity=song`,
        { signal, fetchImpl }
      );
      const tracks = (Array.isArray(payload?.results) ? payload.results : [])
        .filter((r) => r.wrapperType === 'track' && r.trackName)
        .map((r, idx) => ({
          number: Number(r.trackNumber) || idx + 1,
          title: String(r.trackName).trim(),
          durationMs: Number(r.trackTimeMillis) || null,
        }));
      if (tracks.length > 0) return tracks;
    } catch {
      // Silencioso e tenta MusicBrainz caso exista
    }
  }

  const mbId = candidate?.ids?.musicbrainz;
  if (mbId) {
    try {
      const rgData = await fetchJsonSafe(
        `https://musicbrainz.org/ws/2/release-group/${encodeURIComponent(mbId)}?inc=releases&fmt=json`,
        { signal, fetchImpl, headers: { Accept: 'application/json' } }
      );
      const firstReleaseId = rgData?.releases?.[0]?.id;
      if (!firstReleaseId) return [];
      const relData = await fetchJsonSafe(
        `https://musicbrainz.org/ws/2/release/${encodeURIComponent(firstReleaseId)}?inc=recordings&fmt=json`,
        { signal, fetchImpl, headers: { Accept: 'application/json' } }
      );
      const mediaList = Array.isArray(relData?.media) ? relData.media : [];
      const tracks = mediaList.flatMap((m) =>
        (Array.isArray(m.tracks) ? m.tracks : []).map((t, idx) => ({
          number: Number(t.position) || idx + 1,
          title: String(t.title || '').trim(),
          durationMs: Number(t.length) || null,
        }))
      );
      return tracks.filter((t) => t.title);
    } catch {
      return [];
    }
  }

  return [];
}

export async function searchWorksByDomain(domain, query, options = {}) {
  const cleanDomain = normalizeDomainId(domain);
  if (cleanDomain === 'reading') return searchReadingWorks(query, options);
  if (cleanDomain === 'games') return searchGamesWorks(query, options);
  if (cleanDomain === 'music') return searchMusicWorks(query, options);
  return { ok: true, results: [], offline: false, partialFailure: false };
}

export function getQuickSuggestionsForDomain(domain = 'cinema') {
  const clean = normalizeDomainId(domain);
  if (clean === 'reading') {
    return [
      { label: 'Duna (Livro)', query: 'Dune Frank Herbert', filter: 'book' },
      { label: 'Vagabond (Mangá)', query: 'Vagabond Takehiko Inoue', filter: 'manga' },
      { label: 'Meditações', query: 'Meditations Marcus Aurelius', filter: 'technical' },
      { label: 'Design Patterns', query: 'Clean Architecture', filter: 'technical' },
    ];
  }
  if (clean === 'games') {
    return [
      { label: 'Elden Ring', query: 'Elden Ring', filter: 'game' },
      { label: 'Hollow Knight', query: 'Hollow Knight', filter: 'game' },
      { label: 'Chrono Trigger', query: 'Chrono Trigger', filter: 'game' },
      { label: 'Shadow of the Erdtree', query: 'Shadow of the Erdtree', filter: 'dlc' },
    ];
  }
  if (clean === 'music') {
    return [
      { label: 'Powerslave', query: 'Iron Maiden Powerslave', filter: 'album' },
      { label: 'Temple of Shadows', query: 'Angra Temple of Shadows', filter: 'album' },
      { label: 'Master of Puppets', query: 'Metallica Master of Puppets', filter: 'album' },
      { label: 'Clube da Esquina', query: 'Clube da Esquina Milton Nascimento', filter: 'album' },
    ];
  }
  return [
    { label: 'Hayao Miyazaki', query: 'Spirited Away', filter: 'anime', sources: ['anilist', 'jikan'] },
    { label: 'Blade Runner 2049', query: 'Blade Runner', filter: 'movie', sources: ['tmdb', 'imdb', 'wikidata'] },
    { label: 'Breaking Bad', query: 'Breaking Bad', filter: 'series', sources: ['tvmaze', 'tmdb', 'imdb'] },
    { label: 'Attack on Titan', query: 'Attack on Titan', filter: 'anime', sources: ['anilist', 'jikan'] },
    { label: 'Parasita', query: 'Parasite', filter: 'movie', sources: ['tmdb', 'imdb', 'wikidata'] },
    { label: 'Cowboy Bebop', query: 'Cowboy Bebop', filter: 'anime', sources: ['anilist', 'jikan'] },
  ];
}
