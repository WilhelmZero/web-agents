import { describe, expect, it } from 'vitest';
import { analyzePerImagePromptWithRetry, assignmentNeedsAnalysis, buildPerImageAnalysisPrompt, parsePerImagePromptResult, shouldAnalyzePerImagePromptsInController } from './perImagePrompt';

describe('per image prompt assignment', () => {
  it('parses fenced JSON without relying on additional properties', () => {
    expect(parsePerImagePromptResult('```json\n{"summary":"木盒和杯子","applicableConditions":["木盒雕刻"],"prompt":"仅替换杯身原 Logo"}\n```')).toEqual({ summary: '木盒和杯子', applicableConditions: ['木盒雕刻'], prompt: '仅替换杯身原 Logo', constraints: '', action: 'replace', actionReason: '' });
  });
  it('parses a no-logo decision so the image model can be skipped', () => {
    expect(parsePerImagePromptResult('{"summary":"无标识玻璃杯","applicableConditions":[],"prompt":"保持原图不变，不执行 Logo 替换","constraints":"","action":"skip-no-logo","actionReason":"杯子与木盒均无可替换 Logo"}')).toMatchObject({ action: 'skip-no-logo', actionReason: '杯子与木盒均无可替换 Logo' });
  });
  it('invalidates assignments when the public prompt changes', () => {
    expect(assignmentNeedsAnalysis({ fileKey: 'a', tool: 'scene-replace', summary: 'a', applicableConditions: [], prompt: 'x', sourcePrompt: 'old', status: 'ready', updatedAt: 1 }, 'new')).toBe(true);
  });
  it('keeps mandatory rules outside the language model allocation prompt', () => {
    const prompt = buildPerImageAnalysisPrompt('logo-replace', '木盒用深色雕刻，玻璃用白色');
    expect(prompt).toContain('constraints 返回空字符串');
    expect(prompt).toContain('skip-no-logo');
    expect(prompt).toContain('skip-gift-scene');
    expect(prompt).toContain('整图保持原样');
  });
  it('delegates automatic prompt analysis to worker tabs', () => {
    expect(shouldAnalyzePerImagePromptsInController(true, true)).toBe(false);
    expect(shouldAnalyzePerImagePromptsInController(true, false)).toBe(true);
    expect(shouldAnalyzePerImagePromptsInController(false, false)).toBe(false);
  });
  it('forces scene analysis to classify table-only compositions and forbid generated bottles', () => {
    const prompt = buildPerImageAnalysisPrompt('scene-replace', '替换为家庭酒吧主题\n[逐图分析需同时精简通用强制限制]');
    expect(prompt).toContain('纯桌面构图，无可编辑纵深背景');
    expect(prompt).toContain('禁止新增墙面、酒吧、酒柜、货架、房间');
    expect(prompt).toContain('禁止新增任何背景酒瓶、酒类包装');
    expect(prompt).toContain('人物完整保留，禁止删除人物后只留下手或手臂');
  });
  it('only includes the full constraint catalog when simplification is enabled', () => {
    expect(buildPerImageAnalysisPrompt('scene-replace', '替换为家庭酒吧主题')).not.toContain('通用强制限制词库');
    expect(buildPerImageAnalysisPrompt('scene-replace', '替换为家庭酒吧主题\n[逐图分析需同时精简通用强制限制]')).toContain('没有木盒/礼盒就删除全部盒子规则');
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
