import {
  outputDimensions,
  preparePixels,
  enhance,
  dither,
  validateOptions,
  cropPixels,
} from "./processing.mjs";
import type { RenderParams, Rendered } from "./types";

// Inspect encoded dimensions before allocating a decoded bitmap.
export function encodedDimensions(bytes: Uint8Array): {
  width: number;
  height: number;
  type: string;
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number, value: string) =>
    value.split("").every((c, i) => bytes[at + i] === c.charCodeAt(0));
  if (bytes.length >= 24 && bytes[0] === 137 && tag(1, "PNG\r\n\x1a\n")) {
    for (let i = 8; i + 12 <= bytes.length;) {
      if (tag(i + 4, "acTL")) throw new Error("请使用静态 PNG 图片。");
      const length = view.getUint32(i);
      if (length > bytes.length - i - 12) break;
      i += length + 12;
    }
    return {
      width: view.getUint32(16),
      height: view.getUint32(20),
      type: "image/png",
    };
  }
  if (bytes[0] === 255 && bytes[1] === 216) {
    for (let i = 2; i + 8 < bytes.length;) {
      if (bytes[i++] !== 255) continue;
      let marker = bytes[i++];
      while (marker === 255) marker = bytes[i++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      const len = view.getUint16(i);
      if (len < 2 || i + len > bytes.length) break;
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(marker)
      )
        return {
          width: view.getUint16(i + 5),
          height: view.getUint16(i + 3),
          type: "image/jpeg",
        };
      i += len;
    }
  }
  if (bytes.length >= 30 && tag(0, "RIFF") && tag(8, "WEBP")) {
    const u24 = (i: number) =>
      bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16);
    if (tag(12, "VP8X")) {
      if (bytes[20] & 2) throw new Error("请使用静态 WebP 图片。");
      return { width: u24(24) + 1, height: u24(27) + 1, type: "image/webp" };
    }
    if (tag(12, "VP8L"))
      return {
        width: 1 + ((bytes[21] | (bytes[22] << 8)) & 16383),
        height:
          1 +
          (((bytes[22] >> 6) | (bytes[23] << 2) | (bytes[24] << 10)) & 16383),
        type: "image/webp",
      };
    if (tag(12, "VP8 "))
      return {
        width: view.getUint16(26, true) & 16383,
        height: view.getUint16(28, true) & 16383,
        type: "image/webp",
      };
  }
  throw new Error("无法读取图片，请上传完整的 JPEG、PNG 或 WebP 静态图片。");
}

function context(canvas: OffscreenCanvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx)
    throw new Error("浏览器不支持 Canvas 图像处理，请使用新版 Chrome / Edge。");
  return ctx;
}

export async function normalizeImage(
  blob: Blob,
  maxEdge = 4096,
  flatten = false,
  upload = false,
): Promise<Rendered> {
  if (upload && blob.size > 20 * 1024 * 1024)
    throw new Error("单张图片最多 20 MB。");
  if (blob.size > 64 * 1024 * 1024) throw new Error("图片文件过大。");
  const dimensions = encodedDimensions(
    new Uint8Array(await blob.arrayBuffer()),
  );
  if (
    dimensions.width < 1 ||
    dimensions.height < 1 ||
    dimensions.width * dimensions.height > 40_000_000
  )
    throw new Error("图片最多 4000 万像素。");
  const bitmap = await createImageBitmap(blob, {
    imageOrientation: "from-image",
  });
  try {
    const ratio = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * ratio)),
      height = Math.max(1, Math.round(bitmap.height * ratio));
    const canvas = new OffscreenCanvas(width, height),
      ctx = context(canvas);
    if (flatten) {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, width, height);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);
    const warnings =
      ratio < 1
        ? [`已等比缩小到 ${width} × ${height}，并转正及移除元数据。`]
        : [];
    if (!flatten) {
      const pixels = ctx.getImageData(0, 0, width, height).data;
      let transparent = false;
      for (let i = 3; i < pixels.length; i += 4)
        if (pixels[i] < 255) {
          transparent = true;
          break;
        }
      if (!transparent && !upload)
        warnings.push(
          "模型未返回透明背景，已启用边界连通黑底清理；请人工检查背景。",
        );
    }
    return {
      buffer: await canvas.convertToBlob({ type: "image/png" }),
      width,
      height,
      warnings,
    };
  } finally {
    bitmap.close();
  }
}

export function withPngDpi(bytes: Uint8Array, dpi: number): Uint8Array {
  const chunk = new Uint8Array(21),
    view = new DataView(chunk.buffer);
  view.setUint32(0, 9);
  chunk.set([112, 72, 89, 115], 4);
  view.setUint32(8, Math.round(dpi / 0.0254));
  view.setUint32(12, Math.round(dpi / 0.0254));
  chunk[16] = 1;
  let crc = 0xffffffff;
  for (const b of chunk.subarray(4, 17)) {
    crc ^= b;
    for (let j = 0; j < 8; j++)
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  view.setUint32(17, (crc ^ 0xffffffff) >>> 0);
  // Canvas PNG has no physical size chunk. Also remove one if an encoder adds it.
  const pieces: Uint8Array[] = [bytes.subarray(0, 33), chunk];
  const sourceView = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  );
  for (let i = 33; i + 12 <= bytes.length;) {
    const length = sourceView.getUint32(i) + 12;
    if (length > bytes.length - i) throw new Error("无效 PNG 数据。");
    if (!(
      bytes[i + 4] === 112 &&
      bytes[i + 5] === 72 &&
      bytes[i + 6] === 89 &&
      bytes[i + 7] === 115
    ))
      pieces.push(bytes.subarray(i, i + length));
    i += length;
  }
  const output = new Uint8Array(pieces.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  pieces.forEach((p) => {
    output.set(p, offset);
    offset += p.length;
  });
  return output;
}

export async function renderImage(
  blob: Blob,
  options: RenderParams,
): Promise<Rendered> {
  const settings = validateOptions(options);
  const bitmap = await createImageBitmap(blob);
  const fullWidth = bitmap.width,
    fullHeight = bitmap.height;
  const region = cropPixels(fullWidth, fullHeight, settings.crop);
  const { width, height } = region;
  if (
    fullWidth * fullHeight > 24_000_000 ||
    Math.max(fullWidth, fullHeight) > 8192
  ) {
    bitmap.close();
    throw new Error("处理图像超过 8192px / 2400 万像素限制。");
  }
  const inputCanvas = new OffscreenCanvas(width, height),
    ctx = context(inputCanvas);
  ctx.drawImage(bitmap, region.x, region.y, width, height, 0, 0, width, height);
  bitmap.close();
  let mask: Uint8ClampedArray | null = null;
  if (settings.eraseMask) {
    if (
      !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(settings.eraseMask) ||
      settings.eraseMask.length > 48_000_000
    )
      throw new Error("无效擦除蒙版。");
    const maskImage = await createImageBitmap(
      await (await fetch(settings.eraseMask)).blob(),
    );
    try {
      if (maskImage.width !== fullWidth || maskImage.height !== fullHeight)
        throw new Error("擦除蒙版尺寸必须与生成图一致。");
      const maskCanvas = new OffscreenCanvas(width, height),
        mctx = context(maskCanvas);
      mctx.drawImage(
        maskImage,
        region.x,
        region.y,
        width,
        height,
        0,
        0,
        width,
        height,
      );
      mask = mctx.getImageData(0, 0, width, height).data;
    } finally {
      maskImage.close();
    }
  }
  const source = preparePixels(
    ctx.getImageData(0, 0, width, height).data,
    width,
    height,
    settings,
    mask,
  );
  // Validate full export even when rendering a small preview.
  outputDimensions(width, height, { ...settings, preview: false });
  const size = outputDimensions(width, height, settings);
  const rgba = ctx.createImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    rgba.data[i * 4] =
      rgba.data[i * 4 + 1] =
      rgba.data[i * 4 + 2] =
        source.grayAlpha[i * 2];
    rgba.data[i * 4 + 3] = source.grayAlpha[i * 2 + 1];
  }
  ctx.putImageData(rgba, 0, 0);
  const canvas = new OffscreenCanvas(size.contentWidth, size.contentHeight),
    out = context(canvas);
  out.imageSmoothingEnabled = true;
  out.imageSmoothingQuality = "high";
  out.drawImage(inputCanvas, 0, 0, size.contentWidth, size.contentHeight);
  const resized = out.getImageData(
    0,
    0,
    size.contentWidth,
    size.contentHeight,
  ).data;
  for (let y = 0; y < size.contentHeight; y++)
    for (let x = 0; x < size.contentWidth; x++) {
      const sx = Math.min(
        width - 1,
        Math.floor(((x + 0.5) * width) / size.contentWidth),
      );
      const sy = Math.min(
        height - 1,
        Math.floor(((y + 0.5) * height) / size.contentHeight),
      );
      if (!source.grayAlpha[(sy * width + sx) * 2 + 1]) {
        const at = (y * size.contentWidth + x) * 4;
        resized[at] = resized[at + 3] = 0;
      }
    }
  const processed = await enhance(
    resized,
    size.contentWidth,
    size.contentHeight,
    settings,
  );
  const pixels =
    settings.mode === "dither"
      ? dither(
          processed.gray,
          processed.coverage,
          size.contentWidth,
          size.contentHeight,
        )
      : processed.gray;
  const finalCanvas = new OffscreenCanvas(size.width, size.height),
    finalCtx = context(finalCanvas);
  const final = finalCtx.createImageData(size.width, size.height);
  for (let i = 3; i < final.data.length; i += 4) final.data[i] = 255;
  for (let y = 0; y < size.contentHeight; y++)
    for (let x = 0; x < size.contentWidth; x++) {
      const at = ((y + size.margin) * size.width + x + size.margin) * 4;
      final.data[at] =
        final.data[at + 1] =
        final.data[at + 2] =
          pixels[y * size.contentWidth + x];
    }
  finalCtx.putImageData(final, 0, 0);
  const png = await finalCanvas.convertToBlob({ type: "image/png" });
  const encoded = withPngDpi(
    new Uint8Array(await png.arrayBuffer()),
    settings.dpi,
  );
  const warnings: string[] = [];
  if (!source.visible)
    warnings.push("图片没有可见主体，请检查透明度、蒙版或输入图片。");
  if (!settings.preview && size.contentWidth > width * 1.5)
    warnings.push("导出尺寸大于原图分辨率，放大不会增加真实细节。");
  return {
    buffer: new Blob([encoded as Uint8Array<ArrayBuffer>], {
      type: "image/png",
    }),
    width: size.width,
    height: size.height,
    warnings,
  };
}

export function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("无法读取图片。"));
    reader.readAsDataURL(blob);
  });
}
