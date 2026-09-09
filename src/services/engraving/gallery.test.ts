import { afterEach, expect, it, vi } from "vitest";
import {
  cropPixels,
  DEFAULTS,
  outputDimensions,
  validateOptions,
} from "./processing.mjs";
import {
  changeResultParams,
  mergeReviews,
  clearTaskResults,
  taskResults,
} from "./results";
import {
  exportDimensions,
  EXPORT_DEFAULTS,
  loadExportSettings,
  renderExportBatch,
  saveExportSettings,
  snapshotExport,
} from "./export";
import type { AutoRun, Round, StoredResult, SavedTask } from "./types";
const result = (id = "one"): StoredResult => ({
  job: {
    id,
    blob: new Blob(["source"]),
    width: 400,
    height: 600,
    warnings: [],
  },
  params: { ...DEFAULTS },
  initialParams: { ...DEFAULTS },
  reviews: [],
  createdAt: 1,
});
afterEach(() => localStorage.clear());
it("clears every result and legacy fallback while retaining original and reference", () => {
  const r = result(),
    original = new Blob(["original"]),
    reference = new Blob(["reference"]);
  const task: SavedTask = {
    version: 1,
    fileName: "photo.png",
    original,
    customReference: reference,
    params: { ...DEFAULTS },
    results: [r],
    job: r.job,
    startedAt: 1,
    endedAt: 2,
    run: {
      status: "completed",
      phase: "",
      maxRounds: 1,
      targetScore: 85,
      generations: 1,
      checks: 0,
      best: null,
      rounds: [],
      fallback: { job: r.job, params: r.params, round: 1 },
    } as AutoRun,
  };
  const cleared = clearTaskResults(task);
  expect(taskResults(cleared)).toEqual([]);
  expect(cleared.job).toBeUndefined();
  expect(cleared.run).toBeUndefined();
  expect(cleared.original).toBe(original);
  expect(cleared.customReference).toBe(reference);
  expect(cleared.fileName).toBe("photo.png");
  expect(task.results).toHaveLength(1);
});
it("upgrades old export defaults but keeps new explicit DPI and margin choices", () => {
  localStorage.setItem(
    "custom-monochrome-logo:export:v1",
    JSON.stringify({
      version: 1,
      settings: {
        ...EXPORT_DEFAULTS,
        dpi: 300,
        margin: 4,
        pixelWidth: 945,
        pixelMargin: 47,
      },
    }),
  );
  expect(loadExportSettings()).toEqual(EXPORT_DEFAULTS);
  saveExportSettings({ ...EXPORT_DEFAULTS, dpi: 300, margin: 4 });
  expect(loadExportSettings()).toMatchObject({ dpi: 300, margin: 4 });
});
it("converts normalized crops to bounded pixel rectangles and rejects invalid regions", () => {
  expect(
    cropPixels(400, 600, { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }),
  ).toEqual({ x: 100, y: 150, width: 200, height: 300 });
  expect(cropPixels(400, 600, null)).toEqual({
    x: 0,
    y: 0,
    width: 400,
    height: 600,
  });
  expect(
    cropPixels(3, 3, { x: 0.99, y: 0.99, width: 0.01, height: 0.01 }),
  ).toEqual({ x: 2, y: 2, width: 1, height: 1 });
  for (const crop of [
    { x: 0, y: 0, width: 0, height: 1 },
    { x: 0.5, y: 0, width: 1, height: 1 },
    { x: NaN, y: 0, width: 1, height: 1 },
  ])
    expect(() => cropPixels(400, 600, crop)).toThrow();
});
it("uses cropped aspect ratios, exact pixel widths, margins and existing millimeter defaults", () => {
  const r = result();
  expect(exportDimensions(r, EXPORT_DEFAULTS)).toMatchObject({
    width: 2520,
    margin: 0,
  });
  r.params.crop = { x: 0, y: 0, width: 0.5, height: 1 };
  expect(
    exportDimensions(r, {
      ...EXPORT_DEFAULTS,
      unit: "px",
      pixelWidth: 1000,
      pixelMargin: 20,
    }),
  ).toMatchObject({ width: 1000, height: 2920, margin: 20 });
  expect(() =>
    exportDimensions(r, {
      ...EXPORT_DEFAULTS,
      unit: "px",
      pixelWidth: 8192,
      pixelMargin: 0,
    }),
  ).toThrow();
  expect(() =>
    outputDimensions(
      400,
      600,
      validateOptions({ ...DEFAULTS, pixelWidth: 100, pixelMargin: 50 }),
    ),
  ).toThrow();
  expect(() => validateOptions({ ...DEFAULTS, pixelWidth: 100.5 })).toThrow();
});
it("retains manual parameters, crop and erase mask when an in-flight review updates automatic parameters", () => {
  const r = result(),
    task: SavedTask = {
      version: 1,
      fileName: "x",
      params: { ...DEFAULTS },
      job: r.job,
      results: [r],
    };
  const edited = changeResultParams(task, r.job.id, {
    texture: 92,
    crop: { x: 0, y: 0, width: 0.5, height: 0.5 },
    eraseMask: "mask",
  });
  const review = {
    job: r.job,
    params: { ...DEFAULTS, texture: 20, brightness: 70 },
    round: 1,
  } as Round;
  const merged = mergeReviews(edited.results!, { rounds: [review] } as AutoRun);
  expect(merged[0].params).toMatchObject({
    texture: 92,
    brightness: 70,
    eraseMask: "mask",
    crop: { width: 0.5 },
  });
  expect(task.params.texture).toBe(65);
  expect(merged[0].initialParams.texture).toBe(65);
  expect(merged[0].reviews[0].params.texture).toBe(20);
  const reset = changeResultParams({ ...task, results: merged }, r.job.id, {
    crop: null,
  });
  expect(
    mergeReviews(reset.results!, { rounds: [review] } as AutoRun)[0].params
      .crop,
  ).toBeNull();
});
it("persists independent export settings and falls back for invalid stored settings", () => {
  const settings = {
    ...EXPORT_DEFAULTS,
    unit: "px" as const,
    pixelWidth: 1000,
    dpi: 96,
  };
  saveExportSettings(settings);
  expect(loadExportSettings()).toEqual(settings);
  localStorage.setItem(
    "custom-monochrome-logo:export:v1",
    JSON.stringify({ version: 1, settings: { pixelWidth: -10 } }),
  );
  expect(loadExportSettings()).toEqual(EXPORT_DEFAULTS);
});
it("snapshots selected results and renders sequentially, preserving successful files when another fails", async () => {
  const a = result("a"),
    b = result("b");
  const items = snapshotExport([a, b], EXPORT_DEFAULTS);
  a.params.texture = 10;
  a.params.crop = { x: 0, y: 0, width: 0.5, height: 0.5 };
  expect(items[0].params.texture).toBe(65);
  expect(items[0].params.crop).toBeUndefined();
  let active = 0,
    max = 0;
  const render = vi.fn(async () => {
    active++;
    max = Math.max(active, max);
    await Promise.resolve();
    active--;
    if (render.mock.calls.length === 2) throw new Error("mock failure");
    return { buffer: new Blob(["png"]), width: 945, height: 945, warnings: [] };
  });
  const progress = vi.fn(),
    out = await renderExportBatch(items, render, progress);
  expect(max).toBe(1);
  expect(out.files).toHaveLength(1);
  expect(out.errors[0]).toContain("mock failure");
  expect(progress.mock.calls).toEqual([[1], [2]]);
});
