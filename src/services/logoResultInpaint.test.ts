import { describe, expect, it } from 'vitest';
import { DEFAULT_LOGO_RESULT_INPAINT_PROMPT, normalizeLogoResultInpaintPrompt } from './logoResultInpaint';

describe('normalizeLogoResultInpaintPrompt', () => {
  it('uses the default instruction for an empty prompt', () => {
    expect(normalizeLogoResultInpaintPrompt('   ')).toBe(DEFAULT_LOGO_RESULT_INPAINT_PROMPT);
  });

  it('trims a custom instruction', () => {
    expect(normalizeLogoResultInpaintPrompt('  修复杯身反光  ')).toBe('修复杯身反光');
  });
});
