export interface BackgroundRemovalProgress {
  current: number;
  total: number;
  percent: number;
}
export interface BackgroundRemovalTuning { edgeExpansion: number; edgeFeather: number }

export const GPT_BACKGROUND_REMOVAL_PROMPT = `精确分离图片中的完整前景主体。保持主体的构图、位置、尺寸、比例、姿态、轮廓、颜色、材质、文字、Logo 和所有内部细节不变，不要重新设计、补画、裁切或移动主体。必须保留细发、绒毛、透明材质、镂空区域、轮辐、缝隙和细小零件。移除主体之外的全部背景、投影、背景反光和颜色溢出，把所有背景区域（包括主体内部孔洞）替换为完全均匀的纯白色 #FFFFFF。主体与白色背景之间边缘清晰自然，不要描边、光晕、棋盘格、渐变、纹理或残留背景。输出完整图片，不要添加说明文字。`;

export async function hasUsableTransparency(image: Blob): Promise<boolean> {
  const bitmap = await createImageBitmap(image);
  try {
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return false;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let transparent = 0;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index] < 245) transparent += 1;
    return transparent / (pixels.length / 4) >= 0.01;
  } finally { bitmap.close(); }
}

/**
 * Uses a dedicated foreground-segmentation / alpha-matting model in the browser.
 * The original RGB pixels are preserved and no generative image model is involved.
 */
export async function removeImageBackground(
  image: Blob,
  onProgress?: (progress: BackgroundRemovalProgress) => void,
  tuning: BackgroundRemovalTuning = { edgeExpansion: 2, edgeFeather: 1 },
): Promise<Blob> {
  // Keep the ONNX runtime out of the main app bundle; load it only when the
  // user actually starts a cutout task.
  const { removeBackground } = await import('@imgly/background-removal');
  const cutout = await removeBackground(image, {
    model: 'isnet_fp16',
    output: { format: 'image/png', quality: 1 },
    progress: (_key: string, current: number, total: number) => {
      onProgress?.({
        current,
        total,
        percent: total > 0 ? Math.min(100, Math.round(current / total * 100)) : 0,
      });
    },
  });
  return await applyTunedAlphaToSource(image, cutout, tuning);
}

export function tuneAlphaMask(source: Uint8ClampedArray, width: number, height: number, tuning: BackgroundRemovalTuning): Uint8ClampedArray {
  let alpha = new Uint8ClampedArray(source);
  const expansion = Math.max(0, Math.min(8, Math.round(tuning.edgeExpansion)));
  for (let pass = 0; pass < expansion; pass += 1) {
    const expanded = new Uint8ClampedArray(alpha.length);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      let maximum = 0;
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        const sampleX = Math.max(0, Math.min(width - 1, x + dx));
        const sampleY = Math.max(0, Math.min(height - 1, y + dy));
        maximum = Math.max(maximum, alpha[sampleY * width + sampleX]);
      }
      expanded[y * width + x] = maximum;
    }
    alpha = expanded;
  }
  const feather = Math.max(0, Math.min(4, Math.round(tuning.edgeFeather)));
  if (feather > 0) {
    const horizontal = new Float32Array(alpha.length);
    const size = feather * 2 + 1;
    for (let y = 0; y < height; y += 1) {
      let sum = 0;
      for (let dx = -feather; dx <= feather; dx += 1) sum += alpha[y * width + Math.max(0, Math.min(width - 1, dx))];
      for (let x = 0; x < width; x += 1) {
        horizontal[y * width + x] = sum / size;
        sum += alpha[y * width + Math.min(width - 1, x + feather + 1)] - alpha[y * width + Math.max(0, x - feather)];
      }
    }
    const softened = new Uint8ClampedArray(alpha.length);
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      for (let dy = -feather; dy <= feather; dy += 1) sum += horizontal[Math.max(0, Math.min(height - 1, dy)) * width + x];
      for (let y = 0; y < height; y += 1) {
        softened[y * width + x] = Math.round(sum / size);
        sum += horizontal[Math.min(height - 1, y + feather + 1) * width + x] - horizontal[Math.max(0, y - feather) * width + x];
      }
    }
    alpha = softened;
  }
  return alpha;
}

async function applyTunedAlphaToSource(source: Blob, cutout: Blob, tuning: BackgroundRemovalTuning): Promise<Blob> {
  const [sourceBitmap, cutoutBitmap] = await Promise.all([createImageBitmap(source), createImageBitmap(cutout)]);
  try {
    const canvas = document.createElement('canvas'); canvas.width = sourceBitmap.width; canvas.height = sourceBitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('当前浏览器无法调整透明边缘');
    context.drawImage(sourceBitmap, 0, 0);
    const sourcePixels = context.getImageData(0, 0, canvas.width, canvas.height);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(cutoutBitmap, 0, 0, canvas.width, canvas.height);
    const cutoutPixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const mask = new Uint8ClampedArray(canvas.width * canvas.height);
    for (let pixel = 0; pixel < mask.length; pixel += 1) mask[pixel] = cutoutPixels.data[pixel * 4 + 3];
    const tuned = tuneAlphaMask(mask, canvas.width, canvas.height, tuning);
    for (let pixel = 0; pixel < tuned.length; pixel += 1) sourcePixels.data[pixel * 4 + 3] = Math.min(sourcePixels.data[pixel * 4 + 3], tuned[pixel]);
    context.putImageData(sourcePixels, 0, 0);
    return await new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('无法生成透明 PNG')), 'image/png'));
  } finally { sourceBitmap.close(); cutoutBitmap.close(); }
}
