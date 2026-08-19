import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_GEMINI_CAPACITY_SETTINGS, geminiCapacityWaitMs, isGeminiCapacityError, registerGeminiCapacityFailure, registerGeminiCapacitySuccess, saveGeminiCapacitySettings } from './geminiCapacity';

describe('Gemini 容量保护', () => {
  beforeEach(() => { localStorage.clear(); vi.spyOn(Math, 'random').mockReturnValue(0); });

  it('识别服务端容量错误', () => {
    expect(isGeminiCapacityError(503, 'This model is currently experiencing high demand')).toBe(true);
    expect(isGeminiCapacityError(429, 'MODEL_CAPACITY_EXHAUSTED')).toBe(true);
    expect(isGeminiCapacityError(400, 'bad request')).toBe(false);
  });

  it('连续失败时指数延长所有标签共享的等待时间', () => {
    saveGeminiCapacitySettings({ ...DEFAULT_GEMINI_CAPACITY_SETTINGS, baseDelaySeconds: 10, maxDelaySeconds: 60 });
    expect(registerGeminiCapacityFailure()).toBeGreaterThanOrEqual(9_900);
    expect(registerGeminiCapacityFailure()).toBeGreaterThanOrEqual(19_900);
    expect(geminiCapacityWaitMs()).toBeGreaterThanOrEqual(19_900);
  });

  it('成功请求不会让其他并发请求提前解除共享熔断', () => {
    registerGeminiCapacityFailure();
    registerGeminiCapacitySuccess();
    expect(geminiCapacityWaitMs()).toBeGreaterThan(0);
  });
});
