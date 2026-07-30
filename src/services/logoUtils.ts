import JSZip from 'jszip';
import type {
  LogoGenerationTask,
  LogoInpaintMask,
  LogoPair,
  LogoPlacement,
  LogoResultGroup,
} from '../types';
import { createId, downloadBlob, mimeExtension, sanitizeFileName } from '../utils';

export function buildLogoPairs(
  scenes: LogoPair['scene'][],
  logos: LogoPair['logo'][],
  placements: Record<number, LogoPlacement | undefined> = {},
  inpaintMasks: Record<number, LogoInpaintMask | undefined> = {},
): LogoPair[] {
  return Array.from({ length: Math.max(scenes.length, logos.length) }, (_, index) => ({
    id: `logo-pair-${index}`,
    index,
    scene: scenes[index],
    logo: logos[index],
    placement: placements[index],
    inpaintMask: inpaintMasks[index],
  }));
}

export async function inpaintGuideToBlob(guideDataUrl: string): Promise<Blob> {
  const response = await fetch(guideDataUrl);
  if (!response.ok) throw new Error('局部重绘参考图转换失败');
  return response.blob();
}

export function buildLogoTasks(pairs: LogoPair[], copiesPerGroup: number): LogoGenerationTask[] {
  if (!pairs.length || pairs.some((pair) => !pair.scene || !pair.logo)) {
    throw new Error('每组都需要一张场景图和一张 Logo 图');
  }
  return pairs.flatMap((pair) =>
    Array.from({ length: copiesPerGroup }, (_, copyIndex) => ({
      id: createId(),
      pairId: pair.id,
      pairIndex: pair.index,
      copyIndex,
      status: 'waiting' as const,
      retryCount: 0,
    })),
  );
}

export function makeLogoResultGroups(
  pairs: LogoPair[],
  tasks: LogoGenerationTask[],
): LogoResultGroup[] {
  return pairs
    .map((pair) => {
      const groupTasks = tasks.filter((task) => task.pairId === pair.id);
      return {
        pair,
        tasks: groupTasks,
        successCount: groupTasks.filter((task) => task.status === 'success').length,
        failedCount: groupTasks.filter((task) => task.status === 'failed').length,
      };
    })
    .filter((group) => group.tasks.length > 0);
}

export function logoTaskFileName(task: LogoGenerationTask, pair: LogoPair, model: string) {
  const sceneName = sanitizeFileName(pair.scene?.name || 'scene');
  return `${String(task.pairIndex + 1).padStart(2, '0')}_${sceneName}_${String(task.copyIndex + 1).padStart(2, '0')}_${model}.${mimeExtension(task.resultMimeType)}`;
}

export function downloadLogoTask(task: LogoGenerationTask, pair: LogoPair, model: string) {
  if (task.resultBlob) downloadBlob(task.resultBlob, logoTaskFileName(task, pair, model));
}

export async function downloadLogoGroup(group: LogoResultGroup, model: string) {
  const zip = new JSZip();
  group.tasks.forEach((task) => {
    if (task.resultBlob) zip.file(logoTaskFileName(task, group.pair, model), task.resultBlob);
  });
  downloadBlob(
    await zip.generateAsync({ type: 'blob' }),
    `${sanitizeFileName(group.pair.scene?.name || 'Logo合成')}_合成结果.zip`,
  );
}

export async function downloadAllLogoResults(
  groups: LogoResultGroup[],
  model: string,
  copiesPerGroup: number,
) {
  const zip = new JSZip();
  groups.forEach((group) => {
    const target = copiesPerGroup > 1
      ? zip.folder(`${String(group.pair.index + 1).padStart(2, '0')}_${sanitizeFileName(group.pair.scene?.name || 'scene')}`)!
      : zip;
    group.tasks.forEach((task) => {
      if (task.resultBlob) target.file(logoTaskFileName(task, group.pair, model), task.resultBlob);
    });
  });
  downloadBlob(await zip.generateAsync({ type: 'blob' }), 'SceneStudio_Logo合成结果.zip');
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('无法读取定位图片'));
    image.src = url;
  });
}

export async function createPlacementGuide(
  sceneUrl: string,
  logoUrl: string,
  placement: LogoPlacement,
): Promise<Blob> {
  const [scene, logo] = await Promise.all([loadImage(sceneUrl), loadImage(logoUrl)]);
  const canvas = document.createElement('canvas');
  canvas.width = scene.naturalWidth;
  canvas.height = scene.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器不支持 Canvas 定位参考图');
  context.drawImage(scene, 0, 0);
  const width = canvas.width * placement.width;
  const height = width * (logo.naturalHeight / logo.naturalWidth);
  context.save();
  context.translate(canvas.width * placement.x, canvas.height * placement.y);
  context.rotate((placement.rotation * Math.PI) / 180);
  if (placement.invertForGuide) context.filter = 'invert(1)';
  context.drawImage(logo, -width / 2, -height / 2, width, height);
  context.restore();
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('生成定位参考图失败')), 'image/png');
  });
}
