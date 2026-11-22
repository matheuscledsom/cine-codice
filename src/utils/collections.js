import { hashFallbackPalette } from '../graphics/dominantColor.js';
import { escapeSvgText } from '../graphics/posterGenerator.js';

export const COLLECTIONS_STORAGE_KEY = 'cine_codice_custom_collections_v1';

export const COLLECTION_SUGGESTIONS = [
  'Animes Clássicos',
  'Terror Anos 80',
  'Para Ver no Fim de Semana',
  'Favoritos da Vida',
];

function createCollectionId() {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
    return `col-${globalThis.crypto.randomUUID().slice(0, 8)}`;
  }
  return `col-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function normalizeCollectionRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name || '').trim();
  if (!name) return null;
  return {
    id: String(raw.id || createCollectionId()),
    name,
    workOrder: Array.isArray(raw.workOrder)
      ? Array.from(new Set(raw.workOrder.map(String).filter(Boolean)))
      : [],
    createdAt: raw.createdAt || new Date().toISOString(),
  };
}

export function normalizeCollectionList(rawList) {
  if (!Array.isArray(rawList)) return [];
  const seenIds = new Set();
  const seenNames = new Set();
  const result = [];
  rawList.forEach((entry) => {
    const normalized = normalizeCollectionRecord(entry);
    if (!normalized) return;
    const keyName = normalized.name.toLowerCase();
    if (seenIds.has(normalized.id) || seenNames.has(keyName)) return;
    seenIds.add(normalized.id);
    seenNames.add(keyName);
    result.push(normalized);
  });
  return result;
}

export function loadSavedCollections() {
  try {
    const raw = localStorage.getItem(COLLECTIONS_STORAGE_KEY);
    if (!raw) return [];
    return normalizeCollectionList(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function saveCollections(collections) {
  try {
    localStorage.setItem(
      COLLECTIONS_STORAGE_KEY,
      JSON.stringify(normalizeCollectionList(collections))
    );
  } catch {
    // Quota indisponível
  }
}

export function createCustomCollection(name, existingCollections = []) {
  const cleanName = String(name || '').trim();
  const list = normalizeCollectionList(existingCollections);
  if (!cleanName) {
    return { collections: list, created: null, duplicate: false };
  }

  const duplicate = list.find(
    (col) => col.name.toLowerCase() === cleanName.toLowerCase()
  );
  if (duplicate) {
    return { collections: list, created: duplicate, duplicate: true };
  }

  const created = {
    id: createCollectionId(),
    name: cleanName,
    createdAt: new Date().toISOString(),
  };

  return {
    collections: [...list, created],
    created,
    duplicate: false,
  };
}

export function toggleWorkInCollection(workCollectionIds = [], collectionId) {
  if (!collectionId) return Array.isArray(workCollectionIds) ? workCollectionIds : [];
  const current = Array.isArray(workCollectionIds)
    ? Array.from(new Set(workCollectionIds.map(String).filter(Boolean)))
    : [];
  const id = String(collectionId);
  if (current.includes(id)) {
    return current.filter((entry) => entry !== id);
  }
  return [...current, id];
}

export function filterWorksByCollection(items = [], collectionId = 'all') {
  const safeItems = Array.isArray(items) ? items : [];
  if (!collectionId || collectionId === 'all') return safeItems;
  const target = String(collectionId);
  return safeItems.filter(
    (item) =>
      Array.isArray(item?.collectionIds) &&
      item.collectionIds.map(String).includes(target)
  );
}

export function reorderCollections(collections = [], collectionId, direction = -1) {
  const list = normalizeCollectionList(collections);
  const idx = list.findIndex((c) => c.id === String(collectionId));
  if (idx === -1) return list;
  const targetIdx = direction < 0 ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= list.length) return list;
  const next = [...list];
  const [moved] = next.splice(idx, 1);
  next.splice(targetIdx, 0, moved);
  return next;
}

export function sortWorksInCollection(works = [], collection = null) {
  const order = Array.isArray(collection?.workOrder) ? collection.workOrder.map(String) : [];
  if (order.length === 0) return works;
  const posMap = new Map(order.map((id, idx) => [id, idx]));
  return [...works].sort((a, b) => {
    const posA = posMap.has(String(a.id)) ? posMap.get(String(a.id)) : Number.MAX_SAFE_INTEGER;
    const posB = posMap.has(String(b.id)) ? posMap.get(String(b.id)) : Number.MAX_SAFE_INTEGER;
    return posA - posB;
  });
}

export function reorderWorkInCollection(collection, workId, direction = -1, memberWorks = []) {
  if (!collection) return collection;
  const currentIds = memberWorks.map((w) => String(w.id));
  const baseOrder =
    Array.isArray(collection.workOrder) && collection.workOrder.length > 0
      ? Array.from(new Set([...collection.workOrder.map(String), ...currentIds]))
      : currentIds;
  const idx = baseOrder.indexOf(String(workId));
  if (idx === -1) return collection;
  const targetIdx = direction < 0 ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= baseOrder.length) return collection;
  const next = [...baseOrder];
  const [moved] = next.splice(idx, 1);
  next.splice(targetIdx, 0, moved);
  return { ...collection, workOrder: next };
}

export function buildCollectionMosaicSvg(works = [], collectionName = 'Coleção') {
  const slots = [];
  for (let i = 0; i < 4; i += 1) {
    const item = works[i] || null;
    const key = item ? `${item.id || ''}:${item.title || ''}` : `${collectionName}:slot-${i}`;
    const pal = hashFallbackPalette(key);
    const label = item?.title ? String(item.title).trim().slice(0, 2).toUpperCase() : '';
    slots.push({ bg: pal.bg, fg: pal.fg, accent: pal.accent, label });
  }

  const coords = [
    { x: 0, y: 0 },
    { x: 60, y: 0 },
    { x: 0, y: 60 },
    { x: 60, y: 60 },
  ];

  const rects = slots
    .map((s, idx) => {
      const { x, y } = coords[idx];
      return `
        <rect x="${x}" y="${y}" width="60" height="60" fill="${s.bg}" />
        <line x1="${x + 8}" y1="${y + 12}" x2="${x + 52}" y2="${y + 12}" stroke="${s.accent}" stroke-opacity="0.35" stroke-width="1" />
        ${
          s.label
            ? `<text x="${x + 30}" y="${y + 38}" text-anchor="middle" font-family="'Newsreader Variable', Georgia, serif" font-size="16" font-weight="600" fill="${s.fg}">${escapeSvgText(s.label)}</text>`
            : ''
        }
      `;
    })
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120" role="img" aria-label="${escapeSvgText(collectionName)}">
  ${rects}
  <line x1="60" y1="0" x2="60" y2="120" stroke="currentColor" stroke-opacity="0.18" stroke-width="1" />
  <line x1="0" y1="60" x2="120" y2="60" stroke="currentColor" stroke-opacity="0.18" stroke-width="1" />
</svg>`;
}

export function buildCollectionMosaicCoverDataUri(works = [], collectionName = 'Coleção') {
  const svg = buildCollectionMosaicSvg(works, collectionName);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
