import { getCachedEntry, setCachedEntry } from '../api/cacheDb.js';
import { apiRequest } from '../api/httpClient.js';
import { CACHE_STORES } from '../api/limits.js';
import {
  GAME_EDITION_TYPES,
  GAME_PLATFORM_UNSET_LABEL,
  normalizeDomainId,
  normalizeWorkTypeForDomain,
} from '../config/domainConfig.js';

const REQUEST_TIMEOUT_MS = 8000;
const MUSICBRAINZ_TIMEOUT_MS = 12000;

const COVER_TRIBUTE_REGEX =
  /\b(cover|tribute|karaoke|lullaby|piano version|8-bit|ringtone|instrumental version|made famous|originally performed|in the style of|soundalike|re-recorded|rockabye|vitamin string|piano tribute|acoustic cover|metal cover|bootleg|blacklist|originally by|parody|music box|lo-fi version|lofi version|sped up|slowed)\b/i;

const VARIANT_SUFFIX_REGEX =
  /\(([^)]*(live|remaster|deluxe|remix|acoustic|demo|edit|radio|mono|stereo|anniversary|version|instrumental|karaoke|cover|tribute)[^)]*)\)|\[([^\]]*(live|remaster|deluxe|remix|acoustic|demo|cover|tribute)[^\]]*)\]/i;

const LIVE_HINT_REGEX = /\b(live|ao vivo|unplugged|in concert|concert|tour|mtv unplugged|live at|live in|live from)\b/i;

const NON_LATIN_SCRIPT_REGEX = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\u0400-\u04ff\u0600-\u06ff\u0590-\u05ff\u0e00-\u0e7f]/;

const PORTUGUESE_WORD_HINT_REGEX =
  /\b(a|o|os|as|um|uma|de|do|da|dos|das|em|no|na|para|por|com|sobre|entre|contra|sem|sob|à|ao|aos|às|metamorfose|processo|castelo|beira-mar|cartas|conto|contos|obra|obras|di[áa]rio|filosofia|hist[óo]ria|edi[çc][ãa]o|volume|cap[íi]tulo|completo|completa|guia|introdu[çc][ãa]o|teoria|cr[íi]tica)\b/i;

const PORTUGUESE_DIACRITIC_REGEX = /[ãõçáéíóúâêôà]/i;
const FOREIGN_NON_PT_HINT_REGEX = /[ßäöü]|\b(der|die|das|und|ein|eine|the|of|and|with|from|on|in|for|by|le|la|les|des|du)\b/i;

/**
 * Mapeamento de QIDs oficiais da Wikidata (P400) para plataformas canônicas do OmniPrism.
 */
const WIKIDATA_PLATFORM_QIDS = {
  Q10677: 'PS1',
  Q10680: 'PS2',
  Q10683: 'PS3',
  Q5014725: 'PS4',
  Q63184502: 'PS5',
  Q170325: 'PSP',
  Q188808: 'PS Vita',
  Q183259: 'SNES',
  Q172742: 'NES',
  Q188642: 'GBA',
  Q170323: 'DS',
  Q203597: '3DS',
  Q19610114: 'Switch',
  Q1406: 'PC',
  Q16338: 'PC',
  Q388: 'PC',
  Q14116: 'PC',
  Q9135: 'PC',
  Q94: 'Mobile',
  Q48493: 'Mobile',
  Q488142: 'Mobile',
  Q132020: 'Xbox',
  Q48263: 'Xbox 360',
  Q13361286: 'Xbox One',
  Q64513817: 'Xbox Series X/S',
  Q182172: 'GameCube',
  Q8079: 'Wii',
  Q56942: 'Wii U',
  Q184839: 'N64',
  Q10676: 'Mega Drive',
  Q184198: 'Dreamcast',
};

const WIKIDATA_REMAKE_QIDS = new Set(['Q4393107']);
const WIKIDATA_REMASTER_QIDS = new Set(['Q65963104', 'Q21125433']);
const WIKIDATA_DLC_QIDS = new Set(['Q209163', 'Q1066707', 'Q848991']);
const WIKIDATA_GAME_INSTANCE_QIDS = new Set([
  'Q7889',
  'Q4393107',
  'Q65963104',
  'Q21125433',
  'Q209163',
  'Q1066707',
  'Q848991',
  'Q7058673',
]);

function isBrowserOffline() {
  if (typeof navigator === 'undefined') return false;
  return navigator.onLine === false;
}

function normalizeText(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function stripParenthetical(str) {
  return String(str || '')
    .replace(/\s*[\(\[][^\)\]]*[\)\]]\s*/g, ' ')
    .replace(/\s*-\s*(single|ep|remaster(ed)?|deluxe.*|anniversary.*|live.*|acoustic.*)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSearchKey(title, creator = '', extra = '') {
  return `${normalizeText(title)}::${normalizeText(creator)}${extra ? `::${normalizeText(extra)}` : ''}`;
}

function normalizeHttpsUrl(url) {
  const clean = String(url || '').trim();
  if (!clean || !/^https?:\/\//i.test(clean)) return null;
  return clean.replace(/^http:\/\//i, 'https://');
}

export function formatTrackDuration(durationMs) {
  const ms = Number(durationMs);
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const totalSec = Math.round(ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function normalizePlatformLabel(raw) {
  const clean = String(raw || '').trim();
  if (!clean) return '';
  const low = clean.toLowerCase();
  if (/playstation\s*5|\bps5\b/.test(low)) return 'PS5';
  if (/playstation\s*4|\bps4\b/.test(low)) return 'PS4';
  if (/playstation\s*3|\bps3\b/.test(low)) return 'PS3';
  if (/playstation\s*2|\bps2\b/.test(low)) return 'PS2';
  if (/playstation\s*portable|\bpsp\b/.test(low)) return 'PSP';
  if (/playstation\s*vita|\bps\s*vita\b/.test(low)) return 'PS Vita';
  if (/playstation(\s*1)?|\bps1\b|\bpsx\b/.test(low)) return 'PS1';
  if (/nintendo\s*switch|\bswitch\b/.test(low)) return 'Switch';
  if (/super\s*nintendo|super\s*famicom|\bsnes\b/.test(low)) return 'SNES';
  if (/game\s*boy\s*advance|\bgba\b/.test(low)) return 'GBA';
  if (/nintendo\s*3ds|\b3ds\b/.test(low)) return '3DS';
  if (/nintendo\s*ds|\bnds\b|\bds\b/.test(low)) return 'DS';
  if (/\b(microsoft\s*windows|windows|pc|mac\s?os|os\s?x|linux|steam\s?os|web\s*browser|browser)\b/.test(low)) {
    return 'PC';
  }
  if (/\b(android|ios|iphone|ipad|mobile)\b/.test(low)) return 'Mobile';
  if (/xbox\s*series/.test(low)) return 'Xbox Series X/S';
  if (/xbox\s*one/.test(low)) return 'Xbox One';
  if (/xbox\s*360/.test(low)) return 'Xbox 360';
  if (/\bxbox\b/.test(low)) return 'Xbox';
  if (/gamecube/.test(low)) return 'GameCube';
  if (/wii\s*u/.test(low)) return 'Wii U';
  if (/\bwii\b/.test(low)) return 'Wii';
  if (/nintendo\s*64|\bn64\b/.test(low)) return 'N64';
  return clean;
}

export function detectGameEditionType({
  title = '',
  description = '',
  workType = 'game',
  instanceQids = [],
  basedOn = false,
  isDerivativeWork = false,
} = {}) {
  const combined = `${title} ${description}`.toLowerCase();
  const qidSet = new Set(Array.isArray(instanceQids) ? instanceQids : []);

  if (workType === 'dlc' || [...qidSet].some((q) => WIKIDATA_DLC_QIDS.has(q))) {
    return 'DLC/Expansão';
  }
  if (/\b(dlc|expansion|expans[ãa]o|season pass|add-on)\b/i.test(combined)) {
    return 'DLC/Expansão';
  }
  if ([...qidSet].some((q) => WIKIDATA_REMAKE_QIDS.has(q)) || /\bremake\b/i.test(combined)) {
    return 'Remake';
  }
  // Se a fonte textual disser explicitamente "remaster", mantém Remaster
  if (
    /\b(remaster|remastered|hd collection|definitive edition|director'?s cut|anniversary edition)\b/i.test(
      combined
    )
  ) {
    return 'Remaster';
  }
  if (/\b(port|re-?release|relan[çc]amento)\b/i.test(combined)) {
    return 'Port';
  }
  // Relação de obra derivada na Wikidata (P4969 / P144) sem marcação explícita de remaster -> Remake
  if (isDerivativeWork || basedOn) {
    return 'Remake';
  }
  if ([...qidSet].some((q) => WIKIDATA_REMASTER_QIDS.has(q))) {
    return 'Remaster';
  }
  return GAME_EDITION_TYPES[0]; // 'Original'
}

const WIKIDATA_SHORT_DESC_REGEX =
  /^(?:(?:remake|remaster|port|expans[ãa]o|dlc|sequ[êe]ncia|trilogia)\s+(?:de\s+)?)?(?:videojogo|jogo\s+eletr[ôo]nico|jogo\s+de\s+v[íi]deo|video\s?game|action-adventure\s+(?:video\s?)?game|role-playing\s+(?:video\s?)?game|platform\s+(?:video\s?)?game|\d{4}\s+(?:action-adventure\s+|role-playing\s+|survival\s+)?(?:video\s?)?game|filme|s[ée]rie|anime|livro|[áa]lbum)(?:\s+(?:de|da|do|para|em|por|by|for|from|in)\s+[^.!?]+)?\.?$/i;

const NON_PT_GENRE_WORD_REGEX =
  /\b(fiction|stories|short\s+story|literature|literary|criticism|juvenile|children|young\s+adult|comics|graphic\s+novels?|translations?|german|french|english|japanese|spanish|russian|philosophy|science|adventure|mystery|horror|fantasy|comedy|action|crime|psychological|classics?|history|biography|autobiography|poetry|essays?|general|books?|reading|novels?|life|social|political|religion|role-playing|platformer|shooter|strategy|simulation|racing|sports|fighting|puzzle|survival|stealth|open\s+world|soundtrack|alternative|electronic|classical|video\s?game|metamorphosis|deutsche|erz[äa]hlung|litt[ée]rature|bande\s+dessin[ée]e)\b/i;

const FOREIGN_SYNOPSIS_STOPWORDS_REGEX =
  /\b(the|and|with|that|this|from|have|which|their|into|about|story|when|who|after|his|her|they|been|were|would|der|die|das|und|ein|eine|von|mit|auf|für|les|des|dans|pour|avec|une|est|sont|qui)\b/gi;

const PT_SYNOPSIS_STOPWORDS_REGEX =
  /\b(que|com|uma|para|por|dos|das|n[ãa]o|mais|como|seu|sua|sobre|entre|pelo|pela|mas|quando|tamb[ée]m|onde|hist[óo]ria|vida|mundo|ap[óo]s|at[ée]|sem|nos|nas|aos|esta|este|esse|essa)\b/gi;

export function isWikidataShortDescription(text = '') {
  const clean = String(text || '').trim();
  if (!clean) return false;
  if (clean.length <= 95 && WIKIDATA_SHORT_DESC_REGEX.test(clean)) {
    return true;
  }
  if (
    clean.length <= 65 &&
    /^(?:videojogo|jogo\s+eletr[ôo]nico|jogo\s+de\s+v[íi]deo|video\s?game|remake\s+de\s+videojogo)\b/i.test(
      clean
    ) &&
    !/[.!?]\s+\S/.test(clean)
  ) {
    return true;
  }
  return false;
}

export function hasPortugueseTitle(item = {}) {
  const title = String(item?.title || '').trim();
  if (!title || NON_LATIN_SCRIPT_REGEX.test(title)) return false;
  if (isPortugueseCode(item?.language)) return true;
  if (isLikelyPortugueseTitle(title)) return true;
  const orig = String(item?.originalTitle || '').trim();
  if (orig && normalizeText(orig) !== normalizeText(title) && !FOREIGN_NON_PT_HINT_REGEX.test(title)) {
    return true;
  }
  return false;
}

export function isLikelyNonPortugueseGenre(genre = '') {
  const clean = String(genre || '').trim();
  if (!clean) return true;
  if (NON_LATIN_SCRIPT_REGEX.test(clean)) return true;
  if (PORTUGUESE_DIACRITIC_REGEX.test(clean)) return false;
  if (NON_PT_GENRE_WORD_REGEX.test(clean)) return true;
  return false;
}

export function isLikelyNonPortugueseSynopsis(text = '') {
  const clean = String(text || '').trim();
  if (!clean) return false;
  if (NON_LATIN_SCRIPT_REGEX.test(clean)) return true;

  const foreignHits = (clean.match(FOREIGN_SYNOPSIS_STOPWORDS_REGEX) || []).length;
  const ptHits = (clean.match(PT_SYNOPSIS_STOPWORDS_REGEX) || []).length;
  const ptDiacritics = (clean.match(/[ãõçáéíóúâêôà]/gi) || []).length;
  const ptScore = ptHits * 2 + ptDiacritics;

  if (foreignHits >= 2 && foreignHits > ptScore) {
    return true;
  }
  return false;
}

export function getDisplayGenres(item = {}, { max = 3 } = {}) {
  const raw = Array.isArray(item?.genres) ? item.genres : [];
  const cleaned = Array.from(
    new Set(raw.map((g) => String(g || '').trim()).filter(Boolean))
  );
  const ptTitle = hasPortugueseTitle(item);
  const filtered = ptTitle
    ? cleaned.filter((g) => !isLikelyNonPortugueseGenre(g))
    : cleaned.filter((g) => !NON_LATIN_SCRIPT_REGEX.test(g));
  return filtered.slice(0, Math.max(0, Number(max) || 3));
}

export function getDisplaySynopsis(item = {}) {
  const raw = String(item?.synopsis || item?.overview || '').trim();
  if (!raw) return '';
  if (isWikidataShortDescription(raw)) return '';
  if (hasPortugueseTitle(item) && isLikelyNonPortugueseSynopsis(raw)) {
    return '';
  }
  return raw;
}

async function fetchJsonSafe(
  url,
  { signal, fetchImpl, headers = {}, timeoutMs = REQUEST_TIMEOUT_MS } = {}
) {
  const fn = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!fn) throw new Error('Fetch indisponível');

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = setTimeout(() => controller?.abort(), timeoutMs);

  const onOuterAbort = () => controller?.abort();
  if (signal && controller) {
    if (signal.aborted) {
      clearTimeout(timeoutId);
      throw new Error('AbortError');
    }
    signal.addEventListener('abort', onOuterAbort, { once: true });
  }

  try {
    const res = await fn(url, {
      method: 'GET',
      headers,
      signal: controller?.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timeoutId);
    if (signal) {
      signal.removeEventListener('abort', onOuterAbort);
    }
  }
}

function getCandidateDedupKey(item) {
  const domain = normalizeDomainId(item.domain);
  const title = item.title || '';
  const creator = item.creator || item.director || '';

  if (domain === 'games') {
    const edition = item.editionType || 'Original';
    // Preserva separadamente Original vs Remake/Remaster/Port/DLC e anos distintos (>= 3 anos)
    const yearBucket =
      Number(item.releaseYear) > 1970 ? String(Math.floor(Number(item.releaseYear) / 3)) : '';
    return normalizeSearchKey(title, '', `${edition}::${yearBucket}`);
  }

  if (domain === 'music') {
    const wt = item.workType || 'album';
    return normalizeSearchKey(title, creator, wt);
  }

  return normalizeSearchKey(title, creator);
}

function deduplicateDomainCandidates(candidates = []) {
  const byKey = new Map();
  for (const item of candidates) {
    if (!item || !item.title) continue;
    const key = getCandidateDedupKey(item);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
      continue;
    }

    const mergedPlatforms = Array.from(
      new Set([...(existing.platforms || []), ...(item.platforms || [])].filter(Boolean))
    );
    const preferredPlatform =
      existing.platform || item.platform || mergedPlatforms[0] || '';

    // Em música, prefere o ano original mais antigo entre duplicatas do mesmo artista/faixa
    let mergedYear = existing.releaseYear || item.releaseYear || null;
    if (
      item.domain === 'music' &&
      Number(existing.releaseYear) > 1900 &&
      Number(item.releaseYear) > 1900
    ) {
      mergedYear = Math.min(Number(existing.releaseYear), Number(item.releaseYear));
    }

    byKey.set(key, {
      ...existing,
      originalTitle: existing.originalTitle || item.originalTitle || '',
      creator: existing.creator || item.creator || '',
      director: existing.director || item.director || '',
      coverUrl: existing.coverUrl || item.coverUrl || null,
      coverSources: Array.from(
        new Set([...(existing.coverSources || []), ...(item.coverSources || [])].filter(Boolean))
      ),
      synopsis:
        (existing.synopsis || '').length >= (item.synopsis || '').length
          ? existing.synopsis
          : item.synopsis,
      releaseYear: mergedYear,
      totalPages: existing.totalPages || item.totalPages || null,
      isbnOrDoi: existing.isbnOrDoi || item.isbnOrDoi || '',
      platforms: mergedPlatforms,
      platform: preferredPlatform,
      storeOrLauncher: existing.storeOrLauncher || item.storeOrLauncher || '',
      editionType: existing.editionType || item.editionType || 'Original',
      albumName: existing.albumName || item.albumName || '',
      durationMs: existing.durationMs || item.durationMs || null,
      durationLabel: existing.durationLabel || item.durationLabel || '',
      language:
        existing.language === 'pt' || existing.language === 'por'
          ? existing.language
          : item.language || existing.language || '',
      genres:
        Array.isArray(existing.genres) && existing.genres.length > 0
          ? existing.genres
          : item.genres || [],
      ids: { ...(item.ids || {}), ...(existing.ids || {}) },
      mergedSources: Array.from(
        new Set([...(existing.mergedSources || []), ...(item.mergedSources || [])])
      ),
    });
  }
  return Array.from(byKey.values());
}

function isPortugueseCode(lang) {
  const clean = String(lang || '').trim().toLowerCase();
  return clean === 'pt' || clean === 'por' || clean === 'pt-br' || clean === 'pt-pt';
}

function isLikelyPortugueseTitle(title = '') {
  const clean = String(title || '').trim();
  if (!clean) return false;
  if (NON_LATIN_SCRIPT_REGEX.test(clean)) return false;
  return PORTUGUESE_DIACRITIC_REGEX.test(clean) || PORTUGUESE_WORD_HINT_REGEX.test(clean);
}

function enhanceGoogleBooksCover(imageLinks = {}) {
  const raw =
    imageLinks.extraLarge ||
    imageLinks.large ||
    imageLinks.medium ||
    imageLinks.thumbnail ||
    imageLinks.smallThumbnail ||
    '';
  const https = normalizeHttpsUrl(raw);
  if (!https) return null;
  return https.replace(/&edge=curl/gi, '');
}

function parseOpenLibraryDocs(docs = [], { mediaTypeFilter = 'all', isPortugueseQuery = false } = {}) {
  const out = [];
  for (const doc of Array.isArray(docs) ? docs : []) {
    const rawWorkTitle = String(doc.title || '').trim();
    if (!rawWorkTitle) continue;

    const editionDocs = Array.isArray(doc.editions?.docs) ? doc.editions.docs : [];
    const ptEdition =
      editionDocs.find((ed) => {
        const langs = Array.isArray(ed.language) ? ed.language : [];
        return langs.some(isPortugueseCode) && ed.title;
      }) ||
      (isPortugueseQuery && editionDocs[0]?.title ? editionDocs[0] : null);

    const editionTitle = String(ptEdition?.title || '').trim();
    const docLangs = Array.isArray(doc.language) ? doc.language : [];
    const hasPortugueseLang =
      isPortugueseQuery || docLangs.some(isPortugueseCode) || Boolean(ptEdition);

    const title = editionTitle || rawWorkTitle;
    const originalTitle =
      editionTitle && normalizeText(editionTitle) !== normalizeText(rawWorkTitle)
        ? rawWorkTitle
        : '';

    const author = Array.isArray(doc.author_name) ? doc.author_name.slice(0, 2).join(', ') : '';
    const coverId = ptEdition?.cover_i || doc.cover_i;
    const coverUrl = coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : null;
    const subjects = Array.isArray(doc.subject) ? doc.subject.slice(0, 4).map(String) : [];
    const isMangaHint = subjects.some((s) => /manga|comic|graphic novel/i.test(s));
    const defaultType =
      mediaTypeFilter !== 'all'
        ? normalizeWorkTypeForDomain(mediaTypeFilter, 'reading')
        : isMangaHint
          ? 'manga'
          : 'book';
    const firstSentence = Array.isArray(doc.first_sentence)
      ? doc.first_sentence[0]
      : typeof doc.first_sentence === 'string'
        ? doc.first_sentence
        : '';
    const isbn =
      (Array.isArray(ptEdition?.isbn) && ptEdition.isbn[0]) ||
      (Array.isArray(doc.isbn) && doc.isbn[0]) ||
      '';

    out.push({
      id: `ol-${String(doc.key || title).replace(/[^a-z0-9_-]/gi, '')}`,
      domain: 'reading',
      workType: defaultType,
      title,
      originalTitle,
      creator: author,
      director: author,
      releaseYear: Number(doc.first_publish_year) || null,
      coverUrl,
      synopsis: String(firstSentence || '').trim(),
      totalPages:
        Number(doc.number_of_pages_median) > 0
          ? Math.round(Number(doc.number_of_pages_median))
          : null,
      pagesRead: 0,
      chaptersRead: 0,
      isbnOrDoi: String(isbn || ''),
      bookFormat: 'Físico',
      language: hasPortugueseLang ? 'pt' : String(docLangs[0] || ''),
      _fromPtQuery: Boolean(isPortugueseQuery),
      genres: subjects,
      ids: { openlibrary: doc.key || null },
      sourceBadge: 'Open Library',
      mergedSources: ['Open Library'],
    });
  }
  return out;
}

function parseGoogleBooksItems(
  items = [],
  { mediaTypeFilter = 'all', isPortugueseQuery = false } = {}
) {
  const out = [];
  for (const vol of Array.isArray(items) ? items : []) {
    const info = vol?.volumeInfo || {};
    const title = String(info.title || '').trim();
    if (!title) continue;
    const author = Array.isArray(info.authors) ? info.authors.slice(0, 2).join(', ') : '';
    const coverUrl = enhanceGoogleBooksCover(info.imageLinks || {});
    const isbnObj =
      (Array.isArray(info.industryIdentifiers) ? info.industryIdentifiers : []).find(
        (i) => i.type === 'ISBN_13' || i.type === 'ISBN_10'
      ) || null;
    const genres = Array.isArray(info.categories) ? info.categories.slice(0, 4).map(String) : [];
    const isMangaHint = genres.some((g) => /manga|comics|graphic/i.test(g));
    const defaultType =
      mediaTypeFilter !== 'all'
        ? normalizeWorkTypeForDomain(mediaTypeFilter, 'reading')
        : isMangaHint
          ? 'manga'
          : 'book';
    const langCode = String(info.language || '').trim().toLowerCase();
    const effectiveLang = isPortugueseCode(langCode)
      ? 'pt'
      : langCode || (isPortugueseQuery ? 'pt' : '');

    out.push({
      id: `gb-${String(vol.id || title).replace(/[^a-z0-9_-]/gi, '')}`,
      domain: 'reading',
      workType: defaultType,
      title,
      originalTitle: '',
      creator: author,
      director: author,
      releaseYear: info.publishedDate ? Number(String(info.publishedDate).slice(0, 4)) || null : null,
      coverUrl,
      synopsis: String(info.description || '').trim(),
      totalPages: Number(info.pageCount) > 0 ? Math.round(Number(info.pageCount)) : null,
      pagesRead: 0,
      chaptersRead: 0,
      isbnOrDoi: isbnObj?.identifier ? String(isbnObj.identifier) : '',
      bookFormat: 'Físico',
      language: effectiveLang,
      _fromPtQuery: Boolean(isPortugueseQuery),
      genres,
      ids: { googleBooks: vol.id || null },
      sourceBadge: 'Google Books',
      mergedSources: ['Google Books'],
    });
  }
  return out;
}

/**
 * Ranqueia resultados de Leitura priorizando edições em Português (PT-BR/PT)
 * e penalizando scripts não-latinos quando a consulta do usuário é em alfabeto latino.
 */
export function rankReadingCandidates(candidates = [], query = '') {
  const normQ = normalizeText(query);
  const queryWords = normQ.split(' ').filter((w) => w.length >= 2);
  const queryIsLatin = !NON_LATIN_SCRIPT_REGEX.test(String(query || ''));

  const scoreItem = (item) => {
    let score = 0;
    const title = String(item.title || '');
    const orig = String(item.originalTitle || '');
    const creator = String(item.creator || '');
    const normTitle = normalizeText(title);
    const normOrig = normalizeText(orig);
    const normCreator = normalizeText(creator);

    const isNonLatin = NON_LATIN_SCRIPT_REGEX.test(title);
    if (queryIsLatin && isNonLatin) {
      score -= 420;
    }

    const looksForeignTitle =
      !isLikelyPortugueseTitle(title) && FOREIGN_NON_PT_HINT_REGEX.test(title);
    const isPt = isPortugueseCode(item.language);
    if (isPt && !isNonLatin && !looksForeignTitle) {
      score += 240;
      if (isLikelyPortugueseTitle(title)) {
        score += 70;
      }
    } else if (item._fromPtQuery && !isNonLatin && !looksForeignTitle) {
      score += 120;
    } else if (!isNonLatin && isLikelyPortugueseTitle(title)) {
      score += 60;
    } else if (looksForeignTitle) {
      score -= 110;
    }

    if (normQ) {
      if (normTitle === normQ) score += 180;
      else if (normTitle.startsWith(normQ)) score += 110;
      else if (normTitle.includes(normQ)) score += 80;
      else if (normOrig && normOrig.includes(normQ)) score += 70;

      if (normCreator && (normCreator === normQ || normCreator.includes(normQ))) {
        score += 120;
      } else if (queryWords.length > 0) {
        const matchedWords = queryWords.filter(
          (w) => normTitle.includes(w) || normCreator.includes(w) || normOrig.includes(w)
        ).length;
        score += matchedWords * 35;
      }
    }

    if (item.originalTitle) score += 25;
    if (item.coverUrl) score += 25;
    if (item.synopsis && item.synopsis.length > 40) score += 20;
    if (item.totalPages > 0) score += 15;

    return score;
  };

  return [...candidates].sort((a, b) => scoreItem(b) - scoreItem(a));
}

/**
 * Cruza resultados em PT com resultados globais (secundários) para enriquecer `originalTitle` e capa em alta resolução.
 */
function enrichPortugueseBooksWithOriginals(ptCandidates = [], globalCandidates = []) {
  if (!globalCandidates.length) return ptCandidates;

  const byAuthor = new Map();
  for (const g of globalCandidates) {
    const normAuthor = normalizeText(g.creator || '');
    if (!normAuthor) continue;
    if (!byAuthor.has(normAuthor)) byAuthor.set(normAuthor, []);
    byAuthor.get(normAuthor).push(g);
  }

  return ptCandidates.map((ptItem) => {
    if (ptItem.originalTitle && ptItem.coverUrl) return ptItem;
    const normAuthor = normalizeText(ptItem.creator || '');
    const sameAuthorGlobals = normAuthor ? byAuthor.get(normAuthor) || [] : [];

    // Encontra o melhor candidato global para originalTitle ou capa
    const matchedGlobal = sameAuthorGlobals.find((g) => {
      if (isPortugueseCode(g.language) || NON_LATIN_SCRIPT_REGEX.test(g.title || '')) return false;
      if (ptItem.ids?.openlibrary && g.ids?.openlibrary && ptItem.ids.openlibrary === g.ids.openlibrary) {
        return true;
      }
      if (
        ptItem.releaseYear &&
        g.releaseYear &&
        Math.abs(Number(ptItem.releaseYear) - Number(g.releaseYear)) <= 2
      ) {
        return true;
      }
      const ptWords = normalizeText(ptItem.title).split(' ').filter((w) => w.length >= 4);
      const gTitle = normalizeText(g.title);
      return ptWords.some((w) => gTitle.includes(w.slice(0, 4)));
    });

    if (!matchedGlobal) return ptItem;
    const origCandidate = String(matchedGlobal.originalTitle || matchedGlobal.title || '').trim();
    const distinctOriginal =
      origCandidate && normalizeText(origCandidate) !== normalizeText(ptItem.title)
        ? origCandidate
        : ptItem.originalTitle || '';

    return {
      ...ptItem,
      originalTitle: ptItem.originalTitle || distinctOriginal,
      coverUrl: ptItem.coverUrl || matchedGlobal.coverUrl || null,
      releaseYear: ptItem.releaseYear || matchedGlobal.releaseYear || null,
      totalPages: ptItem.totalPages || matchedGlobal.totalPages || null,
    };
  });
}

/**
 * Busca gratuita para Leitura & Acadêmico (Open Library `language=por` + Google Books `langRestrict=pt`
 * com consulta secundária para `originalTitle` e capas em alta resolução).
 */
export async function searchReadingWorks(
  query,
  { signal, fetchImpl, mediaTypeFilter = 'all', onPartialResults = null } = {}
) {
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) return { ok: true, results: [], offline: false, partialFailure: false, usedSources: [] };
  if (isBrowserOffline()) {
    return { ok: false, results: [], offline: true, partialFailure: false, usedSources: [] };
  }

  const encoded = encodeURIComponent(cleanQuery);
  const olFields =
    'key,title,author_name,first_publish_year,number_of_pages_median,cover_i,isbn,subject,first_sentence,language,editions,editions.key,editions.title,editions.language,editions.cover_i,editions.isbn';
  const olPtUrl = `https://openlibrary.org/search.json?q=${encoded}&language=por&limit=12&fields=${olFields}`;
  const gbPtUrl = `https://www.googleapis.com/books/v1/volumes?q=${encoded}&langRestrict=pt&maxResults=12`;
  const gbGlobalUrl = `https://www.googleapis.com/books/v1/volumes?q=${encoded}&maxResults=8`;

  const olPtPromise = fetchJsonSafe(olPtUrl, { signal, fetchImpl });
  const gbPtPromise = fetchJsonSafe(gbPtUrl, { signal, fetchImpl });
  const gbGlobalPromise = fetchJsonSafe(gbGlobalUrl, { signal, fetchImpl });

  if (typeof onPartialResults === 'function') {
    const streamPt = [];
    const streamGlobal = [];
    const streamSources = new Set();
    let pending = 3;
    const emitReadingPartial = () => {
      if (signal?.aborted) return;
      const enriched = enrichPortugueseBooksWithOriginals(streamPt, streamGlobal);
      const queryIsLatin = !NON_LATIN_SCRIPT_REGEX.test(cleanQuery);
      const filteredG = streamGlobal.filter(
        (g) => !(queryIsLatin && NON_LATIN_SCRIPT_REGEX.test(g.title || ''))
      );
      const pool = enriched.length >= 6 ? enriched : [...enriched, ...filteredG];
      if (pool.length === 0) return;
      const dedupedPartial = deduplicateDomainCandidates(pool).map((item) => {
        const clean = { ...item };
        delete clean._fromPtQuery;
        return clean;
      });
      const rankedPartial = rankReadingCandidates(dedupedPartial, cleanQuery).slice(0, 18);
      const srcArr = Array.from(streamSources);
      onPartialResults({
        results: rankedPartial,
        usedSources: srcArr,
        pendingCount: pending,
        partial: pending > 0,
        sourceStatusHint: srcArr.length > 0 ? `Fontes: ${srcArr.join(' · ')}` : '',
      });
    };

    olPtPromise
      .then((val) => {
        pending = Math.max(0, pending - 1);
        if (Array.isArray(val?.docs)) {
          streamSources.add('Open Library');
          streamPt.push(...parseOpenLibraryDocs(val.docs, { mediaTypeFilter, isPortugueseQuery: true }));
          emitReadingPartial();
        }
      })
      .catch(() => {
        pending = Math.max(0, pending - 1);
      });
    gbPtPromise
      .then((val) => {
        pending = Math.max(0, pending - 1);
        if (Array.isArray(val?.items)) {
          streamSources.add('Google Books');
          streamPt.push(...parseGoogleBooksItems(val.items, { mediaTypeFilter, isPortugueseQuery: true }));
          emitReadingPartial();
        }
      })
      .catch(() => {
        pending = Math.max(0, pending - 1);
      });
    gbGlobalPromise
      .then((val) => {
        pending = Math.max(0, pending - 1);
        if (Array.isArray(val?.items)) {
          streamSources.add('Google Books');
          streamGlobal.push(...parseGoogleBooksItems(val.items, { mediaTypeFilter, isPortugueseQuery: false }));
          emitReadingPartial();
        }
      })
      .catch(() => {
        pending = Math.max(0, pending - 1);
      });
  }

  const [olPtRes, gbPtRes, gbGlobalRes] = await Promise.allSettled([
    olPtPromise,
    gbPtPromise,
    gbGlobalPromise,
  ]);

  const ptCandidates = [];
  const globalCandidates = [];
  const usedSources = [];
  let primaryFailed = 0;

  if (olPtRes.status === 'fulfilled' && Array.isArray(olPtRes.value?.docs)) {
    usedSources.push('Open Library');
    ptCandidates.push(
      ...parseOpenLibraryDocs(olPtRes.value.docs, {
        mediaTypeFilter,
        isPortugueseQuery: true,
      })
    );
  } else {
    primaryFailed += 1;
  }

  if (gbPtRes.status === 'fulfilled' && Array.isArray(gbPtRes.value?.items)) {
    usedSources.push('Google Books');
    ptCandidates.push(
      ...parseGoogleBooksItems(gbPtRes.value.items, {
        mediaTypeFilter,
        isPortugueseQuery: true,
      })
    );
  } else {
    primaryFailed += 1;
  }

  if (gbGlobalRes.status === 'fulfilled' && Array.isArray(gbGlobalRes.value?.items)) {
    if (!usedSources.includes('Google Books')) usedSources.push('Google Books');
    globalCandidates.push(
      ...parseGoogleBooksItems(gbGlobalRes.value.items, {
        mediaTypeFilter,
        isPortugueseQuery: false,
      })
    );
  }

  // Se houver poucos resultados PT, faz fallback secundário na Open Library sem restrição de idioma
  if (ptCandidates.length < 3) {
    try {
      const olGlobalUrl = `https://openlibrary.org/search.json?q=${encoded}&limit=8`;
      const olGlobalData = await fetchJsonSafe(olGlobalUrl, { signal, fetchImpl });
      if (Array.isArray(olGlobalData?.docs)) {
        if (!usedSources.includes('Open Library')) usedSources.push('Open Library');
        globalCandidates.push(
          ...parseOpenLibraryDocs(olGlobalData.docs, {
            mediaTypeFilter,
            isPortugueseQuery: false,
          })
        );
      }
    } catch {
      // Fallback silencioso
    }
  }

  const enrichedPt = enrichPortugueseBooksWithOriginals(ptCandidates, globalCandidates);
  const queryIsLatin = !NON_LATIN_SCRIPT_REGEX.test(cleanQuery);
  const filteredGlobals = globalCandidates.filter(
    (g) => !(queryIsLatin && NON_LATIN_SCRIPT_REGEX.test(g.title || ''))
  );

  // Só mistura globais na lista principal se tivermos poucos resultados em PT; caso contrário, mantém o foco em PT
  const combinedPool =
    enrichedPt.length >= 6 ? enrichedPt : [...enrichedPt, ...filteredGlobals];

  const deduped = deduplicateDomainCandidates(combinedPool).map((item) => {
    const clean = { ...item };
    delete clean._fromPtQuery;
    return clean;
  });

  const ranked = rankReadingCandidates(deduped, cleanQuery).slice(0, 18);

  return {
    ok: primaryFailed < 2 || ranked.length > 0,
    results: ranked,
    offline: false,
    partialFailure: primaryFailed > 0 && ranked.length === 0,
    usedSources: Array.from(new Set(usedSources)),
    sourceStatusHint:
      usedSources.length > 0 ? `Fontes: ${Array.from(new Set(usedSources)).join(' · ')}` : '',
  };
}

function extractWikidataClaimIds(entity, propId) {
  const claims = entity?.claims?.[propId];
  if (!Array.isArray(claims)) return [];
  return claims
    .map((c) => c?.mainsnak?.datavalue?.value?.id)
    .filter(Boolean);
}

function extractWikidataEarliestYear(entity) {
  const claims = entity?.claims?.P577;
  if (!Array.isArray(claims)) return null;
  const years = claims
    .map((c) => {
      const timeStr = String(c?.mainsnak?.datavalue?.value?.time || '');
      const m = timeStr.match(/[+-]?(\d{4})-/);
      return m ? Number(m[1]) : null;
    })
    .filter((y) => Number.isInteger(y) && y >= 1970 && y <= 2099);
  return years.length > 0 ? Math.min(...years) : null;
}

function extractWikidataImageUrl(entity) {
  const claims = entity?.claims?.P18;
  if (!Array.isArray(claims) || !claims[0]) return null;
  const fileName = String(claims[0]?.mainsnak?.datavalue?.value || '').trim();
  if (!fileName) return null;
  const normalized = fileName.replace(/\s+/g, '_');
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(normalized)}?width=480`;
}

function extractYearFromDescription(desc = '') {
  const m = String(desc || '').match(/\b(19[7-9]\d|20[0-3]\d)\b/);
  return m ? Number(m[1]) : null;
}

function isLikelyGameEntity(entity, searchDesc = '') {
  const instanceIds = extractWikidataClaimIds(entity, 'P31');
  if (instanceIds.some((id) => WIKIDATA_GAME_INSTANCE_QIDS.has(id))) {
    return true;
  }
  const descPt = String(entity?.descriptions?.pt?.value || '');
  const descEn = String(entity?.descriptions?.en?.value || '');
  const combined = `${searchDesc} ${descPt} ${descEn}`;
  return /video\s?game|videojogo|jogo eletr[ôo]nico|jogo de v[íi]deo|remake|remaster|expans[ãa]o|dlc|rpg/i.test(
    combined
  );
}

function buildWikidataGameCandidate(
  entity,
  { fallbackSearch = null, labelMap = {}, resolvedType = 'game', isDerivativeWork = false } = {}
) {
  const qid = entity?.id || fallbackSearch?.id;
  if (!qid) return null;

  const title = String(
    entity?.labels?.en?.value ||
      entity?.labels?.pt?.value ||
      fallbackSearch?.label ||
      ''
  ).trim();
  if (!title) return null;

  const descPt = String(entity?.descriptions?.pt?.value || '').trim();
  const descEn = String(entity?.descriptions?.en?.value || '').trim();
  const synopsis = descPt || String(fallbackSearch?.description || '').trim() || descEn;

  const instanceQids = extractWikidataClaimIds(entity, 'P31');
  const basedOnQids = extractWikidataClaimIds(entity, 'P144');
  const platformQids = extractWikidataClaimIds(entity, 'P400');
  const devQids = extractWikidataClaimIds(entity, 'P178');

  const mappedPlatforms = Array.from(
    new Set(
      platformQids
        .map((id) => WIKIDATA_PLATFORM_QIDS[id] || normalizePlatformLabel(labelMap[id] || ''))
        .filter(Boolean)
    )
  );

  const releaseYear =
    extractWikidataEarliestYear(entity) ||
    extractYearFromDescription(`${descPt} ${descEn} ${fallbackSearch?.description || ''}`);

  const isDlc =
    instanceQids.some((id) => WIKIDATA_DLC_QIDS.has(id)) ||
    /\b(dlc|expans[ãa]o|expansion)\b/i.test(`${title} ${synopsis}`);

  const editionType = detectGameEditionType({
    title,
    description: `${descPt} ${descEn} ${fallbackSearch?.description || ''}`,
    workType: isDlc ? 'dlc' : resolvedType,
    instanceQids,
    basedOn: basedOnQids.length > 0,
    isDerivativeWork,
  });

  const developers = devQids
    .map((id) => labelMap[id])
    .filter(Boolean)
    .slice(0, 2)
    .join(', ');

  const coverUrl = extractWikidataImageUrl(entity);

  return {
    id: `wd-${qid}`,
    domain: 'games',
    workType: isDlc ? 'dlc' : resolvedType,
    title,
    creator: developers,
    director: developers,
    releaseYear: releaseYear || null,
    coverUrl,
    coverSources: coverUrl ? [coverUrl] : [],
    synopsis,
    // NUNCA assumir PC / Steam como padrão para Wikidata!
    platforms: mappedPlatforms,
    platform: mappedPlatforms[0] || '',
    platformDisplayLabel: mappedPlatforms[0] || GAME_PLATFORM_UNSET_LABEL,
    editionType,
    hoursPlayed: 0,
    completionType: 'História Principal',
    storeOrLauncher: '',
    buildOrCharacter: '',
    genres: [],
    ids: { wikidata: qid },
    sourceBadge: 'Wikidata',
    mergedSources: ['Wikidata'],
  };
}

export function rankGamesCandidates(candidates = [], query = '', mediaTypeFilter = 'all') {
  const normQ = normalizeText(query);

  const scoreItem = (item) => {
    let score = 0;
    const normTitle = normalizeText(item.title || '');
    const normBase = normalizeText(stripParenthetical(item.title || ''));

    if (normQ) {
      if (normTitle === normQ) score += 260;
      else if (normBase === normQ) score += 220;
      else if (normTitle.startsWith(normQ)) {
        const coverage = normQ.length / Math.max(normQ.length, normTitle.length);
        score += 140 + Math.round(coverage * 90);
      } else if (normTitle.includes(normQ)) {
        const coverage = normQ.length / Math.max(normQ.length, normTitle.length);
        score += 80 + Math.round(coverage * 60);
      }
    }

    if (/\b(companion|soundtrack|ost|artbook|guide|demo|beta|test server)\b/i.test(item.title || '')) {
      score -= 80;
    }

    if (mediaTypeFilter !== 'all' && item.workType === mediaTypeFilter) {
      score += 60;
    }

    // Prioriza edições principais (Original e Remake) com plataformas e ano reais
    if (item.editionType === 'Original') score += 45;
    else if (item.editionType === 'Remake') score += 40;
    else if (item.editionType === 'Remaster') score += 30;

    if (Array.isArray(item.platforms) && item.platforms.length > 0) score += 50;
    if (item.releaseYear) score += 35;
    if (item.coverUrl) score += 25;
    if (item.creator) score += 15;

    return score;
  };

  return [...candidates].sort((a, b) => {
    const diff = scoreItem(b) - scoreItem(a);
    if (diff !== 0) return diff;
    // Em empate (ex: Original 2005 vs Remake 2018), Original mais antigo vem primeiro
    const yA = Number(a.releaseYear) || 9999;
    const yB = Number(b.releaseYear) || 9999;
    return yA - yB;
  });
}

/**
 * Busca gratuita para Games (Wikidata enriquecida com plataformas reais + Original/Remake + CheapShark + FreeToGame).
 */
export async function searchGamesWorks(
  query,
  { signal, fetchImpl, mediaTypeFilter = 'all', onPartialResults = null } = {}
) {
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) return { ok: true, results: [], offline: false, partialFailure: false, usedSources: [] };
  if (isBrowserOffline()) {
    return { ok: false, results: [], offline: true, partialFailure: false, usedSources: [] };
  }

  const encoded = encodeURIComponent(cleanQuery);
  const cheapSharkUrl = `https://www.cheapshark.com/api/1.0/games?title=${encoded}&limit=10`;
  const wikidataSearchEnUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encoded}&language=en&uselang=pt&limit=10&format=json&origin=*`;
  const freeToGameUrl = 'https://www.freetogame.com/api/games';

  const resolvedType =
    mediaTypeFilter !== 'all'
      ? normalizeWorkTypeForDomain(mediaTypeFilter, 'games')
      : 'game';

  const csPromise = fetchJsonSafe(cheapSharkUrl, { signal, fetchImpl });
  const wdPromise = fetchJsonSafe(wikidataSearchEnUrl, { signal, fetchImpl });
  const ftgPromise = fetchJsonSafe(freeToGameUrl, { signal, fetchImpl });

  if (typeof onPartialResults === 'function') {
    const streamCandidates = [];
    const streamSources = new Set();
    let pending = 3;
    const emitGamesPartial = () => {
      if (signal?.aborted || streamCandidates.length === 0) return;
      const partialDeduped = deduplicateDomainCandidates(streamCandidates);
      const partialRanked = rankGamesCandidates(partialDeduped, cleanQuery, mediaTypeFilter).slice(0, 18);
      const srcArr = Array.from(streamSources);
      onPartialResults({
        results: partialRanked,
        usedSources: srcArr,
        pendingCount: pending,
        partial: pending > 0,
        sourceStatusHint: srcArr.length > 0 ? `Fontes: ${srcArr.join(' · ')}` : '',
      });
    };

    csPromise
      .then((val) => {
        pending = Math.max(0, pending - 1);
        if (!Array.isArray(val)) return;
        streamSources.add('CheapShark');
        for (const g of val) {
          const title = String(g.external || g.internalName || '').trim();
          if (!title) continue;
          const steamId = g.steamAppID ? String(g.steamAppID).trim() : null;
          const coverUrl = steamId
            ? `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${steamId}/library_600x900.jpg`
            : normalizeHttpsUrl(g.thumb);
          const editionType = detectGameEditionType({ title, workType: resolvedType });
          streamCandidates.push({
            id: `cs-${String(g.gameID || title)}`,
            domain: 'games',
            workType: editionType === 'DLC/Expansão' ? 'dlc' : resolvedType,
            title,
            creator: '',
            director: '',
            releaseYear: null,
            coverUrl,
            coverSources: [coverUrl, normalizeHttpsUrl(g.thumb)].filter(Boolean),
            platforms: ['PC'],
            platform: 'PC',
            platformDisplayLabel: 'PC',
            editionType,
            hoursPlayed: 0,
            completionType: 'História Principal',
            storeOrLauncher: steamId ? 'Steam' : '',
            buildOrCharacter: '',
            genres: [],
            ids: {
              cheapshark: g.gameID || null,
              ...(steamId ? { steam: steamId } : {}),
            },
            sourceBadge: steamId ? 'Steam / CheapShark' : 'CheapShark',
            mergedSources: ['CheapShark'],
          });
        }
        emitGamesPartial();
      })
      .catch(() => {
        pending = Math.max(0, pending - 1);
      });

    ftgPromise
      .then((val) => {
        pending = Math.max(0, pending - 1);
        if (!Array.isArray(val)) return;
        const qLower = cleanQuery.toLowerCase();
        const matches = val
          .filter((g) => String(g?.title || '').toLowerCase().includes(qLower))
          .slice(0, 6);
        if (matches.length === 0) return;
        streamSources.add('FreeToGame');
        for (const g of matches) {
          const parsedPlatforms = String(g.platform || '')
            .split(/[,/]/)
            .map((p) => normalizePlatformLabel(p))
            .filter(Boolean);
          const uniquePlats = Array.from(new Set(parsedPlatforms));
          streamCandidates.push({
            id: `ftg-${g.id}`,
            domain: 'games',
            workType: resolvedType,
            title: String(g.title || '').trim(),
            creator: String(g.developer || g.publisher || '').trim(),
            director: String(g.developer || g.publisher || '').trim(),
            releaseYear: g.release_date ? Number(String(g.release_date).slice(0, 4)) || null : null,
            coverUrl: normalizeHttpsUrl(g.thumbnail),
            synopsis: String(g.short_description || '').trim(),
            platforms: uniquePlats,
            platform: uniquePlats[0] || '',
            platformDisplayLabel: uniquePlats[0] || GAME_PLATFORM_UNSET_LABEL,
            editionType: 'Original',
            hoursPlayed: 0,
            completionType: 'Multiplayer / Ranked',
            storeOrLauncher: '',
            buildOrCharacter: '',
            genres: g.genre ? [String(g.genre)] : [],
            ids: { freetogame: g.id },
            sourceBadge: 'FreeToGame',
            mergedSources: ['FreeToGame'],
          });
        }
        emitGamesPartial();
      })
      .catch(() => {
        pending = Math.max(0, pending - 1);
      });
  }

  const [csRes, wdRes, ftgRes] = await Promise.allSettled([
    csPromise,
    wdPromise,
    ftgPromise,
  ]);

  const candidates = [];
  const usedSources = [];
  let failedCount = 0;

  // 1. Wikidata com enriquecimento de claims (P400 plataformas reais, P577 ano, P31/P4969/P144 Original vs Remake)
  if (wdRes.status === 'fulfilled' && Array.isArray(wdRes.value?.search)) {
    usedSources.push('Wikidata');
    const searchHits = wdRes.value.search.filter((ent) => {
      const desc = String(ent.description || '');
      const label = String(ent.label || '');
      // Aceita hits com descrição de jogo/remake/dlc ou match direto com a query (será verificado por P31)
      return (
        /jogo|videojogo|video\s?game|rpg|expans[ãa]o|dlc|remake|remaster/i.test(desc) ||
        normalizeText(label) === normalizeText(cleanQuery)
      );
    });

    const hitById = new Map(searchHits.map((h) => [h.id, h]));
    const primaryQids = searchHits.map((h) => h.id).filter(Boolean).slice(0, 8);

    let entitiesMap = null;
    if (primaryQids.length > 0) {
      try {
        const entitiesUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(
          primaryQids.join('|')
        )}&props=labels|descriptions|claims&languages=pt|en&format=json&origin=*`;
        const entData = await fetchJsonSafe(entitiesUrl, { signal, fetchImpl });
        if (entData?.entities && typeof entData.entities === 'object') {
          entitiesMap = entData.entities;
        }
      } catch {
        entitiesMap = null;
      }
    }

    if (entitiesMap) {
      const gameEntities = [];
      const derivativeQids = new Set();
      const allDerivativeTargetQids = new Set();
      const extraLabelQids = new Set();

      for (const qid of primaryQids) {
        const ent = entitiesMap[qid];
        if (!ent) continue;
        const hit = hitById.get(qid);
        if (!isLikelyGameEntity(ent, hit?.description || '')) continue;
        gameEntities.push({ entity: ent, hit });

        // Coleta obras derivadas (P4969) e obra original (P144) para encontrar Original <-> Remake/Remaster
        const p4969Targets = extractWikidataClaimIds(ent, 'P4969');
        for (const derivId of p4969Targets) {
          allDerivativeTargetQids.add(derivId);
        }
        for (const relId of [
          ...p4969Targets,
          ...extractWikidataClaimIds(ent, 'P144'),
        ]) {
          if (!entitiesMap[relId]) derivativeQids.add(relId);
        }
        // Coleta QIDs de desenvolvedoras (P178) e plataformas não mapeadas para resolver labels
        for (const devId of extractWikidataClaimIds(ent, 'P178').slice(0, 2)) {
          extraLabelQids.add(devId);
        }
        for (const platId of extractWikidataClaimIds(ent, 'P400')) {
          if (!WIKIDATA_PLATFORM_QIDS[platId]) extraLabelQids.add(platId);
        }
      }

      // Busca derivados (remakes/remasters) se houver
      if (derivativeQids.size > 0) {
        try {
          const derivIds = Array.from(derivativeQids).slice(0, 6);
          const derivUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(
            derivIds.join('|')
          )}&props=labels|descriptions|claims&languages=pt|en&format=json&origin=*`;
          const derivData = await fetchJsonSafe(derivUrl, { signal, fetchImpl });
          if (derivData?.entities && typeof derivData.entities === 'object') {
            for (const dId of derivIds) {
              const dEnt = derivData.entities[dId];
              if (!dEnt || !isLikelyGameEntity(dEnt, '')) continue;
              gameEntities.push({ entity: dEnt, hit: null });
              for (const nestedDeriv of extractWikidataClaimIds(dEnt, 'P4969')) {
                allDerivativeTargetQids.add(nestedDeriv);
              }
              for (const devId of extractWikidataClaimIds(dEnt, 'P178').slice(0, 2)) {
                extraLabelQids.add(devId);
              }
              for (const platId of extractWikidataClaimIds(dEnt, 'P400')) {
                if (!WIKIDATA_PLATFORM_QIDS[platId]) extraLabelQids.add(platId);
              }
            }
          }
        } catch {
          // Silencioso
        }
      }

      // Resolve labels de desenvolvedoras e plataformas adicionais em 1 chamada leve
      const labelMap = {};
      if (extraLabelQids.size > 0) {
        try {
          const lblIds = Array.from(extraLabelQids).slice(0, 20);
          const lblUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${encodeURIComponent(
            lblIds.join('|')
          )}&props=labels&languages=en|pt&format=json&origin=*`;
          const lblData = await fetchJsonSafe(lblUrl, { signal, fetchImpl });
          if (lblData?.entities && typeof lblData.entities === 'object') {
            for (const [id, ent] of Object.entries(lblData.entities)) {
              const lbl = ent?.labels?.en?.value || ent?.labels?.pt?.value || '';
              if (lbl) labelMap[id] = lbl;
            }
          }
        } catch {
          // Silencioso
        }
      }

      for (const { entity, hit } of gameEntities) {
        const built = buildWikidataGameCandidate(entity, {
          fallbackSearch: hit,
          labelMap,
          resolvedType,
          isDerivativeWork: allDerivativeTargetQids.has(entity.id),
        });
        if (built) candidates.push(built);
      }
    } else {
      // Fallback gracioso caso wbgetentities falhe: NUNCA assume PC / Steam!
      for (const ent of searchHits) {
        const desc = String(ent.description || '');
        if (!/jogo|videojogo|video\s?game|rpg|expans[ãa]o|dlc|remake|remaster/i.test(desc)) {
          continue;
        }
        const title = String(ent.label || '').trim();
        if (!title) continue;
        const isDlc = /\b(dlc|expans[ãa]o|expansion)\b/i.test(`${title} ${desc}`);
        const editionType = detectGameEditionType({
          title,
          description: desc,
          workType: isDlc ? 'dlc' : resolvedType,
        });
        candidates.push({
          id: `wd-${ent.id}`,
          domain: 'games',
          workType: isDlc ? 'dlc' : resolvedType,
          title,
          creator: '',
          director: '',
          releaseYear: extractYearFromDescription(desc),
          coverUrl: null,
          synopsis: desc,
          platforms: [],
          platform: '',
          platformDisplayLabel: GAME_PLATFORM_UNSET_LABEL,
          editionType,
          hoursPlayed: 0,
          completionType: 'História Principal',
          storeOrLauncher: '',
          buildOrCharacter: '',
          genres: [],
          ids: { wikidata: ent.id },
          sourceBadge: 'Wikidata',
          mergedSources: ['Wikidata'],
        });
      }
    }
  } else {
    failedCount += 1;
  }

  // 2. CheapShark (jogos PC / Steam reais)
  if (csRes.status === 'fulfilled' && Array.isArray(csRes.value)) {
    usedSources.push('CheapShark');
    for (const g of csRes.value) {
      const title = String(g.external || '').trim();
      if (!title) continue;
      const steamId = g.steamAppID ? String(g.steamAppID).trim() : '';
      const coverUrl = steamId
        ? `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${steamId}/library_600x900.jpg`
        : normalizeHttpsUrl(g.thumb);
      const editionType = detectGameEditionType({ title, workType: resolvedType });
      candidates.push({
        id: `cs-${String(g.gameID || title)}`,
        domain: 'games',
        workType: editionType === 'DLC/Expansão' ? 'dlc' : resolvedType,
        title,
        creator: '',
        director: '',
        releaseYear: null,
        coverUrl,
        coverSources: [coverUrl, normalizeHttpsUrl(g.thumb)].filter(Boolean),
        platforms: ['PC'],
        platform: 'PC',
        platformDisplayLabel: 'PC',
        editionType,
        hoursPlayed: 0,
        completionType: 'História Principal',
        storeOrLauncher: steamId ? 'Steam' : '',
        buildOrCharacter: '',
        genres: [],
        ids: {
          cheapshark: g.gameID || null,
          ...(steamId ? { steam: steamId } : {}),
        },
        sourceBadge: steamId ? 'Steam / CheapShark' : 'CheapShark',
        mergedSources: ['CheapShark'],
      });
    }
  } else {
    failedCount += 1;
  }

  // 3. FreeToGame (extrai plataforma real sem inventar Steam)
  if (ftgRes.status === 'fulfilled' && Array.isArray(ftgRes.value)) {
    usedSources.push('FreeToGame');
    const qLower = cleanQuery.toLowerCase();
    const matches = ftgRes.value
      .filter((g) => String(g?.title || '').toLowerCase().includes(qLower))
      .slice(0, 6);
    for (const g of matches) {
      const parsedPlatforms = String(g.platform || '')
        .split(/[,/]/)
        .map((p) => normalizePlatformLabel(p))
        .filter(Boolean);
      const uniquePlats = Array.from(new Set(parsedPlatforms));
      candidates.push({
        id: `ftg-${g.id}`,
        domain: 'games',
        workType: resolvedType,
        title: String(g.title || '').trim(),
        creator: String(g.developer || g.publisher || '').trim(),
        director: String(g.developer || g.publisher || '').trim(),
        releaseYear: g.release_date ? Number(String(g.release_date).slice(0, 4)) || null : null,
        coverUrl: normalizeHttpsUrl(g.thumbnail),
        synopsis: String(g.short_description || '').trim(),
        platforms: uniquePlats,
        platform: uniquePlats[0] || '',
        platformDisplayLabel: uniquePlats[0] || GAME_PLATFORM_UNSET_LABEL,
        editionType: 'Original',
        hoursPlayed: 0,
        completionType: 'Multiplayer / Ranked',
        storeOrLauncher: '',
        buildOrCharacter: '',
        genres: g.genre ? [String(g.genre)] : [],
        ids: { freetogame: g.id },
        sourceBadge: 'FreeToGame',
        mergedSources: ['FreeToGame'],
      });
    }
  } else {
    failedCount += 1;
  }

  const deduped = deduplicateDomainCandidates(candidates);
  const ranked = rankGamesCandidates(deduped, cleanQuery, mediaTypeFilter).slice(0, 18);

  return {
    ok: failedCount < 3,
    results: ranked,
    offline: false,
    partialFailure: failedCount > 0 && failedCount < 3 && ranked.length === 0,
    usedSources: Array.from(new Set(usedSources)),
    sourceStatusHint:
      usedSources.length > 0 ? `Fontes: ${Array.from(new Set(usedSources)).join(' · ')}` : '',
  };
}

/**
 * Ranqueia resultados de Música priorizando:
 * 1. Correspondência exata no título da faixa/álbum;
 * 2. Gravações originais mais antigas e artista principal antes de covers/tributos recentes (ex.: Metallica 1991 antes de covers 2021).
 */
export function rankMusicCandidates(candidates = [], query = '', mediaTypeFilter = 'all') {
  const normQ = normalizeText(query);
  const queryWantsCover = COVER_TRIBUTE_REGEX.test(String(query || ''));
  const queryWantsLive = LIVE_HINT_REGEX.test(String(query || '')) || mediaTypeFilter === 'live_show';
  const queryWords = normQ.split(' ').filter((w) => w.length >= 2);

  // Descobre o ano mais antigo (lançamento original) e o artista canônico para cada título base exato
  const earliestByBaseTitle = new Map();
  for (const item of candidates) {
    const baseTitle = normalizeText(stripParenthetical(item.title || ''));
    if (!baseTitle) continue;
    const isCover =
      !queryWantsCover &&
      COVER_TRIBUTE_REGEX.test(
        `${item.title || ''} ${item.albumName || ''} ${item.creator || ''}`
      );
    if (isCover) continue;
    const year = Number(item.releaseYear);
    if (!Number.isInteger(year) || year < 1900 || year > 2099) continue;

    const current = earliestByBaseTitle.get(baseTitle);
    if (!current || year < current.year) {
      earliestByBaseTitle.set(baseTitle, {
        year,
        artistNorm: normalizeText(item.creator || ''),
      });
    }
  }

  const scoreItem = (item) => {
    let score = 0;
    const rawTitle = String(item.title || '');
    const rawAlbum = String(item.albumName || '');
    const rawArtist = String(item.creator || '');
    const normTitle = normalizeText(rawTitle);
    const normBaseTitle = normalizeText(stripParenthetical(rawTitle));
    const normArtist = normalizeText(rawArtist);
    const normAlbum = normalizeText(rawAlbum);
    const normCombined = `${normArtist} ${normTitle}`.trim();

    // 1. Detecção pesada de cover / tributo / karaokê / Blacklist
    const isCoverOrTribute =
      !queryWantsCover &&
      COVER_TRIBUTE_REGEX.test(`${rawTitle} ${rawAlbum} ${rawArtist}`);
    if (isCoverOrTribute) {
      score -= 480;
    }

    // 2. Correspondência com a query
    if (normQ) {
      if (normTitle === normQ) score += 320;
      else if (normBaseTitle === normQ) score += 240;
      else if (normArtist === normQ) score += 260;
      else if (normTitle.startsWith(normQ)) score += 160;
      else if (normCombined.includes(normQ) || normTitle.includes(normQ)) score += 110;
      else if (normAlbum.includes(normQ)) score += 90;
      else if (queryWords.length > 0) {
        const matched = queryWords.filter(
          (w) => normTitle.includes(w) || normArtist.includes(w) || normAlbum.includes(w)
        ).length;
        score += matched * 45;
      }
    }

    // 3. Prioriza gravação original mais antiga e artista principal vs regravações posteriores
    const year = Number(item.releaseYear);
    const earliest = earliestByBaseTitle.get(normBaseTitle);
    if (earliest && Number.isInteger(year) && year >= 1900) {
      const sameOriginalArtist = earliest.artistNorm && normArtist === earliest.artistNorm;
      const yearDelta = Math.max(0, year - earliest.year);

      if (sameOriginalArtist) {
        score += 140;
        if (yearDelta <= 1) {
          // Lançamento original canônico!
          score += 240;
        } else {
          // Remaster / relançamento posterior do mesmo artista fica atrás do original
          score -= Math.min(80, yearDelta * 2);
        }
      } else if (yearDelta > 0) {
        // Outro artista lançando música com o mesmo nome anos depois -> fortemente tratado como cover posterior
        score -= Math.min(320, 140 + yearDelta * 7);
      }
    } else if (!isCoverOrTribute && Number.isInteger(year) && year >= 1950 && year <= 2026) {
      // Pequeno desempate suave a favor de gravações mais consolidadas quando não há variante exata
      score += Math.max(0, Math.round((2026 - year) * 0.6));
    }

    // 4. Penaliza sufixos derivativos (Live / Remaster / Deluxe / Acoustic) quando a query não pediu
    const hasVariantSuffix = VARIANT_SUFFIX_REGEX.test(rawTitle);
    if (hasVariantSuffix && !queryWantsCover && !queryWantsLive) {
      score -= 45;
    }

    // 5. Alinhamento com o filtro ativo
    if (mediaTypeFilter !== 'all') {
      if (item.workType === mediaTypeFilter) {
        score += 180;
      } else {
        score -= 120;
      }
    }

    // 6. Qualidade dos metadados
    if (item.coverUrl) score += 25;
    if (item.sourceBadge === 'iTunes') score += 15;
    if (item.workType === 'album' && Number(item.trackCount) >= 6) score += 15;

    return score;
  };

  return [...candidates].sort((a, b) => {
    const diff = scoreItem(b) - scoreItem(a);
    if (diff !== 0) return diff;
    const yA = Number(a.releaseYear) || 9999;
    const yB = Number(b.releaseYear) || 9999;
    return yA - yB;
  });
}

function matchesMusicFilter(item, mediaTypeFilter) {
  if (!mediaTypeFilter || mediaTypeFilter === 'all') return true;
  if (mediaTypeFilter === 'live_show') {
    return (
      item.workType === 'live_show' ||
      item.releaseFormat === 'Ao Vivo' ||
      LIVE_HINT_REGEX.test(`${item.title || ''} ${item.albumName || ''}`)
    );
  }
  return item.workType === mediaTypeFilter;
}

/**
 * Busca gratuita para Música (iTunes Search API paralela `entity=song` + `entity=album` + MusicBrainz
 * com AbortController timeout seguro de 12s e fallback silencioso quando iTunes responde).
 */
export async function searchMusicWorks(
  query,
  { signal, fetchImpl, mediaTypeFilter = 'all', onPartialResults = null } = {}
) {
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) {
    return {
      ok: true,
      results: [],
      offline: false,
      partialFailure: false,
      usedSources: [],
      silentFallbackSources: [],
      sourceStatusHint: '',
    };
  }
  if (isBrowserOffline()) {
    return {
      ok: false,
      results: [],
      offline: true,
      partialFailure: false,
      usedSources: [],
      silentFallbackSources: [],
      sourceStatusHint: '',
    };
  }

  const encoded = encodeURIComponent(cleanQuery);
  const itunesSongUrl = `https://itunes.apple.com/search?term=${encoded}&entity=song&limit=20`;
  const itunesAlbumUrl = `https://itunes.apple.com/search?term=${encoded}&entity=album&limit=15`;
  const itunesArtistUrl =
    mediaTypeFilter === 'discography'
      ? `https://itunes.apple.com/search?term=${encoded}&entity=musicArtist&limit=10`
      : null;

  const mbEndpoint =
    mediaTypeFilter === 'track'
      ? `https://musicbrainz.org/ws/2/recording?query=${encoded}&fmt=json&limit=10`
      : mediaTypeFilter === 'discography'
        ? `https://musicbrainz.org/ws/2/artist?query=${encoded}&fmt=json&limit=10`
        : `https://musicbrainz.org/ws/2/release-group?query=${encoded}&fmt=json&limit=10`;

  const fetchMusicBrainzThrottled = async (url) => {
    const cacheKey = `mb:search:${url}`;
    const cached = await getCachedEntry(CACHE_STORES.search, cacheKey).catch(() => null);
    if (cached?.hit && cached.data && !cached.expired) {
      return cached.data;
    }
    try {
      const res = await apiRequest(url, {
        provider: 'musicbrainz',
        headers: { Accept: 'application/json' },
        signal,
        fetchImpl,
        timeoutMs: MUSICBRAINZ_TIMEOUT_MS,
        maxRetries: 0,
      });
      if (!res?.ok) return null;
      const json = await res.json().catch(() => null);
      if (json) {
        await setCachedEntry(CACHE_STORES.search, cacheKey, json, {
          ttlMs: 12 * 60 * 60 * 1000,
        }).catch(() => {});
      }
      return json;
    } catch {
      return null;
    }
  };

  const songPromise = fetchJsonSafe(itunesSongUrl, { signal, fetchImpl });
  const albumPromise = fetchJsonSafe(itunesAlbumUrl, { signal, fetchImpl });
  const mbPromise = fetchMusicBrainzThrottled(mbEndpoint);
  const artistPromise = itunesArtistUrl
    ? fetchJsonSafe(itunesArtistUrl, { signal, fetchImpl })
    : null;

  if (typeof onPartialResults === 'function') {
    const streamCandidates = [];
    const streamSources = new Set();
    let pending = artistPromise ? 4 : 3;

    const emitMusicPartial = () => {
      if (signal?.aborted || streamCandidates.length === 0) return;
      const dedupedPartial = deduplicateDomainCandidates(streamCandidates);
      const filteredPartial =
        mediaTypeFilter !== 'all'
          ? dedupedPartial.filter((item) => matchesMusicFilter(item, mediaTypeFilter))
          : dedupedPartial;
      const rankedPartial = rankMusicCandidates(
        filteredPartial.length > 0 ? filteredPartial : dedupedPartial,
        cleanQuery,
        mediaTypeFilter
      ).slice(0, 18);
      const srcArr = Array.from(streamSources);
      onPartialResults({
        results: rankedPartial,
        usedSources: srcArr,
        pendingCount: pending,
        partial: pending > 0,
        sourceStatusHint: srcArr.length > 0 ? `Fonte: ${srcArr.join(' · ')}` : '',
      });
    };

    songPromise
      .then((val) => {
        pending = Math.max(0, pending - 1);
        if (!Array.isArray(val?.results)) return;
        streamSources.add('iTunes');
        for (const tr of val.results) {
          const trackName = String(tr.trackName || '').trim();
          if (!trackName) continue;
          const artist = String(tr.artistName || '').trim();
          const albumName = String(tr.collectionName || '').trim();
          const rawArt = String(tr.artworkUrl100 || '').trim();
          const highResArt = rawArt
            ? normalizeHttpsUrl(rawArt.replace(/100x100bb/i, '600x600bb'))
            : null;
          const primaryGenre = String(tr.primaryGenreName || '').trim();
          const isLive = LIVE_HINT_REGEX.test(`${trackName} ${albumName}`);
          const durationMs = Number(tr.trackTimeMillis) > 0 ? Number(tr.trackTimeMillis) : null;
          streamCandidates.push({
            id: `itunes-track-${tr.trackId || `${artist}-${trackName}`}`,
            domain: 'music',
            workType: 'track',
            title: trackName,
            creator: artist,
            director: artist,
            artist,
            albumName,
            durationMs,
            durationLabel: formatTrackDuration(durationMs),
            releaseYear: tr.releaseDate ? Number(String(tr.releaseDate).slice(0, 4)) || null : null,
            coverUrl: highResArt,
            genres: primaryGenre ? [primaryGenre] : [],
            subgenre: primaryGenre,
            releaseFormat: isLive ? 'Ao Vivo' : 'Faixa Individual',
            favoriteTrack: trackName,
            listenCount: 0,
            tracks: [{ number: Number(tr.trackNumber) || 1, title: trackName, durationMs }],
            trackCount: 1,
            ids: {
              itunesTrack: tr.trackId || null,
              itunes: tr.collectionId || null,
              itunesArtist: tr.artistId || null,
            },
            sourceBadge: 'iTunes',
            mergedSources: ['iTunes'],
          });
        }
        emitMusicPartial();
      })
      .catch(() => {
        pending = Math.max(0, pending - 1);
      });

    albumPromise
      .then((val) => {
        pending = Math.max(0, pending - 1);
        if (!Array.isArray(val?.results)) return;
        streamSources.add('iTunes');
        for (const alb of val.results) {
          const title = String(alb.collectionName || alb.trackName || '').trim();
          if (!title) continue;
          const artist = String(alb.artistName || '').trim();
          const rawArt = String(alb.artworkUrl100 || '').trim();
          const highResArt = rawArt
            ? normalizeHttpsUrl(rawArt.replace(/100x100bb/i, '600x600bb'))
            : null;
          const isLive = LIVE_HINT_REGEX.test(title);
          const isSingleOrEp =
            / - (Single|EP)$/i.test(title) ||
            (Number(alb.trackCount) > 0 && Number(alb.trackCount) <= 5);
          const inferredType = isLive ? 'live_show' : isSingleOrEp ? 'ep_single' : 'album';
          const primaryGenre = String(alb.primaryGenreName || '').trim();
          streamCandidates.push({
            id: `itunes-${alb.collectionId || title}`,
            domain: 'music',
            workType: inferredType,
            title,
            creator: artist,
            director: artist,
            artist,
            albumName: title,
            releaseYear: alb.releaseDate ? Number(String(alb.releaseDate).slice(0, 4)) || null : null,
            coverUrl: highResArt,
            genres: primaryGenre ? [primaryGenre] : [],
            subgenre: primaryGenre,
            releaseFormat: isLive ? 'Ao Vivo' : 'Álbum de Estúdio',
            favoriteTrack: '',
            listenCount: 0,
            tracks: [],
            trackCount: Number(alb.trackCount) || null,
            ids: { itunes: alb.collectionId || null, itunesArtist: alb.artistId || null },
            sourceBadge: 'iTunes',
            mergedSources: ['iTunes'],
          });
        }
        emitMusicPartial();
      })
      .catch(() => {
        pending = Math.max(0, pending - 1);
      });
  }

  const tasks = [songPromise, albumPromise, mbPromise];
  if (artistPromise) {
    tasks.push(artistPromise);
  }

  const [songRes, albumRes, mbRes, artistRes] = await Promise.allSettled(tasks);

  const candidates = [];
  const usedSources = [];
  const silentFallbackSources = [];
  let itunesSucceeded = false;

  // 1. iTunes Faixas (entity=song)
  if (songRes.status === 'fulfilled' && Array.isArray(songRes.value?.results)) {
    itunesSucceeded = true;
    for (const tr of songRes.value.results) {
      // Garante que realmente é uma faixa (evita duplicar caso mock responda álbum para toda URL de search)
      const trackName = String(tr.trackName || '').trim();
      if (!trackName) continue;
      const artist = String(tr.artistName || '').trim();
      const albumName = String(tr.collectionName || '').trim();
      const rawArt = String(tr.artworkUrl100 || '').trim();
      const highResArt = rawArt
        ? normalizeHttpsUrl(rawArt.replace(/100x100bb/i, '600x600bb'))
        : null;
      const primaryGenre = String(tr.primaryGenreName || '').trim();
      const isLive = LIVE_HINT_REGEX.test(`${trackName} ${albumName}`);
      const durationMs = Number(tr.trackTimeMillis) > 0 ? Number(tr.trackTimeMillis) : null;

      candidates.push({
        id: `itunes-track-${tr.trackId || `${artist}-${trackName}`}`,
        domain: 'music',
        workType: 'track',
        title: trackName,
        creator: artist,
        director: artist,
        artist,
        albumName,
        durationMs,
        durationLabel: formatTrackDuration(durationMs),
        releaseYear: tr.releaseDate ? Number(String(tr.releaseDate).slice(0, 4)) || null : null,
        coverUrl: highResArt,
        genres: primaryGenre ? [primaryGenre] : [],
        subgenre: primaryGenre,
        releaseFormat: isLive ? 'Ao Vivo' : 'Faixa Individual',
        favoriteTrack: trackName,
        listenCount: 0,
        tracks: [
          {
            number: Number(tr.trackNumber) || 1,
            title: trackName,
            durationMs,
          },
        ],
        trackCount: 1,
        ids: {
          itunesTrack: tr.trackId || null,
          itunes: tr.collectionId || null,
        },
        sourceBadge: 'iTunes',
        mergedSources: ['iTunes'],
      });
    }
  }

  // 2. iTunes Álbuns / EPs / Shows Ao Vivo (entity=album)
  if (albumRes.status === 'fulfilled' && Array.isArray(albumRes.value?.results)) {
    itunesSucceeded = true;
    for (const alb of albumRes.value.results) {
      if (alb.wrapperType === 'track' && !alb.collectionName) continue;
      const title = String(alb.collectionName || '').trim();
      if (!title) continue;
      const artist = String(alb.artistName || '').trim();
      const rawArt = String(alb.artworkUrl100 || '').trim();
      const highResArt = rawArt
        ? normalizeHttpsUrl(rawArt.replace(/100x100bb/i, '600x600bb'))
        : null;
      const isLive = LIVE_HINT_REGEX.test(title);
      const isSingleOrEp =
        / - (Single|EP)$/i.test(title) ||
        (Number(alb.trackCount) > 0 && Number(alb.trackCount) <= 5);
      const inferredType = isLive ? 'live_show' : isSingleOrEp ? 'ep_single' : 'album';
      const primaryGenre = String(alb.primaryGenreName || '').trim();

      candidates.push({
        id: `itunes-${alb.collectionId || title}`,
        domain: 'music',
        workType: inferredType,
        title,
        creator: artist,
        director: artist,
        artist,
        albumName: title,
        releaseYear: alb.releaseDate ? Number(String(alb.releaseDate).slice(0, 4)) || null : null,
        coverUrl: highResArt,
        genres: primaryGenre ? [primaryGenre] : [],
        subgenre: primaryGenre,
        releaseFormat: isLive ? 'Ao Vivo' : 'Álbum de Estúdio',
        favoriteTrack: '',
        listenCount: 0,
        tracks: [],
        trackCount: Number(alb.trackCount) || null,
        ids: { itunes: alb.collectionId || null },
        sourceBadge: 'iTunes',
        mergedSources: ['iTunes'],
      });
    }
  }

  // 3. iTunes Artistas / Bandas (quando filtro = discography)
  if (artistRes && artistRes.status === 'fulfilled' && Array.isArray(artistRes.value?.results)) {
    itunesSucceeded = true;
    const coverByArtist = new Map();
    for (const c of candidates) {
      const k = normalizeText(c.creator || '');
      if (k && c.coverUrl && !coverByArtist.has(k)) coverByArtist.set(k, c.coverUrl);
    }
    for (const art of artistRes.value.results) {
      const name = String(art.artistName || '').trim();
      if (!name) continue;
      const genre = String(art.primaryGenreName || '').trim();
      candidates.push({
        id: `itunes-artist-${art.artistId || name}`,
        domain: 'music',
        workType: 'discography',
        title: name,
        creator: name,
        director: name,
        artist: name,
        releaseYear: null,
        coverUrl: coverByArtist.get(normalizeText(name)) || null,
        genres: genre ? [genre] : [],
        subgenre: genre,
        releaseFormat: 'Coletânea',
        favoriteTrack: '',
        listenCount: 0,
        tracks: [],
        ids: { itunesArtist: art.artistId || null },
        sourceBadge: 'iTunes',
        mergedSources: ['iTunes'],
      });
    }
  }

  // Se o filtro for discography e iTunes só devolveu álbuns/faixas, sintetiza entradas únicas de Artista/Banda
  if (mediaTypeFilter === 'discography' && !candidates.some((c) => c.workType === 'discography')) {
    const artistMap = new Map();
    for (const c of candidates) {
      const name = String(c.creator || '').trim();
      const key = normalizeText(name);
      if (!key || artistMap.has(key)) continue;
      artistMap.set(key, {
        id: `itunes-band-${key.replace(/\s+/g, '-')}`,
        domain: 'music',
        workType: 'discography',
        title: name,
        creator: name,
        director: name,
        artist: name,
        releaseYear: c.releaseYear || null,
        coverUrl: c.coverUrl || null,
        genres: c.genres || [],
        subgenre: c.subgenre || '',
        releaseFormat: 'Coletânea',
        favoriteTrack: '',
        listenCount: 0,
        tracks: [],
        ids: c.ids || {},
        sourceBadge: c.sourceBadge || 'iTunes',
        mergedSources: c.mergedSources || ['iTunes'],
      });
    }
    candidates.push(...artistMap.values());
  }

  if (itunesSucceeded) {
    usedSources.push('iTunes');
  }

  // 4. MusicBrainz (fallback silencioso se falhar/timeout quando iTunes respondeu)
  if (mbRes.status === 'fulfilled' && mbRes.value) {
    usedSources.push('MusicBrainz');
    if (Array.isArray(mbRes.value['release-groups'])) {
      for (const rg of mbRes.value['release-groups']) {
        const title = String(rg.title || '').trim();
        if (!title) continue;
        const artist = Array.isArray(rg['artist-credit'])
          ? rg['artist-credit'].map((c) => c?.name || c?.artist?.name).filter(Boolean).join(', ')
          : '';
        const primaryType = String(rg['primary-type'] || '').toLowerCase();
        const secondaryTypes = Array.isArray(rg['secondary-types'])
          ? rg['secondary-types'].map((s) => String(s).toLowerCase())
          : [];
        const isLive = secondaryTypes.includes('live') || LIVE_HINT_REGEX.test(title);
        const inferredType = isLive
          ? 'live_show'
          : primaryType === 'ep' || primaryType === 'single'
            ? 'ep_single'
            : 'album';
        const tags = Array.isArray(rg.tags)
          ? rg.tags
              .slice(0, 4)
              .map((t) => String(t?.name || '').trim())
              .filter(Boolean)
          : [];
        const coverUrl = rg.id
          ? `https://coverartarchive.org/release-group/${rg.id}/front-500`
          : null;

        candidates.push({
          id: `mb-${rg.id}`,
          domain: 'music',
          workType: inferredType,
          title,
          creator: artist,
          director: artist,
          artist,
          albumName: title,
          releaseYear: rg['first-release-date']
            ? Number(String(rg['first-release-date']).slice(0, 4)) || null
            : null,
          coverUrl,
          genres: tags,
          subgenre: tags[0] || '',
          releaseFormat: isLive ? 'Ao Vivo' : 'Álbum de Estúdio',
          favoriteTrack: '',
          listenCount: 0,
          tracks: [],
          ids: { musicbrainz: rg.id },
          sourceBadge: 'MusicBrainz',
          mergedSources: ['MusicBrainz'],
        });
      }
    } else if (Array.isArray(mbRes.value.recordings)) {
      for (const rec of mbRes.value.recordings) {
        const title = String(rec.title || '').trim();
        if (!title) continue;
        const artist = Array.isArray(rec['artist-credit'])
          ? rec['artist-credit'].map((c) => c?.name || c?.artist?.name).filter(Boolean).join(', ')
          : '';
        const firstRelease = Array.isArray(rec.releases) ? rec.releases[0] : null;
        const albumName = String(firstRelease?.title || '').trim();
        const releaseDate = String(rec['first-release-date'] || firstRelease?.date || '');
        const durationMs = Number(rec.length) > 0 ? Number(rec.length) : null;

        candidates.push({
          id: `mb-rec-${rec.id}`,
          domain: 'music',
          workType: 'track',
          title,
          creator: artist,
          director: artist,
          artist,
          albumName,
          durationMs,
          durationLabel: formatTrackDuration(durationMs),
          releaseYear: releaseDate ? Number(releaseDate.slice(0, 4)) || null : null,
          coverUrl: firstRelease?.['release-group']?.id
            ? `https://coverartarchive.org/release-group/${firstRelease['release-group'].id}/front-500`
            : null,
          genres: [],
          subgenre: '',
          releaseFormat: LIVE_HINT_REGEX.test(`${title} ${albumName}`)
            ? 'Ao Vivo'
            : 'Faixa Individual',
          favoriteTrack: title,
          listenCount: 0,
          tracks: [{ number: 1, title, durationMs }],
          trackCount: 1,
          ids: { musicbrainzRecording: rec.id },
          sourceBadge: 'MusicBrainz',
          mergedSources: ['MusicBrainz'],
        });
      }
    } else if (Array.isArray(mbRes.value.artists)) {
      for (const art of mbRes.value.artists) {
        const name = String(art.name || '').trim();
        if (!name) continue;
        const tags = Array.isArray(art.tags)
          ? art.tags.slice(0, 4).map((t) => String(t?.name || '').trim()).filter(Boolean)
          : [];
        candidates.push({
          id: `mb-art-${art.id}`,
          domain: 'music',
          workType: 'discography',
          title: name,
          creator: name,
          director: name,
          artist: name,
          releaseYear: art['life-span']?.begin
            ? Number(String(art['life-span'].begin).slice(0, 4)) || null
            : null,
          coverUrl: null,
          genres: tags,
          subgenre: tags[0] || '',
          releaseFormat: 'Coletânea',
          favoriteTrack: '',
          listenCount: 0,
          tracks: [],
          ids: { musicbrainzArtist: art.id },
          sourceBadge: 'MusicBrainz',
          mergedSources: ['MusicBrainz'],
        });
      }
    }
  } else {
    silentFallbackSources.push('MusicBrainz');
  }

  const deduped = deduplicateDomainCandidates(candidates);
  const filtered =
    mediaTypeFilter !== 'all'
      ? deduped.filter((item) => matchesMusicFilter(item, mediaTypeFilter))
      : deduped;

  const finalList = rankMusicCandidates(
    filtered.length > 0 ? filtered : deduped,
    cleanQuery,
    mediaTypeFilter
  ).slice(0, 18);

  const mbFailed = mbRes.status !== 'fulfilled';
  const allFailedNow = !itunesSucceeded && mbFailed;

  // Fallback silencioso: se MusicBrainz oscilar mas iTunes retornou resultados válidos, partialFailure = false!
  const shouldReportPartialFailure =
    !allFailedNow && !(itunesSucceeded && finalList.length > 0) && mbFailed;

  return {
    ok: !allFailedNow,
    results: finalList,
    offline: false,
    partialFailure: shouldReportPartialFailure,
    usedSources: Array.from(new Set(usedSources)),
    silentFallbackSources,
    sourceStatusHint:
      usedSources.length > 0
        ? `Fonte: ${Array.from(new Set(usedSources)).join(' · ')}`
        : '',
  };
}

/**
 * Busca a lista de faixas de um álbum/EP via iTunes Lookup ou MusicBrainz.
 */
export async function fetchMusicReleaseTracks(
  candidate = {},
  { signal, fetchImpl } = {}
) {
  if (isBrowserOffline()) return [];
  const itunesId = candidate?.ids?.itunes;
  if (itunesId) {
    try {
      const payload = await fetchJsonSafe(
        `https://itunes.apple.com/lookup?id=${encodeURIComponent(itunesId)}&entity=song`,
        { signal, fetchImpl }
      );
      const tracks = (Array.isArray(payload?.results) ? payload.results : [])
        .filter((r) => r.wrapperType === 'track' && r.trackName)
        .map((r, idx) => ({
          number: Number(r.trackNumber) || idx + 1,
          title: String(r.trackName).trim(),
          durationMs: Number(r.trackTimeMillis) || null,
        }));
      if (tracks.length > 0) return tracks;
    } catch {
      // Silencioso e tenta MusicBrainz caso exista
    }
  }

  const mbId = candidate?.ids?.musicbrainz;
  if (mbId) {
    try {
      const rgData = await fetchJsonSafe(
        `https://musicbrainz.org/ws/2/release-group/${encodeURIComponent(mbId)}?inc=releases&fmt=json`,
        {
          signal,
          fetchImpl,
          headers: { Accept: 'application/json' },
          timeoutMs: MUSICBRAINZ_TIMEOUT_MS,
        }
      );
      const firstReleaseId = rgData?.releases?.[0]?.id;
      if (!firstReleaseId) return [];
      const relData = await fetchJsonSafe(
        `https://musicbrainz.org/ws/2/release/${encodeURIComponent(firstReleaseId)}?inc=recordings&fmt=json`,
        {
          signal,
          fetchImpl,
          headers: { Accept: 'application/json' },
          timeoutMs: MUSICBRAINZ_TIMEOUT_MS,
        }
      );
      const mediaList = Array.isArray(relData?.media) ? relData.media : [];
      const tracks = mediaList.flatMap((m) =>
        (Array.isArray(m.tracks) ? m.tracks : []).map((t, idx) => ({
          number: Number(t.position) || idx + 1,
          title: String(t.title || '').trim(),
          durationMs: Number(t.length) || null,
        }))
      );
      return tracks.filter((t) => t.title);
    } catch {
      return [];
    }
  }

  return [];
}

export async function searchWorksByDomain(domain, query, options = {}) {
  const cleanDomain = normalizeDomainId(domain);
  if (cleanDomain === 'reading') return searchReadingWorks(query, options);
  if (cleanDomain === 'games') return searchGamesWorks(query, options);
  if (cleanDomain === 'music') return searchMusicWorks(query, options);
  return { ok: true, results: [], offline: false, partialFailure: false, usedSources: [] };
}

export function getQuickSuggestionsForDomain(domain = 'cinema') {
  const clean = normalizeDomainId(domain);
  if (clean === 'reading') {
    return [
      { label: 'Franz Kafka', query: 'Franz Kafka', filter: 'book' },
      { label: 'Duna (Livro)', query: 'Duna Frank Herbert', filter: 'book' },
      { label: 'Vagabond (Mangá)', query: 'Vagabond Takehiko Inoue', filter: 'manga' },
      { label: 'Meditações', query: 'Meditações Marco Aurélio', filter: 'technical' },
    ];
  }
  if (clean === 'games') {
    return [
      { label: 'Shadow of the Colossus', query: 'Shadow of the Colossus', filter: 'game' },
      { label: 'Elden Ring', query: 'Elden Ring', filter: 'game' },
      { label: 'Hollow Knight', query: 'Hollow Knight', filter: 'game' },
      { label: 'Chrono Trigger', query: 'Chrono Trigger', filter: 'game' },
    ];
  }
  if (clean === 'music') {
    return [
      { label: 'Sad But True (Faixa)', query: 'Sad But True', filter: 'track' },
      { label: 'Powerslave (Álbum)', query: 'Iron Maiden Powerslave', filter: 'album' },
      { label: 'Temple of Shadows', query: 'Angra Temple of Shadows', filter: 'album' },
      { label: 'Clube da Esquina', query: 'Clube da Esquina Milton Nascimento', filter: 'album' },
    ];
  }
  return [
    { label: 'Hayao Miyazaki', query: 'Spirited Away', filter: 'anime', sources: ['anilist', 'jikan'] },
    { label: 'Blade Runner 2049', query: 'Blade Runner', filter: 'movie', sources: ['tmdb', 'imdb', 'wikidata'] },
    { label: 'Breaking Bad', query: 'Breaking Bad', filter: 'series', sources: ['tvmaze', 'tmdb', 'imdb'] },
    { label: 'Attack on Titan', query: 'Attack on Titan', filter: 'anime', sources: ['anilist', 'jikan'] },
    { label: 'Parasita', query: 'Parasite', filter: 'movie', sources: ['tmdb', 'imdb', 'wikidata'] },
    { label: 'Cowboy Bebop', query: 'Cowboy Bebop', filter: 'anime', sources: ['anilist', 'jikan'] },
  ];
}
