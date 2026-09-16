export interface CupParams {
  top: number;
  bottom: number;
  height: number;
  topInset: number;
  bottomInset: number;
  coverage: number;
  seam: number;
  bleed: number;
  safe: number;
}
export interface Point {
  x: number;
  y: number;
}
export interface WrapGeometry {
  points: Point[];
  width: number;
  height: number;
  topArc: number;
  bottomArc: number;
  slant: number;
  angle: number;
  area: number;
}
export const DEFAULT_CUP: CupParams = {
  top: 40,
  bottom: 34,
  height: 105,
  topInset: 0,
  bottomInset: 0,
  coverage: 360,
  seam: 0,
  bleed: 2,
  safe: 3,
};
export function geometry(p: CupParams): WrapGeometry {
  if (
    Object.values(p).some((v) => !Number.isFinite(v)) ||
    p.top <= 0 ||
    p.bottom <= 0 ||
    p.height <= 0 ||
    p.topInset < 0 ||
    p.bottomInset < 0 ||
    p.topInset + p.bottomInset >= p.height ||
    p.coverage <= 0 ||
    p.coverage > 360 ||
    p.bleed < 0 ||
    p.safe < 0
  )
    throw new Error("请输入有效尺寸；上下留白总和必须小于杯高");
  const a = (p.top + ((p.bottom - p.top) * p.topInset) / p.height) / 2;
  const b = (p.bottom + ((p.top - p.bottom) * p.bottomInset) / p.height) / 2;
  const h = p.height - p.topInset - p.bottomInset;
  const phi = (p.coverage * Math.PI) / 180 + p.seam / ((a + b) / 2);
  if (phi <= 0 || phi > 2 * Math.PI + 0.5)
    throw new Error("接缝调整后的覆盖范围无效");
  const slant = Math.hypot(h, a - b),
    points: Point[] = [];
  const delta = Math.abs(a - b),
    angle = delta < 1e-7 ? 0 : (phi * delta) / slant;
  if (!angle)
    points.push(
      { x: 0, y: 0 },
      { x: a * phi, y: 0 },
      { x: a * phi, y: h },
      { x: 0, y: h },
    );
  else {
    // Stable coordinates avoid catastrophic cancellation for almost cylindrical cups.
    const rt = (slant * a) / delta,
      rb = (slant * b) / delta,
      sign = a > b ? 1 : -1;
    const n = Math.max(128, Math.ceil(angle * 512));
    const at = (r: number, t: number): Point => ({
      x: r * Math.sin(t),
      y: sign * (rt - r + 2 * r * Math.sin(t / 2) ** 2),
    });
    for (let i = 0; i <= n; i++)
      points.push(at(rt, -angle / 2 + (angle * i) / n));
    for (let i = n; i >= 0; i--)
      points.push(at(rb, -angle / 2 + (angle * i) / n));
  }
  const minX = Math.min(...points.map((v) => v.x)),
    minY = Math.min(...points.map((v) => v.y));
  const normalized = points.map((v) => ({ x: v.x - minX, y: v.y - minY }));
  return {
    points: normalized,
    width: Math.max(...normalized.map((v) => v.x)),
    height: Math.max(...normalized.map((v) => v.y)),
    topArc: a * phi,
    bottomArc: b * phi,
    slant,
    angle,
    area: ((a + b) * phi * slant) / 2,
  };
}
export function pathData(points: Point[]) {
  return (
    points
      .map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(6)} ${p.y.toFixed(6)}`)
      .join(" ") + " Z"
  );
}
export function inside(point: Point, poly: Point[]): boolean {
  let yes = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j];
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      yes = !yes;
  }
  return yes;
}
export function distanceToEdge(p: Point, poly: Point[]) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length],
      dx = b.x - a.x,
      dy = b.y - a.y;
    const t = Math.max(
      0,
      Math.min(
        1,
        ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
      ),
    );
    best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
  }
  return best;
}
export function dielineSvg(g: WrapGeometry) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${g.width}mm" height="${g.height}mm" viewBox="0 0 ${g.width} ${g.height}"><path d="${pathData(g.points)}" fill="none" stroke="black" stroke-width="0.1"/></svg>`;
}
