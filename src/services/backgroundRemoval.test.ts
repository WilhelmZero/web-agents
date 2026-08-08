import { beforeEach, describe, expect, it, vi } from 'vitest';

const removeBackground = vi.fn(async (_input: Blob, _configuration?: unknown) => new Blob(['png'], { type: 'image/png' }));
vi.mock('@imgly/background-removal', () => ({ removeBackground }));

describe('dedicated background removal', () => {
  beforeEach(() => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 2, height: 2, close: vi.fn() })));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(), clearRect: vi.fn(), putImageData: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([10, 20, 30, 255, 10, 20, 30, 255, 10, 20, 30, 255, 10, 20, 30, 255]), width: 2, height: 2 })),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['png'], { type: 'image/png' })));
  });

  it('uses a fixed GPT prompt that requests a clean solid matte instead of unsupported transparency', async () => {
    const { buildGptBackgroundRemovalPrompt } = await import('./backgroundRemoval');
    const prompt = buildGptBackgroundRemovalPrompt('#FF00FF');
    expect(prompt).toContain('纯色 #FF00FF');
    expect(prompt).toContain('内部孔洞');
    expect(prompt).not.toContain('透明背景');
  });

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

  it('expands the alpha mask to recover foreground pixels removed too aggressively', async () => {
    const { tuneAlphaMask } = await import('./backgroundRemoval');
    const tuned = tuneAlphaMask(new Uint8ClampedArray([
      0, 0, 0,
      0, 255, 0,
      0, 0, 0,
    ]), 3, 3, { edgeExpansion: 1, edgeFeather: 0 });
    expect([...tuned]).toEqual(new Array(9).fill(255));
  });
});
