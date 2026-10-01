import { describe, expect, it } from 'vitest';
import type { Layer, Psd } from 'ag-psd';
import { inspectPsdSmartObjects } from './psdSmartObjectReplace';

const transform = [0, 0, 100, 0, 100, 50, 0, 50];

function smartLayer(name: string, overrides: Partial<Layer> = {}): Layer {
  return {
    name,
    placedLayer: { id: `${name}-file`, type: 'raster', transform, width: 100, height: 50 },
    ...overrides,
  };
}

function psd(children: Layer[], linkedFiles = children.flatMap((layer) => layer.placedLayer ? [{ id: layer.placedLayer.id, name: `${layer.name}.psd`, data: new Uint8Array([1]) }] : [])): Psd {
  return { width: 500, height: 300, children, linkedFiles };
}

describe('PSD smart object compatibility scan', () => {
  it('groups same-name smart objects into one logical logo slot', () => {
    const targets = inspectPsdSmartObjects(psd([smartLayer('LOGO_1'), smartLayer('LOGO_1')]), 'LOGO');
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ name: 'LOGO_1', instanceCount: 2, severity: 'supported', width: 100, height: 50 });
  });

  it('blocks linked, vector, warped and filtered smart objects', () => {
    const layer = smartLayer('LOGO_bad', {
      placedLayer: {
        id: 'missing', type: 'vector', transform, width: 100, height: 50,
        warp: { style: 'arc' }, filter: { enabled: true, validAtPosition: true, maskEnabled: false, maskLinked: false, maskExtendWithWhite: false, list: [{} as never] },
      },
    });
    const [target] = inspectPsdSmartObjects(psd([layer], []), 'LOGO');
    expect(target.severity).toBe('blocked');
    expect(target.reasons.join(' ')).toMatch(/外链|vector|Warp|智能滤镜/);
  });

  it('allows layer effects but marks browser preview as approximate', () => {
    const [target] = inspectPsdSmartObjects(psd([smartLayer('LOGO_fx', { effects: {} })]), 'LOGO');
    expect(target.severity).toBe('warning');
    expect(target.reasons.join(' ')).toContain('浏览器预览');
  });

  it('filters targets by prefix without changing case sensitivity', () => {
    const targets = inspectPsdSmartObjects(psd([smartLayer('logo_front'), smartLayer('ART')]), 'LOGO');
    expect(targets.map((target) => target.name)).toEqual(['logo_front']);
  });
});
