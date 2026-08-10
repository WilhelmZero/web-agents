export interface RgbColor { r: number; g: number; b: number }

export function rgbToHex({ r, g, b }: RgbColor): string {
  return `#${[r, g, b].map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('')}`;
}

export function inferBorderColor(data: ImageData): RgbColor {
  const { width, height } = data;
  const pixels = data.data;
  const sums = { r: 0, g: 0, b: 0, count: 0 };
  const sample = (x: number, y: number) => {
    const index = (y * width + x) * 4;
    if (pixels[index + 3] < 16) return;
    sums.r += pixels[index];
    sums.g += pixels[index + 1];
    sums.b += pixels[index + 2];
    sums.count += 1;
  };
  const stride = Math.max(1, Math.floor(Math.min(width, height) / 200));
  for (let x = 0; x < width; x += stride) { sample(x, 0); sample(x, height - 1); }
  for (let y = stride; y < height - stride; y += stride) { sample(0, y); sample(width - 1, y); }
  if (!sums.count) return { r: 255, g: 255, b: 255 };
  return { r: sums.r / sums.count, g: sums.g / sums.count, b: sums.b / sums.count };
}

export function cropCanvasDimensions(width: number, height: number, scale: number) {
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
