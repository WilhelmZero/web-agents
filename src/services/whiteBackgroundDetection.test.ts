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
  it('detects a white product infographic with a colored title band', () => {
    const data = image(100, 100, [250, 250, 248]);
    for (let y = 0; y < 10; y += 1) for (let x = 0; x < 100; x += 1) data.set([105, 52, 27, 255], (y * 100 + x) * 4);
    for (let y = 18; y < 90; y += 1) for (let x = 30; x < 72; x += 1) data.set([75, 38, 22, 255], (y * 100 + x) * 4);

    const result = detectWhiteBackgroundPixels(data, 100, 100);
    expect(result.whiteRatio).toBeGreaterThan(0.45);
    expect(result.isWhiteBackground).toBe(true);
  });
  it('detects multiple large studio subjects that split the white canvas', () => {
    const data = image(100, 100, [250, 250, 250]);
    for (let y = 8; y < 96; y += 1) for (let x = 6; x < 45; x += 1) data.set([112, 52, 24, 255], (y * 100 + x) * 4);
    for (let y = 5; y < 96; y += 1) for (let x = 55; x < 94; x += 1) data.set([180, 92, 24, 255], (y * 100 + x) * 4);
    expect(detectWhiteBackgroundPixels(data, 100, 100).isWhiteBackground).toBe(true);
  });
  it('detects a dense product collage with white outer-edge channels', () => {
    const data = image(100, 100, [70, 40, 25]);
    for (let y = 52; y < 100; y += 1) for (let x = 0; x < 8; x += 1) data.set([250, 250, 250, 255], (y * 100 + x) * 4);
    for (let y = 45; y < 100; y += 1) for (let x = 92; x < 100; x += 1) data.set([250, 250, 250, 255], (y * 100 + x) * 4);
    for (let y = 92; y < 100; y += 1) for (let x = 0; x < 100; x += 1) data.set([250, 250, 250, 255], (y * 100 + x) * 4);
    expect(detectWhiteBackgroundPixels(data, 100, 100).isWhiteBackground).toBe(true);
  });
  it('does not treat a small isolated white edge patch as a studio canvas', () => {
    const data = image(100, 100, [70, 55, 45]);
    for (let y = 90; y < 100; y += 1) for (let x = 0; x < 20; x += 1) data.set([250, 250, 250, 255], (y * 100 + x) * 4);
    expect(detectWhiteBackgroundPixels(data, 100, 100).isWhiteBackground).toBe(false);
  });
});
