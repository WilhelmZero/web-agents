import { describe, expect, it } from 'vitest';
import { outputAspectRatio } from './logoOutputSizing';

describe('logo output sizing', () => {
  const ratios = ['1:1', '4:3', '3:4', '16:9', '21:9'];
  it('uses the closest supported ratio for the original scene', () => { expect(outputAspectRatio('original', 1600, 900, '1:1', 1, 1, ratios)).toBe('16:9'); });
  it('uses custom dimensions to choose a generation ratio', () => { expect(outputAspectRatio('custom', 1000, 1000, '1:1', 3200, 1310, ratios)).toBe('21:9'); });
  it('keeps an explicitly selected ratio', () => { expect(outputAspectRatio('fixed', 1600, 900, '3:4', 3200, 1310, ratios)).toBe('3:4'); });
});
