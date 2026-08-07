import { describe, expect, it } from 'vitest';
import { logoReplaceResultFileName } from './logoReplaceFileName';

describe('Logo replacement result filenames', () => {
  it('keeps the original scene basename for a single result', () => {
    expect(logoReplaceResultFileName('产品场景.jpg', 0, 1, 'image/png')).toBe('产品场景.png');
  });

  it('adds a one-based number when one scene has multiple results', () => {
    expect(logoReplaceResultFileName('产品场景.webp', 0, 3, 'image/jpeg')).toBe('产品场景_1.jpg');
    expect(logoReplaceResultFileName('产品场景.webp', 2, 3, 'image/jpeg')).toBe('产品场景_3.jpg');
  });
});
