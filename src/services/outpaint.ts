export interface ExpansionPlacement { x: number; y: number; width: number; height: number }

export function calculateExpansionPlacement(sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number): ExpansionPlacement {
  if (sourceWidth <= 0 || sourceHeight <= 0 || targetWidth <= 0 || targetHeight <= 0) throw new Error('图片尺寸必须大于 0');
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale; const height = sourceHeight * scale;
  return { x: (targetWidth - width) / 2, y: (targetHeight - height) / 2, width, height };
}

export function closestAspectRatio(width: number, height: number, ratios: string[]): string {
  const target = width / height;
  return ratios.reduce((best, ratio) => {
    const [a, b] = ratio.split(':').map(Number); const [bestA, bestB] = best.split(':').map(Number);
    return Math.abs(a / b - target) < Math.abs(bestA / bestB - target) ? ratio : best;
  }, ratios[0]);
}

const canvasToBlob = async (canvas: HTMLCanvasElement) => await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('无法生成扩图画布')), 'image/png'));

export async function prepareOutpaintInput(file: File, targetWidth: number, targetHeight: number): Promise<{ file: File; placement: ExpansionPlacement }> {
  const bitmap = await createImageBitmap(file);
  try {
    const maxDimension = 1536; const scale = Math.min(1, maxDimension / Math.max(targetWidth, targetHeight));
    const width = Math.max(1, Math.round(targetWidth * scale)); const height = Math.max(1, Math.round(targetHeight * scale));
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d'); if (!context) throw new Error('当前浏览器无法创建扩图画布');
    context.fillStyle = '#808080'; context.fillRect(0, 0, width, height);
    const placement = calculateExpansionPlacement(bitmap.width, bitmap.height, width, height);
    context.drawImage(bitmap, placement.x, placement.y, placement.width, placement.height);
    const blob = await canvasToBlob(canvas);
    return { file: new File([blob], `${file.name.replace(/\.[^.]+$/, '')}_outpaint-input.png`, { type: 'image/png' }), placement: calculateExpansionPlacement(bitmap.width, bitmap.height, targetWidth, targetHeight) };
  } finally { bitmap.close(); }
}

export function buildOutpaintPrompt(customPrompt: string, targetWidth: number, targetHeight: number): string {
  return `${customPrompt.trim()}\n\n扩图技术要求：输出画幅为 ${targetWidth}:${targetHeight} 的比例。输入图中央的原始画面必须完整保留，不得裁切、缩放变形、移动、重绘或修改其中任何人物、产品、文字、Logo、颜色和细节。只在四周纯灰色空白区域补充缺失的环境内容，让透视、光线、景深、纹理和边界衔接自然。不要保留灰色边框，不要添加水印、文字、拼图或边框。`;
}

export async function composeExactOutpaint(generated: Blob, original: Blob, targetWidth: number, targetHeight: number): Promise<Blob> {
  const [generatedBitmap, originalBitmap] = await Promise.all([createImageBitmap(generated), createImageBitmap(original)]);
  try {
    const canvas = document.createElement('canvas'); canvas.width = targetWidth; canvas.height = targetHeight;
    const context = canvas.getContext('2d'); if (!context) throw new Error('当前浏览器无法合成精确尺寸扩图');
    const generatedScale = Math.max(targetWidth / generatedBitmap.width, targetHeight / generatedBitmap.height);
    const generatedWidth = generatedBitmap.width * generatedScale; const generatedHeight = generatedBitmap.height * generatedScale;
    context.drawImage(generatedBitmap, (targetWidth - generatedWidth) / 2, (targetHeight - generatedHeight) / 2, generatedWidth, generatedHeight);
    const placement = calculateExpansionPlacement(originalBitmap.width, originalBitmap.height, targetWidth, targetHeight);
    context.drawImage(originalBitmap, placement.x, placement.y, placement.width, placement.height);
    return await canvasToBlob(canvas);
  } finally { generatedBitmap.close(); originalBitmap.close(); }
}
