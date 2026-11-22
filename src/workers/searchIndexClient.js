import { filterAndSortItemsSync } from './searchIndexFilter.js';

export const WORKER_ITEM_THRESHOLD = 500;

let workerInstance = null;
let workerFailed = false;
let requestCounter = 0;

function getOrCreateWorker() {
  if (workerFailed || typeof Worker === 'undefined') return null;
  if (workerInstance) return workerInstance;
  try {
    workerInstance = new Worker(new URL('./indexWorker.js', import.meta.url), {
      type: 'module',
    });
    return workerInstance;
  } catch {
    workerFailed = true;
    return null;
  }
}

export async function queryLibraryIndex(items = [], params = {}) {
  if (!Array.isArray(items) || items.length <= WORKER_ITEM_THRESHOLD) {
    return filterAndSortItemsSync(items, params);
  }

  const worker = getOrCreateWorker();
  if (!worker) {
    return filterAndSortItemsSync(items, params);
  }

  const requestId = ++requestCounter;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (out) => {
      if (settled) return;
      settled = true;
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      clearTimeout(timer);
      resolve(out);
    };

    const timer = setTimeout(() => {
      finish(filterAndSortItemsSync(items, params));
    }, 2000);

    const onMessage = (event) => {
      if (event?.data?.requestId !== requestId) return;
      if (Array.isArray(event.data.result)) {
        finish(event.data.result);
      } else {
        finish(filterAndSortItemsSync(items, params));
      }
    };

    const onError = () => {
      workerFailed = true;
      finish(filterAndSortItemsSync(items, params));
    };

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);

    try {
      worker.postMessage({ requestId, items, params });
    } catch {
      finish(filterAndSortItemsSync(items, params));
    }
  });
}

export { filterAndSortItemsSync };
