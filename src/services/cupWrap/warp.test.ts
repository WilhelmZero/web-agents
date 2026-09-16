import { expect, it } from "vitest";
import { geometry, DEFAULT_CUP } from "./geometry";
import { warpPoint } from "./warp";
it("zero warp is an unchanged rectangle", () => {
  const g = geometry(DEFAULT_CUP);
  expect(warpPoint(g, 0.3, 0.6, 0)).toEqual({
    x: g.width * 0.3,
    y: g.height * 0.6,
  });
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
