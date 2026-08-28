import { describe, expect, it } from "vitest";
import {
  allocateLogoIds,
  appendAutoLogoGroupFile,
  clampLogoCount,
  createAutoLogoTasks,
  removeAutoLogoGroupFile,
} from "./autoLogoPipeline";

describe("auto Logo pipeline", () => {
  it("cycles uploaded logos in order and ignores extras", () => {
    expect(allocateLogoIds(["a", "b"], 5)).toEqual(["a", "b", "a", "b", "a"]);
    expect(allocateLogoIds(["a", "b", "c"], 2)).toEqual(["a", "b"]);
    expect(allocateLogoIds([], 3)).toEqual([]);
  });

  it("clamps counts to 0-16 and retains the raw count", () => {
    expect(clampLogoCount(-3)).toEqual({
      raw: 0,
      effective: 0,
      truncated: false,
    });
    expect(clampLogoCount(18.9)).toEqual({
      raw: 18,
      effective: 16,
      truncated: true,
    });
  });

  it("creates one analysis task per imported source file", () => {
    const file = new File(["x"], "a.png", { type: "image/png" });
    const tasks = createAutoLogoTasks([
      { id: "g", name: "folder", path: "root/folder", files: [file] },
    ]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      groupId: "g",
      fileIndex: 0,
      copyIndex: 0,
      status: "waiting-analysis",
    });
  });

  it("adds and removes managed folder images without mutating other groups", () => {
    const first = new File(["a"], "a.png", { type: "image/png" });
    const second = new File(["b"], "b.png", { type: "image/png" });
    const groups = [
      { id: "a", name: "A", path: "root/A", files: [first] },
      { id: "b", name: "B", path: "root/B", files: [second] },
    ];

    const added = appendAutoLogoGroupFile(groups, "a", second);
    expect(added[0].files).toEqual([first, second]);
    expect(added[1]).toBe(groups[1]);

    const removed = removeAutoLogoGroupFile(added, "a", first);
    expect(removed[0].files).toEqual([second]);
    expect(removeAutoLogoGroupFile(removed, "a", second)).toEqual([groups[1]]);
  });
});
