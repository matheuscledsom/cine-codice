import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  OMNIPRISM_DOMAINS,
  OMNIPRISM_DOMAIN_IDS,
  getMediaTypesForDomain,
  getWorkTypeLabel,
  inferDomainFromWork,
  normalizeWorkTypeForDomain,
} from '../src/config/domainConfig.js';
import { computeDomainBreakdownMetrics } from '../src/lib/profileMetrics.js';
import {
  buildCodiceDatabase,
  hydrateAppSnapshotFromDatabase,
} from '../src/services/codiceDatabase.js';
import {
  fetchMusicReleaseTracks,
  getQuickSuggestionsForDomain,
  searchGamesWorks,
  searchMusicWorks,
  searchReadingWorks,
  searchWorksByDomain,
} from '../src/services/multiDomainSearchService.js';
import { resetProviderRegistryForTests } from '../src/services/providerRegistry.js';
import {
  filterWorksByDomain,
  mapCatalogRowToLocalWork,
  mapLocalWorkToCatalogRow,
  resetSyncRuntimeFlagsForTests,
  syncCatalogWithSupabase,
} from '../src/services/omniSyncService.js';
import { normalizeRelationalWorkRecord } from '../src/services/relationalDb.js';
import {
  calculateWorkProgress,
  formatCatalogCardFormatBadge,
  formatFlexibleProgressMetric,
} from '../src/utils/backlogHelpers.js';
import { buildHarmonizedThemeVars, getContrastRatio } from '../src/utils/themeTokens.js';

function createMemoryStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}

function createFakeMultiDomainSupabaseClient({ initialRows = [], userId = 'user-v210' } = {}) {
  const rows = new Map(initialRows.map((r) => [r.id, { ...r }]));
  return {
    _rows: rows,
    auth: {
      async getSession() {
        return { data: { session: { user: { id: userId, email: 'omni@prism.app' } } }, error: null };
      },
      onAuthStateChange() {
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
    from() {
      return {
        select() {
          const filters = [];
          const chain = {
            eq(col, val) {
              filters.push([col, val]);
              return chain;
            },
            then(resolve, reject) {
              const matched = Array.from(rows.values()).filter((r) =>
                filters.every(([col, val]) => r[col] === val)
              );
              return Promise.resolve({ data: matched, error: null }).then(resolve, reject);
            },
          };
          return chain;
        },
        upsert(payload) {
          const list = Array.isArray(payload) ? payload : [payload];
          list.forEach((row) => rows.set(row.id, { ...row }));
          return Promise.resolve({ error: null });
        },
        delete() {
          const filters = [];
          let inIds = null;
          const chain = {
            eq(col, val) {
              filters.push([col, val]);
              return chain;
            },
            in(_col, ids) {
              inIds = new Set(ids);
              for (const [id, r] of rows.entries()) {
                const matchFilters = filters.every(([c, v]) => r[c] === v);
                if (matchFilters && inIds.has(id)) {
                  rows.delete(id);
                }
              }
              return Promise.resolve({ error: null });
            },
          };
          return chain;
        },
      };
    },
  };
}

describe('OmniPrism v2.1.0 — 4 Portais de Domínio (Cinema, Leitura, Games e Música)', () => {
  it('1. Ativa todos os 4 domínios, remove "Em breve" e garante contraste OKLCH WCAG AA >= 4.5:1', () => {
    assert.deepEqual(OMNIPRISM_DOMAIN_IDS, ['cinema', 'reading', 'games', 'music']);
    for (const dom of OMNIPRISM_DOMAINS) {
      assert.equal(dom.status, 'active');
      assert.equal(/Em breve/i.test(dom.badge || ''), false);

      for (const mode of ['dark', 'white', 'sepia']) {
        const built = buildHarmonizedThemeVars(mode, dom.tintHex);
        const accentOnSurface = getContrastRatio(
          built.vars['--accent-primary'],
          built.vars['--bg-surface']
        );
        const contrastOnAccent = getContrastRatio(
          built.vars['--accent-contrast'],
          built.vars['--accent-primary']
        );
        assert.ok(accentOnSurface >= 4.5, `${dom.id}/${mode} accentOnSurface=${accentOnSurface}`);
        assert.ok(contrastOnAccent >= 4.5, `${dom.id}/${mode} contrastOnAccent=${contrastOnAccent}`);
      }
    }

    assert.deepEqual(
      getMediaTypesForDomain('reading').map((m) => m.id),
      ['book', 'manga', 'paper', 'technical']
    );
    assert.deepEqual(
      getMediaTypesForDomain('games').map((m) => m.id),
      ['game', 'dlc', 'modpack']
    );
    assert.deepEqual(
      getMediaTypesForDomain('music').map((m) => m.id),
      ['track', 'album', 'ep_single', 'discography', 'live_show']
    );

    for (const file of [
      'src/config/domainConfig.js',
      'src/screens/HomeScreen.jsx',
      'src/components/DomainSwitcherBar.jsx',
    ]) {
      const content = fs.readFileSync(path.resolve(file), 'utf8');
      assert.equal(/Em breve/i.test(content), false, `${file} não deve conter "Em breve"`);
    }
  });

  it('2. Busca pública Leitura (Open Library + Google Books), Games (IGDB/RAWG/Steam/Wikidata) e Música (iTunes 600x600 + MusicBrainz + Tracklist)', async () => {
    const mockReadingFetch = async (url) => {
      if (url.includes('openlibrary.org')) {
        return {
          ok: true,
          async json() {
            return {
              docs: [
                {
                  key: '/works/OL123W',
                  title: 'Dune',
                  author_name: ['Frank Herbert'],
                  first_publish_year: 1965,
                  number_of_pages_median: 412,
                  cover_i: 999,
                  isbn: ['9780441172719'],
                  subject: ['Science fiction'],
                },
              ],
            };
          },
        };
      }
      return {
        ok: true,
        async json() {
          return {
            items: [
              {
                id: 'gb-1',
                volumeInfo: {
                  title: 'Clean Architecture',
                  authors: ['Robert C. Martin'],
                  publishedDate: '2017-09-20',
                  pageCount: 432,
                  description: 'Software architecture guide.',
                  imageLinks: { thumbnail: 'http://books.google.com/thumb.jpg' },
                },
              },
            ],
          };
        },
      };
    };

    const readingRes = await searchReadingWorks('dune', { fetchImpl: mockReadingFetch });
    assert.equal(readingRes.ok, true);
    assert.equal(readingRes.results.length, 2);
    assert.equal(readingRes.results[0].domain, 'reading');
    assert.equal(readingRes.results[0].totalPages, 412);
    assert.equal(readingRes.results[1].coverUrl, 'https://books.google.com/thumb.jpg');

    resetProviderRegistryForTests();
    const mockGamesFetch = async (url) => {
      if (url.includes('/api/igdb')) {
        return { ok: false, status: 503, async json() { return { notConfigured: true }; } };
      }
      if (url.includes('/api/steam') && url.includes('term=')) {
        return {
          ok: true,
          async json() {
            return {
              items: [
                {
                  id: 1245620,
                  name: 'Elden Ring',
                  tiny_image:
                    'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1245620/capsule_231x87.jpg',
                },
              ],
            };
          },
        };
      }
      if (url.includes('/api/steam') && url.includes('appid=1245620')) {
        return {
          ok: true,
          async json() {
            return {
              1245620: {
                success: true,
                data: {
                  type: 'game',
                  developers: ['FromSoftware'],
                  publishers: ['Bandai Namco'],
                  release_date: { date: '24 Feb, 2022' },
                },
              },
            };
          },
        };
      }
      return { ok: true, async json() { return { search: [] }; } };
    };

    const gamesRes = await searchGamesWorks('elden ring', { fetchImpl: mockGamesFetch });
    assert.equal(gamesRes.ok, true);
    assert.equal(gamesRes.results[0].domain, 'games');
    assert.match(gamesRes.results[0].coverUrl, /steamstatic\.com.*1245620/);
    assert.equal(gamesRes.results[0].platform, 'PC');

    const mockMusicFetch = async (url) => {
      if (url.includes('itunes.apple.com/search')) {
        return {
          ok: true,
          async json() {
            return {
              results: [
                {
                  collectionId: 777,
                  collectionName: 'Powerslave',
                  artistName: 'Iron Maiden',
                  releaseDate: '1984-09-03T07:00:00Z',
                  primaryGenreName: 'Metal',
                  trackCount: 8,
                  artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/100x100bb.jpg',
                },
              ],
            };
          },
        };
      }
      if (url.includes('itunes.apple.com/lookup')) {
        return {
          ok: true,
          async json() {
            return {
              results: [
                { wrapperType: 'collection', collectionId: 777 },
                { wrapperType: 'track', trackNumber: 1, trackName: 'Aces High', trackTimeMillis: 271000 },
                { wrapperType: 'track', trackNumber: 8, trackName: 'Rime of the Ancient Mariner', trackTimeMillis: 816000 },
              ],
            };
          },
        };
      }
      return { ok: true, async json() { return { 'release-groups': [] }; } };
    };

    const musicRes = await searchMusicWorks('powerslave', { fetchImpl: mockMusicFetch });
    assert.equal(musicRes.ok, true);
    assert.equal(musicRes.results[0].domain, 'music');
    assert.match(musicRes.results[0].coverUrl, /600x600bb\.jpg/);

    const tracks = await fetchMusicReleaseTracks(musicRes.results[0], {
      fetchImpl: mockMusicFetch,
    });
    assert.equal(tracks.length, 2);
    assert.equal(tracks[0].title, 'Aces High');

    for (const dom of OMNIPRISM_DOMAIN_IDS) {
      assert.ok(getQuickSuggestionsForDomain(dom).length >= 4);
    }
    const unknownRes = await searchWorksByDomain('cinema', 'dune');
    assert.equal(unknownRes.ok, true);
    const offlineFallback = await searchReadingWorks('dune', {
      fetchImpl: async () => {
        throw new Error('Network unavailable');
      },
    });
    assert.equal(offlineFallback.ok, false);
    assert.deepEqual(offlineFallback.results, []);
  });

  it('3. IndexedDB, Backup .ccodex/JSON e Supabase Sync persistem e filtram os 4 domínios (migrando legado para cinema)', async () => {
    const legacyWork = normalizeRelationalWorkRecord({
      id: 'legacy-film-1',
      title: 'Stalker',
      workType: 'movie',
      status: 'completed',
    });
    assert.equal(legacyWork.domain, 'cinema');

    const bookWork = normalizeRelationalWorkRecord({
      id: 'book-1',
      domain: 'reading',
      workType: 'book',
      title: 'Duna',
      creator: 'Frank Herbert',
      pagesRead: 120,
      totalPages: 340,
      chaptersRead: 6,
      isbnOrDoi: '978-8576573135',
      bookFormat: 'Físico',
      favoriteScene: 'O medo é o assassino da mente.',
      status: 'playing',
      rating: 95,
      ratingSource: 'manual',
      updatedAt: '2026-11-23T20:00:00.000Z',
    });

    const gameWork = normalizeRelationalWorkRecord({
      id: 'game-1',
      domain: 'games',
      workType: 'game',
      title: 'Hollow Knight',
      creator: 'Team Cherry',
      platform: 'PC',
      hoursPlayed: 48,
      completionType: '100% / Platina',
      storeOrLauncher: 'Steam',
      buildOrCharacter: 'Unbreakable Strength + Quick Slash',
      status: 'completed',
      rating: 98,
      ratingSource: 'manual',
      isFavorite: true,
      favoriteRank: 1,
      updatedAt: '2026-11-23T20:05:00.000Z',
    });

    const musicWork = normalizeRelationalWorkRecord({
      id: 'music-1',
      domain: 'music',
      workType: 'album',
      title: 'Temple of Shadows',
      creator: 'Angra',
      favoriteTrack: 'Spread Your Fire',
      subgenre: 'Power Metal',
      releaseFormat: 'Álbum de Estúdio',
      listenCount: 14,
      tracks: [{ number: 1, title: 'Deus Le Volt!' }, { number: 2, title: 'Spread Your Fire' }],
      status: 'completed',
      rating: 96,
      ratingSource: 'manual',
      updatedAt: '2026-11-23T20:10:00.000Z',
    });

    // Verifica preservação no construtor de backup multi-domínio e re-hidratação (.ccodex / JSON)
    const dbBackup = buildCodiceDatabase({ items: [legacyWork, bookWork, gameWork, musicWork] });
    assert.equal(dbBackup.tables.works.length, 4);
    const hydrated = hydrateAppSnapshotFromDatabase(dbBackup);
    assert.equal(hydrated.items.length, 4);
    assert.equal(hydrated.items.find((w) => w.id === 'book-1').pagesRead, 120);
    assert.equal(hydrated.items.find((w) => w.id === 'game-1').platform, 'PC');
    assert.equal(hydrated.items.find((w) => w.id === 'music-1').favoriteTrack, 'Spread Your Fire');

    // Verifica round-trip local <-> public.catalog_works
    const bookRow = mapLocalWorkToCatalogRow(bookWork, 'user-v210');
    assert.equal(bookRow.domain, 'reading');
    assert.equal(bookRow.progress_data.pages_read, 120);
    assert.equal(bookRow.progress_data.total_pages, 340);
    assert.equal(bookRow.progress_data.book_format, 'Físico');
    assert.equal(mapCatalogRowToLocalWork(bookRow).isbnOrDoi, '978-8576573135');

    const gameRow = mapLocalWorkToCatalogRow(gameWork, 'user-v210');
    assert.equal(gameRow.domain, 'games');
    assert.equal(gameRow.progress_data.platform, 'PC');
    assert.equal(gameRow.progress_data.hours_played, 48);
    assert.equal(mapCatalogRowToLocalWork(gameRow).buildOrCharacter, 'Unbreakable Strength + Quick Slash');

    const musicRow = mapLocalWorkToCatalogRow(musicWork, 'user-v210');
    assert.equal(musicRow.domain, 'music');
    assert.equal(musicRow.progress_data.favorite_track, 'Spread Your Fire');
    assert.equal(musicRow.progress_data.listen_count, 14);
    assert.equal(mapCatalogRowToLocalWork(musicRow).tracks.length, 2);

    assert.equal(filterWorksByDomain([legacyWork, bookWork, gameWork, musicWork], 'reading').length, 1);

    // Sincronização multi-domínio completa com cliente Supabase mockado
    resetSyncRuntimeFlagsForTests();
    const storage = createMemoryStorage();
    const remoteClient = createFakeMultiDomainSupabaseClient({
      initialRows: [mapLocalWorkToCatalogRow(musicWork, 'user-v210')],
    });
    const syncRes = await syncCatalogWithSupabase({
      client: remoteClient,
      localWorksOverride: [legacyWork, bookWork, gameWork],
      storage,
    });
    assert.equal(syncRes.ok, true);
    assert.equal(syncRes.works.length, 4);
    assert.equal(remoteClient._rows.size, 4);
    assert.equal(inferDomainFromWork(bookWork), 'reading');
    assert.equal(getWorkTypeLabel('paper', 'reading'), 'Artigo / Paper');
    assert.equal(normalizeWorkTypeForDomain('dlc', 'games'), 'dlc');
  });

  it('4. Cards, métricas por domínio e tela de Perfil exibem corretamente os 4 mundos', () => {
    const readingItem = {
      domain: 'reading',
      workType: 'book',
      title: 'Duna',
      pagesRead: 120,
      totalPages: 340,
      status: 'playing',
      rating: 90,
      ratingSource: 'manual',
    };
    const gameItem = {
      domain: 'games',
      workType: 'game',
      title: 'Hollow Knight',
      platform: 'PC',
      hoursPlayed: 48,
      completionType: '100% / Platina',
      status: 'completed',
      rating: 96,
      ratingSource: 'manual',
      isFavorite: true,
    };
    const musicItem = {
      domain: 'music',
      workType: 'album',
      title: 'Powerslave',
      favoriteTrack: 'Aces High',
      listenCount: 9,
      status: 'completed',
      rating: 94,
      ratingSource: 'manual',
      favoriteRank: 2,
    };
    const cinemaItem = {
      domain: 'cinema',
      workType: 'movie',
      title: 'Blade Runner 2049',
      durationMinutes: 164,
      status: 'completed',
    };

    assert.equal(formatCatalogCardFormatBadge(readingItem).label, 'Pág. 120/340');
    assert.equal(formatCatalogCardFormatBadge(gameItem).label, 'PC · 48h · 100%');
    assert.equal(formatCatalogCardFormatBadge(musicItem).label, 'Álbum · Faixa fav.');
    assert.match(formatFlexibleProgressMetric(readingItem), /Pág\. 120\/340/);
    assert.match(formatFlexibleProgressMetric(gameItem), /PC · 48h/);
    assert.match(formatFlexibleProgressMetric(musicItem), /Faixa: Aces High/);
    assert.equal(calculateWorkProgress(readingItem), Math.round((120 / 340) * 100));

    const breakdown = computeDomainBreakdownMetrics([
      readingItem,
      gameItem,
      musicItem,
      cinemaItem,
    ]);
    assert.equal(breakdown.length, 4);
    assert.equal(breakdown.find((d) => d.domainId === 'reading').averageRating, 90);
    assert.equal(breakdown.find((d) => d.domainId === 'games').favoritesCount, 1);
    assert.equal(breakdown.find((d) => d.domainId === 'music').completedWorks, 1);
    assert.equal(breakdown.find((d) => d.domainId === 'cinema').averageRatingLabel, '—');

    for (const rel of [
      'src/components/WorkCard.jsx',
      'src/components/WorkDetailPage.jsx',
      'src/screens/AddScreen.jsx',
      'src/screens/ListScreen.jsx',
      'src/screens/ProfileScreen.jsx',
    ]) {
      assert.equal(fs.existsSync(path.resolve(rel)), true);
    }
    const profileSrc = fs.readFileSync(path.resolve('src/screens/ProfileScreen.jsx'), 'utf8');
    assert.match(profileSrc, /Resumo dos 4 Mundos/);
    const detailSrc = fs.readFileSync(path.resolve('src/components/WorkDetailPage.jsx'), 'utf8');
    assert.match(detailSrc, /WorkDetailModal/);
  });
});
