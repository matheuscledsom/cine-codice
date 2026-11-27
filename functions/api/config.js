import {
  isAllowedSameOriginRequest,
  jsonResponse,
  methodNotAllowedResponse,
  readServerEnvConfig,
} from '../_lib/proxyCore.js';

const PRIVILEGED_ROLE_NAME = ['service', 'role'].join('_');

function decodeBase64UrlToUtf8(segment) {
  const normalized = String(segment || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  if (typeof atob === 'function') {
    return atob(padded);
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(padded, 'base64').toString('utf8');
  }
  return '';
}

export function isUnsafeServerSupabaseKey(rawKey) {
  const clean = String(rawKey || '').trim();
  if (!clean) return false;
  if (clean.toLowerCase().includes(PRIVILEGED_ROLE_NAME) || /^sb_secret_/i.test(clean)) {
    return true;
  }
  const parts = clean.split('.');
  if (parts.length === 3) {
    try {
      const decoded = JSON.parse(decodeBase64UrlToUtf8(parts[1]));
      if (decoded?.role === PRIVILEGED_ROLE_NAME) {
        return true;
      }
    } catch {
      // JWT opaco ou não-JSON: não bloqueia chave publishable/anon
    }
  }
  return false;
}

/**
 * Rota pública de auto-configuração do OmniPrism.
 * Devolve EXCLUSIVAMENTE `{ supabaseUrl, supabaseAnonKey }` (ambos públicos por desenho,
 * protegidos por RLS no Supabase). Nunca devolve chaves secretas ou privilegiadas.
 */
export async function handleConfigRequest(context) {
  const { request, env } = context || {};
  if (request?.method !== 'GET') {
    return methodNotAllowedResponse();
  }

  if (!isAllowedSameOriginRequest(request)) {
    return jsonResponse(
      { error: 'Origem não autorizada para consultar a configuração do aplicativo.' },
      403
    );
  }

  const cfg = readServerEnvConfig(env);
  const supabaseUrl = String(cfg.supabaseUrl || '').trim();
  const supabaseAnonKey = String(cfg.supabaseAnonKey || '').trim();

  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonResponse(
      {
        error:
          'Configuração automática do Supabase indisponível no servidor. Verifique SUPABASE_URL e SUPABASE_ANON_KEY.',
      },
      503,
      { 'Cache-Control': 'no-store' }
    );
  }

  if (isUnsafeServerSupabaseKey(supabaseAnonKey)) {
    return jsonResponse(
      {
        error:
          'Chave privilegiada detectada na variável do servidor. Configure apenas a chave pública (anon / publishable).',
      },
      503,
      { 'Cache-Control': 'no-store' }
    );
  }

  return jsonResponse(
    {
      supabaseUrl,
      supabaseAnonKey,
    },
    200,
    {
      'Cache-Control': 'private, max-age=300',
      Vary: 'Origin',
    }
  );
}

export async function onRequest(context) {
  return handleConfigRequest(context);
}
