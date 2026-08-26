import { describe, expect, it } from 'vitest';
import { DEFAULT_LOGO_REPLACE_SETTINGS } from './constants';
import { buildActualReplacementPrompt } from './LogoReplaceComposer';

describe('buildActualReplacementPrompt', () => {
  it('requires the same logo replacement in every small image', () => {
    const prompt = buildActualReplacementPrompt(DEFAULT_LOGO_REPLACE_SETTINGS, true);

    expect(prompt).toContain('直接查看并判断输入画面中是否存在多个小图');
    expect(prompt).toContain('对模型判断出的每一个小图逐一、完整地执行');
    expect(prompt).toContain('所有小图都必须处理');
    expect(prompt).toContain('不得根据截图、拼贴、海报或详情页等预设类别');
    expect(prompt).toContain('防止多轮生成累积失真');
    expect(prompt).toContain('禁止磨皮、美颜、蜡像或塑料皮肤');
  });
  it('only appends the later smooth-band restriction for beer mugs', () => {
    const basePrompt = buildActualReplacementPrompt(DEFAULT_LOGO_REPLACE_SETTINGS, true);
    const beerPrompt = buildActualReplacementPrompt(DEFAULT_LOGO_REPLACE_SETTINGS, true, '', '', '本图为啤酒杯，替换杯身 Logo');
    expect(basePrompt).not.toContain('啤酒杯专项补充');
    expect(basePrompt).not.toContain('旧 Logo 定位遮罩锁定');
    expect(beerPrompt).toContain('啤酒杯专项补充');
    expect(beerPrompt).toContain('此补充不得应用于非啤酒杯载体');
  });
});
