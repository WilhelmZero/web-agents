import type { AutoSceneClassificationTask } from "../types";
import { createId } from "../utils";

export interface AutoSceneFolderGroup {
  id: string;
  name: string;
  path: string;
  files: File[];
}

export function autoSceneStatusLabel(
  status: AutoSceneClassificationTask["status"],
) {
  return (
    {
      "waiting-analysis": "等待分析",
      analyzing: "分析中",
      classified: "已分类",
      "waiting-generation": "等待生成",
      generating: "生成中",
      success: "成功",
      failed: "失败",
      stopped: "已停止",
      "skipped-white": "白底跳过",
    } as const
  )[status];
}

export function createAutoSceneTasks(
  groups: AutoSceneFolderGroup[],
): AutoSceneClassificationTask[] {
  return groups.flatMap((group) =>
    group.files.map((file, fileIndex) => ({
      id: createId(),
      groupId: group.id,
      groupName: group.name,
      relativePath: group.path,
      file,
      fileIndex,
      copyIndex: 0,
      status: "waiting-analysis" as const,
      analysisRetryCount: 0,
      generationRetryCount: 0,
    })),
  );
}

export function appendAutoSceneGroupFile(
  groups: AutoSceneFolderGroup[],
  groupId: string,
  file: File,
) {
  return groups.map((group) =>
    group.id === groupId ? { ...group, files: [...group.files, file] } : group,
  );
}

export function removeAutoSceneGroupFile(
  groups: AutoSceneFolderGroup[],
  groupId: string,
  target: File,
) {
  return groups.flatMap((group) => {
    if (group.id !== groupId) return [group];
    const files = group.files.filter((file) => file !== target);
    return files.length ? [{ ...group, files }] : [];
  });
}
