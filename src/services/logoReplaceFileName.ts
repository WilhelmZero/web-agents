import { mimeExtension, sanitizeFileName } from '../utils';

export function logoReplaceResultFileName(sceneName: string, copyIndex: number, copiesPerScene: number, resultMimeType?: string) {
  const baseName = sanitizeFileName(sceneName);
  const suffix = copiesPerScene > 1 ? `_${copyIndex + 1}` : '';
  return `${baseName}${suffix}.${mimeExtension(resultMimeType)}`;
}
