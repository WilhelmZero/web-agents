import JSZip from 'jszip';
import type { GenerationTask, ProductImage, ResultGroup } from '../types';
import { downloadBlob, mimeExtension, sanitizeFileName } from '../utils';

export function taskFileName(task: GenerationTask, model: string) {
  return `${String(task.productIndex + 1).padStart(2, '0')}_${String(task.promptIndex + 1).padStart(2, '0')}_${model}.${mimeExtension(task.resultMimeType)}`;
}

export function downloadTask(task: GenerationTask, model: string) {
  if (!task.resultBlob) return;
  downloadBlob(task.resultBlob, taskFileName(task, model));
}

function addGroup(zip: JSZip, group: ResultGroup, model: string, includeFolder: boolean) {
  const name = `${String(group.tasks[0]?.productIndex + 1 || 1).padStart(2, '0')}_${sanitizeFileName(group.product.name)}`;
  const target = includeFolder ? zip.folder(name)! : zip;
  group.tasks.forEach((task) => {
    if (task.resultBlob) target.file(taskFileName(task, model), task.resultBlob);
  });
}

export async function downloadGroupZip(group: ResultGroup, model: string) {
  const zip = new JSZip();
  addGroup(zip, group, model, false);
  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, `${sanitizeFileName(group.product.name)}_场景图.zip`);
}

export async function downloadAllZip(groups: ResultGroup[], model: string) {
  const zip = new JSZip();
  groups.forEach((group) => addGroup(zip, group, model, true));
  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, 'SceneStudio_全部场景图.zip');
}

export function makeResultGroups(products: ProductImage[], tasks: GenerationTask[]): ResultGroup[] {
  return products
    .map((product) => {
      const groupTasks = tasks.filter((task) => task.productId === product.id);
      return {
        product,
        tasks: groupTasks,
        successCount: groupTasks.filter((task) => task.status === 'success').length,
        failedCount: groupTasks.filter((task) => task.status === 'failed').length,
      };
    })
    .filter((group) => group.tasks.length > 0);
}
