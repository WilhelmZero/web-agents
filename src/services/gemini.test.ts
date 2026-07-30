import { describe, expect, it } from 'vitest';
import { getGeminiApiRoot, isRetryableGeminiStatus } from './gemini';

describe('Gemini API 地址', () => {
  it('未配置代理时直连 Google', () => {
    expect(getGeminiApiRoot('')).toBe('https://generativelanguage.googleapis.com/v1beta');
  });

  it('为 Worker 根地址补充 v1beta 路径', () => {
    expect(getGeminiApiRoot('https://proxy.example.workers.dev/'))
      .toBe('https://proxy.example.workers.dev/v1beta');
  });

  it('不会重复追加已有的 v1beta 路径', () => {
    expect(getGeminiApiRoot('https://proxy.example.workers.dev/v1beta'))
      .toBe('https://proxy.example.workers.dev/v1beta');
  });

  it('只对临时性服务错误进行自动重试', () => {
    expect([408, 429, 500, 502, 503, 504].every(isRetryableGeminiStatus)).toBe(true);
    expect([400, 401, 403, 404].some(isRetryableGeminiStatus)).toBe(false);
  });
});
