/**
 * Persistência local do perfil do espectador (Cine Códice v1.2.0 · Lumière).
 * Código social legado (mural, chat 1:1, seguidores e feed comunitário) foi
 * fisicamente removido conforme a Regra R6.
 */

import { domainConfig } from '../config/domainConfig.js';

export const REALTIME_PROTOCOL = Object.freeze({
  vsn: '1.0.0',
});

export function getBackendMode() {
  return 'local';
}

export async function bootstrapBackend(initialWorkspace = {}) {
  const profile = initialWorkspace?.profile || null;
  return {
    mode: 'local',
    authenticated: false,
    user: null,
    profile,
  };
}

export async function syncActiveWorkspaceToBackend(workspace = {}) {
  try {
    if (typeof localStorage !== 'undefined' && workspace?.profile) {
      localStorage.setItem(
        domainConfig.profileStorageKey,
        JSON.stringify(workspace.profile)
      );
    }
    return { ok: true, mode: 'local' };
  } catch {
    return { ok: false, mode: 'local' };
  }
}

export async function updateActiveProfileInBackend(profile = {}) {
  try {
    if (typeof localStorage !== 'undefined' && profile) {
      localStorage.setItem(
        domainConfig.profileStorageKey,
        JSON.stringify(profile)
      );
    }
    return { ok: true, profile };
  } catch {
    return { ok: false, profile };
  }
}
