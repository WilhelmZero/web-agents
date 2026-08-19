export interface ImageChangeMetrics { changedRatio: number; meanDifference: number }
export function isInsufficientImageChange(changedRatio: number, minimumRatio = 0.2) { return changedRatio <= minimumRatio; }

export function measureChangedPixels(original: Uint8ClampedArray, generated: Uint8ClampedArray, threshold = 28): ImageChangeMetrics {
  const pixels = Math.min(original.length, generated.length) / 4;
  if (!pixels) return { changedRatio: 0, meanDifference: 0 };
  let changed = 0; let totalDifference = 0;
  for (let index = 0; index < pixels; index += 1) {
    const offset = index * 4;
    const difference = (Math.abs(original[offset] - generated[offset]) + Math.abs(original[offset + 1] - generated[offset + 1]) + Math.abs(original[offset + 2] - generated[offset + 2])) / 3;
    totalDifference += difference;
    if (difference >= threshold) changed += 1;
  }
  return { changedRatio: changed / pixels, meanDifference: totalDifference / pixels };
}

async function pixels(blob: Blob, width: number, height: number) {
  const bitmap = await createImageBitmap(blob); const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) { bitmap.close(); throw new Error('浏览器无法检测生成图变化'); }
  context.drawImage(bitmap, 0, 0, width, height); bitmap.close();
  return context.getImageData(0, 0, width, height).data;
}

export async function detectImageChange(original: Blob, generated: Blob, maxDimension = 192) {
  const source = await createImageBitmap(original); const ratio = source.width / Math.max(1, source.height); source.close();
  const width = ratio >= 1 ? maxDimension : Math.max(1, Math.round(maxDimension * ratio));
  const height = ratio >= 1 ? Math.max(1, Math.round(maxDimension / ratio)) : maxDimension;
  const [originalPixels, generatedPixels] = await Promise.all([pixels(original, width, height), pixels(generated, width, height)]);
  return measureChangedPixels(originalPixels, generatedPixels);
}
