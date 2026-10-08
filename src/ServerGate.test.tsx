import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useEffect, useState } from 'react';
import ServerGate from './ServerGate';

function KeyStatus() {
  const [configured, setConfigured] = useState(() => Boolean(window.__studioServerKeys?.openai));
  useEffect(() => {
    const sync = () => setConfigured(Boolean(window.__studioServerKeys?.openai));
    window.addEventListener('studio:server-keys', sync);
    return () => window.removeEventListener('studio:server-keys', sync);
  }, []);
  return <div>{configured ? 'OpenAI configured' : 'OpenAI missing'}</div>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete window.__studioServerKeys;
});

it('refreshes server key status when returning to an already-open page', async () => {
  let configured = false;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/auth/session') return new Response(JSON.stringify({ username: 'admin', admin: true }));
    if (url === '/api/config') return new Response(JSON.stringify({ openai: configured, gemini: false }));
    throw new Error(`Unexpected request: ${url}`);
  }));
  render(<ServerGate><KeyStatus /></ServerGate>);
  expect(await screen.findByText('OpenAI missing')).toBeInTheDocument();
  configured = true;
  fireEvent.focus(window);
  await waitFor(() => expect(screen.getByText('OpenAI configured')).toBeInTheDocument());
});
