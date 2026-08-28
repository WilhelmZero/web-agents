import { afterEach, describe, expect, it, vi } from 'vitest';
import { optimizeLogoPromptOpenAi, optimizeScenePromptOpenAi } from './promptOptimizer';

afterEach(() => vi.restoreAllMocks());

describe('optimizeScenePromptOpenAi', () => {
  it('uses Responses API and returns output text', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ output_text: '优化后的提示词' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await expect(optimizeScenePromptOpenAi({ apiKey: 'key', model: 'gpt-5.6-terra', prompt: '改成海边' })).resolves.toBe('优化后的提示词');
    expect(fetchMock).toHaveBeenCalledWith('https://api.openai.com/v1/responses', expect.objectContaining({ method: 'POST' }));
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.model).toBe('gpt-5.6-terra'); expect(body.input[0].content[0].text).toContain('改成海边');
  });
});

describe('optimizeLogoPromptOpenAi', () => {
  it('preserves the source request in a Logo-specific optimization instruction', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ output_text: '优化后的 Logo 提示词' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await expect(optimizeLogoPromptOpenAi({ apiKey: 'key', model: 'gpt-5.6-terra', prompt: '只替换杯身 Logo' })).resolves.toBe('优化后的 Logo 提示词');
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.input[0].content[0].text).toContain('Logo 替换提示词专家');
    expect(body.input[0].content[0].text).toContain('只替换杯身 Logo');
  });
});
