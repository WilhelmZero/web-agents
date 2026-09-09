import type { AutoRun, SavedTask, StoredResult, RenderParams } from "./types";

export function taskResults(task: SavedTask): StoredResult[] {
  if (task.results) return task.results;
  const entries = [
    ...(task.run?.rounds || []),
    ...(task.run?.fallback ? [task.run.fallback] : []),
    ...(task.job ? [{ job: task.job, params: task.params }] : []),
  ];
  const byId = new Map<string, StoredResult>();
  for (const entry of entries) {
    const existing = byId.get(entry.job.id);
    byId.set(entry.job.id, {
      job: entry.job,
      params: entry.params,
      initialParams: existing?.initialParams || entry.params,
      reviews: task.run?.rounds.filter((r) => r.job.id === entry.job.id) || [],
      createdAt: task.startedAt || 0,
    });
  }
  return [...byId.values()];
}

export function mergeReviews(
  results: StoredResult[],
  run: AutoRun,
): StoredResult[] {
  return results.map((result) => {
    const reviews = run.rounds.filter((r) => r.job.id === result.job.id);
    if (!reviews.length) return result;
    if (
      reviews.length === result.reviews.length &&
      reviews.every((review, index) => review === result.reviews[index])
    )
      return result;
    return {
      ...result,
      reviews,
      params: { ...reviews[reviews.length - 1].params, ...result.manualParams },
    };
  });
}

export function changeResultParams(
  task: SavedTask,
  id: string,
  patch: Partial<RenderParams>,
): SavedTask {
  const results = taskResults(task).map((result) =>
    result.job.id === id
      ? {
          ...result,
          params: { ...result.params, ...patch },
          manualParams: { ...result.manualParams, ...patch },
        }
      : result,
  );
  // task.params belongs to the automatic pipeline, never to the result editor.
  return { ...task, results };
}
