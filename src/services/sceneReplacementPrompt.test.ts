import { describe, expect, it } from 'vitest';
import { buildSceneReplacementPrompt } from './sceneReplacementPrompt';

describe('buildSceneReplacementPrompt', () => {
  it('keeps the requested theme and appends non-overridable product constraints', () => {
    const prompt = buildSceneReplacementPrompt('改为温暖的家庭酒吧主题');

    expect(prompt.startsWith('改为温暖的家庭酒吧主题')).toBe(true);
    expect(prompt).toContain('礼盒、木盒和包装结构属于商品');
    expect(prompt).toContain('商品说明文字');
    expect(prompt).toContain('禁止悬空、漂浮');
    expect(prompt).toContain('禁止无中生有地加入前景手');
    expect(prompt).toContain('穿搭允许为适应目标场景而改变');
    expect(prompt).toContain('统一重建与新场景一致的光照');
  });
});
