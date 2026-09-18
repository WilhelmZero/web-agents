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
    expect(r.regions.some((v) => v.role === "main")).toBe(true);
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
    role: "main" | "decoration",
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
    ).toBeLessThanOrEqual(2);
    expect(r.layers.some((v) => v.id.startsWith("main-copy"))).toBe(false);
  });
  it("keeps row order and expands the wider top more than the narrow bottom", () => {
    const objects = [
        object("tl", 60, 30, 30, 30, "main"),
        object("tr", 410, 30, 30, 30, "main"),
        object("bl", 60, 330, 30, 30, "main"),
        object("br", 410, 330, 30, 30, "main"),
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
      by = new Map(r.layers.map((v) => [v.id, v]));
    expect(by.get("tl")!.x).toBeLessThan(by.get("tr")!.x);
    expect(by.get("bl")!.x).toBeLessThan(by.get("br")!.x);
    expect(by.get("tr")!.x - by.get("tl")!.x).toBeGreaterThan(
      by.get("br")!.x - by.get("bl")!.x,
    );
    expect(by.get("tl")!.y).toBeLessThan(by.get("bl")!.y);
  });
});
