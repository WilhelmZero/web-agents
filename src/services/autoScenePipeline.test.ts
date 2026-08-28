import { describe, expect, it } from "vitest";
import {
  appendAutoSceneGroupFile,
  createAutoSceneTasks,
  removeAutoSceneGroupFile,
} from "./autoScenePipeline";

describe("auto scene pipeline", () => {
  it("creates one analysis task for every managed image", () => {
    const file = new File(["a"], "a.png", { type: "image/png" });
    expect(
      createAutoSceneTasks([
        { id: "g", name: "G", path: "root/G", files: [file] },
      ]),
    ).toEqual([
      expect.objectContaining({
        groupId: "g",
        fileIndex: 0,
        status: "waiting-analysis",
      }),
    ]);
  });

  it("adds and removes folder images without mutating other groups", () => {
    const first = new File(["a"], "a.png", { type: "image/png" });
    const second = new File(["b"], "b.png", { type: "image/png" });
    const groups = [
      { id: "a", name: "A", path: "root/A", files: [first] },
      { id: "b", name: "B", path: "root/B", files: [second] },
    ];
    const added = appendAutoSceneGroupFile(groups, "a", second);
    expect(added[0].files).toEqual([first, second]);
    expect(added[1]).toBe(groups[1]);
    const removed = removeAutoSceneGroupFile(added, "a", first);
    expect(removed[0].files).toEqual([second]);
    expect(removeAutoSceneGroupFile(removed, "a", second)).toEqual([groups[1]]);
  });
});
