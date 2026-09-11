import { describe, expect, it } from "vitest";
import {
  CONTACTS,
  constrain,
  makeLayout,
  outputDimensions,
  seeded,
  chooseDistributed,
  characterFamily,
  densityProfile,
} from "./layout";
import { alphaRegions, unionRegions, validRect } from "./import";
import {
  DEFAULT_SETTINGS,
  HEIGHT,
  LETTERS,
  WIDTH,
  type PetLibrary,
} from "./types";
import { posePrompt } from "./poses";
const lib: PetLibrary = {
  version: 1,
  id: "custom",
  name: "Custom only",
  assets: [
    {
      id: "cat",
      name: "cat",
      src: "cat.png",
      width: 500,
      height: 600,
      reviewed: true,
      pose: "full",
      kind: "character",
    },
    {
      id: "top",
      name: "top",
      src: "top.png",
      width: 700,
      height: 500,
      reviewed: true,
      pose: "top",
      kind: "character",
      contact: { x: 0.5, y: 0.8 },
    },
    {
      id: "bad",
      name: "rejected",
      src: "bad.png",
      width: 500,
      height: 500,
      reviewed: false,
      pose: "side",
      kind: "character",
      contact: { x: 0.2, y: 0.5 },
    },
  ],
};
const glyph = {
  x: 3000,
  y: 400,
  width: 1700,
  height: 3500,
  fontSize: 4000,
  originX: 3000,
  baseline: 3900,
};
describe("pet layouts", () => {
  it.each([0, 70, 100])(
    "keeps all character sizes within 9%% at density %s",
    (density) => {
      const mixed = {
        ...lib,
        assets: [
          ...lib.assets,
          { ...lib.assets[0], id: "wide", width: 1100, height: 500 },
          { ...lib.assets[1], id: "side", pose: "side" as const },
        ],
      };
      for (const letter of LETTERS) {
        const layout = makeLayout(
          letter,
          mixed,
          { ...DEFAULT_SETTINGS, density },
          glyph,
          {
            top: () => 500,
            right: () => 4700,
          },
        );
        const sizes = layout.placements.map((p) => Math.max(p.width, p.height));
        expect(Math.max(...sizes) / Math.min(...sizes)).toBeLessThanOrEqual(
          1.09,
        );
        for (const p of layout.placements) {
          const a = mixed.assets.find((a) => a.id === p.spriteId)!;
          expect(p.width / p.height).toBeCloseTo(a.width / a.height);
        }
      }
    },
  );
  it("does not miniaturize a top pose to fit a narrow margin", () => {
    const layout = makeLayout("A", lib, DEFAULT_SETTINGS, glyph, {
      top: () => 90,
      right: () => 4700,
    });
    expect(layout.placements.some((p) => p.spriteId === "top")).toBe(false);
  });
  it("density increases target count and decreases gaps within safe bounds", () => {
    expect(densityProfile(100).target).toBeGreaterThan(
      densityProfile(0).target,
    );
    expect(densityProfile(100).gap).toBeLessThan(densityProfile(0).gap);
    expect(densityProfile(200)).toEqual(densityProfile(100));
    const count = (density: number) =>
      makeLayout("A", lib, { ...DEFAULT_SETTINGS, density }, glyph, {
        top: () => 500,
        right: () => 4700,
      }).placements.length;
    expect(count(100)).toBeGreaterThan(count(0));
  });
  it("keeps different poses of the same character in one family and prefers a non-neighbour", () => {
    const a = lib.assets[0],
      b = { ...a, id: "other" },
      pose = { ...a, id: "cat-side", characterId: "cat" };
    expect(characterFamily(pose)).toBe("cat");
    expect(
      chooseDistributed(
        [a, b],
        () => ({ x: 300, y: 100, width: 200, height: 200 }),
        [
          {
            id: "p",
            spriteId: pose.id,
            x: 100,
            y: 100,
            width: 200,
            height: 200,
            interaction: false,
          },
        ],
        [a, b, pose],
        () => 0.5,
      ).id,
    ).toBe("other");
  });
  it("contains a contact preference for each uppercase letter", () =>
    expect(Object.keys(CONTACTS)).toEqual(LETTERS));
  it("preserves native export dimensions independently of engraving limits", () => {
    expect(outputDimensions(1)).toEqual({ width: 7717, height: 4346 });
    expect(outputDimensions(0.75)).toEqual({ width: 5788, height: 3260 });
    expect(outputDimensions(0.5)).toEqual({ width: 3859, height: 2173 });
    expect(() => outputDimensions(0.1)).toThrow();
  });
  it("is reproducible without using global Math.random", () => {
    const a = seeded(23),
      b = seeded(23);
    expect(Array.from({ length: 20 }, a)).toEqual(
      Array.from({ length: 20 }, b),
    );
  });
  it.each(LETTERS)(
    "%s keeps complete sprites on canvas and rejects unreviewed assets",
    (letter) => {
      const layout = makeLayout(letter, lib, DEFAULT_SETTINGS, glyph, {
        top: () => 500,
        right: () => 4700,
      });
      for (const p of layout.placements) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.x + p.width).toBeLessThanOrEqual(WIDTH);
        expect(p.y + p.height).toBeLessThanOrEqual(HEIGHT);
        expect(p.spriteId).not.toBe("bad");
        expect(lib.assets.some((a) => a.id === p.spriteId)).toBe(true);
      }
      expect(layout).toEqual(
        makeLayout(letter, lib, DEFAULT_SETTINGS, glyph, {
          top: () => 500,
          right: () => 4700,
        }),
      );
      expect(layout.warnings.length).toBe(1);
    },
  );
  it("clamps edits without distorting aspect ratio", () => {
    const p = constrain({
      id: "x",
      spriteId: "cat",
      x: -10,
      y: 5000,
      width: 3000,
      height: 6000,
      interaction: false,
    });
    expect(p.width / p.height).toBe(0.5);
    expect(p.y + p.height).toBeLessThanOrEqual(HEIGHT);
  });
  it("requires reviewed complete sprites", () =>
    expect(() =>
      makeLayout("A", { ...lib, assets: [] }, DEFAULT_SETTINGS, glyph, {
        top: () => 0,
        right: () => 0,
      }),
    ).toThrow());
});
describe("sheet extraction", () => {
  it("uses alpha only, preserving black cats and internal eyes", () => {
    const data = new Uint8ClampedArray(10 * 10 * 4);
    for (let y = 2; y < 8; y++)
      for (let x = 1; x < 5; x++) data[(y * 10 + x) * 4 + 3] = 255;
    const r = alphaRegions(data, 10, 10);
    expect(r).toEqual([{ x: 0.1, y: 0.2, width: 0.4, height: 0.6 }]);
  });
  it("merges disconnected fragments under user control", () => {
    expect(
      unionRegions([
        { x: 0.1, y: 0.2, width: 0.2, height: 0.3 },
        { x: 0.4, y: 0.1, width: 0.1, height: 0.2 },
      ]),
    ).toEqual({ x: 0.1, y: 0.1, width: 0.4, height: 0.4 });
  });
  it("rejects outside, empty or nonfinite rectangles", () => {
    expect(validRect({ x: 0, y: 0, width: 1, height: 1 })).toBe(true);
    expect(validRect({ x: 0.9, y: 0, width: 0.2, height: 1 })).toBe(false);
    expect(validRect({ x: NaN, y: 0, width: 1, height: 1 })).toBe(false);
  });
  it("pose requests do not ask AI to typeset the letter", () => {
    expect(posePrompt("top", "#00ff00")).toContain("不添加文字、字母");
    expect(posePrompt("side", "#ff00ff")).toContain("身体左侧");
  });
});
