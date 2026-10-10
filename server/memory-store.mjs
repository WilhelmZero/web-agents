import { randomUUID } from 'node:crypto';
import { DEFAULT_DEMAND_PRESETS } from './demand-presets.mjs';

// Local UI smoke tests only. Production always requires MySQL.
export function createMemoryStore() {
  const jobs = new Map();
  const assets = new Map();
  const documents = new Map();
  const results = new Map();
  const usage = [];
  const accounts = new Map();
  const demandPresets = new Map();
  const demands = new Map();
  const demandOperations = new Map();
  return {
    async init() { for (const preset of DEFAULT_DEMAND_PRESETS) await this.saveDemandPreset(preset); }, async close() {},
    async createJob(value) {
      const id = randomUUID();
      jobs.set(id, { id, source: value.source, tool: value.tool, provider: value.provider, model: value.model, username: value.username, request_path: value.path, request_body_path: value.bodyPath, request_content_type: value.contentType, encrypted_key: value.encryptedKey, status: 'queued', attempts: 0, image_count: 0, created_at: new Date() });
      return id;
    },
    async claimJob() { const job = [...jobs.values()].find((item) => item.status === 'queued'); if (!job) return null; job.status = 'running'; job.attempts++; return job; },
    async getJob(id) { return jobs.get(id) || null; },
    async listJobs(limit = 100) { return [...jobs.values()].reverse().slice(0, limit); },
    async cancelQueuedJob(id) { const job = jobs.get(id); if (!job || job.status !== 'queued') return false; job.status = 'cancelled'; return true; },
    async finishJob(job, status, responseStatus, responseType, responsePath, imageCount, errorMessage) {
      Object.assign(job, { status, response_status: responseStatus, response_content_type: responseType, response_body_path: responsePath, image_count: imageCount, error_message: errorMessage, completed_at: new Date(), encrypted_key: null });
      usage.push({ day: new Date().toISOString().slice(0, 10), source: job.source, tool: job.tool, provider: job.provider, model: job.model, status, requests: 1, images: imageCount, retries: Math.max(0, job.attempts - 1) });
    },
    async createAsset(value) { const id = randomUUID(); assets.set(id, { id, job_id: value.jobId || null, tool: value.tool, mime: value.mime, name: value.name, file_path: value.path, expires_at: value.expiresAt || null, expired: false, created_at: new Date() }); return id; },
    async getAsset(id) { return assets.get(id) || null; },
    async assetsForJob(id) { return [...assets.values()].filter((asset) => asset.job_id === id); },
    async createResult(input) {
      const prior = [...results.values()].find((item) => item.operation_id === input.operationId);
      if (prior) return { ...assets.get(prior.asset_id), ...prior };
      const value = { id: randomUUID(), operation_id: input.operationId, tool: input.tool, username: input.username, name: input.name, asset_id: input.assetId, job_id: input.jobId || null, export_json: JSON.stringify(input.exportSpec || {}), created_at: new Date() };
      results.set(value.id, value);
      return { ...assets.get(value.asset_id), ...value };
    },
    async getResultByOperation(id) { const item = [...results.values()].find((value) => value.operation_id === id); return item ? { ...assets.get(item.asset_id), ...item } : null; },
    async getResult(id) { const item = results.get(id); return item ? { ...assets.get(item.asset_id), ...item } : null; },
    async listResults({ tool, status, limit = 40, offset = 0 } = {}) {
      return [...results.values()].filter((item) => (!tool || item.tool === tool) && (!status || status === 'all' || Boolean(assets.get(item.asset_id)?.expired) === (status === 'expired'))).reverse().slice(offset, offset + limit).map((item) => ({ ...assets.get(item.asset_id), ...item }));
    },
    async expiredAssets() { return [...assets.values()].filter((asset) => !asset.expired && asset.expires_at && asset.expires_at < new Date()); },
    async orphanAssets() { return []; },
    async markAssetExpired(id) { const asset = assets.get(id); if (asset) { asset.expired = true; asset.file_path = null; } },
    async expiredJobFiles() { return [...jobs.values()].filter((job) => job.completed_at && job.completed_at < new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) && (job.request_body_path || job.response_body_path)); },
    async clearJobFiles(id) { const job = jobs.get(id); if (job) { job.request_body_path = ''; job.response_body_path = null; } },
    async getDocument(key) { const value = documents.get(key); return value === undefined ? null : { content_json: JSON.stringify(value) }; },
    async putDocument(key, value) { documents.set(key, value); },
    async usage() { return usage; },
    async getAccount(username) { return accounts.get(username) || null; },
    async listAccounts() { return [...accounts.values()].map(({ password_hash, ...item }) => item); },
    async createAccount(input) {
      if (accounts.has(input.username)) throw new Error('Account already exists');
      accounts.set(input.username, { username: input.username, password_hash: input.passwordHash, role: input.role, allowed_tools: JSON.stringify(input.allowedTools || []), disabled: 0, created_at: new Date() });
    },
    async updateAccount(username, input) {
      const account = accounts.get(username);
      if (!account) return false;
      Object.assign(account, { role: input.role, allowed_tools: JSON.stringify(input.allowedTools || []), disabled: input.disabled ? 1 : 0 });
      if (input.passwordHash) account.password_hash = input.passwordHash;
      return true;
    },
    async listDemandPresets() { return [...demandPresets.values()]; },
    async saveDemandPreset(input) { demandPresets.set(input.id, { id: input.id, platform: input.platform, type: input.type, content_json: JSON.stringify(input), updated_at: new Date() }); },
    async deleteDemandPreset(id) { return demandPresets.delete(id); },
    async listDemands() { return [...demands.values()].reverse(); },
    async listDemandTodos(username) { return [...demands.values()].filter((item) => item.assignee === username && item.status === 'open').reverse(); },
    async getDemand(id) { return demands.get(id) || null; },
    async saveDemand(input) {
      const id = input.id || randomUUID();
      const prior = demands.get(id);
      if (prior && prior.revision !== input.expectedRevision) return null;
      if (prior && prior.content_json === JSON.stringify(input.content) && prior.assignee === (input.assignee || null)) return prior;
      const row = { id, creator: prior?.creator || input.creator, assignee: input.assignee || null, status: 'open', revision: (prior?.revision || 0) + 1,
        content_json: JSON.stringify(input.content), analysis_json: null, created_at: prior?.created_at || new Date(), updated_at: new Date() };
      demands.set(id, row); return row;
    },
    async updateDemandAnalysis(id, revision, analysis) { const row = demands.get(id); if (!row || row.revision !== revision) return false; row.analysis_json = JSON.stringify(analysis); return true; },
    async completeDemand(id) { const row = demands.get(id); if (!row) return false; row.status = 'completed'; return true; },
    async createDemandOperation(input) {
      const existing = [...demandOperations.values()].find((item) => item.demand_id === input.demandId && item.revision === input.revision && item.kind === input.kind);
      if (existing) return existing;
      const row = { id: randomUUID(), demand_id: input.demandId, revision: input.revision, kind: input.kind, status: 'queued', payload_json: JSON.stringify(input.payload || {}), result_json: null, error_message: null, created_at: new Date() };
      demandOperations.set(row.id, row); return row;
    },
    async claimDemandOperation() { const row = [...demandOperations.values()].find((item) => item.status === 'queued'); if (!row) return null; row.status = 'running'; return row; },
    async getDemandOperation(id) { return demandOperations.get(id) || null; },
    async listDemandOperations(id) { return [...demandOperations.values()].filter((item) => item.demand_id === id).reverse(); },
    async finishDemandOperation(id, status, result, error) { Object.assign(demandOperations.get(id), { status, result_json: result ? JSON.stringify(result) : null, error_message: error || null }); },
    async retryDemandOperation(id) { const row = demandOperations.get(id); if (!row || !['failed','interrupted'].includes(row.status)) return false; row.status = 'queued'; row.error_message = null; return true; },
  };
}
