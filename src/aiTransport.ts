const SENTINEL = '__server_managed__';

export interface ServerKeyStatus { openai: boolean; gemini: boolean }

declare global {
  interface Window { __studioServerKeys?: ServerKeyStatus }
}

export function managedKeyValue(enabled: boolean, localValue: string): string {
  if (enabled) return SENTINEL;
  return localValue === SENTINEL ? '' : localValue;
}

export function installAiTransport() {
  if (typeof window === 'undefined') return;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    let url: URL;
    try { url = new URL(request.url); } catch { return nativeFetch(input, init); }
    let provider: 'openai' | 'gemini' | null = null;
    if (url.origin !== location.origin && /\/(?:v1\/)?(?:responses|images\/(?:edits|generations))$/.test(url.pathname)) provider = 'openai';
    if (url.origin !== location.origin && /\/models\/[a-zA-Z0-9._-]+:(?:generateContent|streamGenerateContent)$/.test(url.pathname)) provider = 'gemini';
    if (!provider) {
      const knownAiHost = /^(?:api\.openai\.com|generativelanguage\.googleapis\.com)$/.test(url.hostname);
      const carriesAiKey = request.headers.has('x-goog-api-key') || /^Bearer\s+/.test(request.headers.get('authorization') || '');
      if (url.origin !== location.origin && (knownAiHost || carriesAiKey)) throw new Error('Unsupported AI endpoint: all AI requests must use the studio gateway');
      return nativeFetch(input, init);
    }
    const keyFromAuth = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
    const key = provider === 'openai' ? keyFromAuth : request.headers.get('x-goog-api-key') || url.searchParams.get('key') || '';
    const headers = new Headers(request.headers);
    headers.delete('authorization');
    headers.delete('x-goog-api-key');
    headers.delete('x-client-api-key');
    if (key && key !== SENTINEL && !window.__studioServerKeys?.[provider]) headers.set('x-client-api-key', key);
    headers.set('x-tool', new URLSearchParams(location.search).get('tool') || 'scene');
    const path = provider === 'openai'
      ? `/v1/${url.pathname.match(/(?:responses|images\/(?:edits|generations))$/)?.[0]}`
      : `/v1beta/${url.pathname.match(/models\/[a-zA-Z0-9._-]+:(?:generateContent|streamGenerateContent)$/)?.[0]}`;
    const proxyUrl = `/api/ai/${provider}${path}${url.searchParams.get('alt') === 'sse' ? '?alt=sse' : ''}`;
    const proxyRequest = new Request(new URL(proxyUrl, location.origin), request);
    for (const [name, value] of headers) proxyRequest.headers.set(name, value);
    proxyRequest.headers.delete('authorization');
    proxyRequest.headers.delete('x-goog-api-key');
    let response = await nativeFetch(proxyRequest);
    if (response.status !== 202) return response;
    const pending = await response.json() as { jobId?: string };
    if (!pending.jobId) return response;
    for (;;) {
      if (request.signal.aborted) throw request.signal.reason || new DOMException('Aborted', 'AbortError');
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(resolve, 1500);
        request.signal.addEventListener('abort', () => { window.clearTimeout(timer); reject(request.signal.reason || new DOMException('Aborted', 'AbortError')); }, { once: true });
      });
      response = await nativeFetch(`/api/jobs/${encodeURIComponent(pending.jobId)}/response`, { signal: request.signal });
      if (response.status !== 202) return response;
    }
  };
}
