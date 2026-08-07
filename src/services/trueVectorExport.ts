export interface VectorEligibility {
  eligible: boolean;
  colorBins: number;
  suggestedColors: number;
}

export function analyzeVectorEligibility(imageData: Pick<ImageData, 'data' | 'width' | 'height'>): VectorEligibility {
  const bins = new Set<number>();
  const pixels = imageData.width * imageData.height;
  const step = Math.max(1, Math.floor(pixels / 12000));
  for (let pixel = 0; pixel < pixels; pixel += step) {
    const offset = pixel * 4;
    const alpha = imageData.data[offset + 3];
    if (alpha < 24) { bins.add(-1); continue; }
    const red = imageData.data[offset] >> 5;
    const green = imageData.data[offset + 1] >> 5;
    const blue = imageData.data[offset + 2] >> 5;
    bins.add((red << 6) | (green << 3) | blue);
    if (bins.size > 24) break;
  }
  return { eligible: bins.size <= 12, colorBins: bins.size, suggestedColors: Math.max(2, Math.min(8, bins.size)) };
}

async function blobToImageData(blob: Blob, maxDimension = 1600) {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) { bitmap.close(); throw new Error('浏览器无法创建矢量化画布'); }
  context.drawImage(bitmap, 0, 0, width, height);
  const original = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return { imageData: context.getImageData(0, 0, width, height), original };
}

export function preserveVectorOutputSize(svg: string, width: number, height: number) {
  if (/<svg\s+width=/i.test(svg)) return svg.replace(/<svg\s+width="[^"]+"\s+height="[^"]+"/i, `<svg width="${width}" height="${height}"`);
  return svg.replace(/<svg\s+/i, `<svg width="${width}" height="${height}" `);
}

export async function inspectVectorEligibility(blob: Blob) {
  const { imageData } = await blobToImageData(blob, 512);
  return analyzeVectorEligibility(imageData);
}

export async function vectorizeImageToSvg(blob: Blob, colorCount?: number) {
  const { imageData, original } = await blobToImageData(blob);
  const analysis = analyzeVectorEligibility(imageData);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const imported = await import('imagetracerjs');
  const tracer = imported.default;
  const svg = tracer.imagedataToSVG(imageData, {
    ltres: 1,
    qtres: 1,
    pathomit: 8,
    rightangleenhance: true,
    colorsampling: 2,
    numberofcolors: colorCount || analysis.suggestedColors,
    colorquantcycles: 3,
    layering: 0,
    strokewidth: 0,
    linefilter: true,
    scale: 1,
    roundcoords: 1,
    viewbox: true,
    desc: true,
  });
  if (!/<path\b/i.test(svg)) throw new Error('未能从图片中提取有效矢量路径');
  return new Blob([preserveVectorOutputSize(svg, original.width, original.height)], { type: 'image/svg+xml;charset=utf-8' });
}
