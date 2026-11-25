/**
 * Profundidade Real de Música (v2.5.0 Fase B).
 *
 * Regras:
 * - Toda média derivada mostra cobertura (ex.: "5 de 12 faixas avaliadas"),
 *   ignora itens sem nota e fica marcada "provisória" com menos de 3 itens avaliados.
 * - Média derivada NUNCA sobrescreve a estrela manual da obra.
 * - Subgêneros: as 2 a 3 tags mais votadas acima de um limite mínimo, editáveis pelo usuário.
 * - Completude da discografia: total vem de release-groups do MusicBrainz
 *   (tipo primário Album, sem tipos secundários), com fonte visível e opção "não conta"
 *   por álbum; sem MusicBrainz mostra apenas a contagem.
 */

import { computeEntityCompleteness } from './entityHelpers.js';
import { score100ToStars } from './ratingModel.js';

export const MIN_DERIVED_AVERAGE_ITEMS = 3;
export const SUBGENRE_TAG_MIN_VOTES = 20;

const IGNORED_SUBGENRE_TAGS = new Set([
  'seen live',
  'favorites',
  'favourite',
  'favorite',
  'my favorite',
  'albums i own',
  'own',
  'love',
  'loved',
  'awesome',
  'amazing',
  'best',
  'good',
  'great',
  'spotify',
  'vinyl',
  'cd',
  'album',
  'albums',
  'music',
  'british',
  'american',
  'brazilian',
  'uk',
  'usa',
  'english',
  'male vocalists',
  'female vocalists',
  'under 2000 listeners',
  '00s',
  '90s',
  '80s',
  '70s',
  '60s',
  '10s',
  '20s',
]);

const UPPERCASE_ACRONYMS = new Set([
  'mpb',
  'r&b',
  'edm',
  'idmb',
  'idm',
  'ebm',
  'dnb',
  'ost',
  'j-pop',
  'j-rock',
  'k-pop',
  'ukg',
]);

export function normalizeMusicKey(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function formatSubgenreTagLabel(rawName) {
  const clean = String(rawName || '').trim().replace(/\s+/g, ' ');
  if (!clean) return '';
  const lower = clean.toLowerCase();
  if (UPPERCASE_ACRONYMS.has(lower)) {
    return lower.toUpperCase();
  }
  return clean
    .split(' ')
    .map((word) =>
      word
        .split('-')
        .map((part) => {
          const pLow = part.toLowerCase();
          if (UPPERCASE_ACRONYMS.has(pLow)) return pLow.toUpperCase();
          return pLow ? pLow[0].toUpperCase() + pLow.slice(1) : '';
        })
        .join('-')
    )
    .join(' ');
}

/**
 * Calcula média derivada transparente com cobertura e flag "provisória" (< 3 itens avaliados).
 * Ignora completamente itens sem nota (ausente nunca é zero).
 */
export function computeDerivedAverage({
  ratings = [],
  totalItems = 0,
  unit = 'track',
} = {}) {
  const valid = (Array.isArray(ratings) ? ratings : []).filter(
    (v) => typeof v === 'number' && Number.isFinite(v)
  );
  const ratedCount = valid.length;
  const effectiveTotal = Math.max(Math.max(0, Math.floor(Number(totalItems) || 0)), ratedCount);

  const isAlbum = unit === 'album';
  const unitNoun = isAlbum
    ? effectiveTotal === 1
      ? 'álbum avaliado'
      : 'álbuns avaliados'
    : effectiveTotal === 1
      ? 'faixa avaliada'
      : 'faixas avaliadas';

  if (ratedCount === 0) {
    return {
      average: null,
      ratedCount: 0,
      totalCount: effectiveTotal,
      provisional: false,
      provisionalLabel: '',
      coverageLabel:
        effectiveTotal > 0 ? `0 de ${effectiveTotal} ${unitNoun}` : 'Sem avaliações',
    };
  }

  const sum = valid.reduce((acc, v) => acc + v, 0);
  const average = Math.round((sum / ratedCount) * 10) / 10;
  const provisional = ratedCount < MIN_DERIVED_AVERAGE_ITEMS;

  return {
    average,
    ratedCount,
    totalCount: effectiveTotal,
    provisional,
    provisionalLabel: provisional ? 'provisória' : '',
    coverageLabel: `${ratedCount} de ${effectiveTotal} ${unitNoun}`,
  };
}

/**
 * Resolve exibição de nota do álbum garantindo que a média derivada das faixas
 * NUNCA sobrescreve a estrela manual do usuário.
 */
export function resolveAlbumDerivedVsManualRating(work = {}, tracksDerived = null) {
  const hasManualRating =
    work &&
    work.rating !== null &&
    work.rating !== undefined &&
    work.rating !== '' &&
    Number.isFinite(Number(work.rating)) &&
    work.ratingSource !== 'legacy-default';

  const manualScore100 = hasManualRating ? Math.round(Number(work.rating)) : null;
  const manualStars = manualScore100 !== null ? score100ToStars(manualScore100) : null;

  return {
    manualScore100,
    manualStars,
    manualRatingPreserved: true,
    derivedAverage10: tracksDerived?.average ?? null,
    derivedCoverageLabel: tracksDerived?.coverageLabel || '',
    derivedProvisional: Boolean(tracksDerived?.provisional),
    derivedProvisionalLabel: tracksDerived?.provisionalLabel || '',
  };
}

/**
 * Seleciona as 2 a 3 tags de subgênero mais votadas acima de um limite mínimo.
 * Remove ruído (anos, "seen live", nome do próprio artista, etc.).
 */
export function selectTopSubgenreTags(
  rawTags = [],
  { minVotes = SUBGENRE_TAG_MIN_VOTES, maxTags = 3, excludeNames = [] } = {}
) {
  const threshold = Math.max(1, Number(minVotes) || SUBGENRE_TAG_MIN_VOTES);
  const limit = Math.max(1, Math.min(3, Number(maxTags) || 3));
  const blockedNorms = new Set(
    (Array.isArray(excludeNames) ? excludeNames : [])
      .map((n) => normalizeMusicKey(n))
      .filter(Boolean)
  );

  const candidates = [];
  const seen = new Set();

  for (const tag of Array.isArray(rawTags) ? rawTags : []) {
    if (!tag || typeof tag !== 'object') continue;
    const rawName = String(tag.name || '').trim();
    if (!rawName || rawName.length < 2 || rawName.length > 42) continue;
    const votes = Number(tag.count ?? tag.votes ?? 0);
    if (!Number.isFinite(votes) || votes < threshold) continue;
    if (/^\d{4}s?$/.test(rawName)) continue;

    const lower = rawName.toLowerCase();
    const norm = normalizeMusicKey(rawName);
    if (!norm || seen.has(norm)) continue;
    if (IGNORED_SUBGENRE_TAGS.has(lower) || blockedNorms.has(norm)) continue;

    seen.add(norm);
    candidates.push({
      name: formatSubgenreTagLabel(rawName),
      votes,
      norm,
    });
  }

  candidates.sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name, 'pt-BR'));
  return candidates.slice(0, limit).map((c) => c.name);
}

/**
 * Operações editáveis pelo usuário sobre a lista de subgêneros da obra.
 */
export function updateEditableSubgenres(
  currentList = [],
  { add = '', remove = '', replaceWith = null, maxItems = 6 } = {}
) {
  const base = Array.isArray(replaceWith)
    ? replaceWith
    : Array.isArray(currentList)
      ? currentList
      : [];

  const out = [];
  const seen = new Set();
  const pushClean = (raw) => {
    const label = formatSubgenreTagLabel(raw);
    const norm = normalizeMusicKey(label);
    if (!norm || seen.has(norm)) return;
    seen.add(norm);
    out.push(label);
  };

  const removeNorm = normalizeMusicKey(remove);
  for (const entry of base) {
    if (removeNorm && normalizeMusicKey(entry) === removeNorm) continue;
    pushClean(entry);
  }
  if (add) {
    pushClean(add);
  }

  return out.slice(0, Math.max(1, Number(maxItems) || 6));
}

/**
 * Filtra release-groups do MusicBrainz mantendo EXCLUSIVAMENTE:
 * - primary-type === 'Album'
 * - secondary-types vazio (exclui Compilation, Live, Remix, Soundtrack, Spokenword, etc.)
 */
export function filterMusicBrainzStudioAlbums(releaseGroups = []) {
  const seen = new Set();
  const albums = [];

  for (const rg of Array.isArray(releaseGroups) ? releaseGroups : []) {
    if (!rg || typeof rg !== 'object') continue;
    const primary = String(rg['primary-type'] ?? rg.primaryType ?? '').trim().toLowerCase();
    if (primary !== 'album') continue;

    const secondaryRaw = rg['secondary-types'] ?? rg.secondaryTypes ?? [];
    const secondaryList = Array.isArray(secondaryRaw) ? secondaryRaw.filter(Boolean) : [];
    if (secondaryList.length > 0) continue;

    const title = String(rg.title || '').trim();
    const normTitle = normalizeMusicKey(title);
    if (!normTitle || seen.has(normTitle)) continue;
    seen.add(normTitle);

    const firstDate = String(rg['first-release-date'] ?? rg.firstReleaseDate ?? '').trim();
    const yearMatch = firstDate.match(/^(\d{4})/);

    albums.push({
      mbid: String(rg.id || '').trim() || null,
      key: String(rg.id || '').trim() || `title:${normTitle}`,
      title,
      normTitle,
      releaseYear: yearMatch ? Number(yearMatch[1]) : null,
      primaryType: 'Album',
      secondaryTypes: [],
    });
  }

  albums.sort((a, b) => {
    const ya = a.releaseYear ?? 9999;
    const yb = b.releaseYear ?? 9999;
    if (ya !== yb) return ya - yb;
    return a.title.localeCompare(b.title, 'pt-BR');
  });

  return albums;
}

/**
 * Classifica todos os release-groups do MusicBrainz em categorias transparentes:
 * - `studio`: Álbuns de Estúdio (`primary-type: Album` sem `secondary-types`)
 * - `live`: Ao Vivo (`secondary-types` inclui Live)
 * - `ep_single`: EPs & Singles (`primary-type: EP` ou `Single`)
 * - `compilation`: Coletâneas, Remixes & Extras
 */
export function categorizeMusicBrainzReleaseGroups(releaseGroups = []) {
  const seen = new Set();
  const categorized = [];

  for (const rg of Array.isArray(releaseGroups) ? releaseGroups : []) {
    if (!rg || typeof rg !== 'object') continue;
    const title = String(rg.title || '').trim();
    const normTitle = normalizeMusicKey(title);
    if (!normTitle) continue;

    const primaryRaw = String(rg['primary-type'] ?? rg.primaryType ?? '').trim();
    const primary = primaryRaw.toLowerCase();
    const secondaryRaw = rg['secondary-types'] ?? rg.secondaryTypes ?? [];
    const secondaryList = Array.isArray(secondaryRaw)
      ? secondaryRaw.map((s) => String(s || '').trim()).filter(Boolean)
      : [];
    const secLower = secondaryList.map((s) => s.toLowerCase());

    let releaseCategory = 'compilation';
    let workType = 'album';
    if (secLower.includes('live')) {
      releaseCategory = 'live';
      workType = 'live_show';
    } else if (primary === 'album' && secondaryList.length === 0) {
      releaseCategory = 'studio';
      workType = 'album';
    } else if (primary === 'ep' || primary === 'single') {
      releaseCategory = 'ep_single';
      workType = 'ep_single';
    } else {
      releaseCategory = 'compilation';
      workType = 'album';
    }

    const dedupKey = `${releaseCategory}::${normTitle}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    const firstDate = String(rg['first-release-date'] ?? rg.firstReleaseDate ?? '').trim();
    const yearMatch = firstDate.match(/^(\d{4})/);
    const mbid = String(rg.id || '').trim() || null;

    categorized.push({
      id: mbid ? `mb-${mbid}` : `mb-${releaseCategory}-${normTitle}`,
      mbid,
      key: mbid || `title:${normTitle}`,
      title,
      normTitle,
      releaseYear: yearMatch ? Number(yearMatch[1]) : null,
      primaryType: primaryRaw || 'Album',
      secondaryTypes: secondaryList,
      releaseCategory,
      workType,
      domain: 'music',
      ids: mbid ? { musicbrainz: mbid } : {},
      sourceBadge: 'MusicBrainz',
    });
  }

  categorized.sort((a, b) => {
    const ya = a.releaseYear ?? 9999;
    const yb = b.releaseYear ?? 9999;
    if (ya !== yb) return ya - yb;
    return a.title.localeCompare(b.title, 'pt-BR');
  });

  return categorized;
}

export function makeDiscographyExcludeKey(entry = {}) {
  const mbid = String(entry.mbid || entry.musicBrainzId || entry.ids?.musicbrainz || '').trim();
  if (mbid) return `mbid:${mbid}`;
  const norm = normalizeMusicKey(entry.title || '');
  return norm ? `title:${norm}` : '';
}

/**
 * Calcula completude da discografia:
 * - Com MusicBrainz (available === true): usa release-groups Album (sem tipos secundários)
 *   com fonte visível e suporte a "não conta" por álbum.
 * - Sem MusicBrainz: mostra APENAS a contagem (sem total nem percentual inventado).
 */
export function computeDiscographyCompleteness({
  catalogReleases = [],
  mbStudioAlbums = null,
  excludedKeys = [],
  manualTotal = null,
  manualUniverseTotal = null,
} = {}) {
  const excludedSet = new Set(
    (Array.isArray(excludedKeys) ? excludedKeys : []).map((k) => String(k || '').trim()).filter(Boolean)
  );

  const safeCatalog = (Array.isArray(catalogReleases) ? catalogReleases : []).filter(Boolean);
  for (const rel of safeCatalog) {
    const work = rel.work || rel;
    if (work?.excludeFromDiscography) {
      const k = makeDiscographyExcludeKey(work);
      if (k) excludedSet.add(k);
      const tKey = `title:${normalizeMusicKey(work.title || '')}`;
      if (tKey !== 'title:') excludedSet.add(tKey);
    }
  }

  const isExcluded = (entry) => {
    if (entry?.excludeFromDiscography || entry?.work?.excludeFromDiscography) return true;
    const key = makeDiscographyExcludeKey(entry);
    const titleKey = `title:${normalizeMusicKey(entry?.title || '')}`;
    return Boolean((key && excludedSet.has(key)) || (titleKey !== 'title:' && excludedSet.has(titleKey)));
  };

  if (mbStudioAlbums && mbStudioAlbums.available === true && Array.isArray(mbStudioAlbums.albums)) {
    const items = mbStudioAlbums.albums.map((mbAlb) => {
      const matched = safeCatalog.find((rel) => {
        const w = rel.work || rel;
        const wMbid = String(w?.musicBrainzId || w?.ids?.musicbrainz || '').trim();
        if (mbAlb.mbid && wMbid && wMbid === mbAlb.mbid) return true;
        return normalizeMusicKey(w?.title || '') === mbAlb.normTitle;
      });
      const matchedWork = matched?.work || matched || null;
      const excluded = isExcluded(mbAlb) || (matchedWork ? isExcluded(matchedWork) : false);
      const completed = Boolean(matchedWork && matchedWork.status === 'completed');

      return {
        ...mbAlb,
        excludeKey: makeDiscographyExcludeKey(mbAlb),
        excluded,
        inCatalog: Boolean(matchedWork),
        completed,
        work: matchedWork,
      };
    });

    const countedItems = items.filter((i) => !i.excluded);
    const excludedCount = items.length - countedItems.length;
    const allMbReleases = Array.isArray(mbStudioAlbums.allReleases) ? mbStudioAlbums.allReleases : [];
    const universeCountedLocal = safeCatalog.filter((rel) => !isExcluded(rel.work || rel));
    const universeTotalKnown =
      Number(manualUniverseTotal) > 0
        ? Math.round(Number(manualUniverseTotal))
        : allMbReleases.length > 0
          ? allMbReleases.filter((r) => !isExcluded(r)).length
          : null;

    const entityComp = computeEntityCompleteness({
      works: countedItems,
      mainSeriesTotal: countedItems.length,
      universeWorks: universeCountedLocal,
      universeTotal: universeTotalKnown,
      totalSource: 'MusicBrainz',
    });

    const totalCount = countedItems.length;
    const completedCount = entityComp.mainline.completed;
    const pct = totalCount > 0 ? entityComp.mainline.pct : 0;

    return {
      mode: 'musicbrainz',
      source: 'MusicBrainz',
      sourceLabel: 'Fonte: MusicBrainz (álbuns de estúdio)',
      fetchedAt: mbStudioAlbums.fetchedAt || null,
      completedCount,
      totalCount,
      excludedCount,
      pct,
      label: `${completedCount}/${totalCount} álbuns de estúdio`,
      mainlineLabel: entityComp.mainline.displayLabel,
      universeLabel: entityComp.universe.displayLabel,
      entityCompleteness: entityComp,
      items,
      allReleases: allMbReleases,
    };
  }

  // Sem MusicBrainz: usa total manual se definido pelo usuário; caso contrário mostra APENAS total aberto
  const countedLocal = safeCatalog.filter((rel) => !isExcluded(rel.work || rel));
  const studioLocal = countedLocal.filter((rel) => !rel.scope || rel.scope === 'studio');
  const excludedCount = safeCatalog.length - countedLocal.length;

  const parsedManualTotal = Number(manualTotal);
  const validManualTotal =
    Number.isFinite(parsedManualTotal) && parsedManualTotal > 0 ? Math.round(parsedManualTotal) : null;
  const parsedManualUniverse = Number(manualUniverseTotal);
  const validManualUniverse =
    Number.isFinite(parsedManualUniverse) && parsedManualUniverse > 0
      ? Math.round(parsedManualUniverse)
      : null;

  const entityComp = computeEntityCompleteness({
    works: studioLocal.length > 0 ? studioLocal : countedLocal,
    mainSeriesTotal: validManualTotal,
    universeWorks: countedLocal,
    universeTotal: validManualUniverse,
    totalSource: validManualTotal || validManualUniverse ? 'Definido por você' : null,
  });

  if (validManualTotal !== null) {
    return {
      mode: 'manual-total',
      source: 'manual',
      sourceLabel: 'Total definido por você',
      fetchedAt: null,
      completedCount: entityComp.mainline.completed,
      catalogCount: countedLocal.length,
      totalCount: validManualTotal,
      excludedCount,
      pct: entityComp.mainline.pct,
      label: `${entityComp.mainline.completed}/${validManualTotal} álbuns de estúdio`,
      mainlineLabel: entityComp.mainline.displayLabel,
      universeLabel: entityComp.universe.displayLabel,
      entityCompleteness: entityComp,
      items: [],
      allReleases: [],
    };
  }

  return {
    mode: 'count-only',
    source: null,
    sourceLabel: '',
    fetchedAt: null,
    completedCount: entityComp.universe.completed,
    catalogCount: countedLocal.length,
    totalCount: null,
    excludedCount,
    pct: null,
    label: `${entityComp.universe.completed} concluídos · total aberto`,
    mainlineLabel: entityComp.mainline.displayLabel,
    universeLabel: entityComp.universe.displayLabel,
    entityCompleteness: entityComp,
    items: [],
    allReleases: [],
  };
}
