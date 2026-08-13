import { describe, expect, it } from 'vitest';
import { SCENE_MANUAL_DEFAULT_PROMPT } from './sceneThemeRecommendation';

describe('manual scene replacement default prompt', () => {
  it('contains cup usage mapping and preservation constraints', () => {
    expect(SCENE_MANUAL_DEFAULT_PROMPT).toContain('根据上传产品自动识别杯型与真实用途');
    expect(SCENE_MANUAL_DEFAULT_PROMPT).toContain('小烈酒杯匹配家庭吧台');
    expect(SCENE_MANUAL_DEFAULT_PROMPT).toContain('啤酒杯匹配酒吧、后院BBQ');
    expect(SCENE_MANUAL_DEFAULT_PROMPT).toContain('严格要求杯子的外形、轮廓、比例、结构、尺寸、朝向');
  });
});
