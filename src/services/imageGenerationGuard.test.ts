import { describe, expect, it } from 'vitest';
import { appendImageGenerationGuard, IMAGE_GENERATION_FIDELITY_GUARD } from './imageGenerationGuard';

describe('image generation fidelity guard', () => {
  it('blocks cumulative red casts and artificial skin rendering without removing the requested edit', () => {
    const prompt = appendImageGenerationGuard('替换为家庭酒吧场景');
    expect(prompt).toContain('替换为家庭酒吧场景');
    expect(prompt).toContain('不得新增或加强全局红色、橙色、洋红色偏色');
    expect(prompt).toContain('可以保留原图真实存在的局部暖光');
    expect(prompt).toContain('禁止磨皮、美颜、蜡像或塑料皮肤');
    expect(prompt).toContain('3D 渲染、CGI、卡通、插画');
    expect(prompt).toContain('不得把上一轮已有的生成痕迹再次风格化');
  });

  it('is idempotent when a composed prompt is passed through multiple generation layers', () => {
    const once = appendImageGenerationGuard('局部重绘');
    const twice = appendImageGenerationGuard(once);
    expect(twice).toBe(once);
    expect(twice.split('【防止多轮生成累积失真（最高优先级）】')).toHaveLength(2);
    expect(IMAGE_GENERATION_FIDELITY_GUARD).toContain('未编辑区域保持原样');
  });
});
