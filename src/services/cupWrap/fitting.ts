import { inside, type WrapGeometry } from "./geometry";
/** Uniformly fit a rectangle inside the real outline, including curved corners. */
export function containFit(g: WrapGeometry, width: number, height: number) {
  let cx = g.width / 2,
    cy = g.height / 2;
  if (!inside({ x: cx, y: cy }, g.points)) {
    const i = Math.floor((g.points.length / 2 - 1) / 2),
      a = g.points[i],
      b = g.points[g.points.length - 1 - i];
    cx = (a.x + b.x) / 2;
    cy = (a.y + b.y) / 2;
  }
  let low = 0,
    high = Math.min(g.width / width, g.height / height);
  for (let i = 0; i < 36; i++) {
    const s = (low + high) / 2;
    let valid = true;
    for (let y = -1; y <= 1; y += 0.25)
      for (let x = -1; x <= 1; x += 0.25)
        if (
          !inside(
            { x: cx + (x * width * s) / 2, y: cy + (y * height * s) / 2 },
            g.points,
          )
        )
          valid = false;
    if (valid) low = s;
    else high = s;
  }
  return { scale: low * 0.999999, cx, cy };
}
