/**
 * Registro ordenado de fontes de busca por domínio (OmniPrism v2.6.0).
 *
 * Recursos:
 * - Lista ordenada por prioridade com `id`, `priority`, `timeoutMs`, `cacheTtlMs` e resultado normalizado com `source`.
 * - Fallback sequencial em: erro, timeout ou zero resultados relevantes.
 * - Enriquecimento parcial por campo faltante (ex.: se só `coverUrl` faltar, consulta a próxima fonte apenas para preencher a lacuna).
 * - Circuit breaker: 3 falhas seguidas pausam a fonte por 5 minutos.
 * - Pulo automático para fontes desativadas pelo usuário ou sem chave configurada.
 */

import { getCachedEntry, setCachedEntry } from '../api/cacheDb.js';
import { CACHE_STORES, CACHE_TTL_MS } from '../api/limits.js';
import { normalizeDomainId } from '../config/domainConfig.js';

export const PROVIDER_PREFS_STORAGE_KEY = 'omniprism_provider_prefs_v1';
export const CIRCUIT_BREAKER_THRESHOLD = 3;
export const CIRCUIT_BREAKER_COOLDOWN_MS = 5 * 60 * 1000;
export const DEFAULT_PROVIDER_TIMEOUT_MS = 8000;

export const DEFAULT_DOMAIN_PROVIDERS = Object.freeze({
  games: Object.freeze([
    Object.freeze({
      id: 'igdb',
      label: 'IGDB',
      domain: 'games',
      priority: 1,
      timeoutMs: 8000,
      cacheTtlMs: CACHE_TTL_MS.search,
      requiresKey: true,
      supportsServerProxy: true,
    }),
    Object.freeze({
      id: 'rawg',
      label: 'RAWG',
      domain: 'games',
      priority: 2,
      timeoutMs: 8000,
      cacheTtlMs: CACHE_TTL_MS.search,
      requiresKey: true,
      supportsServerProxy: true,
    }),
    Object.freeze({
      id: 'steam',
      label: 'Steam Store',
      domain: 'games',
      priority: 3,
      timeoutMs: 8000,
      cacheTtlMs: CACHE_TTL_MS.search,
      requiresKey: false,
      supportsServerProxy: true,
    }),
    Object.freeze({
      id: 'wikidata',
      label: 'Wikidata',
      domain: 'games',
      priority: 4,
      timeoutMs: 8000,
      cacheTtlMs: CACHE_TTL_MS.search,
      requiresKey: false,
      supportsServerProxy: false,
    }),
  ]),
  reading: Object.freeze([
    Object.freeze({
      id: 'googleBooks',
      label: 'Google Books',
      domain: 'reading',
      priority: 1,
      timeoutMs: 8000,
      cacheTtlMs: CACHE_TTL_MS.search,
      requiresKey: false,
      supportsServerProxy: false,
    }),
    Object.freeze({
      id: 'openlibrary',
      label: 'Open Library',
      domain: 'reading',
      priority: 2,
      timeoutMs: 8000,
      cacheTtlMs: CACHE_TTL_MS.search,
      requiresKey: false,
      supportsServerProxy: false,
    }),
  ]),
  music: Object.freeze([
    Object.freeze({
      id: 'itunes',
      label: 'iTunes',
      domain: 'music',
      priority: 1,
      timeoutMs: 8000,
      cacheTtlMs: CACHE_TTL_MS.search,
      requiresKey: false,
      supportsServerProxy: false,
    }),
    Object.freeze({
      id: 'musicbrainz',
      label: 'MusicBrainz',
      domain: 'music',
      priority: 2,
      timeoutMs: 12000,
      cacheTtlMs: 12 * 60 * 60 * 1000,
      requiresKey: false,
      supportsServerProxy: false,
    }),
  ]),
  cinema: Object.freeze([
    Object.freeze({
      id: 'tmdb',
      label: 'TMDB',
      domain: 'cinema',
      priority: 1,
      timeoutMs: 8000,
      cacheTtlMs: CACHE_TTL_MS.search,
      requiresKey: true,
      supportsServerProxy: true,
    }),
    Object.freeze({
      id: 'tvmaze',
      label: 'TVmaze',
      domain: 'cinema',
      priority: 2,
      timeoutMs: 8000,
      cacheTtlMs: CACHE_TTL_MS.search,
      requiresKey: false,
      supportsServerProxy: false,
    }),
    Object.freeze({
      id: 'anilist',
      label: 'AniList',
      domain: 'cinema',
      priority: 3,
      timeoutMs: 8000,
      cacheTtlMs: CACHE_TTL_MS.search,
      requiresKey: false,
      supportsServerProxy: false,
    }),
    Object.freeze({
      id: 'jikan',
      label: 'Jikan (MAL)',
      domain: 'cinema',
      priority: 4,
      timeoutMs: 8000,
      cacheTtlMs: CACHE_TTL_MS.search,
      requiresKey: false,
      supportsServerProxy: false,
    }),
    Object.freeze({
      id: 'imdb',
      label: 'IMDb',
      domain: 'cinema',
      priority: 5,
      timeoutMs: 8000,
      cacheTtlMs: CACHE_TTL_MS.search,
      requiresKey: false,
      supportsServerProxy: false,
    }),
    Object.freeze({
      id: 'omdb',
      label: 'OMDb',
      domain: 'cinema',
      priority: 6,
      timeoutMs: 8000,
      cacheTtlMs: CACHE_TTL_MS.search,
      requiresKey: true,
      supportsServerProxy: true,
    }),
    Object.freeze({
      id: 'wikidata',
      label: 'Wikidata',
      domain: 'cinema',
      priority: 7,
      timeoutMs: 8000,
      cacheTtlMs: CACHE_TTL_MS.search,
      requiresKey: false,
      supportsServerProxy: false,
    }),
    Object.freeze({
      id: 'internetArchive',
      label: 'Internet Archive',
      domain: 'cinema',
      priority: 8,
      timeoutMs: 8000,
      cacheTtlMs: CACHE_TTL_MS.search,
      requiresKey: false,
      supportsServerProxy: false,
    }),
  ]),
});

const circuitStates = new Map();
let memoryPrefs = { disabled: {}, orderByDomain: {} };

function resolveStorage(customStorage = null) {
  if (customStorage) return customStorage;
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    // Sem acesso a localStorage
  }
  return null;
}

export function loadProviderPreferences({ storage = null } = {}) {
  const store = resolveStorage(storage);
  if (!store || typeof store.getItem !== 'function') {
    return {
      disabled: { ...(memoryPrefs.disabled || {}) },
      orderByDomain: { ...(memoryPrefs.orderByDomain || {}) },
    };
  }
  try {
    const raw = store.getItem(PROVIDER_PREFS_STORAGE_KEY);
    if (!raw) {
      return { disabled: {}, orderByDomain: {} };
    }
    const parsed = JSON.parse(raw);
    return {
      disabled:
        parsed?.disabled && typeof parsed.disabled === 'object' ? { ...parsed.disabled } : {},
      orderByDomain:
        parsed?.orderByDomain && typeof parsed.orderByDomain === 'object'
          ? { ...parsed.orderByDomain }
          : {},
    };
  } catch {
    return { disabled: {}, orderByDomain: {} };
  }
}

export function saveProviderPreferences(prefs, { storage = null } = {}) {
  const clean = {
    disabled:
      prefs?.disabled && typeof prefs.disabled === 'object' ? { ...prefs.disabled } : {},
    orderByDomain:
      prefs?.orderByDomain && typeof prefs.orderByDomain === 'object'
        ? { ...prefs.orderByDomain }
        : {},
  };
  memoryPrefs = clean;
  const store = resolveStorage(storage);
  if (store && typeof store.setItem === 'function') {
    try {
      store.setItem(PROVIDER_PREFS_STORAGE_KEY, JSON.stringify(clean));
    } catch {
      // Silencioso em quota
    }
  }
  return clean;
}

export function isProviderEnabled(providerId, { storage = null } = {}) {
  const id = String(providerId || '').trim();
  if (!id) return false;
  const prefs = loadProviderPreferences({ storage });
  return prefs.disabled?.[id] !== true;
}

export function setProviderEnabled(providerId, enabled, { storage = null } = {}) {
  const id = String(providerId || '').trim();
  if (!id) return loadProviderPreferences({ storage });
  const prefs = loadProviderPreferences({ storage });
  const nextDisabled = { ...(prefs.disabled || {}) };
  if (enabled) {
    delete nextDisabled[id];
  } else {
    nextDisabled[id] = true;
  }
  return saveProviderPreferences({ ...prefs, disabled: nextDisabled }, { storage });
}

export function getDomainProviders(
  domain = 'games',
  { storage = null, customProviders = null } = {}
) {
  const cleanDomain = normalizeDomainId(domain);
  const baseList = Array.isArray(customProviders)
    ? customProviders
    : DEFAULT_DOMAIN_PROVIDERS[cleanDomain] || [];
  const prefs = loadProviderPreferences({ storage });
  const customOrder = Array.isArray(prefs.orderByDomain?.[cleanDomain])
    ? prefs.orderByDomain[cleanDomain]
    : null;

  const orderIndex = new Map();
  if (customOrder) {
    customOrder.forEach((id, idx) => orderIndex.set(String(id), idx));
  }

  return [...baseList]
    .sort((a, b) => {
      const idxA = orderIndex.has(a.id) ? orderIndex.get(a.id) : 999 + (a.priority || 0);
      const idxB = orderIndex.has(b.id) ? orderIndex.get(b.id) : 999 + (b.priority || 0);
      if (idxA !== idxB) return idxA - idxB;
      return (a.priority || 0) - (b.priority || 0);
    })
    .map((p, idx) => ({
      ...p,
      priority: idx + 1,
      timeoutMs: Number(p.timeoutMs) || DEFAULT_PROVIDER_TIMEOUT_MS,
      cacheTtlMs: Number(p.cacheTtlMs) || CACHE_TTL_MS.search,
      enabled: prefs.disabled?.[p.id] !== true,
    }));
}

export function moveProviderPriority(
  domain,
  providerId,
  direction = 'up',
  { storage = null } = {}
) {
  const cleanDomain = normalizeDomainId(domain);
  const list = getDomainProviders(cleanDomain, { storage });
  const idx = list.findIndex((p) => p.id === providerId);
  if (idx === -1) return list;

  const targetIdx = direction === 'down' ? idx + 1 : idx - 1;
  if (targetIdx < 0 || targetIdx >= list.length) return list;

  const nextIds = list.map((p) => p.id);
  const [moved] = nextIds.splice(idx, 1);
  nextIds.splice(targetIdx, 0, moved);

  const prefs = loadProviderPreferences({ storage });
  saveProviderPreferences(
    {
      ...prefs,
      orderByDomain: {
        ...(prefs.orderByDomain || {}),
        [cleanDomain]: nextIds,
      },
    },
    { storage }
  );

  return getDomainProviders(cleanDomain, { storage });
}

export function getCircuitBreakerState(providerId, { nowFn = Date.now } = {}) {
  const id = String(providerId || '').trim();
  const raw = circuitStates.get(id) || {
    consecutiveFailures: 0,
    openUntil: 0,
    lastError: null,
    lastSuccessAt: null,
  };
  const now = nowFn();
  const isOpen = raw.openUntil > now;
  return {
    providerId: id,
    consecutiveFailures: raw.consecutiveFailures,
    openUntil: raw.openUntil,
    isOpen,
    remainingMs: isOpen ? Math.max(0, raw.openUntil - now) : 0,
    lastError: raw.lastError,
    lastSuccessAt: raw.lastSuccessAt,
  };
}

export function isCircuitOpen(providerId, options = {}) {
  return getCircuitBreakerState(providerId, options).isOpen;
}

export function recordProviderSuccess(providerId, { nowFn = Date.now } = {}) {
  const id = String(providerId || '').trim();
  if (!id) return null;
  const next = {
    consecutiveFailures: 0,
    openUntil: 0,
    lastError: null,
    lastSuccessAt: nowFn(),
  };
  circuitStates.set(id, next);
  return next;
}

export function recordProviderFailure(
  providerId,
  errorMessage = 'Falha na fonte',
  { nowFn = Date.now, cooldownMs = CIRCUIT_BREAKER_COOLDOWN_MS } = {}
) {
  const id = String(providerId || '').trim();
  if (!id) return null;
  const prev = circuitStates.get(id) || {
    consecutiveFailures: 0,
    openUntil: 0,
    lastError: null,
    lastSuccessAt: null,
  };
  const now = nowFn();
  const consecutiveFailures = prev.consecutiveFailures + 1;
  const openUntil =
    consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD ? now + cooldownMs : 0;
  const next = {
    consecutiveFailures,
    openUntil,
    lastError: String(errorMessage || 'Falha na fonte'),
    lastSuccessAt: prev.lastSuccessAt,
  };
  circuitStates.set(id, next);
  return {
    ...next,
    tripped: openUntil > now,
  };
}

export function resetProviderRegistryForTests({ storage = null } = {}) {
  circuitStates.clear();
  memoryPrefs = { disabled: {}, orderByDomain: {} };
  const store = resolveStorage(storage);
  if (store && typeof store.removeItem === 'function') {
    try {
      store.removeItem(PROVIDER_PREFS_STORAGE_KEY);
    } catch {
      // Silencioso
    }
  }
}

function normalizeMatchText(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isFieldMissingOnItem(item, field) {
  if (!item || typeof item !== 'object') return false;
  if (field === 'coverUrl') return !item.coverUrl;
  if (field === 'creator') return !item.creator && !item.director;
  if (field === 'releaseYear') return !item.releaseYear;
  if (field === 'totalPages') return !(Number(item.totalPages) > 0);
  if (field === 'originalTitle') return !String(item.originalTitle || '').trim();
  if (field === 'platforms') {
    return !Array.isArray(item.platforms) || item.platforms.length === 0;
  }
  if (field === 'synopsis') return !String(item.synopsis || '').trim();
  return item[field] === null || item[field] === undefined || item[field] === '';
}

export function mergeMissingFieldsFromFallback(
  primaryResults = [],
  fallbackResults = [],
  missingFields = ['coverUrl']
) {
  if (!Array.isArray(primaryResults) || primaryResults.length === 0) return [];
  if (!Array.isArray(fallbackResults) || fallbackResults.length === 0) {
    return primaryResults;
  }

  const fallbackByNormTitle = new Map();
  for (const cand of fallbackResults) {
    const key = normalizeMatchText(cand?.title);
    if (key && !fallbackByNormTitle.has(key)) {
      fallbackByNormTitle.set(key, cand);
    }
  }

  return primaryResults.map((item) => {
    const normTitle = normalizeMatchText(item?.title);
    const match =
      (normTitle && fallbackByNormTitle.get(normTitle)) ||
      fallbackResults.find((cand) => {
        const candNorm = normalizeMatchText(cand?.title);
        return (
          candNorm &&
          normTitle &&
          (candNorm.startsWith(normTitle) || normTitle.startsWith(candNorm))
        );
      }) ||
      null;

    if (!match) return item;

    const patched = { ...item };
    let changed = false;

    for (const field of missingFields) {
      if (!isFieldMissingOnItem(patched, field)) continue;
      if (field === 'coverUrl' && match.coverUrl) {
        patched.coverUrl = match.coverUrl;
        patched.coverSources = Array.from(
          new Set([...(patched.coverSources || []), match.coverUrl].filter(Boolean))
        );
        changed = true;
      } else if (field === 'creator' && (match.creator || match.director)) {
        patched.creator = match.creator || match.director;
        patched.director = patched.director || patched.creator;
        changed = true;
      } else if (field === 'releaseYear' && match.releaseYear) {
        patched.releaseYear = match.releaseYear;
        changed = true;
      } else if (field === 'totalPages' && Number(match.totalPages) > 0) {
        patched.totalPages = Math.round(Number(match.totalPages));
        changed = true;
      } else if (field === 'originalTitle' && String(match.originalTitle || '').trim()) {
        patched.originalTitle = String(match.originalTitle).trim();
        changed = true;
      } else if (
        field === 'platforms' &&
        Array.isArray(match.platforms) &&
        match.platforms.length > 0
      ) {
        patched.platforms = match.platforms;
        changed = true;
      } else if (field === 'synopsis' && String(match.synopsis || '').trim()) {
        patched.synopsis = match.synopsis;
        changed = true;
      }
    }

    if (changed && match.source) {
      patched.enrichedFrom = Array.from(
        new Set([...(patched.enrichedFrom || []), match.source])
      );
    }
    return patched;
  });
}

function normalizeProviderResultItem(item, provider) {
  if (!item || typeof item !== 'object') return null;
  return {
    ...item,
    source: item.source || provider.id,
    sourceBadge: item.sourceBadge || provider.label,
    mergedSources: Array.isArray(item.mergedSources) && item.mergedSources.length > 0
      ? item.mergedSources
      : [provider.label],
  };
}

async function runWithTimeoutAndAbort(fn, { timeoutMs, signal }) {
  if (signal?.aborted) {
    const err = new Error('AbortError');
    err.name = 'AbortError';
    throw err;
  }

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timedOut = false;
  const onOuterAbort = () => controller?.abort();
  if (signal && controller) {
    signal.addEventListener('abort', onOuterAbort, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    controller?.abort();
  }, Math.max(50, Number(timeoutMs) || DEFAULT_PROVIDER_TIMEOUT_MS));

  try {
    return await fn(controller ? controller.signal : signal);
  } catch (err) {
    if (timedOut && !signal?.aborted) {
      const timeoutErr = new Error(`Timeout (${timeoutMs}ms)`);
      timeoutErr.name = 'TimeoutError';
      timeoutErr.isTimeout = true;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (signal) {
      signal.removeEventListener('abort', onOuterAbort);
    }
  }
}

/**
 * Executa a cadeia ordenada de fontes para um domínio:
 * - Pula desativadas, sem chave ou com circuit breaker aberto.
 * - Passa à próxima fonte em: erro, timeout ou zero resultados relevantes.
 * - Se resultados vierem com campos faltantes (ex.: coverUrl), consulta a próxima fonte apenas para preencher a lacuna.
 */
export async function executeDomainProviderChain({
  domain = 'games',
  query = '',
  mediaTypeFilter = 'all',
  providers = null,
  executeProvider,
  relevanceFilter = null,
  gapFillFields = ['coverUrl'],
  supplementBelowCount = 0,
  shouldSupplementResults = null,
  signal = undefined,
  skipCache = false,
  nowFn = Date.now,
  storage = null,
  idbFactory = null,
  onPartialResults = null,
} = {}) {
  const cleanDomain = normalizeDomainId(domain);
  const orderedProviders = getDomainProviders(cleanDomain, {
    storage,
    customProviders: providers,
  });

  const attempts = [];
  const usedSources = [];
  const skippedSources = [];
  let primaryResults = [];
  let primaryProvider = null;

  for (let i = 0; i < orderedProviders.length; i += 1) {
    const provider = orderedProviders[i];
    if (signal?.aborted) break;

    if (!provider.enabled) {
      attempts.push({ id: provider.id, status: 'skipped_disabled' });
      skippedSources.push({ id: provider.id, reason: 'disabled' });
      continue;
    }

    if (isCircuitOpen(provider.id, { nowFn })) {
      attempts.push({ id: provider.id, status: 'skipped_circuit_open' });
      skippedSources.push({ id: provider.id, reason: 'circuit_open' });
      continue;
    }

    const cacheKey = `registry:${cleanDomain}:${provider.id}:${mediaTypeFilter}:${normalizeMatchText(query)}`;
    let outcome = null;
    let fromCache = false;

    if (!skipCache && query) {
      const cached = await getCachedEntry(CACHE_STORES.search, cacheKey, {
        idbFactory,
        now: nowFn(),
      }).catch(() => null);
      if (cached?.hit && cached.data && !cached.expired) {
        outcome = { ok: true, results: cached.data };
        fromCache = true;
      }
    }

    if (!outcome) {
      try {
        outcome = await runWithTimeoutAndAbort(
          (providerSignal) =>
            executeProvider(provider, {
              query,
              mediaTypeFilter,
              signal: providerSignal,
              timeoutMs: provider.timeoutMs,
              nowFn,
            }),
          { timeoutMs: provider.timeoutMs, signal }
        );
      } catch (err) {
        if (err?.name === 'AbortError' && signal?.aborted) {
          throw err;
        }
        const reason =
          err?.isTimeout || err?.name === 'TimeoutError' || err?.code === 'API_TIMEOUT'
            ? 'timeout'
            : 'error';
        recordProviderFailure(provider.id, err?.message || reason, { nowFn });
        attempts.push({ id: provider.id, status: reason, error: err?.message || reason });
        continue;
      }
    }

    if (outcome?.missingKey || outcome?.notConfigured) {
      attempts.push({ id: provider.id, status: 'skipped_missing_key' });
      skippedSources.push({ id: provider.id, reason: 'missing_key' });
      continue;
    }

    if (outcome?.timedOut) {
      recordProviderFailure(provider.id, 'timeout', { nowFn });
      attempts.push({ id: provider.id, status: 'timeout' });
      continue;
    }

    if (!outcome?.ok) {
      recordProviderFailure(provider.id, outcome?.error || 'provider_error', { nowFn });
      attempts.push({ id: provider.id, status: 'error', error: outcome?.error || 'error' });
      continue;
    }

    // Sucesso HTTP da fonte -> reseta circuit breaker
    recordProviderSuccess(provider.id, { nowFn });

    const rawList = Array.isArray(outcome.results) ? outcome.results : [];
    const normalizedList = rawList
      .map((item) => normalizeProviderResultItem(item, provider))
      .filter(Boolean);
    const relevantList =
      typeof relevanceFilter === 'function'
        ? normalizedList.filter((item) => relevanceFilter(item, query))
        : normalizedList;

    if (!fromCache && query && relevantList.length > 0) {
      await setCachedEntry(CACHE_STORES.search, cacheKey, relevantList, {
        ttlMs: provider.cacheTtlMs,
        idbFactory,
        now: nowFn(),
      }).catch(() => {});
    }

    if (relevantList.length === 0) {
      attempts.push({ id: provider.id, status: 'zero_results', fromCache });
      continue;
    }

    usedSources.push(provider.label);
    attempts.push({
      id: provider.id,
      status: 'ok',
      count: relevantList.length,
      fromCache,
    });

    if (!primaryProvider) {
      primaryResults = relevantList;
      primaryProvider = provider;

      // Verifica se há lacunas específicas (ex.: capa ausente) ou poucos resultados antes de parar
      const fieldsNeedingFill = (Array.isArray(gapFillFields) ? gapFillFields : []).filter(
        (field) => primaryResults.some((item) => isFieldMissingOnItem(item, field))
      );
      const needsSupplement =
        typeof shouldSupplementResults === 'function'
          ? Boolean(shouldSupplementResults(primaryResults))
          : Number(supplementBelowCount) > 0 &&
            primaryResults.length < Number(supplementBelowCount);

      if (typeof onPartialResults === 'function') {
        onPartialResults({
          results: primaryResults,
          usedSources: [...usedSources],
          partial: fieldsNeedingFill.length > 0 || needsSupplement,
          sourceStatusHint: `Fonte: ${usedSources.join(' · ')}`,
        });
      }

      if (fieldsNeedingFill.length === 0 && !needsSupplement) {
        break;
      }

      // Continua o laço para preencher lacunas ou complementar quando houver poucos resultados
      continue;
    } else {
      // Fonte secundária consultada para preencher campos faltantes ou complementar poucos resultados
      const fieldsNeedingFill = (Array.isArray(gapFillFields) ? gapFillFields : []).filter(
        (field) => primaryResults.some((item) => isFieldMissingOnItem(item, field))
      );
      if (fieldsNeedingFill.length > 0) {
        primaryResults = mergeMissingFieldsFromFallback(
          primaryResults,
          relevantList,
          fieldsNeedingFill
        );
      }
      const needsSupplement =
        typeof shouldSupplementResults === 'function'
          ? Boolean(shouldSupplementResults(primaryResults))
          : Number(supplementBelowCount) > 0 &&
            primaryResults.length < Number(supplementBelowCount);
      if (needsSupplement) {
        const seenKeys = new Set(
          primaryResults.map((r) => `${normalizeMatchText(r?.title)}::${normalizeMatchText(r?.creator)}`)
        );
        for (const extra of relevantList) {
          const k = `${normalizeMatchText(extra?.title)}::${normalizeMatchText(extra?.creator)}`;
          if (!seenKeys.has(k)) {
            seenKeys.add(k);
            primaryResults.push(extra);
          }
        }
      }
      break;
    }
  }

  return {
    ok: primaryResults.length > 0 || usedSources.length > 0,
    results: primaryResults,
    usedSources,
    skippedSources,
    attempts,
    primarySourceId: primaryProvider?.id || null,
  };
}
