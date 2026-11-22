import {
  extractFavoriteGenreLabels,
  migrateFavoriteGenresToObjects,
} from '../lib/genreCatalog.js';

export const FOCUS_OPTIONS_META = [
  { id: 'Cinéfilo Curador', iconName: 'Film' },
  { id: 'Maratonista de Séries', iconName: 'Tv' },
  { id: 'Curador de Animes', iconName: 'Clapperboard' },
  { id: 'Pesquisador de Cinema', iconName: 'Compass' },
  { id: 'Espectador Casual', iconName: 'Play' },
];

export const CRITERION_OPTIONS = [
  'Roteiro & Ritmo',
  'Direção & Fotografia/Animação',
  'Personagens & Atuação/Dublagem',
  'Trilha Sonora & Som',
];

export const GENRE_OPTIONS = [
  'Drama',
  'Ficção Científica',
  'Suspense & Thriller',
  'Terror',
  'Ação & Aventura',
  'Crime & Policial',
  'Animação',
  'Shonen',
  'Seinen',
  'Slice of Life',
  'Mecha',
  'Isekai',
  'Fantasia',
  'Comédia',
  'Romance',
  'Documentário',
  'Noir',
  'Clássicos',
];

export const DEFAULT_PREFERRED_CRITERIA = ['Roteiro & Ritmo'];

function parseCriteriaRaw(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        // Fallback texto simples
      }
    }
    if (trimmed.includes(',') || trimmed.includes(';')) {
      return trimmed
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return [trimmed];
  }
  return [];
}

export function normalizePreferredCriteria(
  rawCriteria,
  legacyCriterion,
  fallback = DEFAULT_PREFERRED_CRITERIA
) {
  const source =
    rawCriteria !== undefined && rawCriteria !== null && rawCriteria !== ''
      ? rawCriteria
      : legacyCriterion;

  const list = parseCriteriaRaw(source)
    .map((item) => String(item || '').trim())
    .filter(Boolean);

  const unique = Array.from(new Set(list));
  if (unique.length > 0) return unique;
  return Array.isArray(fallback) ? [...fallback] : [...DEFAULT_PREFERRED_CRITERIA];
}

export function normalizeFavoriteGenres(rawGenres) {
  return extractFavoriteGenreLabels(rawGenres);
}

export function normalizeFavoriteGenreObjects(rawGenres) {
  return migrateFavoriteGenresToObjects(rawGenres);
}

export function toggleCriterionInList(currentList, criterion) {
  const list = normalizePreferredCriteria(currentList, null, DEFAULT_PREFERRED_CRITERIA);
  const clean = String(criterion || '').trim();
  if (!clean) return list;
  if (list.includes(clean)) {
    return list.length > 1 ? list.filter((c) => c !== clean) : list;
  }
  return [...list, clean];
}

export function formatPreferredCriteriaText(profile) {
  const criteria = normalizePreferredCriteria(
    profile?.preferredCriteria ?? profile?.preferred_criteria,
    profile?.preferredCriterion ?? profile?.preferred_criterion
  );
  return criteria.join(', ');
}
