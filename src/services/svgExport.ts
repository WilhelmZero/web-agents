function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character] || character);
}

export function buildEmbeddedImageSvg(dataUrl: string, width: number, height: number, title = 'Scene Studio export') {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${safeWidth}" height="${safeHeight}" viewBox="0 0 ${safeWidth} ${safeHeight}">\n  <title>${escapeXml(title)}</title>\n  <desc>Scene Studio 花纸文字修改结果。SVG 保留原始画面尺寸，图像内容以内嵌位图保存。</desc>\n  <image width="${safeWidth}" height="${safeHeight}" preserveAspectRatio="none" href="${escapeXml(dataUrl)}"/>\n</svg>`;
}

function readAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('读取图片失败'));
    reader.readAsDataURL(blob);
  });
}

async function readImageSize(blob: Blob) {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  }
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error('无法读取图片尺寸'));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function createEmbeddedImageSvg(blob: Blob, title?: string) {
  const [{ width, height }, dataUrl] = await Promise.all([readImageSize(blob), readAsDataUrl(blob)]);
  return new Blob([buildEmbeddedImageSvg(dataUrl, width, height, title)], { type: 'image/svg+xml;charset=utf-8' });
}
