import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

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
      await pool.query("INSERT INTO studio_usage (job_id, source, tool, provider, model, username, status, image_count, upstream_status, attempts) SELECT id, source, tool, provider, model, username, 'interrupted', image_count, response_status, attempts FROM studio_jobs WHERE status='running'");
      await pool.query("UPDATE studio_jobs SET status='interrupted', encrypted_key=NULL, completed_at=NOW(), error_message='Server restarted during upstream request; result is unknown, so automatic retry was skipped to avoid duplicate charges' WHERE status='running'");
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
        AND NOT EXISTS (SELECT 1 FROM studio_documents d WHERE d.content_json LIKE CONCAT('%', a.id, '%'))`);
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
      const [rows] = await pool.query('SELECT DATE(created_at) AS day, source, tool, provider, model, status, COUNT(*) AS requests, SUM(image_count) AS images, SUM(GREATEST(attempts - 1, 0)) AS retries FROM studio_usage GROUP BY DATE(created_at), source, tool, provider, model, status ORDER BY day DESC LIMIT 500');
      return rows;
    },
    async close() { await pool.end(); },
  };
}
