import { app, BrowserWindow, dialog, ipcMain, nativeImage, safeStorage, shell, Tray, Menu } from 'electron';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, statfs, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { cpus, freemem, totalmem } from 'node:os';
import type { DesktopCreateJobRequest, DesktopResourceSnapshot } from '../src/desktop/types';
import { DesktopDatabase } from './database';
import { DesktopJobEngine } from './job-engine';
import type { ProviderSecrets } from './providers';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let store: DesktopDatabase;
let engine: DesktopJobEngine;
let quitting = false;
let secrets: ProviderSecrets = {};
let resourceTimer: NodeJS.Timeout | undefined;
let highSamples = 0; let safeSamples = 0; let guardPaused = false;
let previousCpu = process.cpuUsage(); let previousCpuAt = Date.now();

const channels = {
  jobsChanged: 'desktop:jobs-changed', resourcesChanged: 'desktop:resources-changed',
} as const;

function userDataPath(...parts: string[]) { return join(app.getPath('userData'), ...parts); }

function emitJobsChanged() {
  const window = mainWindow;
  if (window && !window.isDestroyed()) window.webContents.send(channels.jobsChanged);
  const jobs = store?.listJobs() || []; const active = jobs.filter((job) => ['queued', 'running', 'retry_wait', 'analyzing', 'verifying'].includes(job.status));
  tray?.setToolTip(active.length ? `Scene Studio · ${active.reduce((sum, job) => sum + job.completed, 0)}/${active.reduce((sum, job) => sum + job.total, 0)}` : 'Scene Studio · 后台任务已就绪');
}

function validSender(event: Electron.IpcMainInvokeEvent) {
  const url = event.senderFrame?.url || '';
  if (url.startsWith('file:')) return true;
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  return Boolean(devUrl && url.startsWith(devUrl));
}

function handle<T extends unknown[], R>(channel: string, listener: (event: Electron.IpcMainInvokeEvent, ...args: T) => R | Promise<R>) {
  ipcMain.handle(channel, (event, ...args: T) => { if (!validSender(event)) throw new Error('拒绝来自未知页面的桌面 IPC 请求'); return listener(event, ...args); });
}

async function loadSecrets() {
  try {
    const raw = JSON.parse(await readFile(userDataPath('secrets.json'), 'utf8')) as { encrypted?: string };
    if (raw.encrypted && safeStorage.isEncryptionAvailable()) secrets = JSON.parse(safeStorage.decryptString(Buffer.from(raw.encrypted, 'base64'))) as ProviderSecrets;
  } catch { secrets = {}; }
}

async function saveSecrets(next: ProviderSecrets) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储暂不可用，API Key 未保存');
  secrets = { ...secrets, ...next };
  const path = userDataPath('secrets.json'); const temporary = `${path}.partial`; await mkdir(app.getPath('userData'), { recursive: true });
  const payload = { encrypted: safeStorage.encryptString(JSON.stringify(secrets)).toString('base64') };
  await writeFile(temporary, JSON.stringify(payload), { mode: 0o600 }); await rename(temporary, path);
}

function validateCreateRequest(request: DesktopCreateJobRequest) {
  if (!request || !['scene-replace', 'logo-replace', 'logo-removal'].includes(request.config?.tool)) throw new Error('不支持的桌面任务类型');
  if (!request.name?.trim() || !request.outputRoot) throw new Error('任务名称和输出目录不能为空');
  if (!existsSync(request.outputRoot)) throw new Error('输出目录不存在');
  if (!Array.isArray(request.groups) || !request.groups.length) throw new Error('任务至少需要一个图片分组');
  let count = 0;
  for (const group of request.groups) {
    if (!Array.isArray(group.scenes) || !group.scenes.length) throw new Error(`${group.name || '分组'} 没有场景图`);
    group.scenes.forEach((asset) => { if (!asset.path || !existsSync(asset.path)) throw new Error(`素材不存在：${asset.name || asset.path}`); count += 1; });
    group.logos?.forEach((asset) => { if (!asset.path || !existsSync(asset.path)) throw new Error(`Logo 不存在：${asset.name || asset.path}`); });
    if (request.config.tool === 'logo-replace' && !group.logos?.length) throw new Error(`${group.name || '分组'} 没有可用 Logo`);
  }
  if (count > 10000) throw new Error('单个批次最多允许 10000 张场景图');
  if (request.config.tool === 'scene-replace') {
    const settings = request.config.settings;
    if (settings.imageModel.startsWith('gpt-image') && !secrets.openAi) throw new Error('请先在桌面后台任务中心配置 OpenAI API Key');
    if (!settings.imageModel.startsWith('gpt-image') && !secrets.gemini) throw new Error('请先在桌面后台任务中心配置 Gemini API Key');
    if ((settings.perImagePromptEnabled || settings.autoRecommendScene) && settings.sceneRecommendationProvider === 'openai' && !secrets.openAi) throw new Error('逐图分析需要 OpenAI API Key');
    if ((settings.perImagePromptEnabled || settings.autoRecommendScene) && settings.sceneRecommendationProvider === 'gemini' && !secrets.gemini) throw new Error('逐图分析需要 Gemini API Key');
  } else if (request.config.tool === 'logo-replace') {
    const settings = request.config.settings;
    if (settings.imageProvider === 'openai' && !secrets.openAi) throw new Error('请先在桌面后台任务中心配置 OpenAI API Key');
    if (settings.imageProvider === 'gemini' && !secrets.gemini) throw new Error('请先在桌面后台任务中心配置 Gemini API Key');
    if ((settings.perImagePromptEnabled || settings.multiLogoModeEnabled || settings.distinctLogoPerOccurrence || settings.strictTextVerification) && settings.languageProvider === 'openai' && !secrets.openAi) throw new Error('Logo 分析与校验需要 OpenAI API Key');
    if ((settings.perImagePromptEnabled || settings.multiLogoModeEnabled || settings.distinctLogoPerOccurrence || settings.strictTextVerification) && settings.languageProvider === 'gemini' && !secrets.gemini) throw new Error('Logo 分析与校验需要 Gemini API Key');
  } else {
    const settings = request.config.settings;
    if (settings.imageProvider === 'openai' && !secrets.openAi) throw new Error('请先在桌面后台任务中心配置 OpenAI API Key');
    if (settings.imageProvider === 'gemini' && !secrets.gemini) throw new Error('请先在桌面后台任务中心配置 Gemini API Key');
    if (settings.analysisProvider === 'openai' && !secrets.openAi) throw new Error('去除 Logo 分析需要 OpenAI API Key');
    if (settings.analysisProvider === 'gemini' && !secrets.gemini) throw new Error('去除 Logo 分析需要 Gemini API Key');
    if (settings.verificationEnabled && settings.verificationProvider === 'openai' && !secrets.openAi) throw new Error('去除 Logo 校验需要 OpenAI API Key');
    if (settings.verificationEnabled && settings.verificationProvider === 'gemini' && !secrets.gemini) throw new Error('去除 Logo 校验需要 Gemini API Key');
  }
  request.globalConcurrency = Math.max(1, Math.min(32, Number(request.globalConcurrency) || 1));
}

function registerIpc() {
  handle('desktop:runtime-info', () => ({ isPackaged: app.isPackaged, version: app.getVersion(), platform: process.platform, launchAtLogin: app.getLoginItemSettings().openAtLogin, databasePath: store.path }));
  handle('desktop:set-launch-at-login', (_event, value: boolean) => { app.setLoginItemSettings({ openAtLogin: Boolean(value), path: process.execPath, args: ['--hidden'] }); store.setSetting('login-startup-initialized', 'true'); return app.getLoginItemSettings().openAtLogin; });
  handle('desktop:secret-state', () => ({ geminiConfigured: Boolean(secrets.gemini), openAiConfigured: Boolean(secrets.openAi) }));
  handle('desktop:set-secrets', async (_event, value: { gemini?: string; openAi?: string }) => { await saveSecrets({ ...(typeof value.gemini === 'string' ? { gemini: value.gemini.trim() } : {}), ...(typeof value.openAi === 'string' ? { openAi: value.openAi.trim() } : {}) }); return { geminiConfigured: Boolean(secrets.gemini), openAiConfigured: Boolean(secrets.openAi) }; });
  handle('desktop:pick-output', async () => { const window = mainWindow; if (!window) return null; return (await dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'], title: '选择批次输出根目录' })).filePaths[0] || null; });
  handle('desktop:pick-input', async () => { const window = mainWindow; if (!window) return null; return (await dialog.showOpenDialog(window, { properties: ['openDirectory'], title: '选择素材根目录' })).filePaths[0] || null; });
  handle('desktop:create-job', (_event, request: DesktopCreateJobRequest) => { validateCreateRequest(request); const id = store.createJob(request); emitJobsChanged(); engine.start(); return id; });
  handle('desktop:list-jobs', () => store.listJobs());
  handle('desktop:job-items', (_event, jobId: string) => store.getJobItems(String(jobId)));
  handle('desktop:job-events', (_event, jobId?: string) => store.getJobEvents(jobId ? String(jobId) : undefined));
  handle('desktop:pause-job', (_event, id: string) => engine.pauseJob(String(id)));
  handle('desktop:resume-job', (_event, id: string) => engine.resumeJob(String(id)));
  handle('desktop:cancel-job', (_event, id: string) => engine.cancelJob(String(id)));
  handle('desktop:retry-job', (_event, id: string) => engine.retryJob(String(id)));
  handle('desktop:pause-all', () => engine.pauseAll()); handle('desktop:resume-all', () => engine.resumeAll());
  handle('desktop:reveal-path', async (_event, path: string) => { const target = resolve(String(path)); if (!store.isAllowedOpenPath(target)) throw new Error('拒绝访问任务输出目录之外的路径'); if (existsSync(target)) shell.showItemInFolder(target); });
  handle('desktop:open-path', async (_event, path: string) => { const target = resolve(String(path)); if (!store.isAllowedOpenPath(target)) throw new Error('拒绝访问任务输出目录之外的路径'); if (!existsSync(target)) throw new Error('文件不存在'); const error = await shell.openPath(target); if (error) throw new Error(error); });
  handle('desktop:read-thumbnail', async (_event, path: string) => {
    const target = resolve(String(path));
    if (!store.isKnownArtifactPath(target) || !existsSync(target)) return null;
    const bytes = await readFile(target);
    if (bytes.byteLength > 2 * 1024 * 1024) return null;
    const extension = target.toLowerCase().endsWith('.webp') ? 'image/webp' : target.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
    return `data:${extension};base64,${bytes.toString('base64')}`;
  });
  handle('desktop:resource-snapshot', () => sampleResources());
}

function cpuPercent() {
  const now = Date.now(); const current = process.cpuUsage(); const elapsedMicros = Math.max(1, now - previousCpuAt) * 1000;
  const used = current.user - previousCpu.user + current.system - previousCpu.system; previousCpu = current; previousCpuAt = now;
  return Math.min(100, Number(((used / elapsedMicros) * 100 / Math.max(1, cpus().length)).toFixed(1)));
}

async function sampleResources(): Promise<DesktopResourceSnapshot> {
  const metrics = app.getAppMetrics();
  const main = metrics.filter((metric) => metric.type === 'Browser').reduce((sum, metric) => sum + (metric.memory.privateBytes || 0) * 1024, 0);
  const renderer = metrics.filter((metric) => metric.type === 'Tab').reduce((sum, metric) => sum + (metric.memory.privateBytes || 0) * 1024, 0);
  const total = totalmem(); const free = freemem(); const appMemory = metrics.reduce((sum, metric) => sum + (metric.memory.privateBytes || 0) * 1024, 0);
  let diskFreeBytes: number | undefined;
  const outputRoot = store.listJobs()[0]?.outputRoot;
  if (outputRoot) try { const disk = await statfs(outputRoot); diskFreeBytes = disk.bavail * disk.bsize; } catch { /* optional */ }
  return { timestamp: Date.now(), appMemoryBytes: appMemory, mainMemoryBytes: main, rendererMemoryBytes: renderer, systemTotalMemoryBytes: total, systemFreeMemoryBytes: free, systemMemoryPercent: Number((((total - free) / total) * 100).toFixed(1)), cpuPercent: cpuPercent(), uptimeSeconds: process.uptime(), activeRequests: engine?.activeCount || 0, globalConcurrency: store?.getGlobalConcurrency() || 1, guardPaused, guardReason: guardPaused ? '内存自动保护已暂停启动新请求' : undefined, diskFreeBytes };
}

function startResourceMonitor() {
  resourceTimer = setInterval(async () => {
    const snapshot = await sampleResources(); const high = snapshot.systemMemoryPercent >= 85 || snapshot.appMemoryBytes >= 3 * 1024 ** 3; const safe = snapshot.systemMemoryPercent <= 75 && snapshot.appMemoryBytes <= 2.5 * 1024 ** 3;
    highSamples = high ? highSamples + 1 : 0; safeSamples = safe ? safeSamples + 1 : 0;
    if (!guardPaused && highSamples >= 3) { guardPaused = true; engine.setGuardPaused(true); store.addEvent(undefined, undefined, 'warning', 'memory-guard', '内存达到保护阈值，已暂停启动新请求'); }
    if (guardPaused && safeSamples >= 5) { guardPaused = false; engine.setGuardPaused(false); store.addEvent(undefined, undefined, 'info', 'memory-guard-resume', '内存恢复到安全范围，后台队列已继续'); }
    const payload = { ...snapshot, guardPaused, guardReason: guardPaused ? '内存自动保护已暂停启动新请求' : undefined };
    const window = mainWindow;
    if (window && !window.isDestroyed()) window.webContents.send(channels.resourcesChanged, payload);
  }, 2000);
}

async function createWindow() {
  const preload = join(__dirname, 'preload.cjs');
  mainWindow = new BrowserWindow({ width: 1500, height: 960, minWidth: 980, minHeight: 680, show: !process.argv.includes('--hidden'), backgroundColor: '#f5f7fb', webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true } });
  mainWindow.on('close', (event) => { if (!quitting) { event.preventDefault(); mainWindow?.hide(); } });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) void shell.openExternal(url); return { action: 'deny' }; });
  mainWindow.webContents.on('will-navigate', (event, url) => { const current = mainWindow?.webContents.getURL(); if (current && url !== current) event.preventDefault(); });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) await mainWindow.loadURL(devUrl); else await mainWindow.loadFile(join(__dirname, '..', 'dist', 'index.html'));
}

function createTray() {
  let icon = nativeImage.createFromPath(process.execPath);
  if (icon.isEmpty()) icon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAIElEQVR42mNkYPj/n4ECwDhMDEwMDAwMjIygGmAEGQAAU4sCHXErH1UAAAAASUVORK5CYII=');
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Scene Studio · 后台任务已就绪'); tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus(); });
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { label: '暂停全部任务', click: () => engine.pauseAll() }, { label: '继续全部任务', click: () => engine.resumeAll() },
    { type: 'separator' }, { label: '安全退出', click: () => void safeQuit() },
  ]));
}

async function safeQuit() {
  if (quitting) return; quitting = true;
  if (resourceTimer) clearInterval(resourceTimer);
  await engine.shutdown(); store.close(); tray?.destroy(); mainWindow?.destroy(); app.quit();
}

const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
else {
  app.on('second-instance', () => { mainWindow?.show(); mainWindow?.focus(); });
  app.whenReady().then(async () => {
    await loadSecrets(); store = new DesktopDatabase(userDataPath('scene-studio.sqlite')); store.recoverInterrupted(); engine = new DesktopJobEngine(store, () => secrets, emitJobsChanged); registerIpc(); await createWindow(); createTray(); startResourceMonitor(); engine.start();
    if (app.isPackaged && !store.getSetting('login-startup-initialized')) {
      app.setLoginItemSettings({ openAtLogin: true, path: process.execPath, args: ['--hidden'] });
      store.setSetting('login-startup-initialized', 'true');
    }
  });
  app.on('before-quit', (event) => { if (!quitting) { event.preventDefault(); void safeQuit(); } });
  app.on('window-all-closed', () => { /* tray keeps the application alive */ });
}
