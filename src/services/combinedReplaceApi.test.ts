import { describe, expect, it } from 'vitest';
import { normalizeSimpleScenePrompt, toGeminiResponseSchema } from './combinedReplaceApi';

describe('Gemini response schema conversion', () => {
  it('removes unsupported additionalProperties recursively', () => {
    const schema = { type: 'object', additionalProperties: false, properties: { items: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' } } } } } };
    const converted = toGeminiResponseSchema(schema) as any;
    expect(converted.additionalProperties).toBeUndefined();
    expect(converted.properties.items.items.additionalProperties).toBeUndefined();
    expect(converted.properties.items.items.properties.name.type).toBe('string');
  });
  it('reduces an analyzed scene suggestion to one simple theme sentence', () => {
    expect(normalizeSimpleScenePrompt('改为现代海滨夏日主题。使用柔和光线并保持构图。')).toBe('替换为现代海滨夏日主题');
    expect(normalizeSimpleScenePrompt('替换为北欧咖啡馆主题')).toBe('替换为北欧咖啡馆主题');
  });
});
