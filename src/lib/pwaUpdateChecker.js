/**
 * Verificador de atualização PWA (OMNIPRISM v2.6.0 — Fase 4).
 *
 * - Busca `/version.json` com `cache: 'no-store'` e dispara `registration.update()`.
 * - Ativa o Service Worker em espera (`SKIP_WAITING`) e recarrega SEM tocar no IndexedDB.
 */

import { APP_BUILD_VERSION } from '../config/versioning.js';

export function getCurrentAppVersionInfo() {
  try {
    if (
      typeof __OMNIPRISM_VERSION_INFO__ !== 'undefined' &&
      __OMNIPRISM_VERSION_INFO__ &&
      typeof __OMNIPRISM_VERSION_INFO__ === 'object'
    ) {
      return {
        version: String(__OMNIPRISM_VERSION_INFO__.version || APP_BUILD_VERSION),
        buildTime: String(__OMNIPRISM_VERSION_INFO__.buildTime || ''),
        commit: String(__OMNIPRISM_VERSION_INFO__.commit || ''),
      };
    }
  } catch {
    // Ambiente de testes Node sem Vite define
  }
  return {
    version: APP_BUILD_VERSION,
    buildTime: '',
    commit: '',
  };
}

function parseSemverTuple(raw = '') {
  const clean = String(raw || '').trim().replace(/^v/i, '').split('-')[0];
  const parts = clean.split('.').map((p) => Number(p));
  if (parts.length < 2 || parts.some((n) => !Number.isFinite(n))) return null;
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

export function compareSemver(a, b) {
  const ta = parseSemverTuple(a);
  const tb = parseSemverTuple(b);
  if (!ta || !tb) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (ta[i] !== tb[i]) return ta[i] > tb[i] ? 1 : -1;
  }
  return 0;
}

export function isRemoteVersionNewer(currentInfo = {}, remoteInfo = {}) {
  if (!remoteInfo || typeof remoteInfo !== 'object') return false;
  const remoteVersion = String(remoteInfo.version || '').trim();
  if (!remoteVersion) return false;

  const currVersion = String(currentInfo.version || APP_BUILD_VERSION).trim();
  const semverDiff = compareSemver(remoteVersion, currVersion);
  if (semverDiff > 0) return true;
  if (semverDiff < 0) return false;

  const currCommit = String(currentInfo.commit || '').trim();
  const remoteCommit = String(remoteInfo.commit || '').trim();
  if (currCommit && remoteCommit && currCommit !== 'dev' && remoteCommit !== 'dev' && currCommit !== remoteCommit) {
    return true;
  }

  const currTime = Date.parse(currentInfo.buildTime || '');
  const remoteTime = Date.parse(remoteInfo.buildTime || '');
  if (Number.isFinite(currTime) && Number.isFinite(remoteTime) && remoteTime > currTime + 1000) {
    return true;
  }

  return false;
}

async function resolveDefaultSwRegistration() {
  if (typeof window !== 'undefined' && window.__codiceSwRegistration) {
    return window.__codiceSwRegistration;
  }
  if (typeof navigator !== 'undefined' && navigator.serviceWorker?.getRegistration) {
    try {
      return (await navigator.serviceWorker.getRegistration()) || null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Busca `/version.json` com `cache: 'no-store'` e chama `registration.update()`.
 */
export async function checkForPwaUpdate({
  currentInfo = getCurrentAppVersionInfo(),
  fetchImpl = typeof fetch === 'function' ? fetch : null,
  getRegistration = resolveDefaultSwRegistration,
  versionUrl = '/version.json',
} = {}) {
  let registration = null;
  let hasWaitingWorker = false;

  if (typeof getRegistration === 'function') {
    try {
      registration = await getRegistration();
      if (registration && typeof registration.update === 'function') {
        await registration.update().catch(() => {});
      }
      hasWaitingWorker = Boolean(registration?.waiting);
    } catch {
      registration = null;
    }
  }

  let remoteInfo = null;
  let fetchFailed = false;
  if (typeof fetchImpl === 'function') {
    try {
      const res = await fetchImpl(versionUrl, {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (res && res.ok) {
        const json = await res.json().catch(() => null);
        if (json && typeof json === 'object' && json.version) {
          remoteInfo = {
            version: String(json.version).trim(),
            buildTime: String(json.buildTime || '').trim(),
            commit: String(json.commit || '').trim(),
          };
        }
      } else {
        fetchFailed = true;
      }
    } catch {
      fetchFailed = true;
    }
  }

  const remoteIsNewer = remoteInfo ? isRemoteVersionNewer(currentInfo, remoteInfo) : false;
  const updateAvailable = Boolean(hasWaitingWorker || remoteIsNewer);

  if (updateAvailable) {
    return {
      ok: true,
      status: 'update_available',
      updateAvailable: true,
      hasWaitingWorker,
      currentInfo,
      remoteInfo,
      message: remoteInfo?.version
        ? `Nova versão disponível (v${remoteInfo.version.replace(/^v/i, '')})`
        : 'Nova versão disponível',
    };
  }

  if (fetchFailed && !registration) {
    return {
      ok: false,
      status: 'error',
      updateAvailable: false,
      hasWaitingWorker: false,
      currentInfo,
      remoteInfo: null,
      message: 'Não foi possível verificar atualizações agora.',
    };
  }

  return {
    ok: true,
    status: 'up_to_date',
    updateAvailable: false,
    hasWaitingWorker: false,
    currentInfo,
    remoteInfo,
    message: 'App atualizado',
  };
}

/**
 * Ativa o Service Worker em espera e recarrega a página SEM tocar no IndexedDB.
 */
export async function applyPwaUpdateSafely({
  registration = null,
  applySwUpdateFn = typeof window !== 'undefined' ? window.__codiceApplySwUpdate : null,
  reloadFn = typeof window !== 'undefined' ? () => window.location.reload() : null,
} = {}) {
  if (typeof applySwUpdateFn === 'function') {
    await applySwUpdateFn();
    return { ok: true, method: 'sw_helper', touchedIndexedDb: false };
  }

  const reg = registration || (await resolveDefaultSwRegistration());
  if (reg?.waiting && typeof reg.waiting.postMessage === 'function') {
    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    if (typeof reloadFn === 'function') {
      reloadFn();
    }
    return { ok: true, method: 'skip_waiting', touchedIndexedDb: false };
  }

  if (typeof reloadFn === 'function') {
    reloadFn();
  }
  return { ok: true, method: 'reload', touchedIndexedDb: false };
}
