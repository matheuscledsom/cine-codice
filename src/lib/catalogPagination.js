/**
 * Paginação incremental do Catálogo acima de 200 itens (v2.4.0 Fase 2.2).
 */

export const CATALOG_PAGINATION_THRESHOLD = 200;
export const CATALOG_PAGE_BATCH_SIZE = 60;

export function shouldUseIncrementalPagination(totalItems = 0) {
  return Number(totalItems) > CATALOG_PAGINATION_THRESHOLD;
}

export function computeCatalogVisibleSlice(items = [], visibleLimit = CATALOG_PAGE_BATCH_SIZE) {
  const safeList = Array.isArray(items) ? items : [];
  if (!shouldUseIncrementalPagination(safeList.length)) {
    return {
      visibleItems: safeList,
      hasMore: false,
      paginated: false,
      totalCount: safeList.length,
    };
  }
  const safeLimit = Math.max(CATALOG_PAGE_BATCH_SIZE, Number(visibleLimit) || CATALOG_PAGE_BATCH_SIZE);
  const visibleItems = safeList.slice(0, safeLimit);
  return {
    visibleItems,
    hasMore: visibleItems.length < safeList.length,
    paginated: true,
    totalCount: safeList.length,
  };
}
