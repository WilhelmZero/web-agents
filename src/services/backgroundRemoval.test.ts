import { describe, expect, it, vi } from 'vitest';

const removeBackground = vi.fn(async (_input: Blob, _configuration?: unknown) => new Blob(['png'], { type: 'image/png' }));
vi.mock('@imgly/background-removal', () => ({ removeBackground }));

describe('dedicated background removal', () => {
  it('uses the quality matting model and returns a transparent PNG', async () => {
    const { removeImageBackground } = await import('./backgroundRemoval');
    const input = new Blob(['image'], { type: 'image/jpeg' });
    const result = await removeImageBackground(input);
    expect(result.type).toBe('image/png');
    expect(removeBackground).toHaveBeenCalledWith(input, expect.objectContaining({
      model: 'isnet_fp16',
      output: { format: 'image/png', quality: 1 },
    }));
  });

  it('reports model download progress as a percentage', async () => {
    const { removeImageBackground } = await import('./backgroundRemoval');
    const progress = vi.fn();
    await removeImageBackground(new Blob(['image']), progress);
    const configuration = removeBackground.mock.calls.at(-1)?.[1] as { progress: (key: string, current: number, total: number) => void };
    configuration.progress('model', 25, 100);
    expect(progress).toHaveBeenCalledWith({ current: 25, total: 100, percent: 25 });
  });
});
