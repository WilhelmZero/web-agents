import { describe, expect, it } from 'vitest';
import { SCENE_COMMON_CONSTRAINT } from './sceneThemeRecommendation';
describe('scene theme recommendation', () => { it('keeps the mandatory common constraint non-festive and cup-safe', () => { expect(SCENE_COMMON_CONSTRAINT).toContain('杯子的外形'); expect(SCENE_COMMON_CONSTRAINT).toContain('人物手势不变'); expect(SCENE_COMMON_CONSTRAINT).not.toContain('节日'); }); });
