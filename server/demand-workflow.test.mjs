import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createStudioServer } from './index.mjs';
import { passwordHash } from './security.mjs';
import { normalizedDemand } from './demand-workflow.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fetchValue, check) {
  for (let index = 0; index < 80; index++) {
    const value = await fetchValue();
    if (check(value)) return value;
    await sleep(150);
  }
  throw new Error('Timed out waiting for demand operation');
}

test('image requirements calculate ratio and reject inconsistent sizes', () => {
  const value = normalizedDemand({ description: 'make an image', platform: 'SHEI', specifications: [{ width: 1200, height: 800, dpi: 300 }] });
  assert.equal(value.platform, 'SHEIN');
  assert.equal(value.specifications[0].ratio, 1.5);
  assert.throws(() => normalizedDemand({ description: 'x', specifications: [{ width: 1000 }] }), /resolution/);
  assert.throws(() => normalizedDemand({ description: 'x', specifications: [{ ratio: -1 }] }), /positive/);
});

test('demand accounts, assignment, analysis, auto execution and tool permissions', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'studio-demand-test-'));
  const env = { SESSION_SECRET: 'demand-session-secret-at-least-32-characters', APP_USERS_JSON: JSON.stringify({
    admin: { passwordHash: passwordHash('valid-password-12345'), admin: true },
  }), APP_DATA_DIR: directory, ALLOW_MEMORY_STORE: '1', NODE_ENV: 'test', OPENAI_API_KEY: 'server-key' };
  const instance = await createStudioServer(env);
  await new Promise((resolve) => instance.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${instance.server.address().port}`;
  const nativeFetch = globalThis.fetch;
  const generated = await sharp({ create: { width: 64, height: 64, channels: 4, background: '#ffffff' } }).png().toBuffer();
  globalThis.fetch = (url, options) => {
    if (String(url).startsWith('https://api.openai.com/v1/responses')) return Promise.resolve(new Response(JSON.stringify({ output: [{ content: [{ type: 'output_text', text: JSON.stringify({ tool: 'scene', model: 'gpt-image-2.5-flare', rationale: 'Scene matches the request', prompts: ['Put the product on a table'] }) }] }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    if (String(url).startsWith('https://api.openai.com/v1/images/edits')) return Promise.resolve(new Response(JSON.stringify({ data: [{ b64_json: generated.toString('base64') }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    return nativeFetch(url, options);
  };
  const request = async (url, cookie, method = 'GET', data) => nativeFetch(base + url, { method, headers: { Cookie: cookie, ...(data ? { 'Content-Type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined });
  try {
    const login = await request('/api/auth/login', '', 'POST', { username: 'admin', password: 'valid-password-12345' });
    assert.equal(login.status, 200);
    const adminCookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await request('/api/accounts', adminCookie, 'POST', { username: 'artist1', password: 'artist-password-123', role: 'artist' })).status, 201);
    assert.equal((await request('/api/accounts', adminCookie, 'POST', { username: 'limited', password: 'limited-password-123', role: 'custom', allowedTools: ['scene'] })).status, 201);
    const artistLogin = await request('/api/auth/login', '', 'POST', { username: 'artist1', password: 'artist-password-123' });
    const artistCookie = artistLogin.headers.get('set-cookie').split(';')[0];
    assert.equal((await request('/api/accounts', artistCookie)).status, 403);
    const limitedLogin = await request('/api/auth/login', '', 'POST', { username: 'limited', password: 'limited-password-123' });
    const limitedCookie = limitedLogin.headers.get('set-cookie').split(';')[0];
    assert.equal((await nativeFetch(base + '/api/ai/openai/v1/images/generations', { method: 'POST', headers: { Cookie: limitedCookie, 'Content-Type': 'application/json', 'X-Tool': 'logo-removal' }, body: '{}' })).status, 403);

    const upload = await nativeFetch(base + '/api/assets', { method: 'POST', headers: { Cookie: adminCookie, 'Content-Type': 'image/png', 'X-Tool': 'operating-demand', 'X-File-Name': 'source.png' }, body: generated });
    assert.equal(upload.status, 201);
    const { id: assetId } = await upload.json();
    const created = await request('/api/demands', adminCookie, 'POST', { assignee: 'artist1', content: {
      title: 'Scene brief', description: 'Show the product in a room', type: 'scene', platform: 'AMAZON',
      assets: [{ assetId, name: 'source.png', role: 'source' }], specifications: [{ id: crypto.randomUUID(), content: 'Hero image', width: 200, height: 200, dpi: 300 }],
    } });
    const createdBody = await created.text();
    assert.equal(created.status, 201, createdBody);
    const demand = JSON.parse(createdBody);
    assert.ok(demand?.id);
    const noChange = await request('/api/demands', adminCookie, 'POST', { id: demand.id, revision: demand.revision, assignee: 'artist1', content: demand.content });
    assert.equal((await noChange.json()).revision, demand.revision);
    const analyzed = await until(async () => (await request(`/api/demands/${demand.id}`, adminCookie)).json(), (value) => value.analysis?.executable);
    assert.equal(analyzed.analysis.tool, 'scene');
    const todo = await (await request('/api/demands/todos', artistCookie)).json();
    assert.equal(todo[0].id, demand.id);
    assert.equal((await request(`/api/demands/${demand.id}/execute`, adminCookie, 'POST')).status, 202);
    const completed = await until(async () => (await request(`/api/demands/${demand.id}`, adminCookie)).json(), (value) => value.operations.some((op) => op.kind === 'execute' && op.status === 'completed'));
    assert.equal(completed.operations.find((op) => op.kind === 'execute').result[0].status, 'completed');
    const results = await (await request('/api/results?tool=scene', adminCookie)).json();
    assert.equal(results.length, 1);
    assert.equal(results[0].exportSpec.dpi, 300);
    assert.equal((await request(`/api/demands/${demand.id}/complete`, artistCookie, 'POST')).status, 200);
    assert.equal((await (await request('/api/demands/todos', artistCookie)).json()).length, 0);
  } finally {
    globalThis.fetch = nativeFetch;
    await instance.close();
  }
});
