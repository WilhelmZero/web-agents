import { readPsd, type Layer, type Psd } from 'ag-psd';

export type LogoFitMode = 'contain' | 'cover' | 'stretch';
export type LogoQualityMode = 'sharp' | 'smooth' | 'pixel';
export interface PsdLogoLayer { id: string; name: string; path: string; hidden: boolean; canvas: HTMLCanvasElement; previewUrl: string; width: number; height: number }

function copyCanvas(source: HTMLCanvasElement) {
  const canvas = document.createElement('canvas'); canvas.width = source.width; canvas.height = source.height;
  canvas.getContext('2d')?.drawImage(source, 0, 0); return canvas;
}

export function parsePsdLogoLayers(buffer: ArrayBuffer) {
  const psd = readPsd(buffer, { skipLayerImageData: false, skipCompositeImageData: true });
  const layers: PsdLogoLayer[] = [];
  const visit = (items: Layer[] | undefined, parents: string[] = [], parentHidden = false) => items?.forEach((layer, index) => {
    const name = layer.name?.trim() || `图层 ${index + 1}`; const path = [...parents, name];
    const hidden = parentHidden || layer.hidden === true;
    if (layer.canvas?.width && layer.canvas.height) {
      const canvas = copyCanvas(layer.canvas);
      layers.push({ id: `${path.join('/')}-${index}-${layers.length}`, name, path: path.join(' / '), hidden, canvas, previewUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height });
    }
    visit(layer.children, path, hidden);
  });
  visit(psd.children);
  return { psd: psd as Psd, layers };
}

export function defaultPsdLogoLayerIds(layers: Pick<PsdLogoLayer, 'id' | 'name'>[]) {
  return new Set(layers.filter((layer) => layer.name.trim() !== '背景').map((layer) => layer.id));
}

export async function renderPsdLogoLayer(source: HTMLCanvasElement, width: number, height: number, mode: LogoFitMode, quality: LogoQualityMode, backgroundColor: string | null) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器无法创建图片画布');
  if (backgroundColor) { context.fillStyle = backgroundColor; context.fillRect(0, 0, width, height); }
  context.imageSmoothingEnabled = quality !== 'pixel'; context.imageSmoothingQuality = 'high';
  const scale = mode === 'stretch' ? 1 : mode === 'contain' ? Math.min(width / source.width, height / source.height) : Math.max(width / source.width, height / source.height);
  const targetWidth = mode === 'stretch' ? width : Math.max(1, Math.round(source.width * scale));
  const targetHeight = mode === 'stretch' ? height : Math.max(1, Math.round(source.height * scale));
  let resized = source;
  if (quality === 'sharp' && (targetWidth !== source.width || targetHeight !== source.height)) {
    const { default: createPica } = await import('pica'); resized = document.createElement('canvas'); resized.width = targetWidth; resized.height = targetHeight;
    await createPica().resize(source, resized, { quality: 3, unsharpAmount: 90, unsharpRadius: 0.7, unsharpThreshold: 2 });
  }
  context.drawImage(resized, Math.round((width - targetWidth) / 2), Math.round((height - targetHeight) / 2), targetWidth, targetHeight);
  return canvas;
}

export const canvasToPngBlob = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG 生成失败')), 'image/png'));
export const safePsdLayerName = (name: string) => name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'layer';
