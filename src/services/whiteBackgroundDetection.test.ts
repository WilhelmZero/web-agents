import { describe, expect, it } from 'vitest';
import { detectWhiteBackgroundPixels } from './whiteBackgroundDetection';

function image(width: number, height: number, background: [number, number, number], subject?: { x1: number; y1: number; x2: number; y2: number }) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) { const inside = subject && x >= subject.x1 && x <= subject.x2 && y >= subject.y1 && y <= subject.y2; const color = inside ? [90, 35, 20] : background; const offset = (y * width + x) * 4; data.set([...color, 255], offset); }
  return data;
}
describe('white background detection', () => {
  it('detects a product surrounded by connected white canvas', () => { expect(detectWhiteBackgroundPixels(image(100, 100, [250, 250, 248], { x1: 25, y1: 12, x2: 74, y2: 87 }), 100, 100).isWhiteBackground).toBe(true); });
  it('does not classify a light colored scene as white background', () => { expect(detectWhiteBackgroundPixels(image(100, 100, [218, 205, 188], { x1: 25, y1: 20, x2: 74, y2: 80 }), 100, 100).isWhiteBackground).toBe(false); });
  it('requires a large edge-connected white region', () => { expect(detectWhiteBackgroundPixels(image(100, 100, [40, 40, 40], { x1: 25, y1: 25, x2: 74, y2: 74 }), 100, 100).isWhiteBackground).toBe(false); });
});
