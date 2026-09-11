const fontLoads = new Map<string, Promise<string>>();
interface FontRecord {
  key: string;
  name: string;
  blob: Blob;
}
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("pet-letter-sticker-fonts-v1", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("fonts");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function record(key: string): Promise<FontRecord | undefined> {
  const d = await open();
  try {
    return await new Promise((res, rej) => {
      const r = d.transaction("fonts").objectStore("fonts").get(key);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  } finally {
    d.close();
  }
}
export async function importApexFont(file: File) {
  if (!/\.(otf|ttf|woff2?)$/i.test(file.name) || file.size > 5 * 1024 * 1024)
    throw new Error("请选择不超过 5MB 的 Apex New 字体文件");
  const key = `apex-${crypto.randomUUID()}`;
  const f = new FontFace(fontFamily(key), await file.arrayBuffer());
  await f.load();
  document.fonts.add(f);
  fontLoads.set(key, Promise.resolve(fontFamily(key)));
  const d = await open();
  try {
    await new Promise<void>((res, rej) => {
      const tx = d.transaction("fonts", "readwrite");
      const value = { key, name: file.name, blob: file };
      tx.objectStore("fonts").put(value, key);
      tx.objectStore("fonts").put(value, "latest");
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } finally {
    d.close();
  }
  return key;
}
export const fontFamily = (key?: string) =>
  key === "barlow-medium"
    ? "PetBarlowMedium"
    : !key || key === "anton"
      ? "PetAnton"
      : `PetApex_${key.replace(/[^a-zA-Z0-9]/g, "_")}`;
export async function latestApexFont() {
  return record("latest");
}
export function ensurePetFont(key = "anton"): Promise<string> {
  let load = fontLoads.get(key);
  if (!load) {
    load = (async () => {
      const family = fontFamily(key);
      if (key === "anton" || key === "barlow-medium") {
        const f = new FontFace(
          family,
          `url(${import.meta.env.BASE_URL}pet-letter-stickers/${key === "barlow-medium" ? "BarlowSemiCondensed-Medium.ttf" : "Anton-Regular.ttf"})`,
        );
        await f.load();
        document.fonts.add(f);
        return family;
      }
      const font = await record(key === "apex-new" ? "latest" : key);
      if (!font)
        throw new Error(
          "请在右侧导入 Apex New 字体文件。字体只存本机，不上传；不会静默替换成其他字体。",
        );
      const f = new FontFace(family, await font.blob.arrayBuffer());
      await f.load();
      document.fonts.add(f);
      return family;
    })().catch((e) => {
      fontLoads.delete(key);
      throw e;
    });
    fontLoads.set(key, load);
  }
  return load;
}
