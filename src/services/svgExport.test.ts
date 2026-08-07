import { describe, expect, it } from 'vitest';
import { buildEmbeddedImageSvg } from './svgExport';

describe('SVG export', () => {
  it('preserves image dimensions and embeds the source data', () => {
    const svg = buildEmbeddedImageSvg('data:image/png;base64,abc', 1200.4, 800.2, 'A&B <result>');
    expect(svg).toContain('viewBox="0 0 1200 800"');
    expect(svg).toContain('width="1200" height="800"');
    expect(svg).toContain('data:image/png;base64,abc');
    expect(svg).toContain('<title>A&amp;B &lt;result&gt;</title>');
  });
});
