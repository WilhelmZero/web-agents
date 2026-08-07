import { describe, expect, it } from 'vitest';
import { buildBackgroundRemovalPrompt, DEFAULT_BACKGROUND_REMOVAL_PROMPT } from './backgroundRemoval';

describe('background removal prompt', () => {
  it('keeps the editable prompt and adds an exact solid matte requirement', () => {
    const prompt = buildBackgroundRemovalPrompt('保留玻璃杯', { r: 255, g: 0, b: 255 });
    expect(prompt).toContain('保留玻璃杯');
    expect(prompt).toContain('#FF00FF');
    expect(prompt).toContain('不得出现棋盘格');
  });
  it('ships with a subject-preserving default', () => {
    expect(DEFAULT_BACKGROUND_REMOVAL_PROMPT).toContain('不要重绘或改变主体');
  });
});
