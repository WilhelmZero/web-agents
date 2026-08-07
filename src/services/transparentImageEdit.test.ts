import { describe, expect, it } from 'vitest';
import { chooseChromaMatte, hasTransparentPixels, removeChromaFromPixels } from './transparentImageEdit';

describe('transparent image editing helpers', () => {
  it('detects alpha transparency', () => {
    expect(hasTransparentPixels(new Uint8ClampedArray([0, 0, 0, 255, 1, 2, 3, 254]))).toBe(true);
    expect(hasTransparentPixels(new Uint8ClampedArray([0, 0, 0, 255]))).toBe(false);
  });
  it('chooses a matte away from artwork colors', () => {
    expect(chooseChromaMatte(new Uint8ClampedArray([255, 0, 255, 255, 250, 5, 250, 255]))).not.toEqual({ r: 255, g: 0, b: 255 });
  });
  it('restores matte pixels while preserving foreground', () => {
    const restored = removeChromaFromPixels(new Uint8ClampedArray([255, 0, 255, 255, 0, 0, 0, 255]), { r: 255, g: 0, b: 255 });
    expect([...restored.slice(0, 4)]).toEqual([0, 0, 0, 0]);
    expect([...restored.slice(4, 8)]).toEqual([0, 0, 0, 255]);
  });
});
