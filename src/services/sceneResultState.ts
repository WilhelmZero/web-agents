import type { SceneReplaceTask } from "../types";
import { isInsufficientImageChange } from "./imageChangeDetection";

export function stopSceneTaskPreservingLastResult(
  task: SceneReplaceTask,
): SceneReplaceTask {
  const preservesLowChangeResult =
    Boolean(task.resultBlob) &&
    typeof task.changedRatio === "number" &&
    isInsufficientImageChange(task.changedRatio);

  if (!preservesLowChangeResult) {
    return {
      ...task,
      status: "stopped",
      autoRetryStopped: true,
      nextRetryAt: undefined,
      error: "已停止该任务",
    };
  }

  const detail = `场景变化检测未通过：仅 ${(task.changedRatio! * 100).toFixed(
    1,
  )}% 像素发生明显变化，不超过 20%`;
  return {
    ...task,
    status: "stopped",
    autoRetryStopped: true,
    nextRetryAt: undefined,
    error: "已停止后续重新生成，保留最后一张生成图",
    insufficientChangeWarning: `${detail}；用户已手动停止后续重新生成，已保留最后一张生成图，请人工确认`,
  };
}
