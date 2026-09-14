import { AppError } from "./errors.mjs";

// Deliberately strict: detects copies / near-identical returned references, not identity.
export function isNearReference(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
): boolean {
  if (a.length !== b.length || !a.length) return false;
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
  if (va / n < 100 || vb / n < 100) return false;
  return cov / Math.sqrt(va * vb) > 0.998;
}
async function thumbnail(blob: Blob): Promise<Float32Array> {
  const image = await createImageBitmap(blob, {
    resizeWidth: 64,
    resizeHeight: 64,
    resizeQuality: "high",
  });
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("无法读取画布");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, 64, 64);
    ctx.drawImage(image, 0, 0, 64, 64);
    const pixels = ctx.getImageData(0, 0, 64, 64).data,
      result = new Float32Array(4096);
    for (let i = 0; i < 4096; i++)
      result[i] =
        pixels[i * 4] * 0.2126 +
        pixels[i * 4 + 1] * 0.7152 +
        pixels[i * 4 + 2] * 0.0722;
    return result;
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
  if (isNearReference(a, b))
    throw new AppError(
      "图像服务返回的图片与风格参考图高度相似，可能误把参考图当成了输出。本次结果未加入成品；未自动重试，请核对原照后手动重新生成。",
      502,
      "REFERENCE_OUTPUT",
    );
}
