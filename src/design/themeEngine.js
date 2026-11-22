import { isFlagEnabled } from '../config/flags.js';
import {
  AMBIENT_TINT_SWATCHES,
  THEME_MODES,
  buildHarmonizedThemeVars,
  hexToOklch,
  normalizeThemeModeId,
  oklchToHex,
} from '../utils/themeTokens.js';

export {
  AMBIENT_TINT_SWATCHES,
  THEME_MODES,
  buildHarmonizedThemeVars,
  hexToOklch,
  normalizeThemeModeId,
  oklchToHex,
};

export const THEME_PREFS_STORAGE_KEY = 'codice_theme_prefs_v2';

export const DENSITY_OPTIONS = [
  { id: 'comfortable', label: 'Confortável' },
  { id: 'compact', label: 'Compacta' },
];

export const MOTION_OPTIONS = [
  { id: 'system', label: 'Seguir sistema' },
  { id: 'full', label: 'Completo' },
  { id: 'reduced', label: 'Reduzido' },
];

export const FONT_SCALE_OPTIONS = [
  { id: 'normal', label: 'Padrão' },
  { id: 'large', label: 'Grande' },
  { id: 'xlarge', label: 'Extra' },
];

function normalizeFontScale(value) {
  if (value === 'large' || value === 'xlarge') return value;
  return 'normal';
}

export function loadThemeEnginePrefs() {
  const defaults = {
    density: 'comfortable',
    motion: 'system',
    fontScale: 'normal',
    dyslexiaSpacing: false,
  };
  try {
    if (typeof localStorage === 'undefined') return defaults;
    const raw = localStorage.getItem(THEME_PREFS_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    return {
      density: parsed?.density === 'compact' ? 'compact' : 'comfortable',
      motion:
        parsed?.motion === 'full' || parsed?.motion === 'reduced'
          ? parsed.motion
          : 'system',
      fontScale: normalizeFontScale(parsed?.fontScale),
      dyslexiaSpacing: Boolean(parsed?.dyslexiaSpacing),
    };
  } catch {
    return defaults;
  }
}

export function saveThemeEnginePrefs(prefs) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(
      THEME_PREFS_STORAGE_KEY,
      JSON.stringify({
        density: prefs?.density === 'compact' ? 'compact' : 'comfortable',
        motion:
          prefs?.motion === 'full' || prefs?.motion === 'reduced'
            ? prefs.motion
            : 'system',
        fontScale: normalizeFontScale(prefs?.fontScale),
        dyslexiaSpacing: Boolean(prefs?.dyslexiaSpacing),
      })
    );
  } catch {
    // Silencioso
  }
}

export function resolveEffectiveMotion(motionPref = 'system') {
  if (motionPref === 'reduced') return 'reduced';
  if (motionPref === 'full') return 'full';
  if (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  ) {
    return 'reduced';
  }
  return 'full';
}

export function applyThemeEngineAttributes({
  root = typeof document !== 'undefined' ? document.documentElement : null,
  styleAttr = null,
  density = 'comfortable',
  motion = 'system',
  fontScale = 'normal',
  dyslexiaSpacing = false,
} = {}) {
  if (!root) return;
  if (styleAttr) {
    root.setAttribute('data-theme-style', styleAttr);
  } else {
    root.removeAttribute('data-theme-style');
  }
  root.setAttribute('data-density', density === 'compact' ? 'compact' : 'comfortable');
  root.setAttribute('data-motion', resolveEffectiveMotion(motion));
  root.setAttribute('data-font-scale', normalizeFontScale(fontScale));
  if (dyslexiaSpacing) {
    root.setAttribute('data-dyslexia', 'true');
  } else {
    root.removeAttribute('data-dyslexia');
  }
}

export function runWithViewTransition(updateFn, motionPref = 'system') {
  if (typeof updateFn !== 'function') return;
  const effectiveMotion = resolveEffectiveMotion(motionPref);
  const canAnimate =
    effectiveMotion !== 'reduced' &&
    isFlagEnabled('viewTransitions') &&
    typeof document !== 'undefined' &&
    typeof document.startViewTransition === 'function';

  if (canAnimate) {
    try {
      document.startViewTransition(() => {
        updateFn();
      });
      return;
    } catch {
      // Fallback direto sem transição
    }
  }
  updateFn();
}
