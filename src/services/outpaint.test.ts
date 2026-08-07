import { describe, expect, it } from 'vitest';
import { buildOutpaintPrompt, calculateExpansionPlacement, closestAspectRatio } from './outpaint';

describe('outpaint helpers', () => {
  it('contains the whole source and centers it in a wide target', () => {
    expect(calculateExpansionPlacement(1000, 1000, 3200, 1310)).toEqual({ x: 945, y: 0, width: 1310, height: 1310 });
  });
  it('selects the closest model ratio', () => {
    expect(closestAspectRatio(3200, 1310, ['1:1', '16:9', '21:9'])).toBe('21:9');
    expect(closestAspectRatio(1800, 1350, ['1:1', '4:3', '16:9'])).toBe('4:3');
  });
  it('requires preserving the complete original', () => {
    const prompt = buildOutpaintPrompt('自然补全背景', 3200, 1310);
    expect(prompt).toContain('完整保留'); expect(prompt).toContain('不得裁切');
  });
});
