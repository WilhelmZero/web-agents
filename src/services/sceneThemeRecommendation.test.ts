import { describe, expect, it } from 'vitest';
import { buildSceneThemeRecommendationPrompt, cleanRecommendedTheme, CUP_SCENE_RULES, SCENE_COMMON_CONSTRAINT } from './sceneThemeRecommendation';

describe('scene theme recommendation', () => {
  it('keeps the mandatory common constraint cup-safe', () => { expect(SCENE_COMMON_CONSTRAINT).toContain('杯子的外形'); expect(SCENE_COMMON_CONSTRAINT).toContain('人物手势不变'); });
  it('contains every requested cup-to-lifestyle mapping and excludes festivals and sports events', () => { const prompt = buildSceneThemeRecommendationPrompt(); CUP_SCENE_RULES.forEach((rule) => expect(prompt).toContain(rule)); expect(prompt).toContain('严禁推荐圣诞节'); expect(prompt).toContain('禁止世界杯'); expect(prompt).toContain('体育观赛'); expect(prompt).toContain('真实杯型和主要用途'); });
  it('normalizes the result to a single short replacement theme', () => { expect(cleanRecommendedTheme('改为家庭吧台品鉴主题。原因如下')).toBe('替换为家庭吧台品鉴主题'); });
});
