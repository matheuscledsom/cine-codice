/**
 * Catálogo estruturado de gêneros por grupo (Cinema, Séries, Animes, Outros)
 * e migração retrocompatível de `string[]` → `{ group, id, label, tmdbGenreId?, anilistKey? }`.
 *
 * Módulo puro em .js sem React ou acesso a DOM (D7).
 */

export const GENRE_GROUPS = Object.freeze({
  cinema: 'cinema',
  series: 'series',
  animes: 'animes',
  outros: 'outros',
});

export const GENRE_GROUPS_META = Object.freeze([
  { id: 'cinema', label: 'Cinema (Filmes)' },
  { id: 'series', label: 'Séries' },
  { id: 'animes', label: 'Animes' },
]);

export const FOCUS_GROUP_PRIORITY = Object.freeze({
  'Cinéfilo Curador': 'cinema',
  'Pesquisador de Cinema': 'cinema',
  'Maratonista de Séries': 'series',
  'Curador de Animes': 'animes',
});

export const STRUCTURED_GENRE_CATALOG = Object.freeze([
  // Cinema (Filmes)
  { group: 'cinema', id: 'cinema-drama', label: 'Drama', tmdbGenreId: 18 },
  { group: 'cinema', id: 'cinema-scifi', label: 'Ficção Científica', tmdbGenreId: 878 },
  { group: 'cinema', id: 'cinema-thriller', label: 'Suspense & Thriller', tmdbGenreId: 53 },
  { group: 'cinema', id: 'cinema-horror', label: 'Terror', tmdbGenreId: 27 },
  { group: 'cinema', id: 'cinema-action', label: 'Ação & Aventura', tmdbGenreId: 28 },
  { group: 'cinema', id: 'cinema-crime', label: 'Crime & Policial', tmdbGenreId: 80 },
  { group: 'cinema', id: 'cinema-fantasy', label: 'Fantasia', tmdbGenreId: 14 },
  { group: 'cinema', id: 'cinema-comedy', label: 'Comédia', tmdbGenreId: 35 },
  { group: 'cinema', id: 'cinema-romance', label: 'Romance', tmdbGenreId: 10749 },
  { group: 'cinema', id: 'cinema-documentary', label: 'Documentário', tmdbGenreId: 99 },
  { group: 'cinema', id: 'cinema-animation', label: 'Animação', tmdbGenreId: 16 },
  { group: 'cinema', id: 'cinema-noir', label: 'Noir', tmdbGenreId: 80 },
  { group: 'cinema', id: 'cinema-classics', label: 'Clássicos', tmdbGenreId: 18 },

  // Séries
  { group: 'series', id: 'series-drama', label: 'Drama', tmdbGenreId: 18 },
  { group: 'series', id: 'series-scifi-fantasy', label: 'Ficção Científica', tmdbGenreId: 10765 },
  { group: 'series', id: 'series-mystery', label: 'Suspense & Thriller', tmdbGenreId: 9648 },
  { group: 'series', id: 'series-crime', label: 'Crime & Policial', tmdbGenreId: 80 },
  { group: 'series', id: 'series-action-adv', label: 'Ação & Aventura', tmdbGenreId: 10759 },
  { group: 'series', id: 'series-comedy', label: 'Comédia', tmdbGenreId: 35 },
  { group: 'series', id: 'series-documentary', label: 'Documentário', tmdbGenreId: 99 },

  // Animes — kind: 'genre' (gêneros AniList) vs 'tag' (demografia/subgênero AniList)
  { group: 'animes', kind: 'genre', id: 'animes-slice-of-life', label: 'Slice of Life', anilistKey: 'Slice of Life' },
  { group: 'animes', kind: 'genre', id: 'animes-action', label: 'Ação & Aventura', anilistKey: 'Action' },
  { group: 'animes', kind: 'genre', id: 'animes-drama', label: 'Drama', anilistKey: 'Drama' },
  { group: 'animes', kind: 'genre', id: 'animes-fantasy', label: 'Fantasia', anilistKey: 'Fantasy' },
  { group: 'animes', kind: 'genre', id: 'animes-scifi', label: 'Ficção Científica', anilistKey: 'Sci-Fi' },
  { group: 'animes', kind: 'genre', id: 'animes-romance', label: 'Romance', anilistKey: 'Romance' },
  { group: 'animes', kind: 'genre', id: 'animes-horror', label: 'Terror', anilistKey: 'Horror' },
  { group: 'animes', kind: 'tag', id: 'animes-shonen', label: 'Shonen', anilistKey: 'Shounen' },
  { group: 'animes', kind: 'tag', id: 'animes-seinen', label: 'Seinen', anilistKey: 'Seinen' },
  { group: 'animes', kind: 'tag', id: 'animes-isekai', label: 'Isekai', anilistKey: 'Isekai' },
  { group: 'animes', kind: 'tag', id: 'animes-mecha', label: 'Mecha', anilistKey: 'Mecha' },
]);

const LEGACY_GENRE_CORRESPONDENCE = new Map([
  ['drama', 'cinema-drama'],
  ['ficcao cientifica', 'cinema-scifi'],
  ['sci fi', 'cinema-scifi'],
  ['suspense thriller', 'cinema-thriller'],
  ['suspense', 'cinema-thriller'],
  ['thriller', 'cinema-thriller'],
  ['terror', 'cinema-horror'],
  ['horror', 'cinema-horror'],
  ['acao aventura', 'cinema-action'],
  ['acao', 'cinema-action'],
  ['aventura', 'cinema-action'],
  ['crime policial', 'cinema-crime'],
  ['crime', 'cinema-crime'],
  ['animacao', 'cinema-animation'],
  ['fantasia', 'cinema-fantasy'],
  ['comedia', 'cinema-comedy'],
  ['romance', 'cinema-romance'],
  ['documentario', 'cinema-documentary'],
  ['noir', 'cinema-noir'],
  ['classicos', 'cinema-classics'],
  ['shonen', 'animes-shonen'],
  ['shounen', 'animes-shonen'],
  ['seinen', 'animes-seinen'],
  ['slice of life', 'animes-slice-of-life'],
  ['mecha', 'animes-mecha'],
  ['isekai', 'animes-isekai'],
]);

function normToken(raw = '') {
  return String(raw || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function slugifyToken(raw = '') {
  return normToken(raw).replace(/\s+/g, '-') || 'custom';
}

export function extractGenreLabel(entry) {
  if (!entry) return '';
  if (typeof entry === 'string') return entry.trim();
  if (typeof entry === 'object' && entry.label) return String(entry.label).trim();
  return '';
}

export function sanitizeGenreEntryObject(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const label = String(entry.label || '').trim();
  if (!label) return null;
  const group = ['cinema', 'series', 'animes', 'outros'].includes(entry.group)
    ? entry.group
    : 'outros';
  const id = String(entry.id || `${group}-${slugifyToken(label)}`).trim();
  const out = {
    group,
    id,
    label,
  };
  if (entry.kind === 'genre' || entry.kind === 'tag') out.kind = entry.kind;
  if (entry.tmdbGenreId !== undefined && entry.tmdbGenreId !== null) {
    out.tmdbGenreId = Number(entry.tmdbGenreId);
  }
  if (entry.anilistKey) {
    out.anilistKey = String(entry.anilistKey);
  }
  return out;
}

/**
 * Migra um array misto (strings antigas e/ou objetos já migrados) para objetos canônicos
 * `{ group, id, label, tmdbGenreId?, anilistKey? }`.
 * Termos sem correspondência viram `group: 'outros'` preservando o texto original.
 */
export function migrateFavoriteGenresToObjects(rawGenres) {
  let list = rawGenres;
  if (typeof list === 'string') {
    list = list
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (!Array.isArray(list)) return [];

  const catalogById = new Map(STRUCTURED_GENRE_CATALOG.map((g) => [g.id, g]));
  const result = [];
  const seenIds = new Set();

  for (const item of list) {
    let resolved = null;

    if (item && typeof item === 'object') {
      resolved = sanitizeGenreEntryObject(item);
    } else if (typeof item === 'string') {
      const cleanLabel = item.trim();
      if (!cleanLabel) continue;
      const mappedId = LEGACY_GENRE_CORRESPONDENCE.get(normToken(cleanLabel));
      if (mappedId && catalogById.has(mappedId)) {
        resolved = sanitizeGenreEntryObject(catalogById.get(mappedId));
      } else {
        resolved = {
          group: 'outros',
          id: `outros-${slugifyToken(cleanLabel)}`,
          label: cleanLabel,
        };
      }
    }

    if (resolved && !seenIds.has(resolved.id)) {
      seenIds.add(resolved.id);
      result.push(resolved);
    }
  }

  return result;
}

/**
 * Extrai lista deduplicada de labels em texto para compatibilidade com consumidores legados.
 */
export function extractFavoriteGenreLabels(rawGenres) {
  const objs = migrateFavoriteGenresToObjects(rawGenres);
  return Array.from(new Set(objs.map((g) => g.label).filter(Boolean)));
}

/**
 * Ordena os 3 grupos fixos (`Cinema (Filmes)`, `Séries`, `Animes`) colocando
 * primeiro os grupos correspondentes aos focos escolhidos pelo espectador.
 */
export function getOrderedGenreGroups(viewerFocus = []) {
  const focusList = Array.isArray(viewerFocus)
    ? viewerFocus
    : typeof viewerFocus === 'string' && viewerFocus.trim()
      ? [viewerFocus.trim()]
      : [];

  const prioritizedIds = [];
  for (const focus of focusList) {
    const groupId = FOCUS_GROUP_PRIORITY[String(focus || '').trim()];
    if (groupId && !prioritizedIds.includes(groupId)) {
      prioritizedIds.push(groupId);
    }
  }

  for (const meta of GENRE_GROUPS_META) {
    if (!prioritizedIds.includes(meta.id)) {
      prioritizedIds.push(meta.id);
    }
  }

  return prioritizedIds
    .map((id) => GENRE_GROUPS_META.find((m) => m.id === id))
    .filter(Boolean);
}

/**
 * Retorna os gêneros estruturados de um grupo fixo (`cinema` | `series` | `animes`).
 * Em `animes`, separa `genres` (kind: 'genre') de `tags` (kind: 'tag', exclusivas de Animes).
 */
export function getStructuredGenresByGroup(groupId) {
  const entries = STRUCTURED_GENRE_CATALOG.filter((entry) => entry.group === groupId);
  if (groupId === 'animes') {
    return {
      genres: entries.filter((entry) => entry.kind !== 'tag'),
      tags: entries.filter((entry) => entry.kind === 'tag'),
    };
  }
  return {
    genres: entries,
    tags: [],
  };
}

/**
 * Alterna um foco na lista de `viewerFocus`.
 * Em onboarding (`allowEmpty = true`), permite ficar vazio para acionar a trava acessível do botão Avançar.
 */
export function toggleViewerFocusInList(
  currentList = [],
  focusId,
  { allowEmpty = true } = {}
) {
  const cleanId = String(focusId || '').trim();
  const normalized = Array.from(
    new Set(
      (Array.isArray(currentList) ? currentList : [])
        .map((v) => String(v || '').trim())
        .filter(Boolean)
    )
  );
  if (!cleanId) return normalized;

  if (normalized.includes(cleanId)) {
    if (!allowEmpty && normalized.length <= 1) {
      return normalized;
    }
    return normalized.filter((item) => item !== cleanId);
  }
  return [...normalized, cleanId];
}

/**
 * Alterna um gênero estruturado `{ group, id, label, ... }` na lista mantendo
 * demais itens e preservando gêneros migrados em `group: 'outros'`.
 */
export function toggleStructuredGenre(currentList = [], targetEntry) {
  const objs = migrateFavoriteGenresToObjects(currentList);
  const candidate =
    targetEntry && typeof targetEntry === 'object'
      ? sanitizeGenreEntryObject(targetEntry)
      : migrateFavoriteGenresToObjects([targetEntry])[0] || null;

  if (!candidate) return objs;

  const exists = objs.some((entry) => entry.id === candidate.id);
  if (exists) {
    return objs.filter((entry) => entry.id !== candidate.id);
  }
  return [...objs, candidate];
}
