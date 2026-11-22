import { hashFallbackPalette } from '../graphics/dominantColor.js';

export const IMAGE_PIPELINE_DB = 'codice_image_cache_v1';
export const IMAGE_PIPELINE_STORE = 'thumbnails';
export const MAX_LRU_THUMBNAILS = 180;

export const THUMB_SIZES = {
  sm: 120,
  md: 240,
  lg: 420,
};

const memoryThumbCache = new Map();

export function buildThumbCacheKey(url, sizeKey = 'md') {
  const width = THUMB_SIZES[sizeKey] || THUMB_SIZES.md;
  return `${width}::${String(url || '').trim()}`;
}

export function selectThumbnailSizeForViewport(widthPx = 180) {
  if (widthPx <= 130) return 'sm';
  if (widthPx <= 280) return 'md';
  return 'lg';
}

export function pruneLruEntries(entries = [], maxEntries = MAX_LRU_THUMBNAILS) {
  if (!Array.isArray(entries) || entries.length <= maxEntries) {
    return { keep: entries || [], evictKeys: [] };
  }
  const sorted = [...entries].sort(
    (a, b) => (Number(b.lastUsedAt) || 0) - (Number(a.lastUsedAt) || 0)
  );
  return {
    keep: sorted.slice(0, maxEntries),
    evictKeys: sorted.slice(maxEntries).map((e) => e.cacheKey),
  };
}

function openImageDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IMAGE_PIPELINE_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IMAGE_PIPELINE_STORE)) {
          db.createObjectStore(IMAGE_PIPELINE_STORE, { keyPath: 'cacheKey' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function getCachedThumbnail(url, sizeKey = 'md') {
  if (!url) return null;
  const cacheKey = buildThumbCacheKey(url, sizeKey);
  if (memoryThumbCache.has(cacheKey)) {
    const entry = memoryThumbCache.get(cacheKey);
    entry.lastUsedAt = Date.now();
    return entry.dataUrl || null;
  }

  const db = await openImageDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IMAGE_PIPELINE_STORE, 'readonly');
      const req = tx.objectStore(IMAGE_PIPELINE_STORE).get(cacheKey);
      req.onsuccess = () => {
        const res = req.result;
        if (res?.dataUrl) {
          memoryThumbCache.set(cacheKey, { ...res, lastUsedAt: Date.now() });
          resolve(res.dataUrl);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function storeThumbnailInDb(record) {
  memoryThumbCache.set(record.cacheKey, record);
  const db = await openImageDb();
  if (!db) return;

  try {
    const tx = db.transaction(IMAGE_PIPELINE_STORE, 'readwrite');
    const store = tx.objectStore(IMAGE_PIPELINE_STORE);
    store.put(record);
    const allReq = store.getAll();
    allReq.onsuccess = () => {
      const all = Array.isArray(allReq.result) ? allReq.result : [];
      if (all.length > MAX_LRU_THUMBNAILS) {
        const { evictKeys } = pruneLruEntries(all, MAX_LRU_THUMBNAILS);
        evictKeys.forEach((k) => {
          memoryThumbCache.delete(k);
          store.delete(k);
        });
      }
    };
  } catch {
    // Cache LRU opcional
  }
}

async function encodeWebpThumbnail(img, targetWidth) {
  const aspect =
    img.naturalWidth > 0 && img.naturalHeight > 0
      ? img.naturalHeight / img.naturalWidth
      : 1.5;
  const w = Math.max(40, Math.round(targetWidth));
  const h = Math.max(60, Math.round(w * aspect));

  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(img, 0, 0, w, h);
      const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.82 });
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve({ dataUrl: String(reader.result || ''), w, h, sizeBytes: blob.size });
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    }
  }

  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/webp', 0.82);
    if (dataUrl && dataUrl.startsWith('data:image/webp')) {
      return { dataUrl, w, h, sizeBytes: dataUrl.length };
    }
  }
  return null;
}

export async function optimizeCoverThumbnail(imageUrl, sizeKey = 'md', itemKey = '') {
  if (!imageUrl) return null;
  const cached = await getCachedThumbnail(imageUrl, sizeKey);
  if (cached) return cached;

  if (typeof Image === 'undefined' || typeof document === 'undefined') {
    return null;
  }

  const targetWidth = THUMB_SIZES[sizeKey] || THUMB_SIZES.md;
  const cacheKey = buildThumbCacheKey(imageUrl, sizeKey);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };

    const timer = setTimeout(() => finish(null), 2600);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';

    img.onload = async () => {
      clearTimeout(timer);
      try {
        const encoded = await encodeWebpThumbnail(img, targetWidth);
        if (!encoded?.dataUrl) return finish(null);
        await storeThumbnailInDb({
          cacheKey,
          itemKey: String(itemKey || ''),
          dataUrl: encoded.dataUrl,
          width: encoded.w,
          height: encoded.h,
          sizeBytes: encoded.sizeBytes,
          lastUsedAt: Date.now(),
        });
        finish(encoded.dataUrl);
      } catch {
        finish(null);
      }
    };

    img.onerror = () => {
      clearTimeout(timer);
      finish(null);
    };

    img.src = imageUrl;
  });
}

export function getPlaceholderSwatchForCover(key = '') {
  return hashFallbackPalette(key).bg;
}

export async function clearImagePipelineCache() {
  memoryThumbCache.clear();
  const db = await openImageDb();
  if (!db) return;
  try {
    const tx = db.transaction(IMAGE_PIPELINE_STORE, 'readwrite');
    tx.objectStore(IMAGE_PIPELINE_STORE).clear();
  } catch {
    // Limpeza opcional
  }
}
