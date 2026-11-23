import { createClient } from '@supabase/supabase-js';

export const SUPABASE_CONFIG_STORAGE_KEY = 'omniprism_supabase_config_v1';

let cachedClient = null;
let cachedSignature = '';

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
    return { url: '', anonKey: '' };
  }
  try {
    const raw = store.getItem(SUPABASE_CONFIG_STORAGE_KEY);
    if (!raw) return { url: '', anonKey: '' };
    const parsed = JSON.parse(raw);
    const url = normalizeSupabaseUrl(parsed?.url || '');
    const anonKey = String(parsed?.anonKey || '').trim();
    if (!anonKey || isUnsafeServiceKey(anonKey)) {
      return { url, anonKey: '' };
    }
    return { url, anonKey };
  } catch {
    return { url: '', anonKey: '' };
  }
}

export function getSupabaseConfig({ storage = null } = {}) {
  const envUrl = normalizeSupabaseUrl(readViteEnv('VITE_SUPABASE_URL'));
  const rawEnvKey = readViteEnv('VITE_SUPABASE_ANON_KEY');
  const envKey = rawEnvKey && !isUnsafeServiceKey(rawEnvKey) ? rawEnvKey : '';
  const localCfg = readStoredSupabaseConfig(storage);

  const url = envUrl || localCfg.url;
  const anonKey = envKey || localCfg.anonKey;
  const source =
    envUrl && envKey
      ? 'env'
      : localCfg.url || localCfg.anonKey
        ? 'localStorage'
        : 'none';

  return {
    url,
    anonKey,
    source,
    hasEnvConfig: Boolean(envUrl && envKey),
    isConfigured: Boolean(url && anonKey),
  };
}

export function saveSupabaseConfig({ url, anonKey }, { storage = null } = {}) {
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
      error: 'Chaves privilegiadas ou secretas não podem ser usadas no cliente. Use apenas a anon/publishable key.',
    };
  }

  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (store && typeof store.setItem === 'function') {
    try {
      store.setItem(
        SUPABASE_CONFIG_STORAGE_KEY,
        JSON.stringify({ url: cleanUrl, anonKey: cleanKey })
      );
    } catch {
      return { ok: false, error: 'Não foi possível salvar a configuração no navegador.' };
    }
  }

  cachedClient = null;
  cachedSignature = '';
  return { ok: true, config: getSupabaseConfig({ storage: store }) };
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
      storageKey: 'omniprism_supabase_auth_v1',
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
}
