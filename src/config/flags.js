export const FLAGS_STORAGE_KEY = 'codice_flags';

/**
 * Decisão v1.1.0 (Fase 6): recursos sociais herdados ficam ocultos sem apagar dados locais.
 */
export const SOCIAL_ENABLED = false;

export const DEFAULT_FLAGS = {
  spineShelf: true,
  viewTransitions: true,
  generatedCovers: true,
  dominantColorExtract: true,
  indexWorker: true,
  calmMode: false,
  hapticFeedback: false,
  soundEffects: false,
  perfOverlay: false,
};

export function loadFeatureFlags() {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_FLAGS };
    const raw = localStorage.getItem(FLAGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_FLAGS };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_FLAGS };
    const merged = { ...DEFAULT_FLAGS };
    Object.keys(DEFAULT_FLAGS).forEach((key) => {
      if (typeof parsed[key] === 'boolean') {
        merged[key] = parsed[key];
      }
    });
    return merged;
  } catch {
    return { ...DEFAULT_FLAGS };
  }
}

export function isFlagEnabled(flagName) {
  const flags = loadFeatureFlags();
  return Boolean(flags[flagName]);
}

export function setFeatureFlag(flagName, enabled) {
  if (!(flagName in DEFAULT_FLAGS)) return loadFeatureFlags();
  const next = {
    ...loadFeatureFlags(),
    [flagName]: Boolean(enabled),
  };
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(FLAGS_STORAGE_KEY, JSON.stringify(next));
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('codice:flags-changed', { detail: next }));
      }
    }
  } catch {
    // Silencioso em quota restrita
  }
  return next;
}

export function resetFeatureFlags() {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(FLAGS_STORAGE_KEY);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('codice:flags-changed', { detail: { ...DEFAULT_FLAGS } })
        );
      }
    }
  } catch {
    // Silencioso
  }
  return { ...DEFAULT_FLAGS };
}
