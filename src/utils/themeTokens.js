/**
 * Motor de Cores OKLCH & Tokens Visuais — Cine Códice v1.3.0 · Lumière
 *
 * 3 Modos Base Oficiais:
 * - dark  (Modo Escuro / OLED Grafite: #0B0D12)
 * - white (Modo Claro / Editorial Branco: #F7F8FA / #FFFFFF)
 * - sepia (Modo Sépia / Celuloide Quente: #F3EDE2 / #FAF6EE)
 *
 * + Harmonização Automática de Cor de Ambiente (bgTintColor) em OKLCH:
 *   --bg-canvas       (90% base + 10% tint)
 *   --bg-surface      (86% base + 14% tint)
 *   --bg-elevated     (82% base + 18% tint)
 *   --border-hairline (matiz com 14% de peso)
 *   --accent-primary  & --accent-contrast calibrados para WCAG 2.2 AA (>= 4.5:1)
 */

export function normalizeHex(hex) {
  if (typeof hex !== 'string') return null;
  const clean = hex.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(clean)) return clean.toUpperCase();
  if (/^#[0-9A-Fa-f]{3}$/.test(clean)) {
    const [, r, g, b] = clean;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return null;
}

export function hexToRgb(hex) {
  const valid = normalizeHex(hex) || '#000000';
  return {
    r: parseInt(valid.slice(1, 3), 16),
    g: parseInt(valid.slice(3, 5), 16),
    b: parseInt(valid.slice(5, 7), 16),
  };
}

export function rgbToHex(r, g, b) {
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[clamp(r), clamp(g), clamp(b)]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`.toUpperCase();
}

export function mixHex(hexA, hexB, weightB = 0.5) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const w = Math.max(0, Math.min(1, weightB));
  return rgbToHex(
    a.r + (b.r - a.r) * w,
    a.g + (b.g - a.g) * w,
    a.b + (b.b - a.b) * w
  );
}

// Conversão sRGB <-> OKLab <-> OKLCH para harmonização perceptual
function srgbToLinear(channel255) {
  const c = channel255 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(linear) {
  const clamped = Math.max(0, Math.min(1, linear));
  const s =
    clamped <= 0.0031308
      ? 12.92 * clamped
      : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
  return Math.round(s * 255);
}

export function hexToOklch(hex) {
  const { r, g, b } = hexToRgb(hex);
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bLab = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  const C = Math.sqrt(a * a + bLab * bLab);
  let H = (Math.atan2(bLab, a) * 180) / Math.PI;
  if (H < 0) H += 360;

  return { l: L, c: C, h: H };
}

export function oklchToHex(L, C, H) {
  const hRad = ((Number(H) || 0) * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const bLab = C * Math.sin(hRad);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * bLab;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * bLab;
  const s_ = L - 0.0894841775 * a - 1.291485548 * bLab;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const lr = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  return rgbToHex(linearToSrgb(lr), linearToSrgb(lg), linearToSrgb(lb));
}

export function getRelativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const linear = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

export function getContrastRatio(hexA, hexB) {
  const lumA = getRelativeLuminance(hexA);
  const lumB = getRelativeLuminance(hexB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

export function ensureMinimumContrast(candidateHex, targetSurfaces, isLightBg, minRatio) {
  const extreme = isLightBg ? '#09090B' : '#FFFFFF';
  let current = normalizeHex(candidateHex) || extreme;
  const worstRatio = () =>
    Math.min(...targetSurfaces.map((surface) => getContrastRatio(current, surface)));

  if (worstRatio() >= minRatio) return current;

  for (let step = 1; step <= 28; step += 1) {
    current = mixHex(candidateHex, extreme, step / 28);
    if (worstRatio() >= minRatio) return current;
  }
  return extreme;
}

export function getContrastForAccent(accentHex) {
  const hex = normalizeHex(accentHex) || '#8B5CF6';
  const darkInk = '#09090B';
  const lightInk = '#FFFFFF';
  return getContrastRatio(darkInk, hex) >= getContrastRatio(lightInk, hex)
    ? darkInk
    : lightInk;
}

export function calibrateAccessibleAccent(rawAccentHex, targetSurfaces, isLightBg) {
  const base = normalizeHex(rawAccentHex) || (isLightBg ? '#4F46E5' : '#8B5CF6');
  // Garante contraste de UI >= 3.15:1 contra todas as superfícies E contraste >= 4.5:1 com o texto do botão
  const uiSafe = ensureMinimumContrast(base, targetSurfaces, isLightBg, 3.15);
  const ink = getContrastForAccent(uiSafe);
  if (getContrastRatio(ink, uiSafe) >= 4.5) {
    return { accentPrimary: uiSafe, accentContrast: ink };
  }
  const adjusted = ensureMinimumContrast(uiSafe, [ink], ink === '#FFFFFF', 4.5);
  return {
    accentPrimary: adjusted,
    accentContrast: getContrastForAccent(adjusted),
  };
}

export function normalizeThemeModeId(rawMode) {
  if (rawMode === 'white' || rawMode === 'light') return 'white';
  if (rawMode === 'sepia' || rawMode === 'parchment') return 'sepia';
  return 'dark';
}

export const AMBIENT_TINT_SWATCHES = [
  { id: 'neutral', label: 'Neutro Puro', color: null, previewHex: '#64748B' },
  { id: 'midnight-blue', label: 'Azul Meia-Noite', color: '#2563EB', previewHex: '#2563EB' },
  { id: 'cosmic-purple', label: 'Roxo Cósmico', color: '#7C3AED', previewHex: '#7C3AED' },
  { id: 'emerald-green', label: 'Verde Esmeralda', color: '#059669', previewHex: '#059669' },
  { id: 'film-burgundy', label: 'Bordô Película', color: '#BE123C', previewHex: '#BE123C' },
  { id: 'deep-cyan', label: 'Ciano Profundo', color: '#0284C7', previewHex: '#0284C7' },
  { id: 'warm-amber', label: 'Âmbar Quente', color: '#D97706', previewHex: '#D97706' },
  { id: 'steel-graphite', label: 'Grafite Aço', color: '#475569', previewHex: '#475569' },
];

const MODE_BASES = {
  dark: {
    id: 'dark',
    label: 'Dark · OLED Grafite',
    shortLabel: 'Dark',
    description: 'Base profunda (#0B0D12), vidro fosco sutil e bordas ultrafinas',
    isLight: false,
    canvas: '#0B0D12',
    surface: '#13161E',
    elevated: '#1B202C',
    border: '#252B3B',
    textPrimary: '#F4F6F9',
    textMuted: '#B6BFCE',
    textSubtle: '#95A0B3',
    defaultAccent: '#8B5CF6',
  },
  white: {
    id: 'white',
    label: 'White · Editorial Branco',
    shortLabel: 'White',
    description: 'Base limpa (#F7F8FA), cards brancos puros (#FFFFFF) e grafite profundo',
    isLight: true,
    canvas: '#F7F8FA',
    surface: '#FFFFFF',
    elevated: '#EEF1F6',
    border: '#DCE2EC',
    textPrimary: '#0F172A',
    textMuted: '#3B475C',
    textSubtle: '#526077',
    defaultAccent: '#4F46E5',
  },
  sepia: {
    id: 'sepia',
    label: 'Sépia · Celuloide Quente',
    shortLabel: 'Sépia',
    description: 'Papel quente (#F3EDE2), marfim suave (#FAF6EE) e tinta marrom-carvão',
    isLight: true,
    canvas: '#F3EDE2',
    surface: '#FAF6EE',
    elevated: '#EAE2D3',
    border: '#D8CEBD',
    textPrimary: '#231D16',
    textMuted: '#4C3F32',
    textSubtle: '#615242',
    defaultAccent: '#9A4E12',
  },
};

/**
 * Harmoniza qualquer cor de ambiente (bgTintColor) sobre um dos 3 modos base
 * usando OKLCH + misturas graduais (10% canvas, 14% surface, 18% elevated, 14% hairline)
 * e calibrando o acento para contraste WCAG 2.2 AA (>= 4.5:1).
 */
export function buildHarmonizedThemeVars(modeId = 'dark', bgTintColor = null, customAccentOverride = null) {
  const cleanMode = normalizeThemeModeId(modeId);
  const base = MODE_BASES[cleanMode] || MODE_BASES.dark;
  const cleanTint = normalizeHex(bgTintColor);

  let bgCanvas = base.canvas;
  let bgSurface = base.surface;
  let bgElevated = base.elevated;
  let borderHairline = base.border;
  let rawAccent = normalizeHex(customAccentOverride) || base.defaultAccent;

  if (cleanTint) {
    const oklch = hexToOklch(cleanTint);
    // Normaliza a cor em OKLCH para evitar que tons extremos quebrem a harmonia
    const normalizedTintHex = oklchToHex(
      base.isLight ? 0.62 : 0.42,
      Math.min(0.14, Math.max(0.03, oklch.c)),
      oklch.h
    );

    // 5 variáveis derivadas conforme especificação OKLCH v1.3.0:
    // --bg-canvas: 90% base + 10% tint
    // --bg-surface: 86% base + 14% tint
    // --bg-elevated: 82% base + 18% tint
    // --border-hairline: derivada do mesmo matiz com 14% de peso
    bgCanvas = mixHex(base.canvas, normalizedTintHex, 0.10);
    bgSurface = mixHex(base.surface, normalizedTintHex, 0.14);
    bgElevated = mixHex(base.elevated, normalizedTintHex, 0.18);
    borderHairline = mixHex(base.border, normalizedTintHex, 0.14);

    if (!customAccentOverride) {
      rawAccent = oklchToHex(
        base.isLight ? 0.48 : 0.72,
        Math.max(0.14, Math.min(0.21, oklch.c || 0.15)),
        oklch.h
      );
    }
  }

  const surfaces = [bgCanvas, bgSurface, bgElevated];
  const textPrimary = ensureMinimumContrast(base.textPrimary, surfaces, base.isLight, 7.0);
  const textMuted = ensureMinimumContrast(base.textMuted, surfaces, base.isLight, 5.2);
  const textSubtle = ensureMinimumContrast(base.textSubtle, surfaces, base.isLight, 4.6);

  const { accentPrimary, accentContrast } = calibrateAccessibleAccent(
    rawAccent,
    surfaces,
    base.isLight
  );

  return {
    mode: cleanMode,
    isLight: base.isLight,
    bgTintColor: cleanTint,
    accentColor: accentPrimary,
    accentContrast,
    vars: {
      '--bg-canvas': bgCanvas,
      '--bg-surface': bgSurface,
      '--bg-elevated': bgElevated,
      '--border-hairline': borderHairline,
      '--accent-primary': accentPrimary,
      '--accent-contrast': accentContrast,
      // Tokens equivalentes usados pelos componentes existentes
      '--bg-app': bgCanvas,
      '--bg-primary': bgCanvas,
      '--bg-card': bgSurface,
      '--bg-secondary': bgSurface,
      '--border-subtle': borderHairline,
      '--border-color': borderHairline,
      '--accent-color': accentPrimary,
      '--text-primary': textPrimary,
      '--text-muted': textMuted,
      '--text-secondary': textMuted,
      '--text-subtle': textSubtle,
    },
  };
}

export function buildSurfaceVarsFromBg(bgHex, cardHexOverride = null) {
  const bg = normalizeHex(bgHex) || '#0B0D12';
  const isLight = getRelativeLuminance(bg) > 0.35;
  const modeGuess = isLight ? 'white' : 'dark';
  const built = buildHarmonizedThemeVars(modeGuess, bg);
  if (cardHexOverride) {
    const cleanCard = normalizeHex(cardHexOverride);
    if (cleanCard) {
      built.vars['--bg-card'] = cleanCard;
      built.vars['--bg-surface'] = cleanCard;
    }
  }
  return {
    isLight: built.isLight,
    vars: built.vars,
  };
}

export const THEME_MODES = [
  {
    id: 'dark',
    label: MODE_BASES.dark.label,
    shortLabel: MODE_BASES.dark.shortLabel,
    description: MODE_BASES.dark.description,
    previewBg: MODE_BASES.dark.canvas,
    previewCard: MODE_BASES.dark.surface,
    defaultAccent: MODE_BASES.dark.defaultAccent,
    vars: buildHarmonizedThemeVars('dark', null).vars,
    isLight: false,
  },
  {
    id: 'white',
    label: MODE_BASES.white.label,
    shortLabel: MODE_BASES.white.shortLabel,
    description: MODE_BASES.white.description,
    previewBg: MODE_BASES.white.canvas,
    previewCard: MODE_BASES.white.surface,
    defaultAccent: MODE_BASES.white.defaultAccent,
    vars: buildHarmonizedThemeVars('white', null).vars,
    isLight: true,
  },
  {
    id: 'sepia',
    label: MODE_BASES.sepia.label,
    shortLabel: MODE_BASES.sepia.shortLabel,
    description: MODE_BASES.sepia.description,
    previewBg: MODE_BASES.sepia.canvas,
    previewCard: MODE_BASES.sepia.surface,
    defaultAccent: MODE_BASES.sepia.defaultAccent,
    vars: buildHarmonizedThemeVars('sepia', null).vars,
    isLight: true,
  },
];

export const FONT_PRESETS = [
  {
    id: 'lora',
    label: 'Editorial / Roteiro (Lora)',
    shortLabel: 'Lora',
    fontName: 'Lora',
    cssValue: '"Lora", Georgia, serif',
  },
  {
    id: 'merriweather',
    label: 'Clássico de Cinema (Merriweather)',
    shortLabel: 'Merriweather',
    fontName: 'Merriweather',
    cssValue: '"Merriweather", Georgia, serif',
  },
  {
    id: 'crimson',
    label: 'Tipografia Acadêmica (Crimson Pro)',
    shortLabel: 'Crimson Pro',
    fontName: 'Crimson Pro',
    cssValue: '"Crimson Pro", Georgia, serif',
  },
  {
    id: 'garamond',
    label: 'Clássico Humanista (EB Garamond)',
    shortLabel: 'EB Garamond',
    fontName: 'EB Garamond',
    cssValue: '"EB Garamond", Georgia, serif',
  },
  {
    id: 'baskerville',
    label: 'Imprensa Editorial (Libre Baskerville)',
    shortLabel: 'Libre Baskerville',
    fontName: 'Libre Baskerville',
    cssValue: '"Libre Baskerville", Georgia, serif',
  },
  {
    id: 'source-sans',
    label: 'Sans Humanista (Source Sans 3)',
    shortLabel: 'Source Sans 3',
    fontName: 'Source Sans 3 Variable',
    cssValue:
      '"Source Sans 3 Variable", "Codice Sans Fallback", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  {
    id: 'jakarta',
    label: 'Editorial Contemporânea (Plus Jakarta Sans)',
    shortLabel: 'Plus Jakarta Sans',
    fontName: 'Plus Jakarta Sans',
    cssValue: '"Plus Jakarta Sans", -apple-system, sans-serif',
  },
  {
    id: 'space',
    label: 'Geométrica Moderna (Space Grotesk)',
    shortLabel: 'Space Grotesk',
    fontName: 'Space Grotesk',
    cssValue: '"Space Grotesk", -apple-system, sans-serif',
  },
  {
    id: 'jetbrains',
    label: 'Monospace / Fichamento (JetBrains Mono)',
    shortLabel: 'JetBrains Mono',
    fontName: 'JetBrains Mono',
    cssValue: '"JetBrains Mono", ui-monospace, monospace',
  },
  {
    id: 'ibmmono',
    label: 'Monospace Técnico (IBM Plex Mono)',
    shortLabel: 'IBM Plex Mono',
    fontName: 'IBM Plex Mono',
    cssValue: '"IBM Plex Mono", ui-monospace, monospace',
  },
];

export const TEXTURE_OPTIONS = [
  { id: 'clean', label: 'Limpo' },
  { id: 'paper', label: 'Grão de Papel' },
  { id: 'grid', label: 'Grade de Fichamento' },
  { id: 'glow', label: 'Brilho Sutil' },
];
