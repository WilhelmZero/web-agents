export interface LogoRemovalExportItem {
  sourceRelativePath: string;
  sourceName: string;
  copyIndex: number;
  resultKey?: string;
}

export function logoRemovalExportPath(sourceRelativePath: string, sourceName: string, groupPath: string) {
  if (groupPath === '未分组') return sourceName;
  const parts = sourceRelativePath.replace(/\\/g, '/').split('/').filter((part) => part && part !== '.' && part !== '..');
  if (!parts.length) return sourceName;
  parts[parts.length - 1] = sourceName;
  return parts.join('/');
}

export function firstLogoRemovalResultPerSource<T extends LogoRemovalExportItem>(tasks: T[]) {
  const selected = new Map<string, T>();
  tasks.forEach((task) => {
    if (!task.resultKey) return;
    const current = selected.get(task.sourceRelativePath);
    if (!current || task.copyIndex < current.copyIndex) selected.set(task.sourceRelativePath, task);
  });
  return Array.from(selected.values());
}
