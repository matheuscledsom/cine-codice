import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { handleRawgProxyRequest } from '../functions/api/rawg/[[path]].js';
import { handleStatusRequest } from '../functions/api/status.js';
import { clearMemoryApiCacheForTests } from '../src/api/cacheDb.js';
import {
  RAWG_CAMPAIGN_TIME_SOURCE_LABEL,
  extractGameFranchiseHintFromTitle,
  formatGameCampaignTime,
  formatGameCompletion100Time,
  parseRawgGameMetadata,
  suggestGameFranchiseLink,
} from '../src/lib/gameDepth.js';
import { probeApiSource } from '../src/services/apiStatusService.js';
import { fetchRawgGameDepth } from '../src/services/gameDepthService.js';
import {
  mapCatalogRowToLocalWork,
  mapLocalWorkToCatalogRow,
} from '../src/services/omniSyncService.js';

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

describe('OMNIPRISM v2.5.0 Fase C — 1. Proxy RAWG, CSP, segredo server-only e Status Nao configurado', () => {
  const baseEnv = {
    SUPABASE_URL: 'https://demo.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key-demo',
    TMDB_API_KEY: 'tmdb-secret',
    OMDB_API_KEY: 'omdb-secret',
    LASTFM_API_KEY: 'lastfm-secret',
    RAWG_API_KEY: 'rawg-server-secret-777',
  };

  it('atualiza connect-src em public/_headers com api.rawg.io e proibe VITE_RAWG_API_KEY', () => {
    const headers = readText('public/_headers');
    assert.match(headers, /connect-src[^;\n]*https:\/\/api\.rawg\.io/);

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
        /VITE_RAWG_API_KEY/.test(text),
        false,
        `VITE_RAWG_API_KEY proibido encontrado em ${f}`
      );
    }
  });

  it('permite SOMENTE GET autenticado em rawg/games e rawg/games/{id}, remove chave do cliente e degrada sem chave', async () => {
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
      if (str.includes('api.rawg.io/api/games/3328?')) {
        return makeJsonResponse({
          id: 3328,
          slug: 'the-witcher-3-wild-hunt',
          name: 'The Witcher 3: Wild Hunt',
          playtime: 43,
          metacritic: 92,
        });
      }
      if (str.includes('api.rawg.io/api/games?')) {
        return makeJsonResponse({
          results: [{ id: 3328, name: 'The Witcher 3: Wild Hunt', playtime: 43 }],
        });
      }
      return makeJsonResponse({}, 404);
    };

    // POST -> 405
    const postRes = await handleRawgProxyRequest(
      {
        request: new Request('https://app.pages.dev/api/rawg/games?search=witcher', {
          method: 'POST',
          headers: { Authorization: 'Bearer jwt-ok' },
        }),
        env: baseEnv,
        params: { path: ['games'] },
      },
      { fetchImpl: fetchMock, cacheOverride: cache }
    );
    assert.equal(postRes.status, 405);

    // Sem Bearer -> 401
    const noAuth = await handleRawgProxyRequest(
      {
        request: new Request('https://app.pages.dev/api/rawg/games/3328'),
        env: baseEnv,
        params: { path: ['games', '3328'] },
      },
      { fetchImpl: fetchMock, cacheOverride: cache }
    );
    assert.equal(noAuth.status, 401);

    // Rotas proibidas no RAWG -> 403
    for (const badPath of [
      ['stores'],
      ['developers'],
      ['games', '3328', 'screenshots'],
      ['creators', '1'],
    ]) {
      const blocked = await handleRawgProxyRequest(
        {
          request: new Request(`https://app.pages.dev/api/rawg/${badPath.join('/')}`, {
            headers: { Authorization: 'Bearer jwt-ok' },
          }),
          env: baseEnv,
          params: { path: badPath },
        },
        { fetchImpl: fetchMock, cacheOverride: cache }
      );
      assert.equal(blocked.status, 403, `Esperava 403 para rawg/${badPath.join('/')}`);
    }

    // Sem RAWG_API_KEY no servidor -> 503 + /api/status configured: false + Status "Nao configurado"
    const envNoRawg = { ...baseEnv, RAWG_API_KEY: '' };
    const noKeyRes = await handleRawgProxyRequest(
      {
        request: new Request('https://app.pages.dev/api/rawg/games/3328', {
          headers: { Authorization: 'Bearer jwt-ok' },
        }),
        env: envNoRawg,
        params: { path: ['games', '3328'] },
      },
      { fetchImpl: fetchMock, cacheOverride: cache }
    );
    assert.equal(noKeyRes.status, 503);

    const statusRes = await handleStatusRequest(
      {
        request: new Request('https://app.pages.dev/api/status', {
          headers: { Authorization: 'Bearer jwt-ok' },
        }),
        env: envNoRawg,
      },
      { fetchImpl: fetchMock }
    );
    const statusJson = await statusRes.json();
    assert.equal(statusJson.providers.rawg.configured, false);

    // Cliente degrada sem quebrar quando RAWG retorna 503
    clearMemoryApiCacheForTests();
    const degraded = await fetchRawgGameDepth(
      { id: 'g1', title: 'The Witcher 3: Wild Hunt' },
      {
        accessToken: 'jwt-ok',
        forceProxy: true,
        isDev: false,
        fetchImpl: async () => makeJsonResponse({ error: 'Não configurado', configured: false }, 503),
      }
    );
    assert.equal(degraded.ok, false);
    assert.equal(degraded.notConfigured, true);
    assert.equal(degraded.data, null);

    const probeNotCfg = await probeApiSource('rawg', {
      accessToken: 'jwt-ok',
      forceProxy: true,
      isDev: false,
      fetchImpl: async () => makeJsonResponse({ error: 'Não configurado', configured: false }, 503),
    });
    assert.equal(probeNotCfg.state, 'not_configured');

    // Rotas permitidas removem key/api_key do cliente, injetam RAWG_API_KEY do servidor e cacheiam (600s / 86400s)
    const searchRes = await handleRawgProxyRequest(
      {
        request: new Request(
          'https://app.pages.dev/api/rawg/games?search=witcher&key=CLIENT_EVIL&page_size=5',
          { headers: { Authorization: 'Bearer jwt-ok' } }
        ),
        env: baseEnv,
        params: { path: ['games'] },
      },
      { fetchImpl: fetchMock, cacheOverride: cache }
    );
    assert.equal(searchRes.status, 200);

    const detailRes = await handleRawgProxyRequest(
      {
        request: new Request(
          'https://app.pages.dev/api/rawg/games/3328?api_key=CLIENT_EVIL2',
          { headers: { Authorization: 'Bearer jwt-ok' } }
        ),
        env: baseEnv,
        params: { path: ['games', '3328'] },
      },
      { fetchImpl: fetchMock, cacheOverride: cache }
    );
    assert.equal(detailRes.status, 200);

    assert.equal(upstreamUrls.length, 2);
    for (const u of upstreamUrls) {
      assert.equal(u.includes('CLIENT_EVIL'), false);
      assert.equal(u.includes(`key=${baseEnv.RAWG_API_KEY}`), true);
    }

    const puts = cache.operations.filter((o) => o.op === 'put');
    assert.equal(puts.length, 2);
    assert.equal(puts[0].cacheControl, 'public, max-age=600');
    assert.equal(puts[1].cacheControl, 'public, max-age=86400');
    assert.equal(puts[0].key.includes(baseEnv.RAWG_API_KEY), false);
    assert.equal(puts[1].key.includes(baseEnv.RAWG_API_KEY), false);
  });
});

describe('OMNIPRISM v2.5.0 Fase C — 2. Games: Mais detalhes, fonte RAWG explicita, Tempo 100% editavel e sugestao manual de franquia', () => {
  it('rotula tempo medio do RAWG como media dos usuarios do RAWG (nunca HowLongToBeat) e nunca inventa Tempo 100%', () => {
    const parsed = parseRawgGameMetadata({
      id: 3328,
      slug: 'the-witcher-3-wild-hunt',
      name: 'The Witcher 3: Wild Hunt',
      playtime: 43,
      metacritic: 92,
      platforms: [{ platform: { name: 'PC' } }, { platform: { name: 'PlayStation 5' } }],
    });

    assert.equal(parsed.rawgPlaytimeHours, 43);
    assert.equal(parsed.rawgPlaytimeSource, RAWG_CAMPAIGN_TIME_SOURCE_LABEL);
    assert.equal(/howlongtobeat/i.test(parsed.rawgPlaytimeSource), false);
    assert.equal(parsed.completion100Hours, null);
    assert.equal(parsed.completion100Source, null);

    const campaignDisplay = formatGameCampaignTime({
      rawgPlaytimeHours: parsed.rawgPlaytimeHours,
      rawgPlaytimeSource: parsed.rawgPlaytimeSource,
    });
    assert.equal(campaignDisplay.label, '43 h');
    assert.equal(campaignDisplay.sourceLabel, 'RAWG (média dos usuários do RAWG)');

    // Tempo 100% sem fonte -> editavel manualmente, sem valor inventado
    const compEmpty = formatGameCompletion100Time({ rawgPlaytimeHours: 43 });
    assert.equal(compEmpty.hours, null);
    assert.equal(compEmpty.hasExternalSource, false);
    assert.equal(compEmpty.editable, true);

    // Tempo 100% editado manualmente pelo usuario
    const compManual = formatGameCompletion100Time({
      completion100Hours: 140,
      completion100Source: 'manual',
    });
    assert.equal(compManual.label, '140 h');
    assert.equal(compManual.hasExternalSource, false);
    assert.match(compManual.sourceLabel, /manualmente/i);

    // Tempo 100% quando houver fonte externa explicita
    const compSourced = formatGameCompletion100Time({
      completion100Hours: 173,
      completion100Source: 'Fonte externa verificada',
    });
    assert.equal(compSourced.hasExternalSource, true);
    assert.equal(compSourced.sourceLabel, 'Fonte: Fonte externa verificada');

    // Round-trip sync Supabase preserva campos RAWG e Tempo 100%
    const row = mapLocalWorkToCatalogRow(
      {
        id: 'g-w3',
        domain: 'games',
        workType: 'game',
        title: 'The Witcher 3: Wild Hunt',
        status: 'playing',
        rawgId: 3328,
        rawgPlaytimeHours: 43,
        rawgPlaytimeSource: RAWG_CAMPAIGN_TIME_SOURCE_LABEL,
        completion100Hours: 140,
        completion100Source: 'manual',
      },
      'user-1'
    );
    const hydrated = mapCatalogRowToLocalWork(row);
    assert.equal(hydrated.rawgId, 3328);
    assert.equal(hydrated.rawgPlaytimeHours, 43);
    assert.equal(hydrated.rawgPlaytimeSource, RAWG_CAMPAIGN_TIME_SOURCE_LABEL);
    assert.equal(hydrated.completion100Hours, 140);
    assert.equal(hydrated.completion100Source, 'manual');
  });

  it('sugere vinculo manual de franquia sem auto-alterar e mantem campos novos SO em Mais detalhes (nunca no AddScreen)', () => {
    assert.equal(extractGameFranchiseHintFromTitle('The Witcher 3: Wild Hunt'), 'The Witcher');
    assert.equal(extractGameFranchiseHintFromTitle('Dark Souls III'), 'Dark Souls');
    assert.equal(extractGameFranchiseHintFromTitle('Resident Evil 4 Remake'), 'Resident Evil');

    const w3 = {
      id: 'g3',
      domain: 'games',
      workType: 'game',
      title: 'The Witcher 3: Wild Hunt',
      status: 'playing',
    };
    const w2 = {
      id: 'g2',
      domain: 'games',
      workType: 'game',
      title: 'The Witcher 2: Assassins of Kings',
      franchiseName: 'The Witcher',
      status: 'completed',
    };
    const suggestion = suggestGameFranchiseLink(w3, [w3, w2]);
    assert.equal(suggestion.isSuggestionOnly, true);
    assert.equal(suggestion.suggestedFranchiseName, 'The Witcher');
    assert.equal(suggestion.relatedGames.length, 1);
    assert.equal(w3.franchiseName, undefined, 'Sugestao nunca deve mutar a obra automaticamente');

    // Campos novos ficam SO na ficha em "Mais detalhes", NUNCA na folha de catalogar (AddScreen.jsx)
    const addSrc = readText('src/screens/AddScreen.jsx');
    assert.equal(addSrc.includes('rawgPlaytimeHours'), false);
    assert.equal(addSrc.includes('completion100Hours'), false);
    assert.equal(addSrc.includes('Tempo médio de campanha'), false);
    assert.equal(addSrc.includes('Tempo 100%'), false);

    const detailSrc = readText('src/components/WorkDetailPage.jsx');
    assert.match(detailSrc, /\{moreDetailsOpen && \([\s\S]*games-more-details-depth/);
    assert.match(detailSrc, /\{moreDetailsOpen && \([\s\S]*Tempo médio de campanha/);
    assert.match(detailSrc, /\{moreDetailsOpen && \([\s\S]*Tempo 100%/);
    assert.match(detailSrc, /\{editMoreDetailsOpen && \([\s\S]*completion100Hours/);
  });
});
