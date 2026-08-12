import { describe, expect, it } from 'vitest';
import { toGeminiResponseSchema } from './combinedReplaceApi';

describe('Gemini response schema conversion', () => {
  it('removes unsupported additionalProperties recursively', () => {
    const schema = { type: 'object', additionalProperties: false, properties: { items: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' } } } } } };
    const converted = toGeminiResponseSchema(schema) as any;
    expect(converted.additionalProperties).toBeUndefined();
    expect(converted.properties.items.items.additionalProperties).toBeUndefined();
    expect(converted.properties.items.items.properties.name.type).toBe('string');
  });
});
