/**
 * Agrupador de consultas AniList GraphQL usando aliases em uma única requisição (D4).
 * Módulo puro em .js (D7).
 */

import { apiRequest } from './httpClient.js';
import { API_TIMEOUT_MS } from './limits.js';

export const ANILIST_GRAPHQL_URL = 'https://graphql.anilist.co';
const ANILIST_BATCH_CHUNK_SIZE = 20;
const MICRO_BATCH_WINDOW_MS = 15;

const ANILIST_MEDIA_SELECTION = `
  id
  idMal
  type
  format
  status
  episodes
  duration
  seasonYear
  startDate { year month day }
  averageScore
  genres
  bannerImage
  description(asHtml: false)
  title { romaji english native }
  coverImage { extraLarge large medium }
  studios(isMain: true) { nodes { name } }
  externalLinks { site type }
  nextAiringEpisode { episode airingAt timeUntilAiring }
  relations {
    edges {
      relationType
      node {
        id
        idMal
        type
        format
        status
        episodes
        seasonYear
        title { romaji english native }
        coverImage { large medium }
      }
    }
  }
`;

export function buildAniListAliasQuery(ids = []) {
  const cleanIds = Array.from(
    new Set(
      (Array.isArray(ids) ? ids : [])
        .map((id) => Number(id))
        .filter((n) => Number.isInteger(n) && n > 0)
    )
  );

  if (cleanIds.length === 0) return null;

  const varDefs = cleanIds.map((_, idx) => `$id_${idx}: Int`).join(', ');
  const fields = cleanIds
    .map(
      (_, idx) => `m_${idx}: Media(id: $id_${idx}, type: ANIME) { ${ANILIST_MEDIA_SELECTION} }`
    )
    .join('\n');

  const variables = {};
  cleanIds.forEach((id, idx) => {
    variables[`id_${idx}`] = id;
  });

  return {
    ids: cleanIds,
    query: `query (${varDefs}) {\n${fields}\n}`,
    variables,
  };
}

/**
 * Busca múltiplos IDs da AniList agrupando até 20 IDs por request GraphQL com aliases.
 * Retorna Map<anilistId, rawMedia|null>.
 */
export async function fetchAniListBatchByIds(
  ids = [],
  {
    signal = undefined,
    fetchImpl = fetch,
    timeoutMs = API_TIMEOUT_MS,
    nowFn = Date.now,
    sleepFn = undefined,
  } = {}
) {
  const cleanIds = Array.from(
    new Set(
      (Array.isArray(ids) ? ids : [])
        .map((id) => Number(id))
        .filter((n) => Number.isInteger(n) && n > 0)
    )
  );

  const resultMap = new Map();
  if (cleanIds.length === 0) return resultMap;

  for (let start = 0; start < cleanIds.length; start += ANILIST_BATCH_CHUNK_SIZE) {
    const chunk = cleanIds.slice(start, start + ANILIST_BATCH_CHUNK_SIZE);
    const built = buildAniListAliasQuery(chunk);
    if (!built) continue;

    const payload = JSON.stringify({
      query: built.query,
      variables: built.variables,
    });

    const res = await apiRequest(ANILIST_GRAPHQL_URL, {
      provider: 'anilist',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: payload,
      dedupKey: `anilist:batch:${chunk.join(',')}`,
      signal,
      fetchImpl,
      timeoutMs,
      nowFn,
      ...(sleepFn ? { sleepFn } : {}),
    });

    if (!res.ok) {
      throw new Error(`AniList HTTP ${res.status}`);
    }

    const json = await res.json();
    const data = json?.data || {};
    built.ids.forEach((id, idx) => {
      resultMap.set(id, data[`m_${idx}`] || null);
    });
  }

  return resultMap;
}

const pendingMicroBatch = [];
let microBatchTimer = null;

/**
 * Enfileira uma busca individual por ID AniList e agrupa automaticamente
 * chamadas ocorridas dentro de 15ms em um único request GraphQL com aliases.
 */
export function enqueueAniListMediaById(
  anilistId,
  options = {}
) {
  const numId = Number(anilistId);
  if (!Number.isInteger(numId) || numId <= 0) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    pendingMicroBatch.push({ id: numId, options, resolve, reject });
    if (!microBatchTimer) {
      microBatchTimer = setTimeout(async () => {
        const batch = pendingMicroBatch.splice(0, pendingMicroBatch.length);
        microBatchTimer = null;
        if (batch.length === 0) return;

        const firstOpts = batch[0].options || {};
        try {
          const map = await fetchAniListBatchByIds(
            batch.map((b) => b.id),
            {
              fetchImpl: firstOpts.fetchImpl || fetch,
              timeoutMs: firstOpts.timeoutMs || API_TIMEOUT_MS,
              nowFn: firstOpts.nowFn || Date.now,
              sleepFn: firstOpts.sleepFn,
            }
          );
          batch.forEach((item) => item.resolve(map.get(item.id) || null));
        } catch (err) {
          batch.forEach((item) => item.reject(err));
        }
      }, MICRO_BATCH_WINDOW_MS);
    }
  });
}
