import { geometry, type CupParams } from "./geometry";

export function adaptationPrompt(
  cup: CupParams,
  user: string,
  transparent = false,
) {
  const g = geometry(cup);
  return `${user}\n\n【刀模排版要求】第一张是原始图案，第二张是精确刀模画布。输出与第二张画布相同的宽高比例（${g.width.toFixed(3)}:${g.height.toFixed(3)}），图案分布沿第二张的轮廓展开，不要在轮廓内部放一个矩形拼图。上边弧长 ${g.topArc.toFixed(3)}mm，下边弧长 ${g.bottomArc.toFixed(3)}mm；严格保持该方向。只调整物体之间的间距及位置，不放大、缩小、拉伸、弯曲或裁断任何角色及文字；保留文字内容、每个主体的大小比例、服装、眼睛和完整肢体。边缘角色沿弧线错落排布且完整位于轮廓内。空隙过大时仅可复制原图中的小星星、糖果等小装饰，不复制主要角色或文字，不遮挡主体。不画刀线、尺寸、标签、边框或引导图的颜色。${transparent ? "输出真正透明的 PNG 背景（不是棋盘格图案），保留白色角色及白色细节。" : "背景颜色与原图保持一致。"}轮廓之外不安排任何图案。`;
}

// Use a uniform canvas transform, never an inscribed-rectangle fit or a warp.
export function framePlacement(
  width: number,
  height: number,
  targetWidth: number,
  targetHeight: number,
) {
  if (Math.abs(width / height / (targetWidth / targetHeight) - 1) > 0.03)
    throw new Error(
      "AI 返回画布比例与刀模不符，已保留原始候选图；请重新生成，不能通过拉伸采用。",
    );
  const scale = Math.max(targetWidth / width, targetHeight / height);
  return {
    x: (targetWidth - width * scale) / 2,
    y: (targetHeight - height * scale) / 2,
    width: width * scale,
    height: height * scale,
  };
}
