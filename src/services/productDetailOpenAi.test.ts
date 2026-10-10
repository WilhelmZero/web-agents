import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeProductDetailPromptsOpenAi } from './productDetailOpenAi';

afterEach(() => vi.restoreAllMocks());

describe('analyzeProductDetailPromptsOpenAi', () => {
  it('sends the image to GPT Responses and validates the requested prompt count', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ output_text: JSON.stringify({ seriesStyle: '暖色写实摄影', prompts: [{ title: '主视觉', content: '保留杯子并放在餐桌上', overlayTexts: ['礼物'] }] }) }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const image = new File([new Uint8Array([1, 2, 3])], 'cup.png', { type: 'image/png' });
    const result = await analyzeProductDetailPromptsOpenAi({ apiKey: 'test-key', model: 'gpt-6-luna', image, productInfo: '玻璃杯', count: 1 });
    expect(result).toEqual([{ title: '主视觉', content: expect.stringContaining('暖色写实摄影'), overlayTexts: ['礼物'] }]);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/responses');
    const body = JSON.parse(String((request as RequestInit).body));
    expect(body.model).toBe('gpt-6-luna');
    expect(body.input[0].content[1].image_url).toContain('data:image/png;base64,');
  });

  it('rejects an incomplete plan', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ output_text: JSON.stringify({ seriesStyle: '一致', prompts: [] }) }), { status: 200 }));
    await expect(analyzeProductDetailPromptsOpenAi({ apiKey: 'key', model: 'gpt-6-luna', image: new File(['x'], 'a.png', { type: 'image/png' }), productInfo: '杯子', count: 1 })).rejects.toThrow('应返回 1 条');
  });
});
