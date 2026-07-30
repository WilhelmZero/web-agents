import { beforeEach, describe, expect, it } from 'vitest';
import { readLocalStorage } from './storage';

describe('readLocalStorage', () => {
  beforeEach(() => localStorage.clear());

  it('保持已保存数组为数组', () => {
    localStorage.setItem('presets', JSON.stringify([{ id: '1' }]));
    expect(readLocalStorage('presets', [])).toEqual([{ id: '1' }]);
  });

  it('旧的错误对象数据会回退为空数组', () => {
    localStorage.setItem('presets', JSON.stringify({ 0: { id: '1' } }));
    expect(readLocalStorage('presets', [])).toEqual([]);
  });

  it('对象设置与默认值合并', () => {
    localStorage.setItem('settings', JSON.stringify({ concurrency: 5 }));
    expect(readLocalStorage('settings', { concurrency: 3, model: 'default' })).toEqual({
      concurrency: 5,
      model: 'default',
    });
  });
});
