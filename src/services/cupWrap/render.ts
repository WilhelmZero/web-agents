import { geometry, pathData } from "./geometry";
import type { WrapDesign } from "./types";
import { containFit } from "./fitting";
export async function renderDesign(
  d: WrapDesign,
  dpi: number,
  withBleed = false,
  preview = false,
): Promise<OffscreenCanvas> {
  const g = geometry(d.cup),
    b = withBleed ? d.cup.bleed : 0;
  const factor = preview ? Math.min(6, 1200 / (g.width + 2 * b)) : dpi / 25.4;
  const width = Math.max(1, Math.round((g.width + 2 * b) * factor)),
    height = Math.max(1, Math.round((g.height + 2 * b) * factor));
  if (width > 16384 || height > 16384 || width * height > 48_000_000)
    throw new Error(
      "导出超过 16384px 或 4800 万像素，请降低 DPI；物理尺寸不会改变",
    );
  const canvas = new OffscreenCanvas(width, height),
    ctx = canvas.getContext("2d")!;
  ctx.scale(factor, factor);
  ctx.translate(b, b);
  const draw = async (
    blob: Blob,
    x: number,
    y: number,
    w: number,
    rotation: number,
  ) => {
    const img = await createImageBitmap(blob);
    try {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.drawImage(
        img,
        -w / 2,
        (-w * img.height) / img.width / 2,
        w,
        (w * img.height) / img.width,
      );
      ctx.restore();
    } finally {
      img.close();
    }
  };
  const source = d.adopted || d.source;
  if (source) {
    const img = await createImageBitmap(source);
    const fit = d.fit === "cover" ? Math.max : Math.min;
    const contained = containFit(g, img.width, img.height);
    const scale =
      (d.fit === "contain"
        ? contained.scale
        : fit((g.width + 2 * b) / img.width, (g.height + 2 * b) / img.height)) *
      d.scale;
    const iw = img.width * scale,
      ih = img.height * scale;
    ctx.save();
    ctx.translate(
      (d.fit === "contain" ? contained.cx : g.width / 2) + d.x,
      (d.fit === "contain" ? contained.cy : g.height / 2) + d.y,
    );
    ctx.rotate((d.rotation * Math.PI) / 180);
    if (d.fit === "tile") {
      const reach = Math.hypot(g.width + 2 * b, g.height + 2 * b);
      if (iw < 1 || ih < 1 || (reach * reach) / (iw * ih) > 10000) {
        img.close();
        throw new Error("平铺图案过小，请增大缩放");
      }
      for (let y = -reach; y < reach; y += ih)
        for (let x = -reach; x < reach; x += iw)
          ctx.drawImage(img, x, y, iw, ih);
    } else ctx.drawImage(img, -iw / 2, -ih / 2, iw, ih);
    ctx.restore();
    img.close();
  }
  for (const layer of d.layers)
    await draw(layer.blob, layer.x, layer.y, layer.width, layer.rotation);
  // Mask after drawing, keeping guide strokes out of production output.
  const mask = new OffscreenCanvas(width, height),
    m = mask.getContext("2d")!;
  m.scale(factor, factor);
  m.translate(b, b);
  m.fillStyle = "white";
  m.strokeStyle = "white";
  const p = new Path2D(pathData(g.points));
  m.fill(p);
  if (b) {
    m.lineWidth = 2 * b;
    m.lineJoin = "round";
    m.stroke(p);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(mask, 0, 0);
  return canvas;
}
