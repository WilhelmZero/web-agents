import { describe, expect, it } from 'vitest';
import type { LogoAsset } from '../types';
import { assignReplacementLogos, buildLogoReplaceTasks, shouldAutoRetryLogoError } from './logoReplaceUtils';
import { assignMultipleLogos, expandStylesByOccurrence } from './logoReplaceDevUtils';

const file = new File(['x'], 'asset.png', { type: 'image/png' });
const assets = (prefix: string, count: number): LogoAsset[] => Array.from({ length: count }, (_, index) => ({
  id: `${prefix}-${index}`,
  file,
  name: `${prefix}-${index}.png`,
  mimeType: 'image/png',
  previewUrl: `blob:${prefix}-${index}`,
}));

describe('Logo 替换配对', () => {
  it('关闭随机时按索引一一配对', () => {
    const pairings = assignReplacementLogos(assets('scene', 2), assets('logo', 2), false, 'seed');
    expect(pairings.map((pairing) => pairing.logo?.id)).toEqual(['logo-0', 'logo-1']);
  });

  it('随机模式允许场景与 Logo 数量不同且相同种子结果稳定', () => {
    const scenes = assets('scene', 5);
    const logos = assets('logo', 2);
    const first = assignReplacementLogos(scenes, logos, true, 'stable-seed');
    const second = assignReplacementLogos(scenes, logos, true, 'stable-seed');
    expect(first.map((pairing) => pairing.logo?.id)).toEqual(second.map((pairing) => pairing.logo?.id));
    expect(first.every((pairing) => logos.some((logo) => logo.id === pairing.logo?.id))).toBe(true);
  });

  it('手动指定优先于自动配对', () => {
    const scenes = assets('scene', 2);
    const logos = assets('logo', 2);
    const pairings = assignReplacementLogos(scenes, logos, false, 'seed', { 'scene-0': 'logo-1' });
    expect(pairings.map((pairing) => pairing.logo?.id)).toEqual(['logo-1', 'logo-1']);
  });
  it('任务固定保存预览时分配的新 Logo', () => {
    const pairings = assignReplacementLogos(assets('scene', 2), assets('logo', 2), false, 'seed');
    const tasks = buildLogoReplaceTasks(pairings, 2);
    expect(tasks).toHaveLength(4);
    expect(tasks.map((task) => task.newLogoId)).toEqual(['logo-0', 'logo-0', 'logo-1', 'logo-1']);
  });

  it('存在未配对场景时阻止创建任务', () => {
    const pairings = assignReplacementLogos(assets('scene', 2), assets('logo', 1), false, 'seed');
    expect(() => buildLogoReplaceTasks(pairings, 1)).toThrow('必须匹配');
  });
  it('错误自动重试严格遵守启用状态和次数上限', () => {
    expect(shouldAutoRetryLogoError(0, true, 3)).toBe(true);
    expect(shouldAutoRetryLogoError(2, true, 3)).toBe(true);
    expect(shouldAutoRetryLogoError(3, true, 3)).toBe(false);
    expect(shouldAutoRetryLogoError(0, false, 3)).toBe(false);
  });
});

describe('相同 Logo 多位置分配', () => {
  it('先使用全部不同 Logo，不足后才循环补足', () => {
    const logos = assets('logo', 10);
    const analyses = { scene: { sceneId: 'scene', status: 'success' as const, styles: [{ id: 'style-1', label: '样式 1', description: '相同字样', carrier: '杯子', occurrences: 12 }] } };
    const assigned = assignMultipleLogos(['scene'], analyses, logos, 'seed', true).scene;
    expect(assigned).toHaveLength(12);
    expect(new Set(assigned.slice(0, 10))).toHaveLength(10);
    expect(assigned.slice(10).every((id) => logos.some((logo) => logo.id === id))).toBe(true);
  });

  it('Logo 多于位置时只选择所需数量', () => {
    const logos = assets('logo', 13);
    const analyses = { scene: { sceneId: 'scene', status: 'success' as const, styles: [{ id: 'style-1', label: '样式 1', description: '相同字样', carrier: '杯子', occurrences: 12 }] } };
    const assigned = assignMultipleLogos(['scene'], analyses, logos, 'seed', true).scene;
    expect(assigned).toHaveLength(12);
    expect(new Set(assigned)).toHaveLength(12);
  });

  it('为同样式的每个位置生成独立映射', () => {
    const expanded = expandStylesByOccurrence([{ id: 'style-1', label: '样式 1', description: '相同字样', carrier: '杯子', occurrences: 3 }], true);
    expect(expanded.map((item) => item.id)).toEqual(['style-1-occurrence-1', 'style-1-occurrence-2', 'style-1-occurrence-3']);
    expect(expanded.every((item) => item.occurrences === 1)).toBe(true);
  });
});
