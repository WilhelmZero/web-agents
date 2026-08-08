export interface RgbColor { r: number; g: number; b: number }
export interface PreparedTransparentEdit { image: File; matte?: RgbColor; promptSuffix: string }

const MATTE_CANDIDATES: RgbColor[] = [
  { r: 255, g: 0, b: 255 }, { r: 0, g: 255, b: 0 },
  { r: 0, g: 255, b: 255 }, { r: 255, g: 255, b: 0 },
];
const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
const colorHex = ({ r, g, b }: RgbColor) => `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
const smoothstep = (lower: number, upper: number, value: number) => {
  const normalized = Math.max(0, Math.min(1, (value - lower) / (upper - lower)));
  return normalized * normalized * (3 - 2 * normalized);
};

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const red = r / 255; const green = g / 255; const blue = b / 255;
  const maximum = Math.max(red, green, blue); const minimum = Math.min(red, green, blue); const delta = maximum - minimum;
  let hue = 0;
  if (delta > 0) {
    if (maximum === red) hue = ((green - blue) / delta) % 6;
    else if (maximum === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
    hue = ((hue / 6) + 1) % 1;
  }
  return [hue, maximum === 0 ? 0 : delta / maximum, maximum];
}

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

export function detectBorderMatteFromPixels(data: Uint8ClampedArray, width: number, height: number): RgbColor {
  const bins = new Map<number, { count: number; r: number; g: number; b: number }>();
  const borderX = Math.max(1, Math.round(width * 0.04)); const borderY = Math.max(1, Math.round(height * 0.04));
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (x >= borderX && x < width - borderX && y >= borderY && y < height - borderY) continue;
    const offset = (y * width + x) * 4;
    if (data[offset + 3] < 128) continue;
    const key = ((data[offset] >> 4) << 8) | ((data[offset + 1] >> 4) << 4) | (data[offset + 2] >> 4);
    const bin = bins.get(key) || { count: 0, r: 0, g: 0, b: 0 };
    bin.count += 1; bin.r += data[offset]; bin.g += data[offset + 1]; bin.b += data[offset + 2]; bins.set(key, bin);
  }
  const winner = [...bins.values()].sort((left, right) => right.count - left.count)[0];
  if (!winner) throw new Error('无法从图片边缘识别纯色背景');
  return { r: Math.round(winner.r / winner.count), g: Math.round(winner.g / winner.count), b: Math.round(winner.b / winner.count) };
}

export async function detectBorderMatte(blob: Blob): Promise<RgbColor> {
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('当前浏览器不支持背景色分析');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return detectBorderMatteFromPixels(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
  } finally { bitmap.close(); }
}

export function removeChromaFromPixels(data: Uint8ClampedArray, matte: RgbColor): Uint8ClampedArray {
  const result = new Uint8ClampedArray(data);
  const [matteHue, matteSaturation, matteValue] = rgbToHsv(matte.r, matte.g, matte.b);
  for (let index = 0; index < result.length; index += 4) {
    let backgroundConfidence: number;
    if (matteSaturation < 0.2 || matteValue < 0.2) {
      const distance = Math.max(Math.abs(result[index] - matte.r), Math.abs(result[index + 1] - matte.g), Math.abs(result[index + 2] - matte.b));
      backgroundConfidence = 1 - smoothstep(18, 100, distance);
    } else {
      const [hue, saturation, value] = rgbToHsv(result[index], result[index + 1], result[index + 2]);
      const hueDistance = Math.min(Math.abs(hue - matteHue), 1 - Math.abs(hue - matteHue));
      const hueConfidence = 1 - smoothstep(0.035, 0.14, hueDistance);
      const saturationConfidence = smoothstep(Math.max(0.18, matteSaturation * 0.3), Math.max(0.42, matteSaturation * 0.72), saturation);
      const valueConfidence = smoothstep(Math.max(0.12, matteValue * 0.22), Math.max(0.35, matteValue * 0.62), value);
      backgroundConfidence = hueConfidence * saturationConfidence * valueConfidence;
    }
    const coverage = 1 - backgroundConfidence;
    const outputAlpha = (result[index + 3] / 255) * coverage;
    if (outputAlpha <= 0.01) {
      result[index] = 0; result[index + 1] = 0; result[index + 2] = 0; result[index + 3] = 0;
      continue;
    }
    if (coverage < 0.995) {
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
