import { filterAndSortItemsSync } from './searchIndexFilter.js';

if (typeof self !== 'undefined') {
  self.onmessage = (event) => {
    const { requestId, items, params } = event?.data || {};
    try {
      const result = filterAndSortItemsSync(items, params);
      self.postMessage({ requestId, result, error: null });
    } catch (err) {
      self.postMessage({
        requestId,
        result: null,
        error: err?.message || 'Erro no Web Worker de indexação',
      });
    }
  };
}
