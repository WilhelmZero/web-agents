import { describe, expect, it } from 'vitest';
import type { LogoAsset } from '../types';
import { assignReplacementLogos, buildLogoReplaceTasks, shouldAutoRetryLogoError } from './logoReplaceUtils';

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
