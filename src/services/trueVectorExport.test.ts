import { describe, expect, it } from 'vitest';
import { analyzeVectorEligibility, extractColorPreservingPalette, preserveVectorOutputSize } from './trueVectorExport';

describe('true vector export eligibility', () => {
  it('accepts simple two-color artwork', () => {
    const data = new Uint8ClampedArray([
      0, 0, 0, 255, 255, 255, 255, 255,
      0, 0, 0, 255, 255, 255, 255, 255,
    ]);
    expect(analyzeVectorEligibility({ data, width: 2, height: 2 })).toMatchObject({ eligible: true, colorBins: 2 });
  });

  it('rejects artwork with too many quantized colors for automatic tracing', () => {
    const values: number[] = [];
    for (let index = 0; index < 20; index += 1) values.push((index % 8) * 32, (Math.floor(index / 8) % 8) * 32, (index * 3 % 8) * 32, 255);
    expect(analyzeVectorEligibility({ data: new Uint8ClampedArray(values), width: 20, height: 1 }).eligible).toBe(false);
  });

  it('adds original output dimensions to a viewBox-only traced SVG', () => {
    expect(preserveVectorOutputSize('<svg viewBox="0 0 800 800"><path d="M0 0"/></svg>', 1000, 1000))
      .toContain('<svg width="1000" height="1000" viewBox="0 0 800 800"');
  });

  it('builds the trace palette from exact source colors including transparency', () => {
    const data = new Uint8ClampedArray([
      237, 96, 151, 255, 237, 96, 151, 255,
      15, 12, 18, 255, 0, 0, 0, 0,
    ]);
    const palette = extractColorPreservingPalette({ data, width: 2, height: 2 }, 8);
    expect(palette).toContainEqual({ r: 237, g: 96, b: 151, a: 255 });
    expect(palette).toContainEqual({ r: 15, g: 12, b: 18, a: 255 });
    expect(palette).toContainEqual({ r: 0, g: 0, b: 0, a: 0 });
  });
});
