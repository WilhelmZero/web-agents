import { describe, expect, it } from "vitest";
import type { SceneReplaceTask } from "../types";
import { stopSceneTaskPreservingLastResult } from "./sceneResultState";

function task(overrides: Partial<SceneReplaceTask> = {}): SceneReplaceTask {
  return {
    id: "task-1",
    sceneId: "scene-1",
    sceneIndex: 0,
    copyIndex: 0,
    status: "waiting",
    prompt: "替换场景",
    retryCount: 1,
    ...overrides,
  };
}

describe("scene result stop state", () => {
  it("keeps the latest low-change image and explains why it is shown", () => {
    const resultBlob = new Blob(["last-result"], { type: "image/png" });
    const stopped = stopSceneTaskPreservingLastResult(
      task({ resultBlob, resultUrl: "blob:last", changedRatio: 0.12 }),
    );

    expect(stopped.status).toBe("stopped");
    expect(stopped.resultBlob).toBe(resultBlob);
    expect(stopped.resultUrl).toBe("blob:last");
    expect(stopped.insufficientChangeWarning).toContain(
      "用户已手动停止后续重新生成",
    );
    expect(stopped.insufficientChangeWarning).toContain("12.0%");
  });

  it("uses the ordinary stopped state when there is no retained result", () => {
    const stopped = stopSceneTaskPreservingLastResult(task());
    expect(stopped.resultBlob).toBeUndefined();
    expect(stopped.insufficientChangeWarning).toBeUndefined();
    expect(stopped.error).toBe("已停止该任务");
  });
});
