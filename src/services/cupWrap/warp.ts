import type { WrapGeometry, Point } from "./geometry";

// Interpolate the actual top/bottom arcs, including reversed taper and cylinders.
export function warpPoint(
  g: WrapGeometry,
  u: number,
  v: number,
  amount: number,
): Point {
  const half = g.points.length / 2;
  const sample = (bottom: boolean) => {
    const t = u * (half - 1),
      i = Math.min(half - 2, Math.floor(t)),
      f = t - i;
    const index = (n: number) => (bottom ? g.points.length - 1 - n : n);
    const a = g.points[index(i)],
      b = g.points[index(i + 1)];
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  };
  const a = sample(false),
    b = sample(true);
  return {
    x: u * g.width * (1 - amount) + (a.x + (b.x - a.x) * v) * amount,
    y: v * g.height * (1 - amount) + (a.y + (b.y - a.y) * v) * amount,
  };
}

export function drawWarp(
  ctx: OffscreenCanvasRenderingContext2D,
  img: ImageBitmap,
  g: WrapGeometry,
  amount: number,
) {
  const nx = 48,
    ny = 24;
  const triangle = (uv: Point[]) => {
    const src = uv.map((p) => ({ x: p.x * img.width, y: p.y * img.height }));
    const dst = uv.map((p) => warpPoint(g, p.x, p.y, amount));
    const [s0, s1, s2] = src,
      [d0, d1, d2] = dst;
    const x1 = s1.x - s0.x,
      y1 = s1.y - s0.y,
      x2 = s2.x - s0.x,
      y2 = s2.y - s0.y,
      det = x1 * y2 - x2 * y1;
    const a = ((d1.x - d0.x) * y2 - (d2.x - d0.x) * y1) / det;
    const c = ((d2.x - d0.x) * x1 - (d1.x - d0.x) * x2) / det;
    const b = ((d1.y - d0.y) * y2 - (d2.y - d0.y) * y1) / det;
    const d = ((d2.y - d0.y) * x1 - (d1.y - d0.y) * x2) / det;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(d0.x, d0.y);
    ctx.lineTo(d1.x, d1.y);
    ctx.lineTo(d2.x, d2.y);
    ctx.closePath();
    ctx.clip();
    ctx.transform(
      a,
      b,
      c,
      d,
      d0.x - a * s0.x - c * s0.y,
      d0.y - b * s0.x - d * s0.y,
    );
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  };
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) {
      const a = { x: x / nx, y: y / ny },
        b = { x: (x + 1) / nx, y: y / ny },
        c = { x: x / nx, y: (y + 1) / ny },
        d = { x: (x + 1) / nx, y: (y + 1) / ny };
      triangle([a, b, c]);
      triangle([b, d, c]);
    }
}
