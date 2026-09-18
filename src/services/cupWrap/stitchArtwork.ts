export interface StitchSize {
  width: number;
  height: number;
}

export function stitchedDimensions(sizes: StitchSize[]) {
  if (!sizes.length) return { width: 0, height: 0, parts: [] as StitchSize[] };
  const height = Math.max(...sizes.map((size) => size.height));
  const parts = sizes.map((size) => ({
    width: Math.max(1, Math.round((size.width * height) / size.height)),
    height,
  }));
  return {
    width: parts.reduce((sum, part) => sum + part.width, 0),
    height,
    parts,
  };
}

/** Joins images edge-to-edge after equalizing their seam height. */
export async function stitchArtwork(blobs: Blob[]): Promise<Blob> {
  if (!blobs.length) throw new Error("没有可拼接的图片");
  if (blobs.length === 1) return blobs[0];
  const images = await Promise.all(blobs.map((blob) => createImageBitmap(blob)));
  try {
    const layout = stitchedDimensions(
      images.map((image) => ({ width: image.width, height: image.height })),
    );
    if (layout.width * layout.height > 60_000_000)
      throw new Error("拼接图片超过 6000 万像素，请先降低图片分辨率");
    const canvas = new OffscreenCanvas(layout.width, layout.height),
      ctx = canvas.getContext("2d")!;
    let x = 0;
    images.forEach((image, index) => {
      const part = layout.parts[index];
      ctx.drawImage(image, x, 0, part.width, part.height);
      x += part.width;
    });
    return canvas.convertToBlob({ type: "image/png" });
  } finally {
    images.forEach((image) => image.close());
  }
}
