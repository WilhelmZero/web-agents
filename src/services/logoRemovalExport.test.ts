import { describe, expect, it } from 'vitest';
import { firstLogoRemovalResultPerSource, logoRemovalExportPath } from './logoRemovalExport';

describe('Logo removal export', () => {
  it('preserves the imported folder structure and original file name', () => {
    expect(logoRemovalExportPath('产品图/玻璃杯/正面 01.jpg', '正面 01.jpg', '产品图/玻璃杯')).toBe('产品图/玻璃杯/正面 01.jpg');
    expect(logoRemovalExportPath('未分组/单图.png', '单图.png', '未分组')).toBe('单图.png');
  });

  it('exports only the first successful copy for each original path', () => {
    const tasks = [
      { sourceRelativePath: 'A/one.png', sourceName: 'one.png', copyIndex: 2, resultKey: 'copy-2' },
      { sourceRelativePath: 'A/one.png', sourceName: 'one.png', copyIndex: 0, resultKey: 'copy-0' },
      { sourceRelativePath: 'A/two.png', sourceName: 'two.png', copyIndex: 0, resultKey: 'two' },
    ];
    expect(firstLogoRemovalResultPerSource(tasks).map((task) => task.resultKey)).toEqual(['copy-0', 'two']);
  });
});
