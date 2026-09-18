import { describe, expect, it } from "vitest";
import {
  analyzePixels,
  arrangeLocal,
  boxBoundaryPoints,
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
      const object = input.objects.find((o) => l.id.startsWith(o.id))!;
      const h = (l.width * object.rect.height) / object.rect.width;
      for (const point of boxBoundaryPoints(l.x, l.y, l.width, h)) {
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
  it("places every subject before decorations and keeps decorations between subjects", () => {
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
    expect(Math.max(...subjectIndexes)).toBeLessThan(
      Math.min(...decorationIndexes),
    );
    const left = Math.min(...subjects.map((layer) => layer.x));
    const right = Math.max(...subjects.map((layer) => layer.x));
    for (const decoration of r.layers.filter((layer) =>
      layer.id.startsWith("star"),
    )) {
      expect(decoration.x).toBeGreaterThanOrEqual(left);
      expect(decoration.x).toBeLessThanOrEqual(right);
    }
  });
  it("locks the central composition and only expands outer subjects", () => {
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
      by = new Map(r.layers.map((v) => [v.id, v])),
      g = geometry(DEFAULT_CUP);
    expect(by.get("anchor")!.x).toBeCloseTo(g.width / 2, 0);
    expect(by.get("anchor")!.y).toBeCloseTo(g.height * 0.48, 0);
    expect(by.get("core-left")!.x).toBeLessThan(by.get("anchor")!.x);
    expect(by.get("core-right")!.x).toBeGreaterThan(by.get("anchor")!.x);
    expect(by.get("core-left")!.y).toBeCloseTo(by.get("core-right")!.y, 1);
    expect(by.get("core-star")!.x).toBeCloseTo(by.get("anchor")!.x, 0);
    expect(by.get("outer-top")!.y).toBeLessThan(g.height / 2);
    expect(by.get("outer-bottom")!.y).toBeGreaterThan(g.height / 2);
  });
});
