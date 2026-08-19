import { describe, expect, it } from 'vitest';
import { isInsufficientImageChange, measureChangedPixels } from './imageChangeDetection';

function solid(count: number, value: number) { const data = new Uint8ClampedArray(count * 4); for (let index = 0; index < count; index += 1) data.set([value, value, value, 255], index * 4); return data; }

describe('scene image change detection', () => {
  it('reports unchanged pixels as zero change', () => { expect(measureChangedPixels(solid(10, 50), solid(10, 50)).changedRatio).toBe(0); });
  it('counts visibly changed pixels and supports the twenty percent boundary', () => {
    const original = solid(10, 50); const generated = solid(10, 50); for (let index = 0; index < 2; index += 1) generated.set([150, 150, 150, 255], index * 4);
    expect(measureChangedPixels(original, generated).changedRatio).toBeCloseTo(0.2);
    expect(isInsufficientImageChange(0.2)).toBe(true); expect(isInsufficientImageChange(0.201)).toBe(false);
  });
});
