export interface WhiteBackgroundMetrics { isWhiteBackground: boolean; whiteRatio: number; borderRatio: number; connectedRatio: number }

export function detectWhiteBackgroundPixels(data: Uint8ClampedArray, width: number, height: number): WhiteBackgroundMetrics {
  const count = width * height;
  if (!count) return { isWhiteBackground: false, whiteRatio: 0, borderRatio: 0, connectedRatio: 0 };
  const white = new Uint8Array(count);
  let whiteCount = 0;
  for (let index = 0; index < count; index += 1) {
    const offset = index * 4; const r = data[offset]; const g = data[offset + 1]; const b = data[offset + 2]; const a = data[offset + 3];
    const max = Math.max(r, g, b); const min = Math.min(r, g, b);
    white[index] = a < 24 || (min >= 224 && max - min <= 34) ? 1 : 0;
    whiteCount += white[index];
  }
  const border = new Set<number>();
  for (let x = 0; x < width; x += 1) { border.add(x); border.add((height - 1) * width + x); }
  for (let y = 0; y < height; y += 1) { border.add(y * width); border.add(y * width + width - 1); }
  const borderRatio = [...border].reduce((sum, index) => sum + white[index], 0) / border.size;
  const visited = new Uint8Array(count); const queue: number[] = [];
  border.forEach((index) => { if (white[index]) { visited[index] = 1; queue.push(index); } });
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor]; const x = index % width; const y = Math.floor(index / width);
    const neighbors = [x > 0 ? index - 1 : -1, x + 1 < width ? index + 1 : -1, y > 0 ? index - width : -1, y + 1 < height ? index + width : -1];
    neighbors.forEach((next) => { if (next >= 0 && white[next] && !visited[next]) { visited[next] = 1; queue.push(next); } });
  }
  const connectedRatio = queue.length / count;
  const whiteRatio = whiteCount / count;
  const classicProductShot = borderRatio >= 0.82 && connectedRatio >= 0.38;
  // Product infographics often add a colored title band, dimensions and several
  // product cutouts. The band lowers the border score even though roughly half
  // of the canvas remains one continuous pure-white studio background.
  const productInfographic = borderRatio >= 0.5 && connectedRatio >= 0.42 && whiteRatio >= 0.45;
  // Large studio subjects can split the white canvas into several regions.
  // A nearly all-white outer edge is still a strong studio-shot signal even
  // when the largest connected region is smaller than the classic threshold.
  const splitStudioCanvas = borderRatio >= 0.94 && connectedRatio >= 0.18 && whiteRatio >= 0.25;
  // Product collages may fill almost the whole frame. Natural scenes rarely
  // retain this much neutral near-white directly on the outer edge while also
  // keeping a sizeable edge-connected pure-white region.
  const denseProductCollage = borderRatio >= 0.36 && connectedRatio >= 0.035 && whiteRatio >= 0.07;
  return { isWhiteBackground: classicProductShot || productInfographic || splitStudioCanvas || denseProductCollage, whiteRatio, borderRatio, connectedRatio };
}

export async function detectWhiteBackground(file: File): Promise<WhiteBackgroundMetrics> {
  const bitmap = await createImageBitmap(file); const max = 128; const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height)); const width = Math.max(1, Math.round(bitmap.width * scale)); const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) { bitmap.close(); throw new Error('浏览器无法读取图片像素'); }
  context.drawImage(bitmap, 0, 0, width, height); bitmap.close(); return detectWhiteBackgroundPixels(context.getImageData(0, 0, width, height).data, width, height);
}
