import { describe, expect, it } from 'vitest';
import { formatImageRatio } from './ImageInfoTooltip';

describe('formatImageRatio', () => {
  it('保留常见的精确画面比例', () => {
    expect(formatImageRatio(1920, 1080)).toBe('16:9');
    expect(formatImageRatio(1800, 1350)).toBe('4:3');
  });

  it('把不规则尺寸显示为易读的小数比例', () => {
    expect(formatImageRatio(3200, 1310)).toBe('2.44:1');
    expect(formatImageRatio(1000, 1501)).toBe('1:1.50');
  });
});
