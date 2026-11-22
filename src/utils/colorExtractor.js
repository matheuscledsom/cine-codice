import {
  THEME_MODES,
  ensureMinimumContrast,
  getContrastForAccent,
  getContrastRatio,
  hexToOklch,
  hexToRgb,
  oklchToHex,
  rgbToHex,
} from './themeTokens.js';

const paletteCache = new Map();

function hashStringToHue(str) {
  const clean = String(str || 'CineCodiceLumiere');
  let hash = 2166136261;
  for (let i = 0; i < clean.length; i += 1) {
    hash ^= clean.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash % 360;
}

export function deriveDeterministicPosterColors(item = {}) {
  const seed = `${item?.title || ''}|${item?.coverUrl || ''}|${item?.backdropUrl || ''}|${(item?.genres || []).join(',')}`;
  const primaryHue = hashStringToHue(seed);
  const secondaryHue = (primaryHue + 38) % 360;

  const primaryHex = oklchToHex(0.68, 0.145, primaryHue);
  const secondaryHex = oklchToHex(0.58, 0.13, secondaryHue);

  return {
    primaryHex,
    secondaryHex,
    primaryHue,
    secondaryHue,
  };
}

export function calibrateWorkPaletteOklch(
  primaryHex,
  secondaryHex,
  { mode = 'dark', surfaceHex } = {}
) {
  const modeMeta =
    THEME_MODES.find((m) => m.id === mode) || THEME_MODES[0];
  const targetSurface =
    surfaceHex || modeMeta.previewCard || modeMeta.surface || '#13161E';
  const isLight = Boolean(modeMeta.isLight);
  const isDark = !isLight;

  const primaryOklch = hexToOklch(primaryHex || '#E0A458');
  const secondaryOklch = hexToOklch(secondaryHex || primaryHex || '#E0A458');

  const l = isDark ? 0.78 : 0.42;
  const c = Math.max(0.11, Math.min(0.16, primaryOklch.c || 0.135));
  const h = primaryOklch.h || 65;

  const candidateAccent = oklchToHex(l, c, h);
  const workAccent = ensureMinimumContrast(
    candidateAccent,
    [targetSurface],
    isLight,
    4.55
  );
  const workContrast = getContrastForAccent(workAccent);

  const glowHex = oklchToHex(
    isDark ? 0.62 : 0.54,
    Math.max(0.1, Math.min(0.16, secondaryOklch.c || 0.13)),
    secondaryOklch.h || h
  );
  const glowRgb = hexToRgb(glowHex);
  const workGlow = `rgba(${glowRgb.r}, ${glowRgb.g}, ${glowRgb.b}, ${isDark ? 0.28 : 0.18})`;

  return {
    workAccent,
    workContrast,
    workGlow,
    workGlowHex: glowHex,
    contrastRatio: Number(getContrastRatio(workAccent, targetSurface).toFixed(2)),
  };
}

export function getWorkAdaptivePaletteSync(item = {}, { mode = 'dark', surfaceHex } = {}) {
  const cacheKey = `${item?.id || item?.title || 'work'}|${item?.coverUrl || ''}|${mode}|${surfaceHex || ''}`;
  if (paletteCache.has(cacheKey)) {
    return paletteCache.get(cacheKey);
  }
  const { primaryHex, secondaryHex } = deriveDeterministicPosterColors(item);
  const calibrated = calibrateWorkPaletteOklch(primaryHex, secondaryHex, {
    mode,
    surfaceHex,
  });
  paletteCache.set(cacheKey, calibrated);
  return calibrated;
}

export async function extractWorkAdaptivePalette(
  item = {},
  { mode = 'dark', surfaceHex } = {}
) {
  const cacheKey = `${item?.id || item?.title || 'work'}|${item?.coverUrl || ''}|${mode}|${surfaceHex || ''}`;
  if (paletteCache.has(cacheKey)) {
    return paletteCache.get(cacheKey);
  }

  const fallback = getWorkAdaptivePaletteSync(item, { mode, surfaceHex });
  const imageUrl = String(item?.coverUrl || item?.backdropUrl || '').trim();

  if (
    !imageUrl ||
    typeof window === 'undefined' ||
    typeof document === 'undefined' ||
    typeof Image === 'undefined'
  ) {
    return fallback;
  }

  try {
    const sampled = await new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const timer = setTimeout(() => reject(new Error('Image timeout')), 1800);
      img.onload = () => {
        clearTimeout(timer);
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 16;
          canvas.height = 24;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('No 2d context'));
            return;
          }
          ctx.drawImage(img, 0, 0, 16, 24);
          const data = ctx.getImageData(0, 0, 16, 24).data;
          let r1 = 0;
          let g1 = 0;
          let b1 = 0;
          let c1 = 0;
          let r2 = 0;
          let g2 = 0;
          let b2 = 0;
          let c2 = 0;

          for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const a = data[i + 3];
            if (a < 128) continue;
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            const sat = max === 0 ? 0 : (max - min) / max;
            if (sat < 0.15 || max < 35 || min > 235) continue;

            if ((i / 4) % 2 === 0) {
              r1 += r;
              g1 += g;
              b1 += b;
              c1 += 1;
            } else {
              r2 += r;
              g2 += g;
              b2 += b;
              c2 += 1;
            }
          }

          if (c1 === 0) {
            reject(new Error('Low saturation image'));
            return;
          }
          const hex1 = rgbToHex(
            Math.round(r1 / c1),
            Math.round(g1 / c1),
            Math.round(b1 / c1)
          );
          const hex2 =
            c2 > 0
              ? rgbToHex(
                  Math.round(r2 / c2),
                  Math.round(g2 / c2),
                  Math.round(b2 / c2)
                )
              : hex1;
          resolve({ primaryHex: hex1, secondaryHex: hex2 });
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = (err) => {
        clearTimeout(timer);
        reject(err);
      };
      img.src = imageUrl;
    });

    const calibrated = calibrateWorkPaletteOklch(
      sampled.primaryHex,
      sampled.secondaryHex,
      { mode, surfaceHex }
    );
    paletteCache.set(cacheKey, calibrated);
    return calibrated;
  } catch {
    return fallback;
  }
}
