import type { OutpaintOptions } from "./types";
// Real transparent working space, not a text-only request to enlarge the old crop.
export function expansionInsets(text: string) {
  const directions = {
    left: /左|left/i.test(text),
    right: /右|right/i.test(text),
    top: /上方|顶部|头顶|top|above/i.test(text),
    bottom: /下方|底部|脚|bottom|below/i.test(text),
  };
  const specific = Object.values(directions).some(Boolean);
  return Object.fromEntries(
    Object.entries(directions).map(([k, v]) => [
      k,
      specific ? (v ? 0.4 : 0.12) : 0.25,
    ]),
  ) as Record<keyof typeof directions, number>;
}
export async function prepareOutpaint(
  image: Blob,
  options?: OutpaintOptions,
): Promise<Blob> {
  if (!options?.enabled) return image;
  const bitmap = await createImageBitmap(image);
  try {
    const inset = expansionInsets(options.instructions),
      scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale),
      h = Math.round(bitmap.height * scale);
    const canvas = new OffscreenCanvas(
      w + Math.round(w * inset.left) + Math.round(w * inset.right),
      h + Math.round(h * inset.top) + Math.round(h * inset.bottom),
    );
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法创建扩图画布");
    ctx.drawImage(
      bitmap,
      Math.round(w * inset.left),
      Math.round(h * inset.top),
      w,
      h,
    );
    return canvas.convertToBlob({ type: "image/png" });
  } finally {
    bitmap.close();
  }
}
