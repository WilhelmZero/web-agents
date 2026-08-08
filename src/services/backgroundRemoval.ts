export interface BackgroundRemovalProgress {
  current: number;
  total: number;
  percent: number;
}

export const GPT_BACKGROUND_REMOVAL_PROMPT = `精确分离图片中的完整前景主体。保持主体的构图、位置、尺寸、比例、姿态、轮廓、颜色、材质、文字、Logo 和所有内部细节不变，不要重新设计、补画、裁切或移动主体。必须保留细发、绒毛、透明材质、镂空区域、轮辐、缝隙和细小零件。移除主体之外的全部背景、投影、背景反光和颜色溢出，把所有背景区域（包括主体内部孔洞）替换为完全均匀的纯白色 #FFFFFF。主体与白色背景之间边缘清晰自然，不要描边、光晕、棋盘格、渐变、纹理或残留背景。输出完整图片，不要添加说明文字。`;

export async function hasUsableTransparency(image: Blob): Promise<boolean> {
  const bitmap = await createImageBitmap(image);
  try {
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return false;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let transparent = 0;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index] < 245) transparent += 1;
    return transparent / (pixels.length / 4) >= 0.01;
  } finally { bitmap.close(); }
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
