import { afterEach, expect, it } from 'vitest';
import { DEFAULT_CUP } from './geometry';
import { loadDesignSettings, saveDesignSettings } from './storage';
import type { WrapDesign } from './types';

afterEach(() => { localStorage.clear(); window.__studioServerKeys = undefined; });

it('retains cup parameters without restoring uploaded or generated images', async () => {
  window.__studioServerKeys = undefined;
  const image = new Blob(['pixels'], { type: 'image/png' });
  const design: WrapDesign = {
    id: 'cup-1', name: 'Small', cup: { ...DEFAULT_CUP, top: 80 },
    source: image, adopted: image, aiResults: [image], layers: [{ id: 'layer-1', blob: image, x: 0, y: 0, width: 10, rotation: 0, locked: false }],
    fit: 'contain', scale: 1, x: 0, y: 0, rotation: 0, quantity: 1, prompt: 'Keep stars',
  };
  await saveDesignSettings([design]);
  const restored = await loadDesignSettings();
  expect(restored).toHaveLength(1);
  expect(restored[0].cup.top).toBe(80);
  expect(restored[0].prompt).toBe('Keep stars');
  expect(restored[0].source).toBeUndefined();
  expect(restored[0].adopted).toBeUndefined();
  expect(restored[0].aiResults).toEqual([]);
  expect(restored[0].layers).toEqual([]);
});
