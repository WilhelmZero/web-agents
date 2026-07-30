import JSZip from 'jszip';
import type { ProductDetailPrompt, ProductDetailTask } from '../types';
import { downloadBlob, mimeExtension, sanitizeFileName } from '../utils';

export function extractOverlayTexts(content: string): string[] {
  const values: string[] = [];
  const pattern = /“([^”]+)”|"([^"]+)"/g;
  for (const match of content.matchAll(pattern)) {
    const value = (match[1] || match[2] || '').trim();
    if (value && !values.includes(value)) values.push(value);
  }
  return values;
}

export function replaceOverlayText(content: string, previous: string, next: string): string {
  const escaped = previous.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(“|")${escaped}(”|")`);
  if (pattern.test(content)) return content.replace(pattern, `“${next}”`);
  return `${content.trim()} 画面中清晰显示文字“${next}”。`;
}

export function detailTaskFileName(task: ProductDetailTask, prompt: ProductDetailPrompt, model: string): string {
  return `${String(prompt.index + 1).padStart(2, '0')}_${sanitizeFileName(prompt.title)}_${model}.${mimeExtension(task.resultMimeType)}`;
}

export function downloadDetailTask(task: ProductDetailTask, prompt: ProductDetailPrompt, model: string) {
  if (task.resultBlob) downloadBlob(task.resultBlob, detailTaskFileName(task, prompt, model));
}

export async function downloadAllDetailTasks(
  tasks: ProductDetailTask[],
  prompts: ProductDetailPrompt[],
  model: string,
) {
  const zip = new JSZip();
  tasks.forEach((task) => {
    const prompt = prompts.find((item) => item.id === task.promptId);
    if (prompt && task.resultBlob) zip.file(detailTaskFileName(task, prompt, model), task.resultBlob);
  });
  downloadBlob(await zip.generateAsync({ type: 'blob' }), '商品详情页图片.zip');
}

function loadBlobImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('无法读取详情图结果'));
    };
    image.src = url;
  });
}

export async function composeDetailLongImage(
  tasks: ProductDetailTask[],
  prompts: ProductDetailPrompt[],
): Promise<Blob> {
  const ordered = prompts
    .map((prompt) => tasks.find((task) => task.promptId === prompt.id && task.resultBlob))
    .filter((task): task is ProductDetailTask & { resultBlob: Blob } => Boolean(task?.resultBlob));
  if (!ordered.length) throw new Error('暂无可合成的详情图');
  const images = await Promise.all(ordered.map((task) => loadBlobImage(task.resultBlob)));
  const aspectHeight = images.reduce((sum, image) => sum + image.naturalHeight / image.naturalWidth, 0);
  const width = Math.max(1, Math.min(1600, ...images.map((image) => image.naturalWidth), Math.floor(24000 / aspectHeight)));
  const heights = images.map((image) => Math.round(width * image.naturalHeight / image.naturalWidth));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = heights.reduce((sum, height) => sum + height, 0);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器不支持详情长图合成');
  let y = 0;
  images.forEach((image, index) => {
    context.drawImage(image, 0, y, width, heights[index]);
    y += heights[index];
  });
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('详情长图合成失败')), 'image/png');
  });
}
