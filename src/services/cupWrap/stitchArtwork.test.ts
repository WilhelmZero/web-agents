import { describe, expect, it } from "vitest";
import { stitchedDimensions } from "./stitchArtwork";

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
    expect(result.parts[0].width / result.parts[0].height).toBe(2);
    expect(result.parts[1].width / result.parts[1].height).toBe(0.5);
  });

  it("keeps a single image unchanged", () => {
    expect(stitchedDimensions([{ width: 640, height: 480 }])).toEqual({
      width: 640,
      height: 480,
      parts: [{ width: 640, height: 480 }],
    });
  });
});
