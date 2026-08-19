import { GoogleGenAI } from '@google/genai';
import type { GeneratedImage, ImageModel, ImageSize } from '../types';
import { fileToBase64 } from '../utils';
import { getGeminiApiRoot } from './gemini';

export interface GeminiSceneBatchItem { key: string; prompt: string; image: File; aspectRatio?: string }

const FINISHED = new Set(['JOB_STATE_SUCCEEDED', 'JOB_STATE_FAILED', 'JOB_STATE_CANCELLED', 'JOB_STATE_EXPIRED']);

export async function generateSceneReplacementBatch(options: {
  apiKey: string;
  apiBaseUrl?: string | null;
  model: ImageModel;
  imageSize: ImageSize;
  items: GeminiSceneBatchItem[];
  signal?: AbortSignal;
  onState?: (state: string) => void;
}): Promise<Record<string, GeneratedImage | Error>> {
  const estimatedBytes = options.items.reduce((sum, item) => sum + item.image.size * 4 / 3 + item.prompt.length * 2, 0);
  if (estimatedBytes >= 19 * 1024 * 1024) throw new Error('当前批次内嵌请求预计超过 20MB，请减少单批图片数量后重试');
  const client = new GoogleGenAI({ apiKey: options.apiKey, ...(options.apiBaseUrl ? { httpOptions: { baseUrl: getGeminiApiRoot(options.apiBaseUrl) } } : {}) });
  const requests = await Promise.all(options.items.map(async (item) => ({
    contents: [{ role: 'user', parts: [{ text: item.prompt }, { inlineData: { mimeType: item.image.type, data: await fileToBase64(item.image) } }] }],
    config: { responseModalities: ['IMAGE'], imageConfig: { imageSize: options.imageSize, ...(item.aspectRatio ? { aspectRatio: item.aspectRatio } : {}) } },
  })));
  const job = await client.batches.create({ model: options.model, src: requests, config: { displayName: `scene-studio-${Date.now()}` } });
  let current = job;
  while (!FINISHED.has(String(current.state))) {
    if (options.signal?.aborted) { await client.batches.cancel({ name: current.name! }).catch(() => undefined); throw new DOMException('请求已中止', 'AbortError'); }
    options.onState?.(String(current.state || 'JOB_STATE_PENDING'));
    await new Promise((resolve) => window.setTimeout(resolve, 10_000));
    current = await client.batches.get({ name: current.name! });
  }
  options.onState?.(String(current.state));
  if (String(current.state) !== 'JOB_STATE_SUCCEEDED') throw new Error(`Gemini Batch 任务未完成：${String(current.state)}`);
  const responses = current.dest?.inlinedResponses || [];
  return Object.fromEntries(options.items.map((item, index) => {
    const output = responses[index];
    if (output?.error) return [item.key, new Error(output.error.message || 'Batch 子任务失败')];
    const imagePart = output?.response?.candidates?.flatMap((candidate) => candidate.content?.parts || []).find((part) => part.inlineData?.data);
    if (!imagePart?.inlineData?.data) return [item.key, new Error('Batch 子任务未返回图片')];
    const bytes = Uint8Array.from(atob(imagePart.inlineData.data), (char) => char.charCodeAt(0));
    const mimeType = imagePart.inlineData.mimeType || 'image/png';
    return [item.key, { blob: new Blob([bytes], { type: mimeType }), mimeType }];
  }));
}
