import catalog from "./font-catalog.json";
export const FONT_CATALOG = catalog;
export interface LocalFontRecord {
  id: string;
  name: string;
  blob: Blob;
  group: string;
}
const loads = new Map<string, Promise<string>>();
function db() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("engraving-fonts-v1", 1);
    r.onupgradeneeded = () =>
      r.result.createObjectStore("fonts", { keyPath: "id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function localFonts(): Promise<LocalFontRecord[]> {
  const d = await db();
  try {
    return await new Promise((resolve, reject) => {
      const r = d.transaction("fonts").objectStore("fonts").getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } finally {
    d.close();
  }
}
export async function importFont(blob: Blob, name: string) {
  if (blob.size > 10 * 1024 * 1024) throw new Error("字体文件最多10MB。");
  const bytes = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const id =
    "local-" +
    Array.from(new Uint8Array(digest), (n) =>
      n.toString(16).padStart(2, "0"),
    ).join("");
  await new FontFace("validate_font", bytes).load();
  const record = { id, name, blob, group: "Local" };
  const d = await db();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = d.transaction("fonts", "readwrite");
      tx.objectStore("fonts").put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    d.close();
  }
  return record;
}
export function ensureLayoutFont(id: string): Promise<string> {
  let load = loads.get(id);
  if (!load) {
    load = (async () => {
      const family = "Engraving_" + id.replace(/[^a-z0-9]/gi, "_");
      const bundled = FONT_CATALOG.find((f) => f.id === id);
      let source: string | ArrayBuffer;
      if (bundled)
        source = `url(${import.meta.env.BASE_URL}engraving-fonts/${id}.woff2)`;
      else {
        const record = (await localFonts()).find((f) => f.id === id);
        if (!record) throw new Error("缺少字体，请重新导入：" + id);
        source = await record.blob.arrayBuffer();
      }
      const face = await new FontFace(family, source).load();
      const scope = globalThis as unknown as {
        fonts: FontFaceSet;
        document?: Document;
      };
      (scope.document?.fonts || scope.fonts).add(face);
      return family;
    })().catch((e) => {
      loads.delete(id);
      throw e;
    });
    loads.set(id, load);
  }
  return load;
}
