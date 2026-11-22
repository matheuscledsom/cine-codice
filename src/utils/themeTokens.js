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

  for (let step = 1; step <= 24; step += 1) {
    current = mixHex(candidateHex, extreme, step / 24);
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

export function buildSurfaceVarsFromBg(bgHex, cardHexOverride = null) {
  const bg = normalizeHex(bgHex) || '#000000';
  const isLight = getRelativeLuminance(bg) > 0.35;

  const card =
    normalizeHex(cardHexOverride) ||
    (isLight ? mixHex(bg, '#000000', 0.05) : mixHex(bg, '#FFFFFF', 0.055));
  const elevated = isLight
    ? mixHex(bg, '#000000', 0.1)
    : mixHex(bg, '#FFFFFF', 0.11);
  const border = isLight
    ? mixHex(bg, '#000000', 0.14)
    : mixHex(bg, '#FFFFFF', 0.15);

  const surfaces = [bg, card, elevated];
  const textPrimary = ensureMinimumContrast(
    isLight ? '#18181B' : '#F4F4F5',
    surfaces,
    isLight,
    7.0
  );
  const textMuted = ensureMinimumContrast(
    isLight ? '#404047' : '#B8B8C2',
    surfaces,
    isLight,
    5.2
  );
  const textSubtle = ensureMinimumContrast(
    isLight ? '#52525B' : '#9696A3',
    surfaces,
    isLight,
    4.6
  );

  return {
    isLight,
    vars: {
      '--bg-app': bg,
      '--bg-card': card,
      '--bg-elevated': elevated,
      '--border-subtle': border,
      '--text-primary': textPrimary,
      '--text-muted': textMuted,
      '--text-secondary': textMuted,
      '--text-subtle': textSubtle,
    },
  };
}

export const THEME_MODES = [
  {
    id: 'parchment',
    label: 'Papel Pergaminho',
    previewBg: '#FAF8F5',
    previewCard: '#F0EDE6',
    vars: buildSurfaceVarsFromBg('#FAF8F5', '#F0EDE6').vars,
    isLight: true,
  },
  {
    id: 'night_library',
    label: 'Biblioteca Noturna',
    previewBg: '#121316',
    previewCard: '#1B1D22',
    vars: buildSurfaceVarsFromBg('#121316', '#1B1D22').vars,
    isLight: false,
  },
  {
    id: 'oled',
    label: 'Tinta OLED',
    previewBg: '#000000',
    previewCard: '#0A0A0A',
    vars: {
      ...buildSurfaceVarsFromBg('#000000', '#0A0A0A').vars,
      '--text-primary': '#FFFFFF',
    },
    isLight: false,
  },
];

export const FONT_PRESETS = [
  {
    id: 'lora',
    label: 'Editorial / Livro (Lora)',
    shortLabel: 'Lora',
    fontName: 'Lora',
    cssValue: '"Lora", Georgia, serif',
  },
  {
    id: 'merriweather',
    label: 'Clássico Literário (Merriweather)',
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
    cssValue: '"Source Sans 3 Variable", "Codice Sans Fallback", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
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

export const EDITORIAL_PRESETS = [
  { id: 'kindle-paperwhite', label: 'Kindle Paperwhite', bg: '#FAF8F5', card: '#F0EDE6', accent: '#2B5B84' },
  { id: 'dark-academia', label: 'Dark Academia', bg: '#161310', card: '#211D18', accent: '#C89B54' },
  { id: 'fantasia-epica', label: 'Fantasia Épica', bg: '#12111A', card: '#1B1926', accent: '#B469FF' },
  { id: 'cyberpunk-scifi', label: 'Cyberpunk / Sci-Fi', bg: '#090B14', card: '#111524', accent: '#00E5FF' },
  { id: 'terror-gotico', label: 'Terror Gótico', bg: '#0D090B', card: '#181114', accent: '#EF4444' },
  { id: 'romance-classico', label: 'Romance Clássico', bg: '#FAF4F4', card: '#F1E6E8', accent: '#AD2E4E' },
  { id: 'biblioteca-alexandria', label: 'Biblioteca de Alexandria', bg: '#1C1712', card: '#272019', accent: '#F59E0B' },
  { id: 'floresta-elfica', label: 'Floresta Élfica', bg: '#0E1612', card: '#15221B', accent: '#10B981' },
  { id: 'manga-ink', label: 'Mangá Ink', bg: '#000000', card: '#0A0A0A', accent: '#FFFFFF' },
  { id: 'minimalismo-nordico', label: 'Minimalismo Nórdico', bg: '#F4F6F8', card: '#E8ECEF', accent: '#334155' },
  { id: 'misterio-noir', label: 'Mistério Noir', bg: '#121316', card: '#1B1D22', accent: '#EAB308' },
  { id: 'poesia-crepusculo', label: 'Poesia Crepúsculo', bg: '#17121F', card: '#211A2C', accent: '#F472B6' },
  { id: 'cafe-chuva', label: 'Café & Chuva', bg: '#1B1614', card: '#261F1C', accent: '#E59467' },
  { id: 'arquivo-academico', label: 'Arquivo Acadêmico', bg: '#F6F7F4', card: '#EAECE6', accent: '#1D4ED8' },
  { id: 'solarized-pergaminho', label: 'Solarized Pergaminho', bg: '#FDF6E3', card: '#EEE8D5', accent: '#0F62A4' },
  { id: 'veludo-real', label: 'Veludo Real', bg: '#140F1C', card: '#1E1729', accent: '#C084FC' },
  { id: 'shonen-jump', label: 'Shonen Jump', bg: '#111216', card: '#1A1C22', accent: '#FB923C' },
  { id: 'tokyo-neon', label: 'Tokyo Neon', bg: '#0B0C14', card: '#141624', accent: '#F472B6' },
  { id: 'codice-medieval', label: 'Códice Medieval', bg: '#191410', card: '#241D17', accent: '#D97706' },
  { id: 'nordic-frost', label: 'Nordic Frost', bg: '#F1F5F9', card: '#E2E8F0', accent: '#0369A1' },
  { id: 'ouro-imperial', label: 'Ouro Imperial', bg: '#0C0B09', card: '#171511', accent: '#F59E0B' },
  { id: 'cafe-kyoto', label: 'Café Kyoto', bg: '#171412', card: '#211C19', accent: '#10B981' },
];
