import { chooseChromaMatte, restoreTransparentBackground, type RgbColor } from './transparentImageEdit';

export const DEFAULT_BACKGROUND_REMOVAL_PROMPT = '移除图片背景，只保留完整的前景主体。准确保留主体原有的形状、比例、颜色、材质、Logo、文字和内部细节，不要重绘或改变主体。主体轮廓必须清晰完整，细发、绒毛、透明或半透明边缘应自然保留。不要生成投影、接触阴影、反光、烟雾或颜色溢出污染背景。';

const colorHex = ({ r, g, b }: RgbColor) => `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`;

export function buildBackgroundRemovalPrompt(prompt: string, matte: RgbColor): string {
  const hex = colorHex(matte);
  return `${prompt.trim()}\n\n抠图底色技术要求：把主体之外的所有区域替换为完全均匀、单一且准确的纯色 ${hex}。主体和 ${hex} 底色必须明确分离；底色区域不得出现棋盘格、渐变、纹理、噪点、阴影、光晕、水印或其他内容。输出完整图片，不要说明文字。`;
}

export async function chooseBackgroundRemovalMatte(file: Blob): Promise<RgbColor> {
  const bitmap = await createImageBitmap(file);
  try {
    const maxDimension = 512;
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('当前浏览器无法分析图片颜色');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return chooseChromaMatte(context.getImageData(0, 0, canvas.width, canvas.height).data);
  } finally { bitmap.close(); }
}

export { restoreTransparentBackground };
