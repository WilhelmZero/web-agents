

export const MAX_IMAGE_PIXELS = 24_000_000;
export const MAX_IMAGE_EDGE = 8192;

export const DEFAULTS = Object.freeze({
  texture: 65, contrast: 50, brightness: 50, shadow: 30, blackPoint: 10,
  mode: 'grayscale', widthMm: 80, dpi: 800, margin: 0, invert: false, preview: false,
});
const RANGES = {
  texture: [0, 100], contrast: [0, 100], brightness: [0, 100], shadow: [0, 100],
  blackPoint: [0, 40], widthMm: [10, 300], dpi: [72, 1200], margin: [0, 15],
};
const LABELS = {
  texture: '纹理', contrast: '对比度', brightness: '亮度', shadow: '暗部层次',
  blackPoint: '黑场', widthMm: '成品宽度', dpi: 'DPI', margin: '边距',
};
const clamp = (v, lo = 0, hi = 255) => Math.min(hi, Math.max(lo, v));

export function validateOptions(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('处理参数必须为对象。');
  }
  const result = { ...DEFAULTS, ...options };
  if (result.pixelWidth !== undefined && (!Number.isInteger(result.pixelWidth) || result.pixelWidth < 1 || result.pixelWidth > MAX_IMAGE_EDGE)) throw new RangeError('像素宽度必须为 1–8192 的整数。');
  if (result.pixelMargin !== undefined && (!Number.isInteger(result.pixelMargin) || result.pixelMargin < 0)) throw new RangeError('像素边距必须为非负整数。');
  if (result.crop) cropPixels(10000, 10000, result.crop);
  for (const [name, [min, max]] of Object.entries(RANGES)) {
    if (typeof result[name] !== 'number' || !Number.isFinite(result[name])) {
      throw new TypeError(`${LABELS[name]}必须为有效数字。`);
    }
    if (result[name] < min || result[name] > max) {
      throw new RangeError(`${LABELS[name]}必须在 ${min}–${max} 之间。`);
    }
  }
  if (!['grayscale', 'dither'].includes(result.mode)) {
    throw new TypeError('输出模式必须是 grayscale 或 dither。');
  }
  for (const key of ['invert', 'preview']) {
    if (typeof result[key] !== 'boolean') throw new TypeError(`${key}必须为布尔值。`);
  }
  if (result.pixelWidth === undefined && result.margin * 2 >= result.widthMm) {
    throw new RangeError('左右边距之和必须小于成品宽度。');
  }
  if (result.eraseMask !== undefined && typeof result.eraseMask !== 'string') {
    throw new TypeError('删除蒙版必须是 PNG data URL。');
  }
  return result;
}

function assertDimensions(width, height, label) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`${label}尺寸无效。`);
  }
  if (width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE || width * height > MAX_IMAGE_PIXELS) {
    throw new RangeError(`${label}过大（${width} × ${height}）。单边最多 ${MAX_IMAGE_EDGE} 像素，总像素最多 2400 万；请减小宽度、DPI 或输入图片尺寸。`);
  }
}

// Scanline flood fill uses one seed per adjoining run, avoiding a full-size
// integer queue. Only near-black pixels connected to the image border qualify.
function removeBorderBackground(candidate, grayAlpha, width, height) {
  const stack = [];
  const flood = (seed) => {
    if (!candidate[seed]) return;
    stack.push(seed);
    while (stack.length) {
      const at = stack.pop();
      if (!candidate[at]) continue;
      const rowStart = Math.floor(at / width) * width;
      let x = at;
      while (x > rowStart && candidate[x - 1]) x--;
      let above = false;
      let below = false;
      const rowEnd = rowStart + width;
      while (x < rowEnd && candidate[x]) {
        candidate[x] = 0;
        grayAlpha[x * 2] = 0;
        grayAlpha[x * 2 + 1] = 0;
        const canAbove = rowStart > 0 && candidate[x - width] === 1;
        const canBelow = rowEnd < width * height && candidate[x + width] === 1;
        if (canAbove && !above) stack.push(x - width);
        if (canBelow && !below) stack.push(x + width);
        above = canAbove;
        below = canBelow;
        x++;
      }
    }
  };
  for (let x = 0; x < width; x++) {
    flood(x);
    flood((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    flood(y * width);
    flood(y * width + width - 1);
  }
}

export function preparePixels(rgba, width, height, options, mask = null) {
  const pixels = width * height;
  const grayAlpha = new Uint8Array(pixels * 2);
  const candidate = new Uint8Array(pixels);
  // A cutout already supplies subject membership. Flooding by luminance would
  // erase dark hair connected to its transparent surroundings.
  let hasTransparentPixels = false;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] === 0) { hasTransparentPixels = true; break; }
  }
  const nearBlack = Math.min(18, options.blackPoint);
  let visible = 0;
  for (let i = 0; i < pixels; i++) {
    const j = i * 4;
    const r = rgba[j], g = rgba[j + 1], b = rgba[j + 2];
    const luminance = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    let coverage = rgba[j + 3];
    if (mask) {
      const deletion = (0.2126 * mask[j] + 0.7152 * mask[j + 1] + 0.0722 * mask[j + 2]) * mask[j + 3] / 65025;
      coverage = Math.round(coverage * (1 - deletion));
    }
    // Exact black is always locked, including enclosed gaps and deleted areas.
    if (luminance === 0 || coverage === 0) coverage = 0;
    grayAlpha[i * 2] = coverage ? luminance : 0;
    grayAlpha[i * 2 + 1] = coverage;
    candidate[i] = (!hasTransparentPixels && Math.max(r, g, b) <= nearBlack) || coverage === 0 ? 1 : 0;
    if (coverage) visible++;
  }
  removeBorderBackground(candidate, grayAlpha, width, height);
  visible = 0;
  for (let i = 0; i < pixels; i++) if (grayAlpha[i * 2 + 1]) visible++;
  return { grayAlpha, width, height, visible };
}

export function cropPixels(width, height, crop) {
  if (!crop) return { x: 0, y: 0, width, height };
  if (![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) || crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0 || crop.x + crop.width > 1.0000001 || crop.y + crop.height > 1.0000001) throw new RangeError('裁剪区域必须在图片范围内且不能为空。');
  const x = Math.min(width - 1, Math.floor(crop.x * width));
  const y = Math.min(height - 1, Math.floor(crop.y * height));
  return { x, y, width: Math.max(1, Math.min(width, Math.round((crop.x + crop.width) * width)) - x), height: Math.max(1, Math.min(height, Math.round((crop.y + crop.height) * height)) - y) };
}

export function outputDimensions(sourceWidth, sourceHeight, options) {
  let width = options.pixelWidth ?? Math.round(options.widthMm * options.dpi / 25.4);
  let margin = options.pixelWidth !== undefined ? (options.pixelMargin ?? 0) : Math.round(options.margin * options.dpi / 25.4);
  let contentWidth = width - margin * 2;
  if (contentWidth < 1) throw new RangeError('边距过大，图片没有可用的内容区域。');
  let contentHeight = Math.max(1, Math.round(contentWidth * sourceHeight / sourceWidth));
  let height = contentHeight + margin * 2;
  const previewEdge = Math.min(1200, Math.max(64, options.previewEdge || 1200));
  if (options.preview && Math.max(width, height) > previewEdge) {
    const ratio = previewEdge / Math.max(width, height);
    width = Math.max(1, Math.round(width * ratio));
    margin = Math.max(0, Math.round(margin * ratio));
    contentWidth = width - margin * 2;
    if (contentWidth < 1) throw new RangeError('边距过大，预览中没有可用的内容区域。');
    contentHeight = Math.max(1, Math.round(contentWidth * sourceHeight / sourceWidth));
    height = contentHeight + margin * 2;
    // Rounding all dimensions independently can add one pixel to a tall canvas.
    while (Math.max(width, height) > previewEdge && contentWidth > 1) {
      contentWidth--;
      width--;
      contentHeight = Math.max(1, Math.round(contentWidth * sourceHeight / sourceWidth));
      height = contentHeight + margin * 2;
    }
    if (height > previewEdge) {
      // A subpixel-wide image must still occupy one output pixel.
      contentHeight = previewEdge - margin * 2;
      height = previewEdge;
    }
  }
  assertDimensions(width, height, options.preview ? '预览图片' : '导出图片');
  return { width, height, contentWidth, contentHeight, margin };
}

async function monoBlur(buffer, width, height, sigma) {
 if (sigma > 12) {
   // Three separable box passes approximate a wide Gaussian in O(pixels),
   // keeping full-resolution exports bounded instead of O(pixels * radius).
   const ideal = Math.sqrt(4 * sigma * sigma + 1);
   let lower = Math.floor(ideal); if (lower % 2 === 0) lower--;
   const upper = lower + 2;
   const lowPasses = Math.round((12 * sigma * sigma - 3 * lower * lower - 12 * lower - 9) / (-4 * lower - 4));
   let source = Float32Array.from(buffer);
   for (let pass = 0; pass < 3; pass++) {
     const radius = ((pass < lowPasses ? lower : upper) - 1) / 2, divisor = 2 * radius + 1;
     const temp = new Float32Array(source.length), output = new Float32Array(source.length);
     for (let y = 0; y < height; y++) {
       let sum = 0; for (let k = -radius; k <= radius; k++) sum += source[y * width + clamp(k, 0, width - 1)];
       for (let x = 0; x < width; x++) { temp[y * width + x] = sum / divisor; sum += source[y * width + clamp(x + radius + 1, 0, width - 1)] - source[y * width + clamp(x - radius, 0, width - 1)]; }
     }
     for (let x = 0; x < width; x++) {
       let sum = 0; for (let k = -radius; k <= radius; k++) sum += temp[clamp(k, 0, height - 1) * width + x];
       for (let y = 0; y < height; y++) { output[y * width + x] = sum / divisor; sum += temp[clamp(y + radius + 1, 0, height - 1) * width + x] - temp[clamp(y - radius, 0, height - 1) * width + x]; }
     }
     source = output;
   }
   return Uint8Array.from(source, Math.round);
 }
 const radius = Math.ceil(sigma * 3), kernel = new Float64Array(radius * 2 + 1);
 let total = 0;
 for (let i = -radius; i <= radius; i++) total += kernel[i + radius] = Math.exp(-i * i / (2 * sigma * sigma));
 for (let i = 0; i < kernel.length; i++) kernel[i] /= total;
 const temp = new Float32Array(buffer.length), output = new Uint8Array(buffer.length);
 for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
   let v = 0; for (let k = -radius; k <= radius; k++) v += buffer[y * width + clamp(x + k, 0, width - 1)] * kernel[k + radius];
   temp[y * width + x] = v;
 }
 for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
   let v = 0; for (let k = -radius; k <= radius; k++) v += temp[clamp(y + k, 0, height - 1) * width + x] * kernel[k + radius];
   output[y * width + x] = Math.round(v);
 }
 return output;
}
export async function enhance(rgba, width, height, options) {
  const count = width * height;
  const gray = new Uint8Array(count);
  const coverage = new Uint8Array(count);
  const weighted = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    gray[i] = rgba[i * 4];
    coverage[i] = rgba[i * 4 + 3];
    weighted[i] = Math.round(gray[i] * coverage[i] / 255);
  }
  const detail = new Int16Array(count);
  if (options.texture > 0 || options.shadow > 0) {
    const scale = Math.max(width, height) / 1200;
    const scales = [[Math.max(0.5, 0.8 * scale), 0.65], [Math.max(1.2, 3.2 * scale), 0.35], [Math.max(3, 12 * scale), 0.2]];
    for (const [sigma, weight] of scales) {
      // Divide blurred premultiplied luminance by blurred coverage, preventing
      // a black backdrop from creating a bright halo at the subject boundary.
      const [blurred, alphaBlur] = await Promise.all([
        monoBlur(weighted, width, height, sigma), monoBlur(coverage, width, height, sigma),
      ]);
      for (let i = 0; i < count; i++) {
        if (!coverage[i] || alphaBlur[i] < 4) continue;
        const average = clamp(blurred[i] * 255 / alphaBlur[i]);
        detail[i] += Math.round((gray[i] - average) * weight * 32);
      }
    }
  }
  const result = new Uint8Array(count);
  const brightnessGamma = Math.exp((50 - options.brightness) * 0.012);
  const contrastGamma = Math.exp((options.contrast - 50) * 0.006);
  for (let i = 0; i < count; i++) {
    if (!coverage[i] || !gray[i]) continue;
    let x = (gray[i] / 255) ** brightnessGamma;
    x += options.shadow / 100 * 0.16 * 4 * x * (1 - x) ** 2;
    x = clamp(x, 0, 1);
    x = x < 0.5 ? 0.5 * (2 * x) ** contrastGamma : 1 - 0.5 * (2 * (1 - x)) ** contrastGamma;
    const textureGate = Math.min(1, gray[i] / 24, (255 - gray[i]) / 24);
    let value = clamp(x * 255 + clamp(detail[i] / 32, -45, 45) * options.texture / 100 * 1.6 * textureGate);
    // Lift existing bright ridges in dark material, not an entire black mass.
    // The luminance gate fades out before midtones, protecting faces and white
    // clothes. Normalized blur above prevents an outline around the cutout.
    const darkGate = Math.max(0, 1 - gray[i] / 150) ** 2;
    const ridge = clamp(detail[i] / 32 - 0.5, 0, 35);
    value = clamp(value + ridge * options.shadow / 100 * 16 * darkGate);
    // Smooth black-point curve preserves deep intermediate tones; it is not a
    // threshold that would erase darker skin, dark fur, or fabric.
    if (options.blackPoint > 0) value = value * value / (value + options.blackPoint) * (255 + options.blackPoint) / 255;
    if (options.invert) value = 255 - value;
    result[i] = Math.round(clamp(value) * coverage[i] / 255);
  }
  return { gray: result, coverage };
}

export function dither(source, coverage, width, height) {
  const output = new Uint8Array(source.length);
  let current = new Float32Array(width + 2);
  let next = new Float32Array(width + 2);
  const active = (x, y) => x >= 0 && x < width && y >= 0 && y < height && coverage[y * width + x] > 0 && source[y * width + x] > 0;
  for (let y = 0; y < height; y++) {
    const direction = y % 2 === 0 ? 1 : -1;
    const start = direction === 1 ? 0 : width - 1;
    const end = direction === 1 ? width : -1;
    for (let x = start; x !== end; x += direction) {
      const i = y * width + x;
      if (!active(x, y)) continue;
      const old = clamp(source[i] + current[x + 1]);
      const value = old >= 127.5 ? 255 : 0;
      output[i] = value;
      const error = old - value;
      if (active(x + direction, y)) current[x + 1 + direction] += error * 7 / 16;
      if (active(x - direction, y + 1)) next[x + 1 - direction] += error * 3 / 16;
      if (active(x, y + 1)) next[x + 1] += error * 5 / 16;
      if (active(x + direction, y + 1)) next[x + 1 + direction] += error / 16;
    }
    [current, next] = [next, current];
    next.fill(0);
  }
  return output;
}
