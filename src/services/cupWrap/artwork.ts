import { geometry, inside, type Point } from "./geometry";
import type { WrapDesign, ArtLayer } from "./types";
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** Only flood-connected, near-white boundary pixels are background candidates.
 * Enclosed white faces/bodies remain foreground. User confirmation is required. */
export function backgroundCandidates(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  tolerance = 22,
) {
  const mask = new Uint8Array(w * h),
    queue = new Int32Array(w * h);
  let head = 0,
    tail = 0;
  const add = (i: number) => {
    if (mask[i]) return;
    const k = i * 4;
    if (
      data[k + 3] < 10 ||
      (data[k] > 255 - tolerance &&
        data[k + 1] > 255 - tolerance &&
        data[k + 2] > 255 - tolerance)
    ) {
      mask[i] = 1;
      queue[tail++] = i;
    }
  };
  for (let x = 0; x < w; x++) {
    add(x);
    add((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    add(y * w);
    add(y * w + w - 1);
  }
  while (head < tail) {
    const i = queue[head++],
      x = i % w,
      y = Math.floor(i / w);
    if (x) add(i - 1);
    if (x < w - 1) add(i + 1);
    if (y) add(i - w);
    if (y < h - 1) add(i + w);
  }
  return mask;
}
export function suggestRegions(
  data: Uint8ClampedArray,
  w: number,
  h: number,
): Region[] {
  const seen = backgroundCandidates(data, w, h),
    queue = new Int32Array(w * h),
    regions: Region[] = [];
  for (let first = 0; first < w * h; first++) {
    if (seen[first]) continue;
    let head = 0,
      tail = 0,
      minX = w,
      minY = h,
      maxX = 0,
      maxY = 0;
    queue[tail++] = first;
    seen[first] = 1;
    while (head < tail) {
      const i = queue[head++],
        x = i % w,
        y = Math.floor(i / w);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (const j of [
        x ? i - 1 : -1,
        x < w - 1 ? i + 1 : -1,
        y ? i - w : -1,
        y < h - 1 ? i + w : -1,
      ])
        if (j >= 0 && !seen[j]) {
          seen[j] = 1;
          queue[tail++] = j;
        }
    }
    if (tail >= Math.max(12, w * h * 0.0001))
      regions.push({
        x: minX,
        y: minY,
        w: maxX - minX + 1,
        h: maxY - minY + 1,
      });
  }
  return regions.sort((a, b) => b.w * b.h - a.w * a.h).slice(0, 100);
}
export async function arrangeLayers(
  d: WrapDesign,
): Promise<{ layers: ArtLayer[]; unplaced: number }> {
  const g = geometry(d.cup),
    boxes: { x: number; y: number; w: number; h: number }[] = [],
    layers: ArtLayer[] = [];
  let unplaced = 0;
  for (const l of d.layers) {
    const img = await createImageBitmap(l.blob),
      h = (l.width * img.height) / img.width;
    img.close();
    const fits = (x: number, y: number) =>
      [
        { x, y },
        { x: x + l.width, y },
        { x, y: y + h },
        { x: x + l.width, y: y + h },
      ].every((p) => inside(p, g.points)) &&
      !boxes.some(
        (b) =>
          x < b.x + b.w + 2 &&
          x + l.width + 2 > b.x &&
          y < b.y + b.h + 2 &&
          y + h + 2 > b.y,
      );
    let pos: Point | undefined;
    if (l.locked) {
      pos = { x: l.x - l.width / 2, y: l.y - h / 2 };
    } else
      outer: for (let y = 2; y + h < g.height; y += 2)
        for (let x = 2; x + l.width < g.width; x += 2)
          if (fits(x, y)) {
            pos = { x, y };
            break outer;
          }
    if (!pos) {
      unplaced++;
      layers.push(l);
      continue;
    }
    boxes.push({ ...pos, w: l.width, h });
    layers.push({
      ...l,
      x: pos.x + l.width / 2,
      y: pos.y + h / 2,
      rotation: l.locked ? l.rotation : 0,
    });
  }
  return { layers, unplaced };
}
