import { describe, expect, it } from "vitest";
import {
  autoSceneStatusLabel,
  createAutoSceneTasks,
} from "./services/autoScenePipeline";

function file(name: string, path: string) {
  const value = new File(["image"], name, {
    type: "image/png",
    lastModified: 1,
  });
  Object.defineProperty(value, "webkitRelativePath", { value: path });
  return value;
}

describe("auto scene classification tasks", () => {
  it("creates one analysis task per imported source image and preserves folder identity", () => {
    const tasks = createAutoSceneTasks([
      {
        id: "folder-a",
        name: "A",
        path: "root/A",
        files: [
          file("one.png", "root/A/one.png"),
          file("two.png", "root/A/two.png"),
        ],
      },
    ]);
    expect(tasks).toHaveLength(2);
    expect(tasks.map((item) => item.status)).toEqual([
      "waiting-analysis",
      "waiting-analysis",
    ]);
    expect(tasks.map((item) => item.relativePath)).toEqual([
      "root/A",
      "root/A",
    ]);
  });

  it("provides user-facing labels for pipeline states", () => {
    expect(autoSceneStatusLabel("analyzing")).toBe("分析中");
    expect(autoSceneStatusLabel("waiting-generation")).toBe("等待生成");
    expect(autoSceneStatusLabel("skipped-white")).toBe("白底跳过");
  });
});
