import { describe, expect, it } from 'vitest';
import { formatBatchDuration } from './batchTiming';

describe('formatBatchDuration', () => {
  it('formats seconds, minutes and hours', () => {
    expect(formatBatchDuration(9_900)).toBe('9秒');
    expect(formatBatchDuration(125_000)).toBe('2分 5秒');
    expect(formatBatchDuration(3_665_000)).toBe('1小时 1分 5秒');
  });
});
