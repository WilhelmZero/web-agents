import { describe, expect, it } from 'vitest';
import { buildPaperTextEditPrompt, normalizePaperTextRegions, supportsOpenAiInputFidelity } from './paperText';

describe('paper text helpers', () => {
  it('filters malformed regions and clamps percentage boxes', () => {
    expect(normalizePaperTextRegions({ regions: [
      { text: 'Hello', box: [-5, 10, 120, 30] },
      { text: '', box: [1, 2, 3, 4] },
      { text: 'bad', box: [1, 2] },
    ] })).toEqual([{ original: 'Hello', text: 'Hello', box: [0, 10, 100, 30] }]);
  });

  it('only includes changed text and preserves strict editing rules', () => {
    const prompt = buildPaperTextEditPrompt([
      { original: 'OLD', text: 'NEW', box: [10, 20, 30, 40] },
      { original: 'SAME', text: 'SAME', box: [0, 0, 10, 10] },
    ]);
    expect(prompt).toContain('将“OLD”准确替换为“NEW”');
    expect(prompt).not.toContain('“SAME”');
    expect(prompt).toContain('除指定文字外');
  });

  it('omits input fidelity for GPT Image 2 models', () => {
    expect(supportsOpenAiInputFidelity('gpt-image-2')).toBe(false);
    expect(supportsOpenAiInputFidelity('gpt-image-2-2026-04-21')).toBe(false);
    expect(supportsOpenAiInputFidelity('gpt-image-1.5')).toBe(true);
  });
});
