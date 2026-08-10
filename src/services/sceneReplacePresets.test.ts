import { describe, expect, it } from 'vitest';
import { BUILT_IN_SCENE_REPLACE_PRESETS, normalizeCustomScenePresets, sceneThemePrompt } from './sceneReplacePresets';

describe('scene replacement presets', () => {
  it('uses the relaxed editable template for every built-in preset', () => {
    expect(BUILT_IN_SCENE_REPLACE_PRESETS).toHaveLength(16);
    BUILT_IN_SCENE_REPLACE_PRESETS.forEach((preset) => {
      expect(preset.content).toBe(sceneThemePrompt(preset.name));
      expect(preset.content).toContain('杯子的外形、轮廓、比例、结构、尺寸、朝向及在图中的位置完全不变');
      expect(preset.content).toContain('禁止拉伸、压缩、弯曲、重塑或改变杯口、杯身、杯底');
    });
  });
  it('drops malformed custom presets', () => {
    expect(normalizeCustomScenePresets([{ id: '1', icon: '🌊', name: ' 海边 ', content: ' 改为海边 ' }, { id: '2' }]))
      .toEqual([{ id: '1', icon: '🌊', name: '海边', content: '改为海边' }]);
  });
});
