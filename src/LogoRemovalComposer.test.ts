import { describe, expect, it } from 'vitest';
import { normalizeLogoRemovalSettings } from './LogoRemovalComposer';

describe('normalizeLogoRemovalSettings', () => {
  it('preserves a saved GPT image provider and supported GPT image model', () => {
    const settings = normalizeLogoRemovalSettings({ imageProvider: 'openai', openAiImageModel: 'gpt-image-2-2026-04-21' });
    expect(settings.imageProvider).toBe('openai');
    expect(settings.openAiImageModel).toBe('gpt-image-2-2026-04-21');
  });

  it('keeps Gemini as the safe default for old settings without an image provider', () => {
    const settings = normalizeLogoRemovalSettings({ imageModel: 'gemini-3.1-flash-image' });
    expect(settings.imageProvider).toBe('gemini');
    expect(settings.openAiImageModel).toBe('gpt-image-2');
  });
});
