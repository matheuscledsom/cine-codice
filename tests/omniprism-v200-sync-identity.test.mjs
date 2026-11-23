import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { OMNIPRISM_DOMAINS, domainConfig } from '../src/config/domainConfig.js';
import {
  clearRelationalMemoryForTests,
  getAllRelationalWorks,
  putRelationalWorks,
} from '../src/services/relationalDb.js';
import {
  OMNI_CATALOG_TABLE,
  OMNI_COVERS_BUCKET,
  cacheCoverImageToSupabaseStorage,
  mapCatalogRowToLocalWork,
  mapLocalWorkToCatalogRow,
  mergeWorksByUpdatedAt,
  queuePendingCloudDelete,
  resetSyncRuntimeFlagsForTests,
  signInWithEmailPassword,
  syncCatalogWithSupabase,
  toCloudWorkId,
} from '../src/services/omniSyncService.js';
import {
  getSupabaseConfig,
  isUnsafeServiceKey,
  normalizeSupabaseUrl,
  resetSupabaseClientForTests,
  saveSupabaseConfig,
} from '../src/services/supabaseClient.js';
import { buildDomainPortalPalette } from '../src/utils/themeTokens.js';

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem(k) {
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      map.set(k, String(v));
    },
    removeItem(k) {
      map.delete(k);
    },
  };
}

describe('OmniPrism v2.0.0 — Supabase Sync, Identidade Visual, Ícones PWA & 4 Portais', () => {
  it('1. supabaseClient valida URLs, rejeita chaves service_role e usa fallback seguro via localStorage (R5)', () => {
    resetSupabaseClientForTests();
    const storage = createMemoryStorage();

    assert.equal(
      normalizeSupabaseUrl('https://exemplo.supabase.co/rest/v1/'),
      'https://exemplo.supabase.co'
    );
    assert.equal(normalizeSupabaseUrl('http://insecure.example.com'), '');

    assert.equal(isUnsafeServiceKey('sb_secret_123456'), true);
    assert.equal(isUnsafeServiceKey('my_service_role_token'), true);
    assert.equal(isUnsafeServiceKey('sb_publishable_demo_public_key'), false);

    const rejected = saveSupabaseConfig(
      { url: 'https://exemplo.supabase.co', anonKey: 'sb_secret_proibida' },
      { storage }
    );
    assert.equal(rejected.ok, false);

    const saved = saveSupabaseConfig(
      {
        url: 'https://exemplo.supabase.co/rest/v1/',
        anonKey: 'sb_publishable_public_demo_key',
      },
      { storage }
    );
    assert.equal(saved.ok, true);
    assert.equal(saved.config.url, 'https://exemplo.supabase.co');
    assert.equal(saved.config.source, 'localStorage');

    const loaded = getSupabaseConfig({ storage });
    assert.equal(loaded.isConfigured, true);
    assert.equal(loaded.anonKey, 'sb_publishable_public_demo_key');
  });

  it('2. Mapeia perfeitamente obras locais para public.catalog_works (domain=cinema) e ida-e-volta', () => {
    const localWork = {
      id: 'movie-blade-runner-2049',
      title: 'Blade Runner 2049',
      director: 'Denis Villeneuve',
      releaseYear: 2017,
      workType: 'movie',
      status: 'completed',
      rating: 95,
      ratingSource: 'manual',
      externalRatings: {
        imdb: { value: 8.0, scale: 10, votes: 900000, fetchedAt: 1732200000000 },
        tmdb: { value: 7.6, scale: 10, votes: 3200, fetchedAt: 1732200000000 },
      },
      tmdbId: 335984,
      imdbId: 'tt1856101',
      coverUrl: 'https://image.tmdb.org/t/p/w500/br2049.jpg',
      backdropUrl: 'https://image.tmdb.org/t/p/w1280/br2049-bg.jpg',
      synopsis: 'Trinta anos depois do primeiro filme.',
      genres: ['Ficção Científica', 'Noir'],
      tags: ['Cyberpunk', 'Neo-Noir'],
      durationMinutes: 164,
      totalSeconds: 9840,
      currentSeconds: 9840,
      belongsToCollection: { id: 422837, name: 'Blade Runner Collection' },
      favoriteRank: 1,
      favoriteScene: 'Neve caindo nas escadas no final.',
      notes: 'Fotografia monumental de Roger Deakins.',
      createdAt: '2026-11-01T10:00:00.000Z',
      updatedAt: '2026-11-20T18:30:00.000Z',
    };

    const row = mapLocalWorkToCatalogRow(localWork, 'user-uuid-1');
    assert.equal(row.domain, 'cinema');
    assert.equal(row.user_id, 'user-uuid-1');
    assert.equal(row.media_type, 'movie');
    assert.equal(row.title, 'Blade Runner 2049');
    assert.equal(row.creator, 'Denis Villeneuve');
    assert.equal(row.release_year, 2017);
    assert.equal(row.status, 'completed');
    assert.equal(row.rating, 95);
    assert.equal(row.external_rating.consensus, 78);
    assert.equal(row.external_ids.tmdb, 335984);
    assert.equal(row.external_ids.imdb, 'tt1856101');
    assert.equal(row.cover_url, 'https://image.tmdb.org/t/p/w500/br2049.jpg');
    assert.equal(row.backdrop_url, 'https://image.tmdb.org/t/p/w1280/br2049-bg.jpg');
    assert.equal(row.franchise_key, 'tmdb-collection:422837');
    assert.equal(row.favorite_rank, 1);
    assert.equal(row.favorite_quote_or_scene, 'Neve caindo nas escadas no final.');
    assert.equal(row.personal_notes, 'Fotografia monumental de Roger Deakins.');
    assert.equal(row.progress_data.durationMinutes, 164);

    const roundTrip = mapCatalogRowToLocalWork(row);
    assert.equal(roundTrip.id, 'movie-blade-runner-2049');
    assert.equal(roundTrip.workType, 'movie');
    assert.equal(roundTrip.rating, 95);
    assert.equal(roundTrip.favoriteRank, 1);
    assert.equal(roundTrip.favoriteScene, 'Neve caindo nas escadas no final.');
    assert.equal(roundTrip.notes, 'Fotografia monumental de Roger Deakins.');
    assert.equal(roundTrip.externalRatings.imdb.value, 8);
    assert.equal(roundTrip.externalRatings.imdb.scale, 10);
  });

  it('3. Sincronização bidirecional resiliente (push inicial, merge por updated_at mais recente e offline fallback)', async () => {
    clearRelationalMemoryForTests();
    resetSyncRuntimeFlagsForTests();
    const storage = createMemoryStorage();
    saveSupabaseConfig(
      { url: 'https://demo.supabase.co', anonKey: 'sb_publishable_demo_key' },
      { storage }
    );

    const localOnly = {
      id: 'local-cowboy',
      title: 'Cowboy Bebop',
      workType: 'anime',
      status: 'playing',
      currentEpisode: 10,
      totalEpisodes: 26,
      updatedAt: '2026-11-23T12:00:00.000Z',
    };
    const localOlder = {
      id: 'shared-dune',
      title: 'Duna',
      workType: 'movie',
      status: 'playing',
      currentSeconds: 1800,
      updatedAt: '2026-11-20T10:00:00.000Z',
    };
    const localDeletedOffline = {
      id: 'deleted-work',
      title: 'Obra Apagada Offline',
      workType: 'movie',
      status: 'queued',
      updatedAt: '2026-11-19T10:00:00.000Z',
    };
    await putRelationalWorks([localOnly, localOlder, localDeletedOffline], { replace: true });
    queuePendingCloudDelete('deleted-work', storage);

    const remoteDb = new Map();
    // Remoto tem versão MAIS NOVA de Duna + uma obra nova adicionada pelo celular + a obra apagada offline
    remoteDb.set(
      toCloudWorkId('shared-dune'),
      mapLocalWorkToCatalogRow(
        {
          ...localOlder,
          status: 'completed',
          rating: 92,
          updatedAt: '2026-11-23T15:00:00.000Z',
        },
        'user-1'
      )
    );
    remoteDb.set(
      toCloudWorkId('mobile-frieren'),
      mapLocalWorkToCatalogRow(
        {
          id: 'mobile-frieren',
          title: 'Frieren',
          workType: 'anime',
          status: 'completed',
          rating: 96,
          updatedAt: '2026-11-23T14:00:00.000Z',
        },
        'user-1'
      )
    );
    remoteDb.set(
      toCloudWorkId('deleted-work'),
      mapLocalWorkToCatalogRow(localDeletedOffline, 'user-1')
    );

    const mockSupabaseClient = {
      auth: {
        async getSession() {
          return { data: { session: { user: { id: 'user-1', email: 'user@example.com' } } }, error: null };
        },
        async signInWithPassword({ email, password }) {
          if (email === 'user@example.com' && password === 'ok') {
            return { data: { session: { user: { id: 'user-1', email } }, user: { id: 'user-1', email } }, error: null };
          }
          return { data: null, error: { message: 'Invalid login credentials' } };
        },
      },
      from(table) {
        assert.equal(table, OMNI_CATALOG_TABLE);
        const filters = {};
        const builder = {
          select() {
            return builder;
          },
          eq(col, val) {
            filters[col] = val;
            return builder;
          },
          in(col, vals) {
            filters[`in:${col}`] = vals;
            return Promise.resolve({
              error: (() => {
                (vals || []).forEach((v) => remoteDb.delete(v));
                return null;
              })(),
            });
          },
          then(resolve) {
            const rows = Array.from(remoteDb.values()).filter(
              (r) =>
                (!filters.user_id || r.user_id === filters.user_id) &&
                (!filters.domain || r.domain === filters.domain)
            );
            return Promise.resolve({ data: rows, error: null }).then(resolve);
          },
          async upsert(rows) {
            rows.forEach((r) => remoteDb.set(r.id, r));
            return { error: null };
          },
          delete() {
            return builder;
          },
        };
        return builder;
      },
    };

    const badLogin = await signInWithEmailPassword(
      { email: 'user@example.com', password: 'wrong' },
      { client: mockSupabaseClient }
    );
    assert.equal(badLogin.ok, false);

    const syncRes = await syncCatalogWithSupabase({
      client: mockSupabaseClient,
      storage,
    });

    assert.equal(syncRes.ok, true);
    assert.equal(syncRes.deletedCount, 1);
    assert.equal(syncRes.pushedCount, 1); // Cowboy Bebop subiu!
    assert.equal(syncRes.works.length, 3); // Cowboy Bebop + Duna + Frieren (deleted-work removida!)

    const idbWorks = await getAllRelationalWorks();
    const dune = idbWorks.find((w) => w.title === 'Duna');
    const frieren = idbWorks.find((w) => w.title === 'Frieren');
    assert.equal(dune?.status, 'completed');
    assert.equal(dune?.rating, 92);
    assert.equal(frieren?.rating, 96);
    assert.equal(remoteDb.has(toCloudWorkId('local-cowboy')), true);
    assert.equal(remoteDb.has(toCloudWorkId('deleted-work')), false);

    // Teste explícito de mergeWorksByUpdatedAt com local mais novo que remoto
    const { mergedWorks, worksToPush } = mergeWorksByUpdatedAt(
      [{ id: 'w1', title: 'Solaris', workType: 'movie', rating: 90, updatedAt: '2026-11-23T18:00:00Z' }],
      [{ id: 'w1', title: 'Solaris', workType: 'movie', rating: 75, updatedAt: '2026-11-23T10:00:00Z' }]
    );
    assert.equal(mergedWorks[0].rating, 90);
    assert.equal(worksToPush.length, 1);
  });

  it('4. Cache de capa no bucket covers com fallback silencioso se CORS bloquear', async () => {
    const mockClientSuccess = {
      auth: {
        async getSession() {
          return { data: { session: { user: { id: 'u-cover' } } }, error: null };
        },
      },
      storage: {
        from(bucket) {
          assert.equal(bucket, OMNI_COVERS_BUCKET);
          return {
            async upload(objectPath) {
              return { data: { path: objectPath }, error: null };
            },
            getPublicUrl(objectPath) {
              return {
                data: {
                  publicUrl: `https://demo.supabase.co/storage/v1/object/public/covers/${objectPath}`,
                },
              };
            },
          };
        },
      },
    };

    // Caso A: CORS bloqueia -> fallback silencioso mantendo URL externa
    const corsBlocked = await cacheCoverImageToSupabaseStorage(
      { id: 'w-cors', coverUrl: 'https://blocked.example.com/poster.jpg' },
      {
        client: mockClientSuccess,
        fetchImpl: async () => {
          throw new TypeError('Failed to fetch (CORS)');
        },
      }
    );
    assert.equal(corsBlocked.ok, false);
    assert.equal(corsBlocked.fallback, true);
    assert.equal(corsBlocked.url, 'https://blocked.example.com/poster.jpg');

    // Caso B: Download ok -> salva cópia no bucket covers
    const okCached = await cacheCoverImageToSupabaseStorage(
      { id: 'w-ok', coverUrl: 'https://image.tmdb.org/t/p/w500/poster.jpg' },
      {
        client: mockClientSuccess,
        fetchImpl: async () => ({
          ok: true,
          async blob() {
            return new Blob(['fake-image-bytes'], { type: 'image/jpeg' });
          },
        }),
      }
    );
    assert.equal(okCached.ok, true);
    assert.equal(okCached.cached, true);
    assert.match(okCached.url, /\/storage\/v1\/object\/public\/covers\/u-cover\//);
  });

  it('5. Identidade OmniPrism: HTML, manifest, ícones SVG/PNG, OmniLogo e 4 Portais OKLCH sem Cine Códice visível', () => {
    const html = fs.readFileSync(path.resolve('index.html'), 'utf8');
    assert.match(html, /<title>OmniPrism<\/title>/);
    assert.match(html, /apple-mobile-web-app-title" content="OmniPrism"/);
    assert.equal(/Cine Códice/i.test(html), false);

    const manifest = JSON.parse(
      fs.readFileSync(path.resolve('public/manifest.webmanifest'), 'utf8')
    );
    assert.equal(manifest.name, 'OmniPrism');
    assert.equal(manifest.short_name, 'OmniPrism');
    assert.equal(/Cine Códice/i.test(JSON.stringify(manifest)), false);

    for (const rel of [
      'public/favicon.svg',
      'public/icons/icon.svg',
      'public/icons/icon-maskable.svg',
      'public/icons/icon-192.png',
      'public/icons/icon-512.png',
      'public/icons/icon-maskable-512.png',
      'public/icons/apple-touch-icon.png',
      'src/components/OmniLogo.jsx',
      'src/components/OmniCloudModal.jsx',
    ]) {
      assert.equal(fs.existsSync(path.resolve(rel)), true, `${rel} deve existir`);
    }

    assert.equal(domainConfig.appName, 'OmniPrism');
    assert.equal(OMNIPRISM_DOMAINS.length, 4);
    assert.deepEqual(
      OMNIPRISM_DOMAINS.map((d) => d.label),
      ['Cinema & Séries', 'Leitura & Acadêmico', 'Games', 'Música']
    );

    // Verifica paletas semânticas OKLCH nos 3 modos
    for (const domain of OMNIPRISM_DOMAINS) {
      for (const mode of ['dark', 'white', 'sepia']) {
        const pal = buildDomainPortalPalette(domain.tintHex, mode);
        assert.match(pal.accent, /^#[0-9A-F]{6}$/);
        assert.match(pal.surface, /^#[0-9A-F]{6}$/);
      }
    }

    const homeSrc = fs.readFileSync(path.resolve('src/screens/HomeScreen.jsx'), 'utf8');
    assert.match(homeSrc, /OmniLogo/);
    assert.match(homeSrc, /Portais de Domínio OmniPrism/);

    const appSrc = fs.readFileSync(path.resolve('src/App.jsx'), 'utf8');
    assert.match(appSrc, /Local Offline/);
    assert.match(appSrc, /Sincronizado Supabase/);
    assert.match(appSrc, /OmniCloudModal/);
  });
});
