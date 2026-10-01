import type { Layer, Psd } from 'ag-psd';

export type SmartObjectSeverity = 'supported' | 'warning' | 'blocked';

export interface SmartObjectTargetSummary {
  id: string;
  name: string;
  path: string;
  instanceCount: number;
  width: number;
  height: number;
  severity: SmartObjectSeverity;
  reasons: string[];
}

interface SmartObjectInstance {
  id: string;
  logicalId: string;
  name: string;
  path: string;
  layer: Layer;
}

export interface SmartObjectReplacement {
  targetId: string;
  file: File;
}

export interface SmartObjectReplaceResult {
  psdData: Uint8Array;
  format: 'psd' | 'psb';
  preview: HTMLCanvasElement;
  replacedCount: number;
  previewWarnings: string[];
}

const SUPPORTED_BLEND_MODES = new Set([
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'difference',
  'exclusion', 'color-dodge', 'color-burn', 'hard-light', 'soft-light',
]);

function sameTransform(a?: number[], b?: number[]) {
  if (!a || !b || a.length !== b.length) return false;
  return a.every((value, index) => Math.abs(value - b[index]) < 0.001);
}

function isComplexWarp(layer: Layer) {
  const warp = layer.placedLayer?.warp;
  return Boolean(warp && warp.style && warp.style !== 'none');
}

function logicalScope(parents: string[], artboardScope: string) {
  return artboardScope || (parents.length ? parents[0] : 'document');
}

function collectSmartObjectInstances(psd: Psd, prefix = ''): SmartObjectInstance[] {
  const output: SmartObjectInstance[] = [];
  const visit = (layers: Layer[] | undefined, parents: string[] = [], artboardScope = '') => {
    layers?.forEach((layer, index) => {
      const name = layer.name?.trim() || `图层 ${index + 1}`;
      const pathParts = [...parents, name];
      const nextArtboardScope = layer.artboard ? pathParts.join(' / ') : artboardScope;
      if (layer.placedLayer && (!prefix.trim() || name.toLowerCase().startsWith(prefix.trim().toLowerCase()))) {
        const path = pathParts.join(' / ');
        const logicalId = `${logicalScope(parents, nextArtboardScope)}::${name}`;
        output.push({ id: `${path}::${index}`, logicalId, name, path, layer });
      }
      visit(layer.children, pathParts, nextArtboardScope);
    });
  };
  visit(psd.children);
  return output;
}

export function inspectPsdSmartObjects(psd: Psd, prefix = 'LOGO') {
  const linkedFiles = new Map((psd.linkedFiles || []).map((file) => [file.id, file]));
  const groups = new Map<string, SmartObjectInstance[]>();
  collectSmartObjectInstances(psd, prefix).forEach((instance) => {
    const items = groups.get(instance.logicalId) || [];
    items.push(instance);
    groups.set(instance.logicalId, items);
  });

  return [...groups.entries()].map(([id, instances]): SmartObjectTargetSummary => {
    const reasons = new Set<string>();
    let blocked = false;
    let warning = false;
    instances.forEach(({ layer }) => {
      const placed = layer.placedLayer!;
      const linked = linkedFiles.get(placed.id);
      if (!linked?.data) { blocked = true; reasons.add('外链或缺少内嵌数据'); }
      if (placed.type !== 'raster') { blocked = true; reasons.add(`不支持 ${placed.type || '未知'} 智能对象`); }
      if (!placed.width || !placed.height) { blocked = true; reasons.add('无法读取内部画布尺寸'); }
      if (!placed.transform || placed.transform.length !== 8) { blocked = true; reasons.add('四角变换数据不完整'); }
      if (placed.nonAffineTransform && !sameTransform(placed.transform, placed.nonAffineTransform)) { blocked = true; reasons.add('包含非仿射变换'); }
      if (isComplexWarp(layer)) { blocked = true; reasons.add('包含复杂 Warp'); }
      if (placed.filter?.list?.length) { blocked = true; reasons.add('包含智能滤镜'); }
      if (layer.effects) { warning = true; reasons.add('PSD 保留图层效果，浏览器预览可能略有差异'); }
      if (layer.mask || layer.realMask || layer.vectorMask) { warning = true; reasons.add('PSD 保留蒙版，浏览器预览暂不完全模拟'); }
      if (layer.clipping) { warning = true; reasons.add('PSD 保留剪贴关系，浏览器预览暂不完全模拟'); }
    });
    const first = instances[0].layer.placedLayer!;
    return {
      id,
      name: instances[0].name,
      path: instances[0].path,
      instanceCount: instances.length,
      width: Math.round(first.width || 0),
      height: Math.round(first.height || 0),
      severity: blocked ? 'blocked' : warning ? 'warning' : 'supported',
      reasons: [...reasons],
    };
  });
}

function createCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

async function fileToCanvas(file: Blob) {
  const bitmap = await createImageBitmap(file);
  const canvas = createCanvas(bitmap.width, bitmap.height);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

function containImage(source: HTMLCanvasElement, width: number, height: number) {
  const canvas = createCanvas(width, height);
  const scale = Math.min(width / source.width, height / source.height);
  const targetWidth = source.width * scale;
  const targetHeight = source.height * scale;
  const context = canvas.getContext('2d')!;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, (width - targetWidth) / 2, (height - targetHeight) / 2, targetWidth, targetHeight);
  return canvas;
}

type Point = { x: number; y: number };

function interpolateQuad(corners: Point[], u: number, v: number): Point {
  const top = { x: corners[0].x + (corners[1].x - corners[0].x) * u, y: corners[0].y + (corners[1].y - corners[0].y) * u };
  const bottom = { x: corners[3].x + (corners[2].x - corners[3].x) * u, y: corners[3].y + (corners[2].y - corners[3].y) * u };
  return { x: top.x + (bottom.x - top.x) * v, y: top.y + (bottom.y - top.y) * v };
}

function drawTriangle(context: CanvasRenderingContext2D, source: HTMLCanvasElement, sourcePoints: Point[], targetPoints: Point[]) {
  const [s0, s1, s2] = sourcePoints;
  const [d0, d1, d2] = targetPoints;
  const denominator = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y);
  if (Math.abs(denominator) < 0.0001) return;
  const a = (d0.x * (s1.y - s2.y) + d1.x * (s2.y - s0.y) + d2.x * (s0.y - s1.y)) / denominator;
  const c = (d0.x * (s2.x - s1.x) + d1.x * (s0.x - s2.x) + d2.x * (s1.x - s0.x)) / denominator;
  const e = (d0.x * (s1.x * s2.y - s2.x * s1.y) + d1.x * (s2.x * s0.y - s0.x * s2.y) + d2.x * (s0.x * s1.y - s1.x * s0.y)) / denominator;
  const b = (d0.y * (s1.y - s2.y) + d1.y * (s2.y - s0.y) + d2.y * (s0.y - s1.y)) / denominator;
  const d = (d0.y * (s2.x - s1.x) + d1.y * (s0.x - s2.x) + d2.y * (s1.x - s0.x)) / denominator;
  const f = (d0.y * (s1.x * s2.y - s2.x * s1.y) + d1.y * (s2.x * s0.y - s0.x * s2.y) + d2.y * (s0.x * s1.y - s1.x * s0.y)) / denominator;
  context.save();
  context.beginPath();
  context.moveTo(d0.x, d0.y); context.lineTo(d1.x, d1.y); context.lineTo(d2.x, d2.y); context.closePath(); context.clip();
  context.setTransform(a, b, c, d, e, f);
  context.drawImage(source, 0, 0);
  context.restore();
}

function renderPlacedLayer(source: HTMLCanvasElement, layer: Layer) {
  const left = layer.left || 0; const top = layer.top || 0;
  const width = Math.max(1, (layer.right || left + 1) - left);
  const height = Math.max(1, (layer.bottom || top + 1) - top);
  const output = createCanvas(width, height);
  const context = output.getContext('2d')!;
  const transform = layer.placedLayer!.transform;
  const corners = [0, 1, 2, 3].map((index) => ({ x: transform[index * 2] - left, y: transform[index * 2 + 1] - top }));
  const columns = 12; const rows = 12;
  for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
    const u0 = column / columns; const u1 = (column + 1) / columns;
    const v0 = row / rows; const v1 = (row + 1) / rows;
    const s00 = { x: source.width * u0, y: source.height * v0 }; const s10 = { x: source.width * u1, y: source.height * v0 };
    const s11 = { x: source.width * u1, y: source.height * v1 }; const s01 = { x: source.width * u0, y: source.height * v1 };
    const d00 = interpolateQuad(corners, u0, v0); const d10 = interpolateQuad(corners, u1, v0);
    const d11 = interpolateQuad(corners, u1, v1); const d01 = interpolateQuad(corners, u0, v1);
    drawTriangle(context, source, [s00, s10, s11], [d00, d10, d11]);
    drawTriangle(context, source, [s00, s11, s01], [d00, d11, d01]);
  }
  return output;
}

function canvasBlendMode(mode?: string): GlobalCompositeOperation {
  const normalized = (mode || 'normal').replace('linear dodge', 'lighter');
  return SUPPORTED_BLEND_MODES.has(normalized) || normalized === 'lighter' ? normalized as GlobalCompositeOperation : 'source-over';
}

function renderLayers(context: CanvasRenderingContext2D, layers: Layer[] | undefined, warnings: Set<string>) {
  [...(layers || [])].reverse().forEach((layer) => {
    if (layer.hidden) return;
    if (layer.children?.length) {
      const group = createCanvas(context.canvas.width, context.canvas.height);
      renderLayers(group.getContext('2d')!, layer.children, warnings);
      context.save(); context.globalAlpha = layer.opacity ?? 1; context.globalCompositeOperation = canvasBlendMode(layer.blendMode);
      context.drawImage(group, 0, 0); context.restore();
      return;
    }
    if (!layer.canvas) return;
    if (!SUPPORTED_BLEND_MODES.has(layer.blendMode || 'normal')) warnings.add(`混合模式 ${layer.blendMode || 'normal'} 在浏览器预览中按普通模式显示`);
    if (layer.effects) warnings.add('浏览器预览未完整模拟 Photoshop 图层效果');
    if (layer.mask || layer.realMask || layer.vectorMask) warnings.add('浏览器预览未完整模拟 Photoshop 蒙版');
    context.save(); context.globalAlpha = layer.opacity ?? 1; context.globalCompositeOperation = canvasBlendMode(layer.blendMode);
    context.drawImage(layer.canvas, layer.left || 0, layer.top || 0); context.restore();
  });
}

export function renderPsdComposite(psd: Psd) {
  const canvas = createCanvas(psd.width, psd.height);
  const warnings = new Set<string>();
  renderLayers(canvas.getContext('2d')!, psd.children, warnings);
  return { canvas, warnings: [...warnings] };
}

function safeBaseName(name: string) {
  return name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '_') || 'logo';
}

export async function replacePsdSmartObjects(buffer: ArrayBuffer, replacements: SmartObjectReplacement[], prefix = 'LOGO'): Promise<SmartObjectReplaceResult> {
  const { readPsd, writePsdUint8Array } = await import('ag-psd');
  const isPsb = new DataView(buffer).getUint16(4, false) === 2;
  const psd = readPsd(buffer.slice(0), { skipLayerImageData: false, skipCompositeImageData: false, useRawThumbnail: true });
  const targets = inspectPsdSmartObjects(psd, prefix);
  const blocked = targets.filter((target) => target.severity === 'blocked' && replacements.some((item) => item.targetId === target.id));
  if (blocked.length) throw new Error(`存在不兼容目标：${blocked.map((target) => target.name).join('、')}`);
  const instances = collectSmartObjectInstances(psd, prefix);
  const linkedFiles = psd.linkedFiles || (psd.linkedFiles = []);
  const replacementMap = new Map(replacements.map((replacement) => [replacement.targetId, replacement.file]));
  let replacedCount = 0;

  for (const target of targets) {
    const file = replacementMap.get(target.id);
    if (!file || target.severity === 'blocked') continue;
    const matching = instances.filter((instance) => instance.logicalId === target.id);
    const source = await fileToCanvas(file);
    const firstPlaced = matching[0].layer.placedLayer!;
    const content = containImage(source, Math.round(firstPlaced.width!), Math.round(firstPlaced.height!));
    const embedded = writePsdUint8Array({ width: content.width, height: content.height, children: [{ name: 'Logo', canvas: content }], canvas: content }, { generateThumbnail: true });
    const linkedId = crypto.randomUUID();
    linkedFiles.push({ id: linkedId, name: `${safeBaseName(file.name)}.psd`, type: '8BPS', creator: '8BIM', data: embedded });
    matching.forEach(({ layer }) => {
      layer.placedLayer!.id = linkedId;
      layer.placedLayer!.type = 'raster';
      layer.canvas = renderPlacedLayer(content, layer);
      delete layer.imageData;
      replacedCount += 1;
    });
  }
  if (!replacedCount) throw new Error('没有可替换的智能对象');
  const rendered = renderPsdComposite(psd);
  psd.canvas = rendered.canvas;
  delete psd.imageData;
  if (psd.imageResources) {
    delete psd.imageResources.thumbnail;
    delete psd.imageResources.thumbnailRaw;
  }
  const psdData = writePsdUint8Array(psd, { generateThumbnail: true, noBackground: true, psb: isPsb });
  return { psdData, format: isPsb ? 'psb' : 'psd', preview: rendered.canvas, replacedCount, previewWarnings: rendered.warnings };
}

export async function parsePsdSmartObjectTemplate(buffer: ArrayBuffer, prefix = 'LOGO') {
  const { readPsd } = await import('ag-psd');
  const psd = readPsd(buffer.slice(0), { skipLayerImageData: false, skipCompositeImageData: false });
  return { width: psd.width, height: psd.height, targets: inspectPsdSmartObjects(psd, prefix) };
}
