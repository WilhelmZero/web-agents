import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearRequestConsole,
  startRequestConsoleEntry,
  subscribeRequestConsole,
  summarizeGeminiRequest,
  updateRequestConsoleEntry,
  type RequestConsoleEntry,
} from './requestConsole';

describe('request console', () => {
  beforeEach(() => clearRequestConsole());

  it('stores prompt and capped input images for expandable request details', () => {
    let latest: RequestConsoleEntry[] = [];
    const unsubscribe = subscribeRequestConsole((items) => { latest = items; });
    startRequestConsoleEntry({ model: 'gpt-image-2', connection: 'direct', requestSummary: 'scene edit', requestPrompt: '  replace the background  ', inputImages: Array.from({ length: 6 }, () => new Blob(['x'], { type: 'image/png' })) });
    unsubscribe();
    expect(latest[0].requestPrompt).toBe('replace the background');
    expect(latest[0].inputImages).toHaveLength(4);
  });

  it('publishes request status updates', () => {
    const snapshots: RequestConsoleEntry[][] = [];
    const unsubscribe = subscribeRequestConsole((entries) => snapshots.push(entries));
    const id = startRequestConsoleEntry({ model: 'test-model', connection: 'proxy', requestSummary: '1 张输入图片' });
    updateRequestConsoleEntry(id, { status: 'success', httpStatus: 200, resultSummary: '1 张图片' });
    expect(snapshots.at(-1)?.[0]).toMatchObject({ id, model: 'test-model', status: 'success', httpStatus: 200 });
    unsubscribe();
  });

  it('retains only a bounded number of image outputs', () => {
    for (let index = 0; index < 8; index += 1) {
      const id = startRequestConsoleEntry({ model: 'image-model', connection: 'direct', requestSummary: 'image request' });
      updateRequestConsoleEntry(id, { status: 'success', outputImages: Array.from({ length: 5 }, () => new Blob(['image'], { type: 'image/png' })) });
    }
    let latest: RequestConsoleEntry[] = [];
    const unsubscribe = subscribeRequestConsole((items) => { latest = items; });
    expect(latest.reduce((total, entry) => total + (entry.outputImages?.length || 0), 0)).toBe(24);
    expect(latest.every((entry) => (entry.outputImages?.length || 0) <= 4)).toBe(true);
    unsubscribe();
  });

  it('summarizes without retaining prompt, key, or base64 data', () => {
    const summary = summarizeGeminiRequest({
      secretKey: 'never-show-this-key',
      contents: [{ parts: [{ text: 'private prompt' }, { inlineData: { mimeType: 'image/png', data: 'private-base64' } }] }],
      generationConfig: { imageConfig: { imageSize: '2K', aspectRatio: '1:1' } },
    });
    expect(summary).toBe('1 张输入图片 · 1 段文本 · 输出 2K · 比例 1:1');
    expect(summary).not.toContain('private');
    expect(summary).not.toContain('never-show');
  });
});
