import { domainConfig } from '../config/domainConfig.js';
import { formatSecondsToHms, isEpisodicWork } from '../utils/backlogHelpers.js';
import {
  GeminiError,
  callGeminiDetailed,
  parseJsonResponse,
  sanitizeGeminiKey,
} from './geminiApi.js';

const AI_RESULT_CACHE_KEY = 'cine_codice_ai_cache_v1';
const aiMemoryCache = new Map();

async function getAiCachedResult(key) {
  if (aiMemoryCache.has(key)) return aiMemoryCache.get(key);
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(AI_RESULT_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const hit = parsed?.[key] || null;
    if (hit) aiMemoryCache.set(key, hit);
    return hit;
  } catch {
    return null;
  }
}

async function saveAiCachedResult(key, value) {
  const payload = { ...value, savedAt: Date.now() };
  aiMemoryCache.set(key, payload);
  try {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(AI_RESULT_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const entries = Object.entries({ ...parsed, [key]: payload }).slice(-40);
    localStorage.setItem(AI_RESULT_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Ignora quota
  }
}

export const AI_PROVIDER_IDS = ['gemini', 'groq', 'openrouter'];

export const AI_PROVIDER_META = {
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    host: 'generativelanguage.googleapis.com',
    placeholder: 'AIza...',
    docsUrl: 'https://aistudio.google.com/apikey',
    docsLabel: 'Google AI Studio',
    storageKey: domainConfig.geminiStorageKey,
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    host: 'api.groq.com',
    placeholder: 'gsk_...',
    docsUrl: 'https://console.groq.com/keys',
    docsLabel: 'Groq Console',
    storageKey: 'codice_ai_key_groq',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    host: 'openrouter.ai',
    placeholder: 'sk-or-...',
    docsUrl: 'https://openrouter.ai/keys',
    docsLabel: 'OpenRouter Keys',
    storageKey: 'codice_ai_key_openrouter',
  },
};

// Nomes de modelo em constante única.
// Auditoria oficial (nov/2026):
// - gemini-2.0-flash-lite: DESCONTINUADO (desligado em 01/06/2026); usar gemini-2.5-flash-lite / gemini-3.1-flash-lite.
// - gemini-2.5-flash: DEPRECADO (roteamento para gemini-3.5-flash-lite em 01/12/2026).
// - gemini-2.5-flash-lite & gemini-3.5-flash-lite: ATIVOS.
// - llama-3.3-70b-versatile (Groq): ATIVO.
// - google/gemma-4-31b-it:free & openrouter/free (OpenRouter): ATIVOS.
export const AI_MODELS = {
  gemini: {
    primary: 'gemini-3.5-flash-lite',
    fallback: 'gemini-2.5-flash-lite',
    requestedPair: ['gemini-2.5-flash', 'gemini-2.0-flash-lite'],
  },
  groq: {
    primary: 'llama-3.3-70b-versatile',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
  },
  openrouter: {
    primary: 'google/gemma-4-31b-it:free',
    fallback: 'openrouter/free',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
  },
};

export const AI_MODEL_AUDIT = {
  'gemini-2.5-flash': {
    provider: 'gemini',
    status: 'deprecated',
    note: 'Deprecado no Google AI Studio; roteamento automático para gemini-3.5-flash-lite em 01/12/2026.',
    replacement: 'gemini-3.5-flash-lite',
  },
  'gemini-2.0-flash-lite': {
    provider: 'gemini',
    status: 'discontinued',
    note: 'Desligado em 01/06/2026; substituído por gemini-2.5-flash-lite e gemini-3.1-flash-lite.',
    replacement: 'gemini-3.1-flash-lite',
  },
  'gemini-2.5-flash-lite': {
    provider: 'gemini',
    status: 'active',
    note: 'Ativo na API Gemini.',
  },
  'gemini-3.5-flash-lite': {
    provider: 'gemini',
    status: 'active',
    note: 'Ativo na API Gemini.',
  },
  'llama-3.3-70b-versatile': {
    provider: 'groq',
    status: 'active',
    note: 'Ativo na API Groq.',
  },
  'google/gemma-4-31b-it:free': {
    provider: 'openrouter',
    status: 'active',
    note: 'Ativo na API OpenRouter (tier :free).',
  },
  'openrouter/free': {
    provider: 'openrouter',
    status: 'active',
    note: 'Roteador gratuito ativo no OpenRouter.',
  },
};

export const AI_PREFS_STORAGE_KEY = 'codice_ai_preferences_v1';
export const AI_PRIVACY_NOTICE_KEY = 'codice_ai_privacy_notice_v1';

const REQUEST_TIMEOUT_MS = 15000;
const BASE_RETRY_BACKOFF_MS = 600;
const RETRY_JITTER_MAX_MS = 180;
const COOLDOWN_DURATION_MS = 60 * 1000;
export const MAX_AI_INPUT_CHARS = 2000;

const AI_TASK_DEFAULTS = {
  test: { temperature: 0, maxTokens: 16 },
  classification: { temperature: 0.2, maxTokens: 220 },
  catalog: { temperature: 0.2, maxTokens: 450 },
  oracle: { temperature: 0.4, maxTokens: 380 },
  recap: { temperature: 0.35, maxTokens: 650 },
  synthesis: { temperature: 0.4, maxTokens: 700 },
};

const providerCooldowns = new Map();

export class AiProviderError extends Error {
  constructor(code, userMessage, { provider = '', status = 0, cause } = {}) {
    super(userMessage);
    this.name = 'AiProviderError';
    this.code = code;
    this.userMessage = userMessage;
    this.provider = provider;
    this.status = Number(status) || 0;
    if (cause) {
      this.cause = cause;
    }
  }
}

export function maskApiKey(apiKey) {
  const clean = sanitizeGeminiKey(apiKey);
  if (!clean) return '';
  if (clean.length <= 4) return '••••';
  return `••••${clean.slice(-4)}`;
}

function getLocalStorageSafe() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadAiKey(providerId) {
  const meta = AI_PROVIDER_META[providerId];
  if (!meta) return '';
  const ls = getLocalStorageSafe();
  if (!ls) return '';
  try {
    return sanitizeGeminiKey(ls.getItem(meta.storageKey));
  } catch {
    return '';
  }
}

export function loadAiKeys() {
  return {
    gemini: loadAiKey('gemini'),
    groq: loadAiKey('groq'),
    openrouter: loadAiKey('openrouter'),
  };
}

export function saveAiKeyForProvider(providerId, rawKey) {
  const meta = AI_PROVIDER_META[providerId];
  if (!meta) return '';
  const clean = sanitizeGeminiKey(rawKey);
  const ls = getLocalStorageSafe();
  if (!ls) return clean;
  try {
    if (clean) {
      ls.setItem(meta.storageKey, clean);
    } else {
      ls.removeItem(meta.storageKey);
    }
  } catch {
    // Ignora falha de quota local
  }
  return clean;
}

export function clearAiKeyForProvider(providerId) {
  return saveAiKeyForProvider(providerId, '');
}

export function normalizeProviderOrder(preferred = 'gemini', fallbackOrder = AI_PROVIDER_IDS) {
  const validPreferred = AI_PROVIDER_IDS.includes(preferred) ? preferred : 'gemini';
  const rawOrder = Array.isArray(fallbackOrder) ? fallbackOrder : AI_PROVIDER_IDS;
  const cleaned = [
    validPreferred,
    ...rawOrder.filter((id) => AI_PROVIDER_IDS.includes(id) && id !== validPreferred),
    ...AI_PROVIDER_IDS.filter((id) => id !== validPreferred),
  ];
  return Array.from(new Set(cleaned));
}

export function loadAiPreferences() {
  const fallback = {
    preferredProvider: 'gemini',
    fallbackOrder: [...AI_PROVIDER_IDS],
  };
  const ls = getLocalStorageSafe();
  if (!ls) return fallback;
  try {
    const raw = ls.getItem(AI_PREFS_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    const preferredProvider = AI_PROVIDER_IDS.includes(parsed?.preferredProvider)
      ? parsed.preferredProvider
      : 'gemini';
    const order = normalizeProviderOrder(preferredProvider, parsed?.fallbackOrder);
    return {
      preferredProvider,
      fallbackOrder: order,
    };
  } catch {
    return fallback;
  }
}

export function saveAiPreferences(prefs = {}) {
  const current = loadAiPreferences();
  const preferredProvider = AI_PROVIDER_IDS.includes(prefs.preferredProvider)
    ? prefs.preferredProvider
    : current.preferredProvider;
  const fallbackOrder = normalizeProviderOrder(
    preferredProvider,
    prefs.fallbackOrder || current.fallbackOrder
  );
  const next = { preferredProvider, fallbackOrder };
  const ls = getLocalStorageSafe();
  if (ls) {
    try {
      ls.setItem(AI_PREFS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignora erro de quota
    }
  }
  return next;
}

export function getActiveExternalProviderInfo(overrideKeys = null, overridePrefs = null) {
  const keys = overrideKeys ? { ...loadAiKeys(), ...overrideKeys } : loadAiKeys();
  const prefs = overridePrefs || loadAiPreferences();
  const ordered = normalizeProviderOrder(prefs.preferredProvider, prefs.fallbackOrder);
  const firstId = ordered.find((id) => Boolean(sanitizeGeminiKey(keys[id])));
  if (!firstId) return null;
  return AI_PROVIDER_META[firstId] || null;
}

export function hasSeenAiPrivacyNotice(providerId = 'any') {
  const ls = getLocalStorageSafe();
  if (!ls) return false;
  try {
    const raw = ls.getItem(AI_PRIVACY_NOTICE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return Boolean(parsed?.[providerId] || parsed?.acknowledged);
  } catch {
    return false;
  }
}

export function markAiPrivacyNoticeSeen(providerId = 'any') {
  const ls = getLocalStorageSafe();
  if (!ls) return;
  try {
    const raw = ls.getItem(AI_PRIVACY_NOTICE_KEY);
    const current = raw ? JSON.parse(raw) : {};
    const next = {
      ...(current && typeof current === 'object' ? current : {}),
      acknowledged: true,
      ...(providerId ? { [providerId]: true } : {}),
    };
    ls.setItem(AI_PRIVACY_NOTICE_KEY, JSON.stringify(next));
  } catch {
    // Ignora falha de storage
  }
}

export function isProviderInCooldown(providerId, nowMs = Date.now()) {
  const until = Number(providerCooldowns.get(providerId) || 0);
  if (until <= nowMs) {
    providerCooldowns.delete(providerId);
    return false;
  }
  return true;
}

export function getProviderCooldownRemainingMs(providerId, nowMs = Date.now()) {
  const until = Number(providerCooldowns.get(providerId) || 0);
  if (until <= nowMs) {
    providerCooldowns.delete(providerId);
    return 0;
  }
  return until - nowMs;
}

export function markProviderCooldown(
  providerId,
  durationMs = COOLDOWN_DURATION_MS,
  nowMs = Date.now()
) {
  providerCooldowns.set(providerId, nowMs + Math.max(0, Number(durationMs) || 0));
}

export function resetProviderCooldowns() {
  providerCooldowns.clear();
}

export function truncateAiText(rawText, maxChars = MAX_AI_INPUT_CHARS) {
  const clean = String(rawText || '').trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function waitWithAbort(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const abortErr = new Error('Aborted');
      abortErr.name = 'AbortError';
      reject(abortErr);
      return;
    }
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, Number(ms) || 0));
    const onAbort = () => {
      clearTimeout(timer);
      const abortErr = new Error('Aborted');
      abortErr.name = 'AbortError';
      reject(abortErr);
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS, providerId = '') {
  const { signal: parentSignal, ...fetchOptions } = options;
  const controller = new AbortController();
  let timedOut = false;

  const onParentAbort = () => controller.abort();
  if (parentSignal) {
    if (parentSignal.aborted) {
      const abortErr = new Error('Aborted');
      abortErr.name = 'AbortError';
      throw abortErr;
    }
    parentSignal.addEventListener('abort', onParentAbort, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, { ...fetchOptions, signal: controller.signal });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const label = AI_PROVIDER_META[providerId]?.label || providerId;
      if (response.status === 400 || response.status === 401 || response.status === 403) {
        throw new AiProviderError(
          'AUTH_ERROR',
          `Chave inválida ou sem permissão em ${label}. Verifique sua chave nas configurações.`,
          { provider: providerId, status: response.status }
        );
      }
      if (response.status === 429) {
        throw new AiProviderError(
          'RATE_LIMIT',
          `Limite temporário atingido em ${label} (429).`,
          { provider: providerId, status: 429 }
        );
      }
      if (response.status === 503 || response.status >= 500) {
        throw new AiProviderError(
          'SERVER_ERROR',
          `${label} temporariamente indisponível (${response.status}).`,
          { provider: providerId, status: response.status }
        );
      }
      throw new AiProviderError(
        `HTTP_${response.status}`,
        `Erro ao consultar ${label} (HTTP ${response.status}).`,
        { provider: providerId, status: response.status }
      );
    }
    return data;
  } catch (err) {
    if (err instanceof AiProviderError) throw err;
    if (err?.name === 'AbortError' && !timedOut && parentSignal?.aborted) {
      throw err;
    }
    throw new AiProviderError(
      timedOut ? 'TIMEOUT' : 'NETWORK_ERROR',
      'Falha de conexão com o provedor de IA.',
      { provider: providerId, cause: err }
    );
  } finally {
    clearTimeout(timer);
    if (parentSignal) parentSignal.removeEventListener('abort', onParentAbort);
  }
}

async function runGeminiAdapter({ apiKey, system, input, temperature, maxTokens, signal }) {
  try {
    const res = await callGeminiDetailed({
      apiKey,
      systemInstruction: system,
      prompt: input,
      temperature,
      maxOutputTokens: maxTokens,
      signal,
      fallbackModel: AI_MODELS.gemini.fallback,
    });
    return {
      text: res.text,
      provider: 'gemini',
      model: res.model,
    };
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    const status = Number(err?.status) || 0;
    const isAuth =
      err?.code === 'AUTH_INVALID' ||
      err?.code === 'BAD_REQUEST' ||
      status === 400 ||
      status === 401 ||
      status === 403;
    if (isAuth) {
      throw new AiProviderError(
        'AUTH_ERROR',
        `Chave inválida ou sem permissão em Google Gemini. Verifique sua chave nas configurações.`,
        { provider: 'gemini', status: status || 401, cause: err }
      );
    }
    if (err instanceof GeminiError) {
      const transientCode =
        status === 429 || err.code === 'RATE_LIMIT'
          ? 'RATE_LIMIT'
          : status === 503 || status >= 500 || err.code === 'SERVICE_UNAVAILABLE'
            ? 'SERVER_ERROR'
            : err.code;
      throw new AiProviderError(transientCode, err.userMessage, {
        provider: 'gemini',
        status,
        cause: err,
      });
    }
    throw err;
  }
}

async function runOpenAiCompatibleAdapter(
  providerId,
  { apiKey, model, endpoint, system, input, temperature, maxTokens, signal, extraHeaders = {} }
) {
  const cleanKey = sanitizeGeminiKey(apiKey);
  if (!cleanKey) {
    throw new AiProviderError('MISSING_KEY', 'Chave não configurada.', {
      provider: providerId,
    });
  }
  const messages = [];
  if (system) {
    messages.push({ role: 'system', content: system });
  }
  messages.push({ role: 'user', content: input });

  const data = await fetchJsonWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cleanKey}`,
        ...extraHeaders,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
      }),
      signal,
    },
    REQUEST_TIMEOUT_MS,
    providerId
  );

  const rawContent = data?.choices?.[0]?.message?.content;
  const text = Array.isArray(rawContent)
    ? rawContent.map((part) => part?.text || '').join('').trim()
    : String(rawContent || '').trim();

  if (!text) {
    throw new AiProviderError(
      'EMPTY_RESPONSE',
      'O provedor de IA retornou resposta vazia.',
      { provider: providerId }
    );
  }

  return {
    text,
    provider: providerId,
    model: data?.model || model,
  };
}

function isRetryableTransientError(err) {
  if (!err) return false;
  if (err.code === 'AUTH_ERROR') return false;
  if (err.status === 429 || err.status === 503) return true;
  if (err.status >= 500 && err.status <= 599) return true;
  return (
    err.code === 'RATE_LIMIT' ||
    err.code === 'SERVICE_UNAVAILABLE' ||
    err.code === 'SERVER_ERROR' ||
    err.code === 'TIMEOUT' ||
    err.code === 'NETWORK_ERROR'
  );
}

function shouldPauseProvider(err) {
  return (
    err?.status === 429 ||
    err?.status === 503 ||
    err?.code === 'RATE_LIMIT' ||
    err?.code === 'SERVICE_UNAVAILABLE'
  );
}

export function validateAiJsonPayload(task, parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AiProviderError(
      'PARSE_ERROR',
      'Resposta JSON fora do formato esperado.'
    );
  }
  if (task === 'oracle' && !parsed.primaryId && !parsed.headline && !parsed.reason) {
    throw new AiProviderError(
      'PARSE_ERROR',
      'Resposta do Oráculo incompleta.'
    );
  }
  return parsed;
}

export async function generate({
  task = 'catalog',
  system = '',
  input = '',
  json = false,
  signal,
  temperature,
  maxTokens,
  provider = '',
  keys: overrideKeys = null,
  preferences: overridePrefs = null,
  retryDelayMs = BASE_RETRY_BACKOFF_MS,
  jitterMaxMs = RETRY_JITTER_MAX_MS,
} = {}) {
  const defaults = AI_TASK_DEFAULTS[task] || AI_TASK_DEFAULTS.catalog;
  const resolvedTemp =
    typeof temperature === 'number' ? temperature : defaults.temperature;
  const resolvedMaxTokens =
    typeof maxTokens === 'number' ? maxTokens : defaults.maxTokens;
  const safeInput = String(input || '').trim();

  const allKeys = overrideKeys ? { ...loadAiKeys(), ...overrideKeys } : loadAiKeys();
  const prefs = overridePrefs || loadAiPreferences();
  const baseOrder = provider
    ? [provider]
    : normalizeProviderOrder(prefs.preferredProvider, prefs.fallbackOrder);

  const candidates = baseOrder.filter((id) => {
    if (!sanitizeGeminiKey(allKeys[id])) return false;
    if (!provider && isProviderInCooldown(id)) return false;
    return true;
  });

  if (candidates.length === 0) {
    throw new AiProviderError(
      'NO_PROVIDER_AVAILABLE',
      'Nenhum provedor de IA externo disponível no momento.'
    );
  }

  let lastError = null;

  for (const providerId of candidates) {
    const apiKey = sanitizeGeminiKey(allKeys[providerId]);

    const invokeProvider = async () => {
      if (providerId === 'gemini') {
        return runGeminiAdapter({
          apiKey,
          system,
          input: safeInput,
          temperature: resolvedTemp,
          maxTokens: resolvedMaxTokens,
          signal,
        });
      }
      if (providerId === 'groq') {
        return runOpenAiCompatibleAdapter('groq', {
          apiKey,
          model: AI_MODELS.groq.primary,
          endpoint: AI_MODELS.groq.endpoint,
          system,
          input: safeInput,
          temperature: resolvedTemp,
          maxTokens: resolvedMaxTokens,
          signal,
        });
      }
      const origin =
        typeof window !== 'undefined' && window.location?.origin
          ? window.location.origin
          : 'https://codice.app';
      return runOpenAiCompatibleAdapter('openrouter', {
        apiKey,
        model: AI_MODELS.openrouter.primary,
        endpoint: AI_MODELS.openrouter.endpoint,
        system,
        input: safeInput,
        temperature: resolvedTemp,
        maxTokens: resolvedMaxTokens,
        signal,
        extraHeaders: {
          'HTTP-Referer': origin,
          'X-Title': 'Projeto Codice',
        },
      });
    };

    try {
      let response;
      try {
        response = await invokeProvider();
      } catch (firstErr) {
        if (firstErr?.name === 'AbortError') throw firstErr;
        if (firstErr?.code === 'AUTH_ERROR') throw firstErr;
        if (!isRetryableTransientError(firstErr)) throw firstErr;

        const jitter = Math.floor(Math.random() * Math.max(0, jitterMaxMs));
        await waitWithAbort(retryDelayMs + jitter, signal);

        try {
          response = await invokeProvider();
        } catch (retryErr) {
          if (shouldPauseProvider(firstErr) || shouldPauseProvider(retryErr)) {
            markProviderCooldown(providerId);
          }
          throw retryErr;
        }
      }

      if (json) {
        const parsedRaw = parseJsonResponse(response.text);
        const parsed = validateAiJsonPayload(task, parsedRaw);
        return {
          ...response,
          parsed,
        };
      }
      return response;
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      if (err?.code === 'AUTH_ERROR') {
        throw err;
      }
      if (shouldPauseProvider(err)) {
        markProviderCooldown(providerId);
      }
      lastError = err;
    }
  }

  throw (
    lastError ||
    new AiProviderError(
      'ALL_PROVIDERS_FAILED',
      'Todos os provedores de IA falharam nesta tentativa.'
    )
  );
}

export async function testProviderConnection(providerId, apiKey, { signal } = {}) {
  const cleanKey = sanitizeGeminiKey(apiKey);
  const label = AI_PROVIDER_META[providerId]?.label || providerId;
  if (!cleanKey) {
    return {
      ok: false,
      provider: providerId,
      model: null,
      latencyMs: 0,
      errorMessage: `Informe uma chave de ${label} para testar.`,
    };
  }

  const startedAt = Date.now();
  try {
    const res = await generate({
      task: 'test',
      input: 'Responda apenas: OK',
      provider: providerId,
      keys: { [providerId]: cleanKey },
      retryDelayMs: 0,
      jitterMaxMs: 0,
      signal,
    });
    return {
      ok: true,
      provider: providerId,
      model: res.model,
      latencyMs: Math.max(1, Date.now() - startedAt),
      errorMessage: '',
    };
  } catch (err) {
    return {
      ok: false,
      provider: providerId,
      model: null,
      latencyMs: Math.max(1, Date.now() - startedAt),
      errorMessage:
        err?.userMessage || err?.message || `Não foi possível conectar a ${label}.`,
    };
  }
}

function hashShortString(str) {
  let h = 2166136261;
  const s = String(str || '');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(36);
}

function buildWorkCacheKey(task, item, extra = '') {
  const workKey = item?.id || item?.imdbId || item?.title || 'obra';
  const fingerprint = hashShortString(
    [
      item?.title || '',
      item?.director || item?.studio || '',
      item?.workType || 'movie',
      truncateAiText(item?.synopsis || '', MAX_AI_INPUT_CHARS),
      truncateAiText(item?.notes || '', 600),
      item?.currentSeconds || 0,
      item?.currentEpisode || 0,
      (item?.quotes || []).length,
      extra,
    ].join('|')
  );
  return `ai:${task}:${String(workKey)}:${fingerprint}`;
}

export async function runMultiSmartCataloging({ item, signal, overrideKeys } = {}) {
  const allowedAtmospheres = domainConfig.atmosphereOptions.map((a) => a.id);
  const workType = item?.workType || 'movie';
  const cacheKey = buildWorkCacheKey('catalog', item, workType);
  const cached = await getAiCachedResult(cacheKey);
  if (cached?.data) {
    return { ...cached.data, provider: cached.provider, model: cached.model, fromCache: true };
  }

  const truncatedSynopsis = truncateAiText(item?.synopsis || '', MAX_AI_INPUT_CHARS);

  const system =
    'Curador de catálogo (filmes, séries e animes). Responda apenas JSON estrito em PT-BR, sem spoilers e sem emojis.';
  const input = `Catalogar obra audiovisual em JSON:
{"synopsis":"2-3 frases sem spoilers","genres":["até 3"],"atmosphere":["1-3 de: ${allowedAtmospheres.join(', ')}"],"franchiseName":"","director":"","studio":""}
Título: ${item?.title || ''}
Direção/Estúdio: ${item?.director || item?.studio || 'N/I'} | Formato: ${workType} | Ano: ${item?.releaseYear || 'N/I'}
Sinopse: ${truncatedSynopsis || 'N/I'}`;

  const res = await generate({
    task: 'catalog',
    system,
    input,
    json: true,
    signal,
    keys: overrideKeys,
  });

  const parsed = res.parsed || {};
  const validAtmospheres = Array.isArray(parsed.atmosphere)
    ? parsed.atmosphere.filter((a) => allowedAtmospheres.includes(a))
    : [];

  const data = {
    synopsis: typeof parsed.synopsis === 'string' ? parsed.synopsis.trim() : '',
    genres: Array.isArray(parsed.genres)
      ? parsed.genres.map((g) => String(g).trim()).filter(Boolean).slice(0, 4)
      : [],
    atmosphere: validAtmospheres,
    franchiseName:
      typeof parsed.franchiseName === 'string' ? parsed.franchiseName.trim() : '',
    director:
      typeof parsed.director === 'string' ? parsed.director.trim() : '',
    studio:
      typeof parsed.studio === 'string' ? parsed.studio.trim() : '',
  };

  await saveAiCachedResult(cacheKey, {
    task: 'catalog',
    provider: res.provider,
    model: res.model,
    data,
  });

  return {
    ...data,
    provider: res.provider,
    model: res.model,
    fromCache: false,
  };
}

export async function runMultiCollectionOracle({
  mood,
  queuedItems = [],
  completedItems = [],
  favoriteGenres = [],
  viewerFocus = [],
  readerFocus = '',
  preferredCriterion = '',
  signal,
  overrideKeys,
} = {}) {
  const shelfSummary = queuedItems.slice(0, 30).map((item) => ({
    id: item.id,
    title: item.title,
    director: item.director || item.studio || 'Desconhecido',
    workType: item.workType || 'movie',
    durationMinutes: item.durationMinutes || null,
    episodes: item.totalEpisodes || null,
    genres: (item.genres || []).slice(0, 3),
    atmosphere: (item.atmosphere || []).slice(0, 2),
  }));

  const tasteHistory = completedItems
    .slice()
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
    .slice(0, 12)
    .map((item) => ({
      title: item.title,
      director: item.director || item.studio || '',
      rating: item.rating,
      genres: (item.genres || []).slice(0, 3),
    }));

  const genreLabels = (Array.isArray(favoriteGenres) ? favoriteGenres : [])
    .map((g) => (typeof g === 'string' ? g : g?.label || ''))
    .map((s) => String(s || '').trim())
    .filter(Boolean);

  const focusLabels = (Array.isArray(viewerFocus) ? viewerFocus : [])
    .map((f) => String(f || '').trim())
    .filter(Boolean);
  const focusSummary =
    focusLabels.length > 0 ? focusLabels.join(', ') : readerFocus || 'Geral';

  const system =
    'Você é o Curador de Sessões do Catálogo. Recomende exclusivamente obras presentes em Quero Ver. Responda em JSON estrito em português do Brasil.';
  const input = `Clima desejado: ${truncateAiText(mood || 'Melhor escolha da fila', 200)}
Focos do espectador: ${focusSummary} | Critério: ${preferredCriterion || 'Equilibrado'}
Gêneros favoritos: ${genreLabels.slice(0, 6).join(', ') || 'Diversos'}
Quero Ver: ${JSON.stringify(shelfSummary)}
Concluídas bem avaliadas: ${JSON.stringify(tasteHistory)}
Retorne JSON estrito:
{
  "primaryId": "id exato de Quero Ver",
  "headline": "Chamada editorial curta (máx 10 palavras)",
  "reason": "Justificativa concisa em 2 frases sem spoilers",
  "alternatives": [{ "id": "id exato", "why": "motivo curto" }]
}`;

  const res = await generate({
    task: 'oracle',
    system,
    input,
    json: true,
    signal,
    keys: overrideKeys,
  });

  const parsed = res.parsed || {};
  const validIds = new Set(queuedItems.map((i) => i.id));
  const primaryId = validIds.has(parsed.primaryId)
    ? parsed.primaryId
    : queuedItems[0]?.id || null;
  const alternatives = Array.isArray(parsed.alternatives)
    ? parsed.alternatives
        .filter((alt) => alt && validIds.has(alt.id) && alt.id !== primaryId)
        .slice(0, 2)
    : [];

  return {
    primaryId,
    headline: String(parsed.headline || 'Sessão recomendada para hoje').trim(),
    reason: String(parsed.reason || '').trim(),
    alternatives,
    provider: res.provider,
    model: res.model,
  };
}

export async function runMultiSpoilerFreeRecap({
  item,
  linkedPosts = [],
  signal,
  overrideKeys,
} = {}) {
  const cacheKey = buildWorkCacheKey('recap', item, String(linkedPosts.length));
  const cached = await getAiCachedResult(cacheKey);
  if (cached?.data?.text) {
    return {
      text: cached.data.text,
      provider: cached.provider,
      model: cached.model,
      fromCache: true,
    };
  }

  const positionLabel = isEpisodicWork(item)
    ? `Temp. ${item.currentSeason || 1}, Ep. ${item.currentEpisode || 0}${item.totalEpisodes ? ` de ${item.totalEpisodes}` : ''}`
    : `Minutagem ${formatSecondsToHms(item?.currentSeconds || 0)}${item?.totalSeconds ? ` / ${formatSecondsToHms(item.totalSeconds)}` : ''}`;

  const records = linkedPosts.slice(0, 6).map((post) => ({
    marker: post.progressMarker || '',
    title: post.title,
    caption: truncateAiText(post.caption || '', 280),
  }));
  const quotes = (item?.quotes || []).slice(0, 6).map((q) => ({
    location: q.location,
    text: truncateAiText(q.text || '', 280),
  }));

  const system =
    'Assistente de memória de sessões de cinema, séries e animes. Regra ABSOLUTA: ZERO SPOILERS além do ponto informado. Escreva em português limpo e sem emojis.';
  const input = `Gere recapitulação concisa sem spoilers:
Obra: ${item?.title || ''} (${item?.director || item?.studio || 'Direção não informada'})
Posição atual: ${positionLabel} | Cena/Checkpoint: ${item?.checkpoint || 'Não informado'}
Sinopse base: ${truncateAiText(item?.synopsis || '', MAX_AI_INPUT_CHARS) || 'Não informada'}
Notas: ${truncateAiText(item?.notes || '', 800) || 'Nenhuma'}
Diário: ${JSON.stringify(records)}
Falas salvas: ${JSON.stringify(quotes)}
Estruture em 3 tópicos: 1. Ponto de Parada, 2. Síntese até aqui, 3. Ganchos para retomar.`;

  const res = await generate({
    task: 'recap',
    system,
    input,
    json: false,
    signal,
    keys: overrideKeys,
  });

  await saveAiCachedResult(cacheKey, {
    task: 'recap',
    provider: res.provider,
    model: res.model,
    data: { text: res.text },
  });

  return {
    text: res.text,
    provider: res.provider,
    model: res.model,
    fromCache: false,
  };
}

export async function runMultiReviewOrAbstractSynthesis({
  item,
  linkedPosts = [],
  signal,
  overrideKeys,
} = {}) {
  const cacheKey = buildWorkCacheKey('synthesis', item, `${linkedPosts.length}`);
  const cached = await getAiCachedResult(cacheKey);
  if (cached?.data?.text) {
    return {
      text: cached.data.text,
      provider: cached.provider,
      model: cached.model,
      fromCache: true,
    };
  }

  const quotes = (item?.quotes || []).slice(0, 8).map((q) => ({
    location: q.location,
    text: truncateAiText(q.text || '', 300),
    note: truncateAiText(q.note || '', 200),
  }));
  const records = linkedPosts.slice(0, 6).map((post) => ({
    marker: post.progressMarker || '',
    title: post.title,
    caption: truncateAiText(post.caption || '', 280),
  }));

  const system =
    'Crítico audiovisual editorial. Escreva crítica cinematográfica elegante em português do Brasil, sem emojis.';

  const input = `Transforme falas marcantes, nota (${item?.rating ?? 'N/A'}/100) e anotações em CRÍTICA ESTRUTURADA.
Obra: ${item?.title || ''} | Direção/Estúdio: ${item?.director || item?.studio || 'Não informado'} | Ano: ${item?.releaseYear || 'N/A'}
Sinopse: ${truncateAiText(item?.synopsis || '', MAX_AI_INPUT_CHARS) || 'Não informada'}
Notas pessoais: ${truncateAiText(item?.notes || '', 800) || 'Nenhuma'}
Falas marcantes: ${JSON.stringify(quotes)}
Diário: ${JSON.stringify(records)}`;

  const res = await generate({
    task: 'synthesis',
    system,
    input,
    json: false,
    signal,
    keys: overrideKeys,
  });

  await saveAiCachedResult(cacheKey, {
    task: 'synthesis',
    provider: res.provider,
    model: res.model,
    data: { text: res.text },
  });

  return {
    text: res.text,
    provider: res.provider,
    model: res.model,
    fromCache: false,
  };
}
