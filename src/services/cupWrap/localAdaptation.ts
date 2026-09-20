import { distanceToEdge, geometry, inside, type CupParams } from "./geometry";
import { warpPoint } from "./warp";
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
      // Keep small stars, sparkles and moons: they are the useful material
      // for dense gap filling. Only discard truly microscopic noise.
      role: ratio < 0.000015 ? "excluded" : box < 0.007 ? "decoration" : "main",
    });
  }
  const anchor = regions
    .filter((region) => region.role === "main")
    .sort((a, b) => b.width * b.height - a.width * a.height)[0];
  if (anchor) anchor.role = "anchor";
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
  if (!objects.some((o) => o.role === "main" || o.role === "anchor"))
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
/** Samples the whole object boundary so curved inner/outer arcs cannot cut it. */
export function boxBoundaryPoints(x: number, y: number, w: number, h: number) {
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i <= 4; i++) {
    const t = i / 4;
    points.push(
      { x: x - w / 2 + w * t, y: y - h / 2 },
      { x: x - w / 2 + w * t, y: y + h / 2 },
    );
  }
  for (let i = 1; i < 4; i++) {
    const t = i / 4;
    points.push(
      { x: x - w / 2, y: y - h / 2 + h * t },
      { x: x + w / 2, y: y - h / 2 + h * t },
    );
  }
  return points;
}
export function rotatedBoundaryPoints(
  x: number,
  y: number,
  w: number,
  h: number,
  rotation: number,
) {
  const c = Math.cos((rotation * Math.PI) / 180),
    s = Math.sin((rotation * Math.PI) / 180);
  return boxBoundaryPoints(0, 0, w, h).map((p) => ({
    x: x + p.x * c - p.y * s,
    y: y + p.x * s + p.y * c,
  }));
}
export function fixedPathPoints(
  cup: CupParams,
  count: number,
  averageHeight: number,
  pathGap: number,
) {
  const g = geometry(cup),
    n = Math.max(1, Math.round(count)),
    block = n * averageHeight + Math.max(0, n - 1) * pathGap,
    start = (g.slant - block) / 2 + averageHeight / 2;
  return Array.from({ length: n }, (_, pathIndex) => {
    const v = (start + pathIndex * (averageHeight + pathGap)) / g.slant;
    return {
      pathIndex,
      v,
      points: Array.from({ length: 65 }, (_unused, i) =>
        warpPoint(g, i / 64, v, 1),
      ),
    };
  });
}
export function fixedPathDividerPoints(
  cup: CupParams,
  count: number,
  averageHeight: number,
  pathGap: number,
) {
  const g = geometry(cup),
    rows = fixedPathPoints(cup, count, averageHeight, pathGap);
  return rows.slice(0, -1).map((row, index) => {
    const v = (row.v + rows[index + 1].v) / 2;
    return {
      pathIndex: index,
      v,
      points: Array.from({ length: 65 }, (_unused, pointIndex) =>
        warpPoint(g, pointIndex / 64, v, 1),
      ),
    };
  });
}
export function automaticPathCount(
  slant: number,
  safe: number,
  averageHeight: number,
  pathGap: number,
) {
  return Math.max(
    1,
    Math.floor(
      (Math.max(1, slant - safe * 2) + pathGap) /
        Math.max(0.01, averageHeight + pathGap),
    ),
  );
}
function tangentRotation(
  g: ReturnType<typeof geometry>,
  u: number,
  v: number,
) {
  const d = 0.001,
    a = warpPoint(g, Math.max(0, u - d), v, 1),
    b = warpPoint(g, Math.min(1, u + d), v, 1);
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}
function median(values: number[], fallback = 10) {
  if (!values.length) return fallback;
  const sorted = [...values].sort((a, b) => a - b),
    middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
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
    | "pathMode"
    | "pathCount"
    | "pathGap"
    | "itemGap"
  >,
  cup: CupParams,
) {
  const g = geometry(cup),
    safe = Math.max(4, cup.safe),
    usableW = Math.max(1, g.width - safe * 2),
    usableH = Math.max(1, g.height - safe * 2),
    active = input.objects.filter((o) => o.role !== "excluded"),
    contentLeft = Math.min(input.sourceWidth, ...active.map((o) => o.rect.x)),
    contentTop = Math.min(input.sourceHeight, ...active.map((o) => o.rect.y)),
    contentRight = Math.max(0, ...active.map((o) => o.rect.x + o.rect.width)),
    contentBottom = Math.max(0, ...active.map((o) => o.rect.y + o.rect.height)),
    contentWidth = Math.max(1, contentRight - contentLeft),
    contentHeight = Math.max(1, contentBottom - contentTop),
    mm = Math.min(usableW / contentWidth, usableH / contentHeight) * input.scale,
    sourceOrder = [...active].sort(
      (a, b) =>
        a.rect.y + a.rect.height / 2 - (b.rect.y + b.rect.height / 2) ||
        a.rect.x + a.rect.width / 2 - (b.rect.x + b.rect.width / 2),
    ),
    anchor = active
      .filter((o) => o.role === "anchor" || o.role === "main")
      .sort(
        (a, b) =>
          Number(b.role === "anchor") - Number(a.role === "anchor") ||
          b.rect.width * b.rect.height - a.rect.width * a.rect.height,
      )[0],
    mainOrder = sourceOrder.filter(
      (o) => o.role === "main" || o.role === "anchor",
    ),
    decorationOrder = sourceOrder.filter((o) => o.role === "decoration"),
    pathSubjects = mainOrder.filter((o) => o.id !== anchor?.id),
    // A title or other unusually large subject must not reduce the number of
    // paths available to the normal subjects. The median describes the
    // typical row item and remains stable in the presence of such outliers.
    averageHeight = median(pathSubjects.map((o) => o.rect.height * mm)),
    averageWidth = median(pathSubjects.map((o) => o.rect.width * mm)),
    pathGap = Math.max(0, input.pathGap ?? 1),
    itemGap = Math.max(0, input.itemGap ?? input.gap ?? 1),
    pathCount =
      input.pathMode === "manual"
        ? Math.max(1, Math.round(input.pathCount ?? 1))
        : automaticPathCount(g.slant, safe, averageHeight, pathGap),
    paths = fixedPathPoints(cup, pathCount, averageHeight, pathGap),
    boxes: { x: number; y: number; w: number; h: number }[] = [],
    layers: ArtLayer[] = [],
    unplaced: string[] = [],
    placedSources = new Set<string>();
  const bounds = (points: { x: number; y: number }[]) => ({
    x: (Math.min(...points.map((p) => p.x)) + Math.max(...points.map((p) => p.x))) / 2,
    y: (Math.min(...points.map((p) => p.y)) + Math.max(...points.map((p) => p.y))) / 2,
    w: Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x)),
    h: Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y)),
  });
  const fits = (x: number, y: number, w: number, h: number, rotation: number) => {
    const points = rotatedBoundaryPoints(x, y, w, h, rotation),
      box = bounds(points);
    return points.every(
      (p) => inside(p, g.points) && distanceToEdge(p, g.points) >= safe,
    ) &&
    !boxes.some(
      (b) =>
        Math.abs(box.x - b.x) < (box.w + b.w) / 2 + itemGap &&
        Math.abs(box.y - b.y) < (box.h + b.h) / 2 + itemGap,
    );
  };
  const addLayer = (
    id: string,
    o: LocalObject,
    x: number,
    y: number,
    width: number,
    rotation: number,
    pathIndex?: number,
    pathU?: number,
  ) => {
    const height = (width * o.rect.height) / o.rect.width,
      box = bounds(rotatedBoundaryPoints(x, y, width, height, rotation));
    boxes.push(box);
    placedSources.add(o.id);
    layers.push({
      id,
      blob: o.blob,
      sourceObjectId: o.id,
      pathIndex,
      pathU,
      x,
      y,
      width,
      rotation,
      autoX: x,
      autoY: y,
      autoWidth: width,
      autoRotation: rotation,
      locked: true,
    });
  };
  if (anchor) {
    const u = Math.max(
        0,
        Math.min(
          1,
          (anchor.rect.x + anchor.rect.width / 2 - contentLeft) / contentWidth,
        ),
      ),
      v = Math.max(
        0,
        Math.min(
          1,
          (anchor.rect.y + anchor.rect.height / 2 - contentTop) / contentHeight,
        ),
      ),
      p = warpPoint(g, u, v, 1),
      rotation = tangentRotation(g, u, v);
    let width = anchor.rect.width * mm,
      placed = false;
    // Keep the mapped source position, but scale a large title down just
    // enough to fit instead of silently dropping the most important element.
    for (let factor = 1; factor >= 0.35 && !placed; factor -= 0.05) {
      const candidateWidth = width * factor,
        candidateHeight = (candidateWidth * anchor.rect.height) / anchor.rect.width;
      if (!fits(p.x, p.y, candidateWidth, candidateHeight, rotation)) continue;
      addLayer(
        `anchor-${anchor.id}`,
        anchor,
        p.x,
        p.y,
        candidateWidth,
        rotation,
        undefined,
        u,
      );
      placed = true;
    }
    if (!placed) unplaced.push(anchor.id);
  }
  let subjectCursor = 0;
  for (const path of paths) {
    if (!pathSubjects.length) break;
    const arcLength =
        g.topArc * (1 - path.v) + g.bottomArc * path.v,
      capacity = Math.max(
        1,
        Math.floor(
          (Math.max(1, arcLength - safe * 2) + itemGap) /
            Math.max(0.01, averageWidth + itemGap),
        ),
      );
    for (let slot = 0; slot < capacity; slot++) {
      const distance = safe +
          ((slot + 0.5) * Math.max(1, arcLength - safe * 2)) / capacity,
        u = Math.max(0, Math.min(1, distance / Math.max(0.01, arcLength))),
        p = warpPoint(g, u, path.v, 1),
        rotation = tangentRotation(g, u, path.v);
      // A single oversized/colliding subject must not block every following
      // slot. Try each source once and advance the cycle on every attempt.
      for (let attempt = 0; attempt < pathSubjects.length; attempt++) {
        const o = pathSubjects[subjectCursor % pathSubjects.length],
          width = o.rect.width * mm,
          height = o.rect.height * mm,
          minimumFactor =
            width <= averageWidth * 1.6 && height <= averageHeight * 1.6
              ? 0.8
              : 1;
        subjectCursor++;
        let placed = false;
        // Edge rows sometimes need a small uniform reduction because their
        // rotated corners approach the curved cut line. This keeps all four
        // visual rows populated without stretching the artwork.
        for (let factor = 1; factor >= minimumFactor && !placed; factor -= 0.05) {
          const candidateWidth = width * factor,
            candidateHeight = height * factor;
          if (!fits(p.x, p.y, candidateWidth, candidateHeight, rotation)) continue;
          addLayer(
            `path-${path.pathIndex}-${slot}-${o.id}`,
            o,
            p.x,
            p.y,
            candidateWidth,
            rotation,
            path.pathIndex,
            u,
          );
          placed = true;
        }
        if (placed) break;
      }
    }
  }
  for (const o of mainOrder)
    if (!placedSources.has(o.id) && !unplaced.includes(o.id)) unplaced.push(o.id);
  // Decorative fillers are subordinate to subjects. Leaving them out while
  // subjects are missing makes the failure visible and prevents a sparse
  // subject layout from being disguised by a cloud of tiny decorations.
  const decorations = unplaced.length
      ? []
      : active.filter((o) => o.role === "decoration"),
    rng = random(input.seed),
    subjectLayers = layers.filter((layer) => {
      const source = active.find((o) => o.id === layer.sourceObjectId);
      return source?.role === "main" || source?.role === "anchor";
    }),
    subjectMinX = subjectLayers.length
      ? Math.min(...subjectLayers.map((layer) => layer.x))
      : safe,
    subjectMaxX = subjectLayers.length
      ? Math.max(...subjectLayers.map((layer) => layer.x))
      : g.width - safe,
    count = Math.min(
      48,
      Math.round((decorations.length * 4 * input.fill) / 100),
    );
  for (let i = 0; i < count && decorations.length; i++) {
    const o = decorations[i % decorations.length],
      w = o.rect.width * mm,
      h = o.rect.height * mm;
    let placed = false;
    for (let k = 0; k < 300 && !placed; k++) {
      const minX = Math.max(safe + w / 2, subjectMinX),
        maxX = Math.min(g.width - safe - w / 2, subjectMaxX),
        x = minX + rng() * Math.max(0, maxX - minX),
        y = safe + h / 2 + rng() * Math.max(0, g.height - 2 * safe - h);
      if (fits(x, y, w, h, 0)) {
        const id = `${o.id}-copy-${i}`;
        addLayer(id, o, x, y, w, 0);
        placed = true;
      }
    }
  }
  return { layers, unplaced, pathCount, averageHeight, paths };
}
