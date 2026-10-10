import type { OpenAiImageModel, OpenAiLanguageModel } from '../types';

export const DEFAULT_OPENAI_IMAGE_MODEL: OpenAiImageModel = 'gpt-image-2.5-flare';
export const DEFAULT_OPENAI_LANGUAGE_MODEL: OpenAiLanguageModel = 'gpt-6-luna';

export const OPENAI_IMAGE_MODEL_OPTIONS: { value: OpenAiImageModel; label: string }[] = [
  { value: 'gpt-image-2.5-flare', label: 'GPT Image 2.5 Flare（默认）' },
  { value: 'gpt-image-2.5-sunburst', label: 'GPT Image 2.5 Sunburst' },
  { value: 'gpt-image-2', label: 'GPT Image 2' },
  { value: 'gpt-image-2-2026-04-21', label: 'GPT Image 2（2026-04-21）' },
];

export const OPENAI_LANGUAGE_MODEL_OPTIONS: { value: OpenAiLanguageModel; label: string }[] = [
  { value: 'gpt-6-luna', label: 'GPT-6 Luna（默认 · 低成本）' },
  { value: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
  { value: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
  { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
];
