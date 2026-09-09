import { expect, it } from "vitest";
import { DEFAULTS } from "./processing.mjs";
import { taskResults, changeResultParams, mergeReviews } from "./results";
import type { SavedTask, AutoRun, Round } from "./types";
const job = (id: string) => ({
  id,
  blob: new Blob([id]),
  width: 100,
  height: 100,
  warnings: [],
});
it("migrates legacy results and edits only one image without mutating review snapshots", () => {
  const a = job("a"),
    b = job("b");
  const round: Round = {
    job: a,
    params: { ...DEFAULTS },
    round: 1,
    action: "generate",
    reviewAction: "adjust",
    score: 80,
    passed: false,
    issueLabels: [],
    issues: [],
    scores: {
      identity: 80,
      subjects: 80,
      hair: 80,
      texture: 80,
      background: 80,
      tones: 80,
    },
    adjustments: {
      texture: 65,
      contrast: 50,
      brightness: 50,
      shadow: 30,
      blackPoint: 10,
    },
  };
  const task: SavedTask = {
    version: 1,
    fileName: "x",
    params: { ...DEFAULTS },
    job: b,
    run: {
      status: "limit",
      phase: "",
      maxRounds: 2,
      targetScore: 85,
      generations: 2,
      checks: 1,
      best: round,
      rounds: [round],
      fallback: { job: b, params: { ...DEFAULTS }, round: 2 },
    },
  };
  const results = taskResults(task);
  expect(results).toHaveLength(2);
  const next = changeResultParams({ ...task, results }, "a", {
    texture: 90,
    eraseMask: "mask",
  });
  expect(next.results?.[0].params.texture).toBe(90);
  expect(next.results?.[1].params.texture).toBe(65);
  expect(next.params.texture).toBe(65);
  expect(round.params.texture).toBe(65);
  expect(next.results?.[0].initialParams.texture).toBe(65);
});
it("keeps previously generated results when merging a new run and preserves custom references", () => {
  const task: SavedTask = {
    version: 1,
    fileName: "x",
    job: job("old"),
    params: { ...DEFAULTS },
    customReference: new Blob(["ref"]),
  };
  const results = taskResults(task);
  const merged = mergeReviews(results, { rounds: [] } as unknown as AutoRun);
  expect(merged).toEqual(results);
  expect(merged[0].job.blob).toBe(task.job?.blob);
  const selected = changeResultParams({ ...task, results }, "old", { dpi: 96 });
  expect(selected.params.dpi).toBe(96);
  expect(selected.customReference).toBe(task.customReference);
});
