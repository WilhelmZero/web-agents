import { afterEach, expect, it, vi } from 'vitest';
import { archiveFinalImage } from './resultArchive';

afterEach(() => { vi.unstubAllGlobals(); window.__studioServerKeys = undefined; });

it('archives only a final image and leaves an existing operation untouched', async () => {
  window.__studioServerKeys = { openai: true, gemini: false };
  let exists = false;
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    calls.push(`${options?.method || 'GET'} ${url}`);
    if (url.startsWith('/api/results/operation/')) return new Response(exists ? JSON.stringify({ id: 'result-1' }) : '{}', { status: exists ? 200 : 404 });
    if (url === '/api/assets') return new Response(JSON.stringify({ id: '11111111-1111-1111-1111-111111111111' }), { status: 201 });
    if (url === '/api/results') { exists = true; return new Response(JSON.stringify({ id: 'result-1' }), { status: 201 }); }
    throw new Error(`Unexpected URL ${url}`);
  }));
  const candidate = { id: 'operation-1', status: 'success', resultBlob: new Blob(['image'], { type: 'image/png' }), name: 'final.png' };
  await archiveFinalImage('scene', { ...candidate, status: 'running' });
  expect(calls).toHaveLength(0);
  await archiveFinalImage('scene', candidate);
  await archiveFinalImage('scene', candidate);
  expect(calls.filter((call) => call === 'POST /api/assets')).toHaveLength(1);
  expect(calls.filter((call) => call === 'POST /api/results')).toHaveLength(1);
});
