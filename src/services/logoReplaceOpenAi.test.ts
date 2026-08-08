import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateLogoReplacementOpenAi } from './logoReplaceOpenAi';

describe('OpenAI Logo replacement', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends the scene and Logo references as multiple image edit inputs', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ data: [{ b64_json: btoa('result') }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await generateLogoReplacementOpenAi({
      apiKey: 'openai-key', model: 'gpt-image-2',
      scene: new File(['scene'], 'scene.png', { type: 'image/png' }),
      oldLogo: new File(['old'], 'old.png', { type: 'image/png' }),
      newLogo: new File(['new'], 'new.png', { type: 'image/png' }),
      prompt: 'replace the logo',
    });
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const form = request.body as FormData;
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.openai.com/v1/images/edits');
    expect(form.getAll('image[]')).toHaveLength(3);
    expect(form.get('model')).toBe('gpt-image-2');
    expect(form.has('input_fidelity')).toBe(false);
    expect(result.mimeType).toBe('image/png');
  });
});
