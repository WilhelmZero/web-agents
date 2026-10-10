import express from 'express';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, unlink, mkdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.mjs';
import { createMemoryStore } from './memory-store.mjs';
import { createSession, decryptTemporaryKey, encryptTemporaryKey, passwordHash, readUsers, verifyPassword, verifySession } from './security.mjs';
import { readIntegrationKeys, verifyIntegrationKey } from './integration-auth.mjs';
import { createDemandWorker, normalizedDemand, publicDemand, DEMAND_TYPES, DEMAND_PLATFORMS } from './demand-workflow.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const MAX_REQUEST_BYTES = 80 * 1024 * 1024;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const providerHosts = {
  openai: 'https://api.openai.com',
  gemini: 'https://generativelanguage.googleapis.com',
};
const CREATIVE_TOOLS = new Set(['cup-wrap-print','workflow','scene','scene-replace','scene-logo-replace','scene-replace-tabs','auto-scene-classify','auto-logo-classify','cup-resize','logo','logo-replace','logo-replace-tabs','logo-removal','logo-export','icon-vector-split','custom-monochrome-logo','pet-letter-stickers','ai-pet-letter-stickers','paper-text','background-removal','spot-color-tiff','outpaint','object-replace','inpaint','product-detail']);
const ROLES = new Set(['operator','artist','admin','custom']);

function publicAccount(username, account) {
  return { username, role: account.role || (account.admin ? 'admin' : 'operator'), admin: Boolean(account.admin),
    allowedTools: account.role === 'custom' ? account.allowedTools || [] : [...CREATIVE_TOOLS], source: account.source || 'database', disabled: Boolean(account.disabled) };
}

function permitted(user, tool) {
  return tool === 'operating-demand' || user?.role !== 'custom' || user.allowedTools?.includes(tool);
}

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
  for (const row of await (store.listAccounts?.() || [])) {
    if (users.has(row.username)) continue;
    let allowedTools = [];
    try { allowedTools = JSON.parse(row.allowed_tools || '[]'); } catch { /* reject malformed saved permissions */ }
    users.set(row.username, { passwordHash: (await store.getAccount(row.username))?.password_hash,
      role: row.role, admin: row.role === 'admin', allowedTools, source: 'database', disabled: Boolean(row.disabled) });
  }
  for (const [username, account] of users) {
    if (!account.role) users.set(username, { ...account, role: account.admin ? 'admin' : 'operator', source: 'environment' });
  }
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
    if (!candidate || candidate.disabled || !verifyPassword(String(req.body?.password || ''), candidate.passwordHash)) {
      state.count++; attempts.set(ip, state);
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    attempts.delete(ip);
    const token = createSession(username, env.SESSION_SECRET);
    const secure = env.NODE_ENV === 'production' ? '; Secure' : '';
    res.set('Set-Cookie', `studio_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${secure}`);
    return res.json(publicAccount(username, candidate));
  });
  app.post('/api/auth/logout', (_req, res) => {
    res.set('Set-Cookie', `studio_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${env.NODE_ENV === 'production' ? '; Secure' : ''}`);
    res.json({ ok: true });
  });
  app.get('/api/auth/session', (req, res) => {
    const user = verifySession(safeCookie(req, 'studio_session'), env.SESSION_SECRET, users);
    if (!user || users.get(user.username)?.disabled) return res.status(401).json({ error: 'Login required' });
    res.json(publicAccount(user.username, users.get(user.username)));
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
    if (!user || users.get(user.username)?.disabled) return res.status(401).json({ error: 'Login required' });
    req.studioUser = publicAccount(user.username, users.get(user.username));
    next();
  });
  app.get('/api/accounts', async (req, res) => {
    if (!req.studioUser.admin) return res.status(403).json({ error: 'Admin required' });
    res.json([...users.entries()].map(([username, account]) => publicAccount(username, account)));
  });
  app.post('/api/accounts', express.json({ limit: '32kb' }), async (req, res, next) => { try {
    if (!req.studioUser.admin) return res.status(403).json({ error: 'Admin required' });
    const { username, password, role } = req.body || {};
    const allowedTools = Array.isArray(req.body?.allowedTools) ? req.body.allowedTools.filter((tool) => CREATIVE_TOOLS.has(tool)) : [];
    if (!/^[a-zA-Z0-9_.-]{2,64}$/.test(username || '') || !ROLES.has(role) || users.has(username) || typeof password !== 'string' || password.length < 12) return res.status(400).json({ error: 'Invalid or duplicate account; password needs at least 12 characters' });
    const hash = passwordHash(password);
    await store.createAccount({ username, passwordHash: hash, role, allowedTools });
    users.set(username, { passwordHash: hash, role, admin: role === 'admin', allowedTools, source: 'database' });
    res.status(201).json(publicAccount(username, users.get(username)));
  } catch (error) { next(error); } });
  app.put('/api/accounts/:username', express.json({ limit: '32kb' }), async (req, res, next) => { try {
    if (!req.studioUser.admin) return res.status(403).json({ error: 'Admin required' });
    const username = req.params.username;
    const current = users.get(username);
    if (!current || current.source !== 'database' || !ROLES.has(req.body?.role)) return res.status(400).json({ error: 'Account cannot be edited' });
    if (username === req.studioUser.username && req.body?.disabled) return res.status(400).json({ error: 'Cannot disable own account' });
    const allowedTools = Array.isArray(req.body?.allowedTools) ? req.body.allowedTools.filter((tool) => CREATIVE_TOOLS.has(tool)) : [];
    if (req.body.password && (typeof req.body.password !== 'string' || req.body.password.length < 12)) return res.status(400).json({ error: 'Password needs at least 12 characters' });
    const hash = req.body.password ? passwordHash(req.body.password) : null;
    await store.updateAccount(username, { role: req.body.role, allowedTools, disabled: Boolean(req.body.disabled), passwordHash: hash });
    users.set(username, { passwordHash: hash || current.passwordHash, role: req.body.role, admin: req.body.role === 'admin', allowedTools, source: 'database', disabled: Boolean(req.body.disabled) });
    res.json({ ok: true });
  } catch (error) { next(error); } });
  app.get('/api/accounts/assignable', (req, res) => {
    res.json([...users.entries()].filter(([, account]) => account.role === 'artist' && !account.disabled).map(([username]) => ({ username })));
  });
  let kickDemand = () => {};
  const demandResponse = async (row) => publicDemand(row, await store.listDemandOperations(row.id));
  app.get('/api/demand-presets', async (_req, res, next) => { try {
    res.json((await store.listDemandPresets()).map((row) => JSON.parse(row.content_json)));
  } catch (error) { next(error); } });
  app.put('/api/demand-presets/:id', express.json({ limit: '256kb' }), async (req, res, next) => { try {
    const value = req.body || {};
    if (!/^[a-f0-9-]{36}$/.test(req.params.id) || (value.platform && !DEMAND_PLATFORMS.includes(value.platform)) || (value.type && !DEMAND_TYPES.includes(value.type))) return res.status(400).json({ error: 'Invalid preset' });
    if (!String(value.name || '').trim() || !Array.isArray(value.requirements) || value.requirements.length > 20) return res.status(400).json({ error: 'Preset name and image requirements are required' });
    const preset = { ...value, id: req.params.id, name: String(value.name).slice(0, 120) };
    await store.saveDemandPreset(preset);
    res.json(preset);
  } catch (error) { next(error); } });
  app.delete('/api/demand-presets/:id', async (req, res, next) => { try {
    res.json({ deleted: await store.deleteDemandPreset(req.params.id) });
  } catch (error) { next(error); } });
  app.get('/api/demands', async (_req, res, next) => { try {
    res.json(await Promise.all((await store.listDemands()).map(demandResponse)));
  } catch (error) { next(error); } });
  app.get('/api/demands/todos', async (req, res, next) => { try {
    const rows = await store.listDemandTodos(req.studioUser.username);
    res.json(await Promise.all(rows.map(demandResponse)));
  } catch (error) { next(error); } });
  app.get('/api/demands/:id', async (req, res, next) => { try {
    const row = await store.getDemand(req.params.id);
    if (!row) return res.status(404).json({ error: 'Demand not found' });
    res.json(await demandResponse(row));
  } catch (error) { next(error); } });
  app.post('/api/demands', express.json({ limit: '256kb' }), async (req, res, next) => { try {
    if (req.body?.id && !/^[a-f0-9-]{36}$/.test(req.body.id)) return res.status(400).json({ error: 'Invalid demand ID' });
    const content = normalizedDemand(req.body?.content);
    for (const item of content.assets) {
      const asset = await store.getAsset(item.assetId);
      if (!asset || asset.tool !== 'operating-demand' || asset.expired || !asset.mime.startsWith('image/')) return res.status(400).json({ error: 'Invalid demand image' });
    }
    const assignee = req.body?.assignee || null;
    if (assignee && (users.get(assignee)?.role !== 'artist' || users.get(assignee)?.disabled)) return res.status(400).json({ error: 'Assignee must be an active artist account' });
    const row = await store.saveDemand({ id: req.body?.id, expectedRevision: req.body?.revision,
      creator: req.studioUser.username, assignee, content });
    if (!row) return res.status(409).json({ error: 'Demand changed; reload before saving' });
    await store.createDemandOperation({ demandId: row.id, revision: row.revision, kind: 'analyze' });
    kickDemand();
    res.status(req.body?.id ? 200 : 201).json(await demandResponse(row));
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid demand' }); } });
  app.put('/api/demands/:id/analysis', express.json({ limit: '64kb' }), async (req, res, next) => { try {
    const row = await store.getDemand(req.params.id);
    if (!row) return res.status(404).json({ error: 'Demand not found' });
    if (row.revision !== req.body?.revision || !row.analysis_json) return res.status(409).json({ error: 'Analysis is stale or unavailable' });
    const analysis = JSON.parse(row.analysis_json);
    const model = req.body?.parameters?.model;
    const prompts = req.body?.parameters?.prompts;
    if (!['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'].includes(model) || !Array.isArray(prompts) || prompts.length !== JSON.parse(row.content_json).specifications.length) return res.status(400).json({ error: 'Invalid suggested parameters' });
    analysis.parameters = { model, prompts: prompts.map((value) => String(value).slice(0, 4000)) };
    await store.updateDemandAnalysis(row.id, row.revision, analysis);
    res.json(await demandResponse(await store.getDemand(row.id)));
  } catch (error) { next(error); } });
  app.post('/api/demands/:id/execute', async (req, res, next) => { try {
    const row = await store.getDemand(req.params.id);
    if (!row) return res.status(404).json({ error: 'Demand not found' });
    const analysis = row.analysis_json ? JSON.parse(row.analysis_json) : null;
    if (!analysis?.executable || !permitted(req.studioUser, analysis.tool)) return res.status(403).json({ error: 'Automatic execution is not available for this demand' });
    const operation = await store.createDemandOperation({ demandId: row.id, revision: row.revision, kind: 'execute', payload: { analysis } });
    kickDemand();
    res.status(202).json({ id: operation.id, status: operation.status });
  } catch (error) { next(error); } });
  app.post('/api/demands/:id/retry/:operationId', async (req, res, next) => { try {
    const op = await store.getDemandOperation(req.params.operationId);
    const row = await store.getDemand(req.params.id);
    if (!row || !op || op.demand_id !== row.id || op.revision !== row.revision) return res.status(404).json({ error: 'Operation not found' });
    if (op.kind === 'execute') {
      const payload = JSON.parse(op.payload_json || '{}');
      if (!permitted(req.studioUser, payload.analysis?.tool)) return res.status(403).json({ error: 'Tool access denied' });
    }
    if (!await store.retryDemandOperation(op.id)) return res.status(409).json({ error: 'Only failed or interrupted operations can be retried' });
    kickDemand(); res.json({ ok: true });
  } catch (error) { next(error); } });
  app.post('/api/demands/:id/complete', async (req, res, next) => { try {
    const row = await store.getDemand(req.params.id);
    if (!row) return res.status(404).json({ error: 'Demand not found' });
    if (row.assignee !== req.studioUser.username && !req.studioUser.admin) return res.status(403).json({ error: 'Assignee or admin required' });
    await store.completeDemand(row.id);
    res.json(await demandResponse(await store.getDemand(row.id)));
  } catch (error) { next(error); } });
  app.get('/api/config', (_req, res) => res.json({ openai: Boolean(env.OPENAI_API_KEY), gemini: Boolean(env.GEMINI_API_KEY) }));
  app.get('/api/results', async (req, res, next) => { try {
    const tool = typeof req.query.tool === 'string' && req.query.tool !== 'all' ? cleanTool(req.query.tool) : undefined;
    const status = req.query.status === 'available' || req.query.status === 'expired' ? req.query.status : undefined;
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 40));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    if (tool && !permitted(req.studioUser, tool)) return res.status(403).json({ error: 'Tool access denied' });
    res.json((await store.listResults({ tool, status, limit, offset })).filter((row) => permitted(req.studioUser, row.tool)).map(publicResult));
  } catch (error) { next(error); } });
  app.get('/api/results/operation/:operationId', async (req, res, next) => { try {
    const result = await store.getResultByOperation(req.params.operationId);
    if (!result) return res.status(404).json({ error: 'Result not found' });
    if (!permitted(req.studioUser, result.tool)) return res.status(403).json({ error: 'Tool access denied' });
    res.json(publicResult(result));
  } catch (error) { next(error); } });
  app.get('/api/results/:id', async (req, res, next) => { try {
    const result = await store.getResult(req.params.id);
    if (!result) return res.status(404).json({ error: 'Result not found' });
    if (!permitted(req.studioUser, result.tool)) return res.status(403).json({ error: 'Tool access denied' });
    res.json(publicResult(result));
  } catch (error) { next(error); } });
  app.post('/api/results', express.json({ limit: '1mb' }), async (req, res, next) => { try {
    const operationId = String(req.body?.operationId || '');
    const tool = String(req.body?.tool || '');
    if (!permitted(req.studioUser, tool)) return res.status(403).json({ error: 'Tool access denied' });
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
    res.json(await Promise.all(jobs.filter((job) => permitted(_req.studioUser, job.tool)).map(async (job) => publicJob(job, await store.assetsForJob(job.id)))));
  } catch (error) { next(error); } });
  app.get('/api/jobs/:id', async (req, res, next) => { try {
    const job = await store.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!permitted(req.studioUser, job.tool)) return res.status(403).json({ error: 'Tool access denied' });
    res.json(publicJob(job, await store.assetsForJob(job.id)));
  } catch (error) { next(error); } });
  app.get('/api/jobs/:id/response', async (req, res, next) => { try {
    const job = await store.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (!permitted(req.studioUser, job.tool)) return res.status(403).json({ error: 'Tool access denied' });
    if (job.status === 'queued' || job.status === 'running') return res.status(202).json({ jobId: job.id, status: job.status });
    if (!job.response_body_path) return res.status(502).json({ jobId: job.id, error: job.error_message || 'AI request failed' });
    res.status(job.response_status).type(job.response_content_type).send(await readFile(job.response_body_path));
  } catch (error) { next(error); } });
  app.post('/api/jobs/:id/cancel', async (req, res, next) => { try {
    const job = await store.getJob(req.params.id);
    if (!job || !permitted(req.studioUser, job.tool)) return res.status(403).json({ error: 'Tool access denied' });
    if (!await store.cancelQueuedJob(req.params.id)) return res.status(409).json({ error: 'Only queued jobs can be cancelled' });
    res.json({ ok: true });
  } catch (error) { next(error); } });
  app.get('/api/assets/:id', async (req, res, next) => { try {
    const asset = await store.getAsset(req.params.id);
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    if (!permitted(req.studioUser, asset.tool)) return res.status(403).json({ error: 'Tool access denied' });
    if (asset.expired || !asset.file_path) return res.status(410).json({ error: 'Asset expired' });
    const filePath = path.resolve(asset.file_path);
    if (!filePath.startsWith(canonicalDataDir + path.sep)) return res.status(500).json({ error: 'Invalid asset path' });
    const details = await stat(filePath);
    res.type(asset.mime).set('Content-Length', String(details.size));
    createReadStream(filePath).on('error', next).pipe(res);
  } catch (error) { next(error); } });
  app.get('/api/documents/:key', async (req, res, next) => { try {
    const tool = req.params.key.split(':')[0];
    if (CREATIVE_TOOLS.has(tool) && !permitted(req.studioUser, tool)) return res.status(403).json({ error: 'Tool access denied' });
    const doc = await store.getDocument(req.params.key);
    res.json(doc ? JSON.parse(doc.content_json) : null);
  } catch (error) { next(error); } });
  app.put('/api/documents/:key', express.json({ limit: '8mb', strict: false }), async (req, res, next) => { try {
    const tool = req.params.key.split(':')[0];
    if (CREATIVE_TOOLS.has(tool) && !permitted(req.studioUser, tool)) return res.status(403).json({ error: 'Tool access denied' });
    if (!/^[a-z0-9:_-]{1,160}$/.test(req.params.key)) return res.status(400).json({ error: 'Invalid document key' });
    await store.putDocument(req.params.key, req.body);
    res.json({ ok: true });
  } catch (error) { next(error); } });
  app.post('/api/assets', express.raw({ type: '*/*', limit: MAX_REQUEST_BYTES }), async (req, res, next) => { try {
    if (!permitted(req.studioUser, cleanTool(req.get('x-tool')))) return res.status(403).json({ error: 'Tool access denied' });
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

  const demandWorker = createDemandWorker({ store, dataDir: canonicalDataDir, invokeAi: async ({ path: aiPath, contentType, bytes, model, tool, username }) => {
    if (!env.OPENAI_API_KEY) throw new Error('Server OPENAI_API_KEY is required for background demand tasks');
    const bodyPath = path.join(canonicalDataDir, `${randomUUID()}.request`);
    await writeFile(bodyPath, bytes, { flag: 'wx', mode: 0o600 });
    const jobId = await store.createJob({ source: 'operating-demand', tool, provider: 'openai', model, username,
      path: aiPath, bodyPath, contentType, encryptedKey: null });
    void drain().catch((error) => console.error('AI queue failed:', error.message));
    const timeout = Date.now() + 11 * 60_000;
    while (Date.now() < timeout) {
      const job = await store.getJob(jobId);
      if (job && !['queued', 'running'].includes(job.status)) {
        if (job.status !== 'success' || !job.response_body_path) throw new Error(job.error_message || `AI request failed: HTTP ${job.response_status || 502}`);
        return { response: await readFile(job.response_body_path), jobId };
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error('AI request did not complete in time; check the server job before retrying');
  } });
  kickDemand = () => { if (store.claimDemandOperation) void demandWorker.drain().catch((error) => console.error('Demand queue failed:', error.message)); };

  app.post(/^\/api\/ai\/(openai|gemini)\/(.+)$/, express.raw({ type: '*/*', limit: MAX_REQUEST_BYTES }), async (req, res, next) => { try {
    if (!permitted(req.studioUser, cleanTool(req.get('x-tool')))) return res.status(403).json({ error: 'Tool access denied' });
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
  const demandTimer = setInterval(kickDemand, 3000);
  demandTimer.unref();
  void cleanup().catch((error) => console.error('Startup cleanup failed:', error.message));
  void drain().catch((error) => console.error('Startup queue failed:', error.message));
  kickDemand();
  const dist = path.join(root, 'dist');
  app.use(express.static(dist, { index: false }));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  app.use((error, _req, res, _next) => {
    console.error('Server error:', error instanceof Error ? error.message : error);
    if (!res.headersSent) res.status(error.status || 500).json({ error: error.status === 413 ? 'Upload too large' : 'Server request failed' });
  });
  const server = createServer(app);
  return { app, store, server, cleanup, close: async () => { clearInterval(cleanupTimer); clearInterval(queueTimer); clearInterval(demandTimer); await new Promise((resolve) => server.listening ? server.close(resolve) : resolve()); await store.close(); } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createStudioServer().then(({ server }) => {
    const port = Number(process.env.PORT || 3000);
    server.listen(port, '0.0.0.0', () => console.log(`Studio server listening on ${port}`));
  }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
