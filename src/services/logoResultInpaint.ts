export const DEFAULT_LOGO_RESULT_INPAINT_PROMPT = '去掉选中的logo';

export function normalizeLogoResultInpaintPrompt(prompt: string) {
  return prompt.trim() || DEFAULT_LOGO_RESULT_INPAINT_PROMPT;
}
