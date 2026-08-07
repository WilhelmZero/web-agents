import { chooseChromaMatte, removeChromaFromPixels, type RgbColor } from './transparentImageEdit';

export const DEFAULT_BACKGROUND_REMOVAL_PROMPT = '移除图片背景，只保留完整的前景主体。准确保留主体原有的形状、比例、颜色、材质、Logo、文字和内部细节，不要重绘或改变主体。主体轮廓必须清晰完整，细发、绒毛、透明或半透明边缘应自然保留。不要生成投影、接触阴影、反光、烟雾或颜色溢出污染背景。';

const colorHex = ({ r, g, b }: RgbColor) => `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`;

export function buildBackgroundRemovalPrompt(prompt: string, matte: RgbColor): string {
  const hex = colorHex(matte);
  return `${prompt.trim()}\n\n抠图底色技术要求：把主体之外的所有区域替换为完全均匀、单一且准确的纯色 ${hex}。主体和 ${hex} 底色必须明确分离；底色区域不得出现棋盘格、渐变、纹理、噪点、阴影、光晕、水印或其他内容。输出完整图片，不要说明文字。`;
}

export async function chooseBackgroundRemovalMatte(file: Blob): Promise<RgbColor> {
  const bitmap = await createImageBitmap(file);
  try {
    const maxDimension = 512;
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('当前浏览器无法分析图片颜色');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return chooseChromaMatte(context.getImageData(0, 0, canvas.width, canvas.height).data);
  } finally { bitmap.close(); }
}

export function detectSolidBorderColor(imageData: Pick<ImageData, 'data' | 'width' | 'height'>, fallback: RgbColor): { color: RgbColor; confidence: number } {
  const { data, width, height } = imageData;
  const band = Math.max(1, Math.min(20, Math.round(Math.min(width, height) * 0.025)));
  const bins = new Map<number, { count: number; r: number; g: number; b: number }>();
  let samples = 0;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (x >= band && x < width - band && y >= band && y < height - band) continue;
    const offset = (y * width + x) * 4;
    if (data[offset + 3] < 128) continue;
    const key = ((data[offset] >> 4) << 8) | ((data[offset + 1] >> 4) << 4) | (data[offset + 2] >> 4);
    const bin = bins.get(key) || { count: 0, r: 0, g: 0, b: 0 };
    bin.count += 1; bin.r += data[offset]; bin.g += data[offset + 1]; bin.b += data[offset + 2]; bins.set(key, bin); samples += 1;
  }
  let winner: { count: number; r: number; g: number; b: number } | undefined;
  bins.forEach((bin) => { if (!winner || bin.count > winner.count) winner = bin; });
  const confidence = winner && samples ? winner.count / samples : 0;
  if (!winner || confidence < 0.35) return { color: fallback, confidence };
  return { color: { r: Math.round(winner.r / winner.count), g: Math.round(winner.g / winner.count), b: Math.round(winner.b / winner.count) }, confidence };
}

export async function autoRemoveSolidBackground(blob: Blob, fallback: RgbColor): Promise<{ blob: Blob; detectedColor: RgbColor; confidence: number }> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('当前浏览器无法执行透明化处理');
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const detected = detectSolidBorderColor(pixels, fallback);
    pixels.data.set(removeChromaFromPixels(pixels.data, detected.color)); context.putImageData(pixels, 0, 0);
    const result = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('无法生成透明 PNG')), 'image/png'));
    return { blob: result, detectedColor: detected.color, confidence: detected.confidence };
  } finally { bitmap.close(); }
}
