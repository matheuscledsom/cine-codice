import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, it } from 'node:test';

import { handleBrasilApiIsbnRequest } from '../functions/api/isbn/[[path]].js';
import { clearMemoryApiCacheForTests } from '../src/api/cacheDb.js';
import { resetApiClientStateForTests } from '../src/api/httpClient.js';
import {
  computeEntityCompleteness,
  getManualEntityMeta,
  saveManualEntityMeta,
} from '../src/lib/entityHelpers.js';
import {
  cleanIsbn,
  looksLikeIsbnInput,
  normalizeBrasilApiIsbnResponse,
  parseAndValidateIsbn,
  validateIsbn10,
  validateIsbn13,
} from '../src/lib/isbn.js';
import {
  clearMemoryManualCoversForTests,
  compressManualCoverImage,
  getManualCoverFromIdb,
  isCompressedManualCoverDataUrl,
  MANUAL_COVER_MAX_BYTES,
  MANUAL_COVER_MAX_DIMENSION,
  saveManualCoverInIdb,
} from '../src/lib/manualCovers.js';
import {
  buildManualExternalIds,
  isManualWork,
  mergeManualWorkWithApiCandidate,
} from '../src/lib/manualWorkLink.js';
import { stripBase64MediaFromWorks } from '../src/services/backupCryptoService.js';
import {
  exportSignedBackupPayload,
  inspectBackupPayload,
} from '../src/services/backupEngine.js';
import {
  fetchBookByIsbn,
  searchReadingWorks,
} from '../src/services/multiDomainSearchService.js';
import {
  mapLocalWorkToCatalogRow,
  mergeWorksByUpdatedAt,
} from '../src/services/omniSyncService.js';
import {
  DEFAULT_DOMAIN_PROVIDERS,
  getCircuitBreakerState,
  getDomainProviders,
  moveProviderPriority,
  resetProviderRegistryForTests,
  setProviderEnabled,
} from '../src/services/providerRegistry.js';
import { findCatalogDuplicate } from '../src/utils/catalogDraftHelpers.js';

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

function makeJsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function createFakeIdbFactory() {
  const stores = new Map([
    ['thumbnails', new Map()],
    ['manual_covers', new Map()],
  ]);
  return {
    open() {
      const req = {};
      queueMicrotask(() => {
        const db = {
          objectStoreNames: {
            contains: (name) => stores.has(name),
          },
          createObjectStore: (name) => {
            if (!stores.has(name)) stores.set(name, new Map());
          },
          transaction: (storeName) => {
            const tx = { oncomplete: null, onerror: null };
            const storeMap = stores.get(storeName) || new Map();
            tx.objectStore = () => ({
              put: (record) => {
                storeMap.set(record.workId || record.cacheKey, record);
                queueMicrotask(() => tx.oncomplete?.());
              },
              get: (key) => {
                const getReq = {};
                queueMicrotask(() => {
                  getReq.result = storeMap.get(key) || null;
                  getReq.onsuccess?.();
                });
                return getReq;
              },
            });
            return tx;
          },
          close: () => {},
        };
        req.result = db;
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
}

describe('OMNIPRISM v2.6.0 — FASE 2: Livros Brasileiros + Busca ISBN + Cadastro Manual', () => {
  beforeEach(() => {
    clearMemoryApiCacheForTests();
    resetApiClientStateForTests();
    resetProviderRegistryForTests();
    clearMemoryManualCoversForTests();
  });

  it('1. Busca de Livros: Google Books (langRestrict=pt + Brasil) -> fallback Open Library + circuit breaker + status das APIs', async () => {
    assert.deepEqual(
      DEFAULT_DOMAIN_PROVIDERS.reading.map((p) => p.id),
      ['googleBooks', 'openlibrary']
    );

    const requestedUrls = [];
    const fetchMock = async (url) => {
      const urlStr = String(url);
      requestedUrls.push(urlStr);

      if (urlStr.includes('googleapis.com/books/v1/volumes')) {
        if (urlStr.includes('langRestrict=pt')) {
          return makeJsonResponse({
            items: [
              {
                id: 'gb-br-1',
                volumeInfo: {
                  title: 'Torto Arado',
                  authors: ['Itamar Vieira Junior'],
                  publishedDate: '2019-08-12',
                  pageCount: 264,
                  language: 'pt',
                  imageLinks: { thumbnail: 'http://books.google.com/books/content?id=gb-br-1' },
                  industryIdentifiers: [{ type: 'ISBN_13', identifier: '9788580445305' }],
                },
                accessInfo: { country: 'BR' },
              },
            ],
          });
        }
        return makeJsonResponse({ items: [] });
      }

      if (urlStr.includes('openlibrary.org/search.json')) {
        return makeJsonResponse({ docs: [] });
      }
      return makeJsonResponse({}, 404);
    };

    const storage = createMemoryStorage();
    const res = await searchReadingWorks('Torto Arado', {
      fetchImpl: fetchMock,
      skipCache: true,
      storage,
    });

    assert.equal(res.ok, true);
    assert.ok(requestedUrls.some((u) => u.includes('googleapis.com/books/v1/volumes') && u.includes('langRestrict=pt')));
    assert.ok(requestedUrls.some((u) => u.includes('printType=books')));
    assert.equal(res.results[0].title, 'Torto Arado');
    assert.equal(res.results[0].country, 'BR');
    assert.equal(res.results[0].isbnOrDoi, '9788580445305');

    // Simula falha/429 no Google Books 3 vezes -> fallback imediato para Open Library e abertura de circuit breaker
    let olCalled = 0;
    const gbFailingFetch = async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('googleapis.com/books/v1/volumes')) {
        return makeJsonResponse({ error: { message: 'Quota exceeded' } }, 429);
      }
      if (urlStr.includes('openlibrary.org/search.json')) {
        olCalled += 1;
        return makeJsonResponse({
          docs: [
            {
              key: '/works/OL123W',
              title: 'Memórias Póstumas de Brás Cubas',
              author_name: ['Machado de Assis'],
              first_publish_year: 1881,
              number_of_pages_median: 240,
              cover_i: 12345,
              language: ['por'],
            },
          ],
        });
      }
      return makeJsonResponse({}, 404);
    };

    const fallback1 = await searchReadingWorks('Brás Cubas', {
      fetchImpl: gbFailingFetch,
      skipCache: true,
      storage,
    });
    assert.equal(fallback1.ok, true);
    assert.ok(olCalled >= 1);
    assert.equal(fallback1.primarySourceId, 'openlibrary');
    assert.ok(fallback1.usedSources.includes('Open Library'));
    assert.equal(fallback1.results[0].creator, 'Machado de Assis');

    await searchReadingWorks('Dom Casmurro', { fetchImpl: gbFailingFetch, skipCache: true, storage });
    await searchReadingWorks('Quincas Borba', { fetchImpl: gbFailingFetch, skipCache: true, storage });
    const breaker = getCircuitBreakerState('googleBooks');
    assert.equal(breaker.isOpen, true);
    assert.ok(breaker.consecutiveFailures >= 3);

    // Respeita prioridade/reordenação e desativação no painel Status das APIs
    resetProviderRegistryForTests({ storage });
    moveProviderPriority('reading', 'openlibrary', 'up', { storage });
    assert.deepEqual(
      getDomainProviders('reading', { storage }).map((p) => p.id),
      ['openlibrary', 'googleBooks']
    );
    setProviderEnabled('googleBooks', false, { storage });
    const disabledList = getDomainProviders('reading', { storage });
    assert.equal(disabledList.find((p) => p.id === 'googleBooks')?.enabled, false);
  });

  it('2. Validação rigorosa de ISBN-10 (com dígito X) e ISBN-13 (com ou sem hífen)', () => {
    assert.equal(cleanIsbn('978-85-359-1484-9'), '9788535914849');
    assert.equal(looksLikeIsbnInput('978-85-359-1484-9'), true);
    assert.equal(looksLikeIsbnInput('Machado de Assis'), false);

    assert.equal(validateIsbn13('978-85-359-1484-9'), true);
    assert.equal(validateIsbn13('9788535914840'), false);

    assert.equal(validateIsbn10('0-8044-2957-X'), true);
    assert.equal(validateIsbn10('8535902775'), true);
    assert.equal(validateIsbn10('0804429571'), false);

    const parsedValid = parseAndValidateIsbn('978-85-359-1484-9');
    assert.equal(parsedValid.valid, true);
    assert.equal(parsedValid.format, 'ISBN-13');
    assert.equal(parsedValid.normalized, '9788535914849');

    const parsedInvalid = parseAndValidateIsbn('9788535914841');
    assert.equal(parsedInvalid.valid, false);
    assert.match(parsedInvalid.error, /dígito verificador/i);
  });

  it('3. Proxy BrasilAPI (/api/isbn) + fetchBookByIsbn: valida ISBN, usa cache, faz fallback e trata 404 com clareza', async () => {
    const invalidRes = await handleBrasilApiIsbnRequest({
      request: new Request('https://omniprism.pages.dev/api/isbn/1234567890', { method: 'GET' }),
      params: { path: ['1234567890'] },
    });
    assert.equal(invalidRes.status, 400);
    const invalidJson = await invalidRes.json();
    assert.equal(invalidJson.invalidIsbn, true);

    const memCacheStore = new Map();
    const cacheOverride = {
      match: async (req) => memCacheStore.get(typeof req === 'string' ? req : req.url) || null,
      put: async (req, res) => memCacheStore.set(typeof req === 'string' ? req : req.url, res),
    };

    let upstreamCalls = 0;
    const brasilPayload = {
      isbn: '9788535914849',
      title: 'Memórias Póstumas de Brás Cubas',
      subtitle: 'Edição Comentada',
      authors: ['Machado de Assis'],
      publisher: 'Companhia das Letras',
      synopsis: 'Clássico da literatura brasileira.',
      dimensions: { width: 14, height: 21, unit: 'CENTIMETER' },
      year: 2014,
      format: 'PHYSICAL',
      page_count: 320,
      subjects: ['Ficção brasileira', 'Literatura clássica'],
      cover_url: 'http://covers.example.org/bras-cubas.jpg',
      provider: 'cbl',
    };

    const proxyFetch = async (url) => {
      upstreamCalls += 1;
      if (String(url).includes('/9788535914849')) {
        return makeJsonResponse(brasilPayload, 200);
      }
      return makeJsonResponse({ message: 'ISBN não encontrado' }, 404);
    };

    const firstProxy = await handleBrasilApiIsbnRequest(
      {
        request: new Request('https://omniprism.pages.dev/api/isbn/978-85-359-1484-9', { method: 'GET' }),
        params: { path: ['978-85-359-1484-9'] },
      },
      { fetchImpl: proxyFetch, cacheOverride }
    );
    assert.equal(firstProxy.status, 200);
    const body1 = await firstProxy.json();
    assert.equal(body1.title, 'Memórias Póstumas de Brás Cubas');

    const secondProxy = await handleBrasilApiIsbnRequest(
      {
        request: new Request('https://omniprism.pages.dev/api/isbn/9788535914849', { method: 'GET' }),
        params: { path: ['9788535914849'] },
      },
      { fetchImpl: proxyFetch, cacheOverride }
    );
    assert.equal(secondProxy.status, 200);
    assert.equal(upstreamCalls, 1);

    const notFoundProxy = await handleBrasilApiIsbnRequest(
      {
        request: new Request('https://omniprism.pages.dev/api/isbn/9780306406157', { method: 'GET' }),
        params: { path: ['9780306406157'] },
      },
      { fetchImpl: proxyFetch, cacheOverride }
    );
    assert.equal(notFoundProxy.status, 404);
    const nfJson = await notFoundProxy.json();
    assert.equal(nfJson.notFound, true);
    assert.match(nfJson.error, /BrasilAPI/i);

    // Normalização direta e fluxo completo fetchBookByIsbn
    const norm = normalizeBrasilApiIsbnResponse(brasilPayload, '9788535914849');
    assert.equal(norm.title, 'Memórias Póstumas de Brás Cubas: Edição Comentada');
    assert.equal(norm.coverUrl, 'https://covers.example.org/bras-cubas.jpg');
    assert.equal(norm.totalPages, 320);
    assert.equal(norm.bookFormat, 'Físico');
    assert.match(norm.sourceBadge, /BrasilAPI · cbl/);

    const clientHit = await fetchBookByIsbn('978-85-359-1484-9', {
      forceProxy: true,
      fetchImpl: (url) => {
        if (String(url).includes('/api/isbn/')) {
          return makeJsonResponse(brasilPayload, 200);
        }
        return makeJsonResponse({}, 404);
      },
    });
    assert.equal(clientHit.ok, true);
    assert.equal(clientHit.candidate.author, 'Machado de Assis');
    assert.equal(clientHit.usedSources[0], 'BrasilAPI');

    // BrasilAPI 404 + Google Books/OL 404 -> mensagem clara para cadastrar manualmente
    const clientMiss = await fetchBookByIsbn('978-0-306-40615-7', {
      forceProxy: true,
      fetchImpl: () => makeJsonResponse({ notFound: true }, 404),
    });
    assert.equal(clientMiss.ok, false);
    assert.equal(clientMiss.notFound, true);
    assert.match(clientMiss.error, /cadastrar este livro manualmente/i);
  });

  it('4. Cadastro Manual Universal: compressão <= 300KB, IndexedDB, backup .json preservando capa, espelho limpo, sync local e deduplicação', async () => {
    assert.equal(MANUAL_COVER_MAX_DIMENSION, 600);
    assert.equal(MANUAL_COVER_MAX_BYTES, 300 * 1024);

    const smallDataUrl = 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=';
    assert.equal(isCompressedManualCoverDataUrl(smallDataUrl), true);

    const okCompressed = await compressManualCoverImage(smallDataUrl);
    assert.equal(okCompressed.ok, true);

    const oversizedDataUrl = `data:image/jpeg;base64,${'A'.repeat(450_000)}`;
    const tooLarge = await compressManualCoverImage(oversizedDataUrl);
    assert.equal(tooLarge.ok, false);
    assert.match(tooLarge.error, /300 KB/);

    const idbFactory = createFakeIdbFactory();
    const manualId = 'manual-br-uuid-001';
    await saveManualCoverInIdb(manualId, smallDataUrl, { idbFactory, bytes: 38 });
    clearMemoryManualCoversForTests();
    const loadedFromIdb = await getManualCoverFromIdb(manualId, { idbFactory });
    assert.equal(loadedFromIdb, smallDataUrl);

    const manualBook = {
      id: manualId,
      domain: 'reading',
      workType: 'book',
      title: 'A Casa das Sete Estações',
      creator: 'Autora Independente BR',
      author: 'Autora Independente BR',
      director: 'Autora Independente BR',
      releaseYear: 2024,
      totalPages: 218,
      bookFormat: 'E-book',
      seriesVolume: 'Vol. 1',
      franchiseName: 'Crônicas do Sertão',
      workUrl: 'https://www.wattpad.com/story/exemplo',
      coverUrl: smallDataUrl,
      manualCoverDataUrl: smallDataUrl,
      isManual: true,
      ids: buildManualExternalIds(manualId),
      status: 'completed',
      rating100: 92,
      score10: 9.2,
      verdict: 'masterpiece',
      notes: 'Obra independente fantástica.',
      updatedAt: '2026-11-20T12:00:00.000Z',
    };

    assert.equal(isManualWork(manualBook), true);
    assert.deepEqual(manualBook.ids, { source: 'manual', id: manualId });

    // Backup completo (.json) DEVE incluir a capa comprimida enviada pelo usuário
    const exported = await exportSignedBackupPayload({ items: [manualBook] });
    const exportedItem = exported.tables.works[0];
    assert.equal(exportedItem.manualCoverDataUrl, smallDataUrl);
    const inspected = await inspectBackupPayload(JSON.stringify(exported));
    assert.equal(inspected.ok, true);
    assert.equal(inspected.checksumStatus, 'valid');
    assert.equal(inspected.snapshot.items[0].manualCoverDataUrl, smallDataUrl);
    assert.equal(inspected.db.tables.works[0].manualCoverDataUrl, smallDataUrl);

    // Espelho de emergência em localStorage (padrão preserveCompressedManualCovers=false) retira Base64 pesado
    const mirrorStripped = stripBase64MediaFromWorks([manualBook]);
    assert.equal(mirrorStripped[0].manualCoverDataUrl, '');
    assert.equal(mirrorStripped[0].coverUrl, '');

    // Sync Supabase: não envia Base64 para catalog_works.cover_url, mas preserva manualCoverDataUrl local no merge
    const cloudRow = mapLocalWorkToCatalogRow(manualBook, 'user-123');
    assert.equal(cloudRow.cover_url, null);
    assert.deepEqual(cloudRow.external_ids, { source: 'manual', id: manualId });
    assert.equal(cloudRow.progress_data.isManual, true);
    assert.equal(cloudRow.progress_data.seriesVolume, 'Vol. 1');

    const mergeResult = mergeWorksByUpdatedAt([manualBook], [
      {
        ...manualBook,
        manualCoverDataUrl: null,
        coverUrl: null,
        updatedAt: '2026-11-25T10:00:00.000Z',
        notes: 'Nota sincronizada da nuvem.',
      },
    ]);
    assert.equal(mergeResult.mergedWorks[0].notes, 'Nota sincronizada da nuvem.');
    assert.equal(mergeResult.mergedWorks[0].manualCoverDataUrl, smallDataUrl);
    assert.equal(mergeResult.mergedWorks[0].coverUrl, smallDataUrl);

    // Deduplicação inclui obras manuais vs API ou vs outra manual
    const apiCandidate = {
      id: 'ol-dup-99',
      domain: 'reading',
      workType: 'book',
      title: 'A Casa das Sete Estações',
      creator: 'Autora Independente BR',
      ids: { ol: 'OL99W' },
    };
    const dupFound = findCatalogDuplicate(apiCandidate, [manualBook]);
    assert.ok(dupFound);
    assert.equal(dupFound.match.id, manualId);
  });

  it('5. Vincular a uma fonte: preserva nota/critérios/progresso/capa local e gera snapshot completo de Desfazer', () => {
    const localCover = 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=';
    const manualId = 'manual-uuid-link-77';
    const manualWork = {
      id: manualId,
      domain: 'reading',
      workType: 'book',
      title: 'O Som do Trovão',
      creator: 'Clara Mendes',
      author: 'Clara Mendes',
      director: 'Clara Mendes',
      releaseYear: 2025,
      status: 'in_progress',
      pagesRead: 112,
      rating100: 88,
      score10: 8.8,
      verdict: 'recommended',
      criteriaScores: { ritmo: 9, escrita: 9 },
      notes: 'Leitura excelente até o capítulo 8.',
      manualCoverDataUrl: localCover,
      coverUrl: localCover,
      isManual: true,
      ids: buildManualExternalIds(manualId),
    };

    const apiCandidate = {
      id: 'gb-official-42',
      domain: 'reading',
      workType: 'book',
      title: 'O Som do Trovão',
      creator: 'Clara Mendes',
      releaseYear: 2025,
      totalPages: 340,
      studio: 'Editora Horizonte',
      synopsis: 'Sinopse oficial vinda do catálogo da API.',
      coverUrl: 'https://books.example.com/som-trovao.jpg',
      ids: { googleBooks: 'gb-official-42', isbn: '9788599999999' },
      sourceBadge: 'Google Books',
    };

    const merged = mergeManualWorkWithApiCandidate(manualWork, apiCandidate);
    assert.ok(merged);
    assert.equal(merged.updatedWork.isManual, false);
    assert.equal(merged.updatedWork.rating100, 88);
    assert.equal(merged.updatedWork.pagesRead, 112);
    assert.deepEqual(merged.updatedWork.criteriaScores, { ritmo: 9, escrita: 9 });
    assert.equal(merged.updatedWork.notes, 'Leitura excelente até o capítulo 8.');
    assert.equal(merged.updatedWork.totalPages, 340);
    assert.equal(merged.updatedWork.studio, 'Editora Horizonte');
    assert.equal(merged.updatedWork.ids.googleBooks, 'gb-official-42');
    assert.equal(merged.updatedWork.ids.linkedFromManualId, manualId);
    assert.equal(merged.updatedWork.coverUrl, localCover);
    assert.equal(merged.undoSnapshot.isManual, true);
    assert.deepEqual(merged.undoSnapshot.ids, { source: 'manual', id: manualId });
  });

  it('6. Autor manual: meta local, total definido pelo usuário, modo total aberto sem porcentagem inventada e ficha de entidade', () => {
    const storage = createMemoryStorage();
    const authorEntity = { name: 'Ana Beatriz Costa', domain: 'reading', role: 'author' };

    const openComp = computeEntityCompleteness({
      works: [
        { id: '1', status: 'completed' },
        { id: '2', status: 'queued' },
      ],
      mainSeriesTotal: null,
    });
    assert.equal(openComp.completed, 1);
    assert.equal(openComp.inCatalog, 2);
    assert.equal(openComp.mainSeriesTotal, null);
    assert.equal(openComp.pct, null);
    assert.equal(openComp.isOpenEnded, true);

    saveManualEntityMeta(
      authorEntity,
      { mainSeriesTotal: 5, seriesName: 'Ciclo das Águas' },
      { storage }
    );
    const loaded = getManualEntityMeta(authorEntity, { storage });
    assert.equal(loaded.mainSeriesTotal, 5);
    assert.equal(loaded.seriesName, 'Ciclo das Águas');

    const closedComp = computeEntityCompleteness({
      works: [
        { id: '1', status: 'completed' },
        { id: '2', status: 'completed' },
        { id: '3', status: 'queued' },
      ],
      mainSeriesTotal: loaded.mainSeriesTotal,
    });
    assert.equal(closedComp.completed, 2);
    assert.equal(closedComp.mainSeriesTotal, 5);
    assert.equal(closedComp.pct, 40);
    assert.equal(closedComp.isOpenEnded, false);
  });

  it('7. UI e segurança: AddScreen, WorkDetailPage (read-mode zero inputs preservado), EntitySheetModal e AboutCreditsModal', () => {
    const addScreen = readText('src/screens/AddScreen.jsx');
    assert.ok(addScreen.includes('Buscar por ISBN'));
    assert.ok(addScreen.includes('Não achou? Cadastrar manualmente'));
    assert.ok(addScreen.includes('Mais detalhes'));
    assert.ok(addScreen.includes('accept="image/*"'));

    const workDetail = readText('src/components/WorkDetailPage.jsx');
    assert.ok(workDetail.includes('Vincular a uma fonte'));
    const editIdx = workDetail.indexOf('{isEditDrawerOpen && (');
    const linkModalIdx = workDetail.indexOf('Vincular obra manual a uma fonte');
    assert.ok(editIdx > 0 && linkModalIdx > editIdx);

    const entitySheet = readText('src/components/EntitySheetModal.jsx');
    assert.ok(entitySheet.includes('computeEntityCompleteness'));
    assert.ok(entitySheet.includes('Definir total'));
    assert.ok(entitySheet.includes('Adicionar obra faltante'));
    assert.ok(entitySheet.includes('total aberto'));

    const credits = readText('src/components/AboutCreditsModal.jsx');
    assert.ok(credits.includes('BrasilAPI'));
  });
});
