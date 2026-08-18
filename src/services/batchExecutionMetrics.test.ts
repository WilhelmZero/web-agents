import { describe, expect, it } from 'vitest';
import { batchCostMetrics, imageRequestCostRange, percentage } from './batchExecutionMetrics';

describe('batch execution metrics', () => {
  it('calculates GPT ranges and worst-case retries', () => {
    expect(batchCostMetrics({ model: 'gpt-image-2', size: '1K', plannedRequests: 2, worstCaseMultiplier: 3, actualRequests: 3 })).toEqual({ estimatedMinimum: 0.33, estimatedWorst: 1.266, actual: 0.633 });
  });
  it('uses catalog prices for Gemini and safe percentages', () => {
    expect(imageRequestCostRange('gemini-3.1-flash-image', '1K', 2).max).toBeCloseTo(0.1352);
    expect(percentage(3, 4)).toBe(75);
    expect(percentage(0, 0)).toBe(0);
  });
});
