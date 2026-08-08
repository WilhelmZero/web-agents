import { describe, expect, it } from 'vitest';
import { calculateUpscaleSize } from './imageUpscale';

describe('high-resolution output sizing', () => {
  it('creates a true 2x output within safe limits', () => {
    expect(calculateUpscaleSize(1024, 1536, 2)).toEqual({ width: 2048, height: 3072 });
  });

  it('preserves aspect ratio while limiting oversized output', () => {
    const output = calculateUpscaleSize(4000, 3000, 4);
    expect(Math.max(output.width, output.height)).toBeLessThanOrEqual(8192);
    expect(output.width / output.height).toBeCloseTo(4 / 3, 2);
    expect(output.width * output.height).toBeLessThanOrEqual(48_000_000);
  });
});
