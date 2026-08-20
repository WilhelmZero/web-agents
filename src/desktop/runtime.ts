import type { DesktopAssetInput, DesktopCreateJobRequest } from './types';

export function isElectronDesktop() {
  return typeof window !== 'undefined' && Boolean(window.desktop);
}
export function desktopAssetFromFile(file: File): DesktopAssetInput {
  if (!window.desktop) throw new Error('桌面后台运行时不可用');
  const path = window.desktop.getPathForFile(file);
  if (!path) throw new Error(`${file.name} 无法读取本地路径，请在桌面应用中重新选择文件`);
  return {
    path,
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    relativePath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
  };
}

export async function submitDesktopJob(request: DesktopCreateJobRequest) {
  if (!window.desktop) throw new Error('桌面后台运行时不可用');
  return window.desktop.createJob(request);
}
