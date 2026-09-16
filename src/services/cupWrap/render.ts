import { geometry, pathData } from "./geometry";
import type { WrapDesign } from "./types";
import { containFit } from "./fitting";
import { framePlacement } from "./adaptation";
import { drawWarp, warpPoint } from "./warp";
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
  const local =
    d.adaptationMode === "local" &&
    d.localAdaptation?.cupKey === JSON.stringify(d.cup)
      ? d.localAdaptation
      : undefined;
  if (local) {
    if (local.backgroundMode !== "transparent") {
      ctx.fillStyle =
        local.backgroundMode === "white" ? "#ffffff" : local.backgroundColor;
      ctx.fillRect(-b, -b, g.width + b * 2, g.height + b * 2);
    }
  } else if (d.adopted && d.adoptedFrame) {
    if (d.adoptedFrame.cupKey !== JSON.stringify(d.cup))
      throw new Error(
        "刀模尺寸已改变，请重新生成匹配当前刀模的候选图或切回原图。",
      );
    const img = await createImageBitmap(d.adopted);
    try {
      const box = framePlacement(img.width, img.height, g.width, g.height);
      if (!d.adoptedFrame.transparent || d.backgroundColor) {
        ctx.fillStyle = d.adoptedFrame.transparent
          ? d.backgroundColor!
          : "#ffffff";
        ctx.fillRect(-b, -b, g.width + b * 2, g.height + b * 2);
      }
      const adjust = d.aiAdjustment ?? { scale: 1, x: 0, y: 0, warp: 0 };
      ctx.save();
      ctx.translate(g.width / 2 + adjust.x, g.height / 2 + adjust.y);
      ctx.scale(adjust.scale, adjust.scale);
      ctx.translate(-g.width / 2, -g.height / 2);
      if (adjust.warp) drawWarp(ctx, img, g, adjust.warp);
      else ctx.drawImage(img, box.x, box.y, box.width, box.height);
      ctx.restore();
    } finally {
      img.close();
    }
  } else if (source) {
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
  const layerList =
    local?.layers ?? (d.adopted && d.adoptedFrame ? [] : d.layers);
  if (local) {
    const a = d.aiAdjustment ?? { scale: 1, x: 0, y: 0, warp: 0 };
    ctx.save();
    ctx.translate(g.width / 2 + a.x, g.height / 2 + a.y);
    ctx.scale(a.scale, a.scale);
    ctx.translate(-g.width / 2, -g.height / 2);
    for (const layer of layerList) {
      const p = a.warp
        ? warpPoint(g, layer.x / g.width, layer.y / g.height, a.warp)
        : layer;
      await draw(layer.blob, p.x, p.y, layer.width, layer.rotation);
    }
    ctx.restore();
  } else
    for (const layer of layerList)
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
