import { describe, expect, it } from 'vitest';
import { defaultPsdLogoLayerIds, safePsdLayerName } from './psdLogoExport';

describe('PSD logo export helpers', () => {
  it('sanitizes invalid filename characters', () => expect(safePsdLayerName('A/B:Logo*')).toBe('A_B_Logo_'));
  it('uses a fallback for empty names', () => expect(safePsdLayerName('   ')).toBe('layer'));
  it('selects every PSD logo layer except layers named 背景 by default', () => {
    expect([...defaultPsdLogoLayerIds([{ id: 'logo', name: 'Logo' }, { id: 'background', name: '背景' }, { id: 'hidden', name: '隐藏 Logo' }])]).toEqual(['logo', 'hidden']);
  });
});
