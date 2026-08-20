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
  });
  it('freezes Logo negative space and keeps cup-bottom artwork inside a safe area', () => {
    const prompt = buildActualReplacementPrompt(DEFAULT_LOGO_REPLACE_SETTINGS, true);
    expect(prompt).toContain('新 Logo 图形拓扑冻结');
    expect(prompt).toContain('镂空区域必须继续显示下方载体材质');
    expect(prompt).toContain('杯底 Logo 专项安全区');
    expect(prompt).toContain('10%–15%');
  });
});
