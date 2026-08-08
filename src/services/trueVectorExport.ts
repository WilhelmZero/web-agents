export interface VectorEligibility {
  eligible: boolean;
  colorBins: number;
  suggestedColors: number;
}
interface TraceColor { r: number; g: number; b: number; a: number }
export interface VectorTraceConfig { detailed: boolean; colors: number; ltres: number; qtres: number; pathomit: number; rightangleenhance: boolean; linefilter: boolean; roundcoords: number }
export interface VTracerConfig { mode: 'spline'; hierarchical: 'stacked'; corner_threshold: number; length_threshold: number; max_iterations: number; splice_threshold: number; filter_speckle: number; color_precision: number; layer_difference: number; path_precision: number }
export type VectorTraceEngine = 'auto' | 'imagetracer' | 'vtracer';

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
  return { eligible: bins.size <= 12, colorBins: bins.size, suggestedColors: Math.max(2, Math.min(24, bins.size)) };
}

export function extractColorPreservingPalette(imageData: Pick<ImageData, 'data' | 'width' | 'height'>, maximumColors: number): TraceColor[] {
  const bins = new Map<number, { count: number; r: number; g: number; b: number; a: number }>();
  const pixels = imageData.width * imageData.height;
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const offset = pixel * 4; const alpha = imageData.data[offset + 3];
    const key = alpha < 16 ? -1 : ((imageData.data[offset] >> 4) << 12) | ((imageData.data[offset + 1] >> 4) << 8) | ((imageData.data[offset + 2] >> 4) << 4) | (alpha >> 4);
    const bin = bins.get(key) || { count: 0, r: 0, g: 0, b: 0, a: 0 };
    bin.count += 1; bin.r += imageData.data[offset]; bin.g += imageData.data[offset + 1]; bin.b += imageData.data[offset + 2]; bin.a += alpha; bins.set(key, bin);
  }
  const selected = [...bins.entries()].sort((left, right) => right[1].count - left[1].count).slice(0, Math.max(2, maximumColors));
  const choices = selected.map(([key, bin]) => ({ key, target: { r: bin.r / bin.count, g: bin.g / bin.count, b: bin.b / bin.count, a: bin.a / bin.count }, best: key === -1 ? { r: 0, g: 0, b: 0, a: 0 } : undefined as TraceColor | undefined, distance: Number.POSITIVE_INFINITY }));
  const choiceByKey = new Map(choices.map((choice) => [choice.key, choice]));
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const offset = pixel * 4; const alpha = imageData.data[offset + 3];
    const key = alpha < 16 ? -1 : ((imageData.data[offset] >> 4) << 12) | ((imageData.data[offset + 1] >> 4) << 8) | ((imageData.data[offset + 2] >> 4) << 4) | (alpha >> 4);
    const choice = choiceByKey.get(key); if (!choice || key === -1) continue;
    const distance = (imageData.data[offset] - choice.target.r) ** 2 + (imageData.data[offset + 1] - choice.target.g) ** 2 + (imageData.data[offset + 2] - choice.target.b) ** 2 + (alpha - choice.target.a) ** 2;
    if (distance < choice.distance) { choice.distance = distance; choice.best = { r: imageData.data[offset], g: imageData.data[offset + 1], b: imageData.data[offset + 2], a: alpha }; }
  }
  return choices.map((choice) => choice.best || { r: Math.round(choice.target.r), g: Math.round(choice.target.g), b: Math.round(choice.target.b), a: Math.round(choice.target.a) });
}

export function buildVectorTraceConfig(analysis: VectorEligibility, requestedColors?: number): VectorTraceConfig {
  const detailed = !analysis.eligible;
  return detailed
    ? { detailed, colors: requestedColors || 128, ltres: 0.45, qtres: 0.45, pathomit: 1, rightangleenhance: false, linefilter: false, roundcoords: 2 }
    : { detailed, colors: requestedColors || Math.max(8, analysis.suggestedColors), ltres: 1, qtres: 1, pathomit: 4, rightangleenhance: true, linefilter: true, roundcoords: 2 };
}

export function buildVTracerConfig(): VTracerConfig {
  return {
    mode: 'spline', hierarchical: 'stacked',
    corner_threshold: Math.PI / 3, length_threshold: 4, max_iterations: 10,
    splice_threshold: Math.PI / 4, filter_speckle: 2,
    color_precision: 2, layer_difference: 16, path_precision: 2,
  };
}

export function resolveVectorTraceEngine(analysis: VectorEligibility, requestedColors: number | undefined, engine: VectorTraceEngine): Exclude<VectorTraceEngine, 'auto'> {
  if (engine !== 'auto') return engine;
  return !analysis.eligible && requestedColors === undefined ? 'vtracer' : 'imagetracer';
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
  const openingTag = svg.match(/<svg\b[^>]*>/i)?.[0];
  if (!openingTag) return svg;
  const withoutDimensions = openingTag.replace(/\s(?:width|height)\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
  const sizedOpeningTag = withoutDimensions.replace(/<svg\b/i, `<svg width="${width}" height="${height}"`);
  return svg.replace(openingTag, sizedOpeningTag);
}

export function serializeVisibleSvg(svg: SVGSVGElement, width: number, height: number): string {
  svg.removeAttribute('id'); svg.removeAttribute('style'); svg.removeAttribute('hidden');
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  if (!svg.hasAttribute('width')) svg.setAttribute('width', String(width));
  if (!svg.hasAttribute('height')) svg.setAttribute('height', String(height));
  if (!svg.hasAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  return svg.outerHTML;
}

export async function inspectVectorEligibility(blob: Blob) {
  const { imageData } = await blobToImageData(blob, 512);
  return analyzeVectorEligibility(imageData);
}

async function vectorizeComplexImage(imageData: ImageData): Promise<string> {
  const canvas = document.createElement('canvas'); canvas.width = imageData.width; canvas.height = imageData.height;
  const context = canvas.getContext('2d'); if (!context) throw new Error('当前浏览器无法创建 VTracer 画布');
  context.putImageData(imageData, 0, 0);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const id = `vtracer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  canvas.id = `${id}-canvas`; svg.id = `${id}-svg`; canvas.hidden = true; svg.style.display = 'none';
  document.body.append(canvas, svg);
  try {
    const moduleUrl = `${import.meta.env.BASE_URL}vtracer_webapp.js`;
    const glue = await import(/* @vite-ignore */ moduleUrl) as { default: () => Promise<unknown>; ColorImageConverter: { new_with_string: (params: string) => { init: () => void; tick: () => boolean; free: () => void } } };
    await glue.default();
    const converter = glue.ColorImageConverter.new_with_string(JSON.stringify({ canvas_id: canvas.id, svg_id: svg.id, ...buildVTracerConfig() }));
    try {
      converter.init();
      while (!converter.tick()) await new Promise<void>((resolve) => setTimeout(resolve, 0));
      return serializeVisibleSvg(svg, imageData.width, imageData.height);
    } finally { converter.free(); }
  } finally { canvas.remove(); svg.remove(); }
}

export async function vectorizeImageToSvg(blob: Blob, colorCount?: number, engine: VectorTraceEngine = 'auto') {
  const { imageData, original } = await blobToImageData(blob);
  const analysis = analyzeVectorEligibility(imageData);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  if (resolveVectorTraceEngine(analysis, colorCount, engine) === 'vtracer') {
    const svg = await vectorizeComplexImage(imageData);
    if (!/<path\b/i.test(svg)) throw new Error('VTracer 未能提取有效矢量路径');
    return new Blob([preserveVectorOutputSize(svg, original.width, original.height)], { type: 'image/svg+xml;charset=utf-8' });
  }
  const imported = await import('imagetracerjs');
  const tracer = imported.default;
  const config = buildVectorTraceConfig(analysis, colorCount);
  const palette = extractColorPreservingPalette(imageData, config.colors);
  const svg = tracer.imagedataToSVG(imageData, {
    ltres: config.ltres,
    qtres: config.qtres,
    pathomit: config.pathomit,
    rightangleenhance: config.rightangleenhance,
    colorsampling: 2,
    numberofcolors: palette.length,
    colorquantcycles: 1,
    pal: palette,
    layering: 0,
    strokewidth: 0,
    linefilter: config.linefilter,
    scale: 1,
    roundcoords: config.roundcoords,
    viewbox: true,
    desc: true,
  });
  if (!/<path\b/i.test(svg)) throw new Error('未能从图片中提取有效矢量路径');
  return new Blob([preserveVectorOutputSize(svg, original.width, original.height)], { type: 'image/svg+xml;charset=utf-8' });
}
