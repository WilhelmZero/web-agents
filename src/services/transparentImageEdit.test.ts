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

  it('uses an HSV range to remove naturally varied blue background pixels', () => {
    const restored = removeChromaFromPixels(new Uint8ClampedArray([
      30, 144, 241, 255,
      23, 147, 248, 255,
      18, 18, 24, 255,
    ]), { r: 30, g: 144, b: 241 });
    expect(restored[3]).toBeLessThan(20);
    expect(restored[7]).toBeLessThan(20);
    expect(restored[11]).toBe(255);
  });

  it('keeps low-saturation detail even when its hue is close to the matte', () => {
    const restored = removeChromaFromPixels(new Uint8ClampedArray([110, 120, 130, 255]), { r: 30, g: 144, b: 241 });
    expect(restored[3]).toBe(255);
  });
});
