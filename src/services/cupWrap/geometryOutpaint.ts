import type { WrapGeometry } from "./geometry";
import type { ImageAdjustment } from "./types";
import { safeWarpRegion, scaleWarpRegion } from "./warp";

export const DEFAULT_GEOMETRY_OUTPAINT_PROMPT =
  "参考原图元素进行扩图，只用精灵和星星进行填充";

export interface OutpaintSize {
  width: number;
  height: number;
  idealRatio: number;
  targetRatio: number;
  ratioClamped: boolean;
  ratioError: number;
}

/** Balance the horizontal magnification at both radii of the printed band. */
export function idealOutpaintRatio(
  g: WrapGeometry,
  safeMm: number,
  adjustment: ImageAdjustment,
): number {
  const region = scaleWarpRegion(
    safeWarpRegion(g, 1, 1, Math.max(3, safeMm), 0.94, {
      leftGapMm: adjustment.leftGap ?? 0,
      rightGapMm: adjustment.rightGap ?? 0,
      topGapMm: adjustment.topGap ?? 10,
      bottomGapMm: adjustment.bottomGap ?? 10,
    }),
    adjustment.scaleX ?? 1,
    adjustment.scaleY ?? 1,
  );
  const arcAt = (v: number) => g.topArc + (g.bottomArc - g.topArc) * v;
  const uSpan = Math.abs(region.u1 - region.u0);
  const vSpan = Math.abs(region.v1 - region.v0);
  if (uSpan < 1e-6 || vSpan < 1e-6)
    throw new Error("图案映射区域过小，请减少留白或恢复缩放");
  const top = Math.max(0.001, arcAt(region.v0) * uSpan);
  const bottom = Math.max(0.001, arcAt(region.v1) * uSpan);
  return Math.sqrt(top * bottom) / Math.max(0.001, g.slant * vSpan);
}

/** GPT Image 2.5: 16px steps, 1:3..3:1, <=3840 edge, <=8,294,400px. */
export function chooseOutpaintSize(idealRatio: number): OutpaintSize {
  if (!Number.isFinite(idealRatio) || idealRatio <= 0)
    throw new Error("无法计算有效的矩形扩图比例");
  const targetRatio = Math.max(1 / 3, Math.min(3, idealRatio));
  let best: { width: number; height: number; pixels: number; error: number } | undefined;
  for (let width = 16; width <= 3840; width += 16) {
    for (let height = 16; height <= 3840; height += 16) {
      const pixels = width * height;
      if (pixels < 655_360 || pixels > 8_294_400) continue;
      const ratio = width / height;
      if (ratio < 1 / 3 || ratio > 3) continue;
      const error = Math.abs(ratio / targetRatio - 1);
      const close = error <= 0.005;
      const bestClose = best ? best.error <= 0.005 : false;
      if (
        !best ||
        (close && !bestClose) ||
        (close === bestClose &&
          (close
            ? pixels > best.pixels || (pixels === best.pixels && error < best.error)
            : error < best.error || (error === best.error && pixels > best.pixels)))
      ) best = { width, height, pixels, error };
    }
  }
  if (!best) throw new Error("没有符合图片模型限制的扩图尺寸");
  return {
    width: best.width,
    height: best.height,
    idealRatio,
    targetRatio,
    ratioClamped: idealRatio !== targetRatio,
    ratioError: best.error,
  };
}
