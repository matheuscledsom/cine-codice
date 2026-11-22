import {
  EDITORIAL_PRESETS,
  FONT_PRESETS,
  TEXTURE_OPTIONS,
  THEME_MODES,
  ensureMinimumContrast,
  getContrastForAccent,
  getContrastRatio,
  hexToRgb,
  mixHex,
  normalizeHex,
  rgbToHex,
} from '../utils/themeTokens.js';

export const THEME_STORAGE_KEY = 'cine_codice_theme_v1';

function rgbToHsl(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  const l = (max + min) / 2;

  if (delta === 0) {
    return { h: 0, s: 0, l };
  }

  const s = delta / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (max === rn) {
    h = ((gn - bn) / delta) % 6;
  } else if (max === gn) {
    h = (bn - rn) / delta + 2;
  } else {
    h = (rn - gn) / delta + 4;
  }
  h = Math.round(h * 60);
  if (h < 0) h += 360;

  return { h, s, l };
}

function hslToHex(h, s, l) {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(1, s));
  const light = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;

  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (hue < 60) {
    rp = c;
    gp = x;
  } else if (hue < 120) {
    rp = x;
    gp = c;
  } else if (hue < 180) {
    gp = c;
    bp = x;
  } else if (hue < 240) {
    gp = x;
    bp = c;
  } else if (hue < 300) {
    rp = x;
    bp = c;
  } else {
    rp = c;
    bp = x;
  }

  return rgbToHex((rp + m) * 255, (gp + m) * 255, (bp + m) * 255);
}

function ensureAccessibleAccent(candidateHex, surfaces, isLightBg) {
  let accent = ensureMinimumContrast(candidateHex, surfaces, isLightBg, 3.2);
  const extreme = isLightBg ? '#09090B' : '#FFFFFF';
  for (let step = 0; step <= 24; step += 1) {
    const current = step === 0 ? accent : mixHex(accent, extreme, step / 24);
    const ink = getContrastForAccent(current);
    const btnContrast = getContrastRatio(ink, current);
    const surfaceContrast = Math.min(
      ...surfaces.map((surface) => getContrastRatio(current, surface))
    );
    if (btnContrast >= 4.6 && surfaceContrast >= 3.1) {
      return current;
    }
  }
  return extreme;
}

export const PASTEL_SUBPALETTES = [
  {
    id: 'lavender-rose',
    label: 'Lavanda & Rosa',
    baseColor: '#C084FC',
    cards: ['#F3E8FF', '#FCE7F3', '#E6FAF2', '#FFF0E5', '#E6F4FE'],
    accent: '#6D28D9',
  },
  {
    id: 'mint-sky',
    label: 'Menta & Céu',
    baseColor: '#38BDF8',
    cards: ['#E6FAF2', '#E6F4FE', '#EEF2FF', '#FCE7F3', '#FFF5E6'],
    accent: '#0369A1',
  },
  {
    id: 'peach-vanilla',
    label: 'Pêssego & Baunilha',
    baseColor: '#FB923C',
    cards: ['#FFF0E5', '#FEF7E6', '#FCE7F3', '#F3E8FF', '#E6FAF2'],
    accent: '#C2410C',
  },
  {
    id: 'lilac-pistachio',
    label: 'Lilás & Pistache',
    baseColor: '#A855F7',
    cards: ['#F5E8FF', '#ECFDF0', '#E8F6FF', '#FFEBF2', '#FFF4E6'],
    accent: '#6B21A8',
  },
];

export function buildPastelGlassTheme(subpaletteId = 'lavender-rose', customHex = null) {
  const custom = normalizeHex(customHex);
  const preset =
    PASTEL_SUBPALETTES.find((item) => item.id === subpaletteId) ||
    PASTEL_SUBPALETTES[0];

  const sourceHex = custom || preset.baseColor;
  const { r, g, b } = hexToRgb(sourceHex);
  const { h, s } = rgbToHsl(r, g, b);
  const softSat = s < 0.08 ? 0.12 : Math.min(Math.max(s, 0.48), 0.78);

  const cards = custom
    ? [
        hslToHex(h, softSat, 0.945),
        hslToHex(h - 36, softSat, 0.945),
        hslToHex(h + 135, softSat * 0.9, 0.945),
        hslToHex(h + 36, softSat * 0.95, 0.945),
        hslToHex(h - 145, softSat * 0.92, 0.945),
      ]
    : preset.cards;

  const bgApp = hslToHex(h, softSat * 0.42, 0.97);
  const bgCard = cards[0];
  const bgElevated = mixHex(cards[1], '#FFFFFF', 0.25);
  const borderSubtle = mixHex(cards[0], '#1E1B2E', 0.14);

  const surfaces = [bgApp, bgCard, bgElevated, ...cards];
  const textPrimary = '#1E1B2E';
  const textMuted = ensureMinimumContrast('#453F5E', surfaces, true, 5.4);
  const textSubtle = ensureMinimumContrast('#534D6E', surfaces, true, 4.7);

  const rawAccent = custom
    ? hslToHex(h, Math.max(s, 0.58), 0.36)
    : preset.accent;
  const accentColor = ensureAccessibleAccent(rawAccent, surfaces, true);
  const accentContrast = getContrastForAccent(accentColor);

  const vars = {
    '--bg-app': bgApp,
    '--bg-card': bgCard,
    '--bg-elevated': bgElevated,
    '--border-subtle': borderSubtle,
    '--text-primary': textPrimary,
    '--text-muted': textMuted,
    '--text-secondary': textMuted,
    '--text-subtle': textSubtle,
    '--pastel-base': sourceHex,
    '--pastel-card-1': cards[0],
    '--pastel-card-2': cards[1],
    '--pastel-card-3': cards[2],
    '--pastel-card-4': cards[3],
    '--pastel-card-5': cards[4],
    '--pastel-pill-bg': mixHex(cards[0], '#FFFFFF', 0.45),
    '--pastel-pill-active': mixHex(accentColor, '#FFFFFF', 0.84),
  };

  return {
    styleAttr: 'glass-pastel',
    isLight: true,
    baseColor: sourceHex,
    cards,
    accentColor,
    accentContrast,
    vars,
  };
}

export const SPECIAL_THEMES = [
  {
    id: 'pastel-glass',
    styleAttr: 'glass-pastel',
    label: 'Pastel Glass',
    subtitle: 'Vidro leitoso, cápsulas saltadas e paleta personalizável',
    isLight: true,
    previewBg: '#FAF6FF',
    previewCard: '#F3E8FF',
    previewAccent: '#6D28D9',
    accent: '#6D28D9',
    vars: buildPastelGlassTheme('lavender-rose').vars,
  },
  {
    id: 'windows-xp',
    styleAttr: 'win-xp',
    label: 'Windows XP Luna',
    subtitle: 'Creme clássico, cabeçalho azul Luna e chanfro de 3px',
    isLight: true,
    previewBg: '#ECE9D8',
    previewCard: '#FAF9F2',
    previewAccent: '#0054E3',
    accent: '#0054E3',
    vars: {
      '--bg-app': '#ECE9D8',
      '--bg-card': '#FAF9F2',
      '--bg-elevated': '#E2DEC8',
      '--border-subtle': '#7F9DB9',
      '--text-primary': '#0F172A',
      '--text-muted': '#334155',
      '--text-secondary': '#334155',
      '--text-subtle': '#475569',
      '--xp-header-blue': '#0054E3',
      '--xp-header-highlight': '#3D95FF',
      '--xp-confirm-green': '#3C9D2A',
      '--xp-confirm-deep': '#256D18',
    },
  },
  {
    id: 'windows-7',
    styleAttr: 'win-7',
    label: 'Windows 7 Aero',
    subtitle: 'Vidro fumê translúcido, borda dupla luminosa e azul-gelo',
    isLight: false,
    previewBg: '#0B121D',
    previewCard: '#131E2E',
    previewAccent: '#38BDF8',
    accent: '#38BDF8',
    vars: {
      '--bg-app': '#0B121D',
      '--bg-card': '#131E2E',
      '--bg-elevated': '#1B293D',
      '--border-subtle': '#3B5678',
      '--text-primary': '#F1F5F9',
      '--text-muted': '#CBD5E1',
      '--text-secondary': '#CBD5E1',
      '--text-subtle': '#94A3B8',
      '--win7-glass': 'rgba(19, 30, 46, 0.72)',
      '--win7-glass-elevated': 'rgba(27, 41, 61, 0.78)',
    },
  },
  {
    id: 'frutiger-aero',
    styleAttr: 'frutiger-aero',
    label: 'Aero Fruit',
    subtitle: 'Superfícies cristalinas aquáticas com reflexo glossy',
    isLight: true,
    previewBg: '#EAF8FE',
    previewCard: '#F6FCFF',
    previewAccent: '#0369A1',
    accent: '#0369A1',
    vars: {
      '--bg-app': '#EAF8FE',
      '--bg-card': '#F6FCFF',
      '--bg-elevated': '#DCF2FC',
      '--border-subtle': '#8FD3EE',
      '--text-primary': '#082838',
      '--text-muted': '#154B63',
      '--text-secondary': '#154B63',
      '--text-subtle': '#195E7A',
      '--aero-cyan': '#0EA5E9',
      '--aero-green': '#10B981',
      '--aero-green-deep': '#047857',
    },
  },
  {
    id: 'manga-ink',
    styleAttr: 'manga',
    label: 'Modo Mangá',
    subtitle: 'Papel tankōbon, nanquim preto, quadros 2px e retícula',
    isLight: true,
    previewBg: '#FAF9F4',
    previewCard: '#FFFFFF',
    previewAccent: '#111111',
    accent: '#111111',
    vars: {
      '--bg-app': '#FAF9F4',
      '--bg-card': '#FFFFFF',
      '--bg-elevated': '#F0EEE5',
      '--border-subtle': '#111111',
      '--text-primary': '#111111',
      '--text-muted': '#333330',
      '--text-secondary': '#333330',
      '--text-subtle': '#4A4A46',
    },
  },
  {
    id: 'focus-dim',
    styleAttr: 'focus',
    label: 'Modo Foco',
    subtitle: 'Grafite fosco de baixo brilho e contraste sem fadiga',
    isLight: false,
    previewBg: '#111214',
    previewCard: '#17181B',
    previewAccent: '#7C8594',
    accent: '#7C8594',
    vars: {
      '--bg-app': '#111214',
      '--bg-card': '#17181B',
      '--bg-elevated': '#1F2126',
      '--border-subtle': '#2B2E36',
      '--text-primary': '#C4C6CA',
      '--text-muted': '#9EA2AA',
      '--text-secondary': '#9EA2AA',
      '--text-subtle': '#8D929B',
    },
  },
];

export function resolveSpecialThemeConfig(
  specialThemeId,
  pastelSubpaletteId = 'lavender-rose',
  pastelCustomColor = null
) {
  const themeDef = SPECIAL_THEMES.find((item) => item.id === specialThemeId);
  if (!themeDef) return null;

  if (themeDef.id === 'pastel-glass') {
    const dynamicPastel = buildPastelGlassTheme(
      pastelSubpaletteId,
      pastelCustomColor
    );
    return {
      ...themeDef,
      isLight: true,
      vars: dynamicPastel.vars,
      accentColor: dynamicPastel.accentColor,
      accentContrast: dynamicPastel.accentContrast,
      pastelBaseColor: dynamicPastel.baseColor,
      pastelCards: dynamicPastel.cards,
    };
  }

  return {
    ...themeDef,
    accentColor: themeDef.accent,
    accentContrast: getContrastForAccent(themeDef.accent),
  };
}

export const DEFAULT_THEME_STATE = {
  mode: 'oled',
  font: 'source-sans',
  texture: 'clean',
  presetId: null,
  specialThemeId: null,
  pastelSubpaletteId: 'lavender-rose',
  pastelCustomColor: null,
  customBgColor: null,
  customCardColor: null,
  customAccentColor: '#8B5CF6',
};

export function parseThemeStorage(raw) {
  if (!raw) return DEFAULT_THEME_STATE;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') return DEFAULT_THEME_STATE;

    const mode = THEME_MODES.some((m) => m.id === parsed.mode)
      ? parsed.mode
      : 'oled';
    const rawFont = parsed.font === 'inter' ? 'source-sans' : parsed.font;
    const font = FONT_PRESETS.some((f) => f.id === rawFont)
      ? rawFont
      : 'source-sans';
    const texture = TEXTURE_OPTIONS.some((t) => t.id === parsed.texture)
      ? parsed.texture
      : 'clean';
    const presetId = EDITORIAL_PRESETS.some((p) => p.id === parsed.presetId)
      ? parsed.presetId
      : null;
    const specialThemeId = SPECIAL_THEMES.some(
      (s) => s.id === parsed.specialThemeId
    )
      ? parsed.specialThemeId
      : null;
    const pastelSubpaletteId = PASTEL_SUBPALETTES.some(
      (p) => p.id === parsed.pastelSubpaletteId
    )
      ? parsed.pastelSubpaletteId
      : 'lavender-rose';
    const pastelCustomColor = normalizeHex(parsed.pastelCustomColor);

    return {
      mode,
      font,
      texture,
      presetId: specialThemeId ? null : presetId,
      specialThemeId,
      pastelSubpaletteId,
      pastelCustomColor,
      customBgColor: normalizeHex(parsed.customBgColor),
      customCardColor: normalizeHex(parsed.customCardColor),
      customAccentColor:
        normalizeHex(parsed.customAccentColor) || '#8B5CF6',
    };
  } catch {
    return DEFAULT_THEME_STATE;
  }
}
