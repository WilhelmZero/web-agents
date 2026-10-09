import express from 'express';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, unlink, mkdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.mjs';
import { createMemoryStore } from './memory-store.mjs';
import { createSession, decryptTemporaryKey, encryptTemporaryKey, readUsers, verifyPassword, verifySession } from './security.mjs';
import { readIntegrationKeys, verifyIntegrationKey } from './integration-auth.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const MAX_REQUEST_BYTES = 80 * 1024 * 1024;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const providerHosts = {
  openai: 'https://api.openai.com',
  gemini: 'https://generativelanguage.googleapis.com',
};

function cleanTool(value) {
  return /^[a-z0-9-]{1,64}$/.test(value || '') ? value : 'unknown';
}

export function allowedAiPath(provider, value) {
  const url = new URL(value, 'https://studio.invalid');
  if (provider === 'openai' && /^\/v1\/(responses|images\/(edits|generations))$/.test(url.pathname)) return url.pathname;
  if (provider === 'gemini' && /^\/v1beta\/models\/[a-zA-Z0-9._-]+:(generateContent|streamGenerateContent)$/.test(url.pathname)) return url.pathname + (url.searchParams.get('alt') === 'sse' ? '?alt=sse' : '');
  return null;
}

function modelName(contentType, bytes, provider, apiPath) {
  if (contentType.includes('json')) {
    try { const value = JSON.parse(bytes.toString('utf8')); if (typeof value.model === 'string') return value.model.slice(0, 120); } catch { /* invalid body is handled upstream */ }
  }
  if (provider === 'gemini') return apiPath.match(/\/models\/([^:]+)/)?.[1] || '';
  const match = bytes.toString('utf8', 0, Math.min(bytes.length, 8192)).match(/name="model"\r?\n\r?\n([^\r\n]+)/);
  return match?.[1]?.slice(0, 120) || '';
}

function extractedImages(provider, contentType, bytes) {
  if (!contentType.includes('json')) return [];
  try {
    const data = JSON.parse(bytes.toString('utf8'));
    if (provider === 'openai') {
      return [
        ...(Array.isArray(data.data) ? data.data.map((item) => ({ data: item.b64_json, mime: data.output_format === 'webp' ? 'image/webp' : 'image/png' })) : []),
        ...(Array.isArray(data.output) ? data.output.filter((item) => item.type === 'image_generation_call').map((item) => ({ data: item.result, mime: 'image/png' })) : []),
      ].filter((item) => typeof item.data === 'string');
    }
    return (data.candidates || []).flatMap((candidate) => candidate.content?.parts || []).map((part) => ({ data: part.inlineData?.data, mime: part.inlineData?.mimeType || 'image/png' })).filter((item) => typeof item.data === 'string');
  } catch { return []; }
}

function safeCookie(req, name) {
  const item = String(req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : '';
}

function isSameOrigin(req, env) {
  const origin = req.get('origin');
  if (!origin) return true;
  const expected = env.APP_ORIGIN || `${req.headers['x-forwarded-proto'] === 'https' ? 'https' : req.protocol}://${req.get('host')}`;
  return origin === expected;
}

function publicJob(job, assets = []) {
  return {
    id: job.id, source: job.source, tool: job.tool, provider: job.provider, model: job.model,
    username: job.username, status: job.status, attempts: job.attempts,
    imageCount: job.image_count, responseStatus: job.response_status, error: job.error_message,
    createdAt: job.created_at, completedAt: job.completed_at,
    assets: assets.map((asset) => ({ id: asset.id, name: asset.name, mime: asset.mime, expired: Boolean(asset.expired) })),
  };
}

function publicResult(row) {
  return {
    id: row.id, operationId: row.operation_id, tool: row.tool, username: row.username,
    name: row.name, assetId: row.asset_id, jobId: row.job_id,
    mime: row.mime, expired: Boolean(row.expired), expiresAt: row.expires_at,
    createdAt: row.created_at, exportSpec: JSON.parse(row.export_json || '{}'),
  };
}

export async function createStudioServer(env = process.env, dependencies = {}) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET needs at least 32 characters');
  const users = readUsers(env.APP_USERS_JSON);
  const integrationKeys = readIntegrationKeys(env.STUDIO_INTEGRATIONS_JSON);
  const dataDir = path.resolve(env.APP_DATA_DIR || path.join(root, '.local-data'));
  if (env.NODE_ENV === 'production' && (!path.isAbsolute(env.APP_DATA_DIR || '') || dataDir.startsWith(root + path.sep) || /[\\/]hbuilds[\\/]|[\\/]public_html[\\/]/.test(dataDir))) {
    throw new Error('APP_DATA_DIR must be an absolute private path outside deployment directories');
  }
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const canonicalDataDir = await realpath(dataDir);
  if (env.NODE_ENV === 'production' && env.ALLOW_MEMORY_STORE === '1') throw new Error('Memory store is forbidden in production');
  const store = dependencies.store || (env.ALLOW_MEMORY_STORE === '1' ? createMemoryStore() : createStore(env));
  await store.init();
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('Content-Security-Policy', "connect-src 'self' blob: data:");
    res.set('Cache-Control', req.path.startsWith('/api/') ? 'no-store' : 'private');
    if (req.method !== 'GET' && req.method !== 'HEAD' && !isSameOrigin(req, env)) return res.status(403).json({ error: 'Invalid request origin' });
    next();
  });
  app.use('/api/auth/login', express.json({ limit: '8kb' }));
  const attempts = new Map();
  app.post('/api/auth/login', (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const state = attempts.get(ip) || { count: 0, since: now };
    if (now - state.since > 15 * 60_000) { state.count = 0; state.since = now; }
    if (state.count >= 8) return res.status(429).json({ error: 'Too many login attempts; try again later' });
    const username = String(req.body?.username || '');
    const candidate = users.get(username);
    if (!candidate || !verifyPassword(String(req.body?.password || ''), candidate.passwordHash)) {
      state.count++; attempts.set(ip, state);
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    attempts.delete(ip);
    const token = createSession(username, env.SESSION_SECRET);
    const secure = env.NODE_ENV === 'production' ? '; Secure' : '';
    res.set('Set-Cookie', `studio_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${secure}`);
    return res.json({ username, admin: candidate.admin });
  });
  app.post('/api/auth/logout', (_req, res) => {
    res.set('Set-Cookie', `studio_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${env.NODE_ENV === 'production' ? '; Secure' : ''}`);
    res.json({ ok: true });
  });
  app.get('/api/auth/session', (req, res) => {
    const user = verifySession(safeCookie(req, 'studio_session'), env.SESSION_SECRET, users);
    if (!user) return res.status(401).json({ error: 'Login required' });
    res.json(user);
  });
  const integrationRate = new Map();
  app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/integrations/')) {
      if (!integrationKeys.size) return res.status(503).json({ error: 'Integration API is not configured' });
      const project = String(req.get('x-studio-project') || '');
      if (!verifyIntegrationKey(integrationKeys, project, req.get('authorization'))) return res.status(401).json({ error: 'Invalid integration credentials' });
      const now = Date.now();
      const rate = integrationRate.get(project) || { started: now, count: 0 };
      if (now - rate.started >= 60_000) { rate.started = now; rate.count = 0; }
      if (rate.count >= 30) return res.status(429).json({ error: 'Integration rate limit exceeded' });
      rate.count++;
      integrationRate.set(project, rate);
      req.integrationProject = project;
      return next();
    }
    const user = verifySession(safeCookie(req, 'studio_session'), env.SESSION_SECRET, users);
    if (!user) return res.status(401).json({ error: 'Login required' });
    req.studioUser = user;
    next();
  });
  app.get('/api/config', (_req, res) => res.json({ openai: Boolean(env.OPENAI_API_KEY), gemini: Boolean(env.GEMINI_API_KEY) }));
  app.get('/api/results', async (req, res, next) => { try {
    const tool = typeof req.query.tool === 'string' && req.query.tool !== 'all' ? cleanTool(req.query.tool) : undefined;
    const status = req.query.status === 'available' || req.query.status === 'expired' ? req.query.status : undefined;
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 40));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    res.json((await store.listResults({ tool, status, limit, offset })).map(publicResult));
  } catch (error) { next(error); } });
  app.get('/api/results/operation/:operationId', async (req, res, next) => { try {
    const result = await store.getResultByOperation(req.params.operationId);
    if (!result) return res.status(404).json({ error: 'Result not found' });
    res.json(publicResult(result));
  } catch (error) { next(error); } });
  app.get('/api/results/:id', async (req, res, next) => { try {
    const result = await store.getResult(req.params.id);
    if (!result) return res.status(404).json({ error: 'Result not found' });
    res.json(publicResult(result));
  } catch (error) { next(error); } });
  app.post('/api/results', express.json({ limit: '1mb' }), async (req, res, next) => { try {
    const operationId = String(req.body?.operationId || '');
    const tool = String(req.body?.tool || '');
    const assetId = String(req.body?.assetId || '');
    if (!/^[a-zA-Z0-9:_-]{1,160}$/.test(operationId) || cleanTool(tool) !== tool || !/^[a-f0-9-]{36}$/.test(assetId)) return res.status(400).json({ error: 'Invalid result identifiers' });
    const previous = await store.getResultByOperation(operationId);
    if (previous) return previous.tool === tool ? res.json(publicResult(previous)) : res.status(409).json({ error: 'Operation belongs to a different tool' });
    const asset = await store.getAsset(assetId);
    if (!asset || asset.expired || !asset.file_path || !asset.expires_at && !asset.expiresAt || asset.tool !== tool || !asset.mime.startsWith('image/')) return res.status(400).json({ error: 'Final image asset is missing or has no retention deadline' });
    const name = String(req.body?.name || asset.name).slice(0, 255);
    const jobId = typeof req.body?.jobId === 'string' ? req.body.jobId : null;
    if (jobId) {
      const job = await store.getJob(jobId);
      if (!job || job.tool !== tool) return res.status(400).json({ error: 'Job does not belong to this tool' });
    }
    const exportSpec = req.body?.exportSpec && typeof req.body.exportSpec === 'object' && !Array.isArray(req.body.exportSpec) ? req.body.exportSpec : {};
    if (JSON.stringify(exportSpec).length > 800000) return res.status(413).json({ error: 'Export parameters too large' });
    const result = await store.createResult({ operationId, tool, username: req.studioUser.username, name, assetId, jobId, exportSpec });
    res.status(201).json(publicResult(result));
  } catch (error) { next(error); } });
  app.get('/api/jobs', async (_req, res, next) => { try {
    const jobs = await store.listJobs();
    res.json(await Promise.all(jobs.map(async (job) => publicJob(job, await store.assetsForJob(job.id)))));
  } catch (error) { next(error); } });
  app.get('/api/jobs/:id', async (req, res, next) => { try {
    const job = await store.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(publicJob(job, await store.assetsForJob(job.id)));
  } catch (error) { next(error); } });
  app.get('/api/jobs/:id/response', async (req, res, next) => { try {
    const job = await store.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status === 'queued' || job.status === 'running') return res.status(202).json({ jobId: job.id, status: job.status });
    if (!job.response_body_path) return res.status(502).json({ jobId: job.id, error: job.error_message || 'AI request failed' });
    res.status(job.response_status).type(job.response_content_type).send(await readFile(job.response_body_path));
  } catch (error) { next(error); } });
  app.post('/api/jobs/:id/cancel', async (req, res, next) => { try {
    if (!await store.cancelQueuedJob(req.params.id)) return res.status(409).json({ error: 'Only queued jobs can be cancelled' });
    res.json({ ok: true });
  } catch (error) { next(error); } });
  app.get('/api/assets/:id', async (req, res, next) => { try {
    const asset = await store.getAsset(req.params.id);
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    if (asset.expired || !asset.file_path) return res.status(410).json({ error: 'Asset expired' });
    const filePath = path.resolve(asset.file_path);
    if (!filePath.startsWith(canonicalDataDir + path.sep)) return res.status(500).json({ error: 'Invalid asset path' });
    const details = await stat(filePath);
    res.type(asset.mime).set('Content-Length', String(details.size));
    createReadStream(filePath).on('error', next).pipe(res);
  } catch (error) { next(error); } });
  app.get('/api/documents/:key', async (req, res, next) => { try {
    const doc = await store.getDocument(req.params.key);
    res.json(doc ? JSON.parse(doc.content_json) : null);
  } catch (error) { next(error); } });
  app.put('/api/documents/:key', express.json({ limit: '8mb', strict: false }), async (req, res, next) => { try {
    if (!/^[a-z0-9:_-]{1,160}$/.test(req.params.key)) return res.status(400).json({ error: 'Invalid document key' });
    await store.putDocument(req.params.key, req.body);
    res.json({ ok: true });
  } catch (error) { next(error); } });
  app.post('/api/assets', express.raw({ type: '*/*', limit: MAX_REQUEST_BYTES }), async (req, res, next) => { try {
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Empty file' });
    const mime = String(req.get('content-type') || 'application/octet-stream').split(';')[0];
    if (!/^(image\/|application\/(pdf|octet-stream|zip))/.test(mime)) return res.status(415).json({ error: 'Unsupported asset type' });
    let submittedName;
    try { submittedName = decodeURIComponent(String(req.get('x-file-name') || 'asset')); }
    catch { return res.status(400).json({ error: 'Invalid file name' }); }
    const name = path.basename(submittedName.replaceAll('\\', '/')).slice(0, 255);
    const filePath = path.join(canonicalDataDir, randomUUID());
    await writeFile(filePath, req.body, { flag: 'wx', mode: 0o600 });
    const id = await store.createAsset({ tool: cleanTool(req.get('x-tool')), mime, name, path: filePath, expiresAt: req.get('x-asset-role') === 'result' ? new Date(Date.now() + RETENTION_MS) : null });
    res.status(201).json({ id });
  } catch (error) { next(error); } });
  app.get('/api/admin/usage', async (req, res, next) => { try {
    if (!req.studioUser.admin) return res.status(403).json({ error: 'Admin required' });
    res.json(await store.usage());
  } catch (error) { next(error); } });

  let draining = false;
  async function drain() {
    if (draining) return;
    draining = true;
    try {
      for (;;) {
        const job = await store.claimJob();
        if (!job) break;
        let status = 'failed', responseStatus = 502, responseType = 'application/json', responsePath = null, imageCount = 0, errorMessage = null;
        try {
          const key = (job.provider === 'openai' ? env.OPENAI_API_KEY : env.GEMINI_API_KEY) || decryptTemporaryKey(job.encrypted_key, env.SESSION_SECRET);
          if (!key) throw new Error(`Missing ${job.provider} API key`);
          const headers = { 'Content-Type': job.request_content_type };
          if (job.provider === 'openai') headers.Authorization = `Bearer ${key}`;
          else headers['x-goog-api-key'] = key;
          const upstream = await fetch(`${providerHosts[job.provider]}${job.request_path}`, { method: 'POST', headers, body: await readFile(job.request_body_path), signal: AbortSignal.timeout(10 * 60_000) });
          responseStatus = upstream.status;
          responseType = upstream.headers.get('content-type') || 'application/json';
          const output = Buffer.from(await upstream.arrayBuffer());
          responsePath = path.join(canonicalDataDir, `${job.id}.response`);
          await writeFile(responsePath, output, { flag: 'wx', mode: 0o600 });
          status = upstream.ok ? 'success' : 'failed';
          if (upstream.ok) {
            const images = extractedImages(job.provider, responseType, output);
            for (const [index, image] of images.entries()) {
              const extension = image.mime === 'image/webp' ? 'webp' : image.mime === 'image/jpeg' ? 'jpg' : 'png';
              const filePath = path.join(canonicalDataDir, `${job.id}.${index}.${extension}`);
              await writeFile(filePath, Buffer.from(image.data, 'base64'), { flag: 'wx', mode: 0o600 });
              await store.createAsset({ jobId: job.id, tool: job.tool, mime: image.mime, name: `${job.tool}-${index + 1}.${extension}`, path: filePath, expiresAt: new Date(Date.now() + RETENTION_MS) });
              imageCount++;
            }
          } else errorMessage = `Upstream HTTP ${upstream.status}`;
        } catch (error) { errorMessage = error instanceof Error ? error.message.slice(0, 500) : 'Upstream request failed'; }
        await store.finishJob(job, status, responseStatus, responseType, responsePath, imageCount, errorMessage);
      }
    } finally { draining = false; }
  }

  async function waitForCompletion(id) {
    const until = Date.now() + 20_000;
    while (Date.now() < until) {
      const job = await store.getJob(id);
      if (job && !['queued', 'running'].includes(job.status)) return job;
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    return null;
  }

  app.post(/^\/api\/ai\/(openai|gemini)\/(.+)$/, express.raw({ type: '*/*', limit: MAX_REQUEST_BYTES }), async (req, res, next) => { try {
    const provider = req.params[0];
    const apiPath = allowedAiPath(provider, `/${req.params[1]}${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`);
    if (!apiPath) return res.status(404).json({ error: 'Unsupported AI endpoint' });
    if (!Buffer.isBuffer(req.body)) return res.status(400).json({ error: 'Missing request body' });
    const fallbackKey = String(req.get('x-client-api-key') || '').trim();
    if (!(provider === 'openai' ? env.OPENAI_API_KEY : env.GEMINI_API_KEY) && !fallbackKey) return res.status(428).json({ error: `Configure a ${provider} API key` });
    const bodyPath = path.join(canonicalDataDir, `${randomUUID()}.request`);
    await writeFile(bodyPath, req.body, { flag: 'wx', mode: 0o600 });
    const contentType = String(req.get('content-type') || 'application/json');
    const id = await store.createJob({
      source: 'web-agents', tool: cleanTool(req.get('x-tool')), provider,
      model: modelName(contentType, req.body, provider, apiPath), username: req.studioUser.username,
      path: apiPath, bodyPath, contentType,
      encryptedKey: (provider === 'openai' ? env.OPENAI_API_KEY : env.GEMINI_API_KEY) ? null : encryptTemporaryKey(fallbackKey, env.SESSION_SECRET),
    });
    res.set('X-Studio-Job-Id', id);
    void drain().catch((error) => console.error('AI queue failed:', error.message));
    const job = await waitForCompletion(id);
    if (!job) return res.status(202).json({ jobId: id, status: 'running' });
    if (!job.response_body_path) return res.status(502).json({ jobId: id, error: job.error_message || 'AI request failed' });
    res.status(job.response_status).type(job.response_content_type).send(await readFile(job.response_body_path));
  } catch (error) { next(error); } });

  app.post(/^\/api\/integrations\/ai\/(openai|gemini)\/(.+)$/, express.raw({ type: '*/*', limit: MAX_REQUEST_BYTES }), async (req, res, next) => { try {
    const provider = req.params[0];
    const apiPath = allowedAiPath(provider, `/${req.params[1]}${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`);
    if (!apiPath) return res.status(404).json({ error: 'Unsupported AI endpoint' });
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Missing request body' });
    const tool = String(req.get('x-tool') || '');
    if (cleanTool(tool) !== tool || tool === 'unknown') return res.status(400).json({ error: 'X-Tool must be a stable lowercase tool ID' });
    if (!(provider === 'openai' ? env.OPENAI_API_KEY : env.GEMINI_API_KEY)) return res.status(503).json({ error: `${provider} server key is not configured` });
    const bodyPath = path.join(canonicalDataDir, `${randomUUID()}.request`);
    await writeFile(bodyPath, req.body, { flag: 'wx', mode: 0o600 });
    const contentType = String(req.get('content-type') || 'application/json');
    const id = await store.createJob({
      source: `integration:${req.integrationProject}`, tool, provider,
      model: modelName(contentType, req.body, provider, apiPath), username: `integration:${req.integrationProject}`,
      path: apiPath, bodyPath, contentType, encryptedKey: null,
    });
    res.set('X-Studio-Job-Id', id);
    void drain().catch((error) => console.error('AI queue failed:', error.message));
    const job = await waitForCompletion(id);
    if (!job) return res.status(202).json({ jobId: id, status: 'running' });
    if (!job.response_body_path) return res.status(502).json({ jobId: id, error: job.error_message || 'AI request failed' });
    res.status(job.response_status).type(job.response_content_type).send(await readFile(job.response_body_path));
  } catch (error) { next(error); } });
  app.get('/api/integrations/jobs/:id', async (req, res, next) => { try {
    const job = await store.getJob(req.params.id);
    if (!job || job.source !== `integration:${req.integrationProject}`) return res.status(404).json({ error: 'Job not found' });
    res.json(publicJob(job));
  } catch (error) { next(error); } });
  app.get('/api/integrations/jobs/:id/response', async (req, res, next) => { try {
    const job = await store.getJob(req.params.id);
    if (!job || job.source !== `integration:${req.integrationProject}`) return res.status(404).json({ error: 'Job not found' });
    if (job.status === 'queued' || job.status === 'running') return res.status(202).json({ jobId: job.id, status: job.status });
    if (!job.response_body_path) return res.status(502).json({ jobId: job.id, error: job.error_message || 'AI request failed' });
    res.status(job.response_status).type(job.response_content_type).send(await readFile(job.response_body_path));
  } catch (error) { next(error); } });
  app.post('/api/integrations/jobs/:id/cancel', async (req, res, next) => { try {
    const job = await store.getJob(req.params.id);
    if (!job || job.source !== `integration:${req.integrationProject}`) return res.status(404).json({ error: 'Job not found' });
    if (!await store.cancelQueuedJob(job.id)) return res.status(409).json({ error: 'Only queued jobs can be cancelled' });
    res.json({ ok: true });
  } catch (error) { next(error); } });

  async function cleanup() {
    for (const asset of [...await store.expiredAssets(), ...await store.orphanAssets()]) {
      if (asset.file_path) await unlink(asset.file_path).catch(() => {});
      await store.markAssetExpired(asset.id);
    }
    for (const job of await store.expiredJobFiles()) {
      for (const value of [job.request_body_path, job.response_body_path]) if (value) await unlink(value).catch(() => {});
      await store.clearJobFiles(job.id);
    }
  }
  const cleanupTimer = setInterval(() => { void cleanup().catch((error) => console.error('Cleanup failed:', error.message)); }, 24 * 60 * 60 * 1000);
  cleanupTimer.unref();
  const queueTimer = setInterval(() => { void drain().catch((error) => console.error('AI queue failed:', error.message)); }, 3000);
  queueTimer.unref();
  void cleanup().catch((error) => console.error('Startup cleanup failed:', error.message));
  void drain().catch((error) => console.error('Startup queue failed:', error.message));
  const dist = path.join(root, 'dist');
  app.use(express.static(dist, { index: false }));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  app.use((error, _req, res, _next) => {
    console.error('Server error:', error instanceof Error ? error.message : error);
    if (!res.headersSent) res.status(error.status || 500).json({ error: error.status === 413 ? 'Upload too large' : 'Server request failed' });
  });
  const server = createServer(app);
  return { app, store, server, cleanup, close: async () => { clearInterval(cleanupTimer); clearInterval(queueTimer); await new Promise((resolve) => server.listening ? server.close(resolve) : resolve()); await store.close(); } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createStudioServer().then(({ server }) => {
    const port = Number(process.env.PORT || 3000);
    server.listen(port, '0.0.0.0', () => console.log(`Studio server listening on ${port}`));
  }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
