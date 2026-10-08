import { randomUUID } from 'node:crypto';

// Local UI smoke tests only. Production always requires MySQL.
export function createMemoryStore() {
  const jobs = new Map();
  const assets = new Map();
  const documents = new Map();
  const usage = [];
  return {
    async init() {}, async close() {},
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
      usage.push({ source: job.source, tool: job.tool, provider: job.provider, model: job.model, status, images: imageCount, retries: Math.max(0, job.attempts - 1) });
    },
    async createAsset(value) { const id = randomUUID(); assets.set(id, { id, job_id: value.jobId || null, tool: value.tool, mime: value.mime, name: value.name, file_path: value.path, expires_at: value.expiresAt || null, expired: false, created_at: new Date() }); return id; },
    async getAsset(id) { return assets.get(id) || null; },
    async assetsForJob(id) { return [...assets.values()].filter((asset) => asset.job_id === id); },
    async expiredAssets() { return [...assets.values()].filter((asset) => !asset.expired && asset.expires_at && asset.expires_at < new Date()); },
    async orphanAssets() { return []; },
    async markAssetExpired(id) { const asset = assets.get(id); if (asset) { asset.expired = true; asset.file_path = null; } },
    async expiredJobFiles() { return [...jobs.values()].filter((job) => job.completed_at && job.completed_at < new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) && (job.request_body_path || job.response_body_path)); },
    async clearJobFiles(id) { const job = jobs.get(id); if (job) { job.request_body_path = ''; job.response_body_path = null; } },
    async getDocument(key) { const value = documents.get(key); return value === undefined ? null : { content_json: JSON.stringify(value) }; },
    async putDocument(key, value) { documents.set(key, value); },
    async usage() { return usage; },
  };
}
