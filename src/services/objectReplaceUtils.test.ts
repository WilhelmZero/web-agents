import { describe, expect, it } from 'vitest';
import type { LogoAsset } from '../types';
import { buildObjectReplaceTasks } from './objectReplaceUtils';

const file = new File(['x'], 'scene.png', { type: 'image/png' });
const scenes: LogoAsset[] = [0, 1].map((index) => ({ id: 'scene-' + index, file, name: 'scene-' + index + '.png', mimeType: 'image/png', previewUrl: 'blob:' + index }));

describe('物体批量替换任务', () => {
  it('按场景数和每张生成数展开任务', () => {
    const tasks = buildObjectReplaceTasks(scenes, 3);
    expect(tasks).toHaveLength(6);
    expect(tasks.map((item) => item.copyIndex)).toEqual([0, 1, 2, 0, 1, 2]);
    expect(tasks.every((item) => item.status === 'waiting')).toBe(true);
  });
});