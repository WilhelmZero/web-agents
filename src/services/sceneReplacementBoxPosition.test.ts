import { describe, expect, it } from 'vitest';
import { buildPerImageAnalysisPrompt } from './perImagePrompt';
import { buildSceneReplacementPrompt } from './sceneReplacementPrompt';

describe('scene replacement wooden box position protection', () => {
  it('adds an explicit highest-priority box position lock to generation prompts', () => {
    const prompt = buildSceneReplacementPrompt('改为家庭酒吧主题');
    expect(prompt).toContain('木盒位置最高优先级锁定');
    expect(prompt).toContain('木盒位置不要改变');
    expect(prompt).toContain('左、上坐标、中心点、边界');
  });

  it('requires per-image analysis to preserve the wooden box position', () => {
    const prompt = buildPerImageAnalysisPrompt('scene-replace', '改为家庭酒吧主题');
    expect(prompt).toContain('木盒位置不要改变');
    expect(prompt).toContain('坐标、边界、大小、透视、朝向、前后层级');
  });
});
