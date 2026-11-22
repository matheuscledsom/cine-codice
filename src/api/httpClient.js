/**
 * Cliente HTTP resiliente com fila por provedor, rate-limiting conservador,
 * leitura de X-RateLimit-* e Retry-After (429), retry com backoff,
 * timeout de 8s via AbortController, deduplicação in-flight e cota diária OMDb (D4).
 *
 * Módulo puro em .js sem dependência de React ou DOM (D7).
 */

import {
  API_TIMEOUT_MS,
  DEFAULT_MAX_RETRIES,
  MAX_RETRY_AFTER_MS,
  OMDB_DAILY_COUNTER_STORAGE_KEY,
  PROVIDER_LIMITS,
  RETRY_BASE_DELAY_MS,
} from './limits.js';

export class ApiQuotaError extends Error {
  constructor(message, code = 'OMDB_AUTO_QUOTA_REACHED', usage = null) {
    super(message);
    this.name = 'ApiQuotaError';
    this.code = code;
    this.usage = usage;
  }
}

export class ApiRateLimitError extends Error {
  constructor(message, { status = 429, retryAfterMs = null, provider = '' } = {}) {
    super(message);
    this.name = 'ApiRateLimitError';
    this.code = 'HTTP_429';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.provider = provider;
  }
}

export class ApiTimeoutError extends Error {
  constructor(message = 'Tempo limite de 8s excedido na consulta à API.', provider = '') {
    super(message);
    this.name = 'TimeoutError';
    this.code = 'API_TIMEOUT';
    this.provider = provider;
  }
}

const providerStates = new Map();
const inflightRequests = new Map();
const memoryOmdbCounter = { date: '', count: 0 };

function defaultSleep(ms) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getLocalDateKey(nowMs = Date.now()) {
  const d = new Date(nowMs);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function resolveStorage(customStorage = null) {
  if (customStorage) return customStorage;
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    // Sem acesso a localStorage
  }
  return null;
}

export function getOmdbDailyUsage({ nowFn = Date.now, storage = null } = {}) {
  const today = getLocalDateKey(nowFn());
  const limit = PROVIDER_LIMITS.omdb.dailyLimit;
  const autoLimit = Math.floor(limit * PROVIDER_LIMITS.omdb.autoStopRatio);
  const store = resolveStorage(storage);

  if (store) {
    try {
      const raw = store.getItem(OMDB_DAILY_COUNTER_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.date === today) {
          const count = Math.max(0, Math.round(Number(parsed.count) || 0));
          return {
            date: today,
            count,
            limit,
            autoLimit,
            autoStopped: count >= autoLimit,
            exhausted: count >= limit,
          };
        }
      }
    } catch {
      // Fallback em memória
    }
  }

  const count = memoryOmdbCounter.date === today ? memoryOmdbCounter.count : 0;
  return {
    date: today,
    count,
    limit,
    autoLimit,
    autoStopped: count >= autoLimit,
    exhausted: count >= limit,
  };
}

function persistOmdbDailyCount(today, count, storage = null) {
  memoryOmdbCounter.date = today;
  memoryOmdbCounter.count = count;
  const store = resolveStorage(storage);
  if (store) {
    try {
      store.setItem(
        OMDB_DAILY_COUNTER_STORAGE_KEY,
        JSON.stringify({ date: today, count })
      );
    } catch {
      // Silencioso em falha de quota
    }
  }
}

export function incrementOmdbDailyUsage({ nowFn = Date.now, storage = null } = {}) {
  const current = getOmdbDailyUsage({ nowFn, storage });
  const nextCount = current.count + 1;
  persistOmdbDailyCount(current.date, nextCount, storage);
  return {
    ...current,
    count: nextCount,
    autoStopped: nextCount >= current.autoLimit,
    exhausted: nextCount >= current.limit,
  };
}

export function setOmdbDailyUsageForTests(
  count,
  { nowFn = Date.now, storage = null } = {}
) {
  const today = getLocalDateKey(nowFn());
  const clean = Math.max(0, Math.round(Number(count) || 0));
  persistOmdbDailyCount(today, clean, storage);
  return getOmdbDailyUsage({ nowFn, storage });
}

export function resetApiClientStateForTests({ storage = null } = {}) {
  providerStates.clear();
  inflightRequests.clear();
  memoryOmdbCounter.date = '';
  memoryOmdbCounter.count = 0;
  const store = resolveStorage(storage);
  if (store) {
    try {
      store.removeItem(OMDB_DAILY_COUNTER_STORAGE_KEY);
    } catch {
      // Silencioso
    }
  }
}

function getProviderState(providerId) {
  if (!providerStates.has(providerId)) {
    providerStates.set(providerId, {
      queueTail: Promise.resolve(),
      timestamps: [],
      lastStartAt: 0,
      cooldownUntil: 0,
      rateRemaining: null,
      rateResetAt: 0,
    });
  }
  return providerStates.get(providerId);
}

export function getResponseHeader(res, name) {
  if (!res?.headers) return null;
  if (typeof res.headers.get === 'function') {
    return res.headers.get(name) ?? res.headers.get(name.toLowerCase()) ?? null;
  }
  const lower = String(name || '').toLowerCase();
  for (const [k, v] of Object.entries(res.headers)) {
    if (String(k).toLowerCase() === lower) return v;
  }
  return null;
}

export function parseRetryAfterMs(headerValue, nowMs = Date.now()) {
  if (headerValue === null || headerValue === undefined || headerValue === '') {
    return null;
  }
  const str = String(headerValue).trim();
  if (/^\d+(\.\d+)?$/.test(str)) {
    const ms = Math.round(Number(str) * 1000);
    return Math.max(0, Math.min(MAX_RETRY_AFTER_MS, ms));
  }
  const parsedDate = Date.parse(str);
  if (!Number.isNaN(parsedDate)) {
    const diff = Math.max(0, parsedDate - nowMs);
    return Math.min(MAX_RETRY_AFTER_MS, diff);
  }
  return null;
}

function updateRateLimitFromHeaders(state, cfg, res, nowMs) {
  if (!cfg?.respectRateLimitHeaders || !res?.headers) return;

  const remRaw = getResponseHeader(res, 'x-ratelimit-remaining');
  const resetRaw = getResponseHeader(res, 'x-ratelimit-reset');

  const remaining = remRaw !== null && remRaw !== '' ? Number(remRaw) : null;
  const resetNum = resetRaw !== null && resetRaw !== '' ? Number(resetRaw) : null;

  if (remaining !== null && Number.isFinite(remaining)) {
    state.rateRemaining = remaining;
  }

  let resetAtMs = 0;
  if (resetNum !== null && Number.isFinite(resetNum) && resetNum > 0) {
    resetAtMs = resetNum > 1_000_000_000 ? resetNum * 1000 : nowMs + resetNum * 1000;
    state.rateResetAt = resetAtMs;
  }

  if (remaining !== null && remaining <= 1) {
    const waitTarget =
      resetAtMs > nowMs
        ? Math.min(nowMs + MAX_RETRY_AFTER_MS, resetAtMs)
        : nowMs + (cfg.windowMs || 60_000);
    state.cooldownUntil = Math.max(state.cooldownUntil, waitTarget);
  }
}

function computeProviderWaitMs(state, cfg, nowMs) {
  let waitMs = 0;

  if (state.cooldownUntil > nowMs) {
    waitMs = Math.max(waitMs, state.cooldownUntil - nowMs);
  }

  if (cfg.minIntervalMs > 0 && state.lastStartAt > 0) {
    const nextMin = state.lastStartAt + cfg.minIntervalMs;
    if (nextMin > nowMs) {
      waitMs = Math.max(waitMs, nextMin - nowMs);
    }
  }

  const maxWindow = Math.max(cfg.windowMs || 0, cfg.secWindowMs || 0, 60_000);
  state.timestamps = state.timestamps.filter((t) => nowMs - t < maxWindow);

  if (cfg.maxRequests && cfg.windowMs) {
    const inWin = state.timestamps.filter((t) => nowMs - t < cfg.windowMs);
    if (inWin.length >= cfg.maxRequests) {
      const releaseAt = inWin[0] + cfg.windowMs + 5;
      waitMs = Math.max(waitMs, releaseAt - nowMs);
    }
  }

  if (cfg.maxRequestsPerSec && cfg.secWindowMs) {
    const inSec = state.timestamps.filter((t) => nowMs - t < cfg.secWindowMs);
    if (inSec.length >= cfg.maxRequestsPerSec) {
      const releaseAt = inSec[0] + cfg.secWindowMs + 5;
      waitMs = Math.max(waitMs, releaseAt - nowMs);
    }
  }

  return Math.max(0, Math.ceil(waitMs));
}

function enqueueOnProvider(providerId, taskFn, { nowFn = Date.now, sleepFn = defaultSleep } = {}) {
  const cfg = PROVIDER_LIMITS[providerId] || {
    id: providerId,
    maxRequests: 20,
    windowMs: 10_000,
    minIntervalMs: 100,
  };
  const state = getProviderState(providerId);

  const runPromise = state.queueTail.then(async () => {
    let safety = 0;
    while (safety < 32) {
      safety += 1;
      const now = nowFn();
      const waitMs = computeProviderWaitMs(state, cfg, now);
      if (waitMs <= 0) break;
      await sleepFn(waitMs);
    }
    const execTime = nowFn();
    state.lastStartAt = execTime;
    state.timestamps.push(execTime);
    return taskFn();
  });

  state.queueTail = runPromise.catch(() => {});
  return runPromise;
}

const SECRET_QUERY_PARAM_RE = /^(api_key|apikey|access_token|token)$/i;

export function extractSecretParamsFromUrl(rawUrl) {
  const secrets = [];
  const str = String(rawUrl || '');
  if (!str) return secrets;
  try {
    const parsed = new URL(str, 'https://local.invalid');
    for (const [k, v] of parsed.searchParams.entries()) {
      if (SECRET_QUERY_PARAM_RE.test(k) && v) {
        secrets.push(v);
      }
    }
  } catch {
    const matches = str.matchAll(/(?:^|[?&])(?:api_?key|access_token|token)=([^&\s]+)/gi);
    for (const m of matches) {
      if (m[1]) {
        try {
          secrets.push(decodeURIComponent(m[1]));
        } catch {
          secrets.push(m[1]);
        }
      }
    }
  }
  return Array.from(new Set(secrets.filter((s) => s.length >= 3)));
}

export function stripApiKeysFromUrl(rawUrl) {
  const str = String(rawUrl || '').trim();
  if (!str) return '';
  if (!/[?&](?:api_?key|access_token|token)=/i.test(str)) {
    return str;
  }
  try {
    const isAbsolute = /^https?:\/\//i.test(str);
    const parsed = new URL(str, 'https://local.invalid');
    const toDelete = [];
    for (const k of parsed.searchParams.keys()) {
      if (SECRET_QUERY_PARAM_RE.test(k)) {
        toDelete.push(k);
      }
    }
    toDelete.forEach((k) => parsed.searchParams.delete(k));
    if (isAbsolute) return parsed.toString();
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return str
      .replace(/([?&])(api_?key|access_token|token)=[^&#]*/gi, '$1')
      .replace(/[?&]+$/, '')
      .replace(/\?&/, '?');
  }
}

export function maskSecretsInText(rawText, explicitSecrets = []) {
  let out = String(rawText ?? '');
  if (!out) return out;
  out = out.replace(/((?:api_?key|apikey|access_token)=)([^&\s'"]+)/gi, '$1****');
  out = out.replace(/(Bearer\s+)([A-Za-z0-9._-]+)/gi, '$1****');
  for (const secret of Array.isArray(explicitSecrets) ? explicitSecrets : []) {
    const s = String(secret || '').trim();
    if (s.length >= 3) {
      out = out.split(s).join('****');
      const encoded = encodeURIComponent(s);
      if (encoded !== s) {
        out = out.split(encoded).join('****');
      }
    }
  }
  return out;
}

function sanitizeThrownError(err, url, explicitSecrets = []) {
  if (!err || typeof err !== 'object') {
    return new Error(maskSecretsInText(String(err || 'Erro de rede'), explicitSecrets));
  }
  const urlSecrets = extractSecretParamsFromUrl(url);
  const allSecrets = [...urlSecrets, ...(Array.isArray(explicitSecrets) ? explicitSecrets : [])];
  const maskedMsg = maskSecretsInText(err.message || '', allSecrets);
  if (maskedMsg === err.message) return err;
  const safeErr = new Error(maskedMsg);
  safeErr.name = err.name || 'Error';
  if (err.code !== undefined) safeErr.code = err.code;
  if (err.status !== undefined) safeErr.status = err.status;
  return safeErr;
}

function makeAbortError(reason = 'Requisição cancelada.') {
  const err = new Error(typeof reason === 'string' ? reason : 'Requisição cancelada.');
  err.name = 'AbortError';
  return err;
}

function cloneResponseSafe(res) {
  if (res && typeof res.clone === 'function') {
    try {
      return res.clone();
    } catch {
      return res;
    }
  }
  return res;
}

function buildDefaultDedupKey(provider, method, url, body) {
  const safeUrl = stripApiKeysFromUrl(url);
  const bodyStr = typeof body === 'string' ? body : body ? JSON.stringify(body) : '';
  return `${provider}:${String(method || 'GET').toUpperCase()}:${safeUrl}:${bodyStr}`;
}

async function fetchSingleAttempt(
  url,
  fetchOptions,
  {
    provider,
    timeoutMs = API_TIMEOUT_MS,
    fetchImpl = fetch,
    sharedSignal = null,
    mode = 'auto',
    nowFn = Date.now,
    storage = null,
  }
) {
  if (sharedSignal?.aborted) {
    throw makeAbortError();
  }

  if (provider === 'omdb') {
    const usage = getOmdbDailyUsage({ nowFn, storage });
    if (mode === 'auto' && usage.autoStopped) {
      throw new ApiQuotaError(
        `Limite automático da OMDb atingido (${usage.count}/${usage.limit} chamadas hoje).`,
        'OMDB_AUTO_QUOTA_REACHED',
        usage
      );
    }
    if (usage.exhausted) {
      throw new ApiQuotaError(
        `Cota diária da OMDb esgotada (${usage.count}/${usage.limit}).`,
        'OMDB_DAILY_LIMIT_REACHED',
        usage
      );
    }
  }

  const attemptController = new AbortController();
  let timedOut = false;
  const onParentAbort = () => attemptController.abort();

  if (sharedSignal) {
    sharedSignal.addEventListener('abort', onParentAbort, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    attemptController.abort();
  }, Math.max(50, Number(timeoutMs) || API_TIMEOUT_MS));

  try {
    if (provider === 'omdb') {
      incrementOmdbDailyUsage({ nowFn, storage });
    }
    const res = await fetchImpl(url, {
      ...fetchOptions,
      signal: attemptController.signal,
    });
    const state = getProviderState(provider);
    const cfg = PROVIDER_LIMITS[provider];
    updateRateLimitFromHeaders(state, cfg, res, nowFn());
    return res;
  } catch (err) {
    if (timedOut && !sharedSignal?.aborted) {
      throw new ApiTimeoutError(
        `Tempo limite de ${Math.round((Number(timeoutMs) || API_TIMEOUT_MS) / 1000)}s excedido (${provider}).`,
        provider
      );
    }
    if (sharedSignal?.aborted) {
      throw makeAbortError();
    }
    throw sanitizeThrownError(err, url);
  } finally {
    clearTimeout(timer);
    if (sharedSignal) {
      sharedSignal.removeEventListener('abort', onParentAbort);
    }
  }
}

/**
 * Executa uma requisição HTTP gerenciada por fila, deduplicação, rate-limit e retry (D4).
 * Por padrão retorna a `Response` (ou lança em erro de rede / timeout / cota / 429 após retries).
 */
export async function apiRequest(
  url,
  {
    provider = 'generic',
    method = 'GET',
    headers = undefined,
    body = undefined,
    timeoutMs = API_TIMEOUT_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    retryBaseDelayMs = RETRY_BASE_DELAY_MS,
    dedup = true,
    dedupKey = null,
    mode = 'auto',
    signal = undefined,
    fetchImpl = fetch,
    nowFn = Date.now,
    sleepFn = defaultSleep,
    storage = null,
  } = {}
) {
  if (signal?.aborted) {
    throw makeAbortError();
  }

  if (provider === 'omdb') {
    const usage = getOmdbDailyUsage({ nowFn, storage });
    if (mode === 'auto' && usage.autoStopped) {
      throw new ApiQuotaError(
        `Limite automático da OMDb atingido (${usage.count}/${usage.limit} chamadas hoje).`,
        'OMDB_AUTO_QUOTA_REACHED',
        usage
      );
    }
    if (usage.exhausted) {
      throw new ApiQuotaError(
        `Cota diária da OMDb esgotada (${usage.count}/${usage.limit}).`,
        'OMDB_DAILY_LIMIT_REACHED',
        usage
      );
    }
  }

  const key = dedup
    ? stripApiKeysFromUrl(dedupKey || buildDefaultDedupKey(provider, method, url, body))
    : null;

  let entry = key ? inflightRequests.get(key) : null;
  if (!entry) {
    const sharedController = new AbortController();
    const fetchOptions = {
      method,
      ...(headers ? { headers } : {}),
      ...(body !== undefined ? { body } : {}),
    };

    const run = (async () => {
      let attempt = 0;
      while (true) {
        try {
          const res = await enqueueOnProvider(
            provider,
            () =>
              fetchSingleAttempt(url, fetchOptions, {
                provider,
                timeoutMs,
                fetchImpl,
                sharedSignal: sharedController.signal,
                mode,
                nowFn,
                storage,
              }),
            { nowFn, sleepFn }
          );

          if (res?.status === 429) {
            const retryAfterHeader = getResponseHeader(res, 'retry-after');
            const retryAfterMs = parseRetryAfterMs(retryAfterHeader, nowFn());
            const waitMs =
              retryAfterMs !== null
                ? retryAfterMs
                : Math.min(MAX_RETRY_AFTER_MS, retryBaseDelayMs * 2 ** attempt);

            const state = getProviderState(provider);
            state.cooldownUntil = Math.max(state.cooldownUntil, nowFn() + waitMs);

            if (attempt < maxRetries && !sharedController.signal.aborted) {
              attempt += 1;
              await sleepFn(waitMs);
              continue;
            }
            throw new ApiRateLimitError(
              `Limite de requisições atingido em ${provider} (HTTP 429).`,
              { status: 429, retryAfterMs: waitMs, provider }
            );
          }

          if (
            res &&
            res.status >= 500 &&
            res.status <= 504 &&
            attempt < maxRetries &&
            !sharedController.signal.aborted
          ) {
            attempt += 1;
            const waitMs = Math.min(MAX_RETRY_AFTER_MS, retryBaseDelayMs * 2 ** (attempt - 1));
            await sleepFn(waitMs);
            continue;
          }

          return res;
        } catch (err) {
          if (
            err instanceof ApiQuotaError ||
            err instanceof ApiRateLimitError ||
            err?.name === 'AbortError' ||
            sharedController.signal.aborted
          ) {
            throw err;
          }

          if (attempt < maxRetries) {
            attempt += 1;
            const waitMs = Math.min(MAX_RETRY_AFTER_MS, retryBaseDelayMs * 2 ** (attempt - 1));
            await sleepFn(waitMs);
            continue;
          }

          throw err;
        }
      }
    })();

    entry = {
      promise: run,
      subscribers: 0,
      controller: sharedController,
    };

    if (key) {
      inflightRequests.set(key, entry);
      run.finally(() => {
        if (inflightRequests.get(key) === entry) {
          inflightRequests.delete(key);
        }
      }).catch(() => {});
    }
  }

  entry.subscribers += 1;

  if (!signal) {
    try {
      const res = await entry.promise;
      return cloneResponseSafe(res);
    } finally {
      entry.subscribers = Math.max(0, entry.subscribers - 1);
    }
  }

  return await new Promise((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      entry.subscribers = Math.max(0, entry.subscribers - 1);
      if (entry.subscribers === 0) {
        entry.controller.abort();
      }
      reject(makeAbortError());
    };

    signal.addEventListener('abort', onAbort, { once: true });

    entry.promise.then(
      (res) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        entry.subscribers = Math.max(0, entry.subscribers - 1);
        resolve(cloneResponseSafe(res));
      },
      (err) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        entry.subscribers = Math.max(0, entry.subscribers - 1);
        reject(err);
      }
    );
  });
}

export async function apiRequestJson(url, options = {}) {
  const res = await apiRequest(url, options);
  if (!res.ok) {
    const httpErr = new Error(`${options.provider || 'API'} HTTP ${res.status}`);
    httpErr.status = res.status;
    throw httpErr;
  }
  return res.json();
}

/**
 * Executa uma lista de fábricas assíncronas limitando estritamente a concorrência simultânea
 * (por padrão no máx. 2 requisições em voo, conforme D4 / Fase 3).
 */
export async function runBoundedConcurrency(taskFns = [], maxConcurrency = 2) {
  const list = Array.isArray(taskFns) ? taskFns : [];
  if (list.length === 0) return [];
  const cap = Math.max(1, Number(maxConcurrency) || 2);
  const results = new Array(list.length);
  let cursor = 0;

  const worker = async () => {
    while (cursor < list.length) {
      const idx = cursor;
      cursor += 1;
      const fn = list[idx];
      if (typeof fn !== 'function') {
        results[idx] = undefined;
        continue;
      }
      results[idx] = await fn();
    }
  };

  const workers = Array.from({ length: Math.min(cap, list.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
