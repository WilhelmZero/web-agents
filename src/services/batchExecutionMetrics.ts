import { PRICING } from '../constants';
import type { ImageModel, ImageSize } from '../types';
import { estimateGptImage2HighOutputCostRange } from '../utils';

export interface BatchCostRange { min: number; max: number }

export function imageRequestCostRange(model: string, size: ImageSize, count = 1): BatchCostRange {
  if (model.startsWith('gpt-image')) return estimateGptImage2HighOutputCostRange(count);
  const pricing = PRICING.models[model as ImageModel];
  if (!pricing) return { min: 0, max: 0 };
  const unit = (pricing.outputBySize[size] ?? pricing.outputBySize['1K'] ?? 0) + pricing.inputImage;
  return { min: unit * count, max: unit * count };
}

export function batchCostMetrics(options: {
  model: string;
  size: ImageSize;
  plannedRequests: number;
  worstCaseMultiplier: number;
  actualRequests: number;
  extraActualCost?: number;
}) {
  const planned = imageRequestCostRange(options.model, options.size, options.plannedRequests);
  const actual = imageRequestCostRange(options.model, options.size, options.actualRequests);
  return {
    estimatedMinimum: planned.min,
    estimatedWorst: planned.max * Math.max(1, options.worstCaseMultiplier),
    actual: actual.max + (options.extraActualCost || 0),
  };
}

export function percentage(numerator: number, denominator: number) {
  return denominator > 0 ? Number(((numerator / denominator) * 100).toFixed(1)) : 0;
}

export function formatBatchDateTime(value?: number) {
  return value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'medium', hour12: false }).format(value) : '—';
}
