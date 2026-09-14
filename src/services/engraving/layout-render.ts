import type { RenderParams, Rendered } from "./types";
import { validateLayout } from "./layout-types";
import { drawLayout } from "./layout-draw";
import { outputDimensions, dither, cropPixels } from "./processing.mjs";
import { withPngDpi } from "./image";
export async function renderLayout(
  blob: Blob,
  params: RenderParams,
  renderPhoto: (blob: Blob, params: RenderParams) => Promise<Rendered>,
): Promise<Rendered> {
  const layout = validateLayout(params.layout!);
  outputDimensions(layout.width, layout.height, { ...params, preview: false });
  const size = outputDimensions(layout.width, layout.height, params),
    scale = size.contentWidth / layout.width;
  const input = await createImageBitmap(blob);
  const region = cropPixels(input.width, input.height, params.crop);
  input.close();
  const imageScale =
    Math.min(
      layout.image.width / region.width,
      layout.image.height / region.height,
    ) * scale;
  const maxWidth = Math.min(
    8192,
    Math.floor((8192 * region.width) / region.height),
    Math.floor(Math.sqrt((24000000 * region.width) / region.height)),
  );
  const photo = await renderPhoto(blob, {
    ...params,
    layout: undefined,
    mode: "grayscale",
    preview: false,
    pixelWidth: Math.max(
      1,
      Math.min(maxWidth, Math.round(region.width * imageScale)),
    ),
    pixelMargin: 0,
    margin: 0,
  });
  const bitmap = await createImageBitmap(photo.buffer);
  const canvas = new OffscreenCanvas(size.width, size.height),
    ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.save();
  ctx.translate(size.margin, size.margin);
  ctx.scale(scale, scale);
  let overflow: string[];
  try {
    overflow = await drawLayout(ctx, layout, bitmap);
  } finally {
    bitmap.close();
    ctx.restore();
  }
  const pixels = ctx.getImageData(0, 0, size.width, size.height);
  const gray = new Uint8Array(size.width * size.height),
    coverage = new Uint8Array(gray.length);
  coverage.fill(255);
  for (let i = 0; i < gray.length; i++)
    gray[i] = Math.round(
      0.2126 * pixels.data[i * 4] +
        0.7152 * pixels.data[i * 4 + 1] +
        0.0722 * pixels.data[i * 4 + 2],
    );
  const values =
    params.mode === "dither"
      ? dither(gray, coverage, size.width, size.height)
      : gray;
  for (let i = 0; i < gray.length; i++) {
    pixels.data[i * 4] =
      pixels.data[i * 4 + 1] =
      pixels.data[i * 4 + 2] =
        values[i];
    pixels.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
  const png = await canvas.convertToBlob({ type: "image/png" });
  const bytes = withPngDpi(new Uint8Array(await png.arrayBuffer()), params.dpi);
  return {
    buffer: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/png" }),
    width: size.width,
    height: size.height,
    warnings: [
      ...photo.warnings,
      ...(overflow.length ? ["部分文字超出文本框，请检查文字排版。"] : []),
    ],
  };
}
