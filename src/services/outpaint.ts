export interface ExpansionPlacement { x: number; y: number; width: number; height: number }
export type ExpansionAxis = 'horizontal' | 'vertical' | 'none';

export function expansionAxis(placement: ExpansionPlacement, targetWidth: number, targetHeight: number): ExpansionAxis {
  const horizontalGap = Math.max(0, targetWidth - placement.width);
  const verticalGap = Math.max(0, targetHeight - placement.height);
  if (horizontalGap < 0.5 && verticalGap < 0.5) return 'none';
  return horizontalGap > verticalGap ? 'horizontal' : 'vertical';
}

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

export async function prepareOutpaintInput(file: File, targetWidth: number, targetHeight: number): Promise<{ file: File; mask: File; placement: ExpansionPlacement }> {
  const bitmap = await createImageBitmap(file);
  try {
    const maxDimension = 1536; const scale = Math.min(1, maxDimension / Math.max(targetWidth, targetHeight));
    const width = Math.max(1, Math.round(targetWidth * scale)); const height = Math.max(1, Math.round(targetHeight * scale));
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d'); if (!context) throw new Error('当前浏览器无法创建扩图画布');
    const placement = calculateExpansionPlacement(bitmap.width, bitmap.height, width, height);
    const coverScale = Math.max(width / bitmap.width, height / bitmap.height) * 1.08;
    const coverWidth = bitmap.width * coverScale; const coverHeight = bitmap.height * coverScale;
    context.save(); context.filter = `blur(${Math.max(18, Math.round(Math.min(width, height) * 0.045))}px)`;
    context.drawImage(bitmap, (width - coverWidth) / 2, (height - coverHeight) / 2, coverWidth, coverHeight); context.restore();
    context.drawImage(bitmap, placement.x, placement.y, placement.width, placement.height);
    const blob = await canvasToBlob(canvas);
    const maskCanvas = document.createElement('canvas'); maskCanvas.width = width; maskCanvas.height = height;
    const maskContext = maskCanvas.getContext('2d'); if (!maskContext) throw new Error('当前浏览器无法创建扩图遮罩');
    maskContext.clearRect(0, 0, width, height);
    const overlap = Math.max(4, Math.min(24, Math.round(Math.min(placement.width, placement.height) * 0.025)));
    const axis = expansionAxis(placement, width, height);
    maskContext.fillStyle = '#fff';
    if (axis === 'vertical') maskContext.fillRect(0, placement.y + overlap, width, Math.max(1, placement.height - overlap * 2));
    else if (axis === 'horizontal') maskContext.fillRect(placement.x + overlap, 0, Math.max(1, placement.width - overlap * 2), height);
    else maskContext.fillRect(0, 0, width, height);
    const maskBlob = await canvasToBlob(maskCanvas);
    const baseName = file.name.replace(/\.[^.]+$/, '');
    return { file: new File([blob], `${baseName}_outpaint-input.png`, { type: 'image/png' }), mask: new File([maskBlob], `${baseName}_outpaint-mask.png`, { type: 'image/png' }), placement: calculateExpansionPlacement(bitmap.width, bitmap.height, targetWidth, targetHeight) };
  } finally { bitmap.close(); }
}

export function buildOutpaintPrompt(customPrompt: string, targetWidth: number, targetHeight: number): string {
  return `${customPrompt.trim()}\n\n扩图技术要求：输出画幅为 ${targetWidth}:${targetHeight} 的比例。只允许沿目标比例缺少的一个轴扩图：宽度不足时只补左、右，高度不足时只补上、下，禁止同时向四周扩展。原图必须按 contain 方式完整居中，长边刚好贴满输出画布对应边界，不得在该方向制造留白或新内容。输入图中央的清晰原始画面必须完整保留，不得裁切、缩放变形、移动或修改其中任何人物、产品、文字、Logo、颜色和细节。外围模糊区域只是用于提供颜色、光线和空间上下文，必须将其自然重绘为清晰且合理延续的环境。重点保证新增区域与原图边界的结构、透视、纹理、光线和景深连续，不得产生直线接缝、色块边界、重复纹理或突变。不要添加水印、文字、拼图或边框。`;
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
    const originalLayer = document.createElement('canvas'); originalLayer.width = targetWidth; originalLayer.height = targetHeight;
    const originalContext = originalLayer.getContext('2d'); if (!originalContext) throw new Error('当前浏览器无法创建原图融合层');
    originalContext.drawImage(originalBitmap, placement.x, placement.y, placement.width, placement.height);
    const maskLayer = document.createElement('canvas'); maskLayer.width = targetWidth; maskLayer.height = targetHeight;
    const maskContext = maskLayer.getContext('2d'); if (!maskContext) throw new Error('当前浏览器无法创建羽化遮罩');
    const feather = Math.max(8, Math.min(48, Math.round(Math.min(placement.width, placement.height) * 0.018)));
    const axis = expansionAxis(placement, targetWidth, targetHeight);
    if (axis === 'vertical') {
      const gradient = maskContext.createLinearGradient(0, placement.y, 0, placement.y + placement.height);
      const edge = Math.min(0.49, feather / placement.height);
      gradient.addColorStop(0, 'rgba(255,255,255,0)'); gradient.addColorStop(edge, '#fff'); gradient.addColorStop(1 - edge, '#fff'); gradient.addColorStop(1, 'rgba(255,255,255,0)');
      maskContext.fillStyle = gradient; maskContext.fillRect(0, placement.y, targetWidth, placement.height);
    } else if (axis === 'horizontal') {
      const gradient = maskContext.createLinearGradient(placement.x, 0, placement.x + placement.width, 0);
      const edge = Math.min(0.49, feather / placement.width);
      gradient.addColorStop(0, 'rgba(255,255,255,0)'); gradient.addColorStop(edge, '#fff'); gradient.addColorStop(1 - edge, '#fff'); gradient.addColorStop(1, 'rgba(255,255,255,0)');
      maskContext.fillStyle = gradient; maskContext.fillRect(placement.x, 0, placement.width, targetHeight);
    } else { maskContext.fillStyle = '#fff'; maskContext.fillRect(0, 0, targetWidth, targetHeight); }
    originalContext.globalCompositeOperation = 'destination-in'; originalContext.drawImage(maskLayer, 0, 0);
    context.drawImage(originalLayer, 0, 0);
    return await canvasToBlob(canvas);
  } finally { generatedBitmap.close(); originalBitmap.close(); }
}
