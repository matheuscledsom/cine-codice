export const BUDDY_READ_STORAGE_KEY = 'codice_buddy_reads_v1';
const MAX_IMPORT_BYTES = 32768;

function sanitizePlainText(raw, maxLen = 500) {
  return String(raw || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

export function clampSpoilerPct(rawPct) {
  const num = Number(rawPct);
  if (!Number.isFinite(num) || num <= 0) return 0;
  if (num >= 100) return 100;
  return Math.round(num * 10) / 10;
}

export function buildWorkMatchKey(item) {
  if (!item) return '';
  const imdb = String(item.imdbId || '').trim().toLowerCase();
  if (imdb) return `imdb:${imdb}`;
  if (item.anilistId) return `anilist:${item.anilistId}`;
  if (item.tvmazeId) return `tvmaze:${item.tvmazeId}`;
  const normTitle = String(item.title || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
  return normTitle ? `title:${normTitle}` : `id:${String(item.id || '')}`;
}

/**
 * Escudo Anti-Spoiler estrito: remove totalmente notas com progressPct acima
 * do percentual atual do leitor. Nenhum texto oculto é retornado em `visible`.
 */
export function filterBuddyComments(comments = [], viewerProgressPct = 0) {
  const threshold = clampSpoilerPct(viewerProgressPct);
  const safe = Array.isArray(comments) ? comments : [];
  const visible = [];
  let hiddenCount = 0;

  for (const note of safe) {
    if (!note || typeof note !== 'object' || !note.text) continue;
    const notePct = clampSpoilerPct(note.progressPct);
    if (notePct > threshold) {
      hiddenCount += 1;
      continue;
    }
    visible.push({
      id: String(note.id || ''),
      workKey: String(note.workKey || ''),
      authorName: sanitizePlainText(note.authorName || 'Leitor', 60),
      authorHandle: sanitizePlainText(note.authorHandle || '', 40),
      progressPct: notePct,
      text: sanitizePlainText(note.text, 500),
      createdAt: String(note.createdAt || ''),
    });
  }

  visible.sort(
    (a, b) =>
      a.progressPct - b.progressPct ||
      String(b.createdAt).localeCompare(String(a.createdAt))
  );

  return { visible, hiddenCount, threshold };
}

function readAllBuddyStores() {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(BUDDY_READ_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function writeAllBuddyStores(store) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(BUDDY_READ_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Falha silenciosa se quota excedida
  }
}

export function loadBuddyComments(workKey) {
  if (!workKey) return [];
  const store = readAllBuddyStores();
  const list = store[String(workKey)];
  return Array.isArray(list) ? list : [];
}

export function addBuddyComment({
  workKey,
  authorName = 'Você',
  authorHandle = '',
  progressPct = 0,
  text = '',
} = {}) {
  const cleanKey = String(workKey || '').trim();
  const cleanText = sanitizePlainText(text, 500);
  if (!cleanKey || !cleanText) return { ok: false, comments: loadBuddyComments(cleanKey) };

  const note = {
    id: `br-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    workKey: cleanKey,
    authorName: sanitizePlainText(authorName, 60) || 'Leitor',
    authorHandle: sanitizePlainText(authorHandle, 40),
    progressPct: clampSpoilerPct(progressPct),
    text: cleanText,
    createdAt: new Date().toISOString(),
  };

  const store = readAllBuddyStores();
  const existing = Array.isArray(store[cleanKey]) ? store[cleanKey] : [];
  const next = [note, ...existing].slice(0, 120);
  store[cleanKey] = next;
  writeAllBuddyStores(store);

  return { ok: true, note, comments: next };
}

export function encodeBuddyClubBundle(workKey, comments = []) {
  const cleanKey = String(workKey || '').trim();
  const safeNotes = (Array.isArray(comments) ? comments : []).slice(0, 40).map((n) => ({
    id: String(n.id || ''),
    authorName: sanitizePlainText(n.authorName || 'Leitor', 60),
    authorHandle: sanitizePlainText(n.authorHandle || '', 40),
    progressPct: clampSpoilerPct(n.progressPct),
    text: sanitizePlainText(n.text, 500),
    createdAt: String(n.createdAt || new Date().toISOString()),
  }));

  const payload = JSON.stringify({
    codiceBuddyRead: 1,
    workKey: cleanKey,
    notes: safeNotes,
  });
  return `CODICE-BUDDY:${payload}`;
}

export function importBuddyClubBundle(rawBundle, targetWorkKey = '') {
  const str = String(rawBundle || '').trim();
  if (!str || str.length > MAX_IMPORT_BYTES) {
    return { ok: false, error: 'Pacote vazio ou excede o limite de 32 KB.' };
  }
  const cleanJson = str.startsWith('CODICE-BUDDY:')
    ? str.slice('CODICE-BUDDY:'.length).trim()
    : str;

  try {
    const parsed = JSON.parse(cleanJson);
    if (!parsed || parsed.codiceBuddyRead !== 1 || !Array.isArray(parsed.notes)) {
      return { ok: false, error: 'Formato de Leitura Conjunta inválido.' };
    }
    const workKey = String(targetWorkKey || parsed.workKey || '').trim();
    if (!workKey) {
      return { ok: false, error: 'Obra não identificada no pacote.' };
    }

    const store = readAllBuddyStores();
    const existing = Array.isArray(store[workKey]) ? store[workKey] : [];
    const seenIds = new Set(existing.map((n) => String(n.id)));

    const incoming = [];
    for (const raw of parsed.notes.slice(0, 40)) {
      const cleanText = sanitizePlainText(raw?.text, 500);
      if (!cleanText) continue;
      const id =
        sanitizePlainText(raw?.id, 48) ||
        `br-imp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      incoming.push({
        id,
        workKey,
        authorName: sanitizePlainText(raw?.authorName || 'Convidado', 60),
        authorHandle: sanitizePlainText(raw?.authorHandle || '', 40),
        progressPct: clampSpoilerPct(raw?.progressPct),
        text: cleanText,
        createdAt: sanitizePlainText(raw?.createdAt || new Date().toISOString(), 40),
      });
    }

    const merged = [...incoming, ...existing].slice(0, 120);
    store[workKey] = merged;
    writeAllBuddyStores(store);

    return { ok: true, importedCount: incoming.length, comments: merged };
  } catch {
    return { ok: false, error: 'Não foi possível ler o pacote colado.' };
  }
}
