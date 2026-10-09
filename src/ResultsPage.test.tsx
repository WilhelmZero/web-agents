import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ResultsPage from './ResultsPage';

afterEach(() => vi.unstubAllGlobals());

it('reads final results and server jobs with tool labels supplied by the registry', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/api/results?')) return new Response(JSON.stringify([{ id: 'result-1', operationId: 'scene:1', tool: 'scene', username: 'alice', name: 'scene.png', assetId: 'asset-1', mime: 'image/png', expired: false, createdAt: '2026-10-09T00:00:00Z', exportSpec: {} }]), { status: 200 });
    if (url === '/api/jobs') return new Response(JSON.stringify([{ id: 'job-1', tool: 'scene', username: 'alice', provider: 'openai', model: 'gpt-image-2', status: 'queued', imageCount: 0, createdAt: '2026-10-09T00:00:00Z' }]), { status: 200 });
    throw new Error(`Unexpected ${url}`);
  }));
  render(<ResultsPage labels={{ scene: 'Renamed scene tool' }} language="en-US" />);
  expect(await screen.findByText('scene.png')).toBeTruthy();
  await waitFor(() => expect(screen.getAllByText('Renamed scene tool')).toHaveLength(2));
  expect(screen.getByText('Queued')).toBeTruthy();
});

it('keeps a completed job model image separate from final result cards', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('/api/results?')) return new Response('[]', { status: 200 });
    if (url === '/api/jobs') return new Response(JSON.stringify([{ id: 'job-2', tool: 'outpaint', username: 'alice', provider: 'openai', model: 'gpt-image-2', status: 'success', imageCount: 1, createdAt: '2026-10-09T00:00:00Z', assets: [{ id: 'raw-1', name: 'raw.png', mime: 'image/png', expired: false }] }]), { status: 200 });
    throw new Error(`Unexpected ${url}`);
  }));
  render(<ResultsPage labels={{ outpaint: 'Outpaint' }} language="en-US" />);
  expect(await screen.findByText('Model outputs (not final artwork):')).toBeTruthy();
  expect(screen.getByText('raw.png')).toBeTruthy();
  expect(screen.getByText('No new-version results yet')).toBeTruthy();
});
