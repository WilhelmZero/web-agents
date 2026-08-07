export interface BackgroundRemovalProgress {
  current: number;
  total: number;
  percent: number;
}

/**
 * Uses a dedicated foreground-segmentation / alpha-matting model in the browser.
 * The original RGB pixels are preserved and no generative image model is involved.
 */
export async function removeImageBackground(
  image: Blob,
  onProgress?: (progress: BackgroundRemovalProgress) => void,
): Promise<Blob> {
  // Keep the ONNX runtime out of the main app bundle; load it only when the
  // user actually starts a cutout task.
  const { removeBackground } = await import('@imgly/background-removal');
  return await removeBackground(image, {
    model: 'isnet_fp16',
    output: { format: 'image/png', quality: 1 },
    progress: (_key: string, current: number, total: number) => {
      onProgress?.({
        current,
        total,
        percent: total > 0 ? Math.min(100, Math.round(current / total * 100)) : 0,
      });
    },
  });
}
