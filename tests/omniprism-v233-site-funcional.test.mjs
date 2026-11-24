import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { handleOmdbProxyRequest } from '../functions/api/omdb.js';
import { handleStatusRequest } from '../functions/api/status.js';
import { handleTmdbProxyRequest } from '../functions/api/tmdb/[[path]].js';
import { clearMemoryApiCacheForTests } from '../src/api/cacheDb.js';
import { resetApiClientStateForTests } from '../src/api/httpClient.js';
import { CODICE_RELEASE, RELEASE_HISTORY } from '../src/config/versioning.js';
import { findForbiddenEmojisOrSymbols } from '../src/lib/emojiCheck.js';
import {
  fetchOmdbViaProxyOrDirect,
  fetchProxyStatus,
  fetchTmdbViaProxyOrDirect,
} from '../src/services/apiProxyClient.js';
import {
  API_STATUS_SOURCES,
  loadServerApiStatus,
  probeApiSource,
} from '../src/services/apiStatusService.js';
import {
  exportSignedBackupPayload,
  exportSignedCcodexPayload,
  inspectBackupPayload,
} from '../src/services/backupEngine.js';
import {
  fetchOmdbByImdbId,
  searchCinemaMedia,
  testOmdbConnection,
  testTmdbConnection,
} from '../src/services/cinemaApi.js';
import { buildCodiceDatabase } from '../src/services/codiceDatabase.js';
import {
  mapCatalogRowToLocalWork,
  mapLocalWorkToCatalogRow,
  queuePendingCloudDelete,
  readPendingCloudDeletes,
  syncCatalogWithSupabase,
  toCloudWorkId,
} from '../src/services/omniSyncService.js';
import {
  clearRelationalMemoryForTests,
  getAllRelationalWorks,
  putRelationalWorks,
} from '../src/services/relationalDb.js';

const ROOT_DIR = process.cwd();

function readText(relPath) {
  return fs.readFileSync(path.resolve(ROOT_DIR, relPath), 'utf8');
}

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  };
}

function makeJsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  });
}

function createMockCloudflareCache() {
  const store = new Map();
  const operations = [];
  return {
    store,
    operations,
    async match(request) {
      const key = typeof request === 'string' ? request : request.url;
      operations.push({ op: 'match', key });
      const entry = store.get(key);
      return entry ? entry.clone() : undefined;
    },
    async put(request, response) {
      const key = typeof request === 'string' ? request : request.url;
      operations.push({
        op: 'put',
        key,
        cacheControl: response.headers.get('Cache-Control'),
      });
      store.set(key, response.clone());
    },
  };
}

function parseConnectSrcTokens(headersText) {
  const cspMatch = headersText.match(/Content-Security-Policy:\s*(.+)/i);
  assert.ok(cspMatch, 'Diretiva Content-Security-Policy ausente em public/_headers');
  const directives = cspMatch[1]
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean);
  const connectDirective = directives.find((d) => /^connect-src\b/i.test(d));
  assert.ok(connectDirective, 'Diretiva connect-src ausente no CSP');
  return connectDirective.split(/\s+/).slice(1);
}

function hostMatchesConnectSrc(host, connectTokens) {
  const lower = host.toLowerCase();
  for (const token of connectTokens) {
    if (!/^https:\/\//i.test(token)) continue;
    const tokenHost = token.replace(/^https:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
    if (tokenHost === lower) return true;
    if (tokenHost.startsWith('*.')) {
      const suffix = tokenHost.slice(1); // '.example.com'
      if (lower.endsWith(suffix) && lower.length > suffix.length) {
        return true;
      }
    }
  }
  return false;
}

const NON_FETCH_URL_LINE_RE =
  /\b(docsUrl|href=|placeholder=|coverUrl|backdropUrl|imageUrl|openAccessUrl|linkUrl|shareUrlBase|poster\s*=|library_600x900|Special:FilePath|\/embed\/|player\.vimeo\.com|local\.invalid|codice\.app|cinecodice\.app|omniprism\.app|seu-projeto\.supabase\.co|googleapis\.com\/auth\/)\b/i;

const NON_FETCH_IMAGE_HOSTS = new Set([
  'image.tmdb.org',
  'covers.openlibrary.org',
  'commons.wikimedia.org',
  'shared.fastly.steamstatic.com',
  'm.media-amazon.com',
  's4.anilist.co',
  'static.tvmaze.com',
]);

function extractFetchHttpsHostsFromSrc(srcRootDir) {
  const hosts = new Map();

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.(js|jsx|mjs)$/.test(entry.name)) {
        const content = fs.readFileSync(full, 'utf8');
        // Somente arquivos que realizam chamadas HTTP ou declaram URLs de API/capa buscadas
        const doesNetworkCall =
          /\b(fetch|fetchImpl|fetchFn|fetchWithTimeout|apiRequest|apiRequestJson|fetchJson|probeWithTimeout|ANILIST_GRAPHQL_URL)\b/.test(
            content
          );
        if (!doesNetworkCall) continue;

        const rel = path.relative(ROOT_DIR, full).replace(/\\/g, '/');
        const lines = content.split('\n');
        lines.forEach((line, idx) => {
          if (NON_FETCH_URL_LINE_RE.test(line) && !line.includes('coverartarchive.org')) {
            return;
          }
          const matches = line.matchAll(/https:\/\/([a-zA-Z0-9.-]+)/g);
          for (const m of matches) {
            const host = m[1].toLowerCase();
            if (!host.includes('.') || host === '...') continue;
            if (NON_FETCH_IMAGE_HOSTS.has(host)) continue;
            if (!hosts.has(host)) hosts.set(host, []);
            hosts.get(host).push(`${rel}:${idx + 1}`);
          }
        });
      }
    }
  }

  walk(srcRootDir);
  return hosts;
}

describe('OmniPrism v2.3.3 — 1. CSP (public/_headers) e cobertura de hosts fetch em src/', () => {
  it('falha se qualquer host https chamado por fetch em src/ não estiver em connect-src e proíbe curingas amplos', () => {
    const headersText = readText('public/_headers');
    const connectTokens = parseConnectSrcTokens(headersText);

    // Sem curinga amplo em connect-src
    assert.equal(connectTokens.includes('*'), false, 'connect-src não pode conter curinga *');
    assert.equal(connectTokens.includes('https:'), false, 'connect-src não pode conter https:');
    assert.equal(connectTokens.includes('http:'), false, 'connect-src não pode conter http:');
    assert.equal(connectTokens.includes('https://*'), false, 'connect-src não pode conter https://*');

    // Outras diretivas de segurança intactas
    assert.match(headersText, /default-src 'self'/);
    assert.match(headersText, /object-src 'none'/);
    assert.match(headersText, /base-uri 'self'/);
    assert.match(headersText, /frame-ancestors 'self'/);

    // Varredura dinâmica de todos os hosts https chamados por fetch em src/
    const discoveredHosts = extractFetchHttpsHostsFromSrc(path.resolve(ROOT_DIR, 'src'));
    const missing = [];
    for (const [host, locations] of discoveredHosts.entries()) {
      if (!hostMatchesConnectSrc(host, connectTokens)) {
        missing.push(`${host} (${locations.slice(0, 2).join(', ')})`);
      }
    }

    assert.deepEqual(
      missing,
      [],
      `Hosts chamados por fetch em src/ ausentes no connect-src de public/_headers: ${missing.join('; ')}`
    );

    // Confirma os 7 hosts adicionados na v2.3.3
    const expectedAdded = [
      'itunes.apple.com',
      'musicbrainz.org',
      'openlibrary.org',
      'www.googleapis.com',
      'www.cheapshark.com',
      'www.freetogame.com',
      'coverartarchive.org',
    ];
    for (const host of expectedAdded) {
      assert.equal(
        hostMatchesConnectSrc(host, connectTokens),
        true,
        `Host esperado ausente no connect-src: ${host}`
      );
    }

    // Valida que o detector rejeita um host não listado
    assert.equal(
      hostMatchesConnectSrc('unlisted-api.example.org', connectTokens),
      false
    );
  });
});

describe('OmniPrism v2.3.3 — 2. Proxy Cloudflare Pages Functions (functions/api/)', () => {
  const baseEnv = {
    SUPABASE_URL: 'https://demo-proj.supabase.co',
    SUPABASE_ANON_KEY: 'anon-public-demo-key-1234',
    TMDB_API_KEY: 'tmdb-server-secret-9988',
    OMDB_API_KEY: 'omdb-server-secret-7766',
  };

  it('exige Bearer token do Supabase válido em /api/status, /api/tmdb/* e /api/omdb (401 sem token ou inválido)', async () => {
    const authCalls = [];
    const fetchMock = async (url, opts) => {
      authCalls.push({ url: String(url), headers: opts?.headers || {} });
      if (String(url).includes('/auth/v1/user')) {
        const auth = opts?.headers?.Authorization || '';
        if (auth === 'Bearer valid-user-jwt') {
          return makeJsonResponse({ id: 'user-uuid-123', email: 'dono@omniprism.app' }, 200);
        }
        return makeJsonResponse({ error: 'invalid_jwt' }, 401);
      }
      return makeJsonResponse({ ok: true }, 200);
    };

    // Sem Authorization -> 401 em todas as rotas
    const r1 = await handleStatusRequest(
      { request: new Request('https://omniprism.pages.dev/api/status'), env: baseEnv },
      { fetchImpl: fetchMock }
    );
    assert.equal(r1.status, 401);

    const r2 = await handleTmdbProxyRequest(
      {
        request: new Request('https://omniprism.pages.dev/api/tmdb/search/movie?query=Matrix'),
        env: baseEnv,
        params: { path: ['search', 'movie'] },
      },
      { fetchImpl: fetchMock }
    );
    assert.equal(r2.status, 401);

    const r3 = await handleOmdbProxyRequest(
      { request: new Request('https://omniprism.pages.dev/api/omdb?i=tt0133093'), env: baseEnv },
      { fetchImpl: fetchMock }
    );
    assert.equal(r3.status, 401);

    // Token inválido -> chama SUPABASE_URL/auth/v1/user com apikey e devolve 401
    const rInvalid = await handleStatusRequest(
      {
        request: new Request('https://omniprism.pages.dev/api/status', {
          headers: { Authorization: 'Bearer expired-jwt' },
        }),
        env: baseEnv,
      },
      { fetchImpl: fetchMock }
    );
    assert.equal(rInvalid.status, 401);
    assert.equal(authCalls.length, 1);
    assert.equal(authCalls[0].url, 'https://demo-proj.supabase.co/auth/v1/user');
    assert.equal(authCalls[0].headers.apikey, baseEnv.SUPABASE_ANON_KEY);

    // Método não GET -> 405
    const rMethod = await handleStatusRequest(
      {
        request: new Request('https://omniprism.pages.dev/api/status', {
          method: 'POST',
          headers: { Authorization: 'Bearer valid-user-jwt' },
        }),
        env: baseEnv,
      },
      { fetchImpl: fetchMock }
    );
    assert.equal(rMethod.status, 405);
  });

  it('GET /api/status retorna apenas booleanos configurado por provedor sem vazar chaves', async () => {
    const fetchMock = async (url) => {
      if (String(url).includes('/auth/v1/user')) {
        return makeJsonResponse({ id: 'user-uuid-123' }, 200);
      }
      return makeJsonResponse({}, 404);
    };

    const resFull = await handleStatusRequest(
      {
        request: new Request('https://omniprism.pages.dev/api/status', {
          headers: { Authorization: 'Bearer valid-user-jwt' },
        }),
        env: baseEnv,
      },
      { fetchImpl: fetchMock }
    );
    assert.equal(resFull.status, 200);
    const bodyText = await resFull.text();
    assert.equal(bodyText.includes(baseEnv.TMDB_API_KEY), false);
    assert.equal(bodyText.includes(baseEnv.OMDB_API_KEY), false);
    assert.equal(bodyText.includes(baseEnv.SUPABASE_ANON_KEY), false);
    const json = JSON.parse(bodyText);
    assert.deepEqual(json, {
      ok: true,
      providers: {
        tmdb: { configured: true },
        omdb: { configured: true },
      },
    });

    const resPartial = await handleStatusRequest(
      {
        request: new Request('https://omniprism.pages.dev/api/status', {
          headers: { Authorization: 'Bearer valid-user-jwt' },
        }),
        env: { ...baseEnv, OMDB_API_KEY: '' },
      },
      { fetchImpl: fetchMock }
    );
    assert.deepEqual(await resPartial.json(), {
      ok: true,
      providers: {
        tmdb: { configured: true },
        omdb: { configured: false },
      },
    });
  });

  it('aplica allowlist estrita no TMDB, remove api_key/apikey do cliente, injeta chave do ambiente e cacheia em caches.default (10min busca / 24h detalhe)', async () => {
    const upstreamUrls = [];
    const mockCache = createMockCloudflareCache();

    const fetchMock = async (url) => {
      const str = String(url);
      if (str.includes('/auth/v1/user')) {
        return makeJsonResponse({ id: 'user-uuid-123' }, 200);
      }
      upstreamUrls.push(str);
      if (str.includes('api.themoviedb.org/3/search/movie')) {
        return makeJsonResponse({ results: [{ id: 603, title: 'Matrix' }] }, 200);
      }
      if (str.includes('api.themoviedb.org/3/movie/603')) {
        return makeJsonResponse({ id: 603, title: 'The Matrix' }, 200);
      }
      if (str.includes('www.omdbapi.com')) {
        return makeJsonResponse({ Response: 'True', Title: 'The Matrix', imdbRating: '8.7' }, 200);
      }
      return makeJsonResponse({ error: 'not found' }, 404);
    };

    // Rotas proibidas no TMDB -> 403
    for (const forbiddenPath of [
      ['configuration'],
      ['account', '1'],
      ['discover', 'movie'],
      ['search', 'person'],
      ['collection', '10'],
    ]) {
      const blocked = await handleTmdbProxyRequest(
        {
          request: new Request(
            `https://omniprism.pages.dev/api/tmdb/${forbiddenPath.join('/')}`,
            { headers: { Authorization: 'Bearer valid-user-jwt' } }
          ),
          env: baseEnv,
          params: { path: forbiddenPath },
        },
        { fetchImpl: fetchMock, cacheOverride: mockCache }
      );
      assert.equal(blocked.status, 403, `Esperava 403 para ${forbiddenPath.join('/')}`);
    }

    // Path traversal bloqueado -> 403
    const traversal = await handleTmdbProxyRequest(
      {
        request: new Request(
          'https://omniprism.pages.dev/api/tmdb/movie/..%2Fconfiguration',
          { headers: { Authorization: 'Bearer valid-user-jwt' } }
        ),
        env: baseEnv,
      },
      { fetchImpl: fetchMock, cacheOverride: mockCache }
    );
    assert.equal(traversal.status, 403);

    // 1) TMDB busca: remove api_key do cliente, injeta env.TMDB_API_KEY e cacheia 10 min (600s) sem chave na cache key
    const searchReq1 = new Request(
      'https://omniprism.pages.dev/api/tmdb/search/movie?api_key=CLIENT_EVIL&query=Matrix&language=pt-BR',
      { headers: { Authorization: 'Bearer valid-user-jwt' } }
    );
    const searchRes1 = await handleTmdbProxyRequest(
      { request: searchReq1, env: baseEnv, params: { path: ['search', 'movie'] } },
      { fetchImpl: fetchMock, cacheOverride: mockCache }
    );
    assert.equal(searchRes1.status, 200);
    assert.equal(searchRes1.headers.get('X-Proxy-Cache'), 'MISS');
    assert.equal(upstreamUrls.length, 1);
    assert.equal(upstreamUrls[0].includes('CLIENT_EVIL'), false);
    assert.equal(upstreamUrls[0].includes(`api_key=${baseEnv.TMDB_API_KEY}`), true);

    const searchPut = mockCache.operations.find((o) => o.op === 'put');
    assert.ok(searchPut);
    assert.equal(searchPut.cacheControl, 'public, max-age=600');
    assert.equal(searchPut.key.includes('api_key'), false);
    assert.equal(searchPut.key.includes(baseEnv.TMDB_API_KEY), false);

    // 2ª chamada de busca -> HIT no caches.default sem novo fetch upstream
    const searchRes2 = await handleTmdbProxyRequest(
      {
        request: new Request(
          'https://omniprism.pages.dev/api/tmdb/search/movie?language=pt-BR&query=Matrix',
          { headers: { Authorization: 'Bearer valid-user-jwt' } }
        ),
        env: baseEnv,
        params: { path: ['search', 'movie'] },
      },
      { fetchImpl: fetchMock, cacheOverride: mockCache }
    );
    assert.equal(searchRes2.status, 200);
    assert.equal(searchRes2.headers.get('X-Proxy-Cache'), 'HIT');
    assert.equal(upstreamUrls.length, 1);

    // 2) TMDB detalhe: cache de 24h (86400s)
    const detailRes = await handleTmdbProxyRequest(
      {
        request: new Request('https://omniprism.pages.dev/api/tmdb/movie/603?language=pt-BR', {
          headers: { Authorization: 'Bearer valid-user-jwt' },
        }),
        env: baseEnv,
        params: { path: ['movie', '603'] },
      },
      { fetchImpl: fetchMock, cacheOverride: mockCache }
    );
    assert.equal(detailRes.status, 200);
    const detailPut = mockCache.operations.filter((o) => o.op === 'put')[1];
    assert.equal(detailPut.cacheControl, 'public, max-age=86400');
    assert.equal(detailPut.key, 'https://api.themoviedb.org/3/movie/603?language=pt-BR');

    // 3) OMDb detalhe: remove apikey do cliente, injeta OMDB_API_KEY e cacheia 24h (86400s) sem apikey na chave
    const omdbRes1 = await handleOmdbProxyRequest(
      {
        request: new Request('https://omniprism.pages.dev/api/omdb?apikey=EVIL_KEY&i=tt0133093', {
          headers: { Authorization: 'Bearer valid-user-jwt' },
        }),
        env: baseEnv,
      },
      { fetchImpl: fetchMock, cacheOverride: mockCache }
    );
    assert.equal(omdbRes1.status, 200);
    assert.equal(omdbRes1.headers.get('X-Proxy-Cache'), 'MISS');
    const lastOmdbUpstream = upstreamUrls[upstreamUrls.length - 1];
    assert.equal(lastOmdbUpstream.includes('EVIL_KEY'), false);
    assert.equal(lastOmdbUpstream.includes(`apikey=${baseEnv.OMDB_API_KEY}`), true);

    const omdbPut = mockCache.operations.filter((o) => o.op === 'put')[2];
    assert.equal(omdbPut.cacheControl, 'public, max-age=86400');
    assert.equal(omdbPut.key, 'https://www.omdbapi.com/?i=tt0133093');
    assert.equal(omdbPut.key.includes('apikey'), false);

    // 2ª chamada OMDb -> HIT
    const omdbRes2 = await handleOmdbProxyRequest(
      {
        request: new Request('https://omniprism.pages.dev/api/omdb?i=tt0133093', {
          headers: { Authorization: 'Bearer valid-user-jwt' },
        }),
        env: baseEnv,
      },
      { fetchImpl: fetchMock, cacheOverride: mockCache }
    );
    assert.equal(omdbRes2.headers.get('X-Proxy-Cache'), 'HIT');

    // 4) OMDb busca (?s=): cache de 10 min (600s)
    const omdbSearch = await handleOmdbProxyRequest(
      {
        request: new Request('https://omniprism.pages.dev/api/omdb?s=Matrix', {
          headers: { Authorization: 'Bearer valid-user-jwt' },
        }),
        env: baseEnv,
      },
      { fetchImpl: fetchMock, cacheOverride: mockCache }
    );
    assert.equal(omdbSearch.status, 200);
    const omdbSearchPut = mockCache.operations.filter((o) => o.op === 'put')[3];
    assert.equal(omdbSearchPut.cacheControl, 'public, max-age=600');

    // 5) Confirma public/_routes.json protegendo /api/*
    const routesJson = JSON.parse(readText('public/_routes.json'));
    assert.equal(routesJson.version, 1);
    assert.ok(Array.isArray(routesJson.include) && routesJson.include.includes('/api/*'));
  });
});

describe('OmniPrism v2.3.3 — 3. App: proxy com sessão, fallback local/dev e painel Status das APIs', () => {
  it('usa /api/tmdb/* e /api/omdb com Bearer token quando há sessão Supabase, e faz fallback para chave local em 401/404/5xx ou modo dev', async () => {
    resetApiClientStateForTests();
    clearMemoryApiCacheForTests();

    const calls = [];
    const proxyOkFetch = async (url, opts) => {
      calls.push({ url: String(url), auth: opts?.headers?.Authorization || '' });
      if (String(url).startsWith('/api/tmdb/search/movie')) {
        return makeJsonResponse({
          results: [{ id: 603, title: 'Matrix', release_date: '1999-03-31', vote_average: 8.2, vote_count: 25000 }],
        });
      }
      if (String(url).startsWith('/api/omdb?i=tt0133093')) {
        return makeJsonResponse({
          Response: 'True',
          imdbRating: '8.7',
          imdbVotes: '2,000,000',
          Ratings: [{ Source: 'Rotten Tomatoes', Value: '83%' }],
        });
      }
      return makeJsonResponse({}, 404);
    };

    const searchRes = await searchCinemaMedia('Matrix', {
      filter: 'movie',
      sources: ['tmdb'],
      tmdbApiKey: '',
      skipCache: true,
      accessToken: 'sb-user-token-xyz',
      isDev: false,
      fetchImpl: proxyOkFetch,
    });
    assert.equal(searchRes.results.length, 1);
    assert.equal(searchRes.results[0].title, 'Matrix');
    assert.equal(calls[0].url.startsWith('/api/tmdb/search/movie'), true);
    assert.equal(calls[0].url.includes('api_key'), false);
    assert.equal(calls[0].auth, 'Bearer sb-user-token-xyz');

    const omdbRes = await fetchOmdbByImdbId('tt0133093', {
      apiKey: '',
      accessToken: 'sb-user-token-xyz',
      isDev: false,
      fetchImpl: proxyOkFetch,
    });
    assert.equal(omdbRes.ok, true);
    assert.equal(omdbRes.ratings.imdb.value, 8.7);
    assert.equal(omdbRes.ratings.imdb.scale, 10);
    assert.equal(calls[1].url, '/api/omdb?i=tt0133093');
    assert.equal(calls[1].auth, 'Bearer sb-user-token-xyz');

    // Fallback automático quando proxy falha com 503/404/401 -> usa chave local
    for (const failStatus of [401, 404, 503]) {
      const fbCalls = [];
      const fallbackFetch = async (url) => {
        const s = String(url);
        fbCalls.push(s);
        if (s.startsWith('/api/tmdb/')) {
          return makeJsonResponse({ error: 'proxy unavailable' }, failStatus);
        }
        if (s.startsWith('https://api.themoviedb.org/3/movie/603')) {
          return makeJsonResponse({ id: 603, title: 'The Matrix' }, 200);
        }
        return makeJsonResponse({}, 500);
      };

      const out = await fetchTmdbViaProxyOrDirect(
        'movie/603',
        { language: 'pt-BR' },
        {
          directApiKey: 'local-tmdb-key-1234',
          accessToken: 'sb-user-token-xyz',
          isDev: false,
          dedup: false,
          fetchImpl: fallbackFetch,
        }
      );
      assert.equal(out.ok, true);
      assert.equal(out.via, 'direct');
      assert.equal(out.proxyAttempted, true);
      assert.equal(out.proxyStatus, failStatus);
      assert.equal(fbCalls.length, 2);
      assert.equal(fbCalls[0].startsWith('/api/tmdb/movie/603'), true);
      assert.equal(fbCalls[1].includes('api_key=local-tmdb-key-1234'), true);
    }

    // Sem chave local e proxy 404 -> nunca quebra (retorna missingKey: true)
    const noKeyOut = await fetchOmdbViaProxyOrDirect(
      { i: 'tt0133093' },
      {
        directApiKey: '',
        accessToken: 'sb-user-token-xyz',
        isDev: false,
        dedup: false,
        fetchImpl: async () => makeJsonResponse({ error: 'not found' }, 404),
      }
    );
    assert.equal(noKeyOut.ok, false);
    assert.equal(noKeyOut.missingKey, true);

    // Em DEV (isDev: true) -> pula proxy e usa chamada direta como hoje
    const devCalls = [];
    const devOut = await fetchTmdbViaProxyOrDirect(
      'movie/603',
      { language: 'pt-BR' },
      {
        directApiKey: 'dev-local-key',
        accessToken: 'sb-user-token-xyz',
        isDev: true,
        dedup: false,
        fetchImpl: async (url) => {
          devCalls.push(String(url));
          return makeJsonResponse({ id: 603 }, 200);
        },
      }
    );
    assert.equal(devOut.ok, true);
    assert.equal(devOut.via, 'direct');
    assert.equal(devOut.proxyAttempted, false);
    assert.equal(devCalls.length, 1);
    assert.equal(devCalls[0].startsWith('https://api.themoviedb.org/3/movie/603'), true);

    // testTmdbConnection e testOmdbConnection via proxy sem chave local
    const tmdbTest = await testTmdbConnection('', {
      accessToken: 'sb-user-token-xyz',
      isDev: false,
      fetchImpl: async (url) => {
        assert.ok(String(url).startsWith('/api/tmdb/movie/603'));
        return makeJsonResponse({ id: 603 }, 200);
      },
    });
    assert.equal(tmdbTest.ok, true);
    assert.equal(tmdbTest.via, 'proxy');

    const omdbTest = await testOmdbConnection('', {
      accessToken: 'sb-user-token-xyz',
      isDev: false,
      fetchImpl: async (url) => {
        assert.equal(String(url), '/api/omdb?i=tt0133093');
        return makeJsonResponse({ Response: 'True', Title: 'The Matrix' }, 200);
      },
    });
    assert.equal(omdbTest.ok, true);
    assert.equal(omdbTest.via, 'proxy');
  });

  it('Status das APIs consulta /api/status, testa fontes com latência, nunca exibe chaves e não contém emojis', async () => {
    const secretKey = 'super-secret-omdb-key-9999';
    const statusRes = await loadServerApiStatus({
      accessToken: 'sb-jwt',
      isDev: false,
      fetchImpl: async (url) => {
        assert.equal(String(url), '/api/status');
        return makeJsonResponse({
          ok: true,
          providers: {
            tmdb: { configured: true },
            omdb: { configured: false },
          },
        });
      },
    });
    assert.equal(statusRes.ok, true);
    assert.equal(statusRes.providers.tmdb.configured, true);
    assert.equal(statusRes.providers.omdb.configured, false);

    // Fallback se /api/status retornar HTML do catch-all
    const htmlStatus = await fetchProxyStatus({
      accessToken: 'sb-jwt',
      isDev: false,
      fetchImpl: async () =>
        new Response('<!doctype html><html></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }),
    });
    assert.equal(htmlStatus.ok, false);
    assert.equal(htmlStatus.reachable, false);

    // Sonda fonte aberta e fonte OMDb garantindo mascaramento de segredos
    const olProbe = await probeApiSource('openlibrary', {
      fetchImpl: async () => makeJsonResponse({ docs: [{ key: '/works/1' }] }, 200),
    });
    assert.equal(olProbe.ok, true);
    assert.equal(olProbe.state, 'online');
    assert.equal(typeof olProbe.latencyMs, 'number');

    const omdbErrProbe = await probeApiSource('omdb', {
      omdbApiKey: secretKey,
      isDev: true,
      fetchImpl: async () =>
        makeJsonResponse({ Response: 'False', Error: `Invalid key ${secretKey}` }, 200),
    });
    assert.equal(omdbErrProbe.ok, false);
    assert.equal(JSON.stringify(omdbErrProbe).includes(secretKey), false);

    // Painel React montado em Configurações sem emojis e com "Configurado no servidor"
    const panelSrc = readText('src/components/ApiStatusPanel.jsx');
    const drawerSrc = readText('src/components/ProfileSettingsDrawer.jsx');
    assert.deepEqual(findForbiddenEmojisOrSymbols(panelSrc), []);
    assert.match(panelSrc, /Status das APIs/);
    assert.match(panelSrc, /Configurado no servidor:/);
    assert.match(panelSrc, /Testar/);
    assert.match(drawerSrc, /<ApiStatusPanel/);
    assert.ok(API_STATUS_SOURCES.length >= 14);
  });
});

describe('OmniPrism v2.3.3 — 4. Segurança dos dados (sync não destrutivo e backup/restauração dos 4 domínios)', () => {
  const sampleFourDomains = [
    {
      id: 'w-cinema-1',
      domain: 'cinema',
      workType: 'series',
      title: 'Dark',
      creator: 'Baran bo Odar',
      status: 'watching',
      rating: 95,
      ratingSource: 'manual',
      totalSeasons: 3,
      totalEpisodes: 26,
      episodesPerSeason: [10, 8, 8],
      currentSeason: 2,
      currentEpisode: 5,
      watchedEpisodes: { '1:1': 'watched', '2:5': 'watched' },
      fillerEpisodes: ['1:4'],
      storyArcs: [{ id: 'arc-1', name: 'Ciclo 1', season: 1, startEp: 1, endEp: 10 }],
      currentSeconds: 1800,
      updatedAt: '2026-11-20T10:00:00.000Z',
    },
    {
      id: 'w-reading-1',
      domain: 'reading',
      workType: 'book',
      title: 'Duna',
      creator: 'Frank Herbert',
      status: 'watching',
      rating: 92,
      ratingSource: 'manual',
      pagesRead: 310,
      totalPages: 680,
      chaptersRead: 14,
      isbnOrDoi: '9788576573135',
      bookFormat: 'Físico',
      updatedAt: '2026-11-20T11:00:00.000Z',
    },
    {
      id: 'w-games-1',
      domain: 'games',
      workType: 'game',
      title: 'Shadow of the Colossus',
      creator: 'Team Ico',
      status: 'completed',
      rating: 99,
      ratingSource: 'manual',
      platform: 'PlayStation 4',
      platforms: ['PlayStation 4', 'PlayStation 2'],
      editionType: 'Remake',
      gameRating11: 11,
      masterpieceJustification: 'Direção de arte atemporal e minimalismo narrativo.',
      hoursPlayed: 24.5,
      completionType: 'História + Extras',
      storeOrLauncher: 'PlayStation Store',
      buildOrCharacter: 'Wander',
      updatedAt: '2026-11-20T12:00:00.000Z',
    },
    {
      id: 'w-music-1',
      domain: 'music',
      workType: 'album',
      title: 'Master of Puppets',
      creator: 'Metallica',
      albumName: 'Master of Puppets',
      status: 'completed',
      rating: 98,
      ratingSource: 'manual',
      listenCount: 19,
      favoriteTrack: 'Orion',
      subgenre: 'Thrash Metal',
      releaseFormat: 'Álbum de Estúdio',
      trackCount: 3,
      tracks: [
        { number: 1, title: 'Battery', durationMs: 312000 },
        { number: 2, title: 'Master of Puppets', durationMs: 515000 },
        { number: 3, title: 'Orion', durationMs: 507000 },
      ],
      trackRatings: {
        '1': 9.5,
        '2': 10,
        '3': 10,
      },
      updatedAt: '2026-11-20T13:00:00.000Z',
    },
  ];

  function createMockSupabaseClient({
    remoteRows = [],
    selectError = null,
    throwOnSelect = false,
    upsertError = null,
  } = {}) {
    const upsertedRows = [];
    const deletedCloudIds = [];

    return {
      upsertedRows,
      deletedCloudIds,
      auth: {
        async getSession() {
          return {
            data: { session: { user: { id: 'user-safe-1' }, access_token: 'jwt-safe' } },
            error: null,
          };
        },
      },
      from() {
        return {
          select() {
            const chain = {
              eq() {
                return chain;
              },
              then(resolve, reject) {
                if (throwOnSelect) {
                  return Promise.reject(new Error('Failed to fetch')).then(resolve, reject);
                }
                return Promise.resolve({
                  data: selectError ? null : remoteRows,
                  error: selectError,
                }).then(resolve, reject);
              },
            };
            return chain;
          },
          upsert(rows) {
            if (upsertError) {
              return Promise.resolve({ error: upsertError });
            }
            upsertedRows.push(...rows);
            return Promise.resolve({ error: null });
          },
          delete() {
            const chain = {
              eq() {
                return chain;
              },
              in(_col, ids) {
                deletedCloudIds.push(...ids);
                return Promise.resolve({ error: null });
              },
            };
            return chain;
          },
        };
      },
    };
  }

  it('sincronizar com nuvem vazia ou com erro de rede NUNCA apaga obras locais; exclusões só ocorrem na fila explícita', async () => {
    clearRelationalMemoryForTests();
    const storage = createMemoryStorage();
    await putRelationalWorks(sampleFourDomains, { replace: true });

    // Cenário 1: Nuvem vazia ([]) -> preserva todas as 4 obras locais e faz push delas
    const emptyCloudClient = createMockSupabaseClient({ remoteRows: [] });
    const emptyRes = await syncCatalogWithSupabase({
      client: emptyCloudClient,
      storage,
    });
    assert.equal(emptyRes.ok, true);
    assert.equal(emptyRes.works.length, 4);
    assert.equal(emptyRes.pushedCount, 4);
    assert.equal(emptyCloudClient.deletedCloudIds.length, 0);
    const afterEmptyLocal = await getAllRelationalWorks();
    assert.equal(afterEmptyLocal.length, 4);

    // Cenário 2: Erro retornado pelo Supabase no select -> NUNCA apaga obras locais
    const errorCloudClient = createMockSupabaseClient({
      selectError: { message: 'network timeout' },
    });
    const errRes = await syncCatalogWithSupabase({
      client: errorCloudClient,
      storage,
    });
    assert.equal(errRes.ok, false);
    assert.equal((await getAllRelationalWorks()).length, 4);

    // Cenário 3: Exceção de rede lançada no select -> NUNCA apaga obras locais
    const throwCloudClient = createMockSupabaseClient({ throwOnSelect: true });
    const throwRes = await syncCatalogWithSupabase({
      client: throwCloudClient,
      storage,
    });
    assert.equal(throwRes.ok, false);
    assert.equal((await getAllRelationalWorks()).length, 4);

    // Cenário 4: Exclusão ocorre SOMENTE para o ID explicitamente enfileirado
    queuePendingCloudDelete('w-reading-1', storage);
    assert.equal(readPendingCloudDeletes(storage).length, 1);

    const cloudWithAllFour = sampleFourDomains.map((w) =>
      mapLocalWorkToCatalogRow(w, 'user-safe-1')
    );
    const deleteClient = createMockSupabaseClient({ remoteRows: cloudWithAllFour });
    const delRes = await syncCatalogWithSupabase({
      client: deleteClient,
      storage,
    });
    assert.equal(delRes.ok, true);
    assert.equal(delRes.deletedCount, 1);
    assert.deepEqual(deleteClient.deletedCloudIds, [toCloudWorkId('w-reading-1')]);

    const remainingIds = (await getAllRelationalWorks()).map((w) => w.id).sort();
    assert.deepEqual(remainingIds, ['w-cinema-1', 'w-games-1', 'w-music-1']);
  });

  it('exportar backup (.json e .ccodex) e restaurar numa base vazia devolve as mesmas obras dos 4 domínios, incluindo progress_data e track_ratings', async () => {
    clearRelationalMemoryForTests();
    await putRelationalWorks(sampleFourDomains, { replace: true });

    const originalWorks = await getAllRelationalWorks();
    assert.equal(originalWorks.length, 4);

    const db = buildCodiceDatabase({
      items: originalWorks,
      profile: { displayName: 'Tester Segurança' },
    });

    const signedJson = await exportSignedBackupPayload(db);
    const ccodexEnvelope = await exportSignedCcodexPayload(db);

    for (const rawBackup of [JSON.stringify(signedJson), JSON.stringify(ccodexEnvelope)]) {
      // Simula restauração em base completamente vazia
      clearRelationalMemoryForTests();
      assert.equal((await getAllRelationalWorks()).length, 0);

      const inspected = await inspectBackupPayload(rawBackup);
      assert.equal(inspected.ok, true);
      assert.equal(inspected.checksumStatus, 'valid');
      assert.equal(inspected.snapshot.items.length, 4);

      await putRelationalWorks(inspected.snapshot.items, { replace: true });
      const restored = await getAllRelationalWorks();
      assert.equal(restored.length, 4);

      const byId = new Map(restored.map((w) => [w.id, w]));
      assert.deepEqual(
        Array.from(new Set(restored.map((w) => w.domain))).sort(),
        ['cinema', 'games', 'music', 'reading']
      );

      // Cinema: progress_data de episódios e minutagem preservados
      const cinema = byId.get('w-cinema-1');
      assert.equal(cinema.currentSeason, 2);
      assert.equal(cinema.currentEpisode, 5);
      assert.equal(cinema.currentSeconds, 1800);
      assert.deepEqual(cinema.watchedEpisodes, { '1:1': 'watched', '2:5': 'watched' });
      assert.deepEqual(cinema.episodesPerSeason, [10, 8, 8]);

      // Leitura: páginas e capítulos preservados
      const reading = byId.get('w-reading-1');
      assert.equal(reading.pagesRead, 310);
      assert.equal(reading.totalPages, 680);
      assert.equal(reading.chaptersRead, 14);
      assert.equal(reading.isbnOrDoi, '9788576573135');

      // Games: horas, plataformas, remake e nota 0-11 preservados
      const game = byId.get('w-games-1');
      assert.equal(game.hoursPlayed, 24.5);
      assert.deepEqual(game.platforms, ['PlayStation 4', 'PlayStation 2']);
      assert.equal(game.editionType, 'Remake');
      assert.equal(game.gameRating11, 11);

      // Música: listenCount, faixas e trackRatings preservados
      const music = byId.get('w-music-1');
      assert.equal(music.listenCount, 19);
      assert.equal(music.tracks.length, 3);
      assert.deepEqual(music.trackRatings, { '1': 9.5, '2': 10, '3': 10 });

      // Round-trip de serialização cloud (progress_data + progress_data.track_ratings)
      const musicCloudRow = mapLocalWorkToCatalogRow(music, 'user-safe-1');
      assert.equal(musicCloudRow.progress_data.listen_count, 19);
      assert.deepEqual(musicCloudRow.progress_data.track_ratings, {
        '1': 9.5,
        '2': 10,
        '3': 10,
      });
      const musicBack = mapCatalogRowToLocalWork(musicCloudRow);
      assert.deepEqual(musicBack.trackRatings, { '1': 9.5, '2': 10, '3': 10 });
      assert.equal(musicBack.listenCount, 19);
    }
  });
});

describe('OmniPrism v2.3.3 — 5. Versão oficial', () => {
  it('atualiza package.json, src/config/versioning.js (sem Lumière) e CHANGELOG.md para 2.3.3', () => {
    const pkg = JSON.parse(readText('package.json'));
    assert.equal(pkg.name, 'omniprism');
    assert.equal(pkg.version, '2.3.3');

    assert.equal(CODICE_RELEASE.version, '2.3.3');
    assert.equal(CODICE_RELEASE.label, 'v2.3.3');
    assert.equal(CODICE_RELEASE.label.includes('Lumière'), false);
    assert.equal(CODICE_RELEASE.codename, '');
    assert.equal(RELEASE_HISTORY[0].version, '2.3.3');
    assert.equal(RELEASE_HISTORY[0].label, 'v2.3.3');

    const changelog = readText('CHANGELOG.md');
    assert.match(changelog, /## \[v2\.3\.3\]/);
  });
});
