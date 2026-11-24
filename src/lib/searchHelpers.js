/**
 * Utilitários puros de busca local instantânea e histórico recente por domínio (v2.4.0 Fase 2.1).
 */

import {
  inferDomainFromWork,
  normalizeDomainId,
  normalizeWorkTypeForDomain,
} from '../config/domainConfig.js';

export const SEARCH_DEBOUNCE_MS = 250;
export const RECENT_SEARCHES_STORAGE_KEY = 'omniprism_recent_searches_v1';
export const MAX_RECENT_SEARCHES = 8;

function normalizeSearchText(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Busca instantânea local no acervo do usuário antes da rede responder.
 */
export function searchLocalCatalogWorks(
  items = [],
  query = '',
  { domain = 'all', mediaTypeFilter = 'all', limit = 8 } = {}
) {
  const normQuery = normalizeSearchText(query);
  if (!normQuery || normQuery.length < 2) return [];

  const tokens = normQuery.split(' ').filter(Boolean);
  const filterByDomain = domain && domain !== 'all';
  const targetDomain = filterByDomain ? normalizeDomainId(domain) : null;

  const scored = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || item.inBacklog === false) continue;
    const itemDomain = inferDomainFromWork(item);
    if (targetDomain && itemDomain !== targetDomain) continue;

    if (mediaTypeFilter && mediaTypeFilter !== 'all') {
      const itemType = normalizeWorkTypeForDomain(item.workType || item.mediaType, itemDomain);
      if (itemType !== mediaTypeFilter) continue;
    }

    const titleNorm = normalizeSearchText(item.title);
    const origNorm = normalizeSearchText(item.originalTitle);
    const creatorNorm = normalizeSearchText(
      [item.creator, item.director, item.author, item.studio, item.artist].filter(Boolean).join(' ')
    );
    const extraNorm = normalizeSearchText(
      [
        item.albumName,
        item.franchiseName,
        item.isbnOrDoi,
        item.subgenre,
        ...(Array.isArray(item.genres) ? item.genres : []),
        ...(Array.isArray(item.tags) ? item.tags : []),
      ]
        .filter(Boolean)
        .join(' ')
    );

    const haystack = `${titleNorm} ${origNorm} ${creatorNorm} ${extraNorm}`.trim();
    if (!tokens.every((t) => haystack.includes(t))) continue;

    let score = 0;
    if (titleNorm === normQuery || origNorm === normQuery) score += 100;
    else if (titleNorm.startsWith(normQuery) || origNorm.startsWith(normQuery)) score += 60;
    else if (titleNorm.includes(normQuery) || origNorm.includes(normQuery)) score += 40;
    if (creatorNorm.includes(normQuery)) score += 25;
    if (extraNorm.includes(normQuery)) score += 10;

    scored.push({
      score,
      item: {
        ...item,
        isLocalCatalogHit: true,
      },
    });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(a.item.title || '').localeCompare(String(b.item.title || ''), 'pt-BR');
  });

  return scored.slice(0, Math.max(1, limit)).map((entry) => entry.item);
}

function readAllRecentSearchMap(storage) {
  if (!storage || typeof storage.getItem !== 'function') return {};
  try {
    const raw = storage.getItem(RECENT_SEARCHES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeAllRecentSearchMap(map, storage) {
  if (!storage || typeof storage.setItem !== 'function') return;
  try {
    storage.setItem(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Silencioso se cota estiver cheia
  }
}

export function readRecentSearches(
  domain = 'cinema',
  storage = typeof localStorage !== 'undefined' ? localStorage : null
) {
  const key = normalizeDomainId(domain);
  const map = readAllRecentSearchMap(storage);
  const list = Array.isArray(map[key]) ? map[key] : [];
  return list
    .map((entry) => String(entry || '').trim())
    .filter((entry) => entry.length >= 2)
    .slice(0, MAX_RECENT_SEARCHES);
}

export function recordRecentSearch(
  domain = 'cinema',
  query = '',
  storage = typeof localStorage !== 'undefined' ? localStorage : null
) {
  const clean = String(query || '').trim();
  if (clean.length < 2 || clean.startsWith('#')) {
    return readRecentSearches(domain, storage);
  }
  const key = normalizeDomainId(domain);
  const map = readAllRecentSearchMap(storage);
  const current = Array.isArray(map[key]) ? map[key] : [];
  const normClean = normalizeSearchText(clean);
  const next = [
    clean,
    ...current.filter((item) => normalizeSearchText(item) !== normClean),
  ].slice(0, MAX_RECENT_SEARCHES);
  map[key] = next;
  writeAllRecentSearchMap(map, storage);
  return next;
}

export function removeRecentSearch(
  domain = 'cinema',
  query = '',
  storage = typeof localStorage !== 'undefined' ? localStorage : null
) {
  const key = normalizeDomainId(domain);
  const map = readAllRecentSearchMap(storage);
  const current = Array.isArray(map[key]) ? map[key] : [];
  const normTarget = normalizeSearchText(query);
  const next = current.filter((item) => normalizeSearchText(item) !== normTarget);
  map[key] = next;
  writeAllRecentSearchMap(map, storage);
  return next;
}

export function clearRecentSearches(
  domain = 'cinema',
  storage = typeof localStorage !== 'undefined' ? localStorage : null
) {
  const key = normalizeDomainId(domain);
  const map = readAllRecentSearchMap(storage);
  map[key] = [];
  writeAllRecentSearchMap(map, storage);
  return [];
}
