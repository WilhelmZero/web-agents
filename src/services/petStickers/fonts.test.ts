import { expect, it, vi, afterEach } from "vitest";
import { ensurePetFont, fontFamily } from "./fonts";
afterEach(() => vi.unstubAllGlobals());
it("loads the bundled Medium font without synthetic bold or a network font dependency", async () => {
  const loaded = vi.fn();
  vi.stubGlobal(
    "FontFace",
    class {
      family: string;
      source: string;
      constructor(family: string, source: string) {
        this.family = family;
        this.source = source;
        loaded(family, source);
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
  expect(await ensurePetFont("barlow-medium")).toBe("PetBarlowMedium");
  expect(loaded).toHaveBeenCalledWith(
    "PetBarlowMedium",
    expect.stringContaining(
      "/pet-letter-stickers/BarlowSemiCondensed-Medium.ttf",
    ),
  );
  expect(fontFamily(undefined)).toBe("PetAnton"); // historical result snapshots
});
