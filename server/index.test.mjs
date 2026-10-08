import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStudioServer } from './index.mjs';
import { passwordHash } from './security.mjs';

function fakeStore() {
  const jobs = new Map();
  const assets = new Map();
  const documents = new Map();
  return {
    async init() {}, async close() {},
    async createJob(value) { const id = crypto.randomUUID(); jobs.set(id, { id, source: value.source, tool: value.tool, provider: value.provider, model: value.model, username: value.username, request_path: value.path, request_body_path: value.bodyPath, request_content_type: value.contentType, encrypted_key: value.encryptedKey, status: 'queued', attempts: 0, image_count: 0, created_at: new Date() }); return id; },
    async claimJob() { const job = [...jobs.values()].find((item) => item.status === 'queued'); if (!job) return null; job.status = 'running'; job.attempts++; return job; },
    async getJob(id) { return jobs.get(id) || null; },
    async listJobs() { return [...jobs.values()]; },
    async cancelQueuedJob(id) { const job = jobs.get(id); if (job?.status !== 'queued') return false; job.status = 'cancelled'; return true; },
    async finishJob(job, status, responseStatus, contentType, bodyPath, imageCount, errorMessage) { Object.assign(job, { status, response_status: responseStatus, response_content_type: contentType, response_body_path: bodyPath, image_count: imageCount, error_message: errorMessage, completed_at: new Date(), encrypted_key: null }); },
    async createAsset(asset) { const id = crypto.randomUUID(); assets.set(id, { id, ...asset, expired: false, file_path: asset.path }); return id; },
    async getAsset(id) { return assets.get(id) || null; },
    async assetsForJob(id) { return [...assets.values()].filter((asset) => asset.jobId === id); },
    async expiredAssets() { return [...assets.values()].filter((asset) => asset.expiresAt && asset.expiresAt < new Date() && !asset.expired).map((asset) => ({ id: asset.id, file_path: asset.file_path })); },
    async orphanAssets() { return []; }, async expiredJobFiles() { return []; },
    async markAssetExpired(id) { const asset = assets.get(id); asset.expired = true; asset.file_path = null; },
    async clearJobFiles() {},
    async getDocument(key) { return documents.has(key) ? { content_json: JSON.stringify(documents.get(key)) } : null; },
    async putDocument(key, value) { documents.set(key, value); }, async usage() { return []; },
  };
}

test('login protects routes and server key takes precedence over browser fallback', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'studio-server-test-'));
  const env = {
    SESSION_SECRET: 'a-secure-session-secret-of-at-least-32-characters',
    APP_USERS_JSON: JSON.stringify({ admin: { passwordHash: passwordHash('valid-password-12345'), admin: true } }),
    APP_DATA_DIR: directory, OPENAI_API_KEY: 'server-key', NODE_ENV: 'test',
  };
  const stateStore = fakeStore();
  const instance = await createStudioServer(env, { store: stateStore });
  await new Promise((resolve) => instance.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${instance.server.address().port}`;
  const originalFetch = globalThis.fetch;
  let seenKey = '';
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith('https://api.openai.com')) {
      seenKey = options.headers.Authorization;
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('image').toString('base64') }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return originalFetch(url, options);
  };
  try {
    assert.equal((await fetch(`${base}/api/config`)).status, 401);
    const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'valid-password-12345' }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const config = await fetch(`${base}/api/config`, { headers: { Cookie: cookie } });
    assert.deepEqual(await config.json(), { openai: true, gemini: false });
    const documentPut = await fetch(`${base}/api/documents/custom-logo%3Acurrent`, { method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify('task:example') });
    assert.equal(documentPut.status, 200);
    const documentGet = await fetch(`${base}/api/documents/custom-logo%3Acurrent`, { headers: { Cookie: cookie } });
    assert.equal(await documentGet.json(), 'task:example');
    const response = await fetch(`${base}/api/ai/openai/v1/images/generations`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Client-Api-Key': 'browser-key', 'X-Tool': 'scene' }, body: JSON.stringify({ model: 'gpt-image-2', prompt: 'test' }) });
    assert.equal(response.status, 200, await response.text());
    assert.equal(seenKey, 'Bearer server-key');
    const jobs = await (await fetch(`${base}/api/jobs`, { headers: { Cookie: cookie } })).json();
    assert.equal(jobs[0].imageCount, 1);
    assert.equal(jobs[0].source, 'web-agents');
    assert.equal(jobs[0].assets.length, 1);
    assert.equal((await fetch(`${base}/api/assets/${jobs[0].assets[0].id}`)).status, 401);
    assert.equal((await fetch(`${base}/api/assets/${jobs[0].assets[0].id}`, { headers: { Cookie: cookie } })).status, 200);
    const expiredPath = path.join(directory, 'expired-image');
    await writeFile(expiredPath, 'expired');
    const expiredId = await stateStore.createAsset({ tool: 'scene', mime: 'image/png', name: 'old.png', path: expiredPath, expiresAt: new Date(0) });
    await instance.cleanup();
    assert.equal((await fetch(`${base}/api/assets/${expiredId}`, { headers: { Cookie: cookie } })).status, 410);
  } finally {
    globalThis.fetch = originalFetch;
    await instance.close();
  }
});
