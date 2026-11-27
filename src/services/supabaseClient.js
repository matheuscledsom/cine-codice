import { createClient } from '@supabase/supabase-js';

export const SUPABASE_CONFIG_STORAGE_KEY = 'omniprism_supabase_config_v1';
export const SUPABASE_AUTH_STORAGE_KEY = 'omniprism_supabase_auth_v1';
export const SUPABASE_PUBLIC_CONFIG_ENDPOINT = '/api/config';

let cachedClient = null;
let cachedSignature = '';
let inflightHydrationPromise = null;

function readViteEnv(key) {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env && key in import.meta.env) {
      return String(import.meta.env[key] || '').trim();
    }
  } catch {
    // Ambiente fora do bundler Vite (ex.: node --test)
  }
  return '';
}

export function normalizeSupabaseUrl(rawUrl) {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    const isHttpLocal =
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');
    if (parsed.protocol !== 'https:' && !isHttpLocal) {
      return '';
    }
    const cleanPath = parsed.pathname
      .replace(/\/rest\/v1\/?.*$/i, '')
      .replace(/\/+$/, '');
    return `${parsed.origin}${cleanPath}`;
  } catch {
    return '';
  }
}

const PRIVILEGED_ROLE_NAME = ['service', 'role'].join('_');

export function isUnsafeServiceKey(rawKey) {
  const clean = String(rawKey || '').trim();
  if (!clean) return false;
  if (clean.toLowerCase().includes(PRIVILEGED_ROLE_NAME) || /^sb_secret_/i.test(clean)) {
    return true;
  }
  // Inspeciona payload JWT apenas para recusar chaves privilegiadas no navegador
  if (clean.split('.').length === 3 && typeof atob === 'function') {
    try {
      const payloadSegment = clean.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = payloadSegment.padEnd(Math.ceil(payloadSegment.length / 4) * 4, '=');
      const decoded = JSON.parse(atob(padded));
      if (decoded?.role === PRIVILEGED_ROLE_NAME) {
        return true;
      }
    } catch {
      // Ignora JWT opaco
    }
  }
  return false;
}

export function readStoredSupabaseConfig(storage = null) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!store || typeof store.getItem !== 'function') {
    return { url: '', anonKey: '', origin: 'none', fetchedAt: null };
  }
  try {
    const raw = store.getItem(SUPABASE_CONFIG_STORAGE_KEY);
    if (!raw) return { url: '', anonKey: '', origin: 'none', fetchedAt: null };
    const parsed = JSON.parse(raw);
    const url = normalizeSupabaseUrl(parsed?.url || '');
    const anonKey = String(parsed?.anonKey || '').trim();
    const origin = parsed?.origin === 'server' ? 'server' : 'manual';
    const fetchedAt = parsed?.fetchedAt || null;
    if (!anonKey || isUnsafeServiceKey(anonKey)) {
      return { url, anonKey: '', origin: 'none', fetchedAt: null };
    }
    return { url, anonKey, origin, fetchedAt };
  } catch {
    return { url: '', anonKey: '', origin: 'none', fetchedAt: null };
  }
}

export function getSupabaseConfig({ storage = null } = {}) {
  const envUrl = normalizeSupabaseUrl(readViteEnv('VITE_SUPABASE_URL'));
  const rawEnvKey = readViteEnv('VITE_SUPABASE_ANON_KEY');
  const envKey = rawEnvKey && !isUnsafeServiceKey(rawEnvKey) ? rawEnvKey : '';
  const localCfg = readStoredSupabaseConfig(storage);

  const url = envUrl || localCfg.url;
  const anonKey = envKey || localCfg.anonKey;
  const hasEnvConfig = Boolean(envUrl && envKey);
  const hasLocalConfig = Boolean(localCfg.url && localCfg.anonKey);
  const source = hasEnvConfig
    ? 'env'
    : hasLocalConfig
      ? localCfg.origin === 'server'
        ? 'server'
        : 'localStorage'
      : localCfg.url || localCfg.anonKey
        ? 'localStorage'
        : 'none';
  const origin = hasEnvConfig ? 'env' : hasLocalConfig ? localCfg.origin : 'none';

  return {
    url,
    anonKey,
    source,
    origin,
    fetchedAt: localCfg.fetchedAt || null,
    hasEnvConfig,
    isAutoConfigured: hasEnvConfig || origin === 'server',
    isConfigured: Boolean(url && anonKey),
  };
}

export function saveSupabaseConfig(
  { url, anonKey },
  { storage = null, origin = 'manual', fetchedAt = null } = {}
) {
  const cleanUrl = normalizeSupabaseUrl(url);
  const cleanKey = String(anonKey || '').trim();

  if (!cleanUrl) {
    return { ok: false, error: 'Informe uma URL Supabase HTTPS válida.' };
  }
  if (!cleanKey) {
    return { ok: false, error: 'Informe a chave pública (anon / publishable) do Supabase.' };
  }
  if (isUnsafeServiceKey(cleanKey)) {
    return {
      ok: false,
      error:
        'Chaves privilegiadas ou secretas não podem ser usadas no cliente. Use apenas a anon/publishable key.',
    };
  }

  const prevConfig = getSupabaseConfig({ storage });
  const changed = prevConfig.url !== cleanUrl || prevConfig.anonKey !== cleanKey;

  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (store && typeof store.setItem === 'function') {
    try {
      const payload = {
        url: cleanUrl,
        anonKey: cleanKey,
        origin: origin === 'server' ? 'server' : 'manual',
        ...(fetchedAt ? { fetchedAt } : {}),
      };
      store.setItem(SUPABASE_CONFIG_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      return { ok: false, error: 'Não foi possível salvar a configuração no navegador.' };
    }
  }

  if (changed) {
    cachedClient = null;
    cachedSignature = '';
  }
  return { ok: true, changed, config: getSupabaseConfig({ storage: store }) };
}

export function clearSupabaseConfig({ storage = null } = {}) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (store && typeof store.removeItem === 'function') {
    try {
      store.removeItem(SUPABASE_CONFIG_STORAGE_KEY);
    } catch {
      // Silencioso
    }
  }
  cachedClient = null;
  cachedSignature = '';
}

export function isSupabaseConfigured(options = {}) {
  return getSupabaseConfig(options).isConfigured;
}

/**
 * Busca `{ supabaseUrl, supabaseAnonKey }` na rota pública `/api/config` do Cloudflare Pages,
 * guarda no aparelho para uso offline e preserva qualquer override manual (salvo se `forceRefresh`).
 */
export async function hydrateSupabaseConfigFromServer({
  fetchImpl = null,
  storage = null,
  endpoint = SUPABASE_PUBLIC_CONFIG_ENDPOINT,
  forceRefresh = false,
  timeoutMs = 5000,
} = {}) {
  const current = getSupabaseConfig({ storage });
  if (current.hasEnvConfig) {
    return { ok: true, fromCache: true, changed: false, source: 'env', config: current };
  }

  if (!forceRefresh && current.isConfigured && current.origin === 'manual') {
    return {
      ok: true,
      fromCache: true,
      changed: false,
      source: 'localStorage',
      config: current,
    };
  }

  const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (isOffline) {
    return {
      ok: current.isConfigured,
      offline: true,
      fromCache: current.isConfigured,
      changed: false,
      source: current.source,
      config: current,
      error: current.isConfigured
        ? null
        : 'Sem conexão para buscar a configuração automática do servidor.',
    };
  }

  const fetcher = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!fetcher) {
    return {
      ok: current.isConfigured,
      fromCache: current.isConfigured,
      changed: false,
      source: current.source,
      config: current,
    };
  }

  const runFetch = async () => {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer =
      controller && timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
      const res = await fetcher(endpoint, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-cache',
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (!res || !res.ok) {
        let serverError = '';
        try {
          const errBody = await res?.json?.();
          serverError = String(errBody?.error || '');
        } catch {
          // Resposta não-JSON (ex.: 404 HTML no Vite dev local)
        }
        return {
          ok: current.isConfigured,
          fromCache: current.isConfigured,
          changed: false,
          source: current.source,
          status: res?.status ?? null,
          config: current,
          error:
            serverError ||
            (current.isConfigured
              ? null
              : 'Configuração automática indisponível neste ambiente.'),
        };
      }

      const data = await res.json();
      const supabaseUrl = normalizeSupabaseUrl(data?.supabaseUrl || '');
      const supabaseAnonKey = String(data?.supabaseAnonKey || '').trim();
      if (!supabaseUrl || !supabaseAnonKey || isUnsafeServiceKey(supabaseAnonKey)) {
        return {
          ok: current.isConfigured,
          fromCache: current.isConfigured,
          changed: false,
          source: current.source,
          config: current,
          error: 'O servidor retornou uma configuração Supabase inválida.',
        };
      }

      const saved = saveSupabaseConfig(
        { url: supabaseUrl, anonKey: supabaseAnonKey },
        {
          storage,
          origin: 'server',
          fetchedAt: new Date().toISOString(),
        }
      );
      if (!saved.ok) {
        return {
          ok: current.isConfigured,
          fromCache: current.isConfigured,
          changed: false,
          source: current.source,
          config: current,
          error: saved.error,
        };
      }

      return {
        ok: true,
        fromCache: false,
        changed: Boolean(saved.changed),
        source: 'server',
        config: saved.config,
      };
    } catch {
      return {
        ok: current.isConfigured,
        fromCache: current.isConfigured,
        changed: false,
        source: current.source,
        config: current,
        error: current.isConfigured
          ? null
          : 'Não foi possível contactar /api/config. Você pode usar offline ou configurar manualmente.',
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  // Deduplica chamadas simultâneas padrão no boot
  if (!fetchImpl && !storage && !forceRefresh && endpoint === SUPABASE_PUBLIC_CONFIG_ENDPOINT) {
    if (!inflightHydrationPromise) {
      inflightHydrationPromise = runFetch().finally(() => {
        inflightHydrationPromise = null;
      });
    }
    return inflightHydrationPromise;
  }

  return runFetch();
}

/**
 * Verificação rápida e síncrona se há sessão Supabase salva neste aparelho
 * (sem expor o token), usada para isolar chaves de cache de busca autenticado vs anônimo.
 */
export function hasStoredSupabaseSessionToken(storage = null) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!store || typeof store.getItem !== 'function') return false;
  try {
    const raw = store.getItem(SUPABASE_AUTH_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    const token =
      parsed?.access_token ||
      parsed?.currentSession?.access_token ||
      parsed?.session?.access_token ||
      '';
    return Boolean(String(token || '').trim());
  } catch {
    return false;
  }
}

/**
 * Solicita persistência de armazenamento ao navegador (best-effort) sem duplicar
 * refresh tokens no IndexedDB (conforme política de segurança em docs/SEGURANCA.md).
 */
export async function requestPersistentBrowserStorage() {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.storage?.persist === 'function') {
      return Boolean(await navigator.storage.persist());
    }
  } catch {
    // Best-effort
  }
  return false;
}

export function getSupabaseClient({ forceRecreate = false, storage = null } = {}) {
  const config = getSupabaseConfig({ storage });
  if (!config.isConfigured) {
    cachedClient = null;
    cachedSignature = '';
    return null;
  }

  const signature = `${config.url}::${config.anonKey}`;
  if (!forceRecreate && cachedClient && cachedSignature === signature) {
    return cachedClient;
  }

  cachedClient = createClient(config.url, config.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: SUPABASE_AUTH_STORAGE_KEY,
    },
    realtime: {
      params: {
        eventsPerSecond: 4,
      },
    },
  });
  cachedSignature = signature;
  return cachedClient;
}

export function resetSupabaseClientForTests() {
  cachedClient = null;
  cachedSignature = '';
  inflightHydrationPromise = null;
}
