import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GENERATION_STATS_STORAGE_KEY,
  getGenerationStatsSnapshot,
  recordGeneratedImages,
  resetGenerationStats,
  subscribeGenerationStats,
} from "./generationStats";

describe("global generation stats", () => {
  beforeEach(() => {
    localStorage.clear();
    resetGenerationStats();
  });

  it("persists successful image counts separately for every model", () => {
    recordGeneratedImages("gemini-3-pro-image", 2, 100);
    recordGeneratedImages("gpt-image-2", 1, 200);
    recordGeneratedImages("gemini-3-pro-image", 3, 300);

    expect(getGenerationStatsSnapshot()).toMatchObject({
      total: 6,
      updatedAt: 300,
      byModel: {
        "gemini-3-pro-image": { count: 5, lastGeneratedAt: 300 },
        "gpt-image-2": { count: 1, lastGeneratedAt: 200 },
      },
    });
    expect(
      JSON.parse(localStorage.getItem(GENERATION_STATS_STORAGE_KEY) || "{}"),
    ).toMatchObject({ total: 6, version: 1 });
  });

  it("ignores invalid events and notifies subscribers for valid updates", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeGenerationStats(listener);
    recordGeneratedImages("", 1);
    recordGeneratedImages("gemini-3.1-flash-image", 0);
    expect(listener).not.toHaveBeenCalled();
    recordGeneratedImages("gemini-3.1-flash-image", 1);
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });
});
