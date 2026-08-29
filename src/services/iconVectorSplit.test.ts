import { describe, expect, it } from "vitest";
import {
  DEFAULT_ICON_VECTOR_SPLIT_SETTINGS,
  detectIconRegionsFromImageData,
} from "./iconVectorSplit";

function syntheticSheet() {
  const width = 240;
  const height = 160;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = 50;
    data[index * 4 + 1] = 50;
    data[index * 4 + 2] = 50;
    data[index * 4 + 3] = 255;
  }
  const fill = (x: number, y: number, boxWidth: number, boxHeight: number) => {
    for (let row = y; row < y + boxHeight; row += 1)
      for (let column = x; column < x + boxWidth; column += 1) {
        const offset = (row * width + column) * 4;
        data[offset] = 248;
        data[offset + 1] = 248;
        data[offset + 2] = 248;
      }
  };
  for (const y of [25, 95])
    for (const x of [20, 100, 180]) {
      fill(x, y, 16, 18);
      fill(x + 22, y + 22, 20, 16);
    }
  return { data, width, height };
}

describe("icon vector sheet detection", () => {
  it("groups disconnected glyph parts and sorts icons in reading order", () => {
    const regions = detectIconRegionsFromImageData(
      syntheticSheet(),
      {
        ...DEFAULT_ICON_VECTOR_SPLIT_SETTINGS,
        groupingGap: 12,
        minimumWidthPercent: 8,
        minimumHeightPercent: 8,
      },
      "light",
    );
    expect(regions).toHaveLength(6);
    expect(regions.slice(0, 3).map((region) => region.minX)).toEqual([
      20, 100, 180,
    ]);
    expect(regions[3].minY).toBeGreaterThan(regions[0].minY);
  });

  it("does not treat a large uniform light background as an icon", () => {
    const sheet = syntheticSheet();
    for (let y = 0; y < 20; y += 1)
      for (let x = 0; x < sheet.width; x += 1) {
        const offset = (y * sheet.width + x) * 4;
        sheet.data[offset] = 255;
        sheet.data[offset + 1] = 255;
        sheet.data[offset + 2] = 255;
      }
    expect(
      detectIconRegionsFromImageData(
        sheet,
        {
          ...DEFAULT_ICON_VECTOR_SPLIT_SETTINGS,
          groupingGap: 12,
          minimumWidthPercent: 8,
          minimumHeightPercent: 8,
        },
        "light",
      ),
    ).toHaveLength(6);
  });
});
