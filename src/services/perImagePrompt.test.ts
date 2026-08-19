import { describe, expect, it } from 'vitest';
import { analyzePerImagePromptWithRetry, assignmentNeedsAnalysis, buildPerImageAnalysisPrompt, parsePerImagePromptResult, shouldAnalyzePerImagePromptsInController } from './perImagePrompt';

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
  it('retries prompt analysis with the configured image retry policy', async () => {
    let attempts = 0; const waits: number[] = [];
    const result = await analyzePerImagePromptWithRetry(async () => { attempts += 1; if (attempts < 3) throw new Error('busy'); return 'ready'; }, { enabled: true, retryLimit: 3, delaySeconds: 5 }, async (milliseconds) => { waits.push(milliseconds); });
    expect(result).toBe('ready'); expect(attempts).toBe(3); expect(waits).toEqual([5000, 5000]);
  });
  it('does not retry prompt analysis when automatic retries are disabled', async () => {
    let attempts = 0;
    await expect(analyzePerImagePromptWithRetry(async () => { attempts += 1; throw new Error('failed'); }, { enabled: false, retryLimit: 3, delaySeconds: 5 }, async () => undefined)).rejects.toThrow('failed');
    expect(attempts).toBe(1);
  });
});
