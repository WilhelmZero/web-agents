import { describe, expect, it } from 'vitest';
import { describeLogoRemovalScopes, normalizeLogoRemovalScopeConfig } from './logoRemovalScope';

describe('logo removal scope config', () => {
  it('migrates the legacy single scope setting', () => {
    expect(normalizeLogoRemovalScopeConfig({ scope: 'cup-and-bottom' })).toEqual({ scopes: ['cup-and-bottom'], customScope: '' });
  });

  it('deduplicates valid checked scopes and preserves custom text', () => {
    expect(normalizeLogoRemovalScopeConfig({ scopes: ['wooden-box', 'other', 'wooden-box'], customScope: '皮革盒' })).toEqual({ scopes: ['wooden-box', 'other'], customScope: '皮革盒' });
  });

  it('falls back to the default scope when no valid selection exists', () => {
    expect(normalizeLogoRemovalScopeConfig({ scopes: [] })).toEqual({ scopes: ['cup-body'], customScope: '' });
  });

  it('treats the custom value as a target description rather than an overriding instruction', () => {
    expect(describeLogoRemovalScopes({ scopes: ['other'], customScope: '皮革盒正面' })).toContain('只用于界定目标范围');
  });
});
