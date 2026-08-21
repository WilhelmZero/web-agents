const DB_NAME = 'scene-studio.logo-removal.v1';
const DRAFTS = 'drafts';
const RESULTS = 'results';

export interface StoredLogoRemovalResult {
  key: string;
  sessionId: string;
  groupId: string;
  taskId: string;
  kind: 'result' | 'attempt';
  blob: Blob;
  mimeType: string;
  updatedAt: number;
}

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      const drafts = db.createObjectStore(DRAFTS, { keyPath: 'sessionId' });
      drafts.createIndex('updatedAt', 'updatedAt');
      const results = db.createObjectStore(RESULTS, { keyPath: 'key' });
      results.createIndex('sessionId', 'sessionId');
      results.createIndex('taskId', ['sessionId', 'taskId']);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transact(storeName: string, mode: IDBTransactionMode, operation: (store: IDBObjectStore) => void) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    operation(transaction.objectStore(storeName));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

export async function saveLogoRemovalDraft<T>(sessionId: string, value: T) {
  await transact(DRAFTS, 'readwrite', (store) => store.put({ sessionId, value, updatedAt: Date.now() }));
}

export async function readLatestLogoRemovalDraft<T>() {
  const db = await openDb();
  const value = await new Promise<{ sessionId: string; value: T; updatedAt: number } | undefined>((resolve, reject) => {
    const request = db.transaction(DRAFTS).objectStore(DRAFTS).index('updatedAt').openCursor(null, 'prev');
    request.onsuccess = () => resolve(request.result?.value);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return value;
}

export async function putLogoRemovalResult(input: Omit<StoredLogoRemovalResult, 'updatedAt'>) {
  await transact(RESULTS, 'readwrite', (store) => store.put({ ...input, updatedAt: Date.now() }));
}

export async function readLogoRemovalResult(key: string) {
  const db = await openDb();
  const value = await new Promise<StoredLogoRemovalResult | undefined>((resolve, reject) => {
    const request = db.transaction(RESULTS).objectStore(RESULTS).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return value;
}

export async function readLogoRemovalSessionResults(sessionId: string) {
  const db = await openDb();
  const values = await new Promise<StoredLogoRemovalResult[]>((resolve, reject) => {
    const request = db.transaction(RESULTS).objectStore(RESULTS).index('sessionId').getAll(sessionId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return values.sort((a, b) => a.updatedAt - b.updatedAt);
}

export async function deleteLogoRemovalSession(sessionId: string) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([DRAFTS, RESULTS], 'readwrite');
    tx.objectStore(DRAFTS).delete(sessionId);
    const index = tx.objectStore(RESULTS).index('sessionId');
    const cursor = index.openCursor(IDBKeyRange.only(sessionId));
    cursor.onsuccess = () => { if (cursor.result) { cursor.result.delete(); cursor.result.continue(); } };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
