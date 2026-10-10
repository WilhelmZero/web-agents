import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { DEFAULT_DEMAND_PRESETS } from './demand-presets.mjs';

export function createStore(env = process.env) {
  const config = env.DATABASE_URL || {
    host: env.DB_HOST,
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
  };
  const pool = mysql.createPool(typeof config === 'string' ? config : { ...config, waitForConnections: true, connectionLimit: 6 });
  return {
    async init() {
      await pool.query(`CREATE TABLE IF NOT EXISTS studio_jobs (
        id CHAR(36) PRIMARY KEY, source VARCHAR(80) NOT NULL, tool VARCHAR(80) NOT NULL,
        provider VARCHAR(16) NOT NULL, model VARCHAR(120) NOT NULL DEFAULT '', username VARCHAR(64) NOT NULL,
        request_path VARCHAR(255) NOT NULL, request_body_path VARCHAR(512) NOT NULL,
        request_content_type VARCHAR(255) NOT NULL DEFAULT '', encrypted_key TEXT NULL,
        status VARCHAR(16) NOT NULL, attempts INT NOT NULL DEFAULT 0,
        response_status INT NULL, response_content_type VARCHAR(255) NULL, response_body_path VARCHAR(512) NULL,
        image_count INT NOT NULL DEFAULT 0, error_message VARCHAR(500) NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        completed_at DATETIME(3) NULL, INDEX(status, created_at), INDEX(completed_at)
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS studio_assets (
        id CHAR(36) PRIMARY KEY, job_id CHAR(36) NULL, tool VARCHAR(80) NOT NULL,
        mime VARCHAR(100) NOT NULL, name VARCHAR(255) NOT NULL, file_path VARCHAR(512) NULL,
        expires_at DATETIME NULL, expired TINYINT NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX(job_id), INDEX(expires_at)
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS studio_usage (
        id BIGINT AUTO_INCREMENT PRIMARY KEY, job_id CHAR(36) NOT NULL,
        source VARCHAR(80) NOT NULL, tool VARCHAR(80) NOT NULL, provider VARCHAR(16) NOT NULL,
        model VARCHAR(120) NOT NULL, username VARCHAR(64) NOT NULL, status VARCHAR(16) NOT NULL,
        image_count INT NOT NULL DEFAULT 0, upstream_status INT NULL,
        attempts INT NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX(source, created_at), INDEX(tool, created_at)
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS studio_documents (
        document_key VARCHAR(160) PRIMARY KEY, content_json LONGTEXT NOT NULL,
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS studio_results (
        id CHAR(36) PRIMARY KEY, operation_id VARCHAR(160) NOT NULL UNIQUE,
        tool VARCHAR(80) NOT NULL, username VARCHAR(64) NOT NULL,
        name VARCHAR(255) NOT NULL, asset_id CHAR(36) NOT NULL,
        job_id CHAR(36) NULL, export_json LONGTEXT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        INDEX(tool, created_at), INDEX(username, created_at), INDEX(asset_id)
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS studio_accounts (
        username VARCHAR(64) PRIMARY KEY, password_hash VARCHAR(200) NOT NULL,
        role VARCHAR(20) NOT NULL, allowed_tools LONGTEXT NULL,
        disabled TINYINT NOT NULL DEFAULT 0,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS studio_demand_presets (
        id CHAR(36) PRIMARY KEY, platform VARCHAR(32) NULL, type VARCHAR(40) NULL,
        content_json LONGTEXT NOT NULL, updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3)
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS studio_demands (
        id CHAR(36) PRIMARY KEY, creator VARCHAR(64) NOT NULL, assignee VARCHAR(64) NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'open', revision INT NOT NULL DEFAULT 1,
        content_json LONGTEXT NOT NULL, analysis_json LONGTEXT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        INDEX(assignee, status), INDEX(updated_at)
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS studio_demand_operations (
        id CHAR(36) PRIMARY KEY, demand_id CHAR(36) NOT NULL,
        revision INT NOT NULL, kind VARCHAR(16) NOT NULL, status VARCHAR(20) NOT NULL,
        payload_json LONGTEXT NULL, result_json LONGTEXT NULL, error_message VARCHAR(1000) NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        UNIQUE KEY uniq_demand_operation (demand_id, revision, kind), INDEX(status, created_at)
      )`);
      for (const preset of DEFAULT_DEMAND_PRESETS) {
        await pool.execute('INSERT IGNORE INTO studio_demand_presets (id, platform, type, content_json) VALUES (?, ?, ?, ?)',
          [preset.id, preset.platform, preset.type, JSON.stringify(preset)]);
      }
      await pool.query("INSERT INTO studio_usage (job_id, source, tool, provider, model, username, status, image_count, upstream_status, attempts) SELECT id, source, tool, provider, model, username, 'interrupted', image_count, response_status, attempts FROM studio_jobs WHERE status='running'");
      await pool.query("UPDATE studio_jobs SET status='interrupted', encrypted_key=NULL, completed_at=NOW(), error_message='Server restarted during upstream request; result is unknown, so automatic retry was skipped to avoid duplicate charges' WHERE status='running'");
      await pool.query("UPDATE studio_demand_operations SET status='interrupted', error_message='Server restarted while this operation was running; retry manually to avoid duplicate charges' WHERE status='running'");
    },
    async createJob(input) {
      const id = randomUUID();
      await pool.execute(`INSERT INTO studio_jobs (id, source, tool, provider, model, username, request_path, request_body_path, request_content_type, encrypted_key, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued')`, [id, input.source, input.tool, input.provider, input.model, input.username, input.path, input.bodyPath, input.contentType, input.encryptedKey]);
      return id;
    },
    async claimJob() {
      const [rows] = await pool.query("SELECT id FROM studio_jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1");
      if (!rows.length) return null;
      const [result] = await pool.execute("UPDATE studio_jobs SET status = 'running', attempts = attempts + 1 WHERE id = ? AND status = 'queued'", [rows[0].id]);
      if (!result.affectedRows) return null;
      return this.getJob(rows[0].id);
    },
    async getJob(id) {
      const [rows] = await pool.execute('SELECT * FROM studio_jobs WHERE id = ?', [id]);
      return rows[0] || null;
    },
    async cancelQueuedJob(id) {
      const [result] = await pool.execute("UPDATE studio_jobs SET status='cancelled', encrypted_key=NULL, completed_at=NOW() WHERE id=? AND status='queued'", [id]);
      return result.affectedRows > 0;
    },
    async listJobs(limit = 100) {
      const [rows] = await pool.execute('SELECT id, source, tool, provider, model, username, status, attempts, response_status, image_count, error_message, created_at, completed_at FROM studio_jobs ORDER BY created_at DESC LIMIT ?', [limit]);
      return rows;
    },
    async finishJob(job, status, responseStatus, contentType, bodyPath, imageCount, errorMessage) {
      await pool.execute(`UPDATE studio_jobs SET status=?, response_status=?, response_content_type=?, response_body_path=?, image_count=?, error_message=?, encrypted_key=NULL, completed_at=NOW() WHERE id=?`, [status, responseStatus, contentType, bodyPath, imageCount, errorMessage, job.id]);
      await pool.execute('INSERT INTO studio_usage (job_id, source, tool, provider, model, username, status, image_count, upstream_status, attempts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [job.id, job.source, job.tool, job.provider, job.model, job.username, status, imageCount, responseStatus, job.attempts]);
    },
    async createAsset(input) {
      const id = randomUUID();
      await pool.execute('INSERT INTO studio_assets (id, job_id, tool, mime, name, file_path, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, input.jobId || null, input.tool, input.mime, input.name, input.path, input.expiresAt || null]);
      return id;
    },
    async getAsset(id) {
      const [rows] = await pool.execute('SELECT * FROM studio_assets WHERE id=?', [id]);
      return rows[0] || null;
    },
    async assetsForJob(id) {
      const [rows] = await pool.execute('SELECT id, name, mime, expired FROM studio_assets WHERE job_id=?', [id]);
      return rows;
    },
    async createResult(input) {
      const id = randomUUID();
      await pool.execute(`INSERT INTO studio_results (id, operation_id, tool, username, name, asset_id, job_id, export_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE id=id`,
      [id, input.operationId, input.tool, input.username, input.name, input.assetId, input.jobId || null, JSON.stringify(input.exportSpec || {})]);
      return this.getResultByOperation(input.operationId);
    },
    async getResultByOperation(operationId) {
      const [rows] = await pool.execute(`SELECT r.*, a.mime, a.expired, a.expires_at
        FROM studio_results r JOIN studio_assets a ON a.id=r.asset_id WHERE r.operation_id=?`, [operationId]);
      return rows[0] || null;
    },
    async getResult(id) {
      const [rows] = await pool.execute(`SELECT r.*, a.mime, a.expired, a.expires_at
        FROM studio_results r JOIN studio_assets a ON a.id=r.asset_id WHERE r.id=?`, [id]);
      return rows[0] || null;
    },
    async listResults({ tool, status, limit = 40, offset = 0 } = {}) {
      const clauses = []; const values = [];
      if (tool) { clauses.push('r.tool=?'); values.push(tool); }
      if (status === 'available') clauses.push('a.expired=0');
      if (status === 'expired') clauses.push('a.expired=1');
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const [rows] = await pool.execute(`SELECT r.*, a.mime, a.expired, a.expires_at
        FROM studio_results r JOIN studio_assets a ON a.id=r.asset_id ${where}
        ORDER BY r.created_at DESC LIMIT ? OFFSET ?`, [...values, limit, offset]);
      return rows;
    },
    async expiredAssets() {
      const [rows] = await pool.query('SELECT id, file_path FROM studio_assets WHERE expired=0 AND expires_at < NOW()');
      return rows;
    },
    async orphanAssets() {
      const [rows] = await pool.query(`SELECT a.id, a.file_path FROM studio_assets a
        WHERE a.job_id IS NULL AND a.expired=0 AND a.created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)
        AND NOT EXISTS (SELECT 1 FROM studio_documents d WHERE d.content_json LIKE CONCAT('%', a.id, '%'))
        AND NOT EXISTS (SELECT 1 FROM studio_demands d WHERE d.status='open' AND d.content_json LIKE CONCAT('%', a.id, '%'))`);
      return rows;
    },
    async markAssetExpired(id) { await pool.execute('UPDATE studio_assets SET expired=1, file_path=NULL WHERE id=?', [id]); },
    async expiredJobFiles() {
      const [rows] = await pool.query('SELECT id, request_body_path, response_body_path FROM studio_jobs WHERE completed_at < DATE_SUB(NOW(), INTERVAL 30 DAY) AND (request_body_path <> \'\' OR response_body_path IS NOT NULL)');
      return rows;
    },
    async clearJobFiles(id) { await pool.execute("UPDATE studio_jobs SET request_body_path='', response_body_path=NULL WHERE id=?", [id]); },
    async getDocument(key) {
      const [rows] = await pool.execute('SELECT content_json, updated_at FROM studio_documents WHERE document_key=?', [key]);
      return rows[0] || null;
    },
    async putDocument(key, content) {
      await pool.execute('INSERT INTO studio_documents (document_key, content_json) VALUES (?, ?) ON DUPLICATE KEY UPDATE content_json=VALUES(content_json)', [key, JSON.stringify(content)]);
    },
    async usage() {
      const [rows] = await pool.query("SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS day, source, tool, provider, model, status, COUNT(*) AS requests, SUM(image_count) AS images, SUM(GREATEST(attempts - 1, 0)) AS retries FROM studio_usage WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 29 DAY) GROUP BY DATE(created_at), source, tool, provider, model, status ORDER BY day DESC LIMIT 5000");
      return rows;
    },
    async getAccount(username) {
      const [rows] = await pool.execute('SELECT * FROM studio_accounts WHERE username=?', [username]);
      return rows[0] || null;
    },
    async listAccounts() {
      const [rows] = await pool.query('SELECT username, role, allowed_tools, disabled, created_at FROM studio_accounts ORDER BY username');
      return rows;
    },
    async createAccount(input) {
      await pool.execute('INSERT INTO studio_accounts (username, password_hash, role, allowed_tools) VALUES (?, ?, ?, ?)',
        [input.username, input.passwordHash, input.role, JSON.stringify(input.allowedTools || [])]);
    },
    async updateAccount(username, input) {
      const fields = ['role=?', 'allowed_tools=?', 'disabled=?'];
      const values = [input.role, JSON.stringify(input.allowedTools || []), input.disabled ? 1 : 0];
      if (input.passwordHash) { fields.push('password_hash=?'); values.push(input.passwordHash); }
      const [result] = await pool.execute(`UPDATE studio_accounts SET ${fields.join(', ')} WHERE username=?`, [...values, username]);
      return result.affectedRows > 0;
    },
    async listDemandPresets() {
      const [rows] = await pool.query('SELECT * FROM studio_demand_presets ORDER BY updated_at DESC');
      return rows;
    },
    async saveDemandPreset(input) {
      await pool.execute(`INSERT INTO studio_demand_presets (id, platform, type, content_json) VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE platform=VALUES(platform), type=VALUES(type), content_json=VALUES(content_json)`,
      [input.id, input.platform || null, input.type || null, JSON.stringify(input)]);
    },
    async deleteDemandPreset(id) {
      const [result] = await pool.execute('DELETE FROM studio_demand_presets WHERE id=?', [id]);
      return result.affectedRows > 0;
    },
    async listDemands() {
      const [rows] = await pool.query('SELECT * FROM studio_demands ORDER BY updated_at DESC LIMIT 500');
      return rows;
    },
    async listDemandTodos(username) {
      const [rows] = await pool.execute("SELECT * FROM studio_demands WHERE assignee=? AND status='open' ORDER BY updated_at DESC LIMIT 500", [username]);
      return rows;
    },
    async getDemand(id) {
      const [rows] = await pool.execute('SELECT * FROM studio_demands WHERE id=?', [id]);
      return rows[0] || null;
    },
    async saveDemand(input) {
      if (!input.id) input.id = randomUUID();
      const existing = await this.getDemand(input.id);
      if (existing && existing.revision !== input.expectedRevision) return null;
      if (existing && existing.content_json === JSON.stringify(input.content) && existing.assignee === (input.assignee || null)) return existing;
      if (existing) {
        const [result] = await pool.execute(`UPDATE studio_demands SET assignee=?, content_json=?, analysis_json=NULL,
          revision=revision+1, status='open' WHERE id=? AND revision=?`,
        [input.assignee || null, JSON.stringify(input.content), input.id, input.expectedRevision]);
        if (!result.affectedRows) return null;
      } else {
        await pool.execute('INSERT INTO studio_demands (id, creator, assignee, content_json) VALUES (?, ?, ?, ?)',
          [input.id, input.creator, input.assignee || null, JSON.stringify(input.content)]);
      }
      return this.getDemand(input.id);
    },
    async updateDemandAnalysis(id, revision, analysis) {
      const [result] = await pool.execute('UPDATE studio_demands SET analysis_json=? WHERE id=? AND revision=?',
        [JSON.stringify(analysis), id, revision]);
      return result.affectedRows > 0;
    },
    async completeDemand(id) {
      const [result] = await pool.execute("UPDATE studio_demands SET status='completed' WHERE id=?", [id]);
      return result.affectedRows > 0;
    },
    async createDemandOperation(input) {
      const id = randomUUID();
      await pool.execute(`INSERT INTO studio_demand_operations (id, demand_id, revision, kind, status, payload_json)
        VALUES (?, ?, ?, ?, 'queued', ?) ON DUPLICATE KEY UPDATE id=id`,
      [id, input.demandId, input.revision, input.kind, JSON.stringify(input.payload || {})]);
      const [rows] = await pool.execute('SELECT * FROM studio_demand_operations WHERE demand_id=? AND revision=? AND kind=?',
        [input.demandId, input.revision, input.kind]);
      return rows[0];
    },
    async claimDemandOperation() {
      const [rows] = await pool.query("SELECT id FROM studio_demand_operations WHERE status='queued' ORDER BY created_at LIMIT 1");
      if (!rows.length) return null;
      const [result] = await pool.execute("UPDATE studio_demand_operations SET status='running' WHERE id=? AND status='queued'", [rows[0].id]);
      if (!result.affectedRows) return null;
      return this.getDemandOperation(rows[0].id);
    },
    async getDemandOperation(id) {
      const [rows] = await pool.execute('SELECT * FROM studio_demand_operations WHERE id=?', [id]);
      return rows[0] || null;
    },
    async listDemandOperations(demandId) {
      const [rows] = await pool.execute('SELECT * FROM studio_demand_operations WHERE demand_id=? ORDER BY created_at DESC', [demandId]);
      return rows;
    },
    async finishDemandOperation(id, status, result, error) {
      await pool.execute('UPDATE studio_demand_operations SET status=?, result_json=?, error_message=? WHERE id=?',
        [status, result ? JSON.stringify(result) : null, error || null, id]);
    },
    async retryDemandOperation(id) {
      const [result] = await pool.execute("UPDATE studio_demand_operations SET status='queued', error_message=NULL WHERE id=? AND status IN ('failed','interrupted')", [id]);
      return result.affectedRows > 0;
    },
    async close() { await pool.end(); },
  };
}
