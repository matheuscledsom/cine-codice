/**
 * Profundidade Real de Games (v2.5.0 Fase C).
 *
 * Regras:
 * - Os novos campos ficam SOMENTE na ficha da obra em "Mais detalhes" (folha rápida de catalogar segue enxuta).
 * - "Tempo médio de campanha" vindo do RAWG é a média dos usuários do RAWG, NÃO do HowLongToBeat:
 *   a fonte é sempre rotulada explicitamente ("RAWG (média dos usuários do RAWG)").
 * - "Tempo 100%" só exibe valor automático se houver fonte explícita; caso contrário permanece editável pelo usuário
 *   e nunca é inventado a partir do tempo de campanha.
 * - Franquia em Games: vínculo manual com sugestão (nunca altera a obra automaticamente sem confirmação).
 */

import { inferDomainFromWork } from '../config/domainConfig.js';

export const RAWG_CAMPAIGN_TIME_SOURCE_LABEL = 'RAWG (média dos usuários do RAWG)';

const EDITION_SUFFIX_RE =
  /\b(remake|remastered|definitive\s+edition|goty|game\s+of\s+the\s+year|complete\s+edition|director'?s\s+cut|hd|anniversary\s+edition|ultimate\s+edition|royal|golden|expanded)\b/gi;

const TRAILING_NUMERAL_RE =
  /\s+(?:(?:\d{1,2})|(?:ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii|xiii|xiv|xv|xvi))$/i;

function normalizeGameKey(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function extractGameFranchiseHintFromTitle(rawTitle = '') {
  let clean = String(rawTitle || '').trim();
  if (!clean) return '';

  // Remove sufixos entre parênteses como (2018) ou (PS5)
  clean = clean.replace(/\s*\([^)]*\)\s*/g, ' ').trim();

  // Remove subtítulo após ":" ou " - " ou " – "
  if (clean.includes(':')) {
    clean = clean.split(':')[0].trim();
  } else if (/\s[-–—]\s/.test(clean)) {
    clean = clean.split(/\s[-–—]\s/)[0].trim();
  }

  // Remove sufixos de edição e numerais de sequência no fim
  clean = clean.replace(EDITION_SUFFIX_RE, '').replace(/\s+/g, ' ').trim();
  clean = clean.replace(TRAILING_NUMERAL_RE, '').trim();

  return clean.length >= 3 ? clean : '';
}

/**
 * Converte resposta do RAWG (`/api/rawg/games/{id}`) para metadados transparentes.
 * Nunca inventa `completion100Hours` (RAWG não fornece tempo de 100%).
 */
export function parseRawgGameMetadata(rawgGame = null) {
  if (!rawgGame || typeof rawgGame !== 'object') return null;

  const rawgId = Number(rawgGame.id) > 0 ? Math.floor(Number(rawgGame.id)) : null;
  const rawgSlug = String(rawgGame.slug || '').trim() || null;
  const rawPlaytime = Number(rawgGame.playtime);
  const rawgPlaytimeHours =
    Number.isFinite(rawPlaytime) && rawPlaytime > 0
      ? Math.round(rawPlaytime * 10) / 10
      : null;

  const metacritic =
    Number.isFinite(Number(rawgGame.metacritic)) && Number(rawgGame.metacritic) > 0
      ? Math.round(Number(rawgGame.metacritic))
      : null;

  const platforms = Array.isArray(rawgGame.platforms)
    ? rawgGame.platforms
        .map((p) => String(p?.platform?.name || p?.name || '').trim())
        .filter(Boolean)
    : [];

  const developers = Array.isArray(rawgGame.developers)
    ? rawgGame.developers.map((d) => String(d?.name || '').trim()).filter(Boolean)
    : [];

  const publishers = Array.isArray(rawgGame.publishers)
    ? rawgGame.publishers.map((p) => String(p?.name || '').trim()).filter(Boolean)
    : [];

  const title = String(rawgGame.name || '').trim();

  return {
    rawgId,
    rawgSlug,
    title,
    rawgPlaytimeHours,
    rawgPlaytimeSource: rawgPlaytimeHours !== null ? RAWG_CAMPAIGN_TIME_SOURCE_LABEL : null,
    // RAWG não informa tempo 100%: jamais inventar estimativa
    completion100Hours: null,
    completion100Source: null,
    metacritic,
    platforms,
    developers,
    publishers,
    released: String(rawgGame.released || '').trim() || null,
    franchiseSuggestionHint: extractGameFranchiseHintFromTitle(title),
  };
}

/**
 * Formata "Tempo médio de campanha" com rotulagem obrigatória da fonte.
 */
export function formatGameCampaignTime(work = {}) {
  if (!work || typeof work !== 'object') return null;

  const rawgHours = Number(work.rawgPlaytimeHours ?? work.progress_data?.rawgPlaytimeHours);
  if (Number.isFinite(rawgHours) && rawgHours > 0) {
    const cleanHours = Math.round(rawgHours * 10) / 10;
    const sourceLabel =
      String(work.rawgPlaytimeSource || work.progress_data?.rawgPlaytimeSource || '').trim() ||
      RAWG_CAMPAIGN_TIME_SOURCE_LABEL;
    return {
      hours: cleanHours,
      label: `${cleanHours} h`,
      sourceLabel,
      isFromRawg: true,
    };
  }

  const manualHours = Number(work.manualCampaignHours ?? work.progress_data?.manualCampaignHours);
  if (Number.isFinite(manualHours) && manualHours > 0) {
    const cleanHours = Math.round(manualHours * 10) / 10;
    return {
      hours: cleanHours,
      label: `${cleanHours} h`,
      sourceLabel: 'Informado manualmente',
      isFromRawg: false,
    };
  }

  return null;
}

/**
 * Formata "Tempo 100%": só exibe fonte externa se existir; senão informa que é editável manualmente.
 */
export function formatGameCompletion100Time(work = {}) {
  if (!work || typeof work !== 'object') {
    return {
      hours: null,
      label: 'Sem fonte automática',
      sourceLabel: 'Editável em Mais detalhes',
      hasExternalSource: false,
      editable: true,
    };
  }

  const rawHours = Number(work.completion100Hours ?? work.progress_data?.completion100Hours);
  const rawSource = String(
    work.completion100Source ?? work.progress_data?.completion100Source ?? ''
  ).trim();

  if (Number.isFinite(rawHours) && rawHours > 0) {
    const cleanHours = Math.round(rawHours * 10) / 10;
    const hasExternalSource = Boolean(rawSource && rawSource.toLowerCase() !== 'manual');
    return {
      hours: cleanHours,
      label: `${cleanHours} h`,
      sourceLabel: hasExternalSource
        ? `Fonte: ${rawSource}`
        : 'Editado manualmente',
      hasExternalSource,
      editable: true,
    };
  }

  return {
    hours: null,
    label: 'Sem fonte automática',
    sourceLabel: 'Editável manualmente',
    hasExternalSource: false,
    editable: true,
  };
}

/**
 * Sugestão de vínculo manual de franquia para Games (sem alterar nada automaticamente).
 * Cruza o título do jogo com franquias e outros jogos já presentes no catálogo local.
 */
export function suggestGameFranchiseLink(work = {}, allItems = []) {
  if (!work || typeof work !== 'object') {
    return {
      suggestedFranchiseName: '',
      relatedGames: [],
      isSuggestionOnly: true,
    };
  }

  const hint = extractGameFranchiseHintFromTitle(work.title || '');
  const normHint = normalizeGameKey(hint);
  const currentFranchise = String(work.franchiseName || '').trim();
  const normCurrent = normalizeGameKey(currentFranchise);

  const otherGames = (Array.isArray(allItems) ? allItems : []).filter(
    (entry) =>
      entry &&
      entry.inBacklog !== false &&
      String(entry.id) !== String(work.id) &&
      inferDomainFromWork(entry) === 'games'
  );

  // Tenta primeiro casar com uma franquia já cadastrada no catálogo do usuário
  let matchedExistingFranchise = '';
  const relatedGames = [];

  for (const cand of otherGames) {
    const candFranchise = String(cand.franchiseName || '').trim();
    const candFranchiseNorm = normalizeGameKey(candFranchise);
    const candHint = extractGameFranchiseHintFromTitle(cand.title || '');
    const candHintNorm = normalizeGameKey(candHint);

    const hitsByHint =
      Boolean(normHint) &&
      ((candHintNorm && candHintNorm === normHint) ||
        (candFranchiseNorm && candFranchiseNorm === normHint));

    const hitsByCurrent =
      Boolean(normCurrent) &&
      ((candFranchiseNorm && candFranchiseNorm === normCurrent) ||
        (candHintNorm && candHintNorm === normCurrent));

    if (hitsByHint || hitsByCurrent) {
      relatedGames.push(cand);
      if (!matchedExistingFranchise && candFranchise) {
        matchedExistingFranchise = candFranchise;
      }
    }
  }

  const suggestedFranchiseName =
    matchedExistingFranchise ||
    (relatedGames.length > 0 && hint ? hint : '') ||
    (!currentFranchise && hint && normalizeGameKey(work.title) !== normHint ? hint : '');

  return {
    suggestedFranchiseName,
    relatedGames,
    isSuggestionOnly: true,
  };
}
