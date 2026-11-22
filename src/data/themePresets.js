import {
  AMBIENT_TINT_SWATCHES,
  FONT_PRESETS,
  TEXTURE_OPTIONS,
  THEME_MODES,
  buildHarmonizedThemeVars,
  normalizeHex,
  normalizeThemeModeId,
} from '../utils/themeTokens.js';

export const THEME_STORAGE_KEY = 'codice_theme_v1';

export { AMBIENT_TINT_SWATCHES };

export const DEFAULT_THEME_STATE = Object.freeze({
  mode: 'dark',
  bgTintColor: null,
  font: 'source-sans',
  texture: 'clean',
  customAccentColor: null,
});

export function parseThemeStorage(rawJson) {
  if (!rawJson || typeof rawJson !== 'string') {
    return { ...DEFAULT_THEME_STATE };
  }

  try {
    const parsed = JSON.parse(rawJson);
    const mode = normalizeThemeModeId(parsed?.mode);
    const font = FONT_PRESETS.some((item) => item.id === parsed?.font)
      ? parsed.font
      : DEFAULT_THEME_STATE.font;
    const texture = TEXTURE_OPTIONS.some((item) => item.id === parsed?.texture)
      ? parsed.texture
      : DEFAULT_THEME_STATE.texture;

    const rawTint = parsed?.bgTintColor ?? parsed?.customBgColor ?? null;
    const bgTintColor = rawTint ? normalizeHex(rawTint) : null;
    const customAccentColor = parsed?.customAccentColor
      ? normalizeHex(parsed.customAccentColor)
      : null;

    return {
      mode,
      bgTintColor,
      font,
      texture,
      customAccentColor,
    };
  } catch {
    return { ...DEFAULT_THEME_STATE };
  }
}

export function resolveActiveThemePalette(themeState = DEFAULT_THEME_STATE) {
  return buildHarmonizedThemeVars(
    themeState?.mode || 'dark',
    themeState?.bgTintColor || null,
    themeState?.customAccentColor || null
  );
}

export { THEME_MODES };
