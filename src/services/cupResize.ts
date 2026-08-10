export interface RgbColor { r: number; g: number; b: number }

export const CUP_RESIZE_PROMPT = `执行精确杯子尺寸融合任务。第二张指导合成图是唯一的场景与几何蓝图：其中已经包含完整场景、用户涂抹内容和目标杯子。新杯子的外轮廓、像素宽度、像素高度、中心点、位置和旋转角度均为不可改变的绝对约束，输出中的杯子必须与第二张指导图里的新杯子逐像素同尺寸、同位置，禁止根据周围空白、涂抹色块、被遮住的旧杯子或其他场景物体重新估算杯子大小。用户涂抹或框选的区域只表示“需要恢复为自然场景背景的范围”，它不是新杯子的边界、遮罩或尺寸提示，绝不能让新杯子填满涂抹区域。第一张图仅用于提供杯子的清晰外观参考；杯子的材质、颜色、图案、Logo、文字、杯口、杯身、杯底和杯柄结构必须严格来自第一张图，不得放大、缩小、拉伸、压缩、弯曲、重塑或移动指导图里的杯子。只把第二张指导图中新杯子画布的纯色底替换为周围场景自然延续的内容，并补充符合该指导图场景的遮挡关系、接触阴影、反射、环境光、景深和边缘融合。除涂抹区域、纯色底区域和紧邻融合边缘外，第二张指导图中的所有人物、手势、物体、背景、构图和像素内容必须保持不变。输出尺寸和构图必须与第二张指导图一致，不得出现白边、色块、选择框或编辑标记。输出前必须对比第二张指导图，确认新杯子的像素包围框宽高和中心坐标保持一致。`;

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
