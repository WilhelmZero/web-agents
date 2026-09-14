import type { EngravingLayout, TextBlock } from "./layout-types";
import { ensureLayoutFont } from "./layout-fonts";
type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export function textLines(ctx: Context, t: TextBlock) {
  const measure = (s: string) =>
    (t.letterSpacing
      ? Array.from(s).reduce((sum, ch) => sum + ctx.measureText(ch).width, 0)
      : ctx.measureText(s).width) +
    Math.max(0, Array.from(s).length - 1) * t.letterSpacing;
  if (t.autoSize) return { lines: t.text.split("\n"), measure };
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
export function setTextFont(ctx: Context, t: TextBlock, family: string) {
  ctx.font = `${t.bold ? "bold " : ""}${t.fontSize}px "${family}"`;
}
// Shared by editor, main-thread preview and the export worker. Include script
// overhang and outlines so automatic boxes don't cut off swashes or bold ink.
export function autoTextMetrics(ctx: Context, t: TextBlock) {
  const { lines, measure } = textLines(ctx, { ...t, autoSize: true });
  let ascent = 0,
    descent = 0,
    left = 0,
    right = 0,
    width = 0;
  for (const line of lines) {
    const m = ctx.measureText(line || "Mg");
    ascent = Math.max(ascent, m.actualBoundingBoxAscent || t.fontSize * 0.8);
    descent = Math.max(descent, m.actualBoundingBoxDescent || t.fontSize * 0.2);
    width = Math.max(width, measure(line));
    if (t.letterSpacing) {
      let cursor = 0;
      for (const ch of line) {
        const ink = ctx.measureText(ch);
        left = Math.max(left, (ink.actualBoundingBoxLeft || 0) - cursor);
        right = Math.max(
          right,
          cursor + (ink.actualBoundingBoxRight || ink.width) - measure(line),
        );
        cursor += ink.width + t.letterSpacing;
      }
    } else {
      left = Math.max(left, m.actualBoundingBoxLeft || 0);
      right = Math.max(right, (m.actualBoundingBoxRight || m.width) - m.width);
    }
  }
  const pad = t.strokeWidth + 1;
  return {
    width: Math.max(1, Math.ceil(width + left + right + pad * 2)),
    height: Math.max(
      1,
      Math.ceil(
        ascent +
          descent +
          (lines.length - 1) * t.fontSize * t.lineHeight +
          pad * 2,
      ),
    ),
    left: left + pad,
    right: right + pad,
    top: ascent + pad,
  };
}
export async function fitLayoutTexts(
  ctx: Context,
  layout: EngravingLayout,
): Promise<EngravingLayout> {
  const families = await Promise.all(
    layout.texts.map((t) => ensureLayoutFont(t.font)),
  );
  let changed = false;
  const texts = layout.texts.map((t, i) => {
    if (!t.autoSize) return t;
    setTextFont(ctx, t, families[i]);
    const { width, height } = autoTextMetrics(ctx, t);
    if (width === t.width && height === t.height) return t;
    changed = true;
    return { ...t, width, height };
  });
  return changed ? { ...layout, texts } : layout;
}
export async function drawLayout(
  ctx: Context,
  layout: EngravingLayout,
  photo: CanvasImageSource,
  includeBrush = true,
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
    setTextFont(ctx, t, families[index]);
    const auto = t.autoSize ? autoTextMetrics(ctx, t) : undefined;
    if (auto) t = { ...t, width: auto.width, height: auto.height };
    ctx.textBaseline = "alphabetic";
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    const { lines, measure } = textLines(ctx, t);
    const metrics = ctx.measureText("Mg");
    const ascent = metrics.actualBoundingBoxAscent || t.fontSize * 0.8,
      descent = metrics.actualBoundingBoxDescent || t.fontSize * 0.2;
    if (
      !auto &&
      ((lines.length - 1) * t.fontSize * t.lineHeight +
        ascent +
        descent +
        t.strokeWidth >
        t.height ||
        lines.some((l) => measure(l) + t.strokeWidth > t.width))
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
        const innerWidth = t.width - (auto ? auto.left + auto.right : 0);
        let x =
          t.x +
          (auto?.left || 0) +
          (t.align === "center"
            ? (innerWidth - measure(line)) / 2
            : t.align === "right"
              ? innerWidth - measure(line)
              : 0);
        const y = t.y + (auto?.top || ascent) + i * t.fontSize * t.lineHeight;
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
  if (includeBrush) drawBrushStrokes(ctx, layout);
  ctx.restore();
  return overflow;
}

/** Paint is a non-destructive overlay above the photo and text. Coordinates are design pixels. */
export function drawBrushStrokes(
  ctx: Context,
  layout: EngravingLayout,
  isolated = false,
) {
  if (!layout.strokes?.length) return;
  // Erase only on a separate transparent paint surface, never on the underlying composition.
  if (!isolated && layout.strokes.some((stroke) => stroke.mode === "erase")) {
    const surface =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(ctx.canvas.width, ctx.canvas.height)
        : Object.assign(document.createElement("canvas"), {
            width: ctx.canvas.width,
            height: ctx.canvas.height,
          });
    const paint = surface.getContext("2d") as Context;
    paint.setTransform(ctx.getTransform());
    drawBrushStrokes(paint, layout, true);
    ctx.save();
    ctx.resetTransform();
    ctx.drawImage(surface, 0, 0);
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, layout.width, layout.height);
  ctx.clip();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const stroke of layout.strokes) {
    const first = stroke.points[0];
    if (!first) continue;
    ctx.globalCompositeOperation =
      stroke.mode === "erase" ? "destination-out" : "source-over";
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = stroke.size;
    ctx.beginPath();
    ctx.arc(first.x, first.y, stroke.size / 2, 0, Math.PI * 2);
    ctx.fill();
    if (stroke.points.length > 1) {
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      for (const point of stroke.points.slice(1)) ctx.lineTo(point.x, point.y);
      ctx.stroke();
    }
  }
  ctx.restore();
}
