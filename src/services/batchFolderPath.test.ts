import { describe, expect, it } from 'vitest';
import { sanitizeRelativeFolderPath } from './batchFolderPath';

describe('sanitizeRelativeFolderPath', () => {
  it('preserves every imported directory level', () => { expect(sanitizeRelativeFolderPath('测试图片/AM059/AM059-主图', 'AM059')).toBe('测试图片/AM059/AM059-主图'); });
  it('normalizes Windows separators', () => { expect(sanitizeRelativeFolderPath('root\\child\\leaf', 'leaf')).toBe('root/child/leaf'); });
});
