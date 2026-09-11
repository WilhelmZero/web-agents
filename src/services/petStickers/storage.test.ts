import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import {
  loadWorkspace,
  readSettings,
  saveSettings,
  saveWorkspace,
} from "./storage";
import { DEFAULT_SETTINGS } from "./types";
it("defaults to Barlow Medium and migrates earlier generator settings without touching saved results", () => {
  localStorage.removeItem("pet-letter-stickers:settings:v1");
  expect(readSettings().fontKey).toBe("barlow-medium");
  localStorage.setItem(
    "pet-letter-stickers:settings:v1",
    JSON.stringify({
      version: 1,
      value: { ...DEFAULT_SETTINGS, fontKey: "apex-new", seed: 88 },
    }),
  );
  expect(readSettings()).toMatchObject({ fontKey: "barlow-medium", seed: 88 });
  saveSettings({ ...DEFAULT_SETTINGS, fontKey: "anton" });
  expect(readSettings().fontKey).toBe("anton");
});
it("uses isolated versioned settings without touching other tools", () => {
  localStorage.setItem("other-tool", "untouched");
  saveSettings({ ...DEFAULT_SETTINGS, seed: 42 });
  expect(readSettings().seed).toBe(42);
  expect(localStorage.getItem("other-tool")).toBe("untouched");
});
it("saves libraries in order and freezes caller snapshots", async () => {
  const x = {
    libraries: [
      { version: 1 as const, id: "first", name: "before", assets: [] },
    ],
    libraryId: "first",
    results: [],
  };
  const a = saveWorkspace(x);
  x.libraries[0].name = "after";
  await a;
  expect((await loadWorkspace())?.libraries[0].name).toBe("before");
  await Promise.all([
    saveWorkspace(x),
    saveWorkspace({ ...x, libraryId: "last" }),
  ]);
  expect((await loadWorkspace())?.libraryId).toBe("last");
});
