export type IconForegroundMode = "auto" | "light" | "dark";
export type ResolvedIconForegroundMode = Exclude<IconForegroundMode, "auto">;

export interface IconVectorSplitSettings {
  foregroundMode: IconForegroundMode;
  threshold: number;
  maxChroma: number;
  groupingGap: number;
  minimumWidthPercent: number;
  minimumHeightPercent: number;
  paddingPercent: number;
  outputColor: "black" | "white";
  vectorPrecision: "standard" | "fine" | "ultra";
}

export interface IconRegion {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface IconDetectionResult {
  width: number;
  height: number;
  resolvedMode: ResolvedIconForegroundMode;
  regions: IconRegion[];
}

interface ComponentBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  pixels: number;
}

export const DEFAULT_ICON_VECTOR_SPLIT_SETTINGS: IconVectorSplitSettings = {
  foregroundMode: "auto",
  threshold: 205,
  maxChroma: 56,
  groupingGap: 28,
  minimumWidthPercent: 4,
  minimumHeightPercent: 4,
  paddingPercent: 1.2,
  outputColor: "black",
  vectorPrecision: "fine",
};

function foregroundPixel(
  data: Uint8ClampedArray,
  offset: number,
  mode: ResolvedIconForegroundMode,
  settings: IconVectorSplitSettings,
) {
  if (data[offset + 3] < 24) return false;
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  if (maximum - minimum > settings.maxChroma) return false;
  const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
  return mode === "light"
    ? luminance >= settings.threshold
    : luminance <= 255 - settings.threshold;
}

function connectedComponents(
  imageData: Pick<ImageData, "data" | "width" | "height">,
  mode: ResolvedIconForegroundMode,
  settings: IconVectorSplitSettings,
) {
  const { data, width, height } = imageData;
  const size = width * height;
  const mask = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) {
    if (foregroundPixel(data, index * 4, mode, settings)) mask[index] = 1;
  }
  const stack = new Int32Array(size);
  const components: ComponentBox[] = [];
  const minimumPixels = Math.max(2, Math.floor(size * 0.000001));
  for (let start = 0; start < size; start += 1) {
    if (mask[start] !== 1) continue;
    let stackSize = 0;
    stack[stackSize++] = start;
    mask[start] = 2;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let pixels = 0;
    while (stackSize) {
      const current = stack[--stackSize];
      const y = Math.floor(current / width);
      const x = current - y * width;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      pixels += 1;
      let neighbour: number;
      if (x > 0 && mask[(neighbour = current - 1)] === 1) {
        mask[neighbour] = 2;
        stack[stackSize++] = neighbour;
      }
      if (x + 1 < width && mask[(neighbour = current + 1)] === 1) {
        mask[neighbour] = 2;
        stack[stackSize++] = neighbour;
      }
      if (y > 0 && mask[(neighbour = current - width)] === 1) {
        mask[neighbour] = 2;
        stack[stackSize++] = neighbour;
      }
      if (y + 1 < height && mask[(neighbour = current + width)] === 1) {
        mask[neighbour] = 2;
        stack[stackSize++] = neighbour;
      }
    }
    if (pixels < minimumPixels) continue;
    const componentWidth = maxX - minX + 1;
    const componentHeight = maxY - minY + 1;
    if (
      pixels > size * 0.16 ||
      componentWidth > width * 0.82 ||
      componentHeight > height * 0.82
    )
      continue;
    components.push({ minX, minY, maxX, maxY, pixels });
  }
  return components;
}

function groupComponents(
  components: ComponentBox[],
  width: number,
  height: number,
  settings: IconVectorSplitSettings,
) {
  const parents = components.map((_, index) => index);
  const find = (value: number): number => {
    let current = value;
    while (parents[current] !== current) current = parents[current];
    while (parents[value] !== value) {
      const next = parents[value];
      parents[value] = current;
      value = next;
    }
    return current;
  };
  const union = (left: number, right: number) => {
    const rootLeft = find(left);
    const rootRight = find(right);
    if (rootLeft !== rootRight) parents[rootRight] = rootLeft;
  };
  const gap = Math.max(1, settings.groupingGap);
  const horizontalOrder = components
    .map((_, index) => index)
    .sort((left, right) => components[left].minX - components[right].minX);
  for (let orderLeft = 0; orderLeft < horizontalOrder.length; orderLeft += 1) {
    const left = horizontalOrder[orderLeft];
    const a = components[left];
    for (let orderRight = orderLeft + 1; orderRight < horizontalOrder.length; orderRight += 1) {
      const right = horizontalOrder[orderRight];
      const b = components[right];
      if (b.minX - a.maxX - 1 > gap) break;
      const horizontalGap = Math.max(
        0,
        Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX) - 1,
      );
      const verticalGap = Math.max(
        0,
        Math.max(a.minY, b.minY) - Math.min(a.maxY, b.maxY) - 1,
      );
      if (horizontalGap <= gap && verticalGap <= gap) union(left, right);
    }
  }
  const grouped = new Map<number, ComponentBox>();
  components.forEach((component, index) => {
    const root = find(index);
    const current = grouped.get(root);
    grouped.set(
      root,
      current
        ? {
            minX: Math.min(current.minX, component.minX),
            minY: Math.min(current.minY, component.minY),
            maxX: Math.max(current.maxX, component.maxX),
            maxY: Math.max(current.maxY, component.maxY),
            pixels: current.pixels + component.pixels,
          }
        : { ...component },
    );
  });
  const minimumWidth = width * (settings.minimumWidthPercent / 100);
  const minimumHeight = height * (settings.minimumHeightPercent / 100);
  return [...grouped.values()].filter((box) => {
    const boxWidth = box.maxX - box.minX + 1;
    const boxHeight = box.maxY - box.minY + 1;
    return (
      boxWidth >= minimumWidth &&
      boxHeight >= minimumHeight &&
      boxWidth <= width * 0.48 &&
      boxHeight <= height * 0.52
    );
  });
}

function sortReadingOrder(boxes: ComponentBox[]) {
  const medianHeight = [...boxes]
    .map((box) => box.maxY - box.minY + 1)
    .sort((a, b) => a - b)[Math.floor(boxes.length / 2)] || 1;
  const rows: ComponentBox[][] = [];
  [...boxes]
    .sort((a, b) => (a.minY + a.maxY) / 2 - (b.minY + b.maxY) / 2)
    .forEach((box) => {
      const centerY = (box.minY + box.maxY) / 2;
      const row = rows.find((items) => {
        const rowCenter =
          items.reduce((sum, item) => sum + (item.minY + item.maxY) / 2, 0) /
          items.length;
        return Math.abs(centerY - rowCenter) <= medianHeight * 0.55;
      });
      (row || rows[rows.push([]) - 1]).push(box);
    });
  return rows.flatMap((row) => row.sort((a, b) => a.minX - b.minX));
}

export function detectIconRegionsFromImageData(
  imageData: Pick<ImageData, "data" | "width" | "height">,
  settings: IconVectorSplitSettings,
  mode: ResolvedIconForegroundMode,
) {
  const components = connectedComponents(imageData, mode, settings);
  return sortReadingOrder(
    groupComponents(components, imageData.width, imageData.height, settings),
  );
}

function scoreDetection(boxes: ComponentBox[], width: number, height: number) {
  if (!boxes.length) return Number.NEGATIVE_INFINITY;
  const totalArea = boxes.reduce(
    (sum, box) => sum + (box.maxX - box.minX + 1) * (box.maxY - box.minY + 1),
    0,
  );
  const coverage = totalArea / (width * height);
  return boxes.length * 10 + Math.min(20, coverage * 100) - Math.max(0, boxes.length - 80) * 20;
}

function canvasImageData(bitmap: ImageBitmap, maximumDimension = 1400) {
  const scale = Math.min(
    1,
    maximumDimension / Math.max(bitmap.width, bitmap.height),
  );
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("当前浏览器无法分析图片");
  context.drawImage(bitmap, 0, 0, width, height);
  return { imageData: context.getImageData(0, 0, width, height), scale };
}

export async function detectIconRegions(
  blob: Blob,
  settings: IconVectorSplitSettings,
): Promise<IconDetectionResult> {
  const bitmap = await createImageBitmap(blob);
  try {
    const { imageData, scale } = canvasImageData(bitmap);
    const modes: ResolvedIconForegroundMode[] =
      settings.foregroundMode === "auto"
        ? ["light", "dark"]
        : [settings.foregroundMode];
    const detections = modes.map((mode) => ({
      mode,
      boxes: detectIconRegionsFromImageData(imageData, settings, mode),
    }));
    const selected = detections.sort(
      (a, b) =>
        scoreDetection(b.boxes, imageData.width, imageData.height) -
        scoreDetection(a.boxes, imageData.width, imageData.height),
    )[0];
    const padding = Math.min(imageData.width, imageData.height) * (settings.paddingPercent / 100);
    const regions = selected.boxes.map((box, index) => {
      const minX = Math.max(0, box.minX - padding);
      const minY = Math.max(0, box.minY - padding);
      const maxX = Math.min(imageData.width - 1, box.maxX + padding);
      const maxY = Math.min(imageData.height - 1, box.maxY + padding);
      return {
        id: `icon-${String(index + 1).padStart(2, "0")}`,
        x: minX / scale,
        y: minY / scale,
        width: (maxX - minX + 1) / scale,
        height: (maxY - minY + 1) / scale,
      };
    });
    return {
      width: bitmap.width,
      height: bitmap.height,
      resolvedMode: selected.mode,
      regions,
    };
  } finally {
    bitmap.close();
  }
}

function smoothStep(value: number) {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
}

export async function extractIconRaster(
  blob: Blob,
  region: IconRegion,
  settings: IconVectorSplitSettings,
  mode: ResolvedIconForegroundMode,
) {
  const bitmap = await createImageBitmap(blob);
  try {
    const x = Math.max(0, Math.floor(region.x));
    const y = Math.max(0, Math.floor(region.y));
    const width = Math.max(1, Math.min(bitmap.width - x, Math.ceil(region.width)));
    const height = Math.max(1, Math.min(bitmap.height - y, Math.ceil(region.height)));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("当前浏览器无法提取图标");
    context.drawImage(bitmap, x, y, width, height, 0, 0, width, height);
    const imageData = context.getImageData(0, 0, width, height);
    const output = settings.outputColor === "white" ? 255 : 0;
    for (let offset = 0; offset < imageData.data.length; offset += 4) {
      const red = imageData.data[offset];
      const green = imageData.data[offset + 1];
      const blue = imageData.data[offset + 2];
      const maximum = Math.max(red, green, blue);
      const minimum = Math.min(red, green, blue);
      const chroma = maximum - minimum;
      const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      const lightness =
        mode === "light"
          ? (luminance - (settings.threshold - 38)) / 38
          : ((255 - settings.threshold + 38) - luminance) / 38;
      const neutrality = (settings.maxChroma + 18 - chroma) / 18;
      const alpha =
        smoothStep(lightness) *
        smoothStep(neutrality) *
        (imageData.data[offset + 3] / 255);
      imageData.data[offset] = output;
      imageData.data[offset + 1] = output;
      imageData.data[offset + 2] = output;
      imageData.data[offset + 3] = Math.round(alpha * 255);
    }
    context.putImageData(imageData, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (result) =>
          result ? resolve(result) : reject(new Error("透明 PNG 生成失败")),
        "image/png",
      ),
    );
  } finally {
    bitmap.close();
  }
}
