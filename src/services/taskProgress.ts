export interface TaskProgress { id: string; label: string; completed: number; total: number; failed: number; running: boolean; updatedAt: number }
const progress = new Map<string, TaskProgress>();
const listeners = new Set<(items: TaskProgress[]) => void>();
const snapshot = () => [...progress.values()].sort((a, b) => b.updatedAt - a.updatedAt);
const notify = () => { const items = snapshot(); listeners.forEach((listener) => listener(items)); };

export function subscribeTaskProgress(listener: (items: TaskProgress[]) => void) { listeners.add(listener); listener(snapshot()); return () => { listeners.delete(listener); }; }

export function reportTaskProgress(input: Omit<TaskProgress, 'updatedAt'>) {
  const previous = progress.get(input.id); const next = { ...input, updatedAt: Date.now() }; progress.set(input.id, next); notify();
  if (previous?.running && !next.running && next.total > 0 && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    const success = Math.max(0, next.total - next.failed); new Notification(`${next.label}已完成`, { body: `${success} 个成功${next.failed ? `，${next.failed} 个失败` : ''}`, tag: `scene-studio-${next.id}` });
  }
}

export function clearTaskProgress(id: string) { progress.delete(id); notify(); }
export async function requestTaskNotifications() { if (typeof Notification === 'undefined') return 'unsupported' as const; return Notification.requestPermission(); }

export function buildTaskPageTitle(completed: number, runningTotal: number, failed: number, contextLabel?: string) {
  const light = failed > 0 ? '🔴' : runningTotal > 0 ? '🟡' : '🟢';
  const pageName = contextLabel?.trim() ? `${contextLabel.trim()} - Scene Studio` : 'Scene Studio';
  return runningTotal > 0 ? `${light} [${completed}/${runningTotal}] ${pageName}` : `${light} ${pageName}`;
}
