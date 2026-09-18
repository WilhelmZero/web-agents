import { geometry, type CupParams } from "./geometry";

export function adaptationPrompt(
  cup: CupParams,
  user: string,
  transparent = false,
) {
  const g = geometry(cup);
  return `${user}\n\n【扩图任务】第一张就是用户已经调整好位置、大小并完成局部蒙版擦除的当前刀模彩图。以它为唯一构图基础，保持现有中央主体、文字、角色和小图案的位置、大小、比例及像素内容尽可能不变；不放大、不缩小、不拉伸、不弯曲、不重画。主要向周围空白区域扩展同风格背景、小装饰和自然连接内容，让图案填充第二张所示的扇形可印刷区域。\n【无边框成品】直接返回扩图后的完整插画，用它替换第一张。不要返回对比图、刀模示意图或说明文字。第二张的白色范围只是生成边界，灰色区域不可复制。严禁出现红线、轮廓线、描边框、尺寸或标签。${transparent ? "刀模外输出真正透明，不画棋盘格；保留白色角色。" : "输出纯白底。"}\n【刀模排版要求】输出宽高比例 ${g.width.toFixed(3)}:${g.height.toFixed(3)}。上边弧长 ${g.topArc.toFixed(3)}mm，下边弧长 ${g.bottomArc.toFixed(3)}mm，保持方向。不得通过非等比缩放适配刀模。所有帽尖、手臂、道具、猫头、脚、身体和文字必须完整。距离刀模四周至少留 ${Math.max(cup.safe, 4).toFixed(1)}mm 安全空隙；宁可留白也不能裁掉主体。只可在空隙补充同风格的小装饰或背景纹理，不新增主要角色，不遮挡文字或主体。提交前检查全部弧边和侧边，无主体与边界相交。`;
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
