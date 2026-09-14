import { DEFAULT_PREFERENCES, restoreTask } from "./storage";
import type { Preferences, SavedTask } from "./types";
export interface BatchMember {
  id: string;
  name: string;
  count: number;
}
export interface BatchHistory {
  id: string;
  name: string;
  updatedAt: number;
  preferences: Preferences;
  tasks: BatchMember[];
  legacy?: boolean;
}
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("custom-monochrome-logo-v1", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("tasks");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function get<T>(key: string): Promise<T | undefined> {
  const d = await db();
  try {
    return await new Promise((resolve, reject) => {
      const r = d.transaction("tasks").objectStore("tasks").get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } finally {
    d.close();
  }
}
async function prefix<T>(name: string): Promise<T[]> {
  const d = await db();
  try {
    return await new Promise((resolve, reject) => {
      const r = d
        .transaction("tasks")
        .objectStore("tasks")
        .getAll(IDBKeyRange.bound(name, name + "\uffff"));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } finally {
    d.close();
  }
}
export async function saveBatchHistory(value: BatchHistory) {
  if (!value.tasks.length) return;
  // Keep image blobs in their original task records, and credentials out of history.
  const preferences = Object.fromEntries(
    Object.keys(DEFAULT_PREFERENCES).map((key) => [
      key,
      value.preferences[key as keyof Preferences],
    ]),
  ) as unknown as Preferences;
  const d = await db();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = d.transaction("tasks", "readwrite");
      tx.objectStore("tasks").put(
        { ...value, preferences },
        "batch-history:" + value.id,
      );
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  } finally {
    d.close();
  }
}
export async function listBatchHistory(): Promise<BatchHistory[]> {
  const batches = await prefix<BatchHistory>("batch-history:");
  const members = new Set(batches.flatMap((b) => b.tasks.map((t) => t.id)));
  const legacy = await prefix<{
    id: string;
    fileName: string;
    count: number;
    updatedAt: number;
  }>("history:");
  return [
    ...batches,
    ...legacy
      .filter((t) => !members.has(t.id))
      .map((t) => ({
        id: "legacy:" + t.id,
        name: t.fileName,
        updatedAt: t.updatedAt,
        preferences: { ...DEFAULT_PREFERENCES },
        tasks: [{ id: t.id, name: t.fileName, count: t.count }],
        legacy: true,
      })),
  ].sort((a, b) => b.updatedAt - a.updatedAt);
}
export async function readBatchTasks(
  entry: BatchHistory,
): Promise<SavedTask[]> {
  return Promise.all(
    entry.tasks.map(async (member) => {
      const value = await get<SavedTask>(member.id);
      if (!value || value.version !== 1)
        throw new Error("历史数据不完整，未恢复；请检查其他历史记录。");
      return restoreTask(value);
    }),
  );
}
const owners = new Map<string, () => void>();
const pendingHolds = new Map<string, Promise<void>>();
export async function holdBatch(id: string) {
  if (owners.has(id) || !navigator.locks) return;
  if (pendingHolds.has(id)) return pendingHolds.get(id);
  const pending = new Promise<void>((resolve, reject) => {
    void navigator.locks
      .request("engraving-batch:" + id, { ifAvailable: true }, async (lock) => {
        if (!lock) {
          reject(new Error("此批次正在其他标签中使用。"));
          return;
        }
        await new Promise<void>((release) => {
          owners.set(id, release);
          resolve();
        });
      })
      .catch(reject);
  });
  pendingHolds.set(id, pending);
  try { await pending; } finally { pendingHolds.delete(id); }
}
export function releaseBatch(id: string) {
  owners.get(id)?.();
  owners.delete(id);
}
if (typeof window !== "undefined")
  window.addEventListener("pagehide", (e) => {
    if (!e.persisted) for (const id of owners.keys()) releaseBatch(id);
  });
export async function deleteBatchHistory(
  entry: BatchHistory,
): Promise<boolean> {
  if (!navigator.locks)
    throw new Error(
      "浏览器无法确认历史是否被其他标签使用，请使用支持 Web Locks 的 Chrome/Edge 清理历史。",
    );
  const lockName = entry.legacy
    ? "engraving:" + entry.tasks[0].id
    : "engraving-batch:" + entry.id;
  return navigator.locks.request(
    lockName,
    { ifAvailable: true },
    async (lock) => {
      if (!lock) return false;
      const d = await db();
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = d.transaction("tasks", "readwrite"),
            store = tx.objectStore("tasks");
          const refs = store.getAll(
            IDBKeyRange.bound("batch-history:", "batch-history:\uffff"),
          );
          refs.onsuccess = () => {
            const used = new Set(
              (refs.result as BatchHistory[])
                .filter((b) => b.id !== entry.id)
                .flatMap((b) => b.tasks.map((t) => t.id)),
            );
            store.delete("batch-history:" + entry.id);
            for (const task of entry.tasks)
              if (!used.has(task.id)) {
                store.delete(task.id);
                store.delete("history:" + task.id);
              }
          };
          tx.oncomplete = () => resolve();
          tx.onabort = tx.onerror = () => reject(tx.error);
        });
      } finally {
        d.close();
      }
      return true;
    },
  );
}
export async function archiveLegacyWorkspace(
  scopes: string[],
  preferences: Preferences,
) {
  const tasks: BatchMember[] = [];
  for (const scope of scopes) {
    const id = sessionStorage.getItem(
      "custom-monochrome-logo:current-task:v2" +
        (scope === "default" ? "" : ":" + scope),
    );
    if (!id) continue;
    const t = await get<SavedTask>(id);
    if (t?.original)
      tasks.push({ id, name: t.fileName, count: t.results?.length || 0 });
  }
  if (!tasks.length) return;
  const id = "migrated-" + tasks[0].id;
  if (await get("batch-history:" + id)) return;
  await saveBatchHistory({
    id,
    name: "升级前的工作区",
    updatedAt: Date.now(),
    tasks,
    preferences,
  });
}
