import { expect, it } from "vitest";
import { geometry, DEFAULT_CUP } from "./geometry";
import { safeWarpRegion, warpPoint } from "./warp";
it("zero warp is an unchanged rectangle", () => {
  const g = geometry(DEFAULT_CUP);
  expect(warpPoint(g, 0.3, 0.6, 0)).toEqual({
    x: g.width * 0.3,
    y: g.height * 0.6,
  });
});

it("contains the whole source inside the safe sector region", () => {
  const g = {
    points: [],
    width: 130,
    height: 106,
    topArc: 125.664,
    bottomArc: 106.814,
    slant: 105.043,
    angle: 0.1794,
    area: 0,
  };
  const region = safeWarpRegion(g, 2048, 1760, 3);
  expect(region.u0).toBeGreaterThan(0);
  expect(region.v0).toBeGreaterThan(0);
  expect(region.u1).toBeLessThan(1);
  expect(region.v1).toBeLessThan(1);
  expect((region.u1 - region.u0) / (region.v1 - region.v0)).toBeCloseTo(
    (2048 / 1760) / (((g.topArc + g.bottomArc) / 2) / g.slant),
    5,
  );
});
it("full warp follows actual cup edges including reverse taper", () => {
  for (const cup of [
    DEFAULT_CUP,
    { ...DEFAULT_CUP, top: 34, bottom: 40 },
    { ...DEFAULT_CUP, bottom: 40 },
  ]) {
    const g = geometry(cup);
    expect(warpPoint(g, 0, 0, 1)).toEqual(g.points[0]);
    expect(warpPoint(g, 1, 1, 1)).toEqual(g.points[g.points.length / 2]);
  }
});
