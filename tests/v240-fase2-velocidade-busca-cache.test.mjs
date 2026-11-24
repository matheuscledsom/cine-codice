import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, it } from 'node:test';

import { clearMemoryApiCacheForTests } from '../src/api/cacheDb.js';
import { resetApiClientStateForTests } from '../src/api/httpClient.js';
import {
  CATALOG_PAGE_BATCH_SIZE,
  CATALOG_PAGINATION_THRESHOLD,
  computeCatalogVisibleSlice,
  shouldUseIncrementalPagination,
} from '../src/lib/catalogPagination.js';
import {
  MAX_RECENT_SEARCHES,
  SEARCH_DEBOUNCE_MS,
  clearRecentSearches,
  readRecentSearches,
  recordRecentSearch,
  removeRecentSearch,
  searchLocalCatalogWorks,
} from '../src/lib/searchHelpers.js';
import { clearCinemaSearchCache, searchCinemaMedia } from '../src/services/cinemaApi.js';
import {
  searchGamesWorks,
  searchMusicWorks,
  searchReadingWorks,
} from '../src/services/multiDomainSearchService.js';

const ROOT_DIR = process.cwd();

function createMemoryStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

function makeDelayedJsonResponse(payload, delayMs = 0, signal = null) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      reject(err);
      return;
    }
    const timer = setTimeout(() => {
      resolve({
        ok: true,
        status: 200,
        headers: new Map(),
        async json() {
          return payload;
        },
      });
    }, delayMs);
    signal?.addEventListener?.('abort', () => {
      clearTimeout(timer);
      const err = new Error('Aborted');
      err.name = 'AbortError';
      reject(err);
    });
  });
}

describe('OMNIPRISM v2.4.0 — Fase 2.1: Busca Progressiva, Debounce 250ms, AbortController e Historico Local', () => {
  beforeEach(() => {
    clearCinemaSearchCache();
    clearMemoryApiCacheForTests();
    resetApiClientStateForTests();
  });

  it('usa debounce de 250ms, busca local primeiro e historico recente por dominio', () => {
    assert.equal(SEARCH_DEBOUNCE_MS, 250);
    const addSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/screens/AddScreen.jsx'), 'utf8');
    assert.match(addSrc, /SEARCH_DEBOUNCE_MS/);
    assert.match(addSrc, /searchLocalCatalogWorks/);
    assert.match(addSrc, /onPartialResults/);
    assert.match(addSrc, /recent-searches-strip/);

    // Busca local instantânea (insensível a acentos e com prioridade de título)
    const catalog = [
      { id: '1', domain: 'reading', workType: 'book', title: 'Memórias Póstumas de Brás Cubas', creator: 'Machado de Assis', inBacklog: true },
      { id: '2', domain: 'reading', workType: 'book', title: 'Dom Casmurro', creator: 'Machado de Assis', inBacklog: true },
      { id: '3', domain: 'cinema', workType: 'movie', title: 'Solaris', creator: 'Andrei Tarkovsky', inBacklog: true },
    ];
    const localHits = searchLocalCatalogWorks(catalog, 'memorias postumas', { domain: 'reading' });
    assert.equal(localHits.length, 1);
    assert.equal(localHits[0].id, '1');
    assert.equal(localHits[0].isLocalCatalogHit, true);

    const byAuthor = searchLocalCatalogWorks(catalog, 'machado', { domain: 'reading' });
    assert.equal(byAuthor.length, 2);

    // Histórico local por domínio com dedup e limite de 8 itens
    const storage = createMemoryStorage();
    for (let i = 1; i <= 10; i += 1) {
      recordRecentSearch('music', `Album ${i}`, storage);
    }
    recordRecentSearch('music', 'album 5', storage); // Dedup case-insensitive -> sobe para o topo
    const musicRecent = readRecentSearches('music', storage);
    assert.equal(musicRecent.length, MAX_RECENT_SEARCHES);
    assert.equal(musicRecent[0], 'album 5');

    removeRecentSearch('music', 'Album 10', storage);
    assert.equal(readRecentSearches('music', storage).includes('Album 10'), false);

    recordRecentSearch('games', 'Hollow Knight', storage);
    clearRecentSearches('music', storage);
    assert.equal(readRecentSearches('music', storage).length, 0);
    assert.deepEqual(readRecentSearches('games', storage), ['Hollow Knight']);
  });

  it('faz streaming progressivo em Musica e Games sem bloquear esperando MusicBrainz ou Wikidata lentos', async () => {
    const partialTimeline = [];
    const startedAt = Date.now();

    const mockMusicFetch = (url, opts) => {
      if (url.includes('itunes.apple.com')) {
        return makeDelayedJsonResponse(
          {
            results: [
              {
                wrapperType: 'collection',
                collectionId: 901,
                collectionName: 'Powerslave',
                artistName: 'Iron Maiden',
                releaseDate: '1984-09-03T00:00:00Z',
                artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/100x100bb.jpg',
                trackCount: 8,
                primaryGenreName: 'Metal',
              },
            ],
          },
          10,
          opts?.signal
        );
      }
      // MusicBrainz propositalmente lento (180ms)
      return makeDelayedJsonResponse({ 'release-groups': [] }, 180, opts?.signal);
    };

    const musicRes = await searchMusicWorks('Powerslave', {
      fetchImpl: mockMusicFetch,
      onPartialResults: (p) => {
        partialTimeline.push({ elapsed: Date.now() - startedAt, count: p.results.length, partial: p.partial });
      },
    });

    assert.ok(musicRes.results.length >= 1);
    assert.ok(partialTimeline.length >= 1, 'Deve emitir resultados parciais assim que o iTunes responder');
    assert.equal(partialTimeline[0].partial, true);
    assert.ok(partialTimeline[0].elapsed < 150, `Streaming parcial deve chegar antes do MusicBrainz lento (${partialTimeline[0].elapsed}ms)`);

    // Games: CheapShark rápido (10ms) vs Wikidata lenta (180ms)
    const gamePartials = [];
    const gStart = Date.now();
    const mockGameFetch = (url, opts) => {
      if (url.includes('cheapshark.com')) {
        return makeDelayedJsonResponse(
          [{ gameID: '42', external: 'Hollow Knight', steamAppID: '367520', thumb: 'https://cdn.example/hk.jpg' }],
          10,
          opts?.signal
        );
      }
      if (url.includes('freetogame.com')) {
        return makeDelayedJsonResponse([], 15, opts?.signal);
      }
      return makeDelayedJsonResponse({ search: [] }, 180, opts?.signal);
    };

    const gamesRes = await searchGamesWorks('Hollow Knight', {
      fetchImpl: mockGameFetch,
      onPartialResults: (p) => {
        gamePartials.push({ elapsed: Date.now() - gStart, count: p.results.length, partial: p.partial });
      },
    });
    assert.ok(gamesRes.results.length >= 1);
    assert.ok(gamePartials.length >= 1);
    assert.ok(gamePartials[0].elapsed < 150);

    // AbortController cancela busca anterior impedindo emissão de parciais
    const ac = new AbortController();
    let emittedAfterAbort = 0;
    ac.abort();
    await searchReadingWorks('Duna', {
      signal: ac.signal,
      fetchImpl: (url, opts) => makeDelayedJsonResponse({ items: [] }, 20, opts?.signal),
      onPartialResults: () => {
        emittedAfterAbort += 1;
      },
    });
    assert.equal(emittedAfterAbort, 0);

    // Cinema também suporta streaming progressivo via onPartialResults
    const cinemaPartials = [];
    const mockCinemaFetch = (url, opts) => {
      if (url.includes('tvmaze.com')) {
        return makeDelayedJsonResponse(
          [{ show: { id: 169, name: 'Breaking Bad', premiered: '2008-01-20', genres: ['Drama'], image: { medium: 'https://static.tvmaze.com/bb.jpg' } } }],
          10,
          opts?.signal
        );
      }
      return makeDelayedJsonResponse({ results: [] }, 120, opts?.signal);
    };
    const cinemaRes = await searchCinemaMedia('Breaking Bad', {
      sources: ['tvmaze', 'wikidata'],
      skipCache: true,
      fetchImpl: mockCinemaFetch,
      onPartialResults: (p) => cinemaPartials.push(p),
    });
    assert.ok(cinemaRes.results.length >= 1);
    assert.ok(cinemaPartials.length >= 1);
  });
});

describe('OMNIPRISM v2.4.0 — Fase 2.2 & 2.3: Imagens 2:3/1:1, Paginacao >200, Code-Splitting e PWA Banner', () => {
  it('configura lazy loading, decoding=async e aspect-ratio fixo (2:3 Cinema/Livros/Games, 1:1 Musica)', () => {
    const coverSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/components/CoverImage.jsx'), 'utf8');
    const coverArtSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/components/CoverArt.jsx'), 'utf8');
    const workCardSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/components/WorkCard.jsx'), 'utf8');

    assert.match(coverSrc, /loading=\{priority \? 'eager' : 'lazy'\}/);
    assert.match(coverSrc, /decoding="async"/);
    assert.match(coverSrc, /aspect-square/);
    assert.match(coverSrc, /aspect-\[2\/3\]/);
    assert.match(coverArtSrc, /inferDomainFromWork/);
    assert.match(coverArtSrc, /memo\(/);
    assert.match(workCardSrc, /domain === 'music' \? 'aspect-square' : 'aspect-\[2\/3\]'/);
  });

  it('ativa paginacao incremental no Acervo somente acima de 200 itens com IntersectionObserver', () => {
    assert.equal(CATALOG_PAGINATION_THRESHOLD, 200);
    assert.equal(shouldUseIncrementalPagination(200), false);
    assert.equal(shouldUseIncrementalPagination(201), true);

    const smallCatalog = Array.from({ length: 180 }, (_, idx) => ({ id: `w-${idx}` }));
    const smallSlice = computeCatalogVisibleSlice(smallCatalog, CATALOG_PAGE_BATCH_SIZE);
    assert.equal(smallSlice.paginated, false);
    assert.equal(smallSlice.hasMore, false);
    assert.equal(smallSlice.visibleItems.length, 180);

    const largeCatalog = Array.from({ length: 245 }, (_, idx) => ({ id: `w-${idx}` }));
    const page1 = computeCatalogVisibleSlice(largeCatalog, CATALOG_PAGE_BATCH_SIZE);
    assert.equal(page1.paginated, true);
    assert.equal(page1.hasMore, true);
    assert.equal(page1.visibleItems.length, CATALOG_PAGE_BATCH_SIZE);

    const pageFinal = computeCatalogVisibleSlice(largeCatalog, 300);
    assert.equal(pageFinal.hasMore, false);
    assert.equal(pageFinal.visibleItems.length, 245);

    const listSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/screens/ListScreen.jsx'), 'utf8');
    assert.match(listSrc, /IntersectionObserver/);
    assert.match(listSrc, /computeCatalogVisibleSlice/);
  });

  it('aplica code-splitting em modulos pesados e exibe banner discreto "Nova versao disponivel" do PWA', () => {
    const appSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/App.jsx'), 'utf8');
    const detailSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/components/WorkDetailPage.jsx'), 'utf8');
    const profileSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/screens/ProfileScreen.jsx'), 'utf8');
    const bannerSrc = fs.readFileSync(path.join(ROOT_DIR, 'src/components/PwaUpdateBanner.jsx'), 'utf8');

    assert.match(appSrc, /PwaUpdateBanner/);
    assert.match(appSrc, /codice:pwa-update-available/);
    assert.match(bannerSrc, /Nova versão disponível/);
    assert.match(detailSrc, /const EpisodeListTab = lazy\(/);
    assert.match(detailSrc, /const FranchiseRadarPanel = lazy\(/);
    assert.match(profileSrc, /const ProfileSettingsDrawer = lazy\(/);
  });
});
