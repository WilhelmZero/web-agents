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
      params: { ...DEFAULTS },
      initialParams: { ...DEFAULTS },
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

describe("automatic text layers", () => {
  it("fits manual lines, outlines and bold metrics without wrapping to the old width", async () => {
    const { fitLayoutTexts, setTextFont, autoTextMetrics } =
      await import("./layout-draw");
    const ctx = {
      font: "",
      measureText(this: { font: string }, s: string) {
        return {
          width: s.length * (this.font.startsWith("bold") ? 15 : 10),
          actualBoundingBoxAscent: 40,
          actualBoundingBoxDescent: 10,
          actualBoundingBoxLeft: 3,
          actualBoundingBoxRight:
            s.length * (this.font.startsWith("bold") ? 15 : 10) + 5,
        };
      },
    } as unknown as CanvasRenderingContext2D;
    const t = {
      ...layout.texts[0],
      text: "Memory\n2026",
      autoSize: true,
      width: 5,
    };
    expect(textLines(ctx, t).lines).toEqual(["Memory", "2026"]);
    const normal = await fitLayoutTexts(ctx, { ...layout, texts: [t] });
    const bold = await fitLayoutTexts(ctx, {
      ...layout,
      texts: [{ ...t, bold: true }],
    });
    expect(bold.texts[0].width).toBeGreaterThan(normal.texts[0].width);
    expect(normal.texts[0].height).toBe(120);
    expect(await fitLayoutTexts(ctx, bold)).toBe(bold);
    setTextFont(ctx, { ...t, bold: true }, "font");
    expect(ctx.font).toBe('bold 50px "font"');
    expect(
      autoTextMetrics(ctx, { ...t, letterSpacing: -100 }).width,
    ).toBeGreaterThan(1);
  });
  it("resizes via font size and reorders layers without mutating the source", async () => {
    const { resizeText, reorderTextLayers } = await import("./layout-edit");
    expect(resizeText(layout.texts[0], 2)).toMatchObject({
      fontSize: 100,
      width: 1120,
      height: 300,
      autoSize: true,
    });
    expect(resizeText(layout.texts[0], -1).fontSize).toBe(1);
    const texts = [
      layout.texts[0],
      { ...layout.texts[0], id: "b" },
      { ...layout.texts[0], id: "c" },
    ];
    expect(reorderTextLayers(texts, "t", "c").map((t) => t.id)).toEqual([
      "b",
      "c",
      "t",
    ]);
    expect(texts.map((t) => t.id)).toEqual(["t", "b", "c"]);
    expect(reorderTextLayers(texts, "image", "c")).toBe(texts);
  });
});

it("validates optional paint data and preserves it across result history", () => {
  const painted: EngravingLayout = {
    ...layout,
    strokes: [{ color: "#000000", size: 25, points: [{ x: 10, y: 20 }] }],
  };
  expect(validateLayout(painted)).toBe(painted);
  expect(() =>
    validateLayout({
      ...painted,
      strokes: [{ ...painted.strokes![0], size: NaN }],
    }),
  ).toThrow("画笔数据无效");
  expect(() =>
    validateLayout({
      ...painted,
      strokes: [{ ...painted.strokes![0], points: [] }],
    }),
  ).toThrow();
  const result: StoredResult = {
    job: {
      id: "paint",
      blob: new Blob(),
      width: 600,
      height: 600,
      warnings: [],
    },
    params: { ...DEFAULTS, layout: painted },
    initialParams: { ...DEFAULTS },
    reviews: [],
    createdAt: 1,
  };
  const restored = restoreTask({
    version: 1,
    fileName: "paint.png",
    params: { ...DEFAULTS },
    results: [result],
  });
  expect(restored.results![0].params.layout?.strokes).toEqual(painted.strokes);
});

it("renders black and white strokes after text with round tips, including a single click", async () => {
  const operations: string[] = [];
  const ctx = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    measureText: (s: string) => ({ width: s.length * 10 }),
    strokeText: vi.fn(),
    fillText: () => operations.push("text"),
    arc: vi.fn(),
    fill() {
      operations.push(this.fillStyle);
    },
    fillStyle: "",
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
  };
  const painted: EngravingLayout = {
    ...layout,
    strokes: [
      { color: "#000000", size: 10, points: [{ x: 1, y: 2 }] },
      {
        color: "#ffffff",
        size: 20,
        points: [
          { x: 3, y: 4 },
          { x: 5, y: 6 },
        ],
      },
    ],
  };
  await drawLayout(ctx as unknown as CanvasRenderingContext2D, painted, {
    width: 600,
    height: 600,
  } as CanvasImageSource);
  expect(operations).toEqual(["text", "#000000", "#ffffff"]);
  expect(ctx.arc).toHaveBeenCalledWith(1, 2, 5, 0, Math.PI * 2);
  expect(ctx.lineTo).toHaveBeenCalledWith(5, 6);
  expect(ctx.stroke).toHaveBeenCalledTimes(1);
});

it("isolates erasing from photo and text and preserves the output transform", async () => {
  const { drawBrushStrokes } = await import("./layout-draw");
  const transform = { a: 2, b: 0, c: 0, d: 2, e: 10, f: 10 };
  const operations: string[] = [];
  const paint = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    arc: vi.fn(),
    fill() {
      operations.push(this.globalCompositeOperation);
    },
    globalCompositeOperation: "",
    setTransform: vi.fn(),
  };
  const parent = {
    canvas: { width: 1200, height: 1800 },
    getTransform: () => transform,
    save: vi.fn(),
    restore: vi.fn(),
    resetTransform: vi.fn(),
    drawImage: vi.fn(),
  };
  class Surface {
    getContext() {
      return paint;
    }
  }
  vi.stubGlobal("OffscreenCanvas", Surface);
  try {
    drawBrushStrokes(parent as unknown as CanvasRenderingContext2D, {
      ...layout,
      strokes: [
        { color: "#ffffff", size: 20, points: [{ x: 10, y: 10 }] },
        {
          mode: "erase",
          color: "#ffffff",
          size: 10,
          points: [{ x: 10, y: 10 }],
        },
        { color: "#000000", size: 5, points: [{ x: 10, y: 10 }] },
      ],
    });
    expect(operations).toEqual([
      "source-over",
      "destination-out",
      "source-over",
    ]);
    expect(paint.setTransform).toHaveBeenCalledWith(transform);
    expect(parent.resetTransform).toHaveBeenCalledOnce();
    expect(parent.drawImage).toHaveBeenCalledWith(expect.any(Surface), 0, 0);
    expect(parent).not.toHaveProperty("globalCompositeOperation");
  } finally {
    vi.unstubAllGlobals();
  }
});
