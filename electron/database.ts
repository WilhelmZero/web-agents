import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import type { DesktopCreateJobRequest, DesktopJobEvent, DesktopJobItem, DesktopJobStatus, DesktopJobSummary } from '../src/desktop/types';

type ItemRow = {
  id: string; job_id: string; group_id: string; source_name: string; source_path: string; status: DesktopJobStatus;
  stage: string; copy_index: number; retry_count: number; max_retries: number; next_retry_at: number | null;
  output_path: string | null; thumbnail_path: string | null; error: string | null; prompt: string | null;
  payload_json: string; updated_at: number;
};

export interface ClaimedItem extends DesktopJobItem {
  payload: Record<string, unknown>;
  tool: 'scene-replace' | 'logo-replace';
  outputRoot: string;
  groupName: string;
  groupPath: string;
  jobConfig: Record<string, unknown>;
}

function itemFromRow(row: ItemRow): DesktopJobItem {
  return {
    id: row.id, jobId: row.job_id, groupId: row.group_id, sourceName: row.source_name, sourcePath: row.source_path,
    status: row.status, stage: row.stage, copyIndex: row.copy_index, retryCount: row.retry_count, maxRetries: row.max_retries,
    nextRetryAt: row.next_retry_at || undefined, outputPath: row.output_path || undefined, thumbnailPath: row.thumbnail_path || undefined,
    error: row.error || undefined, prompt: row.prompt || undefined, updatedAt: row.updated_at,
  };
}

function estimateJobCost(tool: string, configValue: unknown, total: number) {
  const config = configValue as { settings?: Record<string, unknown> };
  const settings = config.settings || {};
  const imageModel = String(tool === 'logo-replace' && settings.imageProvider === 'openai' ? settings.openAiImageModel : settings.imageModel || '');
  const imageSize = String(settings.imageSize || '1K');
  const geminiPrices: Record<string, number> = { '0.5K': 0.045, '1K': 0.067, '2K': 0.101, '4K': 0.151 };
  let unit = imageModel.startsWith('gpt-image') ? 0.211 : geminiPrices[imageSize] || 0.067;
  if (tool === 'scene-replace' && settings.executionMode === 'batch' && !imageModel.startsWith('gpt-image')) unit *= 0.5;
  let minimum = total * unit;
  if (tool === 'scene-replace' && settings.autoOutpaint) {
    const outpaintSize = String(settings.outpaintImageSize || '2K');
    const outpaintModel = String(settings.outpaintImageModel || '');
    const outpaintUnit = outpaintModel.startsWith('gpt-image') ? 0.211 : geminiPrices[outpaintSize] || 0.101;
    minimum += total * outpaintUnit * (settings.outpaintBothSizes ? 2 : 1);
  }
  const attempts = 1 + Math.max(0, Number(settings.errorRetryLimit || 0));
  return { minimum, maximum: minimum * attempts };
}

export class DesktopDatabase {
  readonly db: Database.Database;
  readonly path: string;

  constructor(path: string) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, tool TEXT NOT NULL, status TEXT NOT NULL,
        output_root TEXT NOT NULL, global_concurrency INTEGER NOT NULL DEFAULT 1, config_json TEXT NOT NULL,
        created_at INTEGER NOT NULL, started_at INTEGER, ended_at INTEGER, actual_requests INTEGER NOT NULL DEFAULT 0,
        estimated_cost REAL NOT NULL DEFAULT 0, error TEXT
      );
      CREATE TABLE IF NOT EXISTS job_groups (
        id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        name TEXT NOT NULL, relative_path TEXT NOT NULL, payload_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS job_items (
        id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        group_id TEXT NOT NULL REFERENCES job_groups(id) ON DELETE CASCADE,
        source_name TEXT NOT NULL, source_path TEXT NOT NULL, status TEXT NOT NULL, stage TEXT NOT NULL,
        copy_index INTEGER NOT NULL, retry_count INTEGER NOT NULL DEFAULT 0, max_retries INTEGER NOT NULL DEFAULT 0,
        next_retry_at INTEGER, output_path TEXT, thumbnail_path TEXT, error TEXT, prompt TEXT,
        payload_json TEXT NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_job_items_runnable ON job_items(status, next_retry_at, updated_at);
      CREATE INDEX IF NOT EXISTS idx_job_items_job ON job_items(job_id, updated_at);
      CREATE TABLE IF NOT EXISTS attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, item_id TEXT NOT NULL,
        attempt INTEGER NOT NULL, stage TEXT NOT NULL, provider TEXT, model TEXT, status TEXT NOT NULL,
        started_at INTEGER NOT NULL, ended_at INTEGER, cost REAL NOT NULL DEFAULT 0, output_path TEXT, error TEXT, prompt TEXT
      );
      CREATE TABLE IF NOT EXISTS artifacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, item_id TEXT NOT NULL,
        kind TEXT NOT NULL, path TEXT NOT NULL, mime_type TEXT, width INTEGER, height INTEGER, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT, item_id TEXT, level TEXT NOT NULL,
        type TEXT NOT NULL, message TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
    `);
    this.db.pragma('user_version = 1');
  }

  recoverInterrupted() {
    const now = Date.now();
    const changed = this.db.prepare(`UPDATE job_items SET status='queued', stage='恢复排队', error='应用上次退出时任务尚未完成，已自动恢复', next_retry_at=NULL, updated_at=? WHERE status IN ('analyzing','running','verifying','interrupted')`).run(now).changes;
    this.db.prepare(`UPDATE jobs SET status='queued', ended_at=NULL WHERE status IN ('analyzing','running','verifying','retry_wait','interrupted')`).run();
    if (changed) this.addEvent(undefined, undefined, 'warning', 'recovery', `自动恢复 ${changed} 个未完成任务`);
    return changed;
  }

  createJob(request: DesktopCreateJobRequest) {
    const id = randomUUID();
    const now = Date.now();
    const initialStatus: DesktopJobStatus = request.startPaused ? 'paused' : 'queued';
    const settings = request.config.settings;
    const maxRetries = Math.max(0, Number(settings.errorRetryLimit || 0));
    const copies = Math.max(1, Number(settings.copiesPerScene || 1));
    const insertJob = this.db.prepare(`INSERT INTO jobs (id,name,tool,status,output_root,global_concurrency,config_json,created_at) VALUES (?,?,?,?,?,?,?,?)`);
    const insertGroup = this.db.prepare(`INSERT INTO job_groups (id,job_id,name,relative_path,payload_json) VALUES (?,?,?,?,?)`);
    const insertItem = this.db.prepare(`INSERT INTO job_items (id,job_id,group_id,source_name,source_path,status,stage,copy_index,retry_count,max_retries,prompt,payload_json,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    this.db.transaction(() => {
      insertJob.run(id, request.name, request.config.tool, initialStatus, request.outputRoot, Math.max(1, request.globalConcurrency), JSON.stringify({ ...request.config, apiBaseUrl: request.apiBaseUrl || null }), now);
      for (const group of request.groups) {
        const groupId = `${id}:${group.id}`;
        insertGroup.run(groupId, id, group.name, group.relativePath || group.name, JSON.stringify(group));
        for (const scene of group.scenes) for (let copy = 0; copy < copies; copy += 1) {
          const itemId = randomUUID();
          const prompt = group.prompt || (request.config.tool === 'scene-replace' ? request.config.prompt : '');
          const initialStage = request.startPaused ? '等待主控开始' : request.config.tool === 'scene-replace' && request.config.settings.perImagePromptEnabled ? '等待逐图分析' : '等待生成';
          insertItem.run(itemId, id, groupId, scene.name, scene.path, initialStatus, initialStage, copy, 0, maxRetries, prompt, JSON.stringify({ scene, logos: group.logos || [], oldLogo: group.oldLogo || null }), now);
        }
      }
      this.addEvent(id, undefined, 'info', 'job-created', `已创建后台任务：${request.name}`);
    })();
    return id;
  }

  listJobs(): DesktopJobSummary[] {
    const rows = this.db.prepare(`
      SELECT j.*,
        COUNT(i.id) total,
        SUM(CASE WHEN i.status='completed' THEN 1 ELSE 0 END) completed,
        SUM(CASE WHEN i.status='failed' THEN 1 ELSE 0 END) failed,
        SUM(CASE WHEN i.status IN ('analyzing','running','verifying') THEN 1 ELSE 0 END) running,
        SUM(CASE WHEN i.status IN ('queued','retry_wait','interrupted') THEN 1 ELSE 0 END) queued
      FROM jobs j LEFT JOIN job_items i ON i.job_id=j.id GROUP BY j.id ORDER BY j.created_at DESC
    `).all() as Array<Record<string, unknown>>;
    return rows.map((row) => {
      const estimate = estimateJobCost(String(row.tool), JSON.parse(String(row.config_json || '{}')), Number(row.total || 0));
      return ({
      id: String(row.id), name: String(row.name), tool: row.tool as DesktopJobSummary['tool'], status: row.status as DesktopJobStatus,
      outputRoot: String(row.output_root), total: Number(row.total || 0), completed: Number(row.completed || 0), failed: Number(row.failed || 0),
      running: Number(row.running || 0), queued: Number(row.queued || 0), actualRequests: Number(row.actual_requests || 0), estimatedMinCost: estimate.minimum, estimatedMaxCost: estimate.maximum, estimatedCost: Number(row.estimated_cost || 0),
      createdAt: Number(row.created_at), startedAt: row.started_at ? Number(row.started_at) : undefined, endedAt: row.ended_at ? Number(row.ended_at) : undefined,
      error: row.error ? String(row.error) : undefined,
      });
    });
  }

  getJobItems(jobId: string) {
    return (this.db.prepare(`SELECT * FROM job_items WHERE job_id=? ORDER BY updated_at, copy_index`).all(jobId) as ItemRow[]).map(itemFromRow);
  }

  getJobEvents(jobId?: string): DesktopJobEvent[] {
    const rows = (jobId ? this.db.prepare(`SELECT * FROM events WHERE job_id=? ORDER BY id DESC LIMIT 500`).all(jobId) : this.db.prepare(`SELECT * FROM events ORDER BY id DESC LIMIT 500`).all()) as Array<Record<string, unknown>>;
    return rows.map((row) => ({ id: Number(row.id), jobId: row.job_id ? String(row.job_id) : undefined, itemId: row.item_id ? String(row.item_id) : undefined, level: row.level as DesktopJobEvent['level'], type: String(row.type), message: String(row.message), createdAt: Number(row.created_at) }));
  }

  getSetting(key: string) {
    return (this.db.prepare(`SELECT value FROM settings WHERE key=?`).get(key) as { value?: string } | undefined)?.value;
  }

  setSetting(key: string, value: string) {
    this.db.prepare(`INSERT INTO settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).run(key, value, Date.now());
  }

  isJobCancelled(jobId: string) {
    return (this.db.prepare(`SELECT status FROM jobs WHERE id=?`).get(jobId) as { status?: string } | undefined)?.status === 'cancelled';
  }

  addEvent(jobId: string | undefined, itemId: string | undefined, level: DesktopJobEvent['level'], type: string, message: string) {
    this.db.prepare(`INSERT INTO events (job_id,item_id,level,type,message,created_at) VALUES (?,?,?,?,?,?)`).run(jobId || null, itemId || null, level, type, message, Date.now());
  }

  claimRunnable(limit: number, excluded = new Set<string>()): ClaimedItem[] {
    const now = Date.now();
    const rows = this.db.prepare(`
      SELECT i.*, j.tool, j.output_root, j.config_json, j.global_concurrency, g.name group_name, g.relative_path group_path
      FROM job_items i JOIN jobs j ON j.id=i.job_id JOIN job_groups g ON g.id=i.group_id
      WHERE j.status IN ('queued','running','retry_wait') AND i.status IN ('queued','retry_wait')
        AND (i.next_retry_at IS NULL OR i.next_retry_at<=?)
      ORDER BY j.created_at, i.updated_at LIMIT ?
    `).all(now, Math.max(limit * 4, limit)) as Array<ItemRow & { tool: ClaimedItem['tool']; output_root: string; config_json: string; group_name: string; group_path: string; global_concurrency: number }>;
    const perJobActive = new Map<string, number>();
    const activeRows = this.db.prepare(`SELECT job_id, COUNT(*) count FROM job_items WHERE status IN ('analyzing','running','verifying') GROUP BY job_id`).all() as Array<{ job_id: string; count: number }>;
    activeRows.forEach((row) => perJobActive.set(row.job_id, row.count));
    const selected = rows.filter((row) => {
      if (excluded.has(row.id)) return false;
      const active = perJobActive.get(row.job_id) || 0;
      if (active >= row.global_concurrency) return false;
      perJobActive.set(row.job_id, active + 1);
      return true;
    }).slice(0, limit);
    const mark = this.db.prepare(`UPDATE job_items SET status='running', stage='准备请求', error=NULL, updated_at=? WHERE id=? AND status IN ('queued','retry_wait')`);
    const startJob = this.db.prepare(`UPDATE jobs SET status='running', started_at=COALESCE(started_at,?) WHERE id=?`);
    this.db.transaction(() => selected.forEach((row) => { mark.run(now, row.id); startJob.run(now, row.job_id); }))();
    return selected.map((row) => ({ ...itemFromRow({ ...row, status: 'running', stage: '准备请求', updated_at: now }), payload: JSON.parse(row.payload_json), tool: row.tool, outputRoot: row.output_root, groupName: row.group_name, groupPath: row.group_path, jobConfig: JSON.parse(row.config_json) }));
  }

  setItemState(id: string, status: DesktopJobStatus, stage: string, patch: { error?: string | null; prompt?: string; outputPath?: string; thumbnailPath?: string; nextRetryAt?: number | null; retryCount?: number } = {}) {
    const current = this.db.prepare(`SELECT * FROM job_items WHERE id=?`).get(id) as ItemRow | undefined;
    if (!current) return;
    this.db.prepare(`UPDATE job_items SET status=?,stage=?,error=?,prompt=?,output_path=?,thumbnail_path=?,next_retry_at=?,retry_count=?,updated_at=? WHERE id=?`).run(
      status, stage, patch.error === undefined ? current.error : patch.error, patch.prompt === undefined ? current.prompt : patch.prompt,
      patch.outputPath === undefined ? current.output_path : patch.outputPath, patch.thumbnailPath === undefined ? current.thumbnail_path : patch.thumbnailPath,
      patch.nextRetryAt === undefined ? current.next_retry_at : patch.nextRetryAt, patch.retryCount === undefined ? current.retry_count : patch.retryCount, Date.now(), id,
    );
  }

  updatePayload(id: string, payload: Record<string, unknown>) {
    this.db.prepare(`UPDATE job_items SET payload_json=?,updated_at=? WHERE id=?`).run(JSON.stringify(payload), Date.now(), id);
  }

  startAttempt(item: ClaimedItem, stage: string, provider?: string, model?: string, prompt?: string) {
    const attempt = item.retryCount + 1;
    const result = this.db.prepare(`INSERT INTO attempts (job_id,item_id,attempt,stage,provider,model,status,started_at,prompt) VALUES (?,?,?,?,?,?,?,?,?)`).run(item.jobId, item.id, attempt, stage, provider || null, model || null, 'running', Date.now(), prompt || null);
    this.db.prepare(`UPDATE jobs SET actual_requests=actual_requests+1 WHERE id=?`).run(item.jobId);
    return Number(result.lastInsertRowid);
  }

  finishAttempt(id: number, status: string, patch: { error?: string; outputPath?: string; cost?: number } = {}) {
    this.db.prepare(`UPDATE attempts SET status=?,ended_at=?,error=?,output_path=?,cost=? WHERE id=?`).run(status, Date.now(), patch.error || null, patch.outputPath || null, patch.cost || 0, id);
    if (patch.cost) this.db.prepare(`UPDATE jobs SET estimated_cost=estimated_cost+? WHERE id=(SELECT job_id FROM attempts WHERE id=?)`).run(patch.cost, id);
  }

  addArtifact(jobId: string, itemId: string, kind: string, path: string, mimeType?: string, width?: number, height?: number) {
    this.db.prepare(`INSERT INTO artifacts (job_id,item_id,kind,path,mime_type,width,height,created_at) VALUES (?,?,?,?,?,?,?,?)`).run(jobId, itemId, kind, path, mimeType || null, width || null, height || null, Date.now());
  }

  isKnownArtifactPath(path: string) {
    const row = this.db.prepare(`SELECT 1 found FROM artifacts WHERE path=? UNION SELECT 1 found FROM job_items WHERE thumbnail_path=? OR output_path=? LIMIT 1`).get(path, path, path) as { found?: number } | undefined;
    return Boolean(row?.found);
  }

  isAllowedOpenPath(path: string) {
    const target = resolve(path);
    if (this.isKnownArtifactPath(target)) return true;
    const roots = this.db.prepare(`SELECT DISTINCT output_root FROM jobs`).all() as Array<{ output_root: string }>;
    return roots.some(({ output_root }) => {
      const root = resolve(output_root);
      const child = relative(root, target);
      return child === '' || (!child.startsWith('..') && !child.includes(':'));
    });
  }

  setJobStatus(jobId: string, status: DesktopJobStatus) {
    const ended = ['completed', 'failed', 'cancelled'].includes(status) ? Date.now() : null;
    this.db.prepare(`UPDATE jobs SET status=?,ended_at=? WHERE id=?`).run(status, ended, jobId);
    if (status === 'paused') this.db.prepare(`UPDATE job_items SET status='paused',stage='已暂停',updated_at=? WHERE job_id=? AND status IN ('queued','retry_wait')`).run(Date.now(), jobId);
    if (status === 'queued') this.db.prepare(`UPDATE job_items SET status='queued',stage='等待恢复',next_retry_at=NULL,updated_at=? WHERE job_id=? AND status='paused'`).run(Date.now(), jobId);
    if (status === 'cancelled') this.db.prepare(`UPDATE job_items SET status='cancelled',stage='已取消',next_retry_at=NULL,updated_at=? WHERE job_id=? AND status NOT IN ('completed','failed')`).run(Date.now(), jobId);
  }

  retryJob(jobId: string) {
    this.db.prepare(`UPDATE job_items SET status='queued',stage='重新排队',error=NULL,next_retry_at=NULL,retry_count=0,updated_at=? WHERE job_id=? AND status IN ('failed','cancelled')`).run(Date.now(), jobId);
    this.db.prepare(`UPDATE jobs SET status='queued',ended_at=NULL,error=NULL WHERE id=?`).run(jobId);
  }

  pauseAll() { this.db.prepare(`UPDATE jobs SET status='paused' WHERE status IN ('queued','running','retry_wait')`).run(); this.db.prepare(`UPDATE job_items SET status='paused',stage='全局暂停',updated_at=? WHERE status IN ('queued','retry_wait')`).run(Date.now()); }
  resumeAll() { this.db.prepare(`UPDATE jobs SET status='queued',ended_at=NULL WHERE status='paused'`).run(); this.db.prepare(`UPDATE job_items SET status='queued',stage='等待恢复',updated_at=? WHERE status='paused'`).run(Date.now()); }

  finalizeJobs() {
    const rows = this.db.prepare(`SELECT j.id, COUNT(i.id) total, SUM(CASE WHEN i.status IN ('completed','failed','cancelled') THEN 1 ELSE 0 END) done, SUM(CASE WHEN i.status='failed' THEN 1 ELSE 0 END) failed FROM jobs j JOIN job_items i ON i.job_id=j.id WHERE j.status IN ('running','queued','retry_wait') GROUP BY j.id`).all() as Array<{ id: string; total: number; done: number; failed: number }>;
    const update = this.db.prepare(`UPDATE jobs SET status=?,ended_at=? WHERE id=?`);
    rows.forEach((row) => { if (row.total && row.done >= row.total) update.run(row.failed ? 'failed' : 'completed', Date.now(), row.id); });
  }

  getGlobalConcurrency() {
    const row = this.db.prepare(`SELECT MAX(global_concurrency) value FROM jobs WHERE status IN ('queued','running','retry_wait')`).get() as { value?: number };
    return Math.max(1, Number(row?.value || 1));
  }

  markActiveInterrupted() {
    this.db.prepare(`UPDATE job_items SET status='interrupted',stage='安全退出等待恢复',updated_at=? WHERE status IN ('analyzing','running','verifying')`).run(Date.now());
    this.db.prepare(`UPDATE jobs SET status='interrupted' WHERE status='running'`).run();
  }

  close() { this.db.close(); }
}
