import { getTodayLocalISO } from './backlogHelpers.js';

function cleanNormalized(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function detectDelimiter(headerLine) {
  const commas = (headerLine.match(/,/g) || []).length;
  const semis = (headerLine.match(/;/g) || []).length;
  const tabs = (headerLine.match(/\t/g) || []).length;
  if (tabs > commas && tabs > semis) return '\t';
  if (semis > commas) return ';';
  return ',';
}

export function parseCsvRows(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!raw) return [];
  const firstBreak = raw.indexOf('\n');
  const firstLine = firstBreak === -1 ? raw : raw.slice(0, firstBreak);
  const delim = detectDelimiter(firstLine);

  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    const next = raw[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\r') {
      // Ignora CR antes de LF
    } else if (ch === '\n') {
      row.push(cell.trim());
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }

  row.push(cell.trim());
  if (row.some((v) => v !== '')) rows.push(row);
  return rows;
}

export function detectCatalogImportFormat(headers = [], rawText = '') {
  const low = headers.map((h) => String(h || '').trim().toLowerCase());
  if (
    low.includes('letterboxd uri') ||
    (low.includes('name') && low.includes('year') && (low.includes('date') || low.includes('watched date') || low.includes('rating')))
  ) {
    return 'letterboxd';
  }
  if (
    low.includes('const') ||
    low.includes('imdb rating') ||
    low.includes('title type') ||
    low.includes('runtime (mins)')
  ) {
    return 'imdb';
  }
  if (
    low.includes('watched episodes') ||
    low.includes('my_watched_episodes') ||
    low.includes('series_title') ||
    low.includes('my_status') ||
    (low.includes('episodes') && low.includes('score'))
  ) {
    return 'myanimelist';
  }
  if (
    headers.length >= 2 &&
    (low.includes('title') || low.includes('título') || low.includes('titulo') || low.includes('name') || low.includes('nome'))
  ) {
    return 'generic-csv';
  }
  if (String(rawText || '').trim().length > 0) {
    return 'plain-list';
  }
  return 'unknown';
}

function mapImportedStatus(rawStatus = '', format = 'generic-csv') {
  const low = String(rawStatus || '').trim().toLowerCase();
  if (!low) {
    return format === 'letterboxd' ? 'completed' : 'queued';
  }
  if (/currently|watching|assistindo|active|playing/.test(low)) return 'playing';
  if (/on-hold|on hold|paused|em pausa/.test(low)) return 'paused';
  if (/rewatch|reassist/.test(low)) return 'rewatching';
  if (/watched|completed|conclu|finished|assistido/.test(low)) return 'completed';
  if (/drop|abandon|dnf/.test(low)) return 'dropped';
  if (/plan to watch|watchlist|quero ver|queued/.test(low)) return 'queued';
  return 'queued';
}

function mapImportedRating(rawRating) {
  const num = Number(String(rawRating || '').replace(',', '.'));
  if (!Number.isFinite(num) || num <= 0) return null;
  if (num <= 5) return Math.round(num * 20);
  if (num <= 10) return Math.round(num * 10);
  return Math.min(100, Math.round(num));
}

function mapImportedWorkType(rawType = '', format = 'generic-csv') {
  if (format === 'myanimelist') return 'anime';
  if (format === 'letterboxd') return 'movie';
  const low = String(rawType || '').trim().toLowerCase();
  if (/anime|ova|ona/.test(low)) return 'anime';
  if (/tv|series|s[eé]rie|mini-series|show/.test(low)) return 'series';
  return 'movie';
}

export function findDuplicateMatch(candidate, existingItems = []) {
  const candImdb = String(candidate?.imdbId || '').trim().toLowerCase();
  const candTitle = cleanNormalized(candidate?.title);
  const candOrig = cleanNormalized(candidate?.originalTitle);
  const candYear = Number(candidate?.releaseYear) || 0;

  if (!candTitle && !candImdb) return null;

  return (
    (Array.isArray(existingItems) ? existingItems : []).find((item) => {
      if (!item) return false;
      const itemImdb = String(item.imdbId || '').trim().toLowerCase();
      if (candImdb && itemImdb && candImdb === itemImdb) return true;

      const itemTitle = cleanNormalized(item.title);
      const itemOrig = cleanNormalized(item.originalTitle);
      const itemYear = Number(item.releaseYear) || 0;

      const titleMatch =
        (candTitle && (candTitle === itemTitle || candTitle === itemOrig)) ||
        (candOrig && (candOrig === itemTitle || candOrig === itemOrig));

      if (!titleMatch) return false;
      if (candYear && itemYear && candYear !== itemYear) return false;
      return true;
    }) || null
  );
}

export function parseCatalogImport({ text = '', existingItems = [] } = {}) {
  const raw = String(text || '').trim();
  if (!raw) {
    return { format: 'unknown', records: [], duplicateCount: 0, newCount: 0 };
  }

  const rows = parseCsvRows(raw);
  const headerRow = rows[0] || [];
  const format = detectCatalogImportFormat(headerRow, raw);
  const today = getTodayLocalISO();

  let records = [];

  if (format === 'plain-list') {
    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.trim().replace(/^[-*•\d.)\s]+/, '').trim())
      .filter(Boolean);

    records = lines.map((line, idx) => {
      const yearMatch = line.match(/\((\d{4})\)\s*$/);
      const releaseYear = yearMatch ? Number(yearMatch[1]) : null;
      const withoutYear = yearMatch ? line.slice(0, yearMatch.index).trim() : line;
      const sepMatch = withoutYear.match(/^(.+?)\s+[—–-]\s+(.+)$/);
      const title = sepMatch ? sepMatch[1].trim() : withoutYear;
      const director = sepMatch ? sepMatch[2].trim() : '';

      return {
        tempId: `imp-${idx}`,
        title,
        director,
        releaseYear,
        status: 'queued',
        workType: 'movie',
        genres: [],
        tags: [],
        inBacklog: true,
        createdAt: new Date().toISOString(),
      };
    });
  } else {
    const colIndex = new Map(
      headerRow.map((h, i) => [String(h || '').trim().toLowerCase(), i])
    );
    const get = (r, keys) => {
      for (const k of keys) {
        const idx = colIndex.get(k);
        if (idx !== undefined && r[idx] !== undefined && r[idx] !== '') {
          return String(r[idx]).trim();
        }
      }
      return '';
    };

    records = rows
      .slice(1)
      .map((r, idx) => {
        const title = get(r, [
          'title',
          'título',
          'titulo',
          'name',
          'nome',
          'series_title',
        ]);
        if (!title) return null;

        const workType = mapImportedWorkType(
          get(r, ['title type', 'worktype', 'type', 'tipo', 'series_type']),
          format
        );
        const director = get(r, [
          'directors',
          'director',
          'diretor',
          'direção',
          'studio',
          'estúdio',
        ]);
        const yearRaw = Number(get(r, ['year', 'ano', 'releaseyear']));
        const releaseYear = Number.isFinite(yearRaw) && yearRaw > 1880 ? Math.round(yearRaw) : null;
        const imdbId = get(r, ['const', 'imdbid']);
        const runtimeRaw = Number(get(r, ['runtime (mins)', 'duration', 'duração', 'duracao']));
        const durationMinutes =
          Number.isFinite(runtimeRaw) && runtimeRaw > 0 ? Math.round(runtimeRaw) : null;
        const totalEpisodesRaw = Number(
          get(r, ['episodes', 'series_episodes', 'totalepisodes', 'episódios'])
        );
        const totalEpisodes =
          Number.isFinite(totalEpisodesRaw) && totalEpisodesRaw > 0
            ? Math.round(totalEpisodesRaw)
            : null;
        const watchedEpisodesRaw = Number(
          get(r, ['watched episodes', 'my_watched_episodes', 'currentepisode'])
        );
        const currentEpisode =
          Number.isFinite(watchedEpisodesRaw) && watchedEpisodesRaw >= 0
            ? Math.round(watchedEpisodesRaw)
            : 0;

        const rawStatus = get(r, ['status', 'my_status', 'watch status']);
        const rating = mapImportedRating(
          get(r, ['your rating', 'rating', 'score', 'my_score', 'nota'])
        );
        const rawDate = get(r, ['watched date', 'date', 'date rated', 'my_finish_date']);
        const status = mapImportedStatus(
          rawStatus || (rating !== null && format === 'letterboxd' ? 'watched' : ''),
          format
        );
        const completedDate =
          status === 'completed'
            ? rawDate && /^\d{4}[-/]\d{2}[-/]\d{2}/.test(rawDate)
              ? rawDate.slice(0, 10).replace(/\//g, '-')
              : today
            : null;

        const rawGenres = get(r, ['genres', 'gêneros', 'generos']);
        const genres = rawGenres
          ? Array.from(
              new Set(
                rawGenres
                  .split(/[,;|]/)
                  .map((g) => g.trim())
                  .filter(Boolean)
              )
            ).slice(0, 4)
          : [];

        const rawTags = get(r, ['tags', 'my_tags']);
        const tags = rawTags
          ? Array.from(
              new Set(
                rawTags
                  .split(/[,;|]/)
                  .map((t) => t.trim())
                  .filter(Boolean)
              )
            ).slice(0, 12)
          : [];

        const isRewatch = /^(true|yes|1|sim)$/i.test(get(r, ['rewatch']));

        return {
          tempId: `imp-${idx}`,
          title,
          director,
          releaseYear,
          imdbId,
          workType,
          status,
          durationMinutes,
          totalSeconds: workType === 'movie' && durationMinutes ? durationMinutes * 60 : null,
          totalEpisodes,
          currentEpisode,
          rewatchCount: isRewatch ? 1 : 0,
          rating,
          genres,
          tags,
          completedDate,
          inBacklog: true,
        };
      })
      .filter(Boolean);
  }

  const annotated = records.map((rec) => {
    const duplicateOf = findDuplicateMatch(rec, existingItems);
    return {
      ...rec,
      isDuplicate: Boolean(duplicateOf),
      duplicateTitle: duplicateOf?.title || '',
    };
  });

  const duplicateCount = annotated.filter((r) => r.isDuplicate).length;
  return {
    format,
    records: annotated,
    duplicateCount,
    newCount: annotated.length - duplicateCount,
  };
}
