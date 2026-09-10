import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { DEFAULTS } from "./processing.mjs";
import type { SavedTask } from "./types";
const CURRENT = "custom-monochrome-logo:current-task:v2";
const task = (name: string): SavedTask => ({
  version: 1,
  fileName: name,
  original: new Blob([name]),
  params: { ...DEFAULTS },
});
let held: Set<string>;
beforeEach(() => {
  vi.resetModules();
  sessionStorage.clear();
  localStorage.clear();
  held = new Set();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (
        id: string,
        _options: unknown,
        cb: (lock: unknown) => Promise<void>,
      ) => {
        if (held.has(id)) return cb(null);
        held.add(id);
        return cb({ name: id }).finally(() => held.delete(id));
      },
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete (navigator as unknown as { locks?: unknown }).locks;
  sessionStorage.clear();
  localStorage.clear();
});
async function newDocument() {
  vi.resetModules();
  return import("./storage");
}
it("isolates interleaved tab writes and restores the correct task after refresh", async () => {
  const a = await newDocument();
  await a.loadTask();
  const aId = sessionStorage.getItem(CURRENT)!;
  await a.saveTask(task("A"));
  sessionStorage.clear();
  const b = await newDocument();
  await b.loadTask();
  const bId = sessionStorage.getItem(CURRENT)!;
  await Promise.all([a.saveTask(task("A-final")), b.saveTask(task("B-final"))]);
  expect(aId).not.toBe(bId);
  held.delete("engraving:" + aId);
  sessionStorage.setItem(CURRENT, aId);
  const refreshed = await newDocument();
  expect((await refreshed.loadTask())?.fileName).toBe("A-final");
  const history = await refreshed.listTaskHistory();
  expect(history.map((t) => t.fileName).sort()).toEqual(["A-final", "B-final"]);
});
it("forks a duplicated tab, preserves its source, and copies history without overwriting", async () => {
  const a = await newDocument();
  await a.loadTask();
  await a.saveTask(task("A"));
  const id = sessionStorage.getItem(CURRENT)!;
  const duplicate = await newDocument();
  expect((await duplicate.loadTask())?.fileName).toBe("A");
  expect(sessionStorage.getItem(CURRENT)).not.toBe(id);
  await duplicate.saveTask(task("copy"));
  const restored = await duplicate.copyHistoryTask(id);
  expect(restored.fileName).toBe("A");
  await duplicate.saveTask(task("edited-history"));
  const names = (await a.listTaskHistory()).map((e) => e.fileName);
  expect(names).toContain("A");
  expect(names).toContain("copy");
  expect(names).toContain("edited-history");
});
it("preserves old latest cache and migrates without shared writes", async () => {
  const db = await new Promise<IDBDatabase>((resolve) => {
    const r = indexedDB.open("custom-monochrome-logo-v1", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("tasks");
    r.onsuccess = () => resolve(r.result);
  });
  await new Promise<void>((resolve) => {
    const tx = db.transaction("tasks", "readwrite");
    tx.objectStore("tasks").put(task("legacy"), "latest");
    tx.oncomplete = () => resolve();
  });
  db.close();
  const a = await newDocument();
  expect((await a.loadTask())?.fileName).toBe("legacy");
  await a.saveTask(task("new"));
  sessionStorage.clear();
  const b = await newDocument();
  expect((await b.loadTask())?.fileName).toBe("legacy");
});
it("keeps replaced originals in history and does not recover active runs as running", async () => {
  const a = await newDocument();
  await a.loadTask();
  await a.saveTask(task("first"));
  await a.startNewTask();
  await a.saveTask(task("second"));
  expect((await a.listTaskHistory()).map((t) => t.fileName).sort()).toEqual([
    "first",
    "second",
  ]);
  const id = sessionStorage.getItem(CURRENT)!;
  await a.saveTask({
    ...task("second"),
    run: {
      status: "running",
      phase: "busy",
      maxRounds: 5,
      targetScore: 85,
      generations: 1,
      checks: 0,
      rounds: [],
      best: null,
      fallback: null,
    },
  });
  expect((await a.copyHistoryTask(id)).run?.status).toBe("interrupted");
});
it("isolates preferences and preserves read-only legacy defaults", async () => {
  localStorage.setItem(
    "custom-monochrome-logo:settings:v1",
    JSON.stringify({ version: 1, settings: { instructions: "old" } }),
  );
  const a = await newDocument();
  a.savePreferences({ ...a.DEFAULT_PREFERENCES, instructions: "A" });
  const saved = sessionStorage.getItem("custom-monochrome-logo:settings:v1")!;
  sessionStorage.clear();
  expect(a.loadPreferences().instructions).toBe("old");
  a.savePreferences({ ...a.DEFAULT_PREFERENCES, instructions: "B" });
  sessionStorage.setItem("custom-monochrome-logo:settings:v1", saved);
  expect(a.loadPreferences().instructions).toBe("A");
});

it("loads the latest saved state on route re-entry and safely forks without Web Locks", async () => {
  const a = await newDocument();
  await a.loadTask();
  await a.saveTask(task("before"));
  await a.saveTask(task("after"));
  expect((await a.loadTask())?.fileName).toBe("after");
  const originalId = sessionStorage.getItem(CURRENT);
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: undefined,
  });
  const b = await newDocument();
  expect((await b.loadTask())?.fileName).toBe("after");
  expect(sessionStorage.getItem(CURRENT)).not.toBe(originalId);
  await b.saveTask(task("fork"));
  expect((await a.loadTask())?.fileName).toBe("after");
});
