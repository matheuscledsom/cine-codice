export const MAX_COVER_IMAGE_RETRIES = 1;
export const COVER_RETRY_DELAY_MS = 650;

/**
 * Monta URL de nova tentativa para imagens de capa após erro transitório,
 * preservando URIs `data:` / `blob:` intactas.
 */
export function buildRetryCoverUrl(rawUrl, attempt = 0) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  if (attempt <= 0 || rawUrl.startsWith('data:') || rawUrl.startsWith('blob:')) {
    return rawUrl;
  }
  try {
    const parsed = new URL(rawUrl);
    parsed.searchParams.set('omni_retry', String(attempt));
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}
