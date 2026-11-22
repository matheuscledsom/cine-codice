const OPENVERSE_GIF_API = 'https://api.openverse.org/v1/images/';

export function isDirectGifUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  return (
    /^data:image\/gif/i.test(trimmed) ||
    /\.gif(\?.*)?$/i.test(trimmed)
  );
}

export async function searchOpenverseGifs(query, { signal } = {}) {
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) return [];

  const url = `${OPENVERSE_GIF_API}?q=${encodeURIComponent(cleanQuery)}&extension=gif&page_size=12`;
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json();
  if (!Array.isArray(data?.results)) return [];

  return data.results
    .filter((item) => item && typeof item.url === 'string' && item.url.startsWith('http'))
    .map((item) => ({
      id: String(item.id || item.url),
      url: item.url.replace(/^http:\/\//i, 'https://'),
      thumbnailUrl: (item.thumbnail || item.url).replace(/^http:\/\//i, 'https://'),
      title: item.title || 'GIF',
      creator: item.creator || '',
    }));
}
