/**
 * Extração e busca local de Entidades (Autor, Diretor, Elenco/Ator, Estúdio, Banda/Artista)
 * para a Página/Folha de Entidade (v2.4.0 Fase 4.4).
 */

import { inferDomainFromWork, normalizeDomainId } from '../config/domainConfig.js';
import { resolveWorkRatingState, score100ToStars } from './ratingModel.js';

export const ENTITY_ROLE_LABELS = Object.freeze({
  author: 'Autor(a)',
  director: 'Direção',
  actor: 'Elenco',
  studio: 'Estúdio',
  artist: 'Banda / Artista',
});

function normalizeName(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

export function splitEntityNames(rawValue, max = 8) {
  const clean = String(rawValue || '').trim();
  if (!clean) return [];
  const parts = clean.includes(';') ? clean.split(';') : clean.split(',');
  const seen = new Set();
  const out = [];
  for (const part of parts) {
    const trimmed = part.trim();
    const norm = normalizeName(trimmed);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(trimmed);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Extrai entidades clicáveis de uma obra de acordo com o seu domínio.
 */
export function extractWorkEntities(work = {}) {
  if (!work || typeof work !== 'object') return [];
  const domain = inferDomainFromWork(work);
  const entities = [];
  const seenKey = new Set();

  const pushNames = (raw, role) => {
    for (const name of splitEntityNames(raw, role === 'actor' ? 8 : 4)) {
      const k = `${role}:${normalizeName(name)}`;
      if (seenKey.has(k)) continue;
      seenKey.add(k);
      entities.push({
        name,
        role,
        roleLabel: ENTITY_ROLE_LABELS[role] || role,
        domain,
      });
    }
  };

  if (domain === 'reading') {
    pushNames(work.creator || work.author || work.director, 'author');
    if (work.studio) pushNames(work.studio, 'studio');
  } else if (domain === 'games') {
    pushNames(work.studio || work.creator || work.director, 'studio');
  } else if (domain === 'music') {
    pushNames(work.creator || work.artist || work.director, 'artist');
  } else {
    // Cinema / Séries / Animes
    pushNames(work.director || work.creator, 'director');
    if (work.studio) pushNames(work.studio, 'studio');
    if (work.cast) pushNames(work.cast, 'actor');
  }

  return entities;
}

/**
 * Localiza obras já catalogadas no acervo ligadas à entidade selecionada.
 */
export function findCatalogWorksForEntity(
  items = [],
  { name = '', role = '', domain = 'all' } = {}
) {
  const targetNorm = normalizeName(name);
  if (!targetNorm) {
    return {
      works: [],
      stats: { total: 0, completed: 0, averageStars: null },
    };
  }

  const filterDomain = domain && domain !== 'all' ? normalizeDomainId(domain) : null;
  const matched = [];

  for (const work of Array.isArray(items) ? items : []) {
    if (!work || work.inBacklog === false) continue;
    const wDomain = inferDomainFromWork(work);
    if (filterDomain && wDomain !== filterDomain) continue;

    const fieldsToCheck =
      role === 'actor'
        ? [work.cast]
        : role === 'studio'
          ? [work.studio, work.creator, work.director]
          : [work.creator, work.director, work.author, work.artist, work.studio, work.cast];

    const namesInWork = fieldsToCheck.flatMap((f) => splitEntityNames(f, 20));
    const isHit = namesInWork.some((candidate) => {
      const normCand = normalizeName(candidate);
      return normCand === targetNorm || normCand.includes(targetNorm) || targetNorm.includes(normCand);
    });

    if (isHit) {
      matched.push(work);
    }
  }

  matched.sort((a, b) => (Number(b.releaseYear) || 0) - (Number(a.releaseYear) || 0));

  const ratedScores = matched
    .map((w) => resolveWorkRatingState(w))
    .filter((st) => st.hasConfirmedRating && st.score100 !== null)
    .map((st) => st.score100);

  const avgScore100 =
    ratedScores.length > 0
      ? Math.round(ratedScores.reduce((acc, s) => acc + s, 0) / ratedScores.length)
      : null;

  return {
    works: matched,
    stats: {
      total: matched.length,
      completed: matched.filter((w) => w.status === 'completed').length,
      averageStars: avgScore100 !== null ? score100ToStars(avgScore100) : null,
    },
  };
}
