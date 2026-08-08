const MAX_OUTPUT_EDGE = 8192;
const MAX_OUTPUT_PIXELS = 48_000_000;

export function calculateUpscaleSize(width: number, height: number, scale: 2 | 4) {
  const requestedWidth = Math.round(width * scale);
  const requestedHeight = Math.round(height * scale);
  const limitScale = Math.min(1, MAX_OUTPUT_EDGE / Math.max(requestedWidth, requestedHeight), Math.sqrt(MAX_OUTPUT_PIXELS / (requestedWidth * requestedHeight)));
  return { width: Math.max(1, Math.round(requestedWidth * limitScale)), height: Math.max(1, Math.round(requestedHeight * limitScale)) };
}

export async function upscaleTransparentPng(blob: Blob, scale: 2 | 4) {
  const bitmap = await createImageBitmap(blob);
  const output = calculateUpscaleSize(bitmap.width, bitmap.height, scale);
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = bitmap.width; sourceCanvas.height = bitmap.height;
  const sourceContext = sourceCanvas.getContext('2d');
  if (!sourceContext) { bitmap.close(); throw new Error('浏览器无法创建高清放大画布'); }
  sourceContext.drawImage(bitmap, 0, 0); bitmap.close();
  const targetCanvas = document.createElement('canvas');
  targetCanvas.width = output.width; targetCanvas.height = output.height;
  const { default: createResizer } = await import('pica');
  const resizer = createResizer();
  await resizer.resize(sourceCanvas, targetCanvas);
  return { blob: await resizer.toBlob(targetCanvas, 'image/png', 1), ...output };
}
