import { describe, expect, it } from "vitest";
import {
  AUTO_LAYOUT_SCALE_FACTORS,
  analyzePixels,
  automaticPathCount,
  arrangeLocal,
  blankRatio,
  fixedPathDividerPoints,
  fixedPathPoints,
  respectsDecorationSpacing,
  rotatedBoundaryPoints,
} from "./localAdaptation";
import { DEFAULT_CUP, distanceToEdge, geometry, inside } from "./geometry";
import type { LocalObject } from "./types";

function pixels(
  w: number,
  h: number,
  bg: [number, number, number, number],
  rects: {
    x: number;
    y: number;
    w: number;
    h: number;
    color: [number, number, number, number];
  }[],
) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) d.set(bg, i * 4);
  for (const r of rects)
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) d.set(r.color, (y * w + x) * 4);
  return d;
}
describe("local cup artwork analysis", () => {
  it("measures transparent gaps and enforces two-width decoration spacing", () => {
    const alpha = new Uint8Array(100);
    for (let y = 2; y < 4; y++)
      for (let x = 2; x < 4; x++) alpha[y * 10 + x] = 255;
    expect(blankRatio(alpha, 10, 10, 6, 6, 2, 2)).toBe(1);
    expect(blankRatio(alpha, 10, 10, 2, 2, 2, 2)).toBe(0);
    expect(
      respectsDecorationSpacing(19, 10, 5, [{ x: 10, y: 10, width: 5 }]),
    ).toBe(false);
    expect(
      respectsDecorationSpacing(20, 10, 5, [{ x: 10, y: 10, width: 5 }]),
    ).toBe(true);
  });

  it.each([
    [[255, 255, 255, 255] as const, "white"],
    [[20, 80, 160, 255] as const, "solid"],
    [[0, 0, 0, 0] as const, "transparent"],
  ])("recognizes %s background", (bg, _name) => {
    const r = analyzePixels(
      pixels(100, 80, bg as [number, number, number, number], [
        { x: 20, y: 20, w: 25, h: 30, color: [20, 20, 20, 255] },
      ]),
      100,
      80,
    );
    expect(r.confidence).toBeGreaterThan(0.9);
    expect(
      r.regions.some((v) => v.role === "main" || v.role === "anchor"),
    ).toBe(true);
  });
  it("exposes low confidence for a varied border", () => {
    const d = pixels(40, 40, [255, 255, 255, 255], []);
    for (let x = 0; x < 40; x++)
      d.set(x % 2 ? [0, 0, 0, 255] : [255, 255, 255, 255], x * 4);
    expect(analyzePixels(d, 40, 40).confidence).toBeLessThan(0.65);
  });
});
describe("local cup layout", () => {
  const blob = new Blob(["x"], { type: "image/png" });
  const object = (
    id: string,
    x: number,
    y: number,
    w: number,
    h: number,
    role: "anchor" | "main" | "decoration",
  ): LocalObject => ({ id, blob, rect: { x, y, width: w, height: h }, role });
  it("limits automatic per-subject scaling to ten percent", () => {
    expect(AUTO_LAYOUT_SCALE_FACTORS).toEqual([1, 0.95, 0.9]);
  });
  it.each([
    DEFAULT_CUP,
    { ...DEFAULT_CUP, top: 34, bottom: 40 },
    { ...DEFAULT_CUP, bottom: 40 },
  ])("keeps objects inside the safe dieline", (cup) => {
    const input = {
      sourceWidth: 500,
      sourceHeight: 400,
      objects: [
        object("main", 150, 100, 120, 100, "main"),
        object("star", 20, 20, 15, 15, "decoration"),
      ],
      fill: 40,
      gap: 2,
      scale: 0.55,
      seed: 7,
    };
    const a = arrangeLocal(input, cup),
      b = arrangeLocal(input, cup);
    expect(a.layers.map((v) => [v.id, v.x, v.y])).toEqual(
      b.layers.map((v) => [v.id, v.x, v.y]),
    );
    const g = geometry(cup);
    for (const l of a.layers) {
      const object = input.objects.find((o) => o.id === l.sourceObjectId)!;
      const h = (l.width * object.rect.height) / object.rect.width;
      for (const point of rotatedBoundaryPoints(
        l.x,
        l.y,
        l.width,
        h,
        l.rotation,
      )) {
        expect(inside(point, g.points)).toBe(true);
        expect(distanceToEdge(point, g.points)).toBeGreaterThanOrEqual(4);
      }
    }
  });
  it("duplicates only decorations within limits", () => {
    const r = arrangeLocal(
      {
        sourceWidth: 500,
        sourceHeight: 400,
        objects: [
          object("main", 150, 100, 100, 80, "main"),
          object("star", 20, 20, 12, 12, "decoration"),
        ],
        fill: 100,
        gap: 1,
        scale: 0.4,
        seed: 2,
      },
      DEFAULT_CUP,
    );
    expect(
      r.layers.filter((v) => v.id.includes("copy")).length,
    ).toBeLessThanOrEqual(4);
    expect(r.layers.some((v) => v.id.startsWith("main-copy"))).toBe(false);
  });
  it("places decorations below subjects and keeps them between subjects", () => {
    const r = arrangeLocal(
        {
          sourceWidth: 500,
          sourceHeight: 320,
          objects: [
            object("left-main", 30, 90, 90, 80, "main"),
            object("right-main", 380, 90, 90, 80, "main"),
            object("star", 220, 120, 18, 18, "decoration"),
          ],
          fill: 100,
          gap: 1,
          scale: 0.45,
          seed: 3,
        },
        DEFAULT_CUP,
      ),
      subjectIndexes = r.layers
        .map((layer, index) => ({ layer, index }))
        .filter(({ layer }) => layer.id.includes("main"))
        .map(({ index }) => index),
      decorationIndexes = r.layers
        .map((layer, index) => ({ layer, index }))
        .filter(({ layer }) => layer.id.startsWith("star"))
        .map(({ index }) => index),
      subjects = r.layers.filter((layer) => layer.id.includes("main"));
    expect(Math.max(...decorationIndexes)).toBeLessThan(
      Math.min(...subjectIndexes),
    );
    expect(
      r.layers
        .filter((layer) => layer.id.startsWith("star"))
        .every((layer) => layer.layerRole === "decoration"),
    ).toBe(true);
    const left = Math.min(...subjects.map((layer) => layer.x));
    const right = Math.max(...subjects.map((layer) => layer.x));
    for (const decoration of r.layers.filter((layer) =>
      layer.id.startsWith("star"),
    )) {
      expect(decoration.x).toBeGreaterThanOrEqual(left);
      expect(decoration.x).toBeLessThanOrEqual(right);
    }
  });
  it("keeps the large anchor at its mapped source position and reserves path slots", () => {
    const objects = [
        object("anchor", 170, 120, 160, 90, "anchor"),
        object("core-left", 105, 125, 45, 55, "main"),
        object("core-right", 335, 125, 45, 55, "main"),
        object("core-star", 245, 210, 12, 12, "decoration"),
        object("outer-top", 20, 20, 45, 55, "main"),
        object("outer-bottom", 420, 315, 45, 55, "main"),
      ],
      r = arrangeLocal(
        {
          sourceWidth: 500,
          sourceHeight: 400,
          objects,
          fill: 0,
          gap: 1,
          scale: 0.45,
          seed: 1,
        },
        DEFAULT_CUP,
      ),
      anchor = r.layers.find((layer) => layer.sourceObjectId === "anchor")!,
      pathLayers = r.layers.filter((layer) => layer.pathIndex != null);
    expect(anchor).toBeTruthy();
    expect(anchor.layerRole).toBe("anchor");
    expect(r.layers.at(-1)?.sourceObjectId).toBe("anchor");
    expect(anchor.autoX).toBe(anchor.x);
    expect(anchor.autoY).toBe(anchor.y);
    expect(pathLayers.length).toBeGreaterThan(0);
    expect(
      new Set(pathLayers.map((layer) => layer.pathIndex)).size,
    ).toBeGreaterThan(1);
    expect(pathLayers.every((layer) => Number.isFinite(layer.rotation))).toBe(
      true,
    );
  });

  it("computes concentric paths for cylinders and tapered cups", () => {
    expect(automaticPathCount(100, 4, 20, 1)).toBe(5);
    expect(automaticPathCount(86, 4, 20, 1)).toBe(4);
    expect(automaticPathCount(73, 4, 20, 1)).toBe(4);
    for (const cup of [DEFAULT_CUP, { ...DEFAULT_CUP, top: 34, bottom: 40 }]) {
      const paths = fixedPathPoints(cup, 3, 20, 2),
        spacingA = paths[1].v - paths[0].v,
        spacingB = paths[2].v - paths[1].v;
      expect(paths).toHaveLength(3);
      expect(paths.every((path) => path.points.length === 65)).toBe(true);
      expect(paths[0].v).toBeLessThan(paths[1].v);
      expect(paths[1].v).toBeLessThan(paths[2].v);
      expect(spacingA).toBeCloseTo(spacingB, 8);
      const dividers = fixedPathDividerPoints(cup, 3, 20, 2);
      expect(dividers).toHaveLength(2);
      expect(dividers[0].v).toBeGreaterThan(paths[0].v);
      expect(dividers[0].v).toBeLessThan(paths[1].v);
      const shifted = fixedPathPoints(cup, 3, 20, 2, [0, 5, 0]);
      expect(shifted[1].v - paths[1].v).toBeCloseTo(5 / geometry(cup).slant, 8);
    }
  });

  it("uses fixed slots and cycles subjects deterministically", () => {
    const input = {
      sourceWidth: 600,
      sourceHeight: 400,
      objects: [
        object("title", 220, 145, 160, 90, "anchor"),
        object("ghost-a", 10, 10, 50, 55, "main"),
        object("ghost-b", 540, 330, 50, 55, "main"),
      ],
      fill: 0,
      gap: 1,
      scale: 0.35,
      seed: 1,
      pathMode: "manual" as const,
      pathCount: 4,
      pathGap: 1,
      itemGap: 1,
    };
    const first = arrangeLocal(input, DEFAULT_CUP),
      second = arrangeLocal(input, DEFAULT_CUP),
      pathLayers = first.layers.filter((layer) => layer.pathIndex != null);
    expect(first.layers.map(({ id, x, y }) => [id, x, y])).toEqual(
      second.layers.map(({ id, x, y }) => [id, x, y]),
    );
    expect(pathLayers.some((layer) => layer.sourceObjectId === "ghost-a")).toBe(
      true,
    );
    expect(pathLayers.some((layer) => layer.sourceObjectId === "ghost-b")).toBe(
      true,
    );
    expect(pathLayers.length).toBeGreaterThan(2);
    expect(new Set(pathLayers.map((layer) => layer.pathIndex)).size).toBe(4);
    for (let pathIndex = 0; pathIndex < 4; pathIndex++)
      expect(
        pathLayers.filter((layer) => layer.pathIndex === pathIndex).length,
      ).toBeGreaterThanOrEqual(2);
    const lastRow = pathLayers.filter((layer) => layer.pathIndex === 3),
      previousRow = pathLayers.filter((layer) => layer.pathIndex === 2);
    expect(lastRow.length).toBeGreaterThanOrEqual(previousRow.length);
  });

  it("uses the typical subject height for automatic path count", () => {
    const r = arrangeLocal(
      {
        sourceWidth: 500,
        sourceHeight: 400,
        objects: [
          object("title", 170, 150, 160, 60, "anchor"),
          object("ghost-a", 20, 20, 55, 80, "main"),
          object("ghost-b", 100, 20, 55, 80, "main"),
          object("ghost-c", 180, 20, 55, 80, "main"),
          object("tall-outlier", 260, 20, 40, 240, "main"),
          // Keep source bounds stable so this specifically exercises the
          // robust row-height calculation rather than source fitting.
          object("corner-a", 0, 0, 1, 1, "decoration"),
          object("corner-b", 499, 399, 1, 1, "decoration"),
        ],
        fill: 0,
        gap: 1,
        scale: 1,
        seed: 1,
        pathMode: "auto" as const,
        pathCount: 1,
        pathGap: 1,
        itemGap: 1,
      },
      DEFAULT_CUP,
    );
    expect(r.pathCount).toBeGreaterThanOrEqual(4);
    expect(r.layers.some((layer) => layer.sourceObjectId === "title")).toBe(
      true,
    );
    expect(
      new Set(
        r.layers
          .filter((layer) => layer.pathIndex != null)
          .map((layer) => layer.pathIndex),
      ).size,
    ).toBe(r.pathCount);
  });

  it("relocates an edge-mapped title before reducing it or dropping it", () => {
    const r = arrangeLocal(
      {
        sourceWidth: 1000,
        sourceHeight: 300,
        objects: [
          object("edge-anchor", 0, 0, 1, 30, "anchor"),
          object("small-main", 975, 200, 20, 45, "main"),
          object("star", 500, 250, 12, 12, "decoration"),
        ],
        fill: 100,
        gap: 1,
        scale: 1,
        seed: 4,
        pathMode: "manual" as const,
        pathCount: 3,
        pathGap: 1,
        itemGap: 1,
      },
      DEFAULT_CUP,
    );
    expect(
      r.layers.some((layer) => layer.sourceObjectId === "small-main"),
    ).toBe(true);
    expect(
      r.layers.some((layer) => layer.sourceObjectId === "edge-anchor"),
    ).toBe(true);
    expect(r.unplaced).not.toContain("edge-anchor");
  });
});
