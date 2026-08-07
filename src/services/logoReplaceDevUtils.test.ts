import { describe, expect, it } from 'vitest';
import { assignMultipleLogos } from './logoReplaceDevUtils';
import type { LogoAsset, SceneLogoAnalysis } from '../types';

const logo = (id: string) => ({ id, name: id, file: new File(['x'], `${id}.png`, { type: 'image/png' }), mimeType: 'image/png', previewUrl: id }) as LogoAsset;

describe('开发版多 Logo 分配', () => {
  it('按场景样式数分配不重复的新 Logo', () => {
    const analysis: SceneLogoAnalysis = { sceneId: 'scene-1', status: 'success', summary: '', styles: [
      { id: 'a', label: '样式1', description: '', occurrences: 2, carrier: '杯子' },
      { id: 'b', label: '样式2', description: '', occurrences: 3, carrier: '木盒' },
    ] };
    const assigned = assignMultipleLogos(['scene-1'], { 'scene-1': analysis }, [logo('l1'), logo('l2'), logo('l3')], 'seed');
    expect(assigned['scene-1']).toHaveLength(2);
    expect(new Set(assigned['scene-1']).size).toBe(2);
  });
});
