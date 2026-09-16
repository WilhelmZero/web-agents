import { distanceToEdge, geometry, inside, type CupParams } from "./geometry";
import type {
  ArtLayer,
  LocalAdaptation,
  LocalObject,
  LocalObjectRole,
} from "./types";

export interface PixelRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  pixels: number;
  role: LocalObjectRole;
}
export interface PixelAnalysis {
  background: [number, number, number];
  confidence: number;
  labels: Int32Array;
  regions: PixelRegion[];
}

export function analyzePixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): PixelAnalysis {
  const border: number[] = [];
  for (let x = 0; x < width; x++) {
    border.push(x, (height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    border.push(y * width, y * width + width - 1);
  }
  let ar = 0,
    ag = 0,
    ab = 0,
    opaque = 0;
  for (const i of border) {
    const k = i * 4;
    if (data[k + 3] > 20) {
      ar += data[k];
      ag += data[k + 1];
      ab += data[k + 2];
      opaque++;
    }
  }
  const bg: [number, number, number] = opaque
    ? [ar / opaque, ag / opaque, ab / opaque]
    : [255, 255, 255];
  let variance = 0;
  for (const i of border) {
    const k = i * 4;
    if (data[k + 3] > 20)
      variance +=
        (data[k] - bg[0]) ** 2 +
        (data[k + 1] - bg[1]) ** 2 +
        (data[k + 2] - bg[2]) ** 2;
  }
  variance /= Math.max(1, opaque * 3);
  const confidence = Math.max(0, Math.min(1, 1 - variance / 1800));
  const background = new Uint8Array(width * height),
    q = new Int32Array(width * height);
  let head = 0,
    tail = 0;
  const similar = (i: number) => {
    const k = i * 4;
    if (data[k + 3] < 32) return true;
    const d =
      (data[k] - bg[0]) ** 2 +
      (data[k + 1] - bg[1]) ** 2 +
      (data[k + 2] - bg[2]) ** 2;
    return d < 42 ** 2 * 3;
  };
  const add = (i: number) => {
    if (background[i] || !similar(i)) return;
    background[i] = 1;
    q[tail++] = i;
  };
  for (const i of border) add(i);
  while (head < tail) {
    const i = q[head++],
      x = i % width,
      y = (i / width) | 0;
    if (x) add(i - 1);
    if (x + 1 < width) add(i + 1);
    if (y) add(i - width);
    if (y + 1 < height) add(i + width);
  }
  const labels = new Int32Array(width * height);
  labels.fill(-1);
  const regions: PixelRegion[] = [];
  const cq = new Int32Array(width * height);
  for (let first = 0; first < labels.length; first++) {
    if (background[first] || labels[first] >= 0 || data[first * 4 + 3] < 16)
      continue;
    let h = 0,
      t = 0,
      minX = width,
      minY = height,
      maxX = 0,
      maxY = 0;
    cq[t++] = first;
    labels[first] = regions.length;
    while (h < t) {
      const i = cq[h++],
        x = i % width,
        y = (i / width) | 0;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (const j of [
        x ? i - 1 : -1,
        x + 1 < width ? i + 1 : -1,
        y ? i - width : -1,
        y + 1 < height ? i + width : -1,
      ])
        if (
          j >= 0 &&
          !background[j] &&
          labels[j] < 0 &&
          data[j * 4 + 3] >= 16
        ) {
          labels[j] = regions.length;
          cq[t++] = j;
        }
    }
    const ratio = t / (width * height),
      box = ((maxX - minX + 1) * (maxY - minY + 1)) / (width * height);
    regions.push({
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      pixels: t,
      role: ratio < 0.00008 ? "excluded" : box < 0.007 ? "decoration" : "main",
    });
  }
  return {
    background: bg.map(Math.round) as [number, number, number],
    confidence,
    labels,
    regions,
  };
}

export async function analyzeLocalArtwork(
  source: Blob,
): Promise<
  Omit<
    LocalAdaptation,
    | "layers"
    | "fill"
    | "gap"
    | "scale"
    | "seed"
    | "backgroundMode"
    | "backgroundColor"
    | "cupKey"
    | "unplaced"
  >
> {
  const image = await createImageBitmap(source),
    factor = Math.min(1, 1600 / Math.max(image.width, image.height));
  const w = Math.max(1, Math.round(image.width * factor)),
    h = Math.max(1, Math.round(image.height * factor)),
    canvas = new OffscreenCanvas(w, h),
    ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0, w, h);
  const pixels = ctx.getImageData(0, 0, w, h),
    analysis = analyzePixels(pixels.data, w, h);
  if (analysis.confidence < 0.65) {
    image.close();
    throw new Error(
      "背景颜色不够统一，当前本地算法仅支持透明底或纯色底素材，请改用 AI 适配",
    );
  }
  const objects: LocalObject[] = [];
  for (let ri = 0; ri < analysis.regions.length; ri++) {
    const r = analysis.regions[ri];
    if (r.role === "excluded") continue;
    const x = Math.floor(r.x / factor),
      y = Math.floor(r.y / factor),
      rw = Math.min(image.width - x, Math.ceil(r.width / factor)),
      rh = Math.min(image.height - y, Math.ceil(r.height / factor));
    const out = new OffscreenCanvas(rw, rh),
      oc = out.getContext("2d", { willReadFrequently: true })!;
    oc.drawImage(image, x, y, rw, rh, 0, 0, rw, rh);
    const im = oc.getImageData(0, 0, rw, rh);
    for (let py = 0; py < rh; py++)
      for (let px = 0; px < rw; px++) {
        const ax = Math.min(w - 1, Math.floor((x + px) * factor)),
          ay = Math.min(h - 1, Math.floor((y + py) * factor));
        if (analysis.labels[ay * w + ax] !== ri)
          im.data[(py * rw + px) * 4 + 3] = 0;
      }
    oc.putImageData(im, 0, 0);
    objects.push({
      id: crypto.randomUUID(),
      blob: await out.convertToBlob({ type: "image/png" }),
      rect: { x, y, width: rw, height: rh },
      role: r.role,
    });
  }
  image.close();
  if (!objects.some((o) => o.role === "main"))
    throw new Error("未识别到可排布主体，请检查背景或改用 AI 适配");
  return {
    sourceWidth: Math.round(w / factor),
    sourceHeight: Math.round(h / factor),
    background: `#${analysis.background.map((v) => v.toString(16).padStart(2, "0")).join("")}`,
    confidence: analysis.confidence,
    objects,
  };
}

function random(seed: number) {
  let x = seed | 0;
  return () =>
    ((x =
      (Math.imul(x ^ (x >>> 15), 1 | x) + Math.imul(x ^ (x >>> 7), 61 | x)) ^
      x) >>>
      0) /
    4294967296;
}
export function horizontalSpan(points: { x: number; y: number }[], y: number) {
  const hits: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y))
      hits.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
  }
  hits.sort((a, b) => a - b);
  return hits.length >= 2
    ? { left: hits[0], right: hits[hits.length - 1] }
    : undefined;
}
export function arrangeLocal(
  input: Pick<
    LocalAdaptation,
    | "sourceWidth"
    | "sourceHeight"
    | "objects"
    | "fill"
    | "gap"
    | "scale"
    | "seed"
  >,
  cup: CupParams,
) {
  const g = geometry(cup),
    safe = Math.max(4, cup.safe),
    usableW = Math.max(1, g.width - safe * 2),
    usableH = Math.max(1, g.height - safe * 2),
    mm =
      Math.min(usableW / input.sourceWidth, usableH / input.sourceHeight) *
      input.scale;
  const active = input.objects.filter((o) => o.role !== "excluded"),
    sourceOrder = [...active].sort(
      (a, b) =>
        a.rect.y + a.rect.height / 2 - (b.rect.y + b.rect.height / 2) ||
        a.rect.x + a.rect.width / 2 - (b.rect.x + b.rect.width / 2),
    ),
    anchor = active
      .filter((o) => o.role === "main")
      .sort(
        (a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height,
      )[0],
    ordered = anchor
      ? [anchor, ...sourceOrder.filter((o) => o.id !== anchor.id)]
      : sourceOrder,
    boxes: { x: number; y: number; w: number; h: number }[] = [],
    layers: ArtLayer[] = [],
    unplaced: string[] = [];
  const fits = (x: number, y: number, w: number, h: number) =>
    [
      { x: x - w / 2, y: y - h / 2 },
      { x: x + w / 2, y: y - h / 2 },
      { x: x + w / 2, y: y + h / 2 },
      { x: x - w / 2, y: y + h / 2 },
    ].every(
      (p) => inside(p, g.points) && distanceToEdge(p, g.points) >= safe,
    ) &&
    !boxes.some(
      (b) =>
        // Component boxes include transparent corners; a slightly inset proxy
        // preserves the source composition without treating empty pixels as collisions.
        Math.abs(x - b.x) < (w + b.w) * 0.42 + input.gap &&
        Math.abs(y - b.y) < (h + b.h) * 0.42 + input.gap,
    );
  for (const o of ordered) {
    const w = o.rect.width * mm,
      h = o.rect.height * mm,
      u = (o.rect.x + o.rect.width / 2) / input.sourceWidth,
      v = (o.rect.y + o.rect.height / 2) / input.sourceHeight,
      ty = Math.max(
        safe + h / 2,
        Math.min(g.height - safe - h / 2, safe + v * usableH),
      ),
      span = horizontalSpan(g.points, ty),
      available = Math.max(
        0,
        (span?.right ?? g.width) - (span?.left ?? 0) - safe * 2 - w,
      ),
      tx = (span?.left ?? 0) + safe + w / 2 + u * available;
    let best: { x: number; y: number } | undefined,
      score = Infinity;
    for (let oy = 0; oy <= 12; oy += 1.5)
      for (const sy of oy ? [oy, -oy] : [0])
        for (let ox = 0; ox <= 20; ox += 1.5)
          for (const sx of ox ? [ox, -ox] : [0]) {
            const x = tx + sx,
              y = ty + sy;
            if (fits(x, y, w, h)) {
              const s = (x - tx) ** 2 + (y - ty) ** 2;
              if (s < score) {
                score = s;
                best = { x, y };
              }
            }
          }
    if (!best) {
      unplaced.push(o.id);
      continue;
    }
    boxes.push({ ...best, w, h });
    layers.push({
      id: o.id,
      blob: o.blob,
      x: best.x,
      y: best.y,
      width: w,
      rotation: 0,
      locked: true,
    });
  }
  const decorations = active.filter((o) => o.role === "decoration"),
    rng = random(input.seed),
    count = Math.min(
      24,
      Math.round((decorations.length * 2 * input.fill) / 100),
    );
  for (let i = 0; i < count && decorations.length; i++) {
    const o = decorations[i % decorations.length],
      w = o.rect.width * mm,
      h = o.rect.height * mm;
    let placed = false;
    for (let k = 0; k < 300 && !placed; k++) {
      const x = safe + w / 2 + rng() * Math.max(0, g.width - 2 * safe - w),
        y = safe + h / 2 + rng() * Math.max(0, g.height - 2 * safe - h);
      if (fits(x, y, w, h)) {
        const id = `${o.id}-copy-${i}`;
        boxes.push({ x, y, w, h });
        layers.push({
          id,
          blob: o.blob,
          x,
          y,
          width: w,
          rotation: 0,
          locked: true,
        });
        placed = true;
      }
    }
  }
  return { layers, unplaced };
}
