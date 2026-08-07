import { describe, expect, it, vi } from 'vitest';
import { buildTaskPageTitle, clearTaskProgress, reportTaskProgress, subscribeTaskProgress } from './taskProgress';

describe('task progress center', () => {
  it('publishes and clears progress snapshots', () => {
    const listener = vi.fn(); const unsubscribe = subscribeTaskProgress(listener);
    reportTaskProgress({ id: 'x', label: '测试', completed: 1, total: 2, failed: 0, running: true });
    expect(listener.mock.calls.at(-1)?.[0][0]).toMatchObject({ id: 'x', completed: 1, total: 2 });
    clearTaskProgress('x'); expect(listener.mock.calls.at(-1)?.[0]).toEqual([]); unsubscribe();
  });

  it('builds browser titles with red, yellow and green status lights', () => {
    expect(buildTaskPageTitle(1, 3, 0)).toBe('🟡 [1/3] Scene Studio');
    expect(buildTaskPageTitle(2, 3, 1)).toBe('🔴 [2/3] Scene Studio');
    expect(buildTaskPageTitle(3, 0, 0)).toBe('🟢 Scene Studio');
  });
});
