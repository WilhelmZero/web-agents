import type { AutoLogoClassificationTask } from "../types";
import { createId } from "../utils";

export interface AutoLogoFolderGroup {
  id: string;
  name: string;
  path: string;
  files: File[];
}

export function clampLogoCount(value: unknown) {
  const raw = Math.max(0, Math.floor(Number(value) || 0));
  return { raw, effective: Math.min(16, raw), truncated: raw > 16 };
}

export function allocateLogoIds(logoIds: string[], count: number) {
  if (!logoIds.length || count <= 0) return [];
  return Array.from(
    { length: Math.min(16, Math.floor(count)) },
    (_, index) => logoIds[index % logoIds.length],
  );
}

export function createAutoLogoTasks(
  groups: AutoLogoFolderGroup[],
): AutoLogoClassificationTask[] {
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

export function appendAutoLogoGroupFile(
  groups: AutoLogoFolderGroup[],
  groupId: string,
  file: File,
) {
  return groups.map((group) =>
    group.id === groupId ? { ...group, files: [...group.files, file] } : group,
  );
}

export function removeAutoLogoGroupFile(
  groups: AutoLogoFolderGroup[],
  groupId: string,
  target: File,
) {
  return groups.flatMap((group) => {
    if (group.id !== groupId) return [group];
    const files = group.files.filter((file) => file !== target);
    return files.length ? [{ ...group, files }] : [];
  });
}

export function autoLogoStatusLabel(
  status: AutoLogoClassificationTask["status"],
) {
  return (
    {
      "waiting-analysis": "等待分析",
      analyzing: "分析中",
      "waiting-generation": "等待生成",
      generating: "生成中",
      success: "成功",
      failed: "失败",
      stopped: "已停止",
      "skipped-no-logo": "未识别到 Logo，已输出原图",
    } as const
  )[status];
}
