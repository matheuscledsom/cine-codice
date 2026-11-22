import { hashFallbackPalette, hashString32 } from './dominantColor.js';

const PATTERN_KINDS = [
  'shutter',
  'anamorphic',
  'reel',
  'halftone',
  'diamond',
];

export function escapeSvgText(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function wrapTitleLines(title = '', maxChars = 15, maxLines = 3) {
  const words = String(title || 'Sem Título').trim().split(/\s+/);
  const lines = [];
  let current = '';

  for (const word of words) {
    if (!current) {
      current = word.slice(0, maxChars);
      continue;
    }
    if ((current + ' ' + word).length <= maxChars) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word.slice(0, maxChars);
      if (lines.length >= maxLines) break;
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
  }
  return lines.slice(0, maxLines);
}

function buildCinemaPattern(kind, accentColor, strokeColor) {
  if (kind === 'shutter') {
    return `
      <circle cx="100" cy="186" r="54" fill="none" stroke="${accentColor}" stroke-width="1.4" opacity="0.52" />
      <circle cx="100" cy="186" r="34" fill="none" stroke="${strokeColor}" stroke-width="1" opacity="0.28" />
      <circle cx="100" cy="186" r="10" fill="${accentColor}" opacity="0.38" />
      <line x1="46" y1="186" x2="154" y2="186" stroke="${strokeColor}" stroke-width="0.9" opacity="0.22" />
      <line x1="100" y1="132" x2="100" y2="240" stroke="${strokeColor}" stroke-width="0.9" opacity="0.22" />
    `;
  }
  if (kind === 'anamorphic') {
    return `
      <rect x="24" y="146" width="152" height="64" fill="none" stroke="${accentColor}" stroke-width="1.4" opacity="0.55" />
      <rect x="30" y="152" width="140" height="52" fill="${strokeColor}" opacity="0.08" />
      <line x1="24" y1="222" x2="176" y2="222" stroke="${accentColor}" stroke-width="1" opacity="0.35" />
      <line x1="24" y1="230" x2="132" y2="230" stroke="${strokeColor}" stroke-width="1" opacity="0.2" />
    `;
  }
  if (kind === 'reel') {
    const holes = [];
    for (let i = 0; i < 6; i += 1) {
      const y = 136 + i * 20;
      holes.push(`<rect x="26" y="${y}" width="6" height="10" rx="1" fill="${accentColor}" opacity="0.45" />`);
      holes.push(`<rect x="168" y="${y}" width="6" height="10" rx="1" fill="${accentColor}" opacity="0.45" />`);
    }
    return `
      <rect x="42" y="136" width="116" height="110" fill="${strokeColor}" opacity="0.08" stroke="${strokeColor}" stroke-opacity="0.25" stroke-width="1" />
      ${holes.join('\n')}
    `;
  }
  if (kind === 'halftone') {
    const dots = [];
    for (let row = 0; row < 5; row += 1) {
      for (let col = 0; col < 7; col += 1) {
        const cx = 34 + col * 22;
        const cy = 144 + row * 22;
        const r = 1.6 + ((row + col) % 3) * 1.1;
        dots.push(`<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="${accentColor}" opacity="0.4" />`);
      }
    }
    return dots.join('\n');
  }
  return `
    <polygon points="100,132 162,190 100,248 38,190" fill="none" stroke="${accentColor}" stroke-width="1.5" opacity="0.52" />
    <polygon points="100,148 144,190 100,232 56,190" fill="${strokeColor}" opacity="0.1" />
  `;
}

export function generateEditorialPosterSvg({
  title = 'Sem Título',
  director = '',
  author = '',
  workType = 'movie',
  releaseYear = null,
  genre = '',
  palette = null,
} = {}) {
  const creator = director || author || '';
  const key = `${title}::${creator}::${workType}::${genre}`;
  const hash = hashString32(key);
  const patternKind = PATTERN_KINDS[hash % PATTERN_KINDS.length];
  const resolved = palette || hashFallbackPalette(key);
  const bg = resolved.bg || '#1C2530';
  const fg = resolved.fg || '#FAF8F4';
  const accent = resolved.accent || '#E2E8F0';

  const lines = wrapTitleLines(title);
  const titleSvg = lines
    .map((line, i) => {
      const y = 52 + i * 21;
      return `<text x="22" y="${y}" font-family="'Newsreader Variable', Georgia, serif" font-size="16" font-weight="600" fill="${fg}">${escapeSvgText(line)}</text>`;
    })
    .join('\n  ');

  const safeCreator = escapeSvgText(String(creator || '').slice(0, 26));
  const typeTag = escapeSvgText(
    workType === 'anime' ? 'ANIME' : workType === 'series' ? 'SÉRIE' : 'FILME'
  );
  const yearLabel = releaseYear ? escapeSvgText(String(releaseYear)) : '';
  const patternMarkup = buildCinemaPattern(patternKind, accent, fg);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300" width="200" height="300" role="img" aria-label="${escapeSvgText(title)}">
  <rect width="200" height="300" rx="4" fill="${bg}" />
  <rect x="8" y="8" width="184" height="284" rx="2" fill="none" stroke="${fg}" stroke-opacity="0.22" stroke-width="1" />
  <line x1="22" y1="24" x2="178" y2="24" stroke="${accent}" stroke-opacity="0.45" stroke-width="1" />
  <text x="22" y="118" font-family="'Source Sans 3 Variable', system-ui, sans-serif" font-size="8.5" letter-spacing="1.8" fill="${accent}" fill-opacity="0.92">${typeTag}${yearLabel ? ` · ${yearLabel}` : ''}</text>
  ${titleSvg}
  ${patternMarkup}
  <line x1="22" y1="262" x2="178" y2="262" stroke="${fg}" stroke-opacity="0.22" stroke-width="1" />
  <text x="22" y="278" font-family="'Source Sans 3 Variable', system-ui, sans-serif" font-size="10.5" fill="${fg}" fill-opacity="0.86">${safeCreator || 'Cinemateca Cine Códice'}</text>
</svg>`;
}

export function buildGeneratedPosterDataUri(options = {}) {
  const svg = generateEditorialPosterSvg(options);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
