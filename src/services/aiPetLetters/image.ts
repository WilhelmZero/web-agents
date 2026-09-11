export const NATIVE_WIDTH = 3840;
export const NATIVE_HEIGHT = 2160;
export const HIGH_RES_WIDTH = 7717;
export const HIGH_RES_HEIGHT = 4346;

export interface CropSettings { cropZoom: number; cropX: number; cropY: number }

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("无法编码 PNG")), "image/png"));
}

export function loadBitmap(source: Blob | string): Promise<ImageBitmap> {
  if (typeof source !== "string") return createImageBitmap(source);
  return fetch(source).then((response) => {
    if (!response.ok) throw new Error("默认素材加载失败");
    return response.blob();
  }).then(createImageBitmap);
}

function coverRect(width: number, height: number, targetRatio: number, crop: CropSettings) {
  const sourceRatio = width / height;
  let w = width;
  let h = height;
  if (sourceRatio > targetRatio) w = height * targetRatio;
  else h = width / targetRatio;
  const zoom = Math.max(1, crop.cropZoom || 1);
  w /= zoom;
  h /= zoom;
  const roomX = width - w;
  const roomY = height - h;
  const x = roomX * (0.5 + Math.max(-1, Math.min(1, crop.cropX)) * 0.5);
  const y = roomY * (0.5 + Math.max(-1, Math.min(1, crop.cropY)) * 0.5);
  return { x, y, w, h };
}

export async function normalizeReference(source: Blob | string, crop: CropSettings, width = NATIVE_WIDTH, height = NATIVE_HEIGHT): Promise<Blob> {
  const bitmap = await loadBitmap(source);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("浏览器不支持 Canvas");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    const sourceRect = coverRect(bitmap.width, bitmap.height, width / height, crop);
    context.drawImage(bitmap, sourceRect.x, sourceRect.y, sourceRect.w, sourceRect.h, 0, 0, width, height);
    return await canvasToBlob(canvas);
  } finally { bitmap.close(); }
}

export async function normalizeEditMask(source: Blob | string, width = NATIVE_WIDTH, height = NATIVE_HEIGHT): Promise<Blob> {
  const bitmap = await loadBitmap(source);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器不支持 Canvas");
    context.imageSmoothingEnabled = true;
    context.drawImage(bitmap, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height);
    for (let index = 0; index < pixels.data.length; index += 4) {
      const edit = Math.max(pixels.data[index], pixels.data[index + 1], pixels.data[index + 2]);
      pixels.data[index] = pixels.data[index + 1] = pixels.data[index + 2] = edit > 127 ? 255 : 0;
      pixels.data[index + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    return await canvasToBlob(canvas);
  } finally { bitmap.close(); }
}

export async function buildOpenAiMask(editMask: Blob): Promise<Blob> {
  const bitmap = await loadBitmap(editMask);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器不支持 Canvas");
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < pixels.data.length; index += 4) {
      const edit = pixels.data[index] > 127;
      pixels.data[index] = pixels.data[index + 1] = pixels.data[index + 2] = 0;
      pixels.data[index + 3] = edit ? 0 : 255;
    }
    context.putImageData(pixels, 0, 0);
    return await canvasToBlob(canvas);
  } finally { bitmap.close(); }
}

export function strictCompositePixels(original: Uint8ClampedArray, generated: Uint8ClampedArray, mask: Uint8ClampedArray): Uint8ClampedArray {
  if (original.length !== generated.length || original.length !== mask.length) throw new Error("像素尺寸不一致");
  const output = new Uint8ClampedArray(original.length);
  for (let index = 0; index < original.length; index += 4) {
    const alpha = Math.max(mask[index], mask[index + 1], mask[index + 2]) / 255;
    for (let channel = 0; channel < 3; channel += 1) output[index + channel] = Math.round(original[index + channel] * (1 - alpha) + generated[index + channel] * alpha);
    output[index + 3] = 255;
  }
  return output;
}

export async function strictComposite(original: Blob, generated: Blob, mask: Blob): Promise<Blob> {
  const [originalBitmap, generatedBitmap, maskBitmap] = await Promise.all([loadBitmap(original), loadBitmap(generated), loadBitmap(mask)]);
  try {
    const width = originalBitmap.width;
    const height = originalBitmap.height;
    const read = (bitmap: ImageBitmap) => {
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("浏览器不支持 Canvas");
      context.drawImage(bitmap, 0, 0, width, height);
      return context.getImageData(0, 0, width, height);
    };
    const originalPixels = read(originalBitmap);
    const generatedPixels = read(generatedBitmap);
    const maskPixels = read(maskBitmap);
    const output = strictCompositePixels(originalPixels.data, generatedPixels.data, maskPixels.data);
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器不支持 Canvas");
    context.putImageData(new ImageData(new Uint8ClampedArray(output), width, height), 0, 0);
    return await canvasToBlob(canvas);
  } finally { originalBitmap.close(); generatedBitmap.close(); maskBitmap.close(); }
}

export async function makeAutomaticMask(reference: Blob, width = 960, height = 540): Promise<Blob> {
  const bitmap = await loadBitmap(reference);
  try {
    const analysisWidth = 240;
    const analysisHeight = 135;
    const analysis = document.createElement("canvas");
    analysis.width = analysisWidth; analysis.height = analysisHeight;
    const analysisContext = analysis.getContext("2d", { willReadFrequently: true });
    if (!analysisContext) throw new Error("浏览器不支持 Canvas");
    const sourceRect = coverRect(bitmap.width, bitmap.height, 16 / 9, { cropZoom: 1, cropX: 0, cropY: 0 });
    analysisContext.drawImage(bitmap, sourceRect.x, sourceRect.y, sourceRect.w, sourceRect.h, 0, 0, analysisWidth, analysisHeight);
    const pixels = analysisContext.getImageData(0, 0, analysisWidth, analysisHeight).data;
    const borderSamples: number[][] = [];
    for (let x = 0; x < analysisWidth; x += 8) {
      for (const y of [2, analysisHeight - 3]) {
        const index = (y * analysisWidth + x) * 4; borderSamples.push([pixels[index], pixels[index + 1], pixels[index + 2]]);
      }
    }
    for (let y = 0; y < analysisHeight; y += 8) {
      for (const x of [2, analysisWidth - 3]) {
        const index = (y * analysisWidth + x) * 4; borderSamples.push([pixels[index], pixels[index + 1], pixels[index + 2]]);
      }
    }
    const background = [0, 1, 2].map((channel) => borderSamples.reduce((sum, sample) => sum + sample[channel], 0) / borderSamples.length);
    const foreground = new Uint8Array(analysisWidth * analysisHeight);
    for (let y = 2; y < analysisHeight - 2; y += 1) for (let x = 2; x < analysisWidth - 2; x += 1) {
      const index = (y * analysisWidth + x) * 4;
      const distance = Math.sqrt((pixels[index] - background[0]) ** 2 + (pixels[index + 1] - background[1]) ** 2 + (pixels[index + 2] - background[2]) ** 2);
      if (distance > 42 && pixels[index + 3] > 32) foreground[y * analysisWidth + x] = 1;
    }
    const visited = new Uint8Array(foreground.length);
    const components: Array<{ minX: number; minY: number; maxX: number; maxY: number; area: number; score: number }> = [];
    const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let start = 0; start < foreground.length; start += 1) {
      if (!foreground[start] || visited[start]) continue;
      const queue = [start]; visited[start] = 1;
      let cursor = 0, minX = analysisWidth, minY = analysisHeight, maxX = 0, maxY = 0;
      while (cursor < queue.length) {
        const value = queue[cursor++]; const x = value % analysisWidth; const y = Math.floor(value / analysisWidth);
        minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        for (const [dx, dy] of neighbors) {
          const nx = x + dx, ny = y + dy; const next = ny * analysisWidth + nx;
          if (nx >= 0 && nx < analysisWidth && ny >= 0 && ny < analysisHeight && foreground[next] && !visited[next]) { visited[next] = 1; queue.push(next); }
        }
      }
      const area = queue.length; if (area < 18) continue;
      const centerX = (minX + maxX) / 2 / analysisWidth; const centerY = (minY + maxY) / 2 / analysisHeight;
      const centerWeight = Math.max(0.15, 1 - Math.hypot(centerX - 0.5, centerY - 0.5));
      components.push({ minX, minY, maxX, maxY, area, score: area * centerWeight });
    }
    const candidate = components.sort((a, b) => b.score - a.score)[0];
    const detected = candidate ? {
      x: Math.max(width * 0.2, (candidate.minX - 8) / analysisWidth * width),
      y: Math.max(0, (candidate.minY - 10) / analysisHeight * height),
      right: Math.min(width * 0.8, (candidate.maxX + 8) / analysisWidth * width),
      bottom: Math.min(height, (candidate.maxY + 10) / analysisHeight * height),
    } : { x: width * 0.31, y: height * 0.035, right: width * 0.69, bottom: height * 0.965 };
    // Keep enough room for a differently shaped target glyph while excluding
    // distant decorations. Manual confirmation remains mandatory.
    const minimumWidth = width * 0.38;
    if (detected.right - detected.x < minimumWidth) {
      const center = (detected.x + detected.right) / 2;
      detected.x = Math.max(width * 0.2, center - minimumWidth / 2);
      detected.right = Math.min(width * 0.8, detected.x + minimumWidth);
    }
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器不支持 Canvas");
    context.fillStyle = "black";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "white";
    context.beginPath();
    context.roundRect(detected.x, detected.y, detected.right - detected.x, detected.bottom - detected.y, Math.min(width, height) * 0.045);
    context.fill();
    return await canvasToBlob(canvas);
  } finally { bitmap.close(); }
}

export async function fingerprintBlob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest)).slice(0, 12).map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function resizeForDownload(blob: Blob, size: "native" | "high-res"): Promise<Blob> {
  if (size === "native") return blob;
  const bitmap = await loadBitmap(blob);
  try {
    const sourceRect = coverRect(bitmap.width, bitmap.height, HIGH_RES_WIDTH / HIGH_RES_HEIGHT, { cropZoom: 1, cropX: 0, cropY: 0 });
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = Math.max(1, Math.round(sourceRect.w)); sourceCanvas.height = Math.max(1, Math.round(sourceRect.h));
    const context = sourceCanvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("浏览器不支持高清 Canvas");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, sourceRect.x, sourceRect.y, sourceRect.w, sourceRect.h, 0, 0, sourceCanvas.width, sourceCanvas.height);
    const targetCanvas = document.createElement("canvas");
    targetCanvas.width = HIGH_RES_WIDTH; targetCanvas.height = HIGH_RES_HEIGHT;
    const { default: createResizer } = await import("pica");
    const resizer = createResizer();
    await resizer.resize(sourceCanvas, targetCanvas);
    return await resizer.toBlob(targetCanvas, "image/png", 1);
  } finally { bitmap.close(); }
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
