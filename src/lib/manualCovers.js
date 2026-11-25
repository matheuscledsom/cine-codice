/**
 * Pipeline de compressão e armazenamento local em IndexedDB para capas enviadas manualmente
 * (OMNIPRISM v2.6.0 — Fase 2).
 *
 * - Redimensiona no cliente mantendo proporção com lado maior <= 600 px.
 * - Comprime em WebP (fallback JPEG) com alvo <= 300 KB.
 * - Grava no IndexedDB (`codice_image_cache_v1` -> store `manual_covers`) + espelho em memória para testes.
 */

export const MANUAL_COVER_MAX_DIMENSION = 600;
export const MANUAL_COVER_MAX_BYTES = 300 * 1024; // 300 KB
export const MANUAL_COVER_MAX_DATAURL_CHARS = 420_000;

export const MANUAL_COVER_DB_NAME = 'codice_image_cache_v1';
export const MANUAL_COVER_DB_VERSION = 2;
export const MANUAL_COVER_STORE = 'manual_covers';

const memoryManualCovers = new Map();

export function clearMemoryManualCoversForTests() {
  memoryManualCovers.clear();
}

export function estimateDataUrlBytes(dataUrl = '') {
  const raw = String(dataUrl || '');
  const commaIdx = raw.indexOf(',');
  if (commaIdx === -1) return 0;
  const b64 = raw.slice(commaIdx + 1);
  return Math.floor((b64.length * 3) / 4);
}

export function isCompressedManualCoverDataUrl(raw = '') {
  const clean = String(raw || '').trim();
  if (!/^data:image\/(webp|jpeg|jpg|png);base64,/i.test(clean)) return false;
  return clean.length <= MANUAL_COVER_MAX_DATAURL_CHARS;
}

function openManualCoverDb(idbFactory = null) {
  const factory =
    idbFactory || (typeof indexedDB !== 'undefined' ? indexedDB : null);
  if (!factory) return Promise.resolve(null);

  return new Promise((resolve) => {
    try {
      const req = factory.open(MANUAL_COVER_DB_NAME, MANUAL_COVER_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('thumbnails')) {
          db.createObjectStore('thumbnails', { keyPath: 'cacheKey' });
        }
        if (!db.objectStoreNames.contains(MANUAL_COVER_STORE)) {
          db.createObjectStore(MANUAL_COVER_STORE, { keyPath: 'workId' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveManualCoverInIdb(
  workId,
  dataUrl,
  { idbFactory = null, mimeType = 'image/webp', bytes = 0, width = 0, height = 0 } = {}
) {
  const cleanId = String(workId || '').trim();
  const cleanUrl = String(dataUrl || '').trim();
  if (!cleanId || !cleanUrl) return { ok: false, persisted: false };

  const record = {
    workId: cleanId,
    dataUrl: cleanUrl,
    mimeType,
    bytes: bytes || estimateDataUrlBytes(cleanUrl),
    width,
    height,
    updatedAt: new Date().toISOString(),
  };
  memoryManualCovers.set(cleanId, record);

  const db = await openManualCoverDb(idbFactory);
  if (!db) return { ok: true, persisted: false, record };

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(MANUAL_COVER_STORE, 'readwrite');
      tx.objectStore(MANUAL_COVER_STORE).put(record);
      tx.oncomplete = () => {
        db.close?.();
        resolve({ ok: true, persisted: true, record });
      };
      tx.onerror = () => {
        db.close?.();
        resolve({ ok: true, persisted: false, record });
      };
    } catch {
      db.close?.();
      resolve({ ok: true, persisted: false, record });
    }
  });
}

export async function getManualCoverFromIdb(workId, { idbFactory = null } = {}) {
  const cleanId = String(workId || '').trim();
  if (!cleanId) return null;

  if (memoryManualCovers.has(cleanId)) {
    return memoryManualCovers.get(cleanId)?.dataUrl || null;
  }

  const db = await openManualCoverDb(idbFactory);
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(MANUAL_COVER_STORE, 'readonly');
      const req = tx.objectStore(MANUAL_COVER_STORE).get(cleanId);
      req.onsuccess = () => {
        const res = req.result || null;
        if (res?.dataUrl) {
          memoryManualCovers.set(cleanId, res);
          resolve(res.dataUrl);
        } else {
          resolve(null);
        }
        db.close?.();
      };
      req.onerror = () => {
        db.close?.();
        resolve(null);
      };
    } catch {
      db.close?.();
      resolve(null);
    }
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    if (typeof FileReader !== 'undefined') {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Falha ao ler arquivo de imagem.'));
      reader.readAsDataURL(blob);
      return;
    }
    blob
      .arrayBuffer()
      .then((buf) => {
        const u8 = new Uint8Array(buf);
        const b64 =
          typeof Buffer !== 'undefined'
            ? Buffer.from(u8).toString('base64')
            : btoa(String.fromCharCode(...u8));
        resolve(`data:${blob.type || 'image/webp'};base64,${b64}`);
      })
      .catch(reject);
  });
}

async function encodeCanvasWithTargetBytes(canvas, ctx, sourceImg, targetW, targetH, maxBytes) {
  canvas.width = targetW;
  canvas.height = targetH;
  ctx.clearRect(0, 0, targetW, targetH);
  ctx.drawImage(sourceImg, 0, 0, targetW, targetH);

  const formats = ['image/webp', 'image/jpeg'];
  const qualities = [0.84, 0.72, 0.58, 0.45, 0.34];

  for (const mime of formats) {
    for (const q of qualities) {
      let dataUrl = '';
      if (typeof canvas.convertToBlob === 'function') {
        try {
          const blob = await canvas.convertToBlob({ type: mime, quality: q });
          if (blob && blob.type === mime) {
            dataUrl = await blobToDataUrl(blob);
          }
        } catch {
          dataUrl = '';
        }
      } else if (typeof canvas.toDataURL === 'function') {
        const candidate = canvas.toDataURL(mime, q);
        if (candidate.startsWith(`data:${mime}`)) {
          dataUrl = candidate;
        }
      }
      if (!dataUrl) break;
      const bytes = estimateDataUrlBytes(dataUrl);
      if (bytes <= maxBytes) {
        return { dataUrl, mimeType: mime, bytes };
      }
    }
  }
  return null;
}

/**
 * Redimensiona e comprime capa enviada pelo usuário (lado maior <= 600 px, WebP/JPEG, <= 300 KB).
 */
export async function compressManualCoverImage(
  fileOrBlob,
  {
    maxDimension = MANUAL_COVER_MAX_DIMENSION,
    maxBytes = MANUAL_COVER_MAX_BYTES,
  } = {}
) {
  if (!fileOrBlob) {
    return { ok: false, error: 'Nenhuma imagem selecionada.' };
  }

  // Fallback para String data:image/... já enviada em testes/estado
  if (typeof fileOrBlob === 'string') {
    if (!/^data:image\//i.test(fileOrBlob)) {
      return { ok: false, error: 'Formato de imagem inválido.' };
    }
    const bytes = estimateDataUrlBytes(fileOrBlob);
    if (bytes > maxBytes) {
      return {
        ok: false,
        error: `Imagem excede o limite de ${Math.round(maxBytes / 1024)} KB após compressão.`,
      };
    }
    return {
      ok: true,
      dataUrl: fileOrBlob,
      mimeType: fileOrBlob.slice(5, fileOrBlob.indexOf(';')) || 'image/webp',
      bytes,
      width: null,
      height: null,
    };
  }

  const mime = String(fileOrBlob.type || '').toLowerCase();
  if (mime && !mime.startsWith('image/')) {
    return { ok: false, error: 'Selecione um arquivo de imagem válido (JPG, PNG ou WebP).' };
  }

  // Caminho Canvas no navegador
  if (typeof document !== 'undefined' || typeof OffscreenCanvas !== 'undefined') {
    let bitmap = null;
    try {
      if (typeof createImageBitmap === 'function') {
        bitmap = await createImageBitmap(fileOrBlob);
      }
    } catch {
      bitmap = null;
    }

    let sourceEl = bitmap;
    let origW = bitmap?.width || 0;
    let origH = bitmap?.height || 0;
    let objectUrl = null;

    if (!sourceEl && typeof Image !== 'undefined' && typeof URL !== 'undefined') {
      objectUrl = URL.createObjectURL(fileOrBlob);
      sourceEl = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Não foi possível decodificar a imagem.'));
        img.src = objectUrl;
      }).catch(() => null);
      origW = sourceEl?.naturalWidth || 0;
      origH = sourceEl?.naturalHeight || 0;
    }

    try {
      if (sourceEl && origW > 0 && origH > 0) {
        const scaleCandidates = [maxDimension, 480, 360];
        for (const maxSide of scaleCandidates) {
          const ratio = Math.max(origW, origH) > maxSide ? maxSide / Math.max(origW, origH) : 1;
          const targetW = Math.max(1, Math.round(origW * ratio));
          const targetH = Math.max(1, Math.round(origH * ratio));
          const canvas =
            typeof OffscreenCanvas !== 'undefined'
              ? new OffscreenCanvas(targetW, targetH)
              : document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (!ctx) break;
          const encoded = await encodeCanvasWithTargetBytes(
            canvas,
            ctx,
            sourceEl,
            targetW,
            targetH,
            maxBytes
          );
          if (encoded) {
            return {
              ok: true,
              dataUrl: encoded.dataUrl,
              mimeType: encoded.mimeType,
              bytes: encoded.bytes,
              width: targetW,
              height: targetH,
            };
          }
        }
        return {
          ok: false,
          error: `Não foi possível comprimir a imagem para até ${Math.round(maxBytes / 1024)} KB.`,
        };
      }
    } finally {
      bitmap?.close?.();
      if (objectUrl && typeof URL !== 'undefined') {
        URL.revokeObjectURL(objectUrl);
      }
    }
  }

  // Ambiente headless (ex.: testes Node): aceita Blob apenas se já estiver dentro do limite de tamanho
  if (typeof fileOrBlob.arrayBuffer === 'function') {
    if (Number(fileOrBlob.size) > maxBytes) {
      return {
        ok: false,
        error: `Imagem sem compressor Canvas excede ${Math.round(maxBytes / 1024)} KB.`,
      };
    }
    const dataUrl = await blobToDataUrl(fileOrBlob);
    return {
      ok: true,
      dataUrl,
      mimeType: mime || 'image/webp',
      bytes: Number(fileOrBlob.size) || estimateDataUrlBytes(dataUrl),
      width: null,
      height: null,
    };
  }

  return { ok: false, error: 'Não foi possível processar a imagem enviada.' };
}
