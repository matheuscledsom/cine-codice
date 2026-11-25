import { isCompressedManualCoverDataUrl } from '../lib/manualCovers.js';

export const CCODEX_FORMAT_VERSION = 'ccodex-v1';
export const PBKDF2_ITERATIONS = 150000;
export const AES_KEY_LENGTH_BITS = 256;
export const SALT_BYTE_LENGTH = 16;
export const IV_BYTE_LENGTH = 12;

export function uint8ToBase64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('base64');
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < u8.length; i += chunkSize) {
    const slice = u8.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export function base64ToUint8(base64Str) {
  const clean = String(base64Str || '').trim();
  if (!clean) return new Uint8Array(0);
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(clean, 'base64');
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  const binary = atob(clean);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function stripBase64MediaFromWorks(
  payload,
  { preserveCompressedManualCovers = false } = {}
) {
  if (!payload || typeof payload !== 'object') return payload;
  const sanitizeWork = (work) => {
    if (!work || typeof work !== 'object') return work;
    const next = { ...work };
    const compressedManual = preserveCompressedManualCovers
      ? isCompressedManualCoverDataUrl(next.manualCoverDataUrl)
        ? next.manualCoverDataUrl
        : isCompressedManualCoverDataUrl(next.coverUrl) && (next.isManual || next.ids?.source === 'manual')
          ? next.coverUrl
          : ''
      : '';

    if (typeof next.coverUrl === 'string' && next.coverUrl.startsWith('data:image/')) {
      next.coverUrl = compressedManual || '';
    }
    if (typeof next.manualCoverDataUrl === 'string' && next.manualCoverDataUrl.startsWith('data:image/')) {
      next.manualCoverDataUrl = compressedManual || '';
    }
    if (typeof next.backdropUrl === 'string' && next.backdropUrl.startsWith('data:image/')) {
      next.backdropUrl = '';
    }
    return next;
  };

  const clone = Array.isArray(payload) ? payload.map(sanitizeWork) : { ...payload };
  if (Array.isArray(clone.items)) {
    clone.items = clone.items.map(sanitizeWork);
  }
  if (clone.tables && typeof clone.tables === 'object' && Array.isArray(clone.tables.works)) {
    clone.tables = {
      ...clone.tables,
      works: clone.tables.works.map(sanitizeWork),
    };
  }
  return clone;
}

export async function compressGzipBytes(rawText) {
  const input = String(rawText ?? '');
  const encoder = new TextEncoder();
  const rawBytes = encoder.encode(input);

  if (typeof CompressionStream !== 'undefined') {
    const stream = new Blob([rawBytes]).stream().pipeThrough(new CompressionStream('gzip'));
    const arrayBuffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }

  throw new Error('CompressionStream("gzip") não está disponível neste ambiente.');
}

export async function decompressGzipBytes(compressedBytes) {
  const u8 =
    compressedBytes instanceof Uint8Array
      ? compressedBytes
      : new Uint8Array(compressedBytes);

  if (typeof DecompressionStream !== 'undefined') {
    const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
    const arrayBuffer = await new Response(stream).arrayBuffer();
    const decoder = new TextDecoder();
    return decoder.decode(arrayBuffer);
  }

  throw new Error('DecompressionStream("gzip") não está disponível neste ambiente.');
}

async function deriveAesGcmKey(password, saltBytes, iterations = PBKDF2_ITERATIONS) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('Web Crypto API (crypto.subtle) não disponível.');
  }
  const encoder = new TextEncoder();
  const keyMaterial = await subtle.importKey(
    'raw',
    encoder.encode(String(password)),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    {
      name: 'AES-GCM',
      length: AES_KEY_LENGTH_BITS,
    },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encodeCcodexBackup(payload, { password = '' } = {}) {
  const sanitizedPayload = stripBase64MediaFromWorks(payload, {
    preserveCompressedManualCovers: true,
  });
  const jsonString =
    typeof sanitizedPayload === 'string'
      ? sanitizedPayload
      : JSON.stringify(sanitizedPayload);

  const uncompressedBytes = new TextEncoder().encode(jsonString).byteLength;
  const gzipBytes = await compressGzipBytes(jsonString);
  const compressedBytes = gzipBytes.byteLength;
  const cleanPassword = String(password || '');

  if (cleanPassword.length > 0) {
    const salt = new Uint8Array(SALT_BYTE_LENGTH);
    const iv = new Uint8Array(IV_BYTE_LENGTH);
    globalThis.crypto.getRandomValues(salt);
    globalThis.crypto.getRandomValues(iv);

    const key = await deriveAesGcmKey(cleanPassword, salt, PBKDF2_ITERATIONS);
    const cipherBuffer = await globalThis.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      gzipBytes
    );
    const cipherBytes = new Uint8Array(cipherBuffer);

    return {
      format: CCODEX_FORMAT_VERSION,
      version: '1.3.0',
      createdAt: new Date().toISOString(),
      compression: 'gzip',
      encrypted: true,
      kdf: 'PBKDF2-SHA256',
      iterations: PBKDF2_ITERATIONS,
      cipher: 'AES-256-GCM',
      salt: uint8ToBase64(salt),
      iv: uint8ToBase64(iv),
      uncompressedBytes,
      compressedBytes,
      data: uint8ToBase64(cipherBytes),
    };
  }

  return {
    format: CCODEX_FORMAT_VERSION,
    version: '1.3.0',
    createdAt: new Date().toISOString(),
    compression: 'gzip',
    encrypted: false,
    uncompressedBytes,
    compressedBytes,
    data: uint8ToBase64(gzipBytes),
  };
}

export function isCcodexEnvelope(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return false;
  }
  return candidate.format === CCODEX_FORMAT_VERSION && typeof candidate.data === 'string';
}

export async function decodeCcodexOrJsonBackup(rawInput, { password = '' } = {}) {
  let parsed = null;
  try {
    parsed = typeof rawInput === 'string' ? JSON.parse(rawInput) : rawInput;
  } catch {
    return {
      ok: false,
      error: 'Arquivo de backup inválido ou corrompido.',
    };
  }

  if (!parsed || typeof parsed !== 'object') {
    return {
      ok: false,
      error: 'Formato de backup não reconhecido.',
    };
  }

  if (isCcodexEnvelope(parsed)) {
    try {
      let gzipBytes;
      if (parsed.encrypted) {
        const cleanPassword = String(password || '');
        if (!cleanPassword) {
          return {
            ok: false,
            requiresPassword: true,
            encrypted: true,
            format: CCODEX_FORMAT_VERSION,
            error:
              'Este backup .ccodex está criptografado (AES-256-GCM). Informe a senha para desbloquear.',
          };
        }

        const salt = base64ToUint8(parsed.salt);
        const iv = base64ToUint8(parsed.iv);
        const cipherBytes = base64ToUint8(parsed.data);
        const iterations = Number(parsed.iterations) || PBKDF2_ITERATIONS;

        try {
          const key = await deriveAesGcmKey(cleanPassword, salt, iterations);
          const decryptedBuffer = await globalThis.crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            key,
            cipherBytes
          );
          gzipBytes = new Uint8Array(decryptedBuffer);
        } catch {
          return {
            ok: false,
            requiresPassword: true,
            invalidPassword: true,
            encrypted: true,
            format: CCODEX_FORMAT_VERSION,
            error:
              'Senha incorreta ou dados criptografados adulterados (falha de verificação AES-GCM).',
          };
        }
      } else {
        gzipBytes = base64ToUint8(parsed.data);
      }

      const jsonText = await decompressGzipBytes(gzipBytes);
      const innerPayload = JSON.parse(jsonText);

      return {
        ok: true,
        format: CCODEX_FORMAT_VERSION,
        encrypted: Boolean(parsed.encrypted),
        uncompressedBytes: parsed.uncompressedBytes || jsonText.length,
        compressedBytes: parsed.compressedBytes || gzipBytes.byteLength,
        payload: innerPayload,
        jsonText,
      };
    } catch {
      return {
        ok: false,
        error: 'Falha ao descomprimir o arquivo .ccodex (GZIP inválido).',
      };
    }
  }

  const jsonText = typeof rawInput === 'string' ? rawInput : JSON.stringify(parsed);
  return {
    ok: true,
    format: 'legacy-json',
    encrypted: false,
    payload: parsed,
    jsonText,
  };
}
