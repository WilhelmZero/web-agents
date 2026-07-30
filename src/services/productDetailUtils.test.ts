import { describe, expect, it } from 'vitest';
import { extractOverlayTexts, replaceOverlayText } from './productDetailUtils';

describe('商品详情页文案同步', () => {
  it('提取中英文双引号中的上图文字并去重', () => {
    expect(extractOverlayTexts('显示“耐热玻璃”和"轻松清洁"，再次显示“耐热玻璃”'))
      .toEqual(['耐热玻璃', '轻松清洁']);
  });

  it('修改独立文案时同步替换完整提示词', () => {
    expect(replaceOverlayText('标题显示“耐热玻璃”', '耐热玻璃', '高硼硅玻璃'))
      .toBe('标题显示“高硼硅玻璃”');
  });

  it('原文中缺少对应引号时追加上图文字约束', () => {
    expect(replaceOverlayText('产品主视觉。', '旧文字', '新品上市')).toContain('“新品上市”');
  });
});
