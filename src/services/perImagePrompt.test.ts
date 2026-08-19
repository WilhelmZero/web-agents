import { describe, expect, it } from 'vitest';
import { assignmentNeedsAnalysis, buildPerImageAnalysisPrompt, parsePerImagePromptResult, shouldAnalyzePerImagePromptsInController } from './perImagePrompt';

describe('per image prompt assignment', () => {
  it('parses fenced JSON without relying on additional properties', () => {
    expect(parsePerImagePromptResult('```json\n{"summary":"木盒和杯子","applicableConditions":["木盒雕刻"],"prompt":"仅替换杯身原 Logo"}\n```')).toEqual({ summary: '木盒和杯子', applicableConditions: ['木盒雕刻'], prompt: '仅替换杯身原 Logo' });
  });
  it('invalidates assignments when the public prompt changes', () => {
    expect(assignmentNeedsAnalysis({ fileKey: 'a', tool: 'scene-replace', summary: 'a', applicableConditions: [], prompt: 'x', sourcePrompt: 'old', status: 'ready', updatedAt: 1 }, 'new')).toBe(true);
  });
  it('keeps mandatory rules outside the language model allocation prompt', () => {
    expect(buildPerImageAnalysisPrompt('logo-replace', '木盒用深色雕刻，玻璃用白色')).toContain('系统会在后面统一追加');
  });
  it('delegates automatic prompt analysis to worker tabs', () => {
    expect(shouldAnalyzePerImagePromptsInController(true, true)).toBe(false);
    expect(shouldAnalyzePerImagePromptsInController(true, false)).toBe(true);
    expect(shouldAnalyzePerImagePromptsInController(false, false)).toBe(false);
  });
  it('forces scene analysis to classify table-only compositions and forbid generated bottles', () => {
    const prompt = buildPerImageAnalysisPrompt('scene-replace', '替换为家庭酒吧主题');
    expect(prompt).toContain('纯桌面构图，无可编辑纵深背景');
    expect(prompt).toContain('禁止新增墙面、酒吧、酒柜、货架、房间');
    expect(prompt).toContain('禁止新增任何背景酒瓶、酒类包装');
  });
});
