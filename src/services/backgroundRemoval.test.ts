import { describe, expect, it } from 'vitest';
import { buildBackgroundRemovalPrompt, DEFAULT_BACKGROUND_REMOVAL_PROMPT, detectSolidBorderColor } from './backgroundRemoval';

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
  it('detects the actual solid color from image borders', () => {
    const data = new Uint8ClampedArray(4 * 4 * 4);
    for (let index = 0; index < data.length; index += 4) { data[index] = 12; data[index + 1] = 245; data[index + 2] = 18; data[index + 3] = 255; }
    const detected = detectSolidBorderColor({ data, width: 4, height: 4 }, { r: 255, g: 0, b: 255 });
    expect(detected.color).toEqual({ r: 12, g: 245, b: 18 });
    expect(detected.confidence).toBe(1);
  });
  it('falls back when border colors are not sufficiently consistent', () => {
    const data = new Uint8ClampedArray(10 * 10 * 4);
    for (let index = 0; index < data.length; index += 4) { const pixel = index / 4; data[index] = pixel * 37 % 256; data[index + 1] = pixel * 71 % 256; data[index + 2] = pixel * 113 % 256; data[index + 3] = 255; }
    expect(detectSolidBorderColor({ data, width: 10, height: 10 }, { r: 255, g: 0, b: 255 }).color).toEqual({ r: 255, g: 0, b: 255 });
  });
});
