import { describe, expect, it } from 'vitest';
import { readCreationTool, setCreationToolInUrl } from './creationToolUrl';

describe('creation tool URL helpers', () => {
  it('reads a valid tool from the address query', () => {
    expect(readCreationTool('?tool=paper-text')).toBe('paper-text');
    expect(readCreationTool('?foo=1&tool=logo-export')).toBe('logo-export');
    expect(readCreationTool('?tool=background-removal')).toBe('background-removal');
    expect(readCreationTool('?tool=outpaint')).toBe('outpaint');
    expect(readCreationTool('?tool=cup-resize')).toBe('cup-resize');
  });

  it('falls back for missing or invalid tools', () => {
    expect(readCreationTool('')).toBe('scene');
    expect(readCreationTool('?tool=unknown', 'logo')).toBe('logo');
  });

  it('updates the tool while preserving other query parameters and the hash', () => {
    expect(setCreationToolInUrl('https://example.com/app?foo=1#result', 'inpaint'))
      .toBe('/app?foo=1&tool=inpaint#result');
  });
});
