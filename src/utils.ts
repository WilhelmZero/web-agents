import { MODEL_CAPABILITIES, PRICING } from './constants';
import type {
  AppSettings,
  GenerationTask,
  ImageModel,
  ImageSize,
  ProductImage,
  PromptItem,
} from './types';

export const createId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function splitPrompts(input: string, delimiter: string): string[] {
  if (!delimiter) return input.trim() ? [input.trim()] : [];
  return input
    .split(delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildTasks(
  products: ProductImage[],
  prompts: PromptItem[],
  mode: AppSettings['combinationMode'],
): GenerationTask[] {
  const validPrompts = prompts.filter((prompt) => prompt.content.trim());
  if (mode === 'paired' && products.length !== validPrompts.length) {
    throw new Error('一一对应模式要求产品图与有效提示词数量一致');
  }

  const pairs =
    mode === 'paired'
      ? products.map((product, index) => ({ product, productIndex: index, prompt: validPrompts[index], promptIndex: index }))
      : products.flatMap((product, productIndex) =>
          validPrompts.map((prompt, promptIndex) => ({ product, productIndex, prompt, promptIndex })),
        );

  return pairs.map(({ product, productIndex, prompt, promptIndex }) => ({
    id: createId(),
    productId: product.id,
    productIndex,
    promptId: prompt.id,
    promptIndex,
    prompt: prompt.content.trim(),
    status: 'waiting',
    retryCount: 0,
  }));
}

export function normalizeSettingsForModel(
  model: ImageModel,
  aspectRatio: string,
  imageSize: ImageSize,
): Pick<AppSettings, 'aspectRatio' | 'imageSize'> {
  const capability = MODEL_CAPABILITIES[model];
  return {
    aspectRatio: capability.aspectRatios.includes(aspectRatio) ? aspectRatio : '1:1',
    imageSize: capability.imageSizes.includes(imageSize) ? imageSize : capability.defaultSize,
  };
}

export function estimateImageCost(model: ImageModel, size: ImageSize, taskCount: number): number {
  const pricing = PRICING.models[model];
  const output = pricing.outputBySize[size] ?? pricing.outputBySize['1K'] ?? 0;
  return taskCount * (output + pricing.inputImage);
}

export function sanitizeFileName(name: string): string {
  const withoutExtension = name.replace(/\.[^.]+$/, '');
  return withoutExtension.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').trim() || '未命名产品';
}

export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function mimeExtension(mimeType = 'image/png') {
  return mimeType.includes('jpeg') ? 'jpg' : mimeType.includes('webp') ? 'webp' : 'png';
}
