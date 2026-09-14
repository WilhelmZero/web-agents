import { describe, it, expect, vi } from "vitest";
import { validateLayout } from "./layout-types";
import type { EngravingLayout } from "./layout-types";
import { textLines, drawLayout } from "./layout-draw";
import { exportDimensions, EXPORT_DEFAULTS } from "./export";
import { changeResultParams, mergeReviews } from "./results";
import { restoreTask } from "./storage";
import { DEFAULTS } from "./processing.mjs";
import type { SavedTask, StoredResult, AutoRun } from "./types";
vi.mock("./layout-fonts", () => ({
  ensureLayoutFont: vi.fn(async () => "test-font"),
}));
const layout: EngravingLayout = {
  version: 1,
  width: 600,
  height: 900,
  image: { x: 0, y: 0, width: 600, height: 600 },
  texts: [
    {
      id: "t",
      text: "Memory 2026",
      x: 20,
      y: 650,
      width: 560,
      height: 150,
      font: "great-vibes",
      fontSize: 50,
      color: "#ffffff",
      align: "center",
      lineHeight: 1.2,
      letterSpacing: 0,
      strokeWidth: 4,
      strokeColor: "#000000",
    },
  ],
};
describe("editable engraving layout", () => {
  it("validates dimensions and rejects corrupt font/text properties", () => {
    expect(validateLayout(layout)).toBe(layout);
    expect(() => validateLayout({ ...layout, width: 9000 })).toThrow();
    expect(() =>
      validateLayout({
        ...layout,
        texts: [{ ...layout.texts[0], fontSize: NaN }],
      }),
    ).toThrow();
  });
  it("uses the expanded aspect ratio for export and retains layout in result history", () => {
    const result: StoredResult = {
      job: { id: "a", blob: new Blob(), width: 600, height: 600, warnings: [] },
      params: { ...DEFAULTS }, initialParams: { ...DEFAULTS },
      reviews: [],
      createdAt: 1,
    };
    const task: SavedTask = {
      version: 1,
      fileName: "a.png",
      params: { ...DEFAULTS },
      results: [result],
    };
    const updated = changeResultParams(task, "a", { layout });
    expect(updated.params.layout).toBeUndefined();
    const saved = restoreTask(updated).results![0];
    expect(saved.params.layout).toEqual(layout);
    expect(
      exportDimensions(saved, {
        ...EXPORT_DEFAULTS,
        unit: "px",
        pixelWidth: 600,
        pixelMargin: 0,
      }),
    ).toMatchObject({ width: 600, height: 900 });
    const merged = mergeReviews([saved], {
      rounds: [{ job: result.job, params: { ...DEFAULTS, texture: 20 } }],
    } as AutoRun);
    expect(merged[0].params.layout).toEqual(layout);
    expect(
      changeResultParams(updated, "a", { crop: null }).results![0].params
        .layout,
    ).toEqual(layout);
  });
  it("wraps words, manual newlines and oversized words", () => {
    const ctx = {
      measureText: (s: string) => ({ width: s.length * 10 }),
    } as CanvasRenderingContext2D;
    expect(
      textLines(ctx, {
        ...layout.texts[0],
        text: "Hello world\n123456",
        width: 50,
      }).lines,
    ).toEqual(["Hello", "world", "12345", "6"]);
  });
  it("draws outlines before fill, centers text and flags overflowing boxes", async () => {
    const operations: string[] = [];
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      measureText: (s: string) => ({
        width: s.length * 10,
        actualBoundingBoxAscent: 40,
        actualBoundingBoxDescent: 10,
      }),
      strokeText: vi.fn(() => operations.push("stroke")),
      fillText: vi.fn(() => operations.push("fill")),
    } as unknown as CanvasRenderingContext2D;
    expect(
      await drawLayout(ctx, layout, {
        width: 600,
        height: 600,
      } as CanvasImageSource),
    ).toEqual([]);
    expect(operations).toEqual(["stroke", "fill"]);
    expect(ctx.fillText).toHaveBeenCalledWith("Memory 2026", 245, 690);
    expect(
      await drawLayout(
        ctx,
        { ...layout, texts: [{ ...layout.texts[0], height: 10 }] },
        { width: 600, height: 600 } as CanvasImageSource,
      ),
    ).toEqual(["t"]);
  });
});
