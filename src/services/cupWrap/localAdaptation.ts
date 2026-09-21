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
export const AUTO_LAYOUT_SCALE_FACTORS = [1, 0.95, 0.9] as const;

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
  pathOffsets: number[] = [],
) {
  const g = geometry(cup),
    n = Math.max(1, Math.round(count)),
    safe = Math.max(4, cup.safe ?? 0),
    edgeInset = Math.min(
      g.slant / 2,
      Math.max(safe + averageHeight / 2, pathGap + averageHeight / 2),
    ),
    span = Math.max(0, g.slant - edgeInset * 2);
  return Array.from({ length: n }, (_, pathIndex) => {
    const evenlyDistributed =
        n === 1 ? g.slant / 2 : edgeInset + (span * pathIndex) / (n - 1),
      offset = Number.isFinite(pathOffsets[pathIndex])
        ? pathOffsets[pathIndex]
        : 0,
      position = Math.max(
        safe,
        Math.min(g.slant - safe, evenlyDistributed + offset),
      ),
      v = position / g.slant;
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
  pathOffsets: number[] = [],
) {
  const g = geometry(cup),
    rows = fixedPathPoints(cup, count, averageHeight, pathGap, pathOffsets);
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
    Math.ceil(
      (Math.max(1, slant - safe * 2) + pathGap) /
        Math.max(0.01, averageHeight + pathGap),
    ),
  );
}
function tangentRotation(g: ReturnType<typeof geometry>, u: number, v: number) {
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
    | "pathOffsets"
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
    mm =
      Math.min(usableW / contentWidth, usableH / contentHeight) * input.scale,
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
    paths = fixedPathPoints(
      cup,
      pathCount,
      averageHeight,
      pathGap,
      input.pathOffsets,
    ),
    boxes: { x: number; y: number; w: number; h: number }[] = [],
    layers: ArtLayer[] = [],
    unplaced: string[] = [],
    placedSources = new Set<string>();
  const bounds = (points: { x: number; y: number }[]) => ({
    x:
      (Math.min(...points.map((p) => p.x)) +
        Math.max(...points.map((p) => p.x))) /
      2,
    y:
      (Math.min(...points.map((p) => p.y)) +
        Math.max(...points.map((p) => p.y))) /
      2,
    w:
      Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x)),
    h:
      Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y)),
  });
  const fits = (
    x: number,
    y: number,
    w: number,
    h: number,
    rotation: number,
    edgeSafe = safe,
    collisionScale = 1,
  ) => {
    const points = rotatedBoundaryPoints(x, y, w, h, rotation),
      box = bounds(points);
    return (
      points.every(
        (p) => inside(p, g.points) && distanceToEdge(p, g.points) >= edgeSafe,
      ) &&
      !boxes.some(
        (b) =>
          Math.abs(box.x - b.x) <
            ((box.w + b.w) / 2) * collisionScale + itemGap &&
          Math.abs(box.y - b.y) <
            ((box.h + b.h) / 2) * collisionScale + itemGap,
      )
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
    layerRole: ArtLayer["layerRole"] = "subject",
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
      locked: false,
      layerRole,
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
      );
    let width = anchor.rect.width * mm,
      placed = false;
    // Prefer the mapped source position. If the fan boundary or another row
    // makes that exact point invalid, move the title to the nearest valid
    // point before reducing it. The title is the most important element and
    // must not silently disappear merely because its rectangular source box
    // touches a curved edge.
    const offsets = [0, -0.04, 0.04, -0.08, 0.08, -0.12, 0.12, -0.18, 0.18],
      candidates = offsets
        .flatMap((dv) =>
          offsets.map((du) => ({
            u: Math.max(0.02, Math.min(0.98, u + du)),
            v: Math.max(0.02, Math.min(0.98, v + dv)),
            distance: du * du + dv * dv,
          })),
        )
        .sort((a, b) => a.distance - b.distance);
    for (const factor of AUTO_LAYOUT_SCALE_FACTORS) {
      if (placed) break;
      const candidateWidth = width * factor,
        candidateHeight =
          (candidateWidth * anchor.rect.height) / anchor.rect.width;
      for (const candidate of candidates) {
        const candidatePoint = warpPoint(g, candidate.u, candidate.v, 1),
          rotation = tangentRotation(g, candidate.u, candidate.v);
        if (
          !fits(
            candidatePoint.x,
            candidatePoint.y,
            candidateWidth,
            candidateHeight,
            rotation,
            Math.max(1, safe * 0.35),
          )
        )
          continue;
        addLayer(
          `anchor-${anchor.id}`,
          anchor,
          candidatePoint.x,
          candidatePoint.y,
          candidateWidth,
          rotation,
          undefined,
          candidate.u,
          "anchor",
        );
        placed = true;
        break;
      }
    }
    if (!placed) unplaced.push(anchor.id);
  }
  let subjectCursor = 0;
  for (const path of paths) {
    if (!pathSubjects.length) break;
    const arcLength = g.topArc * (1 - path.v) + g.bottomArc * path.v,
      baseCapacity = Math.max(
        1,
        Math.floor(
          (Math.max(1, arcLength - safe * 2) + itemGap) /
            Math.max(0.01, averageWidth + itemGap),
        ),
      ),
      // Give the narrow final row one extra editable subject. The user can
      // resolve any deliberate crowding with the instance controls.
      capacity = baseCapacity + (path.pathIndex === paths.length - 1 ? 1 : 0);
    for (let slot = 0; slot < capacity; slot++) {
      const distance =
          safe + ((slot + 0.5) * Math.max(1, arcLength - safe * 2)) / capacity,
        u = Math.max(0, Math.min(1, distance / Math.max(0.01, arcLength))),
        towardMiddle = path.v < 0.5 ? 1 : -1,
        // Keep every subject visually inside its own band. Larger vertical
        // nudges made a four-path layout collapse into three apparent rows.
        searchPoints = [
          { du: 0, dv: 0 },
          { du: -0.28 / capacity, dv: 0 },
          { du: 0.28 / capacity, dv: 0 },
          { du: -0.45 / capacity, dv: 0 },
          { du: 0.45 / capacity, dv: 0 },
          { du: 0, dv: towardMiddle * 0.018 },
          { du: -0.3 / capacity, dv: towardMiddle * 0.018 },
          { du: 0.3 / capacity, dv: towardMiddle * 0.018 },
          { du: 0, dv: towardMiddle * 0.025 },
        ];
      // A single oversized/colliding subject must not block every following
      // slot. Try each source once and advance the cycle on every attempt.
      for (let attempt = 0; attempt < pathSubjects.length; attempt++) {
        const o = pathSubjects[subjectCursor % pathSubjects.length],
          width = o.rect.width * mm,
          height = o.rect.height * mm;
        subjectCursor++;
        let placed = false;
        // Edge rows sometimes need a small uniform reduction because their
        // rotated corners approach the curved cut line. This keeps all four
        // visual rows populated without stretching the artwork.
        for (const factor of AUTO_LAYOUT_SCALE_FACTORS) {
          if (placed) break;
          const candidateWidth = width * factor,
            candidateHeight = height * factor;
          for (const search of searchPoints) {
            const candidateU = Math.max(0.01, Math.min(0.99, u + search.du)),
              candidateV = Math.max(0.01, Math.min(0.99, path.v + search.dv)),
              candidatePoint = warpPoint(g, candidateU, candidateV, 1),
              rotation = tangentRotation(g, candidateU, candidateV);
            if (
              !fits(
                candidatePoint.x,
                candidatePoint.y,
                candidateWidth,
                candidateHeight,
                rotation,
                0,
                0.55,
              )
            )
              continue;
            addLayer(
              `path-${path.pathIndex}-${slot}-${o.id}`,
              o,
              candidatePoint.x,
              candidatePoint.y,
              candidateWidth,
              rotation,
              path.pathIndex,
              candidateU,
            );
            placed = true;
            break;
          }
        }
        if (placed) break;
      }
    }
  }
  for (const o of mainOrder)
    if (!placedSources.has(o.id) && !unplaced.includes(o.id))
      unplaced.push(o.id);
  const decorations = active.filter((o) => o.role === "decoration"),
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
      // Prefer gaps but permit restrained overlap with the subject layer.
      if (fits(x, y, w, h, 0, safe, 0.32)) {
        const id = `${o.id}-copy-${i}`;
        addLayer(id, o, x, y, w, 0, undefined, undefined, "decoration");
        placed = true;
      }
    }
  }
  return {
    layers: layers.sort((a, b) => {
      const rank = (layer: ArtLayer) =>
        layer.layerRole === "decoration"
          ? 0
          : layer.layerRole === "anchor"
            ? 2
            : 1;
      return rank(a) - rank(b);
    }),
    unplaced,
    pathCount,
    averageHeight,
    paths,
  };
}

export function blankRatio(
  alpha: Uint8Array,
  canvasWidth: number,
  canvasHeight: number,
  left: number,
  top: number,
  width: number,
  height: number,
) {
  const x0 = Math.max(0, Math.floor(left)),
    y0 = Math.max(0, Math.floor(top)),
    x1 = Math.min(canvasWidth, Math.ceil(left + width)),
    y1 = Math.min(canvasHeight, Math.ceil(top + height));
  if (x1 <= x0 || y1 <= y0) return 0;
  let occupied = 0,
    total = 0;
  for (let y = y0; y < y1; y += 2)
    for (let x = x0; x < x1; x += 2) {
      occupied += alpha[y * canvasWidth + x] > 20 ? 1 : 0;
      total++;
    }
  return 1 - occupied / Math.max(1, total);
}

export function respectsDecorationSpacing(
  x: number,
  y: number,
  width: number,
  placed: { x: number; y: number; width: number }[],
) {
  return placed.every(
    (other) =>
      Math.hypot(x - other.x, y - other.y) >= 2 * Math.max(width, other.width),
  );
}

export function decorationTargetCount(
  fanArea: number,
  typicalWidth: number,
  fill: number,
) {
  if (fill <= 0 || typicalWidth <= 0) return 0;
  // Count available visual cells, rather than source decoration types. A
  // single isolated star should be reusable across a large empty wrap.
  return Math.min(
    64,
    Math.max(
      1,
      Math.round(
        ((fanArea / (3.2 * typicalWidth) ** 2) * Math.min(100, fill)) / 100,
      ),
    ),
  );
}

/** Scans the actual arranged alpha image and inserts decorations into gaps. */
export async function arrangeSmartDecorations(
  input: Pick<
    LocalAdaptation,
    "sourceWidth" | "sourceHeight" | "objects" | "fill" | "scale" | "seed"
  >,
  cup: CupParams,
  currentLayers: ArtLayer[],
) {
  const g = geometry(cup),
    safe = Math.max(4, cup.safe ?? 0),
    rasterScale = Math.max(2, Math.min(6, 1200 / Math.max(g.width, g.height))),
    canvasWidth = Math.max(1, Math.ceil(g.width * rasterScale)),
    canvasHeight = Math.max(1, Math.ceil(g.height * rasterScale)),
    canvas = new OffscreenCanvas(canvasWidth, canvasHeight),
    ctx = canvas.getContext("2d", { willReadFrequently: true })!,
    byId = new Map(input.objects.map((object) => [object.id, object]));
  ctx.scale(rasterScale, rasterScale);
  for (const layer of currentLayers.filter(
    (item) => item.layerRole !== "decoration",
  )) {
    const object = byId.get(layer.sourceObjectId ?? "");
    if (!object) continue;
    const image = await createImageBitmap(layer.blob),
      height = (layer.width * object.rect.height) / object.rect.width;
    ctx.save();
    ctx.translate(layer.x, layer.y);
    ctx.rotate((layer.rotation * Math.PI) / 180);
    ctx.drawImage(image, -layer.width / 2, -height / 2, layer.width, height);
    ctx.restore();
    image.close();
  }
  const rgba = ctx.getImageData(0, 0, canvasWidth, canvasHeight).data,
    alpha = new Uint8Array(canvasWidth * canvasHeight);
  for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
  const decorations = input.objects.filter(
      (object) => object.role === "decoration",
    ),
    ratios = currentLayers.flatMap((layer) => {
      const object = byId.get(layer.sourceObjectId ?? "");
      return object?.rect.width ? [layer.width / object.rect.width] : [];
    }),
    visualRatio = median(
      ratios,
      Math.min(g.width / input.sourceWidth, g.height / input.sourceHeight) *
        input.scale,
    ),
    fanArea =
      Math.abs(
        g.points.reduce((sum, point, index) => {
          const next = g.points[(index + 1) % g.points.length];
          return sum + point.x * next.y - next.x * point.y;
        }, 0),
      ) / 2,
    targetCount = decorations.length
      ? decorationTargetCount(
          fanArea,
          median(decorations.map((object) => object.rect.width * visualRatio)),
          input.fill,
        )
      : 0,
    placed: { x: number; y: number; width: number }[] = [],
    bandCounts = [0, 0, 0, 0],
    result: ArtLayer[] = [],
    rng = random(input.seed),
    candidateCache = new Map<
      string,
      { x: number; y: number; score: number }[]
    >();
  for (let index = 0; index < targetCount && decorations.length; index++) {
    const object = decorations[index % decorations.length],
      width = object.rect.width * visualRatio,
      height = object.rect.height * visualRatio,
      step = Math.max(1, Math.min(width, height) / 3);
    let candidates = candidateCache.get(object.id);
    if (!candidates) {
      candidates = [];
      for (
        let y = safe + height / 2;
        y <= g.height - safe - height / 2;
        y += step
      )
        for (
          let x = safe + width / 2;
          x <= g.width - safe - width / 2;
          x += step
        ) {
          const boundary = boxBoundaryPoints(x, y, width, height);
          if (!boundary.every((point) => inside(point, g.points))) continue;
          const empty = blankRatio(
            alpha,
            canvasWidth,
            canvasHeight,
            (x - width / 2) * rasterScale,
            (y - height / 2) * rasterScale,
            width * rasterScale,
            height * rasterScale,
          );
          if (empty < 0.96) continue;
          const ringEmpty = blankRatio(
            alpha,
            canvasWidth,
            canvasHeight,
            (x - width) * rasterScale,
            (y - height) * rasterScale,
            width * 2 * rasterScale,
            height * 2 * rasterScale,
          );
          candidates.push({ x, y, score: 1 - ringEmpty + rng() * 0.0001 });
        }
      candidateCache.set(object.id, candidates);
    }
    // Spread into genuinely empty areas after first filling the gaps close
    // to subjects. The two-width separation still prevents repeated motifs.
    let best: (typeof candidates)[number] | undefined;
    let bestScore = -Infinity;
    for (const candidate of candidates) {
      if (!respectsDecorationSpacing(candidate.x, candidate.y, width, placed))
        continue;
      const spread = placed.length
        ? Math.min(
            1,
            Math.min(
              ...placed.map((other) =>
                Math.hypot(candidate.x - other.x, candidate.y - other.y),
              ),
            ) / Math.max(1, width * 5),
          )
        : 0;
      const band = Math.min(3, Math.floor((candidate.y / g.height) * 4));
      const score =
        candidate.score * 0.45 +
        spread * 0.4 -
        (bandCounts[band] / Math.max(1, targetCount / 4)) * 0.7;
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    if (!best) continue;
    placed.push({ x: best.x, y: best.y, width });
    bandCounts[Math.min(3, Math.floor((best.y / g.height) * 4))]++;
    result.push({
      id: `smart-decoration-${index}-${object.id}`,
      blob: object.blob,
      sourceObjectId: object.id,
      x: best.x,
      y: best.y,
      width,
      rotation: 0,
      autoX: best.x,
      autoY: best.y,
      autoWidth: width,
      autoRotation: 0,
      locked: false,
      layerRole: "decoration",
    });
  }
  return result;
}
