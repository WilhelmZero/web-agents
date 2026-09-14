import type { EngravingLayout, TextBlock } from "./layout-types";
import { ensureLayoutFont } from "./layout-fonts";
type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export function textLines(ctx: Context, t: TextBlock) {
  const measure = (s: string) =>
    ctx.measureText(s).width +
    Math.max(0, Array.from(s).length - 1) * t.letterSpacing;
  const lines: string[] = [];
  for (const paragraph of t.text.split("\n")) {
    let line = "";
    for (const token of paragraph.split(/(\s+)/)) {
      if (measure(line + token) <= t.width) {
        line += token;
        continue;
      }
      if (line.trim()) {
        lines.push(line.trimEnd());
        line = "";
      }
      if (!token.trim()) continue;
      for (const ch of token) {
        if (line && measure(line + ch) > t.width) {
          lines.push(line);
          line = "";
        }
        line += ch;
      }
    }
    lines.push(line.trimEnd());
  }
  return { lines, measure };
}
export async function drawLayout(
  ctx: Context,
  layout: EngravingLayout,
  photo: CanvasImageSource,
) {
  const families = await Promise.all(
    layout.texts.map((t) => ensureLayoutFont(t.font)),
  );
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, layout.width, layout.height);
  ctx.clip();
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, layout.width, layout.height);
  const source = photo as { width: number; height: number };
  const box = layout.image;
  const fit = Math.min(box.width / source.width, box.height / source.height);
  ctx.drawImage(
    photo,
    box.x + (box.width - source.width * fit) / 2,
    box.y + (box.height - source.height * fit) / 2,
    source.width * fit,
    source.height * fit,
  );
  const overflow: string[] = [];
  layout.texts.forEach((t, index) => {
    ctx.save();
    ctx.font = `${t.fontSize}px "${families[index]}"`;
    ctx.textBaseline = "alphabetic";
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    const { lines, measure } = textLines(ctx, t);
    const metrics = ctx.measureText("Mg");
    const ascent = metrics.actualBoundingBoxAscent || t.fontSize * 0.8,
      descent = metrics.actualBoundingBoxDescent || t.fontSize * 0.2;
    if (
      (lines.length - 1) * t.fontSize * t.lineHeight +
        ascent +
        descent +
        t.strokeWidth >
        t.height ||
      lines.some((l) => measure(l) + t.strokeWidth > t.width)
    )
      overflow.push(t.id);
    ctx.beginPath();
    ctx.rect(
      t.x - t.strokeWidth,
      t.y - t.strokeWidth,
      t.width + t.strokeWidth * 2,
      t.height + t.strokeWidth * 2,
    );
    ctx.clip();
    ctx.strokeStyle = t.strokeColor;
    ctx.lineWidth = t.strokeWidth * 2;
    ctx.fillStyle = t.color;
    const paint = (stroke: boolean) =>
      lines.forEach((line, i) => {
        let x =
          t.x +
          (t.align === "center"
            ? (t.width - measure(line)) / 2
            : t.align === "right"
              ? t.width - measure(line)
              : 0);
        const y = t.y + ascent + i * t.fontSize * t.lineHeight;
        if (!t.letterSpacing) {
          if (stroke) ctx.strokeText(line, x, y);
          else ctx.fillText(line, x, y);
        } else
          for (const ch of line) {
            if (stroke) ctx.strokeText(ch, x, y);
            else ctx.fillText(ch, x, y);
            x += ctx.measureText(ch).width + t.letterSpacing;
          }
      });
    if (t.strokeWidth) paint(true);
    paint(false);
    ctx.restore();
  });
  ctx.restore();
  return overflow;
}
