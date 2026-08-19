const DB_NAME = 'scene-studio.multi-tab-results.v1';
const STORE = 'results';

interface StoredResult<T> { id: string; tool: 'scene' | 'logo'; batchId: string; groupId: string; taskId: string; value: T; updatedAt: number }

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE, { keyPath: 'id' });
      store.createIndex('batchGroup', ['tool', 'batchId', 'groupId']);
      store.createIndex('batch', ['tool', 'batchId']);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function putMultiTabResult<T>(tool: 'scene' | 'logo', batchId: string, groupId: string, taskId: string, value: T) {
  const db = await openDb();
  const item: StoredResult<T> = { id: `${tool}:${batchId}:${groupId}:${taskId}`, tool, batchId, groupId, taskId, value, updatedAt: Date.now() };
  await new Promise<void>((resolve, reject) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(item); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
  db.close();
}

async function readByIndex<T>(index: 'batchGroup' | 'batch', key: IDBValidKey) {
  const db = await openDb();
  const values = await new Promise<Array<StoredResult<T>>>((resolve, reject) => { const request = db.transaction(STORE).objectStore(STORE).index(index).getAll(key); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  db.close();
  return values.sort((a, b) => a.updatedAt - b.updatedAt).map((item) => item.value);
}

export const readMultiTabGroupResults = <T,>(tool: 'scene' | 'logo', batchId: string, groupId: string) => readByIndex<T>('batchGroup', [tool, batchId, groupId]);
export const readMultiTabBatchResults = <T,>(tool: 'scene' | 'logo', batchId: string) => readByIndex<T>('batch', [tool, batchId]);

