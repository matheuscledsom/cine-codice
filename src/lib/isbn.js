/**
 * Validação, normalização e parser de ISBN-10 / ISBN-13 (OMNIPRISM v2.6.0 — Fase 2).
 * Módulo puro sem dependência de React ou DOM.
 */

const HTTP_URL_RE = /^https?:\/\//i;

function normalizeHttpsCover(raw) {
  const clean = String(raw || '').trim();
  if (!clean || !HTTP_URL_RE.test(clean)) return null;
  return clean.replace(/^http:\/\//i, 'https://');
}

/**
 * Remove hífens, espaços e normaliza X maiúsculo.
 */
export function cleanIsbn(raw = '') {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^0-9X]/g, '');
}

/**
 * Formata entrada possivelmente contendo apenas ISBN (com hífens/espaços).
 */
export function looksLikeIsbnInput(raw = '') {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return false;
  const cleaned = cleanIsbn(trimmed);
  return (cleaned.length === 10 || cleaned.length === 13) && /^[0-9-]+X?$/i.test(trimmed.replace(/\s+/g, ''));
}

export function validateIsbn10(digits = '') {
  const s = cleanIsbn(digits);
  if (!/^\d{9}[\dX]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i += 1) {
    sum += (10 - i) * Number(s[i]);
  }
  const check = s[9] === 'X' ? 10 : Number(s[9]);
  sum += check;
  return sum % 11 === 0;
}

export function validateIsbn13(digits = '') {
  const s = cleanIsbn(digits);
  if (!/^\d{13}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += (i % 2 === 0 ? 1 : 3) * Number(s[i]);
  }
  const expectedCheck = (10 - (sum % 10)) % 10;
  return expectedCheck === Number(s[12]);
}

/**
 * Valida ISBN-10 ou ISBN-13 com ou sem hífen, verificando o dígito verificador.
 */
export function parseAndValidateIsbn(raw = '') {
  const cleaned = cleanIsbn(raw);
  if (!cleaned) {
    return {
      valid: false,
      normalized: '',
      format: null,
      error: 'Informe um ISBN-10 ou ISBN-13 (com ou sem hífen).',
    };
  }

  if (cleaned.length === 10) {
    if (!validateIsbn10(cleaned)) {
      return {
        valid: false,
        normalized: cleaned,
        format: 'ISBN-10',
        error: 'ISBN-10 inválido: dígito verificador incorreto.',
      };
    }
    return {
      valid: true,
      normalized: cleaned,
      format: 'ISBN-10',
      error: null,
    };
  }

  if (cleaned.length === 13) {
    if (!validateIsbn13(cleaned)) {
      return {
        valid: false,
        normalized: cleaned,
        format: 'ISBN-13',
        error: 'ISBN-13 inválido: dígito verificador incorreto.',
      };
    }
    return {
      valid: true,
      normalized: cleaned,
      format: 'ISBN-13',
      error: null,
    };
  }

  return {
    valid: false,
    normalized: cleaned,
    format: null,
    error: 'ISBN deve ter exatamente 10 ou 13 dígitos válidos.',
  };
}

/**
 * Converte resposta da BrasilAPI (`/api/isbn/v1/{isbn}`) em candidato padrão do OmniPrism.
 */
export function normalizeBrasilApiIsbnResponse(payload = null, requestedIsbn = '') {
  if (!payload || typeof payload !== 'object') return null;
  const title = String(payload.title || '').trim();
  if (!title) return null;

  const fullTitle = payload.subtitle
    ? `${title}: ${String(payload.subtitle).trim()}`
    : title;
  const authors = Array.isArray(payload.authors)
    ? payload.authors.map((a) => String(a || '').trim()).filter(Boolean)
    : [];
  const creator = authors.slice(0, 3).join(', ');
  const subjects = Array.isArray(payload.subjects)
    ? payload.subjects.map((s) => String(s || '').trim()).filter(Boolean).slice(0, 4)
    : [];
  const isMangaHint =
    subjects.some((s) => /mang[áa]|comic|quadrinhos|graphic novel/i.test(s)) ||
    /\bmang[áa]\b/i.test(fullTitle);

  const normalizedIsbn = cleanIsbn(payload.isbn || requestedIsbn);
  const yearNum = Number(payload.year);
  const releaseYear =
    Number.isFinite(yearNum) && yearNum >= 1400 && yearNum <= 2100 ? Math.round(yearNum) : null;
  const pageCount = Number(payload.page_count);
  const totalPages = Number.isFinite(pageCount) && pageCount > 0 ? Math.round(pageCount) : null;
  const coverUrl = normalizeHttpsCover(payload.cover_url);
  const formatLower = String(payload.format || '').toLowerCase();
  const bookFormat = /e-?book|digital|kindle|pdf|epub/i.test(formatLower) ? 'E-book' : 'Físico';
  const upstreamProvider = String(payload.provider || '').trim();

  return {
    id: `isbn-${normalizedIsbn || Date.now()}`,
    domain: 'reading',
    workType: isMangaHint ? 'manga' : 'book',
    title: fullTitle,
    originalTitle: '',
    creator,
    director: creator,
    author: creator,
    studio: String(payload.publisher || '').trim(),
    publisher: String(payload.publisher || '').trim(),
    releaseYear,
    coverUrl,
    coverSources: coverUrl ? [coverUrl] : [],
    synopsis: String(payload.synopsis || '').trim(),
    totalPages,
    pagesRead: 0,
    chaptersRead: 0,
    isbnOrDoi: normalizedIsbn,
    isbn: normalizedIsbn,
    bookFormat,
    language: 'pt',
    genres: subjects,
    ids: {
      ...(normalizedIsbn ? { isbn: normalizedIsbn } : {}),
    },
    source: 'brasilapi',
    sourceBadge: upstreamProvider ? `BrasilAPI · ${upstreamProvider}` : 'BrasilAPI ISBN',
    mergedSources: [upstreamProvider ? `BrasilAPI (${upstreamProvider})` : 'BrasilAPI'],
  };
}
