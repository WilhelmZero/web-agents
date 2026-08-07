export interface RgbColor { r: number; g: number; b: number }
export interface PreparedTransparentEdit { image: File; matte?: RgbColor; promptSuffix: string }

const MATTE_CANDIDATES: RgbColor[] = [
  { r: 255, g: 0, b: 255 }, { r: 0, g: 255, b: 0 },
  { r: 0, g: 255, b: 255 }, { r: 255, g: 255, b: 0 },
];
const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
const colorHex = ({ r, g, b }: RgbColor) => `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`;

export function hasTransparentPixels(data: Uint8ClampedArray): boolean {
  for (let index = 3; index < data.length; index += 4) if (data[index] < 255) return true;
  return false;
}

export function chooseChromaMatte(data: Uint8ClampedArray): RgbColor {
  const scores = MATTE_CANDIDATES.map(() => Number.POSITIVE_INFINITY);
  const pixelCount = data.length / 4;
  const step = Math.max(1, Math.floor(pixelCount / 12000));
  for (let pixel = 0; pixel < pixelCount; pixel += step) {
    const index = pixel * 4;
    if (data[index + 3] < 96) continue;
    MATTE_CANDIDATES.forEach((candidate, candidateIndex) => {
      const distance = (data[index] - candidate.r) ** 2 + (data[index + 1] - candidate.g) ** 2 + (data[index + 2] - candidate.b) ** 2;
      scores[candidateIndex] = Math.min(scores[candidateIndex], distance);
    });
  }
  return MATTE_CANDIDATES[scores.reduce((winner, score, index) => score > scores[winner] ? index : winner, 0)];
}

export function removeChromaFromPixels(data: Uint8ClampedArray, matte: RgbColor): Uint8ClampedArray {
  const result = new Uint8ClampedArray(data);
  for (let index = 0; index < result.length; index += 4) {
    const distance = Math.max(Math.abs(result[index] - matte.r), Math.abs(result[index + 1] - matte.g), Math.abs(result[index + 2] - matte.b));
    const coverage = distance <= 18 ? 0 : distance >= 100 ? 1 : (distance - 18) / 82;
    const outputAlpha = (result[index + 3] / 255) * coverage;
    if (outputAlpha <= 0) {
      result[index] = 0; result[index + 1] = 0; result[index + 2] = 0; result[index + 3] = 0;
      continue;
    }
    if (coverage < 1) {
      result[index] = clampByte((result[index] - (1 - coverage) * matte.r) / coverage);
      result[index + 1] = clampByte((result[index + 1] - (1 - coverage) * matte.g) / coverage);
      result[index + 2] = clampByte((result[index + 2] - (1 - coverage) * matte.b) / coverage);
    }
    result[index + 3] = clampByte(outputAlpha * 255);
  }
  return result;
}

async function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return await new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('无法生成透明图片数据')), 'image/png'));
}

export async function prepareTransparentImageForEdit(file: File): Promise<PreparedTransparentEdit> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('当前浏览器不支持透明图片处理');
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    if (!hasTransparentPixels(pixels.data)) return { image: file, promptSuffix: '' };
    const matte = chooseChromaMatte(pixels.data);
    context.globalCompositeOperation = 'destination-over'; context.fillStyle = colorHex(matte); context.fillRect(0, 0, canvas.width, canvas.height);
    const blob = await canvasBlob(canvas);
    return {
      image: new File([blob], `${file.name.replace(/\.[^.]+$/, '')}_alpha-matte.png`, { type: 'image/png' }), matte,
      promptSuffix: `\n透明通道保护规则：输入图的透明区域已临时用纯色 ${colorHex(matte)} 标记。该颜色只是透明通道标记，不是画面背景。除指定文字区域外，必须让所有标记区域保持完全均匀、无纹理、无阴影、无渐变的准确 ${colorHex(matte)}，不得在其中新增内容；系统会在生成后将该颜色恢复为透明。`,
    };
  } finally { bitmap.close(); }
}

export async function restoreTransparentBackground(blob: Blob, matte: RgbColor): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('当前浏览器不支持透明图片处理');
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    pixels.data.set(removeChromaFromPixels(pixels.data, matte)); context.putImageData(pixels, 0, 0);
    return await canvasBlob(canvas);
  } finally { bitmap.close(); }
}
