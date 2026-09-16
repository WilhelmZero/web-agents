import { geometry, type CupParams } from "./geometry";

export function adaptationPrompt(
  cup: CupParams,
  user: string,
  transparent = false,
) {
  const g = geometry(cup);
  return `${user}\n\n【无边框成品】仅返回完整插画，不要返回刀模示意图。第二张的白色范围只是排布参考，灰色区域不可复制进成品。严禁出现红线、轮廓线、描边框、尺寸或标签。${transparent ? "输出真正透明 PNG，不画棋盘格；保留白色角色。" : "输出纯白底，包括排布范围之外也使用纯白色。"}\n【刀模排版要求】第一张是原始图案，第二张是范围参考。输出宽高比例 ${g.width.toFixed(3)}:${g.height.toFixed(3)}。上边弧长 ${g.topArc.toFixed(3)}mm，下边弧长 ${g.bottomArc.toFixed(3)}mm，保持方向。只调整间距和位置，不放大、缩小、拉伸或弯曲主体及文字。排布尽可能贴合范围即可，不要为强行贴边裁断角色。所有帽尖、手臂、道具、猫头、脚和身体必须完整。距离参考范围四周至少留 ${Math.max(cup.safe, 4).toFixed(1)}mm 的纯背景安全空隙，最外侧角色向内移动；宁可留白也不能裁掉主体。空隙可复制小星星、糖果等装饰，不复制主要角色，不遮挡文字或主体。保留原文字、角色身份及大小比例。提交前检查四条边，无任何角色与画布边缘或范围边缘相交。`;
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
