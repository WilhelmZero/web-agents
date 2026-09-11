import { expect, it, vi, afterEach } from "vitest";
import { ensurePetFont, fontFamily } from "./fonts";
afterEach(() => vi.unstubAllGlobals());
it.each([
  ["barlow-medium", "PetBarlowMedium", "BarlowSemiCondensed-Medium.ttf", {}],
  [
    "roboto-condensed-medium",
    "PetRobotoCondensedMedium",
    "RobotoCondensed-Variable.ttf",
    { variationSettings: '"wght" 500' },
  ],
])(
  "loads bundled %s with its actual Medium weight",
  async (key, family, filename, descriptors) => {
    const loaded = vi.fn();
    vi.stubGlobal(
      "FontFace",
      class {
        family: string;
        source: string;
        constructor(
          family: string,
          source: string,
          descriptors: FontFaceDescriptors,
        ) {
          this.family = family;
          this.source = source;
          loaded(family, source, descriptors);
        }
        load() {
          return Promise.resolve(this);
        }
      },
    );
    Object.defineProperty(document, "fonts", {
      value: { add: vi.fn() },
      configurable: true,
    });
    expect(await ensurePetFont(key as string)).toBe(family);
    expect(loaded).toHaveBeenCalledWith(
      family,
      expect.stringContaining(`/pet-letter-stickers/${filename}`),
      descriptors,
    );
    expect(fontFamily(undefined)).toBe("PetAnton"); // historical result snapshots
  },
);
