import { describe, expect, it } from 'vitest';
import { buildSceneReplacementPrompt } from './sceneReplacementPrompt';

describe('buildSceneReplacementPrompt', () => {
  it('keeps the requested theme and appends non-overridable product constraints', () => {
    const prompt = buildSceneReplacementPrompt('改为温暖的家庭酒吧主题');

    expect(prompt.startsWith('改为温暖的家庭酒吧主题')).toBe(true);
    expect(prompt).toContain('它始终是商品的一部分');
    expect(prompt).toContain('商品说明文字');
    expect(prompt).toContain('尺寸箭头和辅助线');
    expect(prompt).toContain('无论盒子是打开、关闭');
    expect(prompt).toContain('禁止悬空、漂浮');
    expect(prompt).toContain('禁止无中生有地加入前景手');
    expect(prompt).toContain('穿搭允许为适应目标场景而改变');
    expect(prompt).toContain('统一重建与新场景一致的光照');
    expect(prompt).toContain('直接查看并判断输入画面中是否存在多个小图');
    expect(prompt).toContain('对模型判断出的每一个小图逐一、完整地执行');
    expect(prompt).toContain('不得根据截图、拼贴、海报或详情页等预设类别');
    expect(prompt).toContain('带文字画板');
    expect(prompt).toContain('此规则仅适用于背景陈设');
  });
});
