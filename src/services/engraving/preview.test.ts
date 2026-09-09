import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useEngravingPreview } from "./preview";
import { processInWorker } from "./workerClient";
import { DEFAULTS } from "./processing.mjs";
import type { Rendered } from "./types";
vi.mock("./workerClient", () => ({ processInWorker: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it("debounces edits, aborts the old job and ignores its late result", async () => {
  vi.useFakeTimers();
  const resolve: ((value: Rendered) => void)[] = [];
  vi.mocked(processInWorker).mockImplementation(
    () => new Promise((done) => resolve.push(done)),
  );
  const source = new Blob(["source"]),
    initial = { ...DEFAULTS };
  const hook = renderHook(({ params }) => useEngravingPreview(source, params), {
    initialProps: { params: initial },
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(350);
  });
  hook.rerender({ params: { ...DEFAULTS, texture: 90 } });
  expect(vi.mocked(processInWorker).mock.calls[0][2]?.aborted).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(350);
  });
  const newer = new Blob(["new"]);
  await act(async () =>
    resolve[1]({ buffer: newer, width: 100, height: 100, warnings: [] }),
  );
  expect(hook.result.current.blob).toBe(newer);
  await act(async () =>
    resolve[0]({
      buffer: new Blob(["old"]),
      width: 100,
      height: 100,
      warnings: [],
    }),
  );
  expect(hook.result.current.blob).toBe(newer);
});
