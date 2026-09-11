import { canvasBlob } from "./render";
import type { Rect, Sprite } from "./types";
export function alphaRegions(
  data: Uint8ClampedArray,
  w: number,
  h: number,
): Rect[] {
  const mask = new Uint8Array(w * h),
    out: Rect[] = [];
  for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3] > 20 ? 1 : 0;
  const queue = new Int32Array(w * h);
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] !== 1) continue;
    let head = 0,
      tail = 1;
    queue[0] = i;
    mask[i] = 2;
    let x0 = w,
      y0 = h,
      x1 = 0,
      y1 = 0;
    while (head < tail) {
      const p = queue[head++],
        x = p % w,
        y = Math.floor(p / w);
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
      for (const q of [
        x > 0 ? p - 1 : -1,
        x + 1 < w ? p + 1 : -1,
        y > 0 ? p - w : -1,
        y + 1 < h ? p + w : -1,
      ])
        if (q >= 0 && mask[q] === 1) {
          mask[q] = 2;
          queue[tail++] = q;
        }
    }
    if (tail >= 12)
      out.push({
        x: x0 / w,
        y: y0 / h,
        width: (x1 - x0 + 1) / w,
        height: (y1 - y0 + 1) / h,
      });
  }
  return out
    .sort((a, b) => b.width * b.height - a.width * a.height)
    .slice(0, 150);
}
export function unionRegions(rs: Rect[]): Rect {
  const x = Math.min(...rs.map((r) => r.x)),
    y = Math.min(...rs.map((r) => r.y));
  return {
    x,
    y,
    width: Math.max(...rs.map((r) => r.x + r.width)) - x,
    height: Math.max(...rs.map((r) => r.y + r.height)) - y,
  };
}
export function validRect(r: Rect) {
  return (
    Object.values(r).every(Number.isFinite) &&
    r.x >= 0 &&
    r.y >= 0 &&
    r.width > 0 &&
    r.height > 0 &&
    r.x + r.width <= 1.000001 &&
    r.y + r.height <= 1.000001
  );
}
export async function detectSheet(blob: Blob) {
  const b = await createImageBitmap(blob);
  try {
    if (b.width * b.height > 60_000_000)
      throw new Error("素材超过 6000 万像素");
    const c = document.createElement("canvas"),
      scale = Math.min(1, 1400 / Math.max(b.width, b.height));
    c.width = Math.round(b.width * scale);
    c.height = Math.round(b.height * scale);
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(b, 0, 0, c.width, c.height);
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    let alpha = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] < 128) alpha++;
    return {
      transparent: alpha > data.length / 400,
      regions: alphaRegions(data, c.width, c.height),
      width: b.width,
      height: b.height,
    };
  } finally {
    b.close();
  }
}
export async function cropSprite(
  blob: Blob,
  r: Rect,
  name: string,
): Promise<Sprite> {
  if (!validRect(r)) throw new Error("框选范围超出素材");
  const b = await createImageBitmap(blob);
  try {
    const c = document.createElement("canvas");
    const x = Math.floor(r.x * b.width),
      y = Math.floor(r.y * b.height);
    c.width = Math.min(b.width - x, Math.max(1, Math.round(r.width * b.width)));
    c.height = Math.min(
      b.height - y,
      Math.max(1, Math.round(r.height * b.height)),
    );
    const ctx = c.getContext("2d")!;
    ctx.drawImage(b, x, y, c.width, c.height, 0, 0, c.width, c.height);
    return {
      id: crypto.randomUUID(),
      name,
      kind: "character",
      pose: "full",
      reviewed: true,
      src: "",
      blob: await canvasBlob(c),
      width: c.width,
      height: c.height,
    };
  } finally {
    b.close();
  }
}
