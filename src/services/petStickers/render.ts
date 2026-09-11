import {
  HEIGHT,
  WIDTH,
  type Glyph,
  type Layout,
  type PetLibrary,
  type PetSettings,
  type Sprite,
} from "./types";
import { makeLayout } from "./layout";
import { ensurePetFont, fontFamily } from "./fonts";
const base = () => `${import.meta.env.BASE_URL}pet-letter-stickers/`;
export const ensureFont = ensurePetFont;
export async function defaultLibrary(): Promise<PetLibrary> {
  const r = await fetch(`${base()}manifest.json`);
  if (!r.ok) throw new Error("默认素材加载失败");
  const lib = (await r.json()) as PetLibrary;
  return {
    ...lib,
    builtin: true,
    assets: lib.assets.map((a) => ({
      ...a,
      src: base() + a.src,
      frontSrc: a.frontSrc ? base() + a.frontSrc : undefined,
      rearSrc: a.rearSrc ? base() + a.rearSrc : undefined,
    })),
  };
}
export function canvasBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob(
      (b) =>
        b
          ? resolve(b)
          : reject(new Error("浏览器无法编码此尺寸，请选择 75% 或 50% 后重试")),
      "image/png",
    ),
  );
}
function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("无法分配画布，请选择 75% 或 50%");
  return { c, ctx };
}
export async function glyphGeometry(letter: string, settings: PetSettings) {
  await ensureFont(settings.fontKey || "anton");
  const { c, ctx } = canvas(1000, 600);
  ctx.font = `1000px ${fontFamily(settings.fontKey)}`;
  const m = ctx.measureText(letter);
  const target = (HEIGHT * settings.height) / 100;
  const fontSize =
    (target / (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent)) * 1000;
  const w =
    ((m.actualBoundingBoxLeft + m.actualBoundingBoxRight) * fontSize) / 1000;
  const x = (WIDTH - w) / 2,
    y = (HEIGHT - target) / 2;
  const glyph: Glyph = {
    x,
    y,
    width: w,
    height: target,
    fontSize,
    originX: x + (m.actualBoundingBoxLeft * fontSize) / 1000,
    baseline: y + (m.actualBoundingBoxAscent * fontSize) / 1000,
  };
  ctx.scale(1000 / WIDTH, 600 / HEIGHT);
  paintLetter(ctx, letter, settings, glyph);
  const pixels = ctx.getImageData(0, 0, 1000, 600).data;
  // Summed-area alpha table makes exact glyph collision checks cheap, including
  // the negative spaces of A/B/G etc. Decorations never cover actual lettering.
  const integral = new Uint32Array(1001 * 601);
  for (let yy = 0; yy < 600; yy++) {
    let row = 0;
    for (let xx = 0; xx < 1000; xx++) {
      row += pixels[(yy * 1000 + xx) * 4 + 3] > 8 ? 1 : 0;
      integral[(yy + 1) * 1001 + xx + 1] = integral[yy * 1001 + xx + 1] + row;
    }
  }
  const contour = {
    overlaps: (
      r: { x: number; y: number; width: number; height: number },
      margin: number,
    ) => {
      const x0 = Math.max(0, Math.floor(((r.x - margin) / WIDTH) * 1000)),
        y0 = Math.max(0, Math.floor(((r.y - margin) / HEIGHT) * 600)),
        x1 = Math.min(
          1000,
          Math.ceil(((r.x + r.width + margin) / WIDTH) * 1000),
        ),
        y1 = Math.min(
          600,
          Math.ceil(((r.y + r.height + margin) / HEIGHT) * 600),
        );
      return (
        integral[y1 * 1001 + x1] -
          integral[y0 * 1001 + x1] -
          integral[y1 * 1001 + x0] +
          integral[y0 * 1001 + x0] >
        0
      );
    },
    top: (at: number) => {
      const xx = Math.max(0, Math.min(999, Math.round((at / WIDTH) * 1000)));
      for (let yy = 0; yy < 600; yy++)
        if (pixels[(yy * 1000 + xx) * 4 + 3] > 128) return (yy / 600) * HEIGHT;
      return y;
    },
    right: (at: number) => {
      const yy = Math.max(0, Math.min(599, Math.round((at / HEIGHT) * 600)));
      for (let xx = 999; xx >= 0; xx--)
        if (pixels[(yy * 1000 + xx) * 4 + 3] > 128) return (xx / 1000) * WIDTH;
      return x + w;
    },
  };
  c.width = c.height = 1;
  return { glyph, contour };
}
function paintLetter(
  ctx: CanvasRenderingContext2D,
  letter: string,
  s: PetSettings,
  g: Glyph,
) {
  ctx.font = `${g.fontSize}px ${fontFamily(s.fontKey)}`;
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  ctx.lineWidth = s.strokeWidth;
  ctx.strokeStyle = s.stroke;
  if (s.strokeWidth) ctx.strokeText(letter, g.originX, g.baseline);
  const fill = ctx.createLinearGradient(0, g.y, 0, g.y + g.height);
  fill.addColorStop(0, s.fill);
  fill.addColorStop(1, s.gradient ? s.fillEnd : s.fill);
  ctx.fillStyle = fill;
  ctx.fillText(letter, g.originX, g.baseline);
}
export async function createLayout(
  letter: string,
  lib: PetLibrary,
  s: PetSettings,
) {
  const { glyph, contour } = await glyphGeometry(letter, s);
  return makeLayout(letter, lib, s, glyph, contour);
}
export async function spriteBlob(a: Sprite) {
  if (a.blob) return a.blob;
  const r = await fetch(a.src);
  if (!r.ok) throw new Error(`素材读取失败：${a.name}`);
  return r.blob();
}
export async function renderLayout(
  layout: Layout,
  lib: PetLibrary,
  s: PetSettings,
  width = 1400,
): Promise<Blob> {
  await ensureFont(s.fontKey || "anton");
  const height = Math.round((width * HEIGHT) / WIDTH);
  if (width > WIDTH || height > HEIGHT)
    throw new Error("超过本工具独立输出上限");
  const { c, ctx } = canvas(width, height);
  try {
    // Check the far corner before expensive allocations. Never silently downscale.
    ctx.fillStyle = "#010203";
    ctx.fillRect(width - 1, height - 1, 1, 1);
    if (ctx.getImageData(width - 1, height - 1, 1, 1).data[3] !== 255)
      throw new Error("此设备不支持目标画布，请选择 75% 或 50%");
    ctx.clearRect(0, 0, width, height);
    ctx.scale(width / WIDTH, height / HEIGHT);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    if (s.background !== "transparent") {
      ctx.fillStyle = s.background;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
    const assets = new Map(lib.assets.map((a) => [a.id, a]));
    // Only reviewed, annotated belly regions may be covered by the letter.
    // Custom sprites without layers conservatively retain the entire master.
    for (const p of layout.placements) {
      const a = assets.get(p.spriteId);
      if (a?.reviewed && a.rearSrc && a.frontSrc) {
        const response = await fetch(a.rearSrc);
        if (!response.ok) throw new Error(`后景素材读取失败：${a.name}`);
        const bitmap = await createImageBitmap(await response.blob());
        try {
          ctx.drawImage(bitmap, p.x, p.y, p.width, p.height);
        } finally {
          bitmap.close();
        }
      }
    }
    paintLetter(ctx, layout.letter, s, layout.glyph);
    for (const p of layout.placements) {
      const a = assets.get(p.spriteId);
      if (!a || !a.reviewed)
        throw new Error("排版引用了未审核或其他素材库的角色");
      const bitmap = await createImageBitmap(
        await spriteBlob(
          a.frontSrc && a.rearSrc
            ? { ...a, blob: undefined, src: a.frontSrc }
            : a,
        ),
      );
      try {
        ctx.drawImage(bitmap, p.x, p.y, p.width, p.height);
      } finally {
        bitmap.close();
      }
    }
    return await canvasBlob(c);
  } finally {
    c.width = c.height = 1;
  }
}
