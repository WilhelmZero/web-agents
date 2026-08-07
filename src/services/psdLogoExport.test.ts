import { describe, expect, it } from 'vitest';
import { safePsdLayerName } from './psdLogoExport';

describe('PSD logo export helpers', () => {
  it('sanitizes invalid filename characters', () => expect(safePsdLayerName('A/B:Logo*')).toBe('A_B_Logo_'));
  it('uses a fallback for empty names', () => expect(safePsdLayerName('   ')).toBe('layer'));
});
