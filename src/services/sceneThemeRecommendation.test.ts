import { describe, expect, it } from 'vitest';
import {
  buildSceneThemeRecommendationPrompt,
  cleanRecommendedTheme,
  CUP_SCENE_RULES,
  SCENE_COMMON_CONSTRAINT,
  SCENE_MANUAL_DEFAULT_PROMPT,
} from './sceneThemeRecommendation';

describe('scene theme recommendation', () => {
  it('keeps the mandatory common constraint cup-safe', () => {
    expect(SCENE_COMMON_CONSTRAINT).toContain('杯子的外形');
    expect(SCENE_COMMON_CONSTRAINT).toContain('人物手势不变');
  });

  it('contains every requested cup-to-lifestyle mapping and excludes festivals and sports events', () => {
    const prompt = buildSceneThemeRecommendationPrompt();
    CUP_SCENE_RULES.forEach((rule) => expect(prompt).toContain(rule));
    expect(prompt).toContain('严禁推荐圣诞节');
    expect(prompt).toContain('禁止世界杯');
    expect(prompt).toContain('体育观赛');
    expect(prompt).toContain('真实杯型和主要用途');
  });

  it('normalizes the result to a single short replacement theme', () => {
    expect(cleanRecommendedTheme('改为家庭吧台品鉴主题。原因如下')).toBe('替换为家庭吧台品鉴主题');
  });

  it('contains cup usage mapping and preservation constraints', () => {
    expect(SCENE_MANUAL_DEFAULT_PROMPT).toContain('根据上传产品自动识别杯型与真实用途');
    expect(SCENE_MANUAL_DEFAULT_PROMPT).toContain('小烈酒杯匹配家庭吧台');
    expect(SCENE_MANUAL_DEFAULT_PROMPT).toContain('啤酒杯匹配酒吧、后院BBQ');
    expect(SCENE_MANUAL_DEFAULT_PROMPT).toContain('严格要求杯子的外形、轮廓、比例、结构、尺寸、朝向');
  });
});
