interface Env {
  ALLOWED_ORIGINS?: string;
}

const GEMINI_ORIGIN = 'https://generativelanguage.googleapis.com';
const MODEL_PATH = /^\/v1beta\/models\/([a-zA-Z0-9._-]+):generateContent$/;
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const MAX_BODY_BYTES = 50 * 1024 * 1024;

function allowedOrigin(request: Request, env: Env): string | undefined {
  const origin = request.headers.get('Origin');
  if (!origin) return undefined;
  const configured = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((item) => item.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return LOCAL_ORIGIN.test(origin) || configured.includes(origin) ? origin : undefined;
}

function corsHeaders(origin: string) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Goog-Api-Key',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };
}

function jsonError(message: string, status: number, origin?: string) {
  return Response.json(
    { error: { message, code: status, status: 'PROXY_ERROR' } },
    { status, headers: origin ? corsHeaders(origin) : { 'Cache-Control': 'no-store' } },
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      const origin = allowedOrigin(request, env);
      if (!origin) return jsonError('Origin 不在代理白名单中', 403);
      return Response.json(
        { ok: true, service: 'gemini-proxy' },
        { headers: corsHeaders(origin) },
      );
    }

    const origin = allowedOrigin(request, env);
    if (!origin) return jsonError('Origin 不在代理白名单中', 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (request.method !== 'POST') return jsonError('仅支持 POST 请求', 405, origin);
    if (!MODEL_PATH.test(url.pathname)) return jsonError('不允许代理该 API 路径', 404, origin);

    const apiKey = request.headers.get('x-goog-api-key');
    if (!apiKey || apiKey.length > 256) return jsonError('缺少或无效的 Gemini API Key', 401, origin);
    if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
      return jsonError('请求必须使用 application/json', 415, origin);
    }
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > MAX_BODY_BYTES) return jsonError('请求体超过 50MB 限制', 413, origin);

    const upstream = await fetch(`${GEMINI_ORIGIN}${url.pathname}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: request.body,
    });

    const headers = new Headers(corsHeaders(origin));
    headers.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json; charset=utf-8');
    const requestId = upstream.headers.get('x-request-id');
    if (requestId) headers.set('x-request-id', requestId);
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
