import { useEffect, useState } from 'react';
import {
  DEFAULT_THEME_STATE,
  THEME_STORAGE_KEY,
  parseThemeStorage,
  resolveActiveThemePalette,
} from '../data/themePresets';
import {
  DENSITY_OPTIONS,
  MOTION_OPTIONS,
  applyThemeEngineAttributes,
  loadThemeEnginePrefs,
  runWithViewTransition,
  saveThemeEnginePrefs,
} from '../design/themeEngine';
import {
  AMBIENT_TINT_SWATCHES,
  FONT_PRESETS,
  TEXTURE_OPTIONS,
  THEME_MODES,
  normalizeHex,
  normalizeThemeModeId,
} from '../utils/themeTokens';

export {
  AMBIENT_TINT_SWATCHES,
  DENSITY_OPTIONS,
  FONT_PRESETS,
  MOTION_OPTIONS,
  TEXTURE_OPTIONS,
  THEME_MODES,
};

function loadSavedTheme() {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    return parseThemeStorage(raw);
  } catch {
    return { ...DEFAULT_THEME_STATE };
  }
}

export function useTheme() {
  const [theme, setTheme] = useState(loadSavedTheme);
  const [enginePrefs, setEnginePrefs] = useState(loadThemeEnginePrefs);

  const fontConfig =
    FONT_PRESETS.find((f) => f.id === theme.font) ??
    FONT_PRESETS[5] ??
    FONT_PRESETS[0];

  const palette = resolveActiveThemePalette(theme);
  const activeBgColor = palette.vars['--bg-canvas'];
  const activeAccentColor = palette.accentColor;
  const accentContrast = palette.accentContrast;

  useEffect(() => {
    const root = document.documentElement;
    Object.entries(palette.vars).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });

    applyThemeEngineAttributes({
      root,
      styleAttr: palette.mode,
      density: enginePrefs.density,
      motion: enginePrefs.motion,
      fontScale: enginePrefs.fontScale,
      dyslexiaSpacing: enginePrefs.dyslexiaSpacing,
    });

    root.style.setProperty('--font-app', fontConfig.cssValue);
    root.classList.toggle('dark', !palette.isLight);

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
    palette,
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

  const setMode = (nextMode) =>
    runWithViewTransition(
      () =>
        setTheme((prev) => ({
          ...prev,
          mode: normalizeThemeModeId(nextMode),
        })),
      enginePrefs.motion
    );

  const setBgTintColor = (hexOrNull) =>
    runWithViewTransition(
      () =>
        setTheme((prev) => ({
          ...prev,
          bgTintColor: hexOrNull ? normalizeHex(hexOrNull) : null,
          customAccentColor: null,
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

  const setCustomAccentColor = (hex) => {
    const valid = normalizeHex(hex);
    setTheme((prev) => ({
      ...prev,
      customAccentColor: valid,
    }));
  };

  const resetCustomColors = () =>
    setTheme({
      ...DEFAULT_THEME_STATE,
    });

  return {
    mode: palette.mode,
    bgTintColor: theme.bgTintColor,
    font: theme.font,
    texture: theme.texture,
    density: enginePrefs.density,
    motion: enginePrefs.motion,
    fontScale: enginePrefs.fontScale,
    dyslexiaSpacing: enginePrefs.dyslexiaSpacing,
    bgColor: activeBgColor,
    accentColor: activeAccentColor,
    hasCustomBg: Boolean(theme.bgTintColor),
    setMode,
    setBgTintColor,
    setFont,
    setTexture,
    setDensity,
    setMotion,
    setFontScale,
    setDyslexiaSpacing,
    setCustomBgColor: setBgTintColor,
    setCustomAccentColor,
    resetCustomColors,
  };
}
