// @vitest-environment node
import { expect, it } from "vitest";
import sharp from "sharp";
import fixture from "./fixtures/sharp-dark-hair.json";
import { DEFAULTS, enhance, preparePixels } from "./processing.mjs";

it("matches the source Sharp synthetic dark-hair baseline within blur tolerance and exactly preserves black", async () => {
  const source = await sharp(Buffer.from(fixture.original, "base64"))
    .ensureAlpha()
    .raw()
    .toBuffer();
  const expected = await sharp(Buffer.from(fixture.expected, "base64"))
    .ensureAlpha()
    .raw()
    .toBuffer();
  const settings = { ...DEFAULTS, ...fixture.params };
  const prepared = preparePixels(source, 150, 150, settings);
  const rgba = new Uint8Array(150 * 150 * 4);
  for (let i = 0; i < 150 * 150; i++) {
    rgba.fill(prepared.grayAlpha[i * 2], i * 4, i * 4 + 3);
    rgba[i * 4 + 3] = prepared.grayAlpha[i * 2 + 1];
  }
  const result = await enhance(rgba, 150, 150, settings);
  let total = 0,
    max = 0;
  for (let i = 0; i < result.gray.length; i++) {
    const difference = Math.abs(expected[i * 4] - result.gray[i]);
    total += difference;
    max = Math.max(max, difference);
    if (!expected[i * 4]) expect(result.gray[i]).toBe(0);
  }
  expect(total / result.gray.length).toBeLessThan(2);
  expect(max).toBeLessThanOrEqual(16);
});
