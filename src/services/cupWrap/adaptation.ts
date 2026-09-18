import { geometry, type CupParams } from "./geometry";

export function adaptationPrompt(
  cup: CupParams,
  user: string,
  transparent = false,
) {
  const g = geometry(cup);
  return `${user}\n\n【扩图任务】第一张是已精准放置的正面／背面原图合成稿，第二张是刀模可印刷范围。保持第一张中的中央主体、文字、角色和已有小图案尽可能不变，不放大、不缩小、不拉伸、不弯曲、不重画；主要向周围空白区域扩展同风格背景、小装饰与正背面之间的自然过渡。\n【无边框成品】仅返回完整插画，不要返回刀模示意图。第二张的白色范围只是生成边界，灰色区域不可复制进成品。严禁出现红线、轮廓线、描边框、尺寸或标签。${transparent ? "输出真正透明 PNG，不画棋盘格；保留白色角色。" : "输出纯白底。"}\n【刀模排版要求】输出宽高比例 ${g.width.toFixed(3)}:${g.height.toFixed(3)}。上边弧长 ${g.topArc.toFixed(3)}mm，下边弧长 ${g.bottomArc.toFixed(3)}mm，保持方向。不得通过非等比缩放适配刀模。所有帽尖、手臂、道具、猫头、脚、身体和文字必须完整。距离刀模四周至少留 ${Math.max(cup.safe, 4).toFixed(1)}mm 安全空隙；宁可留白也不能裁掉主体。只可在空隙补充同风格的小星星、糖果、叶片或背景纹理，不新增主要角色，不遮挡文字或主体。提交前检查全部弧边和侧边，无主体与边界相交。`;
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
  const scale = Math.min(targetWidth / width, targetHeight / height);
  return {
    x: (targetWidth - width * scale) / 2,
    y: (targetHeight - height * scale) / 2,
    width: width * scale,
    height: height * scale,
  };
}
