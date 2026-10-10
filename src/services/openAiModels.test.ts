import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, DEFAULT_INPAINT_SETTINGS, DEFAULT_LOGO_SETTINGS, DEFAULT_PRODUCT_DETAIL_SETTINGS, DEFAULT_SCENE_REPLACE_SETTINGS } from '../constants';
import { DEFAULT_PREFERENCES } from './engraving/storage';
import { DEFAULT_AI_PET_LETTER_SETTINGS } from './aiPetLetters/types';
import { DEFAULT_OPENAI_IMAGE_MODEL, DEFAULT_OPENAI_LANGUAGE_MODEL, OPENAI_IMAGE_MODEL_OPTIONS, OPENAI_LANGUAGE_MODEL_OPTIONS } from './openAiModels';

describe('creative tool model defaults', () => {
  it('offers both GPT Image 2.5 models and defaults to Flare', () => {
    expect(OPENAI_IMAGE_MODEL_OPTIONS.map(({ value }) => value)).toEqual(expect.arrayContaining(['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst']));
    expect(DEFAULT_OPENAI_IMAGE_MODEL).toBe('gpt-image-2.5-flare');
    for (const model of [DEFAULT_SETTINGS.imageModel, DEFAULT_INPAINT_SETTINGS.imageModel, DEFAULT_LOGO_SETTINGS.imageModel, DEFAULT_PRODUCT_DETAIL_SETTINGS.imageModel, DEFAULT_SCENE_REPLACE_SETTINGS.imageModel, DEFAULT_PREFERENCES.imageModel, DEFAULT_AI_PET_LETTER_SETTINGS.model]) expect(model).toBe(DEFAULT_OPENAI_IMAGE_MODEL);
  });

  it('offers GPT-6 Luna and uses it for language defaults', () => {
    expect(OPENAI_LANGUAGE_MODEL_OPTIONS[0].value).toBe(DEFAULT_OPENAI_LANGUAGE_MODEL);
    for (const model of [DEFAULT_SETTINGS.optimizerModel, DEFAULT_INPAINT_SETTINGS.optimizerModel, DEFAULT_LOGO_SETTINGS.optimizerModel, DEFAULT_PRODUCT_DETAIL_SETTINGS.analyzerModel, DEFAULT_SCENE_REPLACE_SETTINGS.openAiPromptOptimizerModel, DEFAULT_PREFERENCES.reviewModel]) expect(model).toBe('gpt-6-luna');
  });
});
