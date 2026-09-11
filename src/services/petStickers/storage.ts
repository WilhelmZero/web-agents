import {
  DEFAULT_SETTINGS,
  type PetLibrary,
  type PetResult,
  type PetSettings,
} from "./types";
const KEY = "pet-letter-stickers:settings:v1";
export function readSettings(): PetSettings {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null");
    return s?.version === 1 || s?.version === 2
      ? {
          ...DEFAULT_SETTINGS,
          ...s.value,
          ...(s.version === 1 ? { fontKey: "barlow-medium" } : {}),
        }
      : structuredClone(DEFAULT_SETTINGS);
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}
export function saveSettings(value: PetSettings) {
  localStorage.setItem(KEY, JSON.stringify({ version: 2, value }));
}
export interface SavedWorkspace {
  libraries: PetLibrary[];
  libraryId: string;
  results: PetResult[];
}
function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open("pet-letter-stickers-v1", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("workspace");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export async function loadWorkspace(): Promise<SavedWorkspace | undefined> {
  const d = await db();
  try {
    return await new Promise((res, rej) => {
      const r = d
        .transaction("workspace")
        .objectStore("workspace")
        .get("current");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  } finally {
    d.close();
  }
}
let saves = Promise.resolve();
export function saveWorkspace(value: SavedWorkspace) {
  const snapshot = structuredClone(value);
  const next = saves
    .catch(() => {})
    .then(async () => {
      const d = await db();
      try {
        await new Promise<void>((res, rej) => {
          const tx = d.transaction("workspace", "readwrite");
          tx.objectStore("workspace").put(snapshot, "current");
          tx.oncomplete = () => res();
          tx.onerror = () => rej(tx.error);
          tx.onabort = () => rej(tx.error);
        });
      } finally {
        d.close();
      }
    });
  saves = next;
  return next;
}
