/**
 * Registro local dos últimos 50 erros do aplicativo (100% local, zero telemetria).
 * Usado pelo Error Boundary global e pela tela Configurações > Diagnóstico.
 */

export const ERROR_LOG_STORAGE_KEY = 'omniprism_local_error_log_v1';
export const MAX_LOCAL_ERROR_ENTRIES = 50;

const SECRET_PATTERNS = [
  /api[_-]?key=[^&\s]+/gi,
  /apikey=[^&\s]+/gi,
  /Bearer\s+[A-Za-z0-9._-]+/gi,
  /sk-[A-Za-z0-9]{12,}/g,
  /AIza[0-9A-Za-z_-]{20,}/g,
];

let memoryErrorLog = [];

export function sanitizeErrorMessage(rawText) {
  let clean = String(rawText || '').trim();
  for (const rx of SECRET_PATTERNS) {
    clean = clean.replace(rx, '[REDACTED]');
  }
  return clean.slice(0, 320);
}

function readStorageEntries(storage) {
  if (!storage || typeof storage.getItem !== 'function') {
    return [...memoryErrorLog];
  }
  try {
    const raw = storage.getItem(ERROR_LOG_STORAGE_KEY);
    if (!raw) return [...memoryErrorLog];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [...memoryErrorLog];
  } catch {
    return [...memoryErrorLog];
  }
}

function writeStorageEntries(entries, storage) {
  const trimmed = entries.slice(-MAX_LOCAL_ERROR_ENTRIES);
  memoryErrorLog = trimmed;
  if (!storage || typeof storage.setItem !== 'function') return;
  try {
    storage.setItem(ERROR_LOG_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Quota cheia: mantém apenas em memória sem lançar erro
  }
}

export function recordLocalError(
  errorOrMessage,
  {
    source = 'runtime',
    screen = '',
    storage = typeof localStorage !== 'undefined' ? localStorage : null,
  } = {}
) {
  const message =
    errorOrMessage instanceof Error
      ? errorOrMessage.message || errorOrMessage.name
      : typeof errorOrMessage === 'string'
        ? errorOrMessage
        : errorOrMessage?.message || 'Erro desconhecido';
  const stackRaw =
    errorOrMessage instanceof Error && errorOrMessage.stack
      ? String(errorOrMessage.stack).split('\n').slice(0, 4).join(' | ')
      : '';

  const entry = {
    id: `err_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    source: String(source || 'runtime').slice(0, 40),
    screen: String(screen || '').slice(0, 60),
    message: sanitizeErrorMessage(message),
    stack: sanitizeErrorMessage(stackRaw),
  };

  const current = readStorageEntries(storage);
  const next = [...current, entry].slice(-MAX_LOCAL_ERROR_ENTRIES);
  writeStorageEntries(next, storage);
  return entry;
}

export function getLocalErrorLog({
  storage = typeof localStorage !== 'undefined' ? localStorage : null,
} = {}) {
  return readStorageEntries(storage).slice(-MAX_LOCAL_ERROR_ENTRIES).reverse();
}

export function clearLocalErrorLog({
  storage = typeof localStorage !== 'undefined' ? localStorage : null,
} = {}) {
  memoryErrorLog = [];
  if (storage && typeof storage.removeItem === 'function') {
    try {
      storage.removeItem(ERROR_LOG_STORAGE_KEY);
    } catch {
      // Silencioso
    }
  }
}

export function formatLocalErrorLogForCopy(entries = getLocalErrorLog()) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return 'Nenhum erro local registrado.';
  }
  return entries
    .map((e) => {
      const scope = e.screen ? `${e.source}:${e.screen}` : e.source;
      return `[${e.timestamp}] (${scope}) ${e.message}${e.stack ? ` — ${e.stack}` : ''}`;
    })
    .join('\n');
}

export function installGlobalErrorListeners() {
  if (typeof window === 'undefined' || window.__omniprismErrorListenersInstalled) {
    return;
  }
  window.__omniprismErrorListenersInstalled = true;

  window.addEventListener('error', (event) => {
    const err = event?.error || event?.message || 'Erro de execução';
    recordLocalError(err, { source: 'window.error' });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event?.reason || 'Promise rejeitada sem tratamento';
    recordLocalError(reason, { source: 'unhandledrejection' });
  });
}
