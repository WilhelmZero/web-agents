import { afterEach, expect, it, vi } from 'vitest';
import { saveServerDocument } from './serverPersistence';

afterEach(() => vi.unstubAllGlobals());

it('encodes non-Latin upload names before putting them in HTTP headers', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    return new Response(url === '/api/assets' ? JSON.stringify({ id: 'asset-1' }) : JSON.stringify({ ok: true }), { status: url === '/api/assets' ? 201 : 200 });
  }));
  await saveServerDocument('custom-logo:test', { original: new File(['png'], '客户图案.png', { type: 'image/png' }) }, 'custom-monochrome-logo');
  expect(requests[0].url).toBe('/api/assets');
  expect((requests[0].init?.headers as Record<string, string>)['X-File-Name']).toBe(encodeURIComponent('客户图案.png'));
  expect(requests[1].url).toBe('/api/documents/custom-logo%3Atest');
});
