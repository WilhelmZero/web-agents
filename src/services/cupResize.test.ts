import { describe, expect, it } from 'vitest';
import { CUP_RESIZE_PROMPT, cropCanvasDimensions, inferBorderColor, rgbToHex } from './cupResize';

describe('cup resize image helpers', () => {
  it('infers the average opaque border color', () => {
    const data = new Uint8ClampedArray(3 * 3 * 4);
    for (let index = 0; index < data.length; index += 4) {
      data[index] = 240; data[index + 1] = 245; data[index + 2] = 250; data[index + 3] = 255;
    }
    expect(rgbToHex(inferBorderColor({ data, width: 3, height: 3, colorSpace: 'srgb' } as ImageData))).toBe('#f0f5fa');
  });

  it('supports both crop and enlarged canvases', () => {
    expect(cropCanvasDimensions(1000, 800, 0.5)).toEqual({ width: 500, height: 400 });
    expect(cropCanvasDimensions(1000, 800, 1.5)).toEqual({ width: 1500, height: 1200 });
  });

  it('separates the painted cleanup area from the requested cup dimensions', () => {
    expect(CUP_RESIZE_PROMPT).toContain('它不是新杯子的边界、遮罩或尺寸提示');
    expect(CUP_RESIZE_PROMPT).toContain('像素包围框宽高和中心坐标保持一致');
  });
});
