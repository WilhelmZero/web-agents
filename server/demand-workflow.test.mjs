import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createStudioServer } from './index.mjs';
import { passwordHash } from './security.mjs';
import { normalizedDemand, effectiveSpecifications } from './demand-workflow.mjs';

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

test('shared image requirements apply to every output while per-image fields override them', () => {
  const demand = normalizedDemand({ description: 'Make listing images', commonRequirements: {
    content: 'White background for every image', count: 3, width: 1200, height: 800, dpi: 300, maxMB: 5,
  }, specifications: [{ content: 'Show the front', dpi: 150 }] });
  assert.equal(demand.specifications.length, 3);
  assert.equal(demand.specifications[0].customized, true);
  assert.equal(demand.specifications[1].customized, false);
  const output = effectiveSpecifications(demand);
  assert.deepEqual(output.map((item) => item.content), ['Show the front', 'White background for every image', 'White background for every image']);
  assert.deepEqual(output.map((item) => item.dpi), [150, 300, 300]);
  assert.deepEqual(output.map((item) => item.width), [1200, 1200, 1200]);
  assert.equal(output[2].ratio, 1.5);
  assert.deepEqual(normalizedDemand(demand).specifications.map((item) => item.id), demand.specifications.map((item) => item.id));
  assert.throws(() => normalizedDemand({ description: 'x', commonRequirements: { count: 21 } }), /count/);
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
    if (String(url).startsWith('https://api.openai.com/v1/responses')) {
      const requestBody = JSON.parse(options.body.toString());
      const wantsMonochromeLogo = requestBody.input[1].content[0].text.includes('black-and-white customer logo');
      return Promise.resolve(new Response(JSON.stringify({ output: [{ content: [{ type: 'output_text', text: JSON.stringify({ tool: wantsMonochromeLogo ? 'custom-monochrome-logo' : 'scene', model: 'gpt-image-2.5-flare', rationale: wantsMonochromeLogo ? 'The final deliverable is a monochrome logo' : 'Scene matches the request', prompts: [wantsMonochromeLogo ? 'Keep the logo black and white' : 'Put the product on a table'] }) }] }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
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
    const batchCreated = await request('/api/demands', adminCookie, 'POST', { content: {
      description: 'Show the product in two listing scenes', type: 'scene',
      assets: [{ assetId, name: 'source.png', role: 'source' }],
      commonRequirements: { content: 'Use a clean background', count: 2, width: 200, height: 200, dpi: 240 }, specifications: [],
    } });
    assert.equal(batchCreated.status, 201);
    const batch = await batchCreated.json();
    await until(async () => (await request(`/api/demands/${batch.id}`, adminCookie)).json(), (value) => value.analysis?.executable);
    assert.equal((await request(`/api/demands/${batch.id}/execute`, adminCookie, 'POST')).status, 202);
    const batchFinished = await until(async () => (await request(`/api/demands/${batch.id}`, adminCookie)).json(),
      (value) => value.operations.some((op) => op.kind === 'execute' && op.status === 'completed'));
    assert.equal(batchFinished.operations.find((op) => op.kind === 'execute').result.length, 2);
    assert.equal((await (await request('/api/results?tool=scene', adminCookie)).json()).length, 3);
    const logoCreated = await request('/api/demands', adminCookie, 'POST', { content: {
      title: 'Engraving artwork', description: 'Make a black-and-white customer logo for engraving', type: 'logo-design',
      assets: [{ assetId, name: 'source.png', role: 'source' }], specifications: [{ id: crypto.randomUUID(), content: 'Final monochrome logo' }],
    } });
    assert.equal(logoCreated.status, 201);
    const logoDemand = await logoCreated.json();
    const logoAnalyzed = await until(async () => (await request(`/api/demands/${logoDemand.id}`, adminCookie)).json(), (value) => value.analysis?.executable);
    assert.equal(logoAnalyzed.analysis.tool, 'custom-monochrome-logo');
    assert.equal((await request(`/api/demands/${logoDemand.id}/execute`, adminCookie, 'POST')).status, 202);
    const logoCompleted = await until(async () => (await request(`/api/demands/${logoDemand.id}`, adminCookie)).json(), (value) => value.operations.some((op) => op.kind === 'execute' && op.status === 'completed'));
    assert.equal(logoCompleted.operations.find((op) => op.kind === 'execute').result[0].status, 'completed');
    assert.equal((await (await request('/api/results?tool=custom-monochrome-logo', adminCookie)).json()).length, 1);
    const untypedLogo = await request('/api/demands', adminCookie, 'POST', { content: {
      description: 'Create a black-and-white customer logo from this source image',
      assets: [{ assetId, name: 'source.png', role: 'source' }],
    } });
    assert.equal(untypedLogo.status, 201);
    const untypedDemand = await untypedLogo.json();
    const untypedAnalyzed = await until(async () => (await request(`/api/demands/${untypedDemand.id}`, adminCookie)).json(), (value) => value.analysis?.executable);
    assert.equal(untypedAnalyzed.analysis.tool, 'custom-monochrome-logo');
    assert.equal((await request(`/api/demands/${demand.id}/complete`, artistCookie, 'POST')).status, 200);
    assert.equal((await (await request('/api/demands/todos', artistCookie)).json()).length, 0);
  } finally {
    globalThis.fetch = nativeFetch;
    await instance.close();
  }
});
