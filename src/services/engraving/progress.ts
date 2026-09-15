import type { SavedTask } from "./types";
export function engravingProgress(
  states: { id: string; busy?: boolean; task?: SavedTask }[],
  batch: boolean,
  finishedIds: string[],
) {
  const uploaded = states.filter((s) => s.task?.original);
  const finished = uploaded.filter(
    (s) =>
      !s.busy &&
      (batch
        ? finishedIds.includes(s.id)
        : s.task?.run && s.task.run.status !== "running"),
  );
  return {
    id: "custom-monochrome-logo",
    label: "客户定制黑白 Logo",
    total: uploaded.length,
    completed: finished.length,
    failed: finished.filter((s) => s.task?.run?.status === "failed").length,
    running: batch || uploaded.some((s) => s.busy),
  };
}
