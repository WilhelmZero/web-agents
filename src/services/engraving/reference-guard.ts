import { AppError } from "./errors.mjs";

// Compares structure, not semantic identity. Quality review still checks the customer subject.
function correlation(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || !a.length) return 0;
  const n = a.length;
  let ma = 0,
    mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let va = 0,
    vb = 0,
    cov = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma,
      y = b[i] - mb;
    va += x * x;
    vb += y * y;
    cov += x * y;
  }
  if (va / n < 100 || vb / n < 100) return 0;
  return cov / Math.sqrt(va * vb);
}
export function isNearReference(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
): boolean {
  const detail = correlation(a, b);
  if (detail > 0.998) return true;
  if (a.length !== 4096 || b.length !== 4096 || detail < 0.9) return false;
  const coarse = (values: ArrayLike<number>) => {
    const out = new Float32Array(256);
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 64; x++)
        out[Math.floor(y / 4) * 16 + Math.floor(x / 4)] +=
          values[y * 64 + x] / 16;
    return out;
  };
  return correlation(coarse(a), coarse(b)) > 0.985;
}
async function thumbnail(blob: Blob): Promise<Float32Array[]> {
  // Locate bounds before downsampling so small border changes do not shift features by a thumbnail pixel.
  const image = await createImageBitmap(blob, {
    resizeWidth: 512,
    resizeHeight: 512,
    resizeQuality: "high",
  });
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("无法读取画布");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, 512, 512);
    ctx.drawImage(image, 0, 0, 512, 512);
    const data = ctx.getImageData(0, 0, 512, 512).data;
    let left = 512,
      top = 512,
      right = -1,
      bottom = -1;
    for (let y = 0; y < 512; y++)
      for (let x = 0; x < 512; x++) {
        const at = (y * 512 + x) * 4;
        if (
          data[at] * 0.2126 + data[at + 1] * 0.7152 + data[at + 2] * 0.0722 >
          16
        ) {
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
      }
    const sample = (x: number, y: number, w: number, h: number) => {
      const small = document.createElement("canvas");
      small.width = 64;
      small.height = 64;
      const c = small.getContext("2d", { willReadFrequently: true })!;
      c.imageSmoothingQuality = "high";
      c.drawImage(canvas, x, y, w, h, 0, 0, 64, 64);
      const pixels = c.getImageData(0, 0, 64, 64).data,
        result = new Float32Array(4096);
      for (let i = 0; i < 4096; i++)
        result[i] =
          pixels[i * 4] * 0.2126 +
          pixels[i * 4 + 1] * 0.7152 +
          pixels[i * 4 + 2] * 0.0722;
      return result;
    };
    const full = sample(0, 0, 512, 512);
    return right - left < 8 || bottom - top < 8
      ? [full]
      : [full, sample(left, top, right - left + 1, bottom - top + 1)];
  } finally {
    image.close();
  }
}
export async function rejectReferenceOutput(
  output: Blob,
  reference: Blob,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const a = await thumbnail(output);
  signal?.throwIfAborted();
  const b = await thumbnail(reference);
  signal?.throwIfAborted();
  if (a.some((left) => b.some((right) => isNearReference(left, right))))
    throw new AppError(
      "图像服务返回的图片与风格参考图高度相似，可能误把参考图当成了输出。本次结果未加入成品；未自动重试，请核对原照后手动重新生成。",
      502,
      "REFERENCE_OUTPUT",
    );
}
