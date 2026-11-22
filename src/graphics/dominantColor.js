const COLOR_CACHE_DB = 'codice_dominant_colors_v1';
const COLOR_CACHE_STORE = 'colors';

const FALLBACK_SWATCHES = [
  { bg: '#2C3E50', fg: '#F8FAFC', accent: '#E2E8F0' },
  { bg: '#5B3A29', fg: '#FAF5F0', accent: '#E8D5C4' },
  { bg: '#3B4D3B', fg: '#F4F7F4', accent: '#CFE0CF' },
  { bg: '#4A3459', fg: '#F9F5FC', accent: '#DECBE8' },
  { bg: '#7A3E3E', fg: '#FDF6F6', accent: '#F2CECE' },
  { bg: '#2D4F5C', fg: '#F2FAFC', accent: '#BFE2EE' },
  { bg: '#57534E', fg: '#FAF9F6', accent: '#E7E5E4' },
  { bg: '#3E4A61', fg: '#F4F6FA', accent: '#C8D3E6' },
];

const memoryCache = new Map();

export function hashString32(input = '') {
  const str = String(input || 'codice');
  let hash = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function hexToRgb(hex = '#2C3E50') {
  const clean = String(hex).replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.slice(0, 6).padEnd(6, '0');
  const num = Number.parseInt(full, 16);
  if (Number.isNaN(num)) return { r: 44, g: 62, b: 80 };
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

export function rgbToHex(r, g, b) {
  const toHex = (n) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

export function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const chan = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
}

export function pickReadableTextColor(bgHex) {
  return relativeLuminance(bgHex) > 0.36 ? '#181615' : '#FAF8F4';
}

export function hashFallbackPalette(itemKey = '') {
  const idx = hashString32(itemKey) % FALLBACK_SWATCHES.length;
  const chosen = FALLBACK_SWATCHES[idx];
  return { ...chosen, source: 'fallback' };
}

function openColorDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(COLOR_CACHE_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(COLOR_CACHE_STORE)) {
          db.createObjectStore(COLOR_CACHE_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function readCachedColor(cacheKey) {
  if (memoryCache.has(cacheKey)) return memoryCache.get(cacheKey);
  const db = await openColorDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(COLOR_CACHE_STORE, 'readonly');
      const req = tx.objectStore(COLOR_CACHE_STORE).get(cacheKey);
      req.onsuccess = () => {
        const val = req.result || null;
        if (val) memoryCache.set(cacheKey, val);
        resolve(val);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function writeCachedColor(cacheKey, palette) {
  memoryCache.set(cacheKey, palette);
  const db = await openColorDb();
  if (!db) return;
  try {
    const tx = db.transaction(COLOR_CACHE_STORE, 'readwrite');
    tx.objectStore(COLOR_CACHE_STORE).put(palette, cacheKey);
  } catch {
    // Cache opcional não deve quebrar renderização
  }
}

export async function extractDominantColor(imageUrl, itemKey = '') {
  const safeKey = String(itemKey || imageUrl || 'codice');
  const fallback = hashFallbackPalette(safeKey);
  if (!imageUrl || typeof document === 'undefined' || typeof Image === 'undefined') {
    return fallback;
  }

  const cacheKey = `${safeKey}::${imageUrl}`;
  const cached = await readCachedColor(cacheKey);
  if (cached) return cached;

  const sampled = await new Promise((resolve) => {
    let settled = false;
    const finish = (res) => {
      if (settled) return;
      settled = true;
      resolve(res);
    };

    const timer = setTimeout(() => finish(null), 2200);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';

    img.onload = () => {
      clearTimeout(timer);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 16;
        canvas.height = 16;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return finish(null);
        ctx.drawImage(img, 0, 0, 16, 16);
        const { data } = ctx.getImageData(0, 0, 16, 16);

        let sumR = 0;
        let sumG = 0;
        let sumB = 0;
        let count = 0;

        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3];
          if (a < 180) continue;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          const spread = max - min;
          if (max > 245 && spread < 14) continue;
          if (min < 12 && spread < 10) continue;
          sumR += r;
          sumG += g;
          sumB += b;
          count += 1;
        }

        if (count === 0) return finish(null);
        const bg = rgbToHex(sumR / count, sumG / count, sumB / count);
        const fg = pickReadableTextColor(bg);
        const accent = fg === '#FAF8F4' ? 'rgba(255,255,255,0.34)' : 'rgba(0,0,0,0.22)';
        finish({ bg, fg, accent, source: 'sampled' });
      } catch {
        // Canvas tainted por CORS: usa fallback seguro
        finish(null);
      }
    };

    img.onerror = () => {
      clearTimeout(timer);
      finish(null);
    };

    img.src = imageUrl;
  });

  const finalPalette = sampled || fallback;
  await writeCachedColor(cacheKey, finalPalette);
  return finalPalette;
}
