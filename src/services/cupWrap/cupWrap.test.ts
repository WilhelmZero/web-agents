// @vitest-environment node
import { describe, it, expect } from "vitest";
import { DEFAULT_CUP, geometry, dielineSvg, inside } from "./geometry";
import { encodeTiff } from "./tiff";
import { pack } from "./packing";
import { backgroundCandidates, suggestRegions } from "./artwork";
import { DEFAULT_PRINT, type WrapDesign } from "./types";
import { PDFDocument } from "pdf-lib";
import { exportPdf, calibrationPdf } from "./pdf";
import { tileOffsets } from "./pdf";
import sharp from "sharp";
import { containFit } from "./fitting";
const design = (id = "one"): WrapDesign => ({
  id,
  name: id,
  cup: { ...DEFAULT_CUP },
  aiResults: [],
  fit: "contain",
  scale: 1,
  x: 0,
  y: 0,
  rotation: 0,
  layers: [],
  quantity: 1,
  prompt: "",
});
describe("cup wrap geometry", () => {
  it("fits a complete image inside curved edges rather than clipping bounding-box corners", () => {
    for (const cup of [
      DEFAULT_CUP,
      { ...DEFAULT_CUP, top: 34, bottom: 40 },
      { ...DEFAULT_CUP, top: 160, bottom: 20, height: 25 },
    ]) {
      const g = geometry(cup),
        f = containFit(g, 1448, 1090);
      expect(f.scale).toBeGreaterThan(0);
      for (const sx of [-1, 1])
        for (const sy of [-1, 1])
          expect(
            inside(
              {
                x: f.cx + (sx * 1448 * f.scale) / 2,
                y: f.cy + (sy * 1090 * f.scale) / 2,
              },
              g.points,
            ),
          ).toBe(true);
    }
  });
  it("uses longer upper arc for supplied cup", () => {
    const g = geometry(DEFAULT_CUP);
    expect(g.topArc).toBeCloseTo(125.663706, 5);
    expect(g.bottomArc).toBeCloseTo(106.81415, 5);
    expect(g.slant).toBeCloseTo(105.04285, 4);
    expect(g.points[0].y).toBeLessThan(g.height / 2);
  });
  it("supports reversed taper and cylinders", () => {
    const g = geometry({ ...DEFAULT_CUP, top: 34, bottom: 40 });
    expect(g.topArc).toBeLessThan(g.bottomArc);
    expect(g.width).toBeCloseTo(geometry(DEFAULT_CUP).width, 5);
    const c = geometry({ ...DEFAULT_CUP, bottom: 40 });
    expect(c.width).toBeCloseTo(40 * Math.PI);
    expect(c.height).toBe(105);
  });
  it("keeps near cylinders stable", () => {
    const g = geometry({ ...DEFAULT_CUP, bottom: 39.999999 });
    expect(g.height).toBeCloseTo(105, 3);
    expect(g.width).toBeCloseTo(40 * Math.PI, 3);
  });
  it("interpolates trimmed diameters and middle seam", () => {
    const g = geometry({
      ...DEFAULT_CUP,
      topInset: 10,
      bottomInset: 5,
      coverage: 180,
      seam: 2,
    });
    expect(g.slant).toBeLessThan(105);
    expect((g.topArc + g.bottomArc) / 2).toBeCloseTo(
      (Math.PI * (40 - (6 * 10) / 105 + (34 + (6 * 5) / 105))) / 4 + 2,
    );
  });
  it("rejects invalid input and writes mm SVG", () => {
    expect(() => geometry({ ...DEFAULT_CUP, topInset: 105 })).toThrow();
    expect(dielineSvg(geometry(DEFAULT_CUP))).toContain('mm"');
  });
});
describe("TIFF and PDF", () => {
  it("is readable by an independent TIFF decoder", async () => {
    const bytes = encodeTiff(
      2,
      1,
      new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0]),
      600,
    );
    const metadata = await sharp(Buffer.from(bytes)).metadata();
    expect(metadata.width).toBe(2);
    expect(metadata.height).toBe(1);
    expect(metadata.density).toBe(600);
    expect(metadata.hasAlpha).toBe(true);
  });
  it("tiles at actual size with overlap", () => {
    expect(tileOffsets(450, 200, 5)).toEqual([0, 195, 390]);
    expect(tileOffsets(200, 200, 5)).toEqual([0]);
    expect(() => tileOffsets(100, 5, 5)).toThrow();
  });
  it("writes exact pixels, RGBA extrasample and inch DPI", () => {
    const rgba = new Uint8ClampedArray([1, 2, 3, 0, 4, 5, 6, 255]),
      b = encodeTiff(2, 1, rgba, 800),
      v = new DataView(b),
      tags = new Map<number, number>();
    for (let i = 0; i < v.getUint16(8, true); i++) {
      const p = 10 + i * 12;
      tags.set(v.getUint16(p, true), v.getUint32(p + 8, true));
    }
    expect(tags.get(256)).toBe(2);
    expect(tags.get(338)).toBe(2);
    expect(tags.get(296)).toBe(2);
    const dpi = tags.get(282)!;
    expect(v.getUint32(dpi, true) / v.getUint32(dpi + 4, true)).toBe(800);
    expect([...new Uint8Array(b, tags.get(273))]).toEqual([...rgba]);
  });
  it("exports true physical vector page size", async () => {
    const blob = await exportPdf([design()], DEFAULT_PRINT),
      pdf = await PDFDocument.load(await blob.arrayBuffer());
    const g = geometry(DEFAULT_CUP);
    expect((pdf.getPage(0).getWidth() / 72) * 25.4).toBeCloseTo(g.width, 6);
    const cal = await PDFDocument.load(
      await (await calibrationPdf()).arrayBuffer(),
    );
    expect((cal.getPage(0).getHeight() / 72) * 25.4).toBeCloseTo(297);
  });
});
describe("packing", () => {
  it("packs repeatably without changing physical dimensions", () => {
    const d = design();
    d.quantity = 3;
    const a = pack([d], DEFAULT_PRINT),
      b = pack([d], DEFAULT_PRINT);
    expect(a).toEqual(b);
    expect(a.pages.flat()).toHaveLength(3);
    expect(a.omitted).toEqual([]);
    for (const p of a.pages.flat()) {
      expect(p.x).toBeGreaterThanOrEqual(5);
      expect(p.y + p.height).toBeLessThanOrEqual(292);
      const g = geometry(d.cup);
      expect(p.width).toBeCloseTo(p.rotation % 180 ? g.height : g.width);
    }
  }, 30000);
  it("rejects oversize without shrinking", () => {
    const d = design();
    d.cup = { ...DEFAULT_CUP, top: 400, bottom: 400, height: 400 };
    const r = pack([d], { ...DEFAULT_PRINT, rotate: false });
    expect(r.omitted).toEqual([d.id]);
    expect(r.pages).toHaveLength(0);
  }, 30000);
});
describe("background protection", () => {
  it("retains enclosed white subject", () => {
    const w = 9,
      h = 9,
      p = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let y = 2; y <= 6; y++)
      for (let x = 2; x <= 6; x++)
        if (x === 2 || x === 6 || y === 2 || y === 6) {
          const i = (y * w + x) * 4;
          p[i] = p[i + 1] = p[i + 2] = 0;
        }
    const mask = backgroundCandidates(p, w, h);
    expect(mask[0]).toBe(1);
    expect(mask[4 * w + 4]).toBe(0);
    expect(suggestRegions(p, w, h)).toEqual([{ x: 2, y: 2, w: 5, h: 5 }]);
  });
});
