import { afterEach, describe, expect, it, vi } from 'vitest';
import { optimizeScenePromptOpenAi } from './promptOptimizer';

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
