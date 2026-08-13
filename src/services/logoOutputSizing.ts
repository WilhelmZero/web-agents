import { closestAspectRatio } from './outpaint';

export function outputAspectRatio(mode: 'original' | 'fixed' | 'custom', sourceWidth: number, sourceHeight: number, fixedRatio: string, customWidth: number, customHeight: number, supported: string[]) {
  if (mode === 'fixed') return fixedRatio;
  const width = mode === 'custom' ? customWidth : sourceWidth;
  const height = mode === 'custom' ? customHeight : sourceHeight;
  return closestAspectRatio(width, height, supported);
}

export async function imageDimensions(file: Blob) {
  const bitmap = await createImageBitmap(file);
  try { return { width: bitmap.width, height: bitmap.height }; }
  finally { bitmap.close(); }
}

export async function resizeImageBlob(source: Blob, width: number, height: number) {
  const bitmap = await createImageBitmap(source);
  try {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d'); if (!context) throw new Error('浏览器无法创建输出画布');
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high'; context.drawImage(bitmap, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('无法生成指定分辨率图片')), 'image/png'));
  } finally { bitmap.close(); }
}
