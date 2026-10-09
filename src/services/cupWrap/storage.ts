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

// The hosted workspace retains cup parameters, but never restores uploaded or generated images.
const SETTINGS_KEY = 'cup-wrap-print:settings-only:v1';
function stripDesignImages(design: WrapDesign): WrapDesign {
  return {
    ...design,
    source: undefined, originalSource: undefined, artworkSlots: undefined,
    stitchedSource: false, sourceRevision: undefined, adopted: undefined,
    aiResults: [], aiFrames: [], geometryOutpaintCandidates: [],
    appliedGeometryCandidateId: undefined, adoptedFrame: undefined,
    localAdaptation: undefined, layers: [],
  };
}
export async function loadDesignSettings(): Promise<WrapDesign[]> {
  const saved = serverPersistenceEnabled()
    ? await loadServerDocument<WrapDesign[]>(SETTINGS_KEY)
    : (() => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null') as WrapDesign[] | null; } catch { return null; } })();
  if (saved) return saved;
  const legacy = await loadDesigns();
  if (!legacy.length) return [];
  const settings = legacy.map(stripDesignImages);
  await saveDesignSettings(settings);
  return settings;
}
export async function saveDesignSettings(designs: WrapDesign[]): Promise<void> {
  const settingsOnly = designs.map(stripDesignImages);
  if (serverPersistenceEnabled()) await saveServerDocument(SETTINGS_KEY, settingsOnly, 'cup-wrap-print');
  else localStorage.setItem(SETTINGS_KEY, JSON.stringify(settingsOnly));
}
