import { useEffect, useState } from 'react';
import {
  DENSITY_OPTIONS,
  MOTION_OPTIONS,
  applyThemeEngineAttributes,
  loadThemeEnginePrefs,
  runWithViewTransition,
  saveThemeEnginePrefs,
} from '../design/themeEngine';
import {
  EDITORIAL_PRESETS,
  FONT_PRESETS,
  TEXTURE_OPTIONS,
  THEME_MODES,
  buildSurfaceVarsFromBg,
  getContrastForAccent,
  normalizeHex,
} from '../utils/themeTokens';
import {
  DEFAULT_THEME_STATE,
  PASTEL_SUBPALETTES,
  SPECIAL_THEMES,
  THEME_STORAGE_KEY,
  parseThemeStorage,
  resolveSpecialThemeConfig,
} from '../data/themePresets';

export {
  DENSITY_OPTIONS,
  EDITORIAL_PRESETS,
  FONT_PRESETS,
  MOTION_OPTIONS,
  PASTEL_SUBPALETTES,
  SPECIAL_THEMES,
  TEXTURE_OPTIONS,
  THEME_MODES,
};

const SPECIAL_EXTRA_VARS = [
  '--pastel-base',
  '--pastel-card-1',
  '--pastel-card-2',
  '--pastel-card-3',
  '--pastel-card-4',
  '--pastel-card-5',
  '--pastel-pill-bg',
  '--pastel-pill-active',
  '--xp-header-blue',
  '--xp-header-highlight',
  '--xp-confirm-green',
  '--xp-confirm-deep',
  '--win7-glass',
  '--win7-glass-elevated',
  '--aero-cyan',
  '--aero-green',
  '--aero-green-deep',
];

function loadSavedTheme() {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    return parseThemeStorage(raw);
  } catch {
    return DEFAULT_THEME_STATE;
  }
}

export function useTheme() {
  const [theme, setTheme] = useState(loadSavedTheme);
  const [enginePrefs, setEnginePrefs] = useState(loadThemeEnginePrefs);

  const modeConfig =
    THEME_MODES.find((m) => m.id === theme.mode) ?? THEME_MODES[2];
  const fontConfig =
    FONT_PRESETS.find((f) => f.id === theme.font) ?? FONT_PRESETS[5] ?? FONT_PRESETS[0];

  const specialConfig = theme.specialThemeId
    ? resolveSpecialThemeConfig(
        theme.specialThemeId,
        theme.pastelSubpaletteId,
        theme.pastelCustomColor
      )
    : null;

  const surface = specialConfig
    ? { isLight: specialConfig.isLight, vars: specialConfig.vars }
    : theme.customBgColor
      ? buildSurfaceVarsFromBg(theme.customBgColor, theme.customCardColor)
      : { isLight: modeConfig.isLight, vars: modeConfig.vars };

  const activeBgColor = surface.vars['--bg-app'];
  const activeAccentColor = specialConfig
    ? specialConfig.accentColor
    : normalizeHex(theme.customAccentColor) || '#8B5CF6';
  const accentContrast = specialConfig
    ? specialConfig.accentContrast
    : getContrastForAccent(activeAccentColor);

  useEffect(() => {
    const root = document.documentElement;
    SPECIAL_EXTRA_VARS.forEach((prop) => {
      if (!(prop in surface.vars)) {
        root.style.removeProperty(prop);
      }
    });

    Object.entries(surface.vars).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });

    applyThemeEngineAttributes({
      root,
      styleAttr: specialConfig?.styleAttr || null,
      density: enginePrefs.density,
      motion: enginePrefs.motion,
      fontScale: enginePrefs.fontScale,
      dyslexiaSpacing: enginePrefs.dyslexiaSpacing,
    });

    root.style.setProperty('--accent-color', activeAccentColor);
    root.style.setProperty('--accent-contrast', accentContrast);
    root.style.setProperty('--font-app', fontConfig.cssValue);
    root.classList.toggle('dark', !surface.isLight);

    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', activeBgColor);
    }

    saveThemeEnginePrefs(enginePrefs);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(theme));
    } catch {
      // Ignora erro de persistência
    }
  }, [
    theme,
    enginePrefs,
    surface,
    specialConfig,
    activeBgColor,
    activeAccentColor,
    accentContrast,
    fontConfig,
  ]);

  const setDensity = (density) =>
    setEnginePrefs((prev) => ({
      ...prev,
      density: density === 'compact' ? 'compact' : 'comfortable',
    }));

  const setMotion = (motion) =>
    setEnginePrefs((prev) => ({
      ...prev,
      motion:
        motion === 'full' || motion === 'reduced' ? motion : 'system',
    }));

  const setFontScale = (fontScale) =>
    setEnginePrefs((prev) => ({
      ...prev,
      fontScale:
        fontScale === 'large' || fontScale === 'xlarge' ? fontScale : 'normal',
    }));

  const setDyslexiaSpacing = (dyslexiaSpacing) =>
    setEnginePrefs((prev) => ({
      ...prev,
      dyslexiaSpacing: Boolean(dyslexiaSpacing),
    }));

  const setMode = (mode) =>
    runWithViewTransition(
      () =>
        setTheme((prev) => ({
          ...prev,
          mode,
          presetId: null,
          specialThemeId: null,
          customBgColor: null,
          customCardColor: null,
        })),
      enginePrefs.motion
    );

  const setFont = (font) =>
    setTheme((prev) => ({
      ...prev,
      font,
    }));

  const setTexture = (texture) =>
    setTheme((prev) => ({
      ...prev,
      texture,
    }));

  const applyPreset = (presetId) => {
    const preset = EDITORIAL_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    runWithViewTransition(
      () =>
        setTheme((prev) => ({
          ...prev,
          presetId: preset.id,
          specialThemeId: null,
          customBgColor: preset.bg,
          customCardColor: preset.card,
          customAccentColor: preset.accent,
        })),
      enginePrefs.motion
    );
  };

  const applySpecialTheme = (specialThemeId) => {
    const special = SPECIAL_THEMES.find((item) => item.id === specialThemeId);
    if (!special) return;
    runWithViewTransition(
      () =>
        setTheme((prev) => ({
          ...prev,
          specialThemeId: special.id,
          presetId: null,
        })),
      enginePrefs.motion
    );
  };

  const selectPastelSubpalette = (subpaletteId) => {
    const found = PASTEL_SUBPALETTES.find((item) => item.id === subpaletteId);
    if (!found) return;
    setTheme((prev) => ({
      ...prev,
      specialThemeId: 'pastel-glass',
      presetId: null,
      pastelSubpaletteId: found.id,
      pastelCustomColor: null,
    }));
  };

  const setPastelCustomColor = (hex) => {
    const valid = normalizeHex(hex);
    if (!valid) return;
    setTheme((prev) => ({
      ...prev,
      specialThemeId: 'pastel-glass',
      presetId: null,
      pastelCustomColor: valid,
    }));
  };

  const setCustomBgColor = (hex) => {
    const valid = normalizeHex(hex);
    if (!valid) return;
    setTheme((prev) => ({
      ...prev,
      presetId: null,
      specialThemeId: null,
      customBgColor: valid,
      customCardColor: null,
    }));
  };

  const setCustomAccentColor = (hex) => {
    const valid = normalizeHex(hex);
    if (!valid) return;
    setTheme((prev) => ({
      ...prev,
      presetId: null,
      specialThemeId: null,
      customAccentColor: valid,
    }));
  };

  const resetCustomColors = () =>
    setTheme((prev) => ({
      ...prev,
      mode: 'oled',
      texture: 'clean',
      presetId: null,
      specialThemeId: null,
      pastelSubpaletteId: 'lavender-rose',
      pastelCustomColor: null,
      customBgColor: null,
      customCardColor: null,
      customAccentColor: '#8B5CF6',
    }));

  return {
    mode: theme.mode,
    font: theme.font,
    texture: theme.texture,
    density: enginePrefs.density,
    motion: enginePrefs.motion,
    fontScale: enginePrefs.fontScale,
    dyslexiaSpacing: enginePrefs.dyslexiaSpacing,
    presetId: theme.presetId,
    specialThemeId: theme.specialThemeId,
    pastelSubpaletteId: theme.pastelSubpaletteId,
    pastelCustomColor:
      theme.pastelCustomColor ||
      PASTEL_SUBPALETTES.find((p) => p.id === theme.pastelSubpaletteId)
        ?.baseColor ||
      '#C084FC',
    bgColor: activeBgColor,
    accentColor: activeAccentColor,
    hasCustomBg: Boolean(theme.customBgColor) && !theme.specialThemeId,
    setMode,
    setFont,
    setTexture,
    setDensity,
    setMotion,
    setFontScale,
    setDyslexiaSpacing,
    applyPreset,
    applySpecialTheme,
    selectPastelSubpalette,
    setPastelCustomColor,
    setCustomBgColor,
    setCustomAccentColor,
    resetCustomColors,
  };
}
