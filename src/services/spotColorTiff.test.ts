// @vitest-environment node
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  DEFAULT_SPOT_PLACEMENT,
  HIDDEN_BACKGROUND_LAYER_FLAGS,
  clampSpotPlacement,
  containSpotLayer,
  encodeSpotColorTiff,
  inspectSpotTiff,
} from "./spotColorTiff";

describe("spot color TIFF", () => {
  it("contains a logo within the shared placement frame", () => {
    expect(containSpotLayer(1000, 500, DEFAULT_SPOT_PLACEMENT)).toEqual({
      left: 2491,
      top: 1489,
      width: 2736,
      height: 1368,
    });
    expect(
      clampSpotPlacement({ centerX: -20, centerY: 99999, frameWidth: 400, frameHeight: 200 }),
    ).toEqual({ centerX: 200, centerY: 4246, frameWidth: 400, frameHeight: 200 });
  });

  it("writes a Photoshop-layered five-channel TIFF", async () => {
    const buffer = encodeSpotColorTiff({
      width: 8,
      height: 6,
      dpi: 800,
      layer: {
        bounds: { left: 2, top: 1, width: 2, height: 2 },
        rgba: new Uint8ClampedArray([
          255, 0, 0, 255,
          0, 255, 0, 128,
          0, 0, 255, 64,
          0, 0, 0, 0,
        ]),
        embeddedPng: new Uint8Array([137, 80, 78, 71]),
        embeddedWidth: 2,
        embeddedHeight: 2,
        embeddedName: "logo.png",
      },
    });
    const { bigEndian, tags } = inspectSpotTiff(buffer);
    expect(bigEndian).toBe(true);
    expect(tags.get(256)?.value).toBe(8);
    expect(tags.get(257)?.value).toBe(6);
    expect(tags.get(277)?.value).toBe(5);
    expect(tags.get(34377)?.count).toBeGreaterThan(0);
    expect(tags.get(37724)?.count).toBeGreaterThan(100);

    const metadata = await sharp(Buffer.from(buffer)).metadata();
    expect(metadata).toMatchObject({ width: 8, height: 6, channels: 5, density: 800 });
    const raw = await sharp(Buffer.from(buffer)).raw().toBuffer({ resolveWithObject: true });
    expect(raw.info.channels).toBe(5);
    const pixel = (1 * 8 + 2) * 5;
    expect([...raw.data.subarray(pixel, pixel + 5)]).toEqual([255, 0, 0, 54, 0]);

    const bytes = new Uint8Array(buffer);
    const source = tags.get(37724)!;
    // Header and NUL (36) + 8BIM/Layr header (12) + layer count (2) + the flags
    // offset within the first layer record (46).
    expect(bytes[source.value + 96]).toBe(HIDDEN_BACKGROUND_LAYER_FLAGS);
    const header = new TextDecoder().decode(bytes.subarray(source.value, source.value + 35));
    expect(header).toBe("Adobe Photoshop Document Data Block");
    const sourceText = new TextDecoder("latin1").decode(
      bytes.subarray(source.value, source.value + source.count),
    );
    expect(sourceText).toContain("8BIMLayr");
    expect(sourceText).toContain("8BIMlnk2");
    expect(sourceText).toContain("PNGf");
  });
});
