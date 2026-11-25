import {
  BRASILAPI_ISBN_UPSTREAM_BASE,
  DETAIL_CACHE_TTL_SECONDS,
  isAllowedSameOriginRequest,
  jsonResponse,
  methodNotAllowedResponse,
  proxyWithDefaultCache,
} from '../../_lib/proxyCore.js';

const ALLOWED_PROVIDERS = new Set([
  'cbl',
  'mercado-editorial',
  'open-library',
  'google-books',
]);

function normalizeIsbnInput(raw = '') {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^0-9X]/g, '');
}

function isValidIsbnCheckDigit(digits = '') {
  if (/^\d{9}[\dX]$/.test(digits)) {
    let sum = 0;
    for (let i = 0; i < 9; i += 1) {
      sum += (10 - i) * Number(digits[i]);
    }
    sum += digits[9] === 'X' ? 10 : Number(digits[9]);
    return sum % 11 === 0;
  }
  if (/^\d{13}$/.test(digits)) {
    let sum = 0;
    for (let i = 0; i < 12; i += 1) {
      sum += (i % 2 === 0 ? 1 : 3) * Number(digits[i]);
    }
    const check = (10 - (sum % 10)) % 10;
    return check === Number(digits[12]);
  }
  return false;
}

export async function handleBrasilApiIsbnRequest(
  context,
  { fetchImpl = fetch, cacheOverride = null, timeoutMs = 8000 } = {}
) {
  const { request, params, waitUntil } = context || {};
  if (request?.method !== 'GET') {
    return methodNotAllowedResponse();
  }

  if (!isAllowedSameOriginRequest(request)) {
    return jsonResponse({ error: 'Origem não autorizada para proxy ISBN.' }, 403);
  }

  let incomingUrl;
  try {
    incomingUrl = new URL(request.url);
  } catch {
    return jsonResponse({ error: 'URL de requisição inválida.' }, 400);
  }

  const pathSeg = Array.isArray(params?.path)
    ? params.path.join('')
    : typeof params?.path === 'string'
      ? params.path
      : incomingUrl.pathname.replace(/^\/api\/isbn\/?/i, '');
  const rawIsbn =
    pathSeg || incomingUrl.searchParams.get('isbn') || incomingUrl.searchParams.get('code') || '';
  const cleanIsbn = normalizeIsbnInput(rawIsbn);

  if (!cleanIsbn || !isValidIsbnCheckDigit(cleanIsbn)) {
    return jsonResponse(
      {
        error: 'ISBN inválido. Verifique os 10 ou 13 dígitos e tente novamente.',
        invalidIsbn: true,
      },
      400
    );
  }

  const rawProviders = String(incomingUrl.searchParams.get('providers') || '')
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter((p) => ALLOWED_PROVIDERS.has(p));

  const upstreamBase = `${BRASILAPI_ISBN_UPSTREAM_BASE}/${cleanIsbn}`;
  const upstreamUrl =
    rawProviders.length > 0
      ? `${upstreamBase}?providers=${encodeURIComponent(rawProviders.join(','))}`
      : upstreamBase;

  const res = await proxyWithDefaultCache({
    cacheUrl: upstreamUrl,
    upstreamUrl,
    ttlSeconds: DETAIL_CACHE_TTL_SECONDS,
    fetchImpl,
    cacheOverride,
    timeoutMs,
    waitUntil: typeof waitUntil === 'function' ? waitUntil.bind(context) : null,
  });

  if (res.status === 404) {
    return jsonResponse(
      {
        ok: false,
        notFound: true,
        isbn: cleanIsbn,
        error:
          'ISBN não encontrado nas bases da BrasilAPI (CBL, Mercado Editorial, Open Library e Google Books).',
      },
      404
    );
  }

  return res;
}

export async function onRequest(context) {
  return handleBrasilApiIsbnRequest(context);
}
