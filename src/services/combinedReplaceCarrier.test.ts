import { describe, expect, it } from 'vitest';
import { COMBINED_MANDATORY_RULES, isReplaceableLogoCarrier } from './combinedReplace';

describe('combined replacement logo scope', () => {
  it('only accepts cup and wooden-box carriers', () => {
    expect(isReplaceableLogoCarrier('玻璃杯杯身')).toBe(true);
    expect(isReplaceableLogoCarrier('高脚杯')).toBe(true);
    expect(isReplaceableLogoCarrier('木盒盖')).toBe(true);
    expect(isReplaceableLogoCarrier('人物衣服')).toBe(false);
    expect(isReplaceableLogoCarrier('纸质包装盒')).toBe(false);
    expect(isReplaceableLogoCarrier('背景招牌')).toBe(false);
  });
  it('forbids edits to logos outside eligible carriers', () => {
    expect(COMBINED_MANDATORY_RULES).toContain('只允许替换杯子和木盒');
    expect(COMBINED_MANDATORY_RULES).toContain('其他位置');
  });
});
