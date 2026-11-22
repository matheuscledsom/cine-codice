/**
 * Helper puro para gravação segura em localStorage com detecção explícita de erro
 * de cota/indisponibilidade (R11 — nenhuma falha silenciosa).
 */

export function isLocalStorageQuotaError(err) {
  if (!err) return false;
  const name = String(err.name || '');
  const code = Number(err.code);
  return (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    code === 22 ||
    code === 1014
  );
}

export function safeSetLocalStorageJson(
  storageKey,
  value,
  {
    storage = typeof localStorage !== 'undefined' ? localStorage : null,
    label = 'acervo',
  } = {}
) {
  const key = String(storageKey || '').trim();
  if (!key) {
    return {
      persisted: false,
      provisional: true,
      quotaExceeded: false,
      byteSize: 0,
      warning: `Chave de armazenamento ausente ao salvar ${label}.`,
    };
  }

  let serialized = '';
  try {
    serialized = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    return {
      persisted: false,
      provisional: true,
      quotaExceeded: false,
      byteSize: 0,
      warning: `Não foi possível preparar os dados de ${label} para gravação local.`,
    };
  }

  const byteSize = serialized.length * 2;
  if (!storage || typeof storage.setItem !== 'function') {
    return {
      persisted: false,
      provisional: true,
      quotaExceeded: false,
      byteSize,
      warning: `Armazenamento local (localStorage) indisponível: alterações em ${label} estão apenas provisórias em memória.`,
    };
  }

  try {
    storage.setItem(key, serialized);
    return {
      persisted: true,
      provisional: false,
      quotaExceeded: false,
      byteSize,
      warning: null,
    };
  } catch (err) {
    const quota = isLocalStorageQuotaError(err);
    return {
      persisted: false,
      provisional: true,
      quotaExceeded: quota,
      byteSize,
      warning: quota
        ? `Cota do navegador (localStorage) esgotada ao salvar ${label}: suas últimas alterações ficaram apenas em memória provisória e NÃO foram gravadas. Exporte um backup (.json) ou libere espaço.`
        : `Erro ao gravar ${label} no localStorage: suas últimas alterações estão apenas provisórias em memória e NÃO foram salvas no aparelho.`,
    };
  }
}
