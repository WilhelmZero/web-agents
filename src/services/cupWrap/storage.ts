import type { WrapDesign } from "./types";
async function db() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("cup-wrap-print-v1", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("designs");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function loadDesigns(): Promise<WrapDesign[]> {
  const d = await db();
  return new Promise<WrapDesign[]>((resolve, reject) => {
    const r = d.transaction("designs").objectStore("designs").get("current");
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => reject(r.error);
  }).finally(() => d.close());
}
export async function saveDesigns(designs: WrapDesign[]) {
  const d = await db();
  return new Promise<void>((resolve, reject) => {
    const t = d.transaction("designs", "readwrite");
    t.objectStore("designs").put(designs, "current");
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  }).finally(() => d.close());
}
