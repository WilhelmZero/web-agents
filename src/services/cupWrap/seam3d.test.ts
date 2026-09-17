import { expect, it } from "vitest";
import { DEFAULT_CUP } from "./geometry";
import { seamPreviewGeometry } from "./seam3d";

it("builds cylinder, normal taper and reverse taper dimensions", () => {
  const cylinder = seamPreviewGeometry({ ...DEFAULT_CUP, bottom: 40 });
  expect(cylinder.topRadius).toBe(20);
  expect(cylinder.bottomRadius).toBe(20);
  const taper = seamPreviewGeometry(DEFAULT_CUP);
  expect(taper.topRadius).toBe(20);
  expect(taper.bottomRadius).toBe(17);
  const reverse = seamPreviewGeometry({ ...DEFAULT_CUP, top: 34, bottom: 40 });
  expect(reverse.topRadius).toBe(17);
  expect(reverse.bottomRadius).toBe(20);
});

it("places print band between top and bottom insets", () => {
  const value = seamPreviewGeometry({
    ...DEFAULT_CUP,
    topInset: 10,
    bottomInset: 15,
  });
  expect(value.printHeight).toBe(80);
  expect(value.printCenterY).toBe(2.5);
  expect(value.printTopRadius).toBeCloseTo(20 - (3 * 10) / 105);
  expect(value.printBottomRadius).toBeCloseTo(17 + (3 * 15) / 105);
});

it("converts negative, zero and positive seams into gaps and overlaps", () => {
  const zero = seamPreviewGeometry(DEFAULT_CUP);
  expect(zero.gapAngle).toBeCloseTo(0);
  expect(zero.overlapAngle).toBeCloseTo(0);
  const gap = seamPreviewGeometry({ ...DEFAULT_CUP, seam: -5 });
  expect(gap.gapAngle).toBeGreaterThan(0);
  expect(gap.overlapAngle).toBe(0);
  const overlap = seamPreviewGeometry({ ...DEFAULT_CUP, seam: 5 });
  expect(overlap.overlapAngle).toBeGreaterThan(0);
  expect(overlap.gapAngle).toBe(0);
});

it("preserves uncovered angle when coverage is below 360 degrees", () => {
  const value = seamPreviewGeometry({ ...DEFAULT_CUP, coverage: 270 });
  expect(value.visibleAngle).toBeCloseTo((270 * Math.PI) / 180);
  expect(value.gapAngle).toBeCloseTo(Math.PI / 2);
});
