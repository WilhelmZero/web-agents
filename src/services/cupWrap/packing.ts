import { geometry, inside, distanceToEdge, type Point } from "./geometry";
import type { WrapDesign, PrintSettings } from "./types";
export interface Placement {
  id: string;
  x: number;
  y: number;
  rotation: number;
  width: number;
  height: number;
}
export interface PrintLayout {
  pages: Placement[][];
  omitted: string[];
  width: number;
  height: number;
}
export function placementPoints(
  p: Placement,
  d: WrapDesign,
  bleed: boolean,
): Point[] {
  const g = geometry(d.cup),
    b = bleed ? d.cup.bleed : 0;
  return g.points.map((v) => {
    const q =
      p.rotation === 0
        ? v
        : p.rotation === 90
          ? { x: g.height - v.y, y: v.x }
          : p.rotation === 180
            ? { x: g.width - v.x, y: g.height - v.y }
            : { x: v.y, y: g.width - v.x };
    return { x: p.x + b + q.x, y: p.y + b + q.y };
  });
}
export function placementError(
  candidate: Placement,
  others: Placement[],
  designs: WrapDesign[],
  s: PrintSettings,
): string {
  const pw = s.landscape ? 297 : 210,
    ph = s.landscape ? 210 : 297;
  if (
    candidate.x < s.margin ||
    candidate.y < s.margin ||
    candidate.x + candidate.width > pw - s.margin ||
    candidate.y + candidate.height > ph - s.margin
  )
    return "超出可打印范围";
  const d = designs.find((v) => v.id === candidate.id)!,
    a = placementPoints(candidate, d, s.bleed);
  for (const other of others) {
    if (
      candidate.x > other.x + other.width + s.gap ||
      other.x > candidate.x + candidate.width + s.gap ||
      candidate.y > other.y + other.height + s.gap ||
      other.y > candidate.y + candidate.height + s.gap
    )
      continue;
    const e = designs.find((v) => v.id === other.id)!,
      b = placementPoints(other, e, s.bleed),
      gap = s.gap + (s.bleed ? d.cup.bleed + e.cup.bleed : 0);
    if (
      a.some((p) => inside(p, b) || distanceToEdge(p, b) < gap + 0.01) ||
      b.some((p) => inside(p, a) || distanceToEdge(p, a) < gap + 0.01)
    )
      return "图案重叠或间距不足";
    const cross = (p: Point, q: Point, r: Point) =>
      (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    for (let i = 0; i < a.length; i++)
      for (let j = 0; j < b.length; j++) {
        const p = a[i],
          q = a[(i + 1) % a.length],
          r = b[j],
          t = b[(j + 1) % b.length];
        if (
          cross(p, q, r) * cross(p, q, t) < 0 &&
          cross(r, t, p) * cross(r, t, q) < 0
        )
          return "图案轮廓相交";
      }
  }
  return "";
}
export function pack(designs: WrapDesign[], s: PrintSettings): PrintLayout {
  const width = s.landscape ? 297 : 210,
    height = s.landscape ? 210 : 297;
  if (s.margin < 0 || s.margin * 2 >= Math.min(width, height) || s.gap < 0)
    throw new Error("纸张边距或间距无效");
  const w = Math.floor(width - 2 * s.margin),
    h = Math.floor(height - 2 * s.margin);
  const shapes = new Map(
    designs.map((d) => {
      const g = geometry(d.cup),
        bleed = s.bleed ? d.cup.bleed : 0,
        pad = bleed + s.gap / 2;
      const variants = [0, ...(s.rotate ? [90, 180, 270] : [])].map(
        (rotation) => {
          const rw = rotation % 180 ? g.height : g.width,
            rh = rotation % 180 ? g.width : g.height;
          const bw = Math.ceil(rw + 2 * pad),
            bh = Math.ceil(rh + 2 * pad),
            cells: number[][] = [];
          if (bw > w || bh > h)
            return { rotation, bw, bh, cells, rw, rh, bleed };
          for (let y = 0; y < bh; y++)
            for (let x = 0; x < bw; x++) {
              const xx = x + 0.5 - pad,
                yy = y + 0.5 - pad;
              const p: Point =
                rotation === 0
                  ? { x: xx, y: yy }
                  : rotation === 90
                    ? { x: yy, y: g.height - xx }
                    : rotation === 180
                      ? { x: g.width - xx, y: g.height - yy }
                      : { x: g.width - yy, y: xx };
              if (
                inside(p, g.points) ||
                distanceToEdge(p, g.points) <= pad + Math.SQRT1_2
              )
                cells.push([x, y]);
            }
          return { rotation, bw, bh, cells, rw, rh, bleed };
        },
      );
      return [d.id, variants] as const;
    }),
  );
  let best: PrintLayout | undefined;
  for (const order of [
    designs,
    [...designs].reverse(),
    [...designs].sort((a, b) => geometry(b.cup).area - geometry(a.cup).area),
  ]) {
    const pages: Placement[][] = [[]],
      grids = [new Uint8Array(w * h)],
      omitted: string[] = [];
    const insert = (id: string, page: number) => {
      for (const v of shapes.get(id)!)
        for (let y = 0; y <= h - v.bh; y++)
          for (let x = 0; x <= w - v.bw; x++) {
            if (v.cells.some(([cx, cy]) => grids[page][(y + cy) * w + x + cx]))
              continue;
            for (const [cx, cy] of v.cells)
              grids[page][(y + cy) * w + x + cx] = 1;
            pages[page].push({
              id,
              x: x + s.margin + s.gap / 2,
              y: y + s.margin + s.gap / 2,
              rotation: v.rotation,
              width: v.rw + 2 * v.bleed,
              height: v.rh + 2 * v.bleed,
            });
            return true;
          }
      return false;
    };
    for (const d of order)
      for (
        let n = 0;
        n < (s.mode === "fill" ? 1 : Math.min(100, d.quantity));
        n++
      ) {
        if (pages.some((_, p) => insert(d.id, p))) continue;
        if (
          s.mode === "quantity" &&
          shapes.get(d.id)!.some((v) => v.bw <= w && v.bh <= h)
        ) {
          pages.push([]);
          grids.push(new Uint8Array(w * h));
          insert(d.id, pages.length - 1);
        } else omitted.push(d.id);
      }
    if (s.mode === "fill") {
      let added = true;
      while (added && pages[0].length < 200) {
        added = false;
        for (const d of order) if (insert(d.id, 0)) added = true;
      }
    }
    const candidate = {
      pages: pages.filter((p) => p.length),
      omitted,
      width,
      height,
    };
    if (
      !best ||
      candidate.omitted.length < best.omitted.length ||
      (candidate.omitted.length === best.omitted.length &&
        (s.mode === "fill"
          ? candidate.pages.flat().length > best.pages.flat().length
          : candidate.pages.length < best.pages.length))
    )
      best = candidate;
  }
  return best!;
}
