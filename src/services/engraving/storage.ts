import type { Preferences, SavedTask } from "./types";
import { OPENAI_ROOT } from "../openAiEndpoint";
export const DEFAULT_PREFERENCES: Preferences = {
  baseUrl: OPENAI_ROOT,
  imageModel: "gpt-image-2",
  reviewModel: "gpt-5.4-mini",
  quality: "high",
  subject: "auto",
  style: "strong",
  reference: "portrait",
  instructions: "",
  auto: true,
  maxRounds: 5,
  targetScore: 85,
};
const KEY = "custom-monochrome-logo:settings:v1";
export function loadPreferences(): Preferences {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || "null");
    if (p?.version !== 1 || !p.settings) return { ...DEFAULT_PREFERENCES };
    const out = { ...DEFAULT_PREFERENCES };
    for (const key of [
      "imageModel",
      "reviewModel",
      "instructions",
    ] as const)
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
    out.instructions = out.instructions.slice(0, 1600);
    return out;
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}
export function savePreferences(value: Preferences) {
  // Explicit allowlist: never persist API credentials even if supplied at runtime.
  const settings = Object.fromEntries(
    Object.keys(DEFAULT_PREFERENCES).filter((key) => key !== "baseUrl").map((key) => [
      key,
      value[key as keyof Preferences],
    ]),
  );
  localStorage.setItem(KEY, JSON.stringify({ version: 1, settings }));
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
export async function loadTask(): Promise<SavedTask | undefined> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("tasks", "readonly"),
        req = tx.objectStore("tasks").get("latest");
      req.onsuccess = () =>
        resolve(
          req.result?.version === 1 ? restoreTask(req.result) : undefined,
        );
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}
let pending: Promise<void> = Promise.resolve();
export function saveTask(task: SavedTask): Promise<void> {
  const snapshot = structuredClone(task);
  const write = async () => {
    const db = await database();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("tasks", "readwrite");
        tx.objectStore("tasks").put(snapshot, "latest");
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () =>
          reject(tx.error || new Error("本地存储失败，请检查浏览器存储空间。"));
      });
    } finally {
      db.close();
    }
  };
  pending = pending.catch(() => undefined).then(write);
  return pending;
}
