import { buildPublicProfileLink, domainConfig } from '../config/domainConfig.js';
import {
  normalizeFavoriteGenres,
  normalizePreferredCriteria,
} from '../utils/readerPreferences.js';
import { createUuid } from './codiceDatabase.js';
import { evaluateReaderTitles } from './readerTitlesEngine.js';

const REQUEST_TIMEOUT_MS = 8000;
const IDB_NAME = 'codice_multiuser_db_v1';
const IDB_VERSION = 1;

const STORAGE_KEYS = {
  supabaseUrl: 'codice_supabase_url',
  supabaseKey: 'codice_supabase_anon_key',
  envUrl: 'VITE_SUPABASE_URL',
  envKey: 'VITE_SUPABASE_ANON_KEY',
  supabaseSession: 'codice_supabase_session_v1',
  forceLocal: 'codice_backend_force_local',
};

export const PRIVACY_LEVELS = [
  {
    id: 'public',
    label: 'Público',
    description: 'Qualquer leitor no Códice pode ver seu perfil e estante.',
  },
  {
    id: 'followers',
    label: 'Apenas Seguidores',
    description: 'Somente quem segue você acompanha suas atividades.',
  },
  {
    id: 'private',
    label: 'Privado',
    description: 'Modo arquivo pessoal: visível apenas para você.',
  },
];

export class BackendError extends Error {
  constructor(message, { code = 'BACKEND_ERROR', status = 0, userMessage } = {}) {
    super(message || userMessage || 'Erro ao comunicar com o backend.');
    this.name = 'BackendError';
    this.code = code;
    this.status = status;
    this.userMessage = userMessage || this.message;
  }
}

export function normalizePrivacyLevel(value) {
  if (value === 'followers' || value === 'private' || value === 'public') {
    return value;
  }
  return 'public';
}

export function normalizeHandle(rawHandle, fallbackSeed = 'leitor') {
  const cleanedRaw = String(rawHandle || '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_.-]/g, '');

  const base =
    cleanedRaw.length >= 2
      ? cleanedRaw
      : String(fallbackSeed || 'leitor')
          .toLowerCase()
          .replace(/[^a-z0-9_.-]/g, '') || 'leitor';

  return `@${base.slice(0, 32)}`;
}

function buildInitials(displayName, fallback = 'LC') {
  const words = String(displayName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length >= 2) {
    return `${words[0][0]}${words[1][0]}`.toUpperCase();
  }
  const clean = String(displayName || fallback).trim();
  return (clean.slice(0, 2) || fallback).toUpperCase();
}

export function deriveUserDiscriminator(seed = '') {
  const input = String(seed || 'leitor');
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const num = ((hash >>> 0) % 9999) + 1;
  return String(num).padStart(4, '0');
}

export function normalizeDiscriminator(raw, fallbackSeed = 'leitor') {
  const digits = String(raw || '').replace(/[^0-9]/g, '').slice(0, 4);
  if (digits.length === 4) {
    const num = Number(digits);
    if (num >= 1 && num <= 9999) return digits;
  }
  return deriveUserDiscriminator(fallbackSeed);
}

export function buildUserTag(handle, discriminator) {
  const normHandle = normalizeHandle(handle);
  const disc = normalizeDiscriminator(discriminator, normHandle);
  return `${normHandle}#${disc}`;
}

export function normalizeFrontendProfile(rawProfile = {}) {
  const defaults = domainConfig.ui.profile;
  const rawHandleStr = String(rawProfile.handle || defaults.handle).trim();
  const embeddedDiscMatch = rawHandleStr.match(/#([0-9]{4})$/);
  const handle = normalizeHandle(
    rawHandleStr.replace(/#[0-9]{4}$/, ''),
    rawProfile.displayName || rawProfile.display_name || 'leitor'
  );
  const rawUserTag = String(rawProfile.userTag ?? rawProfile.user_tag ?? '').trim();
  const tagDiscMatch = rawUserTag.match(/#([0-9]{4})$/);
  const discriminator = normalizeDiscriminator(
    rawProfile.discriminator || tagDiscMatch?.[1] || embeddedDiscMatch?.[1],
    rawProfile.id || handle
  );
  const userTag = buildUserTag(handle, discriminator);
  const displayName =
    String(
      rawProfile.displayName ??
        rawProfile.display_name ??
        handle.replace(/^@/, '') ??
        defaults.displayName
    ).trim() || defaults.displayName;
  const publicLink = buildPublicProfileLink(handle);

  const rawLinkLabel = rawProfile.linkLabel ?? rawProfile.link_label;
  const rawLinkUrl = rawProfile.linkUrl ?? rawProfile.link_url;

  const preferredCriteria = normalizePreferredCriteria(
    rawProfile.preferredCriteria ?? rawProfile.preferred_criteria,
    rawProfile.preferredCriterion ?? rawProfile.preferred_criterion
  );

  return {
    id: rawProfile.id || createUuid(),
    email: typeof rawProfile.email === 'string' ? rawProfile.email.trim().toLowerCase() : '',
    handle,
    discriminator,
    userTag,
    displayName,
    avatarInitials:
      rawProfile.avatarInitials ??
      rawProfile.avatar_initials ??
      buildInitials(displayName, defaults.avatarInitials),
    avatarUrl: rawProfile.avatarUrl ?? rawProfile.avatar_url ?? '',
    coverUrl: rawProfile.coverUrl ?? rawProfile.banner_url ?? '',
    bio: rawProfile.bio !== undefined ? String(rawProfile.bio) : '',
    linkLabel: rawLinkLabel || publicLink.label,
    linkUrl: rawLinkUrl || publicLink.url,
    age: rawProfile.age || '',
    readerFocus: rawProfile.readerFocus ?? rawProfile.reader_focus ?? 'Cinéfilo Curador',
    annualGoal: Math.max(
      1,
      Number(rawProfile.annualGoal ?? rawProfile.annual_goal) || 24
    ),
    preferredFormat:
      rawProfile.preferredFormat ?? rawProfile.preferred_format ?? 'Streaming',
    preferredCriteria,
    preferredCriterion: preferredCriteria.join(', '),
    preferredAtmosphere:
      rawProfile.preferredAtmosphere ?? rawProfile.preferred_atmosphere ?? 'Tinta OLED',
    favoriteGenres: normalizeFavoriteGenres(
      rawProfile.favoriteGenres ?? rawProfile.favorite_genres
    ),
    privacyLevel: normalizePrivacyLevel(
      rawProfile.privacyLevel ?? rawProfile.privacy_level
    ),
    allowWallPosts:
      (rawProfile.allowWallPosts ?? rawProfile.allow_wall_posts) !== undefined
        ? Boolean(rawProfile.allowWallPosts ?? rawProfile.allow_wall_posts)
        : true,
    allowComments:
      (rawProfile.allowComments ?? rawProfile.allow_comments) !== undefined
        ? Boolean(rawProfile.allowComments ?? rawProfile.allow_comments)
        : true,
    allowDms:
      (rawProfile.allowDms ?? rawProfile.allow_dms) !== undefined
        ? Boolean(rawProfile.allowDms ?? rawProfile.allow_dms)
        : true,
    gamificationEnabled:
      (rawProfile.gamificationEnabled ?? rawProfile.gamification_enabled) !== undefined
        ? Boolean(rawProfile.gamificationEnabled ?? rawProfile.gamification_enabled)
        : true,
    activeTitleBadge:
      typeof (rawProfile.activeTitleBadge ?? rawProfile.active_title_badge) === 'string'
        ? rawProfile.activeTitleBadge ?? rawProfile.active_title_badge
        : '',
    onboardingCompleted:
      (rawProfile.onboardingCompleted ?? rawProfile.onboarding_completed) !== undefined
        ? Boolean(rawProfile.onboardingCompleted ?? rawProfile.onboarding_completed)
        : true,
    isLocalOnly: rawProfile.isLocalOnly !== undefined ? Boolean(rawProfile.isLocalOnly) : true,
    createdAt: rawProfile.createdAt ?? rawProfile.created_at ?? new Date().toISOString(),
    updatedAt: rawProfile.updatedAt ?? rawProfile.updated_at ?? new Date().toISOString(),
  };
}

export function toSqlProfileRow(profile = {}) {
  const norm = normalizeFrontendProfile(profile);
  return {
    id: norm.id,
    handle: norm.handle,
    user_tag: norm.userTag,
    discriminator: norm.discriminator,
    display_name: norm.displayName,
    bio: norm.bio,
    avatar_url: norm.avatarUrl,
    banner_url: norm.coverUrl,
    privacy_level: norm.privacyLevel,
    allow_wall_posts: norm.allowWallPosts,
    allow_comments: norm.allowComments,
    allow_dms: norm.allowDms,
    gamification_enabled: norm.gamificationEnabled,
    active_title_badge: norm.activeTitleBadge,
    annual_goal: norm.annualGoal,
    avatar_initials: norm.avatarInitials,
    link_label: norm.linkLabel,
    link_url: norm.linkUrl,
    reader_focus: norm.readerFocus,
    preferred_format: norm.preferredFormat,
    preferred_criterion: norm.preferredCriterion,
    preferred_atmosphere: norm.preferredAtmosphere,
    favorite_genres: norm.favoriteGenres,
    onboarding_completed: norm.onboardingCompleted,
  };
}

export function fromSqlProfileRow(row = {}, extra = {}) {
  return normalizeFrontendProfile({
    ...row,
    ...extra,
    isLocalOnly: false,
  });
}

export function canInteractWithProfile(
  targetProfile = {},
  { viewerId = null, isFollower = false } = {}
) {
  const targetId = targetProfile?.id || null;
  const isOwner = Boolean(viewerId && targetId && viewerId === targetId);
  const privacy = normalizePrivacyLevel(
    targetProfile?.privacyLevel ?? targetProfile?.privacy_level
  );
  const allowWall =
    (targetProfile?.allowWallPosts ?? targetProfile?.allow_wall_posts) !== false;
  const allowComments =
    (targetProfile?.allowComments ?? targetProfile?.allow_comments) !== false;
  const allowDms =
    (targetProfile?.allowDms ?? targetProfile?.allow_dms) !== false;

  const canView =
    isOwner ||
    privacy === 'public' ||
    (privacy === 'followers' && Boolean(isFollower));

  return {
    isOwner,
    privacyLevel: privacy,
    canView,
    canFollow: !isOwner && privacy !== 'private',
    canPostWall: isOwner || (canView && allowWall),
    canComment: isOwner || (canView && allowComments),
    canSendDm: !isOwner && canView && allowDms,
  };
}

function readEnvValue(key) {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      if (key === 'VITE_SUPABASE_URL' && import.meta.env.VITE_SUPABASE_URL) {
        return String(import.meta.env.VITE_SUPABASE_URL).trim();
      }
      if (key === 'VITE_SUPABASE_ANON_KEY' && import.meta.env.VITE_SUPABASE_ANON_KEY) {
        return String(import.meta.env.VITE_SUPABASE_ANON_KEY).trim();
      }
      if (import.meta.env[key]) {
        return String(import.meta.env[key]).trim();
      }
    }
  } catch {
    // Ambiente sem import.meta.env
  }
  try {
    if (typeof globalThis !== 'undefined' && globalThis.process?.env?.[key]) {
      return String(globalThis.process.env[key]).trim();
    }
  } catch {
    // Sem process.env
  }
  return '';
}

function readLocalStorageValue(key) {
  try {
    if (typeof localStorage === 'undefined') return '';
    return String(localStorage.getItem(key) || '').trim();
  } catch {
    return '';
  }
}

function writeLocalStorageValue(key, value) {
  try {
    if (typeof localStorage === 'undefined') return;
    if (value === null || value === undefined || value === '') {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, String(value));
    }
  } catch {
    // Ignora storage indisponível
  }
}

const ADMIN_JWT_ROLE = ['service', 'role'].join('_');
export const MAX_SOCIAL_MESSAGE_CHARS = 2000;
export const INVITE_HANDLE_REGEX = /^@?[a-z0-9_][a-z0-9_.-]{2,29}$/i;

export function decodeJwtPayload(token) {
  const parts = String(token || '').trim().split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    let jsonText = '';
    if (typeof atob === 'function') {
      const bin = atob(padded);
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      jsonText = new TextDecoder().decode(bytes);
    } else if (typeof globalThis !== 'undefined' && globalThis.Buffer) {
      jsonText = globalThis.Buffer.from(padded, 'base64').toString('utf8');
    } else {
      return null;
    }
    const parsed = JSON.parse(jsonText);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function isServiceRoleKey(rawKey) {
  const clean = String(rawKey || '').trim();
  if (!clean) return false;
  if (/^sb_secret_/i.test(clean)) return true;
  const payload = decodeJwtPayload(clean);
  if (!payload) return false;
  return String(payload.role || '').toLowerCase() === ADMIN_JWT_ROLE;
}

function validateHttpUrl(rawUrl) {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return '';
    }
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function validateSupabaseProjectUrl(rawUrl) {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return '';
    if (!parsed.hostname.toLowerCase().endsWith('.supabase.co')) return '';
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '';
  }
}

export function getSupabaseConfig() {
  const envUrl = validateHttpUrl(readEnvValue('VITE_SUPABASE_URL'));
  const rawEnvKey = readEnvValue('VITE_SUPABASE_ANON_KEY');
  const envKey = isServiceRoleKey(rawEnvKey) ? '' : rawEnvKey;

  const lsUrl = validateHttpUrl(
    readLocalStorageValue(STORAGE_KEYS.envUrl) ||
      readLocalStorageValue(STORAGE_KEYS.supabaseUrl)
  );
  const rawLsKey =
    readLocalStorageValue(STORAGE_KEYS.envKey) ||
    readLocalStorageValue(STORAGE_KEYS.supabaseKey);
  const lsKey = isServiceRoleKey(rawLsKey) ? '' : rawLsKey;

  const url = envUrl || lsUrl;
  const anonKey = envKey || lsKey;
  const configured = Boolean(url && anonKey);
  const source = envUrl && envKey ? 'env' : lsUrl && lsKey ? 'localStorage' : 'none';

  return {
    configured,
    url,
    anonKey,
    source,
  };
}

export function isSupabaseConfigured() {
  return getSupabaseConfig().configured;
}

export function saveSupabaseConfig({ url, anonKey }) {
  const validUrl = validateSupabaseProjectUrl(url);
  const cleanKey = String(anonKey || '').trim();
  if (!validUrl) {
    throw new BackendError('URL do Supabase inválida.', {
      code: 'INVALID_SUPABASE_URL',
      userMessage:
        'Informe uma URL HTTPS válida do Supabase (ex.: https://seu-projeto.supabase.co).',
    });
  }
  if (isServiceRoleKey(cleanKey)) {
    throw new BackendError('Chave administrativa recusada.', {
      code: 'SERVICE_ROLE_FORBIDDEN',
      userMessage:
        'Chave administrativa secreta recusada por segurança. Informe apenas a chave pública (anon).',
    });
  }
  if (cleanKey.length < 16) {
    throw new BackendError('Chave anon inválida.', {
      code: 'INVALID_SUPABASE_KEY',
      userMessage: 'Informe uma chave pública (anon) válida do Supabase.',
    });
  }
  writeLocalStorageValue(STORAGE_KEYS.supabaseUrl, validUrl);
  writeLocalStorageValue(STORAGE_KEYS.supabaseKey, cleanKey);
  writeLocalStorageValue(STORAGE_KEYS.forceLocal, '');
  return getSupabaseConfig();
}

export async function testSupabaseConnection({ url, anonKey } = {}) {
  const validUrl = validateSupabaseProjectUrl(url);
  const cleanKey = String(anonKey || '').trim();

  if (!validUrl) {
    return {
      ok: false,
      latencyMs: 0,
      errorMessage:
        'Informe uma URL HTTPS válida do Supabase (https://seu-projeto.supabase.co).',
    };
  }
  if (isServiceRoleKey(cleanKey)) {
    return {
      ok: false,
      latencyMs: 0,
      errorMessage:
        'Chave administrativa secreta recusada por segurança. Use apenas a chave pública (anon).',
    };
  }
  if (cleanKey.length < 16) {
    return {
      ok: false,
      latencyMs: 0,
      errorMessage: 'Informe uma chave pública (anon) válida para testar.',
    };
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${validUrl}/rest/v1/profiles?select=id&limit=1`, {
      method: 'GET',
      headers: {
        apikey: cleanKey,
        Authorization: `Bearer ${cleanKey}`,
      },
      signal: controller.signal,
    });
    const latencyMs = Math.max(1, Date.now() - startedAt);
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return {
          ok: false,
          latencyMs,
          errorMessage: 'Chave anon recusada ou sem acesso ao schema público.',
        };
      }
      return {
        ok: false,
        latencyMs,
        errorMessage: `Servidor respondeu HTTP ${response.status}. Confira se rodou supabase/schema.sql.`,
      };
    }
    return {
      ok: true,
      latencyMs,
      errorMessage: '',
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Math.max(1, Date.now() - startedAt),
      errorMessage:
        err?.name === 'AbortError'
          ? 'Tempo limite ao conectar ao Supabase (8s).'
          : 'Não foi possível alcançar o endereço informado.',
    };
  } finally {
    clearTimeout(timer);
  }
}

export function clearSupabaseConfig() {
  writeLocalStorageValue(STORAGE_KEYS.supabaseUrl, '');
  writeLocalStorageValue(STORAGE_KEYS.supabaseKey, '');
  writeLocalStorageValue(STORAGE_KEYS.envUrl, '');
  writeLocalStorageValue(STORAGE_KEYS.envKey, '');
  writeLocalStorageValue(STORAGE_KEYS.supabaseSession, '');
}

export function isForceLocalMode() {
  return readLocalStorageValue(STORAGE_KEYS.forceLocal) === 'true';
}

export function setForceLocalMode(forceLocal) {
  writeLocalStorageValue(STORAGE_KEYS.forceLocal, forceLocal ? 'true' : '');
}

export function getBackendMode() {
  const cfg = getSupabaseConfig();
  if (cfg.configured && !isForceLocalMode()) {
    return 'supabase';
  }
  return 'local';
}

// ----------------------------------------------------------------------------
// Hash local com sal por conta (SHA-256 via WebCrypto + fallback determinístico)
// ----------------------------------------------------------------------------
function generateSaltHex(lengthBytes = 16) {
  try {
    if (globalThis.crypto?.getRandomValues) {
      const buf = new Uint8Array(lengthBytes);
      globalThis.crypto.getRandomValues(buf);
      return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch {
    // Fallback
  }
  let out = '';
  for (let i = 0; i < lengthBytes * 2; i += 1) {
    out += Math.floor(Math.random() * 16).toString(16);
  }
  return out;
}

async function computeSaltedHash(password, saltHex) {
  const rawInput = `${saltHex}:${String(password || '')}`;
  try {
    if (globalThis.crypto?.subtle && typeof TextEncoder !== 'undefined') {
      const encoded = new TextEncoder().encode(rawInput);
      const digest = await globalThis.crypto.subtle.digest('SHA-256', encoded);
      const hashHex = Array.from(new Uint8Array(digest), (b) =>
        b.toString(16).padStart(2, '0')
      ).join('');
      return `${saltHex}:${hashHex}`;
    }
  } catch {
    // Fallback em ambientes sem SubtleCrypto
  }

  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < rawInput.length; i += 1) {
    const c = rawInput.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return `${saltHex}:${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

async function createPasswordRecord(password) {
  const saltHex = generateSaltHex(16);
  return computeSaltedHash(password, saltHex);
}

async function verifyPasswordRecord(password, storedHash) {
  if (!storedHash || !String(storedHash).includes(':')) return false;
  const [saltHex] = String(storedHash).split(':');
  const candidate = await computeSaltedHash(password, saltHex);
  return candidate === storedHash;
}

// ----------------------------------------------------------------------------
// Camada IndexedDB + Fallback automático em Memória (Node / Private Mode)
// ----------------------------------------------------------------------------
const STORE_NAMES = ['accounts', 'profiles', 'workspaces', 'meta'];

const memoryTables = {
  accounts: new Map(),
  profiles: new Map(),
  workspaces: new Map(),
  meta: new Map(),
};

export function resetBackendMemoryForTests() {
  STORE_NAMES.forEach((store) => {
    memoryTables[store].clear();
  });
  writeLocalStorageValue(STORAGE_KEYS.supabaseSession, '');
  writeLocalStorageValue(STORAGE_KEYS.forceLocal, '');
}

let dbPromiseCache = null;

function openIndexedDb() {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  if (dbPromiseCache) {
    return dbPromiseCache;
  }
  dbPromiseCache = new Promise((resolve) => {
    try {
      const request = indexedDB.open(IDB_NAME, IDB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('accounts')) {
          db.createObjectStore('accounts', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('profiles')) {
          db.createObjectStore('profiles', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('workspaces')) {
          db.createObjectStore('workspaces', { keyPath: 'userId' });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      };
      request.onsuccess = (event) => resolve(event.target.result);
      request.onerror = () => {
        dbPromiseCache = null;
        resolve(null);
      };
    } catch {
      dbPromiseCache = null;
      resolve(null);
    }
  });
  return dbPromiseCache;
}

async function storeGet(storeName, key) {
  if (!key) return null;
  const db = await openIndexedDb();
  if (!db) {
    const val = memoryTables[storeName].get(String(key));
    return val ? structuredCloneSafe(val) : null;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function storeGetAll(storeName) {
  const db = await openIndexedDb();
  if (!db) {
    return Array.from(memoryTables[storeName].values()).map(structuredCloneSafe);
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
    req.onerror = () => reject(req.error);
  });
}

async function storePut(storeName, record) {
  const keyField =
    storeName === 'workspaces' ? 'userId' : storeName === 'meta' ? 'key' : 'id';
  const db = await openIndexedDb();
  if (!db) {
    memoryTables[storeName].set(String(record[keyField]), structuredCloneSafe(record));
    return record;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.put(record);
    tx.oncomplete = () => resolve(record);
    tx.onerror = () => reject(tx.error);
  });
}

function structuredCloneSafe(value) {
  if (value === null || value === undefined) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

async function getActiveMetaSession() {
  const metaRow = await storeGet('meta', 'active_local_session');
  return metaRow?.value || null;
}

async function setActiveMetaSession(sessionValue) {
  await storePut('meta', {
    key: 'active_local_session',
    value: sessionValue || null,
  });
}

async function saveLocalWorkspace(userId, workspace = {}) {
  if (!userId) return;
  const nowIso = new Date().toISOString();
  if (workspace.profile) {
    const existingProfile = await storeGet('profiles', userId);
    const mergedProfile = normalizeFrontendProfile({
      ...existingProfile,
      ...workspace.profile,
      id: userId,
      updatedAt: nowIso,
    });
    await storePut('profiles', mergedProfile);
  }

  const existingWs = await storeGet('workspaces', userId);
  await storePut('workspaces', {
    userId,
    items: Array.isArray(workspace.items)
      ? workspace.items
      : existingWs?.items || [],
    posts: Array.isArray(workspace.posts)
      ? workspace.posts
      : existingWs?.posts || [],
    streak:
      workspace.streak && typeof workspace.streak === 'object'
        ? workspace.streak
        : existingWs?.streak || { count: 0, lastDate: null, history: [] },
    readingSessions: Array.isArray(workspace.readingSessions)
      ? workspace.readingSessions
      : existingWs?.readingSessions || [],
    updatedAt: nowIso,
  });
}

async function loadLocalWorkspace(userId) {
  const ws = await storeGet('workspaces', userId);
  return {
    items: Array.isArray(ws?.items) ? ws.items : [],
    posts: Array.isArray(ws?.posts) ? ws.posts : [],
    streak: ws?.streak || { count: 0, lastDate: null, history: [] },
    readingSessions: Array.isArray(ws?.readingSessions) ? ws.readingSessions : [],
  };
}

// ----------------------------------------------------------------------------
// Cliente Supabase REST / Auth via fetch nativo (zero dependência obrigatória)
// ----------------------------------------------------------------------------
function loadStoredSupabaseSession() {
  const raw = readLocalStorageValue(STORAGE_KEYS.supabaseSession);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && parsed.access_token ? parsed : null;
  } catch {
    return null;
  }
}

function saveStoredSupabaseSession(session) {
  if (!session) {
    writeLocalStorageValue(STORAGE_KEYS.supabaseSession, '');
    return;
  }
  const normalized = {
    access_token: session.access_token,
    refresh_token: session.refresh_token || '',
    expires_at:
      session.expires_at ||
      (session.expires_in
        ? Math.floor(Date.now() / 1000) + Number(session.expires_in)
        : Math.floor(Date.now() / 1000) + 3600),
    user: session.user || null,
  };
  writeLocalStorageValue(STORAGE_KEYS.supabaseSession, JSON.stringify(normalized));
  return normalized;
}

function mapSupabaseHttpError(status, payload, fallbackMessage) {
  const rawMsg = String(
    payload?.error_description || payload?.msg || payload?.message || payload?.error || ''
  );
  const lower = rawMsg.toLowerCase();

  if (status === 400 || status === 422) {
    if (lower.includes('invalid login credentials') || lower.includes('invalid_grant')) {
      return new BackendError(rawMsg, {
        code: 'INVALID_CREDENTIALS',
        status,
        userMessage: 'E-mail ou senha incorretos.',
      });
    }
    if (lower.includes('already registered') || lower.includes('already exists')) {
      return new BackendError(rawMsg, {
        code: 'EMAIL_TAKEN',
        status,
        userMessage: 'Este e-mail já está cadastrado.',
      });
    }
    if (lower.includes('password')) {
      return new BackendError(rawMsg, {
        code: 'WEAK_PASSWORD',
        status,
        userMessage: 'A senha precisa ter pelo menos 6 caracteres.',
      });
    }
    if (lower.includes('email not confirmed')) {
      return new BackendError(rawMsg, {
        code: 'EMAIL_NOT_CONFIRMED',
        status,
        userMessage: 'Confirme seu e-mail antes de entrar.',
      });
    }
  }
  if (status === 401 || status === 403) {
    return new BackendError(rawMsg, {
      code: 'UNAUTHORIZED',
      status,
      userMessage: 'Sessão expirada ou sem permissão. Entre novamente.',
    });
  }
  if (status === 409) {
    return new BackendError(rawMsg, {
      code: 'CONFLICT',
      status,
      userMessage: 'Este @handle já está em uso por outro leitor.',
    });
  }
  if (status === 429) {
    return new BackendError(rawMsg, {
      code: 'RATE_LIMITED',
      status,
      userMessage: 'Muitas tentativas seguidas. Aguarde alguns instantes e tente de novo.',
    });
  }
  return new BackendError(rawMsg || fallbackMessage, {
    code: 'REMOTE_ERROR',
    status,
    userMessage: fallbackMessage || 'Não foi possível concluir a operação no servidor.',
  });
}

async function supabaseFetchJson(path, { method = 'GET', body, token, extraHeaders = {} } = {}) {
  const cfg = getSupabaseConfig();
  if (!cfg.configured) {
    throw new BackendError('Supabase não configurado.', {
      code: 'SUPABASE_NOT_CONFIGURED',
      userMessage: 'Servidor Supabase não configurado neste ambiente.',
    });
  }

  const endpoint = new URL(path.replace(/^\/+/, ''), `${cfg.url}/`);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const headers = {
      apikey: cfg.anonKey,
      Authorization: `Bearer ${token || cfg.anonKey}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    };

    const response = await fetch(endpoint.toString(), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { message: text };
      }
    }

    if (!response.ok) {
      throw mapSupabaseHttpError(
        response.status,
        payload,
        'Erro ao comunicar com o Supabase.'
      );
    }

    return payload;
  } catch (err) {
    if (err instanceof BackendError) throw err;
    if (err?.name === 'AbortError') {
      throw new BackendError('Timeout na conexão com Supabase.', {
        code: 'TIMEOUT',
        userMessage: 'O servidor demorou para responder (8s). Tente novamente ou continue em Modo Local.',
      });
    }
    throw new BackendError(err?.message || 'Erro de rede', {
      code: 'NETWORK_ERROR',
      userMessage: 'Sem conexão com o servidor. Verifique sua internet ou continue em Modo Local.',
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function ensureFreshSupabaseSession() {
  const session = loadStoredSupabaseSession();
  if (!session) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  if (!session.expires_at || session.expires_at - 60 > nowSec) {
    return session;
  }
  if (!session.refresh_token) {
    saveStoredSupabaseSession(null);
    return null;
  }

  try {
    const refreshed = await supabaseFetchJson('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      body: { refresh_token: session.refresh_token },
    });
    if (refreshed?.access_token) {
      return saveStoredSupabaseSession(refreshed);
    }
  } catch {
    saveStoredSupabaseSession(null);
  }
  return null;
}

async function fetchRemoteProfileById(userId, accessToken) {
  const params = new URLSearchParams({
    id: `eq.${userId}`,
    select: '*',
  });
  const rows = await supabaseFetchJson(`/rest/v1/profiles?${params.toString()}`, {
    method: 'GET',
    token: accessToken,
  });
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

async function upsertRemoteProfile(profile, accessToken) {
  const sqlRow = toSqlProfileRow(profile);
  const rows = await supabaseFetchJson('/rest/v1/profiles', {
    method: 'POST',
    token: accessToken,
    body: sqlRow,
    extraHeaders: {
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
  });
  return Array.isArray(rows) && rows[0] ? rows[0] : sqlRow;
}

// ----------------------------------------------------------------------------
// API Pública Unificada do Backend Híbrido
// ----------------------------------------------------------------------------
export async function listLocalProfiles() {
  const [profiles, accounts, workspaces, activeMeta] = await Promise.all([
    storeGetAll('profiles'),
    storeGetAll('accounts'),
    storeGetAll('workspaces'),
    getActiveMetaSession(),
  ]);

  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const wsById = new Map(workspaces.map((w) => [w.userId, w]));
  const activeId = activeMeta?.userId || null;

  return profiles
    .map((prof) => {
      const account = accountById.get(prof.id);
      const ws = wsById.get(prof.id);
      return {
        id: prof.id,
        handle: prof.handle,
        displayName: prof.displayName,
        avatarInitials: prof.avatarInitials,
        avatarUrl: prof.avatarUrl || '',
        email: account?.email || prof.email || '',
        privacyLevel: normalizePrivacyLevel(prof.privacyLevel),
        gamificationEnabled: prof.gamificationEnabled !== false,
        activeTitleBadge: prof.activeTitleBadge || '',
        workCount: Array.isArray(ws?.items) ? ws.items.length : 0,
        isActive: prof.id === activeId,
        hasPassword: Boolean(account?.passwordHash),
        updatedAt: prof.updatedAt || prof.createdAt || '',
      };
    })
    .sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return String(b.updatedAt).localeCompare(String(a.updatedAt));
    });
}

export async function bootstrapBackend({
  profile = null,
  items = [],
  posts = [],
  streak = null,
  readingSessions = [],
} = {}) {
  const mode = getBackendMode();

  if (mode === 'supabase') {
    const session = await ensureFreshSupabaseSession();
    if (session?.user?.id) {
      try {
        const remoteRow = await fetchRemoteProfileById(
          session.user.id,
          session.access_token
        );
        if (remoteRow) {
          const syncedProfile = fromSqlProfileRow(remoteRow, {
            email: session.user.email || '',
          });
          await saveLocalWorkspace(syncedProfile.id, {
            profile: syncedProfile,
            items,
            posts,
            streak,
            readingSessions,
          });
          return {
            mode: 'supabase',
            authenticated: true,
            user: {
              id: session.user.id,
              email: session.user.email || '',
              mode: 'supabase',
            },
            profile: syncedProfile,
          };
        }
      } catch {
        // Fallback gracioso offline se o servidor falhar na inicialização
      }
    }
  }

  // Motor Local Multiusuário no IndexedDB
  const existingAccounts = await storeGetAll('accounts');
  const existingMeta = await getActiveMetaSession();

  if (existingAccounts.length === 0) {
    const initialId =
      profile?.id && profile.id !== 'local-primary' ? profile.id : createUuid();
    const normProfile = normalizeFrontendProfile({
      ...profile,
      id: initialId,
      isLocalOnly: true,
      onboardingCompleted:
        profile?.onboardingCompleted !== undefined
          ? Boolean(profile.onboardingCompleted)
          : false,
    });
    const nowIso = new Date().toISOString();

    await storePut('accounts', {
      id: initialId,
      email: normProfile.email || '',
      handle: normProfile.handle,
      passwordHash: null,
      isLocalOnly: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    await saveLocalWorkspace(initialId, {
      profile: normProfile,
      items,
      posts,
      streak,
      readingSessions,
    });
    await setActiveMetaSession({
      userId: initialId,
      mode: 'local',
      loggedInAt: nowIso,
    });

    return {
      mode: 'local',
      authenticated: true,
      user: {
        id: initialId,
        email: normProfile.email || '',
        handle: normProfile.handle,
        mode: 'local',
      },
      profile: normProfile,
    };
  }

  const activeId = existingMeta?.signedOut
    ? null
    : existingMeta?.userId || existingAccounts[0]?.id || null;
  const activeProfile = activeId ? await storeGet('profiles', activeId) : null;
  if (activeProfile) {
    return {
      mode: 'local',
      authenticated: true,
      user: {
        id: activeProfile.id,
        email: activeProfile.email || '',
        handle: activeProfile.handle,
        mode: 'local',
      },
      profile: activeProfile,
    };
  }

  return {
    mode: 'local',
    authenticated: false,
    user: null,
    profile: null,
  };
}

export async function getCurrentBackendSession() {
  const mode = getBackendMode();
  if (mode === 'supabase') {
    const session = await ensureFreshSupabaseSession();
    if (session?.user?.id) {
      const localMirror = await storeGet('profiles', session.user.id);
      return {
        mode: 'supabase',
        authenticated: true,
        user: {
          id: session.user.id,
          email: session.user.email || '',
          mode: 'supabase',
        },
        profile: localMirror || null,
      };
    }
    return {
      mode: 'supabase',
      authenticated: false,
      user: null,
      profile: null,
    };
  }

  const activeMeta = await getActiveMetaSession();
  if (!activeMeta?.userId) {
    return { mode: 'local', authenticated: false, user: null, profile: null };
  }
  const prof = await storeGet('profiles', activeMeta.userId);
  const acc = await storeGet('accounts', activeMeta.userId);
  if (!prof || !acc) {
    return { mode: 'local', authenticated: false, user: null, profile: null };
  }
  return {
    mode: 'local',
    authenticated: true,
    user: {
      id: acc.id,
      email: acc.email || '',
      handle: prof.handle,
      mode: 'local',
    },
    profile: prof,
  };
}

function validateSignUpFields({ email, password, handle, displayName }) {
  const cleanName = String(displayName || '').trim();
  if (cleanName.length < 2) {
    throw new BackendError('Nome curto.', {
      code: 'INVALID_DISPLAY_NAME',
      userMessage: 'Informe um nome com pelo menos 2 caracteres.',
    });
  }

  const rawHandleClean = String(handle || '').trim().replace(/^@+/, '');
  if (rawHandleClean.length < 2) {
    throw new BackendError('Handle curto.', {
      code: 'INVALID_HANDLE',
      userMessage: 'Escolha um @handle com pelo menos 2 caracteres (letras ou números).',
    });
  }
  const normalizedHandle = normalizeHandle(rawHandleClean, cleanName);

  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new BackendError('E-mail inválido.', {
      code: 'INVALID_EMAIL',
      userMessage: 'Digite um endereço de e-mail válido.',
    });
  }

  const cleanPassword = String(password || '');
  if (cleanPassword.length < 6) {
    throw new BackendError('Senha curta.', {
      code: 'WEAK_PASSWORD',
      userMessage: 'A senha precisa ter pelo menos 6 caracteres.',
    });
  }

  return {
    displayName: cleanName,
    handle: normalizedHandle,
    email: cleanEmail,
    password: cleanPassword,
  };
}

export async function signUpAccount({
  email,
  password,
  handle,
  displayName,
  currentWorkspace = null,
}) {
  const valid = validateSignUpFields({ email, password, handle, displayName });
  const mode = getBackendMode();

  if (mode === 'supabase') {
    const authRes = await supabaseFetchJson('/auth/v1/signup', {
      method: 'POST',
      body: {
        email: valid.email,
        password: valid.password,
        data: {
          handle: valid.handle,
          display_name: valid.displayName,
        },
      },
    });

    const authUser = authRes?.user || null;
    const accessToken = authRes?.access_token || authRes?.session?.access_token || '';
    const sessionObj = accessToken
      ? saveStoredSupabaseSession(authRes.session || authRes)
      : null;

    const baseProfile = normalizeFrontendProfile({
      id: authUser?.id || createUuid(),
      email: valid.email,
      handle: valid.handle,
      displayName: valid.displayName,
      onboardingCompleted: true,
      isLocalOnly: false,
    });

    let syncedProfile = baseProfile;
    if (sessionObj?.access_token && authUser?.id) {
      try {
        const remoteRow = await upsertRemoteProfile(
          baseProfile,
          sessionObj.access_token
        );
        syncedProfile = fromSqlProfileRow(remoteRow, { email: valid.email });
      } catch {
        // Trigger handle_new_user já provisiona o perfil base no Supabase
      }
      await saveLocalWorkspace(syncedProfile.id, {
        profile: syncedProfile,
        items: [],
        posts: [],
        streak: { count: 0, lastDate: null, history: [] },
        readingSessions: [],
      });
    }

    return {
      mode: 'supabase',
      authenticated: Boolean(sessionObj && authUser),
      requiresEmailConfirmation: !sessionObj,
      user: authUser
        ? { id: authUser.id, email: valid.email, mode: 'supabase' }
        : null,
      profile: syncedProfile,
      workspace: {
        items: [],
        posts: [],
        streak: { count: 0, lastDate: null, history: [] },
        readingSessions: [],
      },
    };
  }

  // Motor Local Multiusuário no IndexedDB
  const [accounts, profiles, activeMeta] = await Promise.all([
    storeGetAll('accounts'),
    storeGetAll('profiles'),
    getActiveMetaSession(),
  ]);

  if (accounts.some((acc) => acc.email && acc.email.toLowerCase() === valid.email)) {
    throw new BackendError('E-mail já cadastrado.', {
      code: 'EMAIL_TAKEN',
      userMessage: 'Já existe um perfil local cadastrado com este e-mail.',
    });
  }
  if (
    profiles.some(
      (prof) => String(prof.handle || '').toLowerCase() === valid.handle.toLowerCase()
    )
  ) {
    throw new BackendError('Handle em uso.', {
      code: 'HANDLE_TAKEN',
      userMessage: `O identificador ${valid.handle} já está em uso neste dispositivo.`,
    });
  }

  if (activeMeta?.userId && currentWorkspace) {
    await saveLocalWorkspace(activeMeta.userId, currentWorkspace);
  }

  const userId = createUuid();
  const nowIso = new Date().toISOString();
  const passwordHash = await createPasswordRecord(valid.password);

  const newProfile = normalizeFrontendProfile({
    id: userId,
    email: valid.email,
    handle: valid.handle,
    displayName: valid.displayName,
    onboardingCompleted: true,
    isLocalOnly: true,
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  await storePut('accounts', {
    id: userId,
    email: valid.email,
    handle: valid.handle,
    passwordHash,
    isLocalOnly: true,
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  const emptyWorkspace = {
    items: [],
    posts: [],
    streak: { count: 0, lastDate: null, history: [] },
    readingSessions: [],
  };

  await saveLocalWorkspace(userId, {
    profile: newProfile,
    ...emptyWorkspace,
  });

  await setActiveMetaSession({
    userId,
    mode: 'local',
    loggedInAt: nowIso,
  });

  return {
    mode: 'local',
    authenticated: true,
    requiresEmailConfirmation: false,
    user: {
      id: userId,
      email: valid.email,
      handle: valid.handle,
      mode: 'local',
    },
    profile: newProfile,
    workspace: emptyWorkspace,
  };
}

export async function signInAccount({
  identifier,
  email,
  password,
  currentWorkspace = null,
}) {
  const loginId = String(identifier ?? email ?? '').trim().toLowerCase();
  const cleanPassword = String(password || '');

  if (!loginId) {
    throw new BackendError('Identificador ausente.', {
      code: 'MISSING_IDENTIFIER',
      userMessage: 'Informe seu e-mail ou @handle para entrar.',
    });
  }

  const mode = getBackendMode();

  if (mode === 'supabase') {
    if (!loginId.includes('@') || loginId.startsWith('@')) {
      throw new BackendError('Login Supabase requer e-mail.', {
        code: 'EMAIL_REQUIRED',
        userMessage: 'No modo Supabase, entre usando seu endereço de e-mail completo.',
      });
    }
    if (!cleanPassword) {
      throw new BackendError('Senha ausente.', {
        code: 'MISSING_PASSWORD',
        userMessage: 'Informe sua senha para entrar.',
      });
    }

    const tokenRes = await supabaseFetchJson(
      '/auth/v1/token?grant_type=password',
      {
        method: 'POST',
        body: {
          email: loginId,
          password: cleanPassword,
        },
      }
    );

    const sessionObj = saveStoredSupabaseSession(tokenRes);
    const authUser = tokenRes?.user || sessionObj?.user;
    if (!authUser?.id || !sessionObj?.access_token) {
      throw new BackendError('Resposta de sessão incompleta.', {
        code: 'AUTH_FAILED',
        userMessage: 'Não foi possível iniciar a sessão no Supabase.',
      });
    }

    let remoteRow = await fetchRemoteProfileById(
      authUser.id,
      sessionObj.access_token
    );
    if (!remoteRow) {
      const seedProfile = normalizeFrontendProfile({
        id: authUser.id,
        email: loginId,
        handle:
          authUser.user_metadata?.handle ||
          normalizeHandle(loginId.split('@')[0]),
        displayName:
          authUser.user_metadata?.display_name || loginId.split('@')[0],
        onboardingCompleted: true,
        isLocalOnly: false,
      });
      remoteRow = await upsertRemoteProfile(seedProfile, sessionObj.access_token);
    }

    const syncedProfile = fromSqlProfileRow(remoteRow, { email: loginId });
    const existingWs = await loadLocalWorkspace(syncedProfile.id);

    await saveLocalWorkspace(syncedProfile.id, {
      profile: syncedProfile,
      ...existingWs,
    });

    return {
      mode: 'supabase',
      authenticated: true,
      user: {
        id: authUser.id,
        email: loginId,
        mode: 'supabase',
      },
      profile: syncedProfile,
      workspace: existingWs,
    };
  }

  // Motor Local Multiusuário no IndexedDB
  const [accounts, profiles, activeMeta] = await Promise.all([
    storeGetAll('accounts'),
    storeGetAll('profiles'),
    getActiveMetaSession(),
  ]);

  const normalizedLoginHandle = loginId.startsWith('@')
    ? loginId
    : `@${loginId}`;

  const matchedProfile = profiles.find(
    (p) => String(p.handle || '').toLowerCase() === normalizedLoginHandle
  );
  const matchedAccount =
    accounts.find((a) => a.email && a.email.toLowerCase() === loginId) ||
    (matchedProfile ? accounts.find((a) => a.id === matchedProfile.id) : null);

  if (!matchedAccount) {
    throw new BackendError('Conta local não encontrada.', {
      code: 'USER_NOT_FOUND',
      userMessage: 'Nenhuma conta encontrada com este e-mail ou @handle.',
    });
  }

  if (matchedAccount.passwordHash) {
    const validPass = await verifyPasswordRecord(
      cleanPassword,
      matchedAccount.passwordHash
    );
    if (!validPass) {
      throw new BackendError('Senha incorreta.', {
        code: 'INVALID_CREDENTIALS',
        userMessage: 'Senha incorreta para este perfil.',
      });
    }
  }

  if (activeMeta?.userId && currentWorkspace && activeMeta.userId !== matchedAccount.id) {
    await saveLocalWorkspace(activeMeta.userId, currentWorkspace);
  }

  const targetProfile =
    (await storeGet('profiles', matchedAccount.id)) ||
    normalizeFrontendProfile({
      id: matchedAccount.id,
      handle: matchedAccount.handle,
      email: matchedAccount.email,
      isLocalOnly: true,
    });
  const targetWorkspace = await loadLocalWorkspace(matchedAccount.id);

  await setActiveMetaSession({
    userId: matchedAccount.id,
    mode: 'local',
    loggedInAt: new Date().toISOString(),
  });

  return {
    mode: 'local',
    authenticated: true,
    user: {
      id: matchedAccount.id,
      email: matchedAccount.email || '',
      handle: targetProfile.handle,
      mode: 'local',
    },
    profile: targetProfile,
    workspace: targetWorkspace,
  };
}

export async function switchLocalProfile(targetUserId, { currentWorkspace = null } = {}) {
  if (!targetUserId) {
    throw new BackendError('Perfil de destino inválido.', {
      code: 'INVALID_PROFILE_ID',
      userMessage: 'Selecione um perfil válido para alternar.',
    });
  }

  setForceLocalMode(true);
  const activeMeta = await getActiveMetaSession();

  if (activeMeta?.userId && currentWorkspace && activeMeta.userId !== targetUserId) {
    await saveLocalWorkspace(activeMeta.userId, currentWorkspace);
  }

  const [targetProfile, existingAccount] = await Promise.all([
    storeGet('profiles', targetUserId),
    storeGet('accounts', targetUserId),
  ]);

  if (!targetProfile) {
    throw new BackendError('Perfil não encontrado.', {
      code: 'PROFILE_NOT_FOUND',
      userMessage: 'Este perfil local não foi encontrado no dispositivo.',
    });
  }

  let targetAccount = existingAccount;
  if (!targetAccount) {
    const nowIso = new Date().toISOString();
    targetAccount = {
      id: targetProfile.id,
      email: targetProfile.email || '',
      handle: targetProfile.handle,
      passwordHash: null,
      isLocalOnly: false,
      createdAt: targetProfile.createdAt || nowIso,
      updatedAt: nowIso,
    };
    await storePut('accounts', targetAccount);
  }

  const targetWorkspace = await loadLocalWorkspace(targetUserId);

  await setActiveMetaSession({
    userId: targetUserId,
    mode: 'local',
    loggedInAt: new Date().toISOString(),
  });

  return {
    mode: 'local',
    authenticated: true,
    user: {
      id: targetProfile.id,
      email: targetAccount.email || targetProfile.email || '',
      handle: targetProfile.handle,
      mode: 'local',
    },
    profile: targetProfile,
    workspace: targetWorkspace,
  };
}

export async function continueInLocalMode({ currentWorkspace = null } = {}) {
  setForceLocalMode(true);
  const activeMeta = await getActiveMetaSession();

  if (activeMeta?.userId) {
    const [prof, acc] = await Promise.all([
      storeGet('profiles', activeMeta.userId),
      storeGet('accounts', activeMeta.userId),
    ]);
    if (prof) {
      if (currentWorkspace) {
        await saveLocalWorkspace(prof.id, currentWorkspace);
      }
      const ws = await loadLocalWorkspace(prof.id);
      return {
        mode: 'local',
        authenticated: true,
        user: {
          id: prof.id,
          email: acc?.email || prof.email || '',
          handle: prof.handle,
          mode: 'local',
        },
        profile: prof,
        workspace: ws,
      };
    }
  }

  const existingProfiles = await storeGetAll('profiles');
  if (existingProfiles.length > 0) {
    return switchLocalProfile(existingProfiles[0].id, { currentWorkspace });
  }

  const boot = await bootstrapBackend(currentWorkspace || {});
  const ws = boot.user?.id ? await loadLocalWorkspace(boot.user.id) : {
    items: currentWorkspace?.items || [],
    posts: currentWorkspace?.posts || [],
    streak: currentWorkspace?.streak || { count: 0, lastDate: null, history: [] },
    readingSessions: currentWorkspace?.readingSessions || [],
  };

  return {
    mode: 'local',
    authenticated: Boolean(boot.user),
    user: boot.user,
    profile: boot.profile,
    workspace: ws,
  };
}

export async function signOutAccount({ currentWorkspace = null } = {}) {
  const supabaseSession = loadStoredSupabaseSession();
  const activeMeta = await getActiveMetaSession();
  const saveTargetId = supabaseSession?.user?.id || activeMeta?.userId || null;

  if (saveTargetId && currentWorkspace) {
    await saveLocalWorkspace(saveTargetId, currentWorkspace);
  }

  if (supabaseSession?.access_token && isSupabaseConfigured()) {
    try {
      await supabaseFetchJson('/auth/v1/logout', {
        method: 'POST',
        token: supabaseSession.access_token,
      });
    } catch {
      // Ignora erro de rede ao desconectar remotamente
    }
  }

  saveStoredSupabaseSession(null);
  await setActiveMetaSession({
    userId: null,
    signedOut: true,
    loggedInAt: null,
  });

  return {
    mode: getBackendMode(),
    authenticated: false,
    user: null,
  };
}

export async function updateActiveProfileInBackend(profileData) {
  if (!profileData || typeof profileData !== 'object') return null;
  const mode = getBackendMode();

  if (mode === 'supabase') {
    const session = await ensureFreshSupabaseSession();
    if (session?.user?.id && session?.access_token) {
      const normalized = normalizeFrontendProfile({
        ...profileData,
        id: session.user.id,
        email: session.user.email || profileData.email || '',
        isLocalOnly: false,
      });
      await saveLocalWorkspace(normalized.id, { profile: normalized });
      try {
        const row = await upsertRemoteProfile(normalized, session.access_token);
        return fromSqlProfileRow(row, { email: normalized.email });
      } catch {
        // Mantém espelho local atualizado mesmo se offline
        return normalized;
      }
    }
  }

  const activeMeta = await getActiveMetaSession();
  const targetId = activeMeta?.userId || profileData.id;
  if (!targetId) return normalizeFrontendProfile(profileData);

  const normalized = normalizeFrontendProfile({
    ...profileData,
    id: targetId,
  });
  await saveLocalWorkspace(targetId, { profile: normalized });
  return normalized;
}

export async function syncActiveWorkspaceToBackend(workspace = {}) {
  const mode = getBackendMode();
  let targetUserId = null;

  if (mode === 'supabase') {
    const session = loadStoredSupabaseSession();
    targetUserId = session?.user?.id || null;
  }
  if (!targetUserId) {
    const activeMeta = await getActiveMetaSession();
    targetUserId = activeMeta?.userId || null;
  }
  if (!targetUserId) return;

  await saveLocalWorkspace(targetUserId, workspace);
}

// ============================================================================
// REDE SOCIAL LITERÁRIA (Seguir, Mural, Feed, Curtidas/Comentários e Chat 1:1)
// ============================================================================
const SOCIAL_META_KEYS = {
  follows: 'social_follows_v1',
  wallPosts: 'social_wall_posts_v1',
  reactions: 'social_reactions_v1',
  comments: 'social_comments_v1',
  messages: 'social_messages_v1',
  localContacts: 'social_local_contacts_v1',
  communitySeeded: 'social_community_seeded_v1',
  communityDirectory: 'community_directory_peers_v1',
};

async function readSocialList(metaKey) {
  const row = await storeGet('meta', metaKey);
  return Array.isArray(row?.value) ? row.value : [];
}

async function writeSocialList(metaKey, list) {
  await storePut('meta', {
    key: metaKey,
    value: Array.isArray(list) ? list : [],
  });
}

function buildSeededCommunityDirectory() {
  const nowIso = '2026-11-18T14:00:00.000Z';
  const clariceId = 'peer-clarice-br';
  const akiraId = 'peer-akira-manga';
  const helenaId = 'peer-helena-tcc';

  return {
    peers: [
      {
        profile: normalizeFrontendProfile({
          id: clariceId,
          handle: '@clarice_leitora',
          displayName: 'Clarice Nogueira',
          bio: 'Literatura brasileira, edição independente e diários de leitura.',
          privacyLevel: 'public',
          allowWallPosts: true,
          allowComments: true,
          allowDms: true,
          gamificationEnabled: true,
          activeTitleBadge: 'Restaurador de 35mm',
          readerFocus: 'Cinéfilo Curador',
          favoriteGenres: ['Drama', 'Clássicos'],
          createdAt: nowIso,
          updatedAt: nowIso,
        }),
        workspace: {
          items: [
            {
              id: 'peer-w1',
              inBacklog: true,
              status: 'playing',
              workType: 'movie',
              title: 'Central do Brasil',
              director: 'Walter Salles',
              releaseYear: 1998,
              durationMinutes: 113,
              totalSeconds: 113 * 60,
              currentSeconds: 65 * 60,
              progress: 58,
              updatedAt: '2026-11-19T10:30:00.000Z',
            },
            {
              id: 'peer-w2',
              inBacklog: true,
              status: 'completed',
              workType: 'movie',
              title: 'Cidade de Deus',
              originalTitle: 'Cidade de Deus',
              director: 'Fernando Meirelles',
              releaseYear: 2002,
              rating: 96,
              verdict: 'Obra-Prima',
              notes: 'Montagem ágil e fotografia marcante.',
              completedDate: '2026-11-12',
              updatedAt: '2026-11-12T20:00:00.000Z',
            },
          ],
          posts: [
            {
              id: 'peer-post-1',
              workId: 'peer-w2',
              itemId: 'peer-w2',
              itemTitle: 'Cidade de Deus',
              title: 'Revisitando em 4K restaurado',
              caption: 'O ritmo da montagem inicial continua irretocável.',
              progressMarker: 'Concluído',
              createdAt: '2026-11-15T18:20:00.000Z',
            },
          ],
          streak: { count: 9, lastDate: '2026-11-19', history: [] },
          readingSessions: [],
        },
      },
      {
        profile: normalizeFrontendProfile({
          id: akiraId,
          handle: '@akira_cine',
          displayName: 'Akira Tanaka',
          bio: 'Curador de animes seinen, cyberpunk e séries de mistério.',
          privacyLevel: 'public',
          allowWallPosts: true,
          allowComments: true,
          allowDms: true,
          gamificationEnabled: true,
          activeTitleBadge: 'Maratonista de Temporada',
          readerFocus: 'Curador de Animes',
          favoriteGenres: ['Seinen', 'Ficção Científica'],
          createdAt: nowIso,
          updatedAt: nowIso,
        }),
        workspace: {
          items: [
            {
              id: 'peer-m1',
              inBacklog: true,
              status: 'playing',
              workType: 'anime',
              title: 'Monster',
              originalTitle: 'モンスター',
              director: 'Masayuki Kojima',
              studio: 'Madhouse',
              currentSeason: 1,
              totalSeasons: 1,
              currentEpisode: 42,
              totalEpisodes: 74,
              progress: 57,
              updatedAt: '2026-11-19T12:00:00.000Z',
            },
            {
              id: 'peer-m2',
              inBacklog: true,
              status: 'completed',
              workType: 'anime',
              title: 'Cowboy Bebop',
              director: 'Shinichiro Watanabe',
              studio: 'Sunrise',
              rating: 95,
              verdict: 'Obra-Prima',
              notes: 'Trilha de Yoko Kanno e direção impecáveis.',
              completedDate: '2026-11-10',
              updatedAt: '2026-11-10T18:00:00.000Z',
            },
          ],
          posts: [
            {
              id: 'peer-post-2',
              workId: 'peer-m1',
              itemId: 'peer-m1',
              itemTitle: 'Monster',
              title: 'Episódio 42 de Monster mantém a tensão',
              caption: 'Cada episódio expande o suspense sem perder o foco psicológico.',
              progressMarker: 'Temp. 1 · Ep. 42',
              createdAt: '2026-11-18T21:10:00.000Z',
            },
          ],
          streak: { count: 14, lastDate: '2026-11-19', history: [] },
          readingSessions: [],
        },
      },
      {
        profile: normalizeFrontendProfile({
          id: helenaId,
          handle: '@helena_cinema',
          displayName: 'Helena Vasconcelos',
          bio: 'Pesquisadora de direção de fotografia e séries de ficção científica.',
          privacyLevel: 'followers',
          allowWallPosts: true,
          allowComments: true,
          allowDms: true,
          gamificationEnabled: true,
          activeTitleBadge: 'Projeção Cyberpunk & Sci-Fi',
          readerFocus: 'Pesquisador de Cinema',
          favoriteGenres: ['Ficção Científica', 'Suspense & Thriller'],
          createdAt: nowIso,
          updatedAt: nowIso,
        }),
        workspace: {
          items: [
            {
              id: 'peer-a1',
              inBacklog: true,
              status: 'playing',
              workType: 'series',
              title: 'Ruptura',
              originalTitle: 'Severance',
              director: 'Ben Stiller',
              currentSeason: 2,
              totalSeasons: 2,
              currentEpisode: 12,
              totalEpisodes: 19,
              progress: 63,
              updatedAt: '2026-11-18T11:00:00.000Z',
            },
          ],
          posts: [],
          streak: { count: 5, lastDate: '2026-11-18', history: [] },
          readingSessions: [],
        },
      },
    ],
    seedWallPosts: [
      {
        id: 'seed-wall-1',
        profileId: clariceId,
        authorId: akiraId,
        authorHandle: '@akira_cine',
        authorDisplayName: 'Akira Tanaka',
        authorAvatarInitials: 'AT',
        authorAvatarUrl: '',
        authorActiveTitleBadge: 'Maratonista de Temporada',
        content: 'Ótima crítica sobre Cidade de Deus! Já coloquei em Quero Ver para o fim de semana.',
        pinned: true,
        createdAt: '2026-11-16T15:00:00.000Z',
        updatedAt: '2026-11-16T15:00:00.000Z',
      },
    ],
  };
}

export async function ensureLocalCommunitySeeded() {
  const existingFlag = await storeGet('meta', SOCIAL_META_KEYS.communitySeeded);
  if (existingFlag?.value === true) return;

  const seed = buildSeededCommunityDirectory();
  await storePut('meta', {
    key: SOCIAL_META_KEYS.communityDirectory,
    value: seed.peers,
  });
  const currentWall = await readSocialList(SOCIAL_META_KEYS.wallPosts);
  if (currentWall.length === 0) {
    await writeSocialList(SOCIAL_META_KEYS.wallPosts, seed.seedWallPosts);
  }
  await storePut('meta', { key: SOCIAL_META_KEYS.communitySeeded, value: true });
}

async function resolveCurrentViewerId(explicitViewerId = null) {
  if (explicitViewerId) return explicitViewerId;
  const session = await getCurrentBackendSession();
  return session?.profile?.id || session?.user?.id || null;
}

async function getAllLocalProfilesWithWorkspaces() {
  await ensureLocalCommunitySeeded();
  const realProfiles = await storeGetAll('profiles');
  const seededRow = await storeGet('meta', SOCIAL_META_KEYS.communityDirectory);
  const seededPeers = Array.isArray(seededRow?.value) ? seededRow.value : [];

  const resultMap = new Map();
  for (const peer of seededPeers) {
    if (!peer?.profile?.id) continue;
    resultMap.set(peer.profile.id, {
      profile: peer.profile,
      workspace: peer.workspace || { items: [], posts: [], streak: {}, readingSessions: [] },
      isDirectorySeed: true,
    });
  }
  for (const p of realProfiles) {
    if (!p?.id) continue;
    const ws = await loadLocalWorkspace(p.id);
    resultMap.set(p.id, {
      profile: normalizeFrontendProfile(p),
      workspace: ws,
      isDirectorySeed: false,
    });
  }
  return Array.from(resultMap.values());
}

function resolveBadgeForReader({ profile, workspace, wallPostsCount = 0 }) {
  if (profile?.gamificationEnabled === false) return '';
  const evalRes = evaluateReaderTitles({
    items: workspace?.items || [],
    profile,
    readingSessions: workspace?.readingSessions || [],
    streakCount: workspace?.streak?.count || 0,
    posts: workspace?.posts || [],
    wallPostsCount,
  });
  return evalRes.resolvedActiveBadge?.name || profile?.activeTitleBadge || '';
}

export async function listFollowRelationships(viewerId = null) {
  const resolvedViewerId = await resolveCurrentViewerId(viewerId);
  if (getBackendMode() === 'supabase') {
    const session = await ensureFreshSupabaseSession();
    if (session?.access_token && resolvedViewerId) {
      try {
        const rows = await supabaseFetchJson(
          `/rest/v1/follows?or=(follower_id.eq.${encodeURIComponent(
            resolvedViewerId
          )},following_id.eq.${encodeURIComponent(resolvedViewerId)})&select=*`,
          { token: session.access_token }
        );
        return (Array.isArray(rows) ? rows : []).map((r) => ({
          id: r.id,
          followerId: r.follower_id,
          followingId: r.following_id,
          status: r.status || 'approved',
          createdAt: r.created_at,
        }));
      } catch {
        // Fallback local se offline
      }
    }
  }

  return readSocialList(SOCIAL_META_KEYS.follows);
}

export async function searchReaderProfiles(query = '', { viewerId = null } = {}) {
  const resolvedViewerId = await resolveCurrentViewerId(viewerId);
  const q = String(query || '').trim().toLowerCase();

  if (getBackendMode() === 'supabase') {
    const session = await ensureFreshSupabaseSession();
    if (session?.access_token) {
      try {
        const cleanQuery = q.replace(/^#/, '');
        const filterPart = q
          ? `&or=(handle.ilike.*${encodeURIComponent(cleanQuery)}*,user_tag.ilike.*${encodeURIComponent(cleanQuery)}*,display_name.ilike.*${encodeURIComponent(cleanQuery)}*)`
          : '';
        const rows = await supabaseFetchJson(
          `/rest/v1/profiles?select=*&limit=30${filterPart}`,
          { token: session.access_token }
        );
        const follows = await listFollowRelationships(resolvedViewerId);
        return (Array.isArray(rows) ? rows : [])
          .map((row) => fromSqlProfileRow(row))
          .filter(
            (p) =>
              p.id === resolvedViewerId ||
              p.privacyLevel !== 'private'
          )
          .map((p) => {
            const rel = follows.find(
              (f) => f.followerId === resolvedViewerId && f.followingId === p.id
            );
            return {
              ...p,
              followStatus: rel ? rel.status : 'none',
            };
          });
      } catch {
        // Degrada para motor local abaixo
      }
    }
  }

  const allEntries = await getAllLocalProfilesWithWorkspaces();
  const follows = await listFollowRelationships(resolvedViewerId);
  const wallPosts = await readSocialList(SOCIAL_META_KEYS.wallPosts);

  return allEntries
    .filter(({ profile }) => {
      if (profile.privacyLevel === 'private' && profile.id !== resolvedViewerId) {
        return false;
      }
      if (!q) return true;
      const hashCode = profile.discriminator ? `#${profile.discriminator}` : '';
      return (
        String(profile.userTag || '').toLowerCase().includes(q) ||
        String(profile.discriminator || '').toLowerCase().includes(q.replace(/^#/, '')) ||
        hashCode.includes(q) ||
        String(profile.handle || '').toLowerCase().includes(q) ||
        String(profile.displayName || '').toLowerCase().includes(q) ||
        String(profile.bio || '').toLowerCase().includes(q)
      );
    })
    .map(({ profile, workspace, isDirectorySeed }) => {
      const rel = follows.find(
        (f) => f.followerId === resolvedViewerId && f.followingId === profile.id
      );
      const userWallCount = wallPosts.filter((w) => w.profileId === profile.id).length;
      const badgeName = resolveBadgeForReader({
        profile,
        workspace,
        wallPostsCount: userWallCount,
      });
      const readingCount = (workspace.items || []).filter(
        (i) => i.status === 'playing' || i.status === 'reading'
      ).length;

      return {
        ...profile,
        isDirectorySeed: Boolean(isDirectorySeed),
        resolvedBadgeName: badgeName,
        worksCount: (workspace.items || []).filter((i) => i.inBacklog !== false).length,
        readingCount,
        followStatus: rel ? rel.status : 'none',
        isSelf: Boolean(resolvedViewerId && profile.id === resolvedViewerId),
      };
    });
}

export async function followReader(targetProfileId, { viewerId = null } = {}) {
  const resolvedViewerId = await resolveCurrentViewerId(viewerId);
  if (!resolvedViewerId || !targetProfileId) {
    throw new BackendError('Identificadores inválidos para seguir leitor.', {
      code: 'INVALID_FOLLOW',
      userMessage: 'Não foi possível identificar o leitor selecionado.',
    });
  }
  if (resolvedViewerId === targetProfileId) {
    throw new BackendError('Auto-seguimento inválido.', {
      code: 'SELF_FOLLOW',
      userMessage: 'Você não pode seguir o próprio perfil.',
    });
  }

  const allEntries = await getAllLocalProfilesWithWorkspaces();
  const targetEntry = allEntries.find((e) => e.profile.id === targetProfileId);
  const targetProfile = targetEntry?.profile || null;
  if (targetProfile?.privacyLevel === 'private') {
    throw new BackendError('Perfil privado.', {
      code: 'PRIVATE_PROFILE',
      userMessage: 'Este perfil é privado e não aceita seguidores.',
    });
  }

  const nextStatus =
    targetProfile?.privacyLevel === 'followers' ? 'pending' : 'approved';

  if (getBackendMode() === 'supabase') {
    const session = await ensureFreshSupabaseSession();
    if (session?.access_token) {
      try {
        await supabaseFetchJson('/rest/v1/follows', {
          method: 'POST',
          token: session.access_token,
          extraHeaders: { Prefer: 'return=representation' },
          body: {
            follower_id: resolvedViewerId,
            following_id: targetProfileId,
            status: nextStatus,
          },
        });
        return { followerId: resolvedViewerId, followingId: targetProfileId, status: nextStatus };
      } catch (err) {
        if (err instanceof BackendError && err.status >= 400 && err.status < 500 && err.status !== 409) {
          throw err;
        }
      }
    }
  }

  const follows = await readSocialList(SOCIAL_META_KEYS.follows);
  const existingIdx = follows.findIndex(
    (f) => f.followerId === resolvedViewerId && f.followingId === targetProfileId
  );
  const nowIso = new Date().toISOString();
  const record = {
    id: existingIdx >= 0 ? follows[existingIdx].id : createUuid(),
    followerId: resolvedViewerId,
    followingId: targetProfileId,
    status: nextStatus,
    createdAt: existingIdx >= 0 ? follows[existingIdx].createdAt : nowIso,
    updatedAt: nowIso,
  };
  if (existingIdx >= 0) {
    follows[existingIdx] = record;
  } else {
    follows.push(record);
  }
  await writeSocialList(SOCIAL_META_KEYS.follows, follows);
  return record;
}

export async function unfollowReader(targetProfileId, { viewerId = null } = {}) {
  const resolvedViewerId = await resolveCurrentViewerId(viewerId);
  if (!resolvedViewerId || !targetProfileId) return false;

  if (getBackendMode() === 'supabase') {
    const session = await ensureFreshSupabaseSession();
    if (session?.access_token) {
      try {
        await supabaseFetchJson(
          `/rest/v1/follows?follower_id=eq.${encodeURIComponent(
            resolvedViewerId
          )}&following_id=eq.${encodeURIComponent(targetProfileId)}`,
          { method: 'DELETE', token: session.access_token }
        );
      } catch {
        // Fallback local
      }
    }
  }

  const follows = await readSocialList(SOCIAL_META_KEYS.follows);
  const filtered = follows.filter(
    (f) => !(f.followerId === resolvedViewerId && f.followingId === targetProfileId)
  );
  await writeSocialList(SOCIAL_META_KEYS.follows, filtered);
  return true;
}

export async function respondFollowRequest(
  followerId,
  accept = true,
  { profileId = null } = {}
) {
  const resolvedOwnerId = await resolveCurrentViewerId(profileId);
  if (!resolvedOwnerId || !followerId) return null;

  const follows = await readSocialList(SOCIAL_META_KEYS.follows);
  if (!accept) {
    const remaining = follows.filter(
      (f) => !(f.followerId === followerId && f.followingId === resolvedOwnerId)
    );
    await writeSocialList(SOCIAL_META_KEYS.follows, remaining);
    return { status: 'rejected' };
  }

  const nowIso = new Date().toISOString();
  const updated = follows.map((f) =>
    f.followerId === followerId && f.followingId === resolvedOwnerId
      ? { ...f, status: 'approved', updatedAt: nowIso }
      : f
  );
  await writeSocialList(SOCIAL_META_KEYS.follows, updated);

  if (getBackendMode() === 'supabase') {
    const session = await ensureFreshSupabaseSession();
    if (session?.access_token) {
      try {
        await supabaseFetchJson(
          `/rest/v1/follows?follower_id=eq.${encodeURIComponent(
            followerId
          )}&following_id=eq.${encodeURIComponent(resolvedOwnerId)}`,
          {
            method: 'PATCH',
            token: session.access_token,
            body: { status: 'approved' },
          }
        );
      } catch {
        // Ignora falha de rede após atualizar cache local
      }
    }
  }

  return { followerId, followingId: resolvedOwnerId, status: 'approved' };
}

export async function listPendingFollowRequests(profileId = null) {
  const resolvedOwnerId = await resolveCurrentViewerId(profileId);
  if (!resolvedOwnerId) return [];
  const follows = await readSocialList(SOCIAL_META_KEYS.follows);
  const pending = follows.filter(
    (f) => f.followingId === resolvedOwnerId && f.status === 'pending'
  );
  if (pending.length === 0) return [];
  const allEntries = await getAllLocalProfilesWithWorkspaces();
  const profileMap = new Map(allEntries.map((e) => [e.profile.id, e.profile]));
  return pending.map((rel) => ({
    ...rel,
    followerProfile: profileMap.get(rel.followerId) || null,
  }));
}

export async function getReaderProfileBundle(targetProfileId, { viewerId = null } = {}) {
  const resolvedViewerId = await resolveCurrentViewerId(viewerId);

  if (String(targetProfileId || '').startsWith('contact:')) {
    const contacts = await readSocialList(SOCIAL_META_KEYS.localContacts);
    const matchedContact = contacts.find((c) => c.id === targetProfileId);
    if (matchedContact) {
      return {
        restricted: false,
        followStatus: 'none',
        isLocalContact: true,
        permissions: {
          isOwner: false,
          privacyLevel: 'public',
          canView: true,
          canFollow: false,
          canPostWall: false,
          canComment: false,
          canSendDm: false,
        },
        followerCount: 0,
        followingCount: 0,
        resolvedBadgeName: '',
        profile: matchedContact,
        readingNow: [],
        latestReviews: [],
        publicShelf: [],
        posts: [],
      };
    }
  }

  const allEntries = await getAllLocalProfilesWithWorkspaces();
  let targetEntry = allEntries.find((e) => e.profile.id === targetProfileId) || null;

  if (!targetEntry && getBackendMode() === 'supabase') {
    const session = await ensureFreshSupabaseSession();
    if (session?.access_token) {
      try {
        const [profiles, works, reviews, entries] = await Promise.all([
          supabaseFetchJson(
            `/rest/v1/profiles?id=eq.${encodeURIComponent(targetProfileId)}&select=*`,
            { token: session.access_token }
          ),
          supabaseFetchJson(
            `/rest/v1/works?user_id=eq.${encodeURIComponent(targetProfileId)}&select=*`,
            { token: session.access_token }
          ).catch(() => []),
          supabaseFetchJson(
            `/rest/v1/reviews?user_id=eq.${encodeURIComponent(targetProfileId)}&select=*`,
            { token: session.access_token }
          ).catch(() => []),
          supabaseFetchJson(
            `/rest/v1/journal_entries?user_id=eq.${encodeURIComponent(targetProfileId)}&select=*`,
            { token: session.access_token }
          ).catch(() => []),
        ]);
        if (Array.isArray(profiles) && profiles[0]) {
          const revMap = new Map((reviews || []).map((r) => [r.work_id, r]));
          const mappedItems = (works || []).map((w) => {
            const rev = revMap.get(w.id);
            return {
              ...w,
              inBacklog: true,
              currentPage: w.current_page ?? 0,
              totalPages: w.total_pages ?? null,
              originalTitle: w.original_title || '',
              rating: rev?.rating ?? null,
              verdict: rev?.verdict ?? null,
              notes: rev?.notes || '',
            };
          });
          targetEntry = {
            profile: fromSqlProfileRow(profiles[0]),
            workspace: {
              items: mappedItems,
              posts: Array.isArray(entries) ? entries : [],
              streak: {},
              readingSessions: [],
            },
          };
        }
      } catch {
        // Segue fallback nulo abaixo
      }
    }
  }

  if (!targetEntry) {
    throw new BackendError('Perfil não encontrado.', {
      code: 'PROFILE_NOT_FOUND',
      userMessage: 'Não foi possível localizar o perfil deste leitor.',
    });
  }

  const targetProfile = targetEntry.profile;
  const follows = await listFollowRelationships(resolvedViewerId);
  const myRel = follows.find(
    (f) => f.followerId === resolvedViewerId && f.followingId === targetProfile.id
  );
  const followStatus = myRel ? myRel.status : 'none';
  const permissions = canInteractWithProfile(targetProfile, {
    viewerId: resolvedViewerId,
    isFollower: followStatus === 'approved',
  });

  const followerCount = follows.filter(
    (f) => f.followingId === targetProfile.id && f.status === 'approved'
  ).length;
  const followingCount = follows.filter(
    (f) => f.followerId === targetProfile.id && f.status === 'approved'
  ).length;

  const wallPostsAll = await readSocialList(SOCIAL_META_KEYS.wallPosts);
  const wallCount = wallPostsAll.filter((w) => w.profileId === targetProfile.id).length;
  const resolvedBadgeName = resolveBadgeForReader({
    profile: targetProfile,
    workspace: targetEntry.workspace,
    wallPostsCount: wallCount,
  });

  if (!permissions.canView) {
    return {
      restricted: true,
      reason:
        targetProfile.privacyLevel === 'private'
          ? 'Este acervo está em modo Privado.'
          : 'Acervo visível apenas para seguidores aprovados.',
      followStatus,
      permissions,
      followerCount,
      followingCount,
      resolvedBadgeName,
      profile: {
        id: targetProfile.id,
        handle: targetProfile.handle,
        displayName: targetProfile.displayName,
        avatarInitials: targetProfile.avatarInitials,
        avatarUrl: targetProfile.avatarUrl,
        bio: targetProfile.bio,
        privacyLevel: targetProfile.privacyLevel,
        gamificationEnabled: targetProfile.gamificationEnabled,
      },
      readingNow: [],
      latestReviews: [],
      publicShelf: [],
      posts: [],
    };
  }

  const wsItems = (targetEntry.workspace?.items || []).filter(
    (i) => i && i.inBacklog !== false
  );
  const readingNow = wsItems.filter(
    (i) => i.status === 'playing' || i.status === 'reading'
  );
  const latestReviews = wsItems
    .filter(
      (i) =>
        i.status === 'completed' &&
        (typeof i.rating === 'number' || (i.notes && i.notes.trim()))
    )
    .sort((a, b) =>
      String(b.completedDate || b.updatedAt || '').localeCompare(
        String(a.completedDate || a.updatedAt || '')
      )
    )
    .slice(0, 6);

  return {
    restricted: false,
    followStatus,
    permissions,
    followerCount,
    followingCount,
    resolvedBadgeName,
    profile: targetProfile,
    readingNow,
    latestReviews,
    publicShelf: wsItems,
    posts: (targetEntry.workspace?.posts || []).filter((p) => p.visibility !== 'private'),
  };
}

export async function listWallPosts(profileId, { viewerId = null } = {}) {
  const resolvedViewerId = await resolveCurrentViewerId(viewerId);
  const allPosts = await readSocialList(SOCIAL_META_KEYS.wallPosts);
  const allEntries = await getAllLocalProfilesWithWorkspaces();
  const profileMap = new Map(allEntries.map((e) => [e.profile.id, e.profile]));

  const targetProfile = profileMap.get(profileId);
  if (targetProfile) {
    const follows = await listFollowRelationships(resolvedViewerId);
    const isFollower = follows.some(
      (f) =>
        f.followerId === resolvedViewerId &&
        f.followingId === profileId &&
        f.status === 'approved'
    );
    const perms = canInteractWithProfile(targetProfile, {
      viewerId: resolvedViewerId,
      isFollower,
    });
    if (!perms.canView) return [];
  }

  return allPosts
    .filter((p) => p.profileId === profileId)
    .map((p) => {
      const authorProfile = profileMap.get(p.authorId);
      return {
        ...p,
        authorHandle: authorProfile?.handle || p.authorHandle || '@leitor',
        authorDisplayName:
          authorProfile?.displayName || p.authorDisplayName || 'Leitor',
        authorAvatarInitials:
          authorProfile?.avatarInitials || p.authorAvatarInitials || 'LC',
        authorAvatarUrl: authorProfile?.avatarUrl ?? p.authorAvatarUrl ?? '',
        authorActiveTitleBadge:
          authorProfile?.gamificationEnabled !== false
            ? authorProfile?.activeTitleBadge || p.authorActiveTitleBadge || ''
            : '',
      };
    })
    .sort((a, b) => {
      const pinDiff = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
      if (pinDiff !== 0) return pinDiff;
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
}

export async function createWallPost(profileId, content, { viewerId = null } = {}) {
  const cleanContent = String(content || '').trim();
  if (!cleanContent) {
    throw new BackendError('Mensagem vazia.', {
      code: 'EMPTY_WALL_POST',
      userMessage: 'Escreva uma mensagem antes de publicar no mural.',
    });
  }
  if (cleanContent.length > MAX_SOCIAL_MESSAGE_CHARS) {
    throw new BackendError('Mensagem excede o limite.', {
      code: 'WALL_POST_TOO_LONG',
      userMessage: `O recado não pode ultrapassar ${MAX_SOCIAL_MESSAGE_CHARS} caracteres.`,
    });
  }

  const resolvedViewerId = await resolveCurrentViewerId(viewerId);
  if (!resolvedViewerId || !profileId) {
    throw new BackendError('Sessão necessária.', {
      code: 'UNAUTHENTICATED',
      userMessage: 'Entre ou ative um perfil local para escrever no mural.',
    });
  }

  const allEntries = await getAllLocalProfilesWithWorkspaces();
  const profileMap = new Map(allEntries.map((e) => [e.profile.id, e]));
  const targetEntry = profileMap.get(profileId);
  const authorEntry = profileMap.get(resolvedViewerId);

  if (targetEntry) {
    const follows = await listFollowRelationships(resolvedViewerId);
    const isFollower = follows.some(
      (f) =>
        f.followerId === resolvedViewerId &&
        f.followingId === profileId &&
        f.status === 'approved'
    );
    const perms = canInteractWithProfile(targetEntry.profile, {
      viewerId: resolvedViewerId,
      isFollower,
    });
    if (!perms.canPostWall) {
      throw new BackendError('Mural bloqueado.', {
        code: 'WALL_DISABLED',
        userMessage: 'Este leitor desativou ou restringiu recados no mural.',
      });
    }
  }

  const authorProfile = authorEntry?.profile || null;
  const badgeName = authorEntry
    ? resolveBadgeForReader({
        profile: authorEntry.profile,
        workspace: authorEntry.workspace,
      })
    : '';
  const nowIso = new Date().toISOString();

  const postRecord = {
    id: createUuid(),
    profileId,
    authorId: resolvedViewerId,
    authorHandle: authorProfile?.handle || '@leitor',
    authorDisplayName: authorProfile?.displayName || 'Leitor',
    authorAvatarInitials: authorProfile?.avatarInitials || 'LC',
    authorAvatarUrl: authorProfile?.avatarUrl || '',
    authorActiveTitleBadge: badgeName,
    content: cleanContent,
    pinned: false,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  if (getBackendMode() === 'supabase') {
    const session = await ensureFreshSupabaseSession();
    if (session?.access_token) {
      try {
        await supabaseFetchJson('/rest/v1/wall_posts', {
          method: 'POST',
          token: session.access_token,
          body: {
            id: postRecord.id,
            profile_id: profileId,
            author_id: resolvedViewerId,
            content: cleanContent,
            pinned: false,
          },
        });
      } catch {
        // Fallback em espelho local
      }
    }
  }

  const list = await readSocialList(SOCIAL_META_KEYS.wallPosts);
  list.unshift(postRecord);
  await writeSocialList(SOCIAL_META_KEYS.wallPosts, list);
  return postRecord;
}

export async function togglePinWallPost(postId, { viewerId = null } = {}) {
  const resolvedViewerId = await resolveCurrentViewerId(viewerId);
  const list = await readSocialList(SOCIAL_META_KEYS.wallPosts);
  let updatedPost = null;
  const nextList = list.map((p) => {
    if (p.id !== postId) return p;
    if (resolvedViewerId && p.profileId !== resolvedViewerId) {
      throw new BackendError('Sem permissão.', {
        code: 'FORBIDDEN',
        userMessage: 'Somente o dono do mural pode fixar recados.',
      });
    }
    updatedPost = {
      ...p,
      pinned: !p.pinned,
      updatedAt: new Date().toISOString(),
    };
    return updatedPost;
  });
  await writeSocialList(SOCIAL_META_KEYS.wallPosts, nextList);
  return updatedPost;
}

export async function deleteWallPost(postId, { viewerId = null } = {}) {
  const resolvedViewerId = await resolveCurrentViewerId(viewerId);
  const list = await readSocialList(SOCIAL_META_KEYS.wallPosts);
  const target = list.find((p) => p.id === postId);
  if (!target) return false;
  if (
    resolvedViewerId &&
    target.profileId !== resolvedViewerId &&
    target.authorId !== resolvedViewerId
  ) {
    throw new BackendError('Sem permissão.', {
      code: 'FORBIDDEN',
      userMessage: 'Apenas o autor do recado ou dono do mural podem excluí-lo.',
    });
  }
  await writeSocialList(
    SOCIAL_META_KEYS.wallPosts,
    list.filter((p) => p.id !== postId)
  );
  return true;
}

export async function listActivityFeed({ viewerId = null } = {}) {
  const resolvedViewerId = await resolveCurrentViewerId(viewerId);
  const allEntries = await getAllLocalProfilesWithWorkspaces();
  const follows = await listFollowRelationships(resolvedViewerId);
  const followingIds = new Set(
    follows
      .filter((f) => f.followerId === resolvedViewerId && f.status === 'approved')
      .map((f) => f.followingId)
  );

  const reactions = await readSocialList(SOCIAL_META_KEYS.reactions);
  const comments = await readSocialList(SOCIAL_META_KEYS.comments);
  const profileMap = new Map(allEntries.map((e) => [e.profile.id, e.profile]));

  const feedItems = [];

  for (const { profile, workspace } of allEntries) {
    const isSelf = Boolean(resolvedViewerId && profile.id === resolvedViewerId);
    const isFollower = followingIds.has(profile.id);
    const perms = canInteractWithProfile(profile, {
      viewerId: resolvedViewerId,
      isFollower,
    });
    if (!perms.canView) continue;
    // Prioriza atividades próprias, de seguidos, ou descoberta pública no diretório local
    if (!isSelf && !isFollower && profile.privacyLevel !== 'public') continue;

    for (const post of workspace?.posts || []) {
      if (!post || !post.id) continue;
      if (post.visibility === 'private' && !isSelf) continue;

      const postReactions = reactions.filter(
        (r) => r.targetType === 'journal' && r.targetId === post.id
      );
      const postComments = comments
        .filter((c) => c.targetType === 'journal' && c.targetId === post.id)
        .map((c) => {
          const cp = profileMap.get(c.authorId);
          return {
            ...c,
            authorHandle: cp?.handle || c.authorHandle || '@leitor',
            authorDisplayName: cp?.displayName || c.authorDisplayName || 'Leitor',
            authorAvatarInitials: cp?.avatarInitials || c.authorAvatarInitials || 'LC',
          };
        })
        .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));

      feedItems.push({
        id: post.id,
        ownerId: profile.id,
        ownerProfile: {
          ...profile,
          resolvedBadgeName: resolveBadgeForReader({ profile, workspace }),
        },
        allowComments: perms.canComment,
        isFollowing: isFollower,
        isSelf,
        title: post.title,
        caption: post.caption || '',
        itemTitle: post.itemTitle || '',
        itemSnapshot: post.itemSnapshot || null,
        progressMarker: post.progressMarker || '',
        createdAt: post.createdAt || profile.updatedAt,
        likesCount: postReactions.length,
        viewerLiked: Boolean(
          resolvedViewerId && postReactions.some((r) => r.userId === resolvedViewerId)
        ),
        comments: postComments,
      });
    }
  }

  return feedItems.sort((a, b) => {
    const followBoost = Number(b.isFollowing || b.isSelf) - Number(a.isFollowing || a.isSelf);
    if (followBoost !== 0) return followBoost;
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  });
}

export async function togglePostReaction({
  targetType = 'journal',
  targetId,
  reactionType = 'like',
  viewerId = null,
}) {
  const resolvedViewerId = await resolveCurrentViewerId(viewerId);
  if (!resolvedViewerId || !targetId) return { liked: false, count: 0 };

  const list = await readSocialList(SOCIAL_META_KEYS.reactions);
  const existingIdx = list.findIndex(
    (r) =>
      r.userId === resolvedViewerId &&
      r.targetType === targetType &&
      r.targetId === targetId &&
      r.reactionType === reactionType
  );

  let liked = false;
  if (existingIdx >= 0) {
    list.splice(existingIdx, 1);
    liked = false;
  } else {
    list.push({
      id: createUuid(),
      userId: resolvedViewerId,
      targetType,
      targetId,
      reactionType,
      createdAt: new Date().toISOString(),
    });
    liked = true;
  }
  await writeSocialList(SOCIAL_META_KEYS.reactions, list);

  const count = list.filter(
    (r) => r.targetType === targetType && r.targetId === targetId
  ).length;
  return { liked, count };
}

export async function addSocialComment({
  targetType = 'journal',
  targetId,
  content,
  ownerProfileId = null,
  viewerId = null,
}) {
  const cleanContent = String(content || '').trim();
  if (!cleanContent) {
    throw new BackendError('Comentário vazio.', {
      code: 'EMPTY_COMMENT',
      userMessage: 'Digite um comentário antes de enviar.',
    });
  }
  if (cleanContent.length > MAX_SOCIAL_MESSAGE_CHARS) {
    throw new BackendError('Comentário excede o limite.', {
      code: 'COMMENT_TOO_LONG',
      userMessage: `O comentário não pode ultrapassar ${MAX_SOCIAL_MESSAGE_CHARS} caracteres.`,
    });
  }

  const resolvedViewerId = await resolveCurrentViewerId(viewerId);
  if (!resolvedViewerId || !targetId) {
    throw new BackendError('Sessão necessária.', {
      code: 'UNAUTHENTICATED',
      userMessage: 'Entre com seu perfil para comentar.',
    });
  }

  const allEntries = await getAllLocalProfilesWithWorkspaces();
  const profileMap = new Map(allEntries.map((e) => [e.profile.id, e.profile]));
  const ownerProfile = ownerProfileId ? profileMap.get(ownerProfileId) : null;

  if (ownerProfile) {
    const follows = await listFollowRelationships(resolvedViewerId);
    const isFollower = follows.some(
      (f) =>
        f.followerId === resolvedViewerId &&
        f.followingId === ownerProfile.id &&
        f.status === 'approved'
    );
    const perms = canInteractWithProfile(ownerProfile, {
      viewerId: resolvedViewerId,
      isFollower,
    });
    if (!perms.canComment) {
      throw new BackendError('Comentários desativados.', {
        code: 'COMMENTS_DISABLED',
        userMessage: 'Este leitor desativou ou restringiu comentários.',
      });
    }
  }

  const authorProfile = profileMap.get(resolvedViewerId);
  const record = {
    id: createUuid(),
    authorId: resolvedViewerId,
    authorHandle: authorProfile?.handle || '@leitor',
    authorDisplayName: authorProfile?.displayName || 'Leitor',
    authorAvatarInitials: authorProfile?.avatarInitials || 'LC',
    targetType,
    targetId,
    ownerProfileId: ownerProfileId || null,
    content: cleanContent,
    createdAt: new Date().toISOString(),
  };

  const list = await readSocialList(SOCIAL_META_KEYS.comments);
  list.push(record);
  await writeSocialList(SOCIAL_META_KEYS.comments, list);
  return record;
}

export async function deleteSocialComment(commentId, { viewerId = null } = {}) {
  const resolvedViewerId = await resolveCurrentViewerId(viewerId);
  const list = await readSocialList(SOCIAL_META_KEYS.comments);
  const target = list.find((c) => c.id === commentId);
  if (!target) return false;
  if (
    resolvedViewerId &&
    target.authorId !== resolvedViewerId &&
    target.ownerProfileId !== resolvedViewerId
  ) {
    throw new BackendError('Sem permissão.', {
      code: 'FORBIDDEN',
      userMessage: 'Você não tem permissão para remover este comentário.',
    });
  }
  await writeSocialList(
    SOCIAL_META_KEYS.comments,
    list.filter((c) => c.id !== commentId)
  );
  return true;
}

function mapSqlDirectMessage(row = {}) {
  return {
    id: row.id,
    senderId: row.sender_id ?? row.senderId,
    recipientId: row.recipient_id ?? row.recipientId,
    content: String(row.content || ''),
    attachedWorkSnapshot: row.attached_work_snapshot ?? row.attachedWorkSnapshot ?? null,
    readAt: row.read_at ?? row.readAt ?? null,
    createdAt: row.created_at ?? row.createdAt ?? new Date().toISOString(),
  };
}

function sortMessagesChronologically(messages = []) {
  return [...messages].sort((a, b) => {
    const tA = Date.parse(a?.createdAt || '') || 0;
    const tB = Date.parse(b?.createdAt || '') || 0;
    if (tA !== tB) return tA - tB;
    return String(a?.id || '').localeCompare(String(b?.id || ''));
  });
}

async function fetchAndMergeRemoteMessages(resolvedViewerId, localMessages) {
  if (getBackendMode() !== 'supabase' || !resolvedViewerId) {
    return localMessages;
  }
  const session = await ensureFreshSupabaseSession();
  if (!session?.access_token) return localMessages;

  try {
    const rows = await supabaseFetchJson(
      `/rest/v1/direct_messages?or=(sender_id.eq.${encodeURIComponent(
        resolvedViewerId
      )},recipient_id.eq.${encodeURIComponent(resolvedViewerId)})&order=created_at.asc&limit=200`,
      { token: session.access_token }
    );
    if (!Array.isArray(rows)) return localMessages;
    const byId = new Map(localMessages.map((m) => [m.id, m]));
    for (const r of rows) {
      const mapped = mapSqlDirectMessage(r);
      if (mapped.id) byId.set(mapped.id, mapped);
    }
    return sortMessagesChronologically(Array.from(byId.values()));
  } catch {
    return localMessages;
  }
}

export async function listDirectConversations({ viewerId = null } = {}) {
  const resolvedViewerId = await resolveCurrentViewerId(viewerId);
  if (!resolvedViewerId) return [];

  const localMessages = await readSocialList(SOCIAL_META_KEYS.messages);
  const messages = await fetchAndMergeRemoteMessages(resolvedViewerId, localMessages);
  const allEntries = await getAllLocalProfilesWithWorkspaces();
  const profileMap = new Map(allEntries.map((e) => [e.profile.id, e.profile]));

  const convMap = new Map();
  for (const msg of messages) {
    if (msg.senderId !== resolvedViewerId && msg.recipientId !== resolvedViewerId) {
      continue;
    }
    const peerId = msg.senderId === resolvedViewerId ? msg.recipientId : msg.senderId;
    const prev = convMap.get(peerId) || {
      peerId,
      peerProfile: profileMap.get(peerId) || null,
      lastMessage: null,
      unreadCount: 0,
    };

    if (msg.recipientId === resolvedViewerId && !msg.readAt) {
      prev.unreadCount += 1;
    }
    if (
      !prev.lastMessage ||
      (Date.parse(msg.createdAt || '') || 0) >=
        (Date.parse(prev.lastMessage.createdAt || '') || 0)
    ) {
      prev.lastMessage = msg;
    }
    convMap.set(peerId, prev);
  }

  return Array.from(convMap.values()).sort(
    (a, b) =>
      (Date.parse(b.lastMessage?.createdAt || '') || 0) -
      (Date.parse(a.lastMessage?.createdAt || '') || 0)
  );
}

export async function listDirectMessages(peerId, { viewerId = null } = {}) {
  const resolvedViewerId = await resolveCurrentViewerId(viewerId);
  if (!resolvedViewerId || !peerId) return [];

  const localMessages = await readSocialList(SOCIAL_META_KEYS.messages);
  const messages = await fetchAndMergeRemoteMessages(resolvedViewerId, localMessages);
  return sortMessagesChronologically(
    messages.filter(
      (m) =>
        (m.senderId === resolvedViewerId && m.recipientId === peerId) ||
        (m.senderId === peerId && m.recipientId === resolvedViewerId)
    )
  );
}

export async function markConversationRead(peerId, { viewerId = null } = {}) {
  const resolvedViewerId = await resolveCurrentViewerId(viewerId);
  if (!resolvedViewerId || !peerId) return 0;

  const messages = await readSocialList(SOCIAL_META_KEYS.messages);
  const nowIso = new Date().toISOString();
  let changed = 0;

  const next = messages.map((m) => {
    if (m.senderId === peerId && m.recipientId === resolvedViewerId && !m.readAt) {
      changed += 1;
      return { ...m, readAt: nowIso };
    }
    return m;
  });

  if (changed > 0) {
    await writeSocialList(SOCIAL_META_KEYS.messages, next);
  }

  if (getBackendMode() === 'supabase') {
    const session = await ensureFreshSupabaseSession();
    if (session?.access_token) {
      supabaseFetchJson(
        `/rest/v1/direct_messages?sender_id=eq.${encodeURIComponent(
          peerId
        )}&recipient_id=eq.${encodeURIComponent(resolvedViewerId)}&read_at=is.null`,
        {
          method: 'PATCH',
          token: session.access_token,
          body: { read_at: nowIso },
        }
      ).catch(() => {});
    }
  }
  return changed;
}

export async function getUnreadMessagesCount({ viewerId = null } = {}) {
  const resolvedViewerId = await resolveCurrentViewerId(viewerId);
  if (!resolvedViewerId) return 0;
  const messages = await readSocialList(SOCIAL_META_KEYS.messages);
  return messages.filter((m) => m.recipientId === resolvedViewerId && !m.readAt).length;
}

export async function sendDirectMessage({
  recipientId,
  content,
  attachedWorkSnapshot = null,
  viewerId = null,
}) {
  const cleanContent = String(content || '').trim();
  if (!cleanContent && !attachedWorkSnapshot) {
    throw new BackendError('Mensagem vazia.', {
      code: 'EMPTY_DM',
      userMessage: 'Digite uma mensagem ou anexe uma obra antes de enviar.',
    });
  }
  if (cleanContent.length > MAX_SOCIAL_MESSAGE_CHARS) {
    throw new BackendError('Mensagem excede o limite.', {
      code: 'DM_TOO_LONG',
      userMessage: `A mensagem não pode ultrapassar ${MAX_SOCIAL_MESSAGE_CHARS} caracteres.`,
    });
  }

  const resolvedViewerId = await resolveCurrentViewerId(viewerId);
  if (!resolvedViewerId || !recipientId) {
    throw new BackendError('Destinatário inválido.', {
      code: 'INVALID_RECIPIENT',
      userMessage: 'Selecione um leitor para conversar.',
    });
  }
  if (resolvedViewerId === recipientId) {
    throw new BackendError('Chat consigo mesmo.', {
      code: 'SELF_DM',
      userMessage: 'Selecione outro leitor para iniciar uma conversa.',
    });
  }

  const allEntries = await getAllLocalProfilesWithWorkspaces();
  const profileMap = new Map(allEntries.map((e) => [e.profile.id, e.profile]));
  const recipientProfile = profileMap.get(recipientId);

  if (recipientProfile) {
    const follows = await listFollowRelationships(resolvedViewerId);
    const isFollower = follows.some(
      (f) =>
        f.followerId === resolvedViewerId &&
        f.followingId === recipientId &&
        f.status === 'approved'
    );
    const perms = canInteractWithProfile(recipientProfile, {
      viewerId: resolvedViewerId,
      isFollower,
    });
    if (!perms.canSendDm) {
      throw new BackendError('Mensagens diretas desativadas.', {
        code: 'DMS_DISABLED',
        userMessage: 'Este leitor desativou ou restringiu o recebimento de mensagens.',
      });
    }
  }

  const sanitizedBook = attachedWorkSnapshot
    ? {
        id: attachedWorkSnapshot.id || createUuid(),
        title: String(attachedWorkSnapshot.title || 'Obra recomendada'),
        originalTitle: String(attachedWorkSnapshot.originalTitle || ''),
        author: String(attachedWorkSnapshot.author || ''),
        publisher: String(attachedWorkSnapshot.publisher || ''),
        isbn: String(attachedWorkSnapshot.isbn || ''),
        coverUrl: attachedWorkSnapshot.coverUrl || null,
        coverSources: Array.isArray(attachedWorkSnapshot.coverSources)
          ? attachedWorkSnapshot.coverSources
          : [],
        workType: attachedWorkSnapshot.workType || 'book',
        rating: attachedWorkSnapshot.rating ?? null,
      }
    : null;

  const messageRecord = {
    id: createUuid(),
    senderId: resolvedViewerId,
    recipientId,
    content: cleanContent || `Recomendo a leitura de "${sanitizedBook?.title}"`,
    attachedWorkSnapshot: sanitizedBook,
    readAt: null,
    createdAt: new Date().toISOString(),
  };

  if (getBackendMode() === 'supabase') {
    const session = await ensureFreshSupabaseSession();
    if (session?.access_token) {
      try {
        await supabaseFetchJson('/rest/v1/direct_messages', {
          method: 'POST',
          token: session.access_token,
          body: {
            id: messageRecord.id,
            sender_id: resolvedViewerId,
            recipient_id: recipientId,
            content: messageRecord.content,
            attached_work_snapshot: sanitizedBook,
          },
        });
      } catch {
        // Fallback em espelho local
      }
    }
  }

  const list = await readSocialList(SOCIAL_META_KEYS.messages);
  list.push(messageRecord);
  await writeSocialList(SOCIAL_META_KEYS.messages, list);
  return messageRecord;
}

export function subscribeDirectMessagesRealtime({ viewerId = null, onMessage } = {}) {
  if (getBackendMode() !== 'supabase' || !viewerId || typeof onMessage !== 'function') {
    return () => {};
  }
  const cfg = getSupabaseConfig();
  const session = loadStoredSupabaseSession();
  if (!cfg.configured || !session?.access_token) {
    return () => {};
  }

  let closed = false;
  let socket = null;
  let heartbeatTimer = null;
  let refCounter = 1;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (socket) {
      try {
        if (socket.readyState === 1) {
          socket.send(
            JSON.stringify({
              topic: 'realtime:public:direct_messages',
              event: 'phx_leave',
              payload: {},
              ref: String(refCounter++),
            })
          );
        }
        socket.close();
      } catch {
        // Ignora erro ao encerrar socket
      }
      socket = null;
    }
  };

  if (typeof WebSocket === 'undefined') {
    return cleanup;
  }

  try {
    const wsUrl = new URL('/realtime/v1/websocket', cfg.url);
    wsUrl.protocol = wsUrl.protocol === 'http:' ? 'ws:' : 'wss:';
    wsUrl.search = new URLSearchParams({
      apikey: cfg.anonKey,
      vsn: '1.0.0',
    }).toString();

    socket = new WebSocket(wsUrl.toString());
    socket.onopen = () => {
      if (closed || !socket) return;
      socket.send(
        JSON.stringify({
          topic: 'realtime:public:direct_messages',
          event: 'phx_join',
          payload: {
            config: {
              postgres_changes: [
                {
                  event: 'INSERT',
                  schema: 'public',
                  table: 'direct_messages',
                },
              ],
            },
            access_token: session.access_token,
          },
          ref: String(refCounter++),
        })
      );

      heartbeatTimer = setInterval(() => {
        if (closed || !socket || socket.readyState !== 1) return;
        try {
          socket.send(
            JSON.stringify({
              topic: 'phoenix',
              event: 'heartbeat',
              payload: {},
              ref: String(refCounter++),
            })
          );
        } catch {
          // Ignora heartbeat em desconexão
        }
      }, 25000);
    };

    socket.onmessage = (event) => {
      if (closed) return;
      try {
        const frame = JSON.parse(event?.data || '{}');
        const record =
          frame?.event === 'postgres_changes'
            ? frame?.payload?.data?.record || frame?.payload?.record
            : null;
        if (!record) return;
        const mapped = mapSqlDirectMessage(record);
        if (mapped.senderId === viewerId || mapped.recipientId === viewerId) {
          onMessage(mapped);
        }
      } catch {
        // Frame ignorado
      }
    };

    socket.onerror = () => {
      // Sem erro fatal na UI; apenas limpa se fechar
    };
  } catch {
    return cleanup;
  }

  return cleanup;
}

export function parseInviteHandleParam(rawInvite) {
  const trimmed = String(rawInvite || '').trim();
  if (!trimmed || !INVITE_HANDLE_REGEX.test(trimmed)) {
    return null;
  }
  return `@${trimmed.replace(/^@+/, '').toLowerCase()}`;
}

export function buildInviteShareUrl(handle, baseOriginUrl = null) {
  const normalized = normalizeHandle(handle, 'leitor');
  let base = String(baseOriginUrl || '').trim();
  if (!base && typeof window !== 'undefined' && window.location) {
    base = `${window.location.origin}${window.location.pathname}`;
  }
  if (!base) base = 'https://codice.app/';
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}invite=${encodeURIComponent(normalized)}`;
}

export async function listLocalInviteContacts() {
  return readSocialList(SOCIAL_META_KEYS.localContacts);
}

export async function resolveInviteProfile(rawInvite, { viewerId = null } = {}) {
  const validHandle = parseInviteHandleParam(rawInvite);
  if (!validHandle) return null;

  const resolvedViewerId = await resolveCurrentViewerId(viewerId);
  const follows = await listFollowRelationships(resolvedViewerId);
  const allEntries = await getAllLocalProfilesWithWorkspaces();
  const localMatch = allEntries.find(
    (e) => String(e.profile?.handle || '').toLowerCase() === validHandle
  );

  if (localMatch) {
    const p = localMatch.profile;
    const rel = follows.find(
      (f) => f.followerId === resolvedViewerId && f.followingId === p.id
    );
    return {
      id: p.id,
      handle: p.handle,
      displayName: p.displayName || p.handle.slice(1),
      avatarUrl: p.avatarUrl || '',
      avatarInitials: p.avatarInitials || buildInitials(p.displayName || p.handle),
      isLocalContact: false,
      followStatus: rel ? rel.status : 'none',
      isSelf: Boolean(resolvedViewerId && p.id === resolvedViewerId),
    };
  }

  if (getBackendMode() === 'supabase') {
    const cfg = getSupabaseConfig();
    const session = await ensureFreshSupabaseSession();
    const token = session?.access_token || cfg.anonKey;
    if (cfg.configured && token) {
      try {
        const rows = await supabaseFetchJson(
          `/rest/v1/profiles?handle=eq.${encodeURIComponent(
            validHandle
          )}&select=id,handle,display_name,avatar_url,avatar_initials&limit=1`,
          { token }
        );
        if (Array.isArray(rows) && rows[0]) {
          const pub = rows[0];
          const rel = follows.find(
            (f) => f.followerId === resolvedViewerId && f.followingId === pub.id
          );
          return {
            id: pub.id,
            handle: normalizeHandle(pub.handle),
            displayName: String(pub.display_name || validHandle.slice(1)),
            avatarUrl: String(pub.avatar_url || ''),
            avatarInitials:
              pub.avatar_initials || buildInitials(pub.display_name || validHandle),
            isLocalContact: false,
            followStatus: rel ? rel.status : 'none',
            isSelf: Boolean(resolvedViewerId && pub.id === resolvedViewerId),
          };
        }
      } catch {
        // Fallback em contato local abaixo
      }
    }
  }

  // Sem Supabase (ou offline/não encontrado): importa apenas campos públicos e salva contato local
  const cleanName = validHandle.replace(/^@+/, '');
  const contactCard = {
    id: `contact:${cleanName}`,
    handle: validHandle,
    displayName: cleanName,
    avatarUrl: '',
    avatarInitials: buildInitials(cleanName),
    isLocalContact: true,
    followStatus: 'none',
    isSelf: false,
    savedAt: new Date().toISOString(),
  };

  const contacts = await readSocialList(SOCIAL_META_KEYS.localContacts);
  const existingIdx = contacts.findIndex(
    (c) => String(c.handle || '').toLowerCase() === validHandle
  );
  if (existingIdx >= 0) {
    contacts[existingIdx] = { ...contacts[existingIdx], ...contactCard };
  } else {
    contacts.unshift(contactCard);
  }
  await writeSocialList(SOCIAL_META_KEYS.localContacts, contacts);
  return contactCard;
}

export async function getFollowSummaryLists(targetProfileId, { viewerId = null } = {}) {
  if (!targetProfileId) return { followers: [], following: [] };
  const [follows, allEntries, contacts] = await Promise.all([
    listFollowRelationships(viewerId || targetProfileId),
    getAllLocalProfilesWithWorkspaces(),
    listLocalInviteContacts(),
  ]);
  const profileMap = new Map(allEntries.map((e) => [e.profile.id, e.profile]));
  for (const c of contacts) {
    if (c?.id && !profileMap.has(c.id)) profileMap.set(c.id, c);
  }

  const followers = follows
    .filter((f) => f.followingId === targetProfileId && f.status === 'approved')
    .map(
      (f) =>
        profileMap.get(f.followerId) || {
          id: f.followerId,
          handle: '@leitor',
          displayName: 'Leitor',
          avatarInitials: 'LC',
        }
    );

  const following = follows
    .filter((f) => f.followerId === targetProfileId && f.status === 'approved')
    .map(
      (f) =>
        profileMap.get(f.followingId) || {
          id: f.followingId,
          handle: '@leitor',
          displayName: 'Leitor',
          avatarInitials: 'LC',
        }
    );

  return { followers, following };
}
