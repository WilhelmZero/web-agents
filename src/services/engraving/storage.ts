import type { Preferences, SavedTask } from "./types";
import { taskResults } from "./results";
import { OPENAI_ROOT } from "../openAiEndpoint";
export const DEFAULT_OUTPAINT_INSTRUCTIONS =
  "向图片上/下/左/右侧扩图，补全人物手臂和手肘/腿部，保留安全边距";
export const DEFAULT_PREFERENCES: Preferences = {
  baseUrl: OPENAI_ROOT,
  imageModel: "gpt-image-2",
  reviewModel: "gpt-5.4-mini",
  quality: "high",
  subject: "auto",
  style: "strong",
  reference: "portrait",
  instructions: "",
  outpaint: { enabled: false, instructions: DEFAULT_OUTPAINT_INSTRUCTIONS },
  auto: true,
  continueOnGenerated: false,
  maxRounds: 5,
  targetScore: 85,
};
const KEY = "custom-monochrome-logo:settings:v1";
const SETTINGS_VERSION = 2;
export function loadPreferences(scope = ""): Preferences {
  const tabKey = KEY + (scope ? ":" + scope : "");
  try {
    const p = JSON.parse(
      sessionStorage.getItem(tabKey) || localStorage.getItem(KEY) || "null",
    );
    if (![1, SETTINGS_VERSION].includes(p?.version) || !p.settings)
      return { ...DEFAULT_PREFERENCES };
    const out = { ...DEFAULT_PREFERENCES };
    if (typeof p.settings.continueOnGenerated === "boolean")
      out.continueOnGenerated = p.settings.continueOnGenerated;
    for (const key of ["imageModel", "reviewModel", "instructions"] as const)
      if (typeof p.settings[key] === "string") out[key] = p.settings[key];
    if (
      ["auto", "portrait", "pet", "group", "horse"].includes(p.settings.subject)
    )
      out.subject = p.settings.subject;
    if (["strong", "natural"].includes(p.settings.style))
      out.style = p.settings.style;
    if (["portrait", "couple", "bouquet"].includes(p.settings.reference))
      out.reference = p.settings.reference;
    if (["low", "medium", "high", "auto"].includes(p.settings.quality))
      out.quality = p.settings.quality;
    if (typeof p.settings.auto === "boolean") out.auto = p.settings.auto;
    if (
      Number.isInteger(p.settings.maxRounds) &&
      p.settings.maxRounds >= 1 &&
      p.settings.maxRounds <= 10
    )
      out.maxRounds = p.settings.maxRounds;
    if (
      Number.isInteger(p.settings.targetScore) &&
      p.settings.targetScore >= 70 &&
      p.settings.targetScore <= 95
    )
      out.targetScore = p.settings.targetScore;
    const savedOutpaintInstructions = p.settings.outpaint?.instructions;
    out.outpaint = {
      enabled: p.settings.outpaint?.enabled === true,
      instructions:
        typeof savedOutpaintInstructions === "string" &&
        (p.version === SETTINGS_VERSION || savedOutpaintInstructions.trim())
          ? savedOutpaintInstructions.slice(0, 800)
          : DEFAULT_OUTPAINT_INSTRUCTIONS,
    };
    out.instructions = out.instructions.slice(0, 1600);
    return out;
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}
export function savePreferences(value: Preferences, scope = "") {
  const tabKey = KEY + (scope ? ":" + scope : "");
  // Explicit allowlist: never persist API credentials even if supplied at runtime.
  const settings = Object.fromEntries(
    Object.keys(DEFAULT_PREFERENCES)
      .filter((key) => key !== "baseUrl")
      .map((key) => [key, value[key as keyof Preferences]]),
  );
  sessionStorage.setItem(
    tabKey,
    JSON.stringify({ version: SETTINGS_VERSION, settings }),
  );
}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("custom-monochrome-logo-v1", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("tasks");
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
    open.onblocked = () =>
      reject(new Error("本地数据库被其他页面占用，请关闭旧页面后刷新。"));
  });
}
export function restoreTask(task: SavedTask): SavedTask {
  return task.run?.status === "running"
    ? {
        ...task,
        endedAt: Date.now(),
        run: {
          ...task.run,
          status: "interrupted",
          phase: "刷新前任务已中断，已恢复保存结果；不会自动重发请求。",
        },
      }
    : task;
}

export interface TaskHistoryEntry {
  id: string;
  fileName: string;
  updatedAt: number;
  count: number;
}

export function createTaskStorage(scope = "") {
  const CURRENT =
    "custom-monochrome-logo:current-task:v2" + (scope ? ":" + scope : "");
  let currentId = "";
  let initialized: Promise<void> | undefined;
  let pending: Promise<void> = Promise.resolve();

  async function readTask(id: string): Promise<SavedTask | undefined> {
    const db = await database();
    try {
      return await new Promise((resolve, reject) => {
        const req = db
          .transaction("tasks", "readonly")
          .objectStore("tasks")
          .get(id);
        req.onsuccess = () =>
          resolve(req.result?.version === 1 ? req.result : undefined);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  }
  async function writeTask(id: string, snapshot: SavedTask) {
    const db = await database();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("tasks", "readwrite"),
          store = tx.objectStore("tasks");
        store.put(snapshot, id);
        if (snapshot.original || taskResults(snapshot).length) {
          store.put(
            {
              id,
              fileName: snapshot.fileName,
              updatedAt: Date.now(),
              count: taskResults(snapshot).length,
            },
            "history:" + id,
          );
        }
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () =>
          reject(tx.error || new Error("本地存储失败，请下载结果。"));
      });
    } finally {
      db.close();
    }
  }
  // A document holds its writer lock until unload. Duplicated tabs inherit sessionStorage,
  // but cannot acquire the same lock and therefore fork before any writes.
  async function claim(id: string): Promise<boolean> {
    if (!navigator.locks) return false;
    return new Promise((resolve, reject) => {
      void navigator.locks
        .request("engraving:" + id, { ifAvailable: true }, async (lock) => {
          if (!lock) {
            resolve(false);
            return;
          }
          resolve(true);
          await new Promise<void>((release) =>
            window.addEventListener("pagehide", (event) => {
              // Keep the lock while in bfcache, where this document can later resume.
              if (!event.persisted) release();
            }),
          );
        })
        .catch(reject);
    });
  }
  async function freshId() {
    const id = "task:" + crypto.randomUUID();
    await claim(id);
    currentId = id;
    sessionStorage.setItem(CURRENT, id);
  }
  function ensureReady(): Promise<void> {
    if (!initialized)
      initialized = (async () => {
        const previous = sessionStorage.getItem(CURRENT);
        if (previous && (await claim(previous))) {
          currentId = previous;
          return;
        }
        await freshId();
        // Old shared cache remains untouched, so an old-version tab cannot overwrite v2 tasks.
        if (scope && !previous) return;
        const saved = await readTask(previous || "latest");
        if (!saved) return undefined;
        const restored = restoreTask(saved);
        await writeTask(currentId, restored);
      })();
    return initialized;
  }
  async function loadTask(): Promise<SavedTask | undefined> {
    await ensureReady();
    await pending;
    const saved = await readTask(currentId);
    return saved && restoreTask(saved);
  }
  function saveTask(task: SavedTask): Promise<void> {
    const snapshot = structuredClone(task);
    const write = async () => {
      await ensureReady();
      await writeTask(currentId, snapshot);
    };
    pending = pending.catch(() => undefined).then(write);
    return pending;
  }
  // Called only after saving the current task, while UI edits/generation are disabled.
  async function startNewTask() {
    await ensureReady();
    await pending;
    await freshId();
  }
  async function listTaskHistory(): Promise<TaskHistoryEntry[]> {
    await ensureReady();
    const db = await database();
    try {
      return await new Promise((resolve, reject) => {
        const req = db
          .transaction("tasks", "readonly")
          .objectStore("tasks")
          .getAll(IDBKeyRange.bound("history:", "history:\uffff"));
        req.onsuccess = () =>
          resolve(
            (req.result as TaskHistoryEntry[]).sort(
              (a, b) => b.updatedAt - a.updatedAt,
            ),
          );
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  }
  async function copyHistoryTask(id: string): Promise<SavedTask> {
    if (!id.startsWith("task:")) throw new Error("无效任务。");
    const saved = await readTask(id);
    if (!saved) throw new Error("该历史任务已不可用。");
    await startNewTask();
    const restored = restoreTask(saved);
    await saveTask(restored);
    return restored;
  }

  return {
    loadTask,
    saveTask,
    startNewTask,
    listTaskHistory,
    copyHistoryTask,
    loadPreferences: () => loadPreferences(scope),
    savePreferences: (v: Preferences) => savePreferences(v, scope),
  };
}
const defaultStore = createTaskStorage();
export const {
  loadTask,
  saveTask,
  startNewTask,
  listTaskHistory,
  copyHistoryTask,
} = defaultStore;
const scopes = new Map<string, ReturnType<typeof createTaskStorage>>();
export function getTaskStorage(scope: string) {
  if (!scopes.has(scope)) scopes.set(scope, createTaskStorage(scope));
  return scopes.get(scope)!;
}
