import DOMPurify from 'dompurify';
import { domainConfig, normalizeCinemaWorkType } from '../config/domainConfig.js';
import { getWatchedMinutes } from '../utils/backlogHelpers.js';
import { generateQrCodeSvg } from '../utils/qrCodeSvg.js';

export const MAX_PROFILE_CARD_BYTES = 4096;
export const SAVED_PEER_CARDS_KEY = 'cine_codice_saved_peer_cards_v1';

const BLOCKED_KEY_PATTERNS = [
  'aizasy',
  'sk-',
  ['service', 'role'].join('_'),
  'supabasekey',
  'anonkey',
  'password',
  'apikey',
];

export function sanitizePlainText(value, maxLength = 200) {
  const raw = String(value ?? '');
  const domCleaned =
    typeof DOMPurify?.sanitize === 'function'
      ? DOMPurify.sanitize(raw, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] })
      : raw;

  let clean = String(domCleaned)
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\b(?:javascript|data|vbscript):/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (maxLength > 0 && clean.length > maxLength) {
    clean = clean.slice(0, maxLength).trim();
  }
  return clean;
}

function sanitizeCardHandle(rawHandle) {
  const clean = sanitizePlainText(rawHandle, 40)
    .toLowerCase()
    .replace(/[^@a-z0-9_.-]/g, '');
  if (!clean) return '@espectador';
  return clean.startsWith('@') ? clean : `@${clean}`;
}

function sanitizeYear(yr) {
  const num = Number(yr);
  if (!Number.isFinite(num) || num < 1888 || num > 2200) return null;
  return Math.round(num);
}

function toBase64Url(uint8Bytes) {
  let binary = '';
  for (let i = 0; i < uint8Bytes.length; i += 1) {
    binary += String.fromCharCode(uint8Bytes[i]);
  }
  const base64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : Buffer.from(uint8Bytes).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(token) {
  const clean = String(token || '').trim();
  if (!/^[A-Za-z0-9_-]+$/.test(clean)) {
    throw new Error('Formato inválido de cartão de perfil.');
  }
  const padded = clean.replace(/-/g, '+').replace(/_/g, '/') +
    '==='.slice((clean.length + 3) % 4);
  if (typeof atob === 'function') {
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) {
      bytes[i] = bin.charCodeAt(i);
    }
    return bytes;
  }
  return new Uint8Array(Buffer.from(padded, 'base64'));
}

function buildCompactCardPayload({
  profile = {},
  items = [],
  titleName = '',
  streakCount = 0,
}) {
  const backlog = (Array.isArray(items) ? items : []).filter(
    (item) => item && item.inBacklog !== false
  );
  const completed = backlog.filter((item) => item.status === 'completed');
  const hoursWatched = Math.round(
    backlog.reduce((sum, item) => sum + getWatchedMinutes(item), 0) / 60
  );

  const currentlyWatching = backlog
    .filter((item) => item.status === 'playing' || item.status === 'rewatching')
    .sort((a, b) => {
      const tA = Date.parse(a.updatedAt || a.createdAt || '') || 0;
      const tB = Date.parse(b.updatedAt || b.createdAt || '') || 0;
      return tB - tA;
    })[0];

  const topRated = backlog
    .filter((item) => typeof item.rating === 'number')
    .sort((a, b) => {
      const tA = Date.parse(a.completedDate || a.updatedAt || a.createdAt || '') || 0;
      const tB = Date.parse(b.completedDate || b.updatedAt || b.createdAt || '') || 0;
      return tB - tA || b.rating - a.rating;
    })
    .slice(0, 5)
    .map((item) => ({
      ti: sanitizePlainText(item.title, 70),
      au: sanitizePlainText(item.director || item.studio || '', 50),
      rt: Math.max(0, Math.min(100, Math.round(Number(item.rating) || 0))),
      wt: normalizeCinemaWorkType(item.workType),
      yr: sanitizeYear(item.releaseYear),
      vd: sanitizePlainText(item.verdict || '', 28),
    }))
    .filter((entry) => Boolean(entry.ti));

  const publicQuotes = [];
  for (const item of backlog) {
    if (!Array.isArray(item.quotes)) continue;
    for (const quote of item.quotes) {
      const text = sanitizePlainText(quote?.text || '', 170);
      if (!text) continue;
      publicQuotes.push({
        tx: text,
        wk: sanitizePlainText(item.title, 60),
        lo: sanitizePlainText(quote?.location || '', 24),
      });
      if (publicQuotes.length >= 3) break;
    }
    if (publicQuotes.length >= 3) break;
  }

  return {
    v: 1,
    h: sanitizeCardHandle(profile?.handle || '@espectador'),
    ut: sanitizePlainText(profile?.userTag || '', 48),
    n: sanitizePlainText(
      profile?.displayName || profile?.handle || 'Perfil OmniPrism',
      55
    ),
    b: sanitizePlainText(profile?.bio || '', 160),
    t: sanitizePlainText(
      titleName ||
        (profile?.activeTitleBadge && profile.activeTitleBadge !== 'auto'
          ? profile.activeTitleBadge
          : ''),
      55
    ),
    st: {
      books: Math.max(0, backlog.length),
      done: Math.max(0, completed.length),
      pages: Math.max(0, hoursWatched),
      streak: Math.max(0, Math.round(Number(streakCount) || 0)),
    },
    cur: currentlyWatching
      ? {
          ti: sanitizePlainText(currentlyWatching.title, 70),
          au: sanitizePlainText(currentlyWatching.director || currentlyWatching.studio || '', 50),
          pc: Math.max(
            0,
            Math.min(100, Math.round(Number(currentlyWatching.progress) || 0))
          ),
          wt: normalizeCinemaWorkType(currentlyWatching.workType),
          yr: sanitizeYear(currentlyWatching.releaseYear),
        }
      : null,
    top: topRated,
    q: publicQuotes,
  };
}

export function encodePublicProfileCard(input = {}) {
  const payload = buildCompactCardPayload(input);
  const encoder = new TextEncoder();

  const tryEncode = (candidate) => {
    const json = JSON.stringify(candidate);
    const token = toBase64Url(encoder.encode(json));
    return { token, bytes: encoder.encode(token).length };
  };

  let attempt = tryEncode(payload);
  if (attempt.bytes <= MAX_PROFILE_CARD_BYTES) {
    return attempt.token;
  }

  const trimmed = { ...payload };
  while (trimmed.q.length > 0 && attempt.bytes > MAX_PROFILE_CARD_BYTES) {
    trimmed.q = trimmed.q.slice(0, -1);
    attempt = tryEncode(trimmed);
  }
  while (trimmed.top.length > 0 && attempt.bytes > MAX_PROFILE_CARD_BYTES) {
    trimmed.top = trimmed.top.slice(0, -1);
    attempt = tryEncode(trimmed);
  }
  if (attempt.bytes > MAX_PROFILE_CARD_BYTES) {
    trimmed.b = trimmed.b.slice(0, 60);
    attempt = tryEncode(trimmed);
  }

  return attempt.token;
}

function extractRawCardToken(rawInput) {
  const raw = String(rawInput || '').trim();
  if (!raw) return '';
  if (raw.includes('card=')) {
    try {
      const parsedUrl = new URL(
        raw.startsWith('http') ? raw : `https://cinecodice.app/${raw.replace(/^\/+/, '')}`
      );
      return String(parsedUrl.searchParams.get('card') || '').trim();
    } catch {
      const match = raw.match(/[?&]card=([^&#]+)/);
      return match ? decodeURIComponent(match[1]) : raw;
    }
  }
  return raw;
}

export function decodePublicProfileCard(rawInput) {
  try {
    const token = extractRawCardToken(rawInput);
    if (!token) {
      return { ok: false, error: 'Nenhum cartão de perfil informado.' };
    }

    const tokenBytes = new TextEncoder().encode(token).length;
    if (tokenBytes > MAX_PROFILE_CARD_BYTES) {
      return {
        ok: false,
        error: 'Cartão de perfil excede o limite de segurança (4 KB).',
      };
    }

    const decodedBytes = fromBase64Url(token);
    if (decodedBytes.length > MAX_PROFILE_CARD_BYTES) {
      return {
        ok: false,
        error: 'Dados do cartão excedem o limite máximo de segurança.',
      };
    }

    const jsonText = new TextDecoder('utf-8', { fatal: true }).decode(decodedBytes);
    const lowerText = jsonText.toLowerCase();
    if (BLOCKED_KEY_PATTERNS.some((sig) => lowerText.includes(sig))) {
      return {
        ok: false,
        error: 'Cartão rejeitado por conter padrão proibido de credencial.',
      };
    }

    const parsed = JSON.parse(jsonText);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'Estrutura de cartão inválida.' };
    }

    if (parsed.v !== 1) {
      return { ok: false, error: 'Versão de cartão não suportada.' };
    }

    const handle = sanitizeCardHandle(parsed.h);
    const rawUt = sanitizePlainText(parsed.ut || '', 48);
    const userTag = /^@[a-z0-9_.-]+#[0-9]{4}$/i.test(rawUt) ? rawUt.toLowerCase() : '';
    const displayName = sanitizePlainText(parsed.n || handle, 60);
    if (!displayName) {
      return { ok: false, error: 'Cartão sem identificação válida do espectador.' };
    }

    const bio = sanitizePlainText(parsed.b || '', 180);
    const activeTitle = sanitizePlainText(parsed.t || '', 60);

    const rawStats = parsed.st && typeof parsed.st === 'object' ? parsed.st : {};
    const stats = {
      booksCount: Math.max(0, Math.min(99999, Math.round(Number(rawStats.books) || 0))),
      completedCount: Math.max(0, Math.min(99999, Math.round(Number(rawStats.done) || 0))),
      hoursWatched: Math.max(0, Math.min(9999999, Math.round(Number(rawStats.pages) || 0))),
      streakCount: Math.max(0, Math.min(99999, Math.round(Number(rawStats.streak) || 0))),
    };

    const currentWatching =
      parsed.cur && typeof parsed.cur === 'object' && parsed.cur.ti
        ? {
            title: sanitizePlainText(parsed.cur.ti, 80),
            director: sanitizePlainText(parsed.cur.au || '', 60),
            progressPct: Math.max(
              0,
              Math.min(100, Math.round(Number(parsed.cur.pc) || 0))
            ),
            workType: normalizeCinemaWorkType(parsed.cur.wt),
            releaseYear: sanitizeYear(parsed.cur.yr),
          }
        : null;

    const topRatedWorks = (Array.isArray(parsed.top) ? parsed.top : [])
      .slice(0, 5)
      .filter((w) => w && typeof w === 'object' && w.ti)
      .map((w, idx) => ({
        id: `peer-work-${handle}-${idx}`,
        title: sanitizePlainText(w.ti, 80),
        director: sanitizePlainText(w.au || '', 60),
        rating:
          w.rt !== null && w.rt !== undefined
            ? Math.max(0, Math.min(100, Math.round(Number(w.rt) || 0)))
            : null,
        workType: normalizeCinemaWorkType(w.wt),
        releaseYear: sanitizeYear(w.yr),
        verdict: sanitizePlainText(w.vd || '', 30),
      }));

    const publicQuotes = (Array.isArray(parsed.q) ? parsed.q : [])
      .slice(0, 3)
      .filter((q) => q && typeof q === 'object' && q.tx)
      .map((q) => ({
        text: sanitizePlainText(q.tx, 200),
        workTitle: sanitizePlainText(q.wk || '', 70),
        location: sanitizePlainText(q.lo || '', 30),
      }));

    const words = displayName.replace(/^@/, '').split(/\s+/).filter(Boolean);
    const avatarInitials = (
      words.length >= 2
        ? `${words[0][0]}${words[words.length - 1][0]}`
        : displayName.replace(/^@/, '').slice(0, 2) || 'CC'
    ).toUpperCase();

    return {
      ok: true,
      card: {
        id: `card:${handle.replace(/^@/, '')}`,
        version: 1,
        handle,
        userTag: userTag || handle,
        displayName,
        avatarInitials,
        bio,
        activeTitle,
        stats,
        currentReading: currentWatching,
        currentWatching,
        topRatedWorks,
        publicQuotes,
        rawToken: token,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err?.message || 'Não foi possível ler o cartão de perfil.',
    };
  }
}

export function buildProfileCardShareUrl(cardInput, baseOriginUrl = null) {
  const token =
    typeof cardInput === 'string'
      ? cardInput
      : encodePublicProfileCard(cardInput);

  let base = String(baseOriginUrl || '').trim();
  if (!base && typeof window !== 'undefined' && window.location) {
    base = `${window.location.origin}${window.location.pathname}`;
  }
  if (!base) {
    base = domainConfig.shareUrlBase || 'https://cinecodice.app/';
  }

  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}card=${encodeURIComponent(token)}`;
}

export function buildProfileCardQrSvg(shareUrl, options = {}) {
  return generateQrCodeSvg(shareUrl, {
    ariaLabel: 'QR Code do cartão de perfil do catálogo',
    ...options,
  });
}

export function listSavedPeerCards() {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(SAVED_PEER_CARDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((c) => c && typeof c === 'object' && c.handle)
      : [];
  } catch {
    return [];
  }
}

export function savePeerProfileCard(card) {
  if (!card || !card.handle) return listSavedPeerCards();
  const list = listSavedPeerCards();
  const handleKey = sanitizeCardHandle(card.handle);
  const record = {
    ...card,
    id: card.id || `card:${handleKey.replace(/^@/, '')}`,
    handle: handleKey,
    savedAt: new Date().toISOString(),
  };

  const idx = list.findIndex(
    (entry) => sanitizeCardHandle(entry.handle) === handleKey
  );
  const next =
    idx >= 0
      ? list.map((entry, i) => (i === idx ? record : entry))
      : [record, ...list];

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SAVED_PEER_CARDS_KEY, JSON.stringify(next.slice(0, 100)));
    }
  } catch {
    // Silencioso
  }
  return next;
}

export function removeSavedPeerCard(cardIdOrHandle) {
  const target = String(cardIdOrHandle || '').trim().toLowerCase();
  const next = listSavedPeerCards().filter(
    (entry) =>
      String(entry.id || '').toLowerCase() !== target &&
      sanitizeCardHandle(entry.handle) !== sanitizeCardHandle(target)
  );
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SAVED_PEER_CARDS_KEY, JSON.stringify(next));
    }
  } catch {
    // Silencioso
  }
  return next;
}
