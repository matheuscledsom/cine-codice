import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { handleLastfmProxyRequest } from '../functions/api/lastfm.js';
import { handleStatusRequest } from '../functions/api/status.js';
import { clearMemoryApiCacheForTests } from '../src/api/cacheDb.js';
import { resetApiClientStateForTests } from '../src/api/httpClient.js';
import { PROVIDER_LIMITS } from '../src/api/limits.js';
import {
  computeDerivedAverage,
  computeDiscographyCompleteness,
  filterMusicBrainzStudioAlbums,
  resolveAlbumDerivedVsManualRating,
  selectTopSubgenreTags,
  updateEditableSubgenres,
} from '../src/lib/musicDepth.js';
import { buildMusicHierarchy } from '../src/lib/musicHierarchy.js';
import { probeApiSource } from '../src/services/apiStatusService.js';
import {
  fetchLastfmSubgenres,
  fetchMusicBrainzArtistStudioAlbums,
} from '../src/services/musicDepthService.js';
import { computeAlbumTrackRatingPatch } from '../src/utils/catalogDraftHelpers.js';

const ROOT_DIR = path.resolve(process.cwd());
const readText = (rel) => fs.readFileSync(path.join(ROOT_DIR, rel), 'utf8');

function makeJsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function createMockCache() {
  const store = new Map();
  return {
    operations: [],
    async match(req) {
      const key = typeof req === 'string' ? req : req.url;
      this.operations.push({ op: 'match', key });
      const hit = store.get(key);
      return hit ? hit.clone() : undefined;
    },
    async put(req, res) {
      const key = typeof req === 'string' ? req : req.url;
      this.operations.push({
        op: 'put',
        key,
        cacheControl: res.headers.get('Cache-Control'),
      });
      store.set(key, res.clone());
    },
  };
}

describe('OMNIPRISM v2.5.0 Fase B — 1. Proxy Last.fm, CSP, segredo server-only e Status Nao configurado', () => {
  const baseEnv = {
    SUPABASE_URL: 'https://demo.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key-demo',
    TMDB_API_KEY: 'tmdb-secret',
    OMDB_API_KEY: 'omdb-secret',
    LASTFM_API_KEY: 'lastfm-server-secret-999',
  };

  it('atualiza connect-src em public/_headers com ws.audioscrobbler.com e proibe VITE_LASTFM_API_KEY', () => {
    const headers = readText('public/_headers');
    assert.match(headers, /connect-src[^;\n]*https:\/\/ws\.audioscrobbler\.com/);

    const walk = (dir, acc = []) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, acc);
        else if (/\.(js|jsx|mjs)$/.test(entry.name)) acc.push(full);
      }
      return acc;
    };
    const files = [
      ...walk(path.join(ROOT_DIR, 'src')),
      ...walk(path.join(ROOT_DIR, 'functions')),
    ];
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8');
      assert.equal(
        /VITE_LASTFM_API_KEY/.test(text),
        false,
        `VITE_LASTFM_API_KEY proibido encontrado em ${f}`
      );
    }
  });

  it('permite SOMENTE GET autenticado em artist.getTopTags e album.getTopTags, remove chave do cliente e degrada sem chave', async () => {
    const upstreamUrls = [];
    const cache = createMockCache();

    const fetchMock = async (url, opts) => {
      const str = String(url);
      if (str.includes('/auth/v1/user')) {
        return opts?.headers?.Authorization === 'Bearer jwt-ok'
          ? makeJsonResponse({ id: 'user-1' }, 200)
          : makeJsonResponse({ error: 'unauthorized' }, 401);
      }
      upstreamUrls.push(str);
      return makeJsonResponse({
        toptags: {
          tag: [
            { name: 'alternative rock', count: 100 },
            { name: 'art rock', count: 78 },
            { name: 'electronic', count: 45 },
          ],
        },
      });
    };

    // POST -> 405
    const postRes = await handleLastfmProxyRequest(
      {
        request: new Request(
          'https://app.pages.dev/api/lastfm?method=artist.getTopTags&artist=Radiohead',
          { method: 'POST', headers: { Authorization: 'Bearer jwt-ok' } }
        ),
        env: baseEnv,
      },
      { fetchImpl: fetchMock, cacheOverride: cache }
    );
    assert.equal(postRes.status, 405);

    // Sem Bearer -> 401
    const noAuth = await handleLastfmProxyRequest(
      {
        request: new Request(
          'https://app.pages.dev/api/lastfm?method=artist.getTopTags&artist=Radiohead'
        ),
        env: baseEnv,
      },
      { fetchImpl: fetchMock, cacheOverride: cache }
    );
    assert.equal(noAuth.status, 401);

    // Metodos fora da allowlist -> 403
    for (const badMethod of ['user.getInfo', 'track.scrobble', 'artist.getInfo', '']) {
      const forbidden = await handleLastfmProxyRequest(
        {
          request: new Request(
            `https://app.pages.dev/api/lastfm?method=${encodeURIComponent(badMethod)}&artist=Radiohead`,
            { headers: { Authorization: 'Bearer jwt-ok' } }
          ),
          env: baseEnv,
        },
        { fetchImpl: fetchMock, cacheOverride: cache }
      );
      assert.equal(forbidden.status, 403, `Esperava 403 para method=${badMethod}`);
    }

    // Sem LASTFM_API_KEY no servidor -> 503 + /api/status configured: false + Status "Nao configurado"
    const envNoLastfm = { ...baseEnv, LASTFM_API_KEY: '' };
    const missingKeyRes = await handleLastfmProxyRequest(
      {
        request: new Request(
          'https://app.pages.dev/api/lastfm?method=artist.getTopTags&artist=Radiohead',
          { headers: { Authorization: 'Bearer jwt-ok' } }
        ),
        env: envNoLastfm,
      },
      { fetchImpl: fetchMock, cacheOverride: cache }
    );
    assert.equal(missingKeyRes.status, 503);

    const statusRes = await handleStatusRequest(
      {
        request: new Request('https://app.pages.dev/api/status', {
          headers: { Authorization: 'Bearer jwt-ok' },
        }),
        env: envNoLastfm,
      },
      { fetchImpl: fetchMock }
    );
    const statusJson = await statusRes.json();
    assert.equal(statusJson.providers.lastfm.configured, false);

    // Cliente degrada sem quebrar quando /api/lastfm devolve 503
    clearMemoryApiCacheForTests();
    const degraded = await fetchLastfmSubgenres({
      artist: 'Radiohead',
      album: 'OK Computer',
      accessToken: 'jwt-ok',
      forceProxy: true,
      isDev: false,
      fetchImpl: async () => makeJsonResponse({ error: 'Não configurado', configured: false }, 503),
    });
    assert.equal(degraded.ok, false);
    assert.equal(degraded.notConfigured, true);
    assert.deepEqual(degraded.tags, []);

    const probeNotCfg = await probeApiSource('lastfm', {
      accessToken: 'jwt-ok',
      forceProxy: true,
      isDev: false,
      fetchImpl: async () => makeJsonResponse({ error: 'Não configurado', configured: false }, 503),
    });
    assert.equal(probeNotCfg.state, 'not_configured');
    assert.match(readText('src/components/ApiStatusPanel.jsx'), /Não configurado/);

    // Metodos permitidos removem api_key do cliente e injetam segredo do servidor
    const okArtist = await handleLastfmProxyRequest(
      {
        request: new Request(
          'https://app.pages.dev/api/lastfm?method=artist.getTopTags&artist=Radiohead&api_key=CLIENT_EVIL',
          { headers: { Authorization: 'Bearer jwt-ok' } }
        ),
        env: baseEnv,
      },
      { fetchImpl: fetchMock, cacheOverride: cache }
    );
    assert.equal(okArtist.status, 200);

    const okAlbum = await handleLastfmProxyRequest(
      {
        request: new Request(
          'https://app.pages.dev/api/lastfm?method=album.getTopTags&artist=Radiohead&album=OK+Computer&key=CLIENT_EVIL2',
          { headers: { Authorization: 'Bearer jwt-ok' } }
        ),
        env: baseEnv,
      },
      { fetchImpl: fetchMock, cacheOverride: cache }
    );
    assert.equal(okAlbum.status, 200);

    assert.equal(upstreamUrls.length, 2);
    for (const u of upstreamUrls) {
      assert.equal(u.includes('CLIENT_EVIL'), false);
      assert.equal(u.includes(`api_key=${baseEnv.LASTFM_API_KEY}`), true);
    }
    const puts = cache.operations.filter((o) => o.op === 'put');
    assert.equal(puts.length, 2);
    for (const p of puts) {
      assert.equal(p.key.includes(baseEnv.LASTFM_API_KEY), false);
    }
  });
});

describe('OMNIPRISM v2.5.0 Fase B — 2. Medias derivadas, Subgeneros e Completude MusicBrainz', () => {
  it('calcula media derivada com cobertura, ignora ausentes, marca provisoria com < 3 e nunca sobrescreve estrela manual', () => {
    // 2 de 12 faixas avaliadas -> provisoria, ignorando 10 null
    const prov = computeDerivedAverage({
      ratings: [9, 10, null, undefined, null, null, null, null, null, null, null, null],
      totalItems: 12,
      unit: 'track',
    });
    assert.equal(prov.average, 9.5);
    assert.equal(prov.ratedCount, 2);
    assert.equal(prov.totalCount, 12);
    assert.equal(prov.provisional, true);
    assert.equal(prov.provisionalLabel, 'provisória');
    assert.equal(prov.coverageLabel, '2 de 12 faixas avaliadas');

    // 5 de 12 faixas avaliadas -> estavel (nao provisoria)
    const stable = computeDerivedAverage({
      ratings: [8, 9, 10, 9, 9, null, null],
      totalItems: 12,
      unit: 'track',
    });
    assert.equal(stable.average, 9);
    assert.equal(stable.provisional, false);
    assert.equal(stable.coverageLabel, '5 de 12 faixas avaliadas');

    // Avaliar faixa NUNCA sobrescreve a estrela manual do album
    const album = {
      id: 'alb-1',
      domain: 'music',
      workType: 'album',
      title: 'In Rainbows',
      rating: 100, // 5.0 estrelas manuais
      ratingSource: 'manual',
      tracks: [
        { number: 1, title: '15 Step' },
        { number: 2, title: 'Bodysnatchers' },
      ],
      trackRatings: {},
    };
    const trackPatch = computeAlbumTrackRatingPatch(album, album.tracks[0], 0, 6);
    assert.equal('rating' in trackPatch.patch, false);

    const comparison = resolveAlbumDerivedVsManualRating(album, prov);
    assert.equal(comparison.manualScore100, 100);
    assert.equal(comparison.manualStars, 5);
    assert.equal(comparison.manualRatingPreserved, true);
    assert.equal(comparison.derivedAverage10, 9.5);
    assert.equal(comparison.derivedProvisional, true);
  });

  it('filtra 2 a 3 subgeneros acima do limite minimo, remove ruido e permite edicao livre', () => {
    const picked = selectTopSubgenreTags(
      [
        { name: 'seen live', count: 100 },
        { name: 'Radiohead', count: 100 },
        { name: '1997', count: 95 },
        { name: 'alternative rock', count: 90 },
        { name: 'art rock', count: 72 },
        { name: 'electronic', count: 40 },
        { name: 'experimental', count: 35 },
        { name: 'obscure tag', count: 5 },
      ],
      { minVotes: 20, maxTags: 3, excludeNames: ['Radiohead'] }
    );
    assert.deepEqual(picked, ['Alternative Rock', 'Art Rock', 'Electronic']);

    // Editaveis: remover e adicionar tag manual
    const removed = updateEditableSubgenres(picked, { remove: 'Electronic' });
    assert.deepEqual(removed, ['Alternative Rock', 'Art Rock']);
    const added = updateEditableSubgenres(removed, { add: 'post-punk' });
    assert.deepEqual(added, ['Alternative Rock', 'Art Rock', 'Post-Punk']);
  });

  it('limita MusicBrainz a 1 req/s com cache, filtra release-groups Album sem tipos secundarios, suporta nao conta e degrada para contagem', async () => {
    assert.equal(PROVIDER_LIMITS.musicbrainz.maxRequestsPerSec, 1);
    assert.equal(PROVIDER_LIMITS.musicbrainz.minIntervalMs, 1000);

    // Filtro estrito: apenas primary-type Album com secondary-types vazio
    const filtered = filterMusicBrainzStudioAlbums([
      { id: 'mb-1', title: 'Pablo Honey', 'primary-type': 'Album', 'secondary-types': [], 'first-release-date': '1993-02-22' },
      { id: 'mb-2', title: 'The Bends', 'primary-type': 'Album', 'secondary-types': [], 'first-release-date': '1995-03-13' },
      { id: 'mb-3', title: 'OK Computer', 'primary-type': 'Album', 'secondary-types': [], 'first-release-date': '1997-05-21' },
      { id: 'mb-live', title: 'I Might Be Wrong', 'primary-type': 'Album', 'secondary-types': ['Live'], 'first-release-date': '2001-11-12' },
      { id: 'mb-comp', title: 'The Best Of', 'primary-type': 'Album', 'secondary-types': ['Compilation'], 'first-release-date': '2008-06-02' },
      { id: 'mb-ep', title: 'My Iron Lung', 'primary-type': 'EP', 'secondary-types': [], 'first-release-date': '1994-09-26' },
    ]);
    assert.deepEqual(
      filtered.map((a) => a.title),
      ['Pablo Honey', 'The Bends', 'OK Computer']
    );

    // Verifica rate limit 1 req/s + cache na segunda chamada
    clearMemoryApiCacheForTests();
    resetApiClientStateForTests();
    let virtualNow = 10_000;
    const sleeps = [];
    const mbFetchCalls = [];

    const mbRes1 = await fetchMusicBrainzArtistStudioAlbums('Radiohead', {
      nowFn: () => virtualNow,
      sleepFn: async (ms) => {
        sleeps.push(ms);
        virtualNow += ms;
      },
      fetchImpl: async (url) => {
        mbFetchCalls.push({ url: String(url), at: virtualNow });
        if (String(url).includes('/ws/2/artist?')) {
          return makeJsonResponse({
            artists: [{ id: 'a74b1b7f-71a5-4011-9441-d0b5e4122711', name: 'Radiohead' }],
          });
        }
        return makeJsonResponse({
          'release-groups': [
            { id: 'mb-1', title: 'Pablo Honey', 'primary-type': 'Album', 'secondary-types': [], 'first-release-date': '1993' },
            { id: 'mb-2', title: 'The Bends', 'primary-type': 'Album', 'secondary-types': [], 'first-release-date': '1995' },
            { id: 'mb-3', title: 'OK Computer', 'primary-type': 'Album', 'secondary-types': [], 'first-release-date': '1997' },
            { id: 'mb-live', title: 'Live', 'primary-type': 'Album', 'secondary-types': ['Live'], 'first-release-date': '2001' },
          ],
        });
      },
    });

    assert.equal(mbRes1.available, true);
    assert.equal(mbRes1.source, 'MusicBrainz');
    assert.equal(mbRes1.albums.length, 3);
    assert.equal(mbFetchCalls.length, 2);
    assert.ok(
      mbFetchCalls[1].at - mbFetchCalls[0].at >= 1000,
      `Esperado intervalo >= 1000ms entre chamadas MusicBrainz, obtido ${mbFetchCalls[1].at - mbFetchCalls[0].at}ms`
    );

    // Segunda chamada vem do cache (0 chamadas de rede extras)
    const mbRes2 = await fetchMusicBrainzArtistStudioAlbums('Radiohead', {
      nowFn: () => virtualNow,
      fetchImpl: async () => {
        throw new Error('Nao deveria ir a rede quando em cache');
      },
    });
    assert.equal(mbRes2.fromCache, true);
    assert.equal(mbRes2.albums.length, 3);

    // Completude COM MusicBrainz + opcao "nao conta"
    const localCatalog = [
      { id: 'l1', domain: 'music', workType: 'album', creator: 'Radiohead', title: 'OK Computer', status: 'completed', rating: 100 },
      { id: 'l2', domain: 'music', workType: 'album', creator: 'Radiohead', title: 'Pablo Honey', status: 'queued' },
    ];
    const compWithMb = computeDiscographyCompleteness({
      catalogReleases: localCatalog,
      mbStudioAlbums: mbRes1,
      excludedKeys: ['mbid:mb-1'], // "Pablo Honey" marcado como "nao conta"
    });
    assert.equal(compWithMb.mode, 'musicbrainz');
    assert.equal(compWithMb.sourceLabel, 'Fonte: MusicBrainz (álbuns de estúdio)');
    assert.equal(compWithMb.totalCount, 2);
    assert.equal(compWithMb.completedCount, 1);
    assert.equal(compWithMb.excludedCount, 1);
    assert.equal(compWithMb.pct, 50);

    // Completude SEM MusicBrainz -> mostra SO a contagem (sem total nem percentual)
    const compNoMb = computeDiscographyCompleteness({
      catalogReleases: localCatalog,
      mbStudioAlbums: null,
    });
    assert.equal(compNoMb.mode, 'count-only');
    assert.equal(compNoMb.totalCount, null);
    assert.equal(compNoMb.pct, null);
    assert.equal(compNoMb.completedCount, 1);
    assert.equal(compNoMb.catalogCount, 2);

    // buildMusicHierarchy expoe derivedAlbumsAverage (provisoria com 1 album avaliado) e completeness
    const hierarchy = buildMusicHierarchy(localCatalog, {
      mbStudioAlbumsByArtist: { radiohead: mbRes1 },
    });
    assert.equal(hierarchy.artists[0].derivedAlbumsAverage.provisional, true);
    assert.equal(hierarchy.artists[0].derivedAlbumsAverage.coverageLabel, '1 de 2 álbuns avaliados');
    assert.equal(hierarchy.artists[0].completeness.mode, 'musicbrainz');
  });
});
