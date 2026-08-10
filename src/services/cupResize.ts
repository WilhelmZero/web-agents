export interface RgbColor { r: number; g: number; b: number }

export const CUP_RESIZE_PROMPT = `执行严格的局部背景融合任务。唯一输入图片就是最终指导合成图，它同时是唯一的场景来源、杯子外观来源和几何蓝图。图中的目标杯子已经具有最终正确尺寸和位置：杯子的外轮廓、像素宽度、像素高度、中心点、位置、方向、杯口、杯身、杯底、杯柄、材质、颜色、图案、Logo 和文字均为不可改变的绝对约束。禁止放大、缩小、移动、拉伸、压缩、弯曲、重塑、重绘或重新生成杯子；禁止根据周围空白、纯色色块、涂抹范围、被遮住的旧杯子或其他场景物体重新估算杯子大小。用户涂抹或框选的区域只表示需要恢复为自然场景背景的范围，它不是杯子的边界、遮罩或尺寸提示，绝不能让杯子填满涂抹区域。唯一允许的任务是把杯子白底画布的纯色底和用户涂抹色块替换为周围场景自然延续的内容，并在不改变杯子任何像素几何的前提下补充必要的接触阴影、反射、环境光、景深和边缘融合。除纯色底、涂抹区域和紧邻融合边缘外，输入图中的人物、手势、物体、背景、构图和像素内容必须保持不变。输出尺寸和构图必须与输入图完全一致，不得出现白边、色块、选择框或编辑标记。输出前必须逐像素对比输入图，确认杯子的像素包围框宽高、中心坐标、轮廓和内部图文完全不变。`;

export function rgbToHex({ r, g, b }: RgbColor): string {
  return `#${[r, g, b].map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('')}`;
}

export function inferBorderColor(data: ImageData): RgbColor {
  const { width, height } = data;
  const pixels = data.data;
  const sums = { r: 0, g: 0, b: 0, count: 0 };
  const sample = (x: number, y: number) => {
    const index = (y * width + x) * 4;
    if (pixels[index + 3] < 16) return;
    sums.r += pixels[index];
    sums.g += pixels[index + 1];
    sums.b += pixels[index + 2];
    sums.count += 1;
  };
  const stride = Math.max(1, Math.floor(Math.min(width, height) / 200));
  for (let x = 0; x < width; x += stride) { sample(x, 0); sample(x, height - 1); }
  for (let y = stride; y < height - stride; y += stride) { sample(0, y); sample(width - 1, y); }
  if (!sums.count) return { r: 255, g: 255, b: 255 };
  return { r: sums.r / sums.count, g: sums.g / sums.count, b: sums.b / sums.count };
}

export function cropCanvasDimensions(width: number, height: number, scale: number) {
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
