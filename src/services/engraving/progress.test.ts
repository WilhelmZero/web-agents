import { expect, it } from "vitest";
import { engravingProgress } from "./progress";
import { buildTaskPageTitle } from "../taskProgress";
const state = (id: string, status: string, busy = false) =>
  ({
    id,
    busy,
    task: { original: new Blob(["photo"]), run: { status } },
  }) as any;
it("reports queued batches, retry, stop, failure and cleared tasks to the shared title state", () => {
  const old = state("a", "completed"),
    failed = state("b", "failed");
  expect(engravingProgress([old, failed], true, [])).toMatchObject({
    completed: 0,
    total: 2,
    failed: 0,
    running: true,
  });
  expect(engravingProgress([old, failed], true, ["b"])).toMatchObject({
    completed: 1,
    failed: 1,
    running: true,
  });
  expect(
    engravingProgress([old, state("b", "running", true)], false, []),
  ).toMatchObject({ completed: 1, total: 2, failed: 0, running: true });
  const stopped = engravingProgress([old, state("b", "cancelled")], false, []);
  expect(stopped).toMatchObject({ running: false, failed: 0 });
  expect(
    buildTaskPageTitle(
      stopped.completed,
      stopped.running ? stopped.total : 0,
      stopped.failed,
    ),
  ).toBe("🟢 Scene Studio");
  const error = engravingProgress([old, failed], false, []);
  expect(buildTaskPageTitle(error.completed, 0, error.failed)).toBe(
    "🔴 Scene Studio",
  );
  expect(engravingProgress([], false, [])).toMatchObject({
    completed: 0,
    total: 0,
    failed: 0,
    running: false,
  });
});
