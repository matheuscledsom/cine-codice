/**
 * Relação separada `editionOf` para Livros (v2.5.0 Fase A).
 *
 * Regras:
 * - Nunca usar 'edition' em `franchiseTier`: edição é modelada por `editionOf` (id da obra base).
 * - Edições contam nas estatísticas do autor (total de obras/edições catalogadas e lidas).
 * - Atualizar, concluir ou alterar uma edição NUNCA altera o progresso da obra base.
 */

import { inferDomainFromWork } from '../config/domainConfig.js';

function normalizeAuthorKey(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

export function getEditionBaseWorkId(work) {
  if (!work || typeof work !== 'object') return '';
  const raw = work.editionOf ?? work.progress_data?.editionOf ?? '';
  const clean = String(raw || '').trim();
  if (!clean) return '';
  if (work.id && clean === String(work.id)) return '';
  return clean;
}

export function isBookEdition(work) {
  return Boolean(getEditionBaseWorkId(work));
}

export function findEditionsOfWork(baseWorkId, items = []) {
  const cleanBaseId = String(baseWorkId || '').trim();
  if (!cleanBaseId) return [];
  return (Array.isArray(items) ? items : []).filter((entry) => {
    if (!entry || entry.inBacklog === false) return false;
    if (String(entry.id) === cleanBaseId) return false;
    return getEditionBaseWorkId(entry) === cleanBaseId;
  });
}

export function resolveBaseWorkForEdition(editionWork, items = []) {
  const baseId = getEditionBaseWorkId(editionWork);
  if (!baseId) return null;
  return (
    (Array.isArray(items) ? items : []).find(
      (entry) => entry && entry.inBacklog !== false && String(entry.id) === baseId
    ) || null
  );
}

/**
 * Monta patch aditivo SOMENTE para a edição vinculada.
 * Evita auto-referência e ciclos (não permite apontar para uma obra que já é edição desta).
 */
export function buildEditionLinkPatch(editionWork, baseWorkId, allItems = []) {
  if (!editionWork || !editionWork.id) return null;
  const cleanBaseId = String(baseWorkId || '').trim();
  if (!cleanBaseId) {
    return {
      editionOf: null,
      progress_data: {
        ...(editionWork.progress_data && typeof editionWork.progress_data === 'object'
          ? editionWork.progress_data
          : {}),
        editionOf: null,
      },
    };
  }

  if (cleanBaseId === String(editionWork.id)) return null;

  // Bloqueia ciclo direto: se o alvo já é edição de editionWork, recusa
  const target = (Array.isArray(allItems) ? allItems : []).find(
    (w) => w && String(w.id) === cleanBaseId
  );
  if (target && getEditionBaseWorkId(target) === String(editionWork.id)) {
    return null;
  }

  return {
    editionOf: cleanBaseId,
    progress_data: {
      ...(editionWork.progress_data && typeof editionWork.progress_data === 'object'
        ? editionWork.progress_data
        : {}),
      editionOf: cleanBaseId,
    },
  };
}

/**
 * Atualiza uma edição no array local garantindo imutabilidade absoluta da obra base.
 */
export function applyEditionUpdatePreservingBase(items = [], editionId, patch = {}) {
  const targetId = String(editionId || '');
  if (!targetId) return Array.isArray(items) ? items : [];
  return (Array.isArray(items) ? items : []).map((entry) => {
    if (!entry || String(entry.id) !== targetId) return entry;
    return {
      ...entry,
      ...patch,
      progress_data: {
        ...(entry.progress_data && typeof entry.progress_data === 'object'
          ? entry.progress_data
          : {}),
        ...(patch.progress_data && typeof patch.progress_data === 'object'
          ? patch.progress_data
          : {}),
      },
    };
  });
}

/**
 * Estatísticas do autor incluindo edições catalogadas (`editionOf`),
 * preservando a contagem separada de obras base e edições.
 */
export function computeAuthorStatsWithEditions(items = [], authorName = '') {
  const targetNorm = normalizeAuthorKey(authorName);
  const readingWorks = (Array.isArray(items) ? items : []).filter(
    (w) => w && w.inBacklog !== false && inferDomainFromWork(w) === 'reading'
  );

  const matched = targetNorm
    ? readingWorks.filter((w) => {
        const authors = [w.creator, w.author, w.director]
          .filter(Boolean)
          .join(',')
          .split(/[,;]/)
          .map((s) => normalizeAuthorKey(s))
          .filter(Boolean);
        return authors.some((a) => a === targetNorm || a.includes(targetNorm));
      })
    : readingWorks;

  const editions = matched.filter((w) => isBookEdition(w));
  const baseWorks = matched.filter((w) => !isBookEdition(w));
  const completedCount = matched.filter((w) => w.status === 'completed').length;
  const totalPagesRead = matched.reduce(
    (acc, w) =>
      acc +
      (w.status === 'completed'
        ? Math.max(Number(w.pagesRead) || 0, Number(w.totalPages) || 0)
        : Math.max(0, Number(w.pagesRead) || 0)),
    0
  );

  return {
    authorName: String(authorName || '').trim(),
    totalWorks: matched.length,
    baseWorksCount: baseWorks.length,
    editionsCount: editions.length,
    completedWorks: completedCount,
    totalPagesRead,
    works: matched,
  };
}
