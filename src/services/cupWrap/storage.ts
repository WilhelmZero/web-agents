import type { WrapDesign } from "./types";
import { loadServerDocument, saveServerDocument, serverPersistenceEnabled } from '../serverPersistence';
async function db() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("cup-wrap-print-v1", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("designs");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function loadDesigns(): Promise<WrapDesign[]> {
  if (serverPersistenceEnabled()) return await loadServerDocument<WrapDesign[]>('cup-wrap-print:designs') || [];
  const d = await db();
  return new Promise<WrapDesign[]>((resolve, reject) => {
    const r = d.transaction("designs").objectStore("designs").get("current");
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => reject(r.error);
  }).finally(() => d.close());
}
export async function saveDesigns(designs: WrapDesign[]) {
  if (serverPersistenceEnabled()) return saveServerDocument('cup-wrap-print:designs', designs, 'cup-wrap-print');
  const d = await db();
  return new Promise<void>((resolve, reject) => {
    const t = d.transaction("designs", "readwrite");
    t.objectStore("designs").put(designs, "current");
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  }).finally(() => d.close());
}
