import { describe, expect, it, vi } from "vitest";
import { stitchArtwork, stitchedDimensions } from "./stitchArtwork";

describe("cup artwork stitching", () => {
  it("equalizes the first right edge and second left edge without distortion", () => {
    const result = stitchedDimensions([
      { width: 800, height: 400 },
      { width: 300, height: 600 },
    ]);
    expect(result.height).toBe(600);
    expect(result.parts).toEqual([
      { width: 1200, height: 600 },
      { width: 300, height: 600 },
    ]);
    expect(result.width).toBe(1500);
    expect(result.gap).toBe(0);
    expect(result.parts[0].width / result.parts[0].height).toBe(2);
    expect(result.parts[1].width / result.parts[1].height).toBe(0.5);
  });

  it("keeps a single image unchanged", () => {
    expect(stitchedDimensions([{ width: 640, height: 480 }])).toEqual({
      width: 640,
      height: 480,
      parts: [{ width: 640, height: 480 }],
      gap: 0,
    });
  });

  it("supports transparent gaps and top-layer overlap", () => {
    expect(
      stitchedDimensions(
        [
          { width: 400, height: 400 },
          { width: 300, height: 400 },
        ],
        25,
      ).width,
    ).toBe(725);
    const overlap = stitchedDimensions(
      [
        { width: 400, height: 400 },
        { width: 300, height: 400 },
      ],
      -50,
    );
    expect(overlap.width).toBe(650);
    expect(overlap.gap).toBe(-50);
  });

  it("paints the later uploaded image last when images overlap", async () => {
    const paintOrder: number[] = [];
    vi.stubGlobal(
      "createImageBitmap",
      vi
        .fn()
        .mockResolvedValueOnce({
          width: 100,
          height: 100,
          close: vi.fn(),
          id: 1,
        })
        .mockResolvedValueOnce({
          width: 100,
          height: 100,
          close: vi.fn(),
          id: 2,
        }),
    );
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        constructor(
          public width: number,
          public height: number,
        ) {}
        getContext() {
          return {
            drawImage: (image: { id: number }) => paintOrder.push(image.id),
          };
        }
        async convertToBlob() {
          return new Blob(["stitched"], { type: "image/png" });
        }
      },
    );
    try {
      await stitchArtwork([new Blob(["first"]), new Blob(["second"])], -20);
      expect(paintOrder).toEqual([1, 2]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
