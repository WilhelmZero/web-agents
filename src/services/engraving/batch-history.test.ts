import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { DEFAULTS } from "./processing.mjs";
let held: Set<string>;
beforeEach(() => {
  vi.resetModules();
  sessionStorage.clear();
  held = new Set();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (
        id: string,
        _opts: unknown,
        cb: (v: unknown) => Promise<unknown>,
      ) => {
        if (held.has(id)) return cb(null);
        held.add(id);
        try {
          return await cb({ name: id });
        } finally {
          held.delete(id);
        }
      },
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete (navigator as unknown as { locks?: unknown }).locks;
  sessionStorage.clear();
});
it("saves a whole batch without keys, restores both photos and protects active and shared records", async () => {
  const s = await import("./storage"),
    h = await import("./batch-history");
  const a = s.createTaskStorage("a"),
    b = s.createTaskStorage("b");
  await a.saveTask({
    version: 1,
    fileName: "A.png",
    original: new Blob(["A"]),
    params: { ...DEFAULTS },
  });
  await b.saveTask({
    version: 1,
    fileName: "B.png",
    original: new Blob(["B"]),
    params: { ...DEFAULTS },
  });
  const members = [
    { id: await a.getTaskId(), name: "A.png", count: 0 },
    { id: await b.getTaskId(), name: "B.png", count: 0 },
  ];
  const batch = {
    id: "batch-a",
    name: "two photos",
    updatedAt: 1,
    preferences: { ...s.DEFAULT_PREFERENCES, apiKey: "never-store" },
    tasks: members,
  };
  await h.saveBatchHistory(batch);
  expect(await h.listBatchHistory()).toHaveLength(1);
  expect((await h.listBatchHistory())[0].preferences).not.toHaveProperty(
    "apiKey",
  );
  expect((await h.readBatchTasks(batch)).map((t) => t.fileName)).toEqual([
    "A.png",
    "B.png",
  ]);
  await h.holdBatch(batch.id);
  expect(await h.deleteBatchHistory(batch)).toBe(false);
  h.releaseBatch(batch.id);
  await Promise.resolve();
  const other = { ...batch, id: "batch-b", tasks: [members[1]] };
  await h.saveBatchHistory(other);
  expect(await h.deleteBatchHistory(batch)).toBe(true);
  expect((await h.readBatchTasks(other))[0].fileName).toBe("B.png");
  expect(await h.listBatchHistory()).toHaveLength(1);
});
it("keeps legacy single-photo histories visible and migrates old scope lists once", async () => {
  const s = await import("./storage"),
    h = await import("./batch-history");
  const store = s.createTaskStorage("old");
  await store.saveTask({
    version: 1,
    fileName: "old.png",
    original: new Blob(["old"]),
    params: { ...DEFAULTS },
  });
  expect((await h.listBatchHistory())[0].legacy).toBe(true);
  await h.archiveLegacyWorkspace(["old"], s.DEFAULT_PREFERENCES);
  await h.archiveLegacyWorkspace(["old"], s.DEFAULT_PREFERENCES);
  expect(await h.listBatchHistory()).toHaveLength(1);
  expect((await h.listBatchHistory())[0].legacy).toBeUndefined();
});

it('deduplicates simultaneous batch lock initialization',async()=>{const h=await import('./batch-history');await Promise.all([h.holdBatch('same'),h.holdBatch('same'),h.holdBatch('same')]);expect(held.has('engraving-batch:same')).toBe(true);h.releaseBatch('same');});
