import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPaperTextEditPrompt, editPaperTextOpenAi, normalizePaperTextRegions, supportsOpenAiInputFidelity } from './paperText';
import { clearRequestConsole, subscribeRequestConsole, type RequestConsoleEntry } from './requestConsole';

describe('paper text helpers', () => {
  beforeEach(() => {
    clearRequestConsole();
    vi.restoreAllMocks();
  });
  it('filters malformed regions and clamps percentage boxes', () => {
    expect(normalizePaperTextRegions({ regions: [
      { text: 'Hello', box: [-5, 10, 120, 30] },
      { text: '', box: [1, 2, 3, 4] },
      { text: 'bad', box: [1, 2] },
    ] })).toEqual([{ original: 'Hello', text: 'Hello', box: [0, 10, 100, 30] }]);
  });

  it('accepts named Gemini coordinates and normalizes 0-1000 values', () => {
    expect(normalizePaperTextRegions({ regions: [{ text: 'Logo', left: 120, top: 250, width: 300, height: 80 }] }))
      .toEqual([{ original: 'Logo', text: 'Logo', box: [12, 25, 30, 8] }]);
  });

  it('only includes changed text and preserves strict editing rules', () => {
    const prompt = buildPaperTextEditPrompt([
      { original: 'OLD', text: 'NEW', box: [10, 20, 30, 40] },
      { original: 'SAME', text: 'SAME', box: [0, 0, 10, 10] },
    ]);
    expect(prompt).toContain('将“OLD”准确替换为“NEW”');
    expect(prompt).not.toContain('“SAME”');
    expect(prompt).toContain('除指定文字外');
  });

  it('adds the editable common prompt to every image edit prompt', () => {
    const prompt = buildPaperTextEditPrompt(
      [{ original: 'OLD', text: 'NEW', box: [10, 20, 30, 40] }],
      '',
      '保持金色烫印质感，并匹配原图透视。',
    );
    expect(prompt).toContain('公共修改提示词（应用于全部图片）');
    expect(prompt).toContain('保持金色烫印质感，并匹配原图透视。');
    expect(prompt).toContain('除指定文字外');
  });

  it('omits input fidelity for GPT Image 2 models', () => {
    expect(supportsOpenAiInputFidelity('gpt-image-2')).toBe(false);
    expect(supportsOpenAiInputFidelity('gpt-image-2-2026-04-21')).toBe(false);
    expect(supportsOpenAiInputFidelity('gpt-image-1.5')).toBe(true);
  });

  it('publishes GPT image edit requests to the request console', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: 'aGVsbG8=' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    const snapshots: RequestConsoleEntry[][] = [];
    const unsubscribe = subscribeRequestConsole((entries) => snapshots.push(entries));
    await editPaperTextOpenAi({ apiKey: 'test-key', model: 'gpt-image-2', image: new File(['image'], 'paper.png', { type: 'image/png' }), prompt: 'replace text', quality: 'high' });
    expect(snapshots.at(-1)?.[0]).toMatchObject({ model: 'gpt-image-2', connection: 'direct', status: 'success', httpStatus: 200, resultSummary: '1 张编辑图片' });
    expect(snapshots.at(-1)?.[0].requestSummary).toContain('OpenAI Images Edit');
    unsubscribe();
  });

  it('passes an explicitly requested transparent background to the Images API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: 'aGVsbG8=' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await editPaperTextOpenAi({ apiKey: 'test-key', model: 'gpt-image-1.5', image: new File(['image'], 'subject.png', { type: 'image/png' }), prompt: 'remove background', quality: 'high', background: 'transparent' });
    const body = fetchMock.mock.calls[0][1].body as FormData;
    expect(body.get('background')).toBe('transparent');
    expect(body.get('output_format')).toBe('png');
  });
});
