import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useEffect, useState } from 'react';
import ServerGate, { useStudioSession } from './ServerGate';

function SessionProbe() {
  const studio = useStudioSession();
  return <div><span>{studio?.session.username}</span><button onClick={() => void studio?.signOut()}>Sign out</button></div>;
}

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

it('exposes the current account and signs out without keeping the workspace mounted', async () => {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/auth/session') return new Response(JSON.stringify({ username: 'alice', admin: false }), { status: 200 });
    if (url === '/api/config') return new Response(JSON.stringify({ openai: false, gemini: false }), { status: 200 });
    if (url === '/api/auth/logout') return new Response(JSON.stringify({ ok: true }), { status: 200 });
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<ServerGate><SessionProbe /></ServerGate>);
  expect(await screen.findByText('alice')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Sign out'));
  await waitFor(() => expect(screen.getByText('Scene Studio 登录')).toBeInTheDocument());
  expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
});
