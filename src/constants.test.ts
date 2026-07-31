import { describe, expect, it } from 'vitest';
import { localizeBuiltInLogoPresets, localizeBuiltInScenePresets } from './constants';

describe('内置预设本地化', () => {
  it('英文场景预设的名称和提示词不包含中文', () => {
    const presets = localizeBuiltInScenePresets('en-US');
    expect(presets).toHaveLength(4);
    presets.forEach((preset) => {
      expect(`${preset.name}${preset.content}`).not.toMatch(/[\u3400-\u9fff]/);
    });
  });

  it('英文 Logo 预设的名称和提示词不包含中文', () => {
    const presets = localizeBuiltInLogoPresets('en-US');
    expect(presets).toHaveLength(3);
    presets.forEach((preset) => {
      expect(`${preset.name}${preset.content}`).not.toMatch(/[\u3400-\u9fff]/);
    });
  });
});
