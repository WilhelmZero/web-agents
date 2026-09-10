import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import LaserPreview from "./LaserPreview";
import { processInWorker } from "../services/engraving/workerClient";
import { DEFAULTS } from "../services/engraving/processing.mjs";
import type { StoredResult } from "../services/engraving/types";
vi.mock("../services/engraving/workerClient", () => ({
  processInWorker: vi.fn(() => new Promise(() => {})),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("snapshots all current parameters, renders full resolution dither and cancels on close", () => {
  const result: StoredResult = {
    job: {
      id: "a",
      blob: new Blob(["source"]),
      width: 400,
      height: 600,
      warnings: [],
    },
    params: {
      ...DEFAULTS,
      crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.6 },
      eraseMask: "mask",
      invert: true,
      widthMm: 45,
      dpi: 600,
      preview: true,
    },
    initialParams: { ...DEFAULTS },
    reviews: [],
    createdAt: 1,
  };
  const view = render(<LaserPreview result={result} onClose={() => {}} />);
  expect(processInWorker).toHaveBeenCalledWith(
    result.job.blob,
    { ...result.params, mode: "dither", preview: false },
    expect.any(AbortSignal),
  );
  expect(screen.getByRole("button", { name: "下载雕刻用图" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "3D预览" })).toBeDisabled();
  view.rerender(
    <LaserPreview
      result={{ ...result, params: { ...result.params, dpi: 72 } }}
      onClose={() => {}}
    />,
  );
  expect(processInWorker).toHaveBeenCalledTimes(1);
  const signal = vi.mocked(processInWorker).mock.calls[0][2]!;
  view.unmount();
  expect(signal.aborted).toBe(true);
});
it("aborts old work when switching mode and does not mutate original parameters", async () => {
  const result: StoredResult = {
    job: {
      id: "a",
      blob: new Blob(["source"]),
      width: 400,
      height: 600,
      warnings: [],
    },
    params: { ...DEFAULTS, mode: "grayscale" },
    initialParams: { ...DEFAULTS },
    reviews: [],
    createdAt: 1,
  };
  render(<LaserPreview result={result} onClose={() => {}} />);
  const signal = vi.mocked(processInWorker).mock.calls[0][2]!;
  fireEvent.mouseDown(screen.getByRole("combobox"));
  fireEvent.click(await screen.findByText("连续灰度"));
  await waitFor(() => expect(processInWorker).toHaveBeenCalledTimes(2));
  expect(signal.aborted).toBe(true);
  expect(vi.mocked(processInWorker).mock.calls[1][1]).toMatchObject({
    mode: "grayscale",
    preview: false,
  });
  expect(result.params.mode).toBe("grayscale");
});
