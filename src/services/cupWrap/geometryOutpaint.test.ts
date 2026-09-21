// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DEFAULT_CUP, geometry } from "./geometry";
import { chooseOutpaintSize, idealOutpaintRatio } from "./geometryOutpaint";

const adjustment = {
  scale: 1, scaleX: 1, scaleY: 1, x: 0, y: 0, warp: 1,
  leftGap: 0, rightGap: 0, topGap: 10, bottomGap: 10,
};

describe("rectangular outpaint mapping", () => {
  it("balances arc magnification for upright, reversed and cylindrical cups", () => {
    for (const cup of [
      DEFAULT_CUP,
      { ...DEFAULT_CUP, top: 34, bottom: 40 },
      { ...DEFAULT_CUP, top: 40, bottom: 40 },
    ]) {
      const g = geometry(cup);
      const ratio = idealOutpaintRatio(g, cup.safe, adjustment);
      const expected = Math.sqrt(g.topArc * g.bottomArc) / (g.slant - 20);
      expect(ratio).toBeCloseTo(expected, 2);
    }
  });
  it("uses the active four-side region and rejects an empty one", () => {
    const g = geometry(DEFAULT_CUP);
    expect(idealOutpaintRatio(g, 3, { ...adjustment, leftGap: 8, rightGap: 8 }))
      .toBeLessThan(idealOutpaintRatio(g, 3, adjustment));
    expect(() => idealOutpaintRatio(g, 3, { ...adjustment, scaleY: 0 }))
      .toThrow(/映射区域过小/);
  });
  it("chooses a maximum-area legal 16px size close to the target ratio", () => {
    for (const ratio of [1 / 3, 0.8, 1, 1.35, 2, 3]) {
      const size = chooseOutpaintSize(ratio);
      expect(size.width % 16).toBe(0);
      expect(size.height % 16).toBe(0);
      expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(3840);
      expect(size.width * size.height).toBeLessThanOrEqual(8_294_400);
      expect(size.width * size.height).toBeGreaterThanOrEqual(655_360);
      expect(size.ratioError).toBeLessThanOrEqual(0.005);
      expect(size.width * size.height).toBeGreaterThan(4_800_000);
    }
  });
  it("clamps proportions outside the model's range", () => {
    expect(chooseOutpaintSize(9).ratioClamped).toBe(true);
    expect(chooseOutpaintSize(0.1).targetRatio).toBeCloseTo(1 / 3);
    expect(() => chooseOutpaintSize(0)).toThrow();
  });
});
