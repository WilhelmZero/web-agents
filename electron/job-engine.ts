import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import sharp from 'sharp';
import type { DesktopAssetInput } from '../src/desktop/types';
import type { LogoRemovalAnalysis, LogoRemovalSettings, LogoReplaceSettings, SceneLogoStyle, SceneReplaceSettings } from '../src/types';
import { DesktopDatabase, type ClaimedItem } from './database';
import { analyzeLogoRemoval, analyzeLogoScene, analyzeScenePrompt, generateLogo, generateLogoRemovalDesktop, generateScene, type ProviderSecrets, verifyLogo, verifyLogoRemovalDesktop } from './providers';

const SAFE_PART = /[<>:"/\\|?*\u0000-\u001f]/g;
function safePart(value: string) { return value.replace(SAFE_PART, '_').replace(/[. ]+$/, '').slice(0, 100) || '未命名'; }
function extensionFor(mime: string) { return mime.includes('jpeg') ? '.jpg' : mime.includes('webp') ? '.webp' : '.png'; }

async function exists(path: string) { try { await stat(path); return true; } catch { return false; } }

async function atomicWrite(path: string, buffer: Buffer) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.partial`;
  await writeFile(temporary, buffer);
  await rename(temporary, path);
}

function outputBase(item: ClaimedItem, kind: 'scene' | 'logo' | 'logo_removed' | '_attempts') {
  const root = resolve(item.outputRoot);
  const relative = item.groupPath.split(/[\\/]+/).filter(Boolean).map(safePart);
  const source = safePart(basename(item.sourceName, extname(item.sourceName)));
  const folder = resolve(root, ...relative, source, kind);
  if (folder !== root && !folder.startsWith(`${root}\\`) && !folder.startsWith(`${root}/`)) throw new Error('输出路径超出所选根目录');
  return { folder, source };
}

async function uniqueOutputPath(item: ClaimedItem, kind: 'scene' | 'logo' | 'logo_removed' | '_attempts', mimeType: string, suffix = '') {
  const { folder, source } = outputBase(item, kind);
  const ext = extensionFor(mimeType);
  const base = `${source}_${item.copyIndex + 1}${suffix}`;
  let path = join(folder, `${base}${ext}`); let index = 2;
  while (await exists(path)) path = join(folder, `${base}_${index++}${ext}`);
  return path;
}

async function uniquePathInFolder(folder: string, base: string, extension: string) {
  let path = join(folder, `${base}${extension}`); let index = 2;
  while (await exists(path)) path = join(folder, `${base}_${index++}${extension}`);
  return path;
}

function closestAspectRatio(width: number, height: number) {
  const ratios = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
  const target = width / height;
  return ratios.reduce((best, ratio) => {
    const [w, h] = ratio.split(':').map(Number);
    const [bestW, bestH] = best.split(':').map(Number);
    return Math.abs(w / h - target) < Math.abs(bestW / bestH - target) ? ratio : best;
  }, ratios[0]);
}

async function makeThumbnail(outputPath: string) {
  const path = join(dirname(outputPath), '.thumbnails', `${basename(outputPath, extname(outputPath))}.webp`);
  await mkdir(dirname(path), { recursive: true });
  await sharp(outputPath).rotate().resize({ width: 480, height: 360, fit: 'inside', withoutEnlargement: true }).webp({ quality: 72 }).toFile(path);
  return path;
}

async function changedRatio(sourcePath: string, generatedPath: string) {
  const options = { width: 192, height: 192, fit: 'fill' as const };
  const [a, b] = await Promise.all([sharp(sourcePath).rotate().resize(options).removeAlpha().raw().toBuffer(), sharp(generatedPath).rotate().resize(options).removeAlpha().raw().toBuffer()]);
  const pixels = Math.min(a.length, b.length) / 3; let changed = 0;
  for (let i = 0; i < pixels; i += 1) { const offset = i * 3; const delta = (Math.abs(a[offset] - b[offset]) + Math.abs(a[offset + 1] - b[offset + 1]) + Math.abs(a[offset + 2] - b[offset + 2])) / 3; if (delta >= 24) changed += 1; }
  return pixels ? changed / pixels : 0;
}

function selectLogos(logos: DesktopAssetInput[], styles: SceneLogoStyle[], distinct: boolean, seed: number) {
  const needed = distinct ? styles.reduce((sum, style) => sum + Math.max(1, style.occurrences), 0) : Math.max(1, styles.length);
  if (!logos.length) return { logos: [] as DesktopAssetInput[], styles };
  const rotated = logos.map((_, index) => logos[(index + seed) % logos.length]);
  const selected = Array.from({ length: needed }, (_, index) => rotated[index % rotated.length]);
  if (!distinct) return { logos: selected, styles: styles.length ? styles : [{ id: 'style-1', label: '原 Logo', description: '原位置', occurrences: 1, carrier: '原载体' }] };
  const expanded = styles.flatMap((style) => Array.from({ length: Math.max(1, style.occurrences) }, (_, index) => ({ ...style, id: `${style.id}-occurrence-${index + 1}`, label: `${style.label}位置 ${index + 1}`, occurrences: 1 })));
  return { logos: selected, styles: expanded };
}

export class DesktopJobEngine {
  private timer?: NodeJS.Timeout;
  private active = new Map<string, { item: ClaimedItem; controller: AbortController; done: Promise<void> }>();
  private stopped = false;
  private guardPaused = false;

  constructor(private readonly store: DesktopDatabase, private readonly getSecrets: () => ProviderSecrets, private readonly onChange: () => void) {}

  start() {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => void this.tick(), 500);
    void this.tick();
  }

  setGuardPaused(value: boolean) { this.guardPaused = value; if (!value) void this.tick(); }
  get activeCount() { return this.active.size; }

  private async tick() {
    if (this.stopped || this.guardPaused) return;
    this.store.finalizeJobs();
    const capacity = Math.max(0, this.store.getGlobalConcurrency() - this.active.size);
    if (!capacity) return;
    const items = this.store.claimRunnable(capacity, new Set(this.active.keys()));
    for (const item of items) {
      const controller = new AbortController();
      const entry = { item, controller, done: Promise.resolve() };
      this.active.set(item.id, entry);
      entry.done = this.execute(item, controller).finally(() => { this.active.delete(item.id); this.store.finalizeJobs(); this.onChange(); void this.tick(); });
    }
    if (items.length) this.onChange();
  }

  private async execute(item: ClaimedItem, controller: AbortController) {
    const config = item.jobConfig as { tool: string; settings: SceneReplaceSettings | LogoReplaceSettings | LogoRemovalSettings; prompt?: string; perImagePromptPrefix?: string; apiBaseUrl?: string | null };
    const payload = item.payload as { scene: DesktopAssetInput; logos: DesktopAssetInput[]; oldLogo?: DesktopAssetInput | null; analysis?: Record<string, unknown>; remoteBatchName?: string };
    try {
      if (!(await exists(item.sourcePath))) throw new Error(`源文件不存在：${item.sourcePath}`);
      if (item.tool === 'scene-replace') await this.executeScene(item, payload, config as typeof config & { settings: SceneReplaceSettings }, controller.signal);
      else if (item.tool === 'logo-replace') await this.executeLogo(item, payload, config as typeof config & { settings: LogoReplaceSettings }, controller.signal);
      else await this.executeLogoRemoval(item, payload as { scene: DesktopAssetInput; analysis?: LogoRemovalAnalysis }, config as typeof config & { settings: LogoRemovalSettings }, controller.signal);
    } catch (error) {
      const message = error instanceof Error ? error.message : '后台任务失败';
      if (controller.signal.aborted) {
        if (this.store.isJobCancelled(item.jobId)) this.store.setItemState(item.id, 'cancelled', '已取消', { error: '任务已由用户停止' });
        else this.store.setItemState(item.id, 'interrupted', '等待恢复', { error: '任务已安全中断，将在下次启动或继续后恢复' });
      } else if (item.retryCount < item.maxRetries) {
        const settings = config.settings; const delay = Math.max(1, Number(settings.errorRetryDelaySeconds || 30)) * 1000;
        this.store.setItemState(item.id, 'retry_wait', '等待自动重试', { error: message, retryCount: item.retryCount + 1, nextRetryAt: Date.now() + delay });
        this.store.addEvent(item.jobId, item.id, 'warning', 'retry-scheduled', `${item.sourceName}：${message}，将在 ${Math.round(delay / 1000)} 秒后重试`);
      } else {
        this.store.setItemState(item.id, 'failed', '最终失败', { error: message, nextRetryAt: null });
        this.store.addEvent(item.jobId, item.id, 'error', 'item-failed', `${item.sourceName}：${message}`);
      }
      this.onChange();
    }
  }

  private async executeScene(item: ClaimedItem, payload: { scene: DesktopAssetInput; analysis?: Record<string, unknown>; remoteBatchName?: string }, config: { settings: SceneReplaceSettings; prompt?: string; perImagePromptPrefix?: string; apiBaseUrl?: string | null }, signal: AbortSignal) {
    let prompt = item.prompt || config.prompt || '';
    if ((config.settings.perImagePromptEnabled || config.settings.autoRecommendScene) && !payload.analysis) {
      this.store.setItemState(item.id, 'analyzing', '逐图提示词分析'); this.onChange();
      const attempt = this.store.startAttempt(item, 'prompt-analysis', config.settings.sceneRecommendationProvider, config.settings.sceneRecommendationProvider === 'openai' ? config.settings.openAiSceneRecommendationModel : config.settings.sceneRecommendationModel, prompt);
      try {
        const analysis = await analyzeScenePrompt({ sourcePath: item.sourcePath, sourcePrompt: [config.perImagePromptPrefix, prompt].filter(Boolean).join('；'), settings: config.settings, secrets: this.getSecrets(), apiBaseUrl: config.apiBaseUrl, signal });
        payload.analysis = analysis; prompt = [analysis.prompt, analysis.constraints].filter(Boolean).join('\n'); this.store.updatePayload(item.id, payload); this.store.finishAttempt(attempt, 'success');
      } catch (error) { this.store.finishAttempt(attempt, 'failed', { error: error instanceof Error ? error.message : String(error) }); throw error; }
    } else if (payload.analysis?.prompt) prompt = [payload.analysis.prompt, payload.analysis.constraints].filter(Boolean).map(String).join('\n');
    this.store.setItemState(item.id, 'running', '场景生成', { prompt }); this.onChange();
    const provider = config.settings.imageModel.startsWith('gpt-image') ? 'openai' : 'gemini';
    const attempt = this.store.startAttempt(item, 'scene-generation', provider, config.settings.imageModel, prompt);
    let outputPath = '';
    try {
      const generated = await generateScene({ sourcePath: item.sourcePath, prompt, settings: config.settings, secrets: this.getSecrets(), apiBaseUrl: config.apiBaseUrl, signal, batchJobName: payload.remoteBatchName, onBatchJobName: (name) => { payload.remoteBatchName = name; this.store.updatePayload(item.id, payload); }, onBatchState: (state) => { this.store.setItemState(item.id, 'running', `Gemini Batch：${state}`); this.onChange(); } });
      outputPath = await uniqueOutputPath(item, 'scene', generated.mimeType);
      await atomicWrite(outputPath, generated.buffer);
      if (config.settings.detectInsufficientSceneChange) {
        this.store.setItemState(item.id, 'verifying', '检测场景变化', { outputPath }); this.onChange();
        const ratio = await changedRatio(item.sourcePath, outputPath);
        if (ratio <= 0.2) { await rm(outputPath, { force: true }); throw new Error(`场景变化检测未通过：变化 ${(ratio * 100).toFixed(1)}%，不超过 20%`); }
      }
      const thumbnailPath = await makeThumbnail(outputPath);
      this.store.finishAttempt(attempt, 'success', { outputPath, cost: generated.estimatedCost });
      this.store.addArtifact(item.jobId, item.id, 'scene', outputPath, generated.mimeType);
      this.store.addArtifact(item.jobId, item.id, 'thumbnail', thumbnailPath, 'image/webp');
      if (config.settings.autoOutpaint) await this.executeOutpaint(item, outputPath, config, signal);
      this.store.setItemState(item.id, 'completed', '已完成', { outputPath, thumbnailPath, error: null, nextRetryAt: null });
      this.store.addEvent(item.jobId, item.id, 'info', 'item-completed', `${item.sourceName} 已保存到 ${outputPath}`);
    } catch (error) { this.store.finishAttempt(attempt, signal.aborted ? 'interrupted' : 'failed', { outputPath: outputPath || undefined, error: error instanceof Error ? error.message : String(error) }); throw error; }
  }

  private async executeOutpaint(item: ClaimedItem, sourcePath: string, config: { settings: SceneReplaceSettings; apiBaseUrl?: string | null }, signal: AbortSignal) {
    const sizes = config.settings.outpaintBothSizes ? [{ width: 3200, height: 1310 }, { width: 1800, height: 1350 }] : [{ width: config.settings.outpaintWidth, height: config.settings.outpaintHeight }];
    for (const size of sizes) {
      this.store.setItemState(item.id, 'running', `扩图 ${size.width}×${size.height}`); this.onChange();
      const meta = await sharp(sourcePath).metadata(); const width = meta.width || size.width; const height = meta.height || size.height;
      const scale = Math.min(size.width / width, size.height / height); const containedWidth = Math.round(width * scale); const containedHeight = Math.round(height * scale);
      const blurred = await sharp(sourcePath).resize(size.width, size.height, { fit: 'cover' }).blur(Math.max(8, Math.round(Math.min(size.width, size.height) * 0.02))).png().toBuffer();
      const foreground = await sharp(sourcePath).resize(containedWidth, containedHeight, { fit: 'fill' }).png().toBuffer();
      const preparedPath = join(dirname(sourcePath), `.scene-studio-${item.id}-${size.width}x${size.height}.png`);
      await sharp(blurred).composite([{ input: foreground, left: Math.round((size.width - containedWidth) / 2), top: Math.round((size.height - containedHeight) / 2) }]).png().toFile(preparedPath);
      const outpaintSettings: SceneReplaceSettings = { ...config.settings, executionMode: 'realtime', imageModel: config.settings.outpaintImageModel, imageSize: config.settings.outpaintImageSize, imageQuality: config.settings.outpaintQuality, ratioMode: 'fixed', aspectRatio: closestAspectRatio(size.width, size.height), autoOutpaint: false, detectInsufficientSceneChange: false };
      const prompt = `${config.settings.outpaintPrompt}\n只扩展目标比例缺少的单一方向，中央原始清晰画面完整不变，新增区域与边界、透视、光线和景深自然连续。`;
      const attempt = this.store.startAttempt(item, 'outpaint', outpaintSettings.imageModel.startsWith('gpt-image') ? 'openai' : 'gemini', outpaintSettings.imageModel, prompt);
      try {
        const generated = await generateScene({ sourcePath: preparedPath, prompt, settings: outpaintSettings, secrets: this.getSecrets(), apiBaseUrl: config.apiBaseUrl, signal });
        const { folder, source } = outputBase(item, 'scene'); const outpaintFolder = join(folder, 'outpaint', `${size.width}x${size.height}`);
        const outputPath = await uniquePathInFolder(outpaintFolder, `${source}_${item.copyIndex + 1}_${size.width}x${size.height}`, '.png');
        const resized = await sharp(generated.buffer).resize(size.width, size.height, { fit: 'fill' }).png().toBuffer(); await atomicWrite(outputPath, resized);
        this.store.finishAttempt(attempt, 'success', { outputPath, cost: generated.estimatedCost }); this.store.addArtifact(item.jobId, item.id, 'outpaint', outputPath, 'image/png', size.width, size.height);
      } catch (error) { this.store.finishAttempt(attempt, signal.aborted ? 'interrupted' : 'failed', { error: error instanceof Error ? error.message : String(error) }); throw error; }
      finally { await rm(preparedPath, { force: true }); }
    }
  }

  private async executeLogo(item: ClaimedItem, payload: { scene: DesktopAssetInput; logos: DesktopAssetInput[]; oldLogo?: DesktopAssetInput | null; analysis?: Record<string, unknown> }, config: { settings: LogoReplaceSettings; apiBaseUrl?: string | null }, signal: AbortSignal) {
    let analysis = payload.analysis as { action?: string; reason?: string; styles?: SceneLogoStyle[] } | undefined;
    if (config.settings.perImagePromptEnabled || config.settings.multiLogoModeEnabled || config.settings.distinctLogoPerOccurrence) {
      if (!analysis) {
        this.store.setItemState(item.id, 'analyzing', 'Logo位置与逐图分析'); this.onChange();
        const attempt = this.store.startAttempt(item, 'logo-analysis', config.settings.languageProvider, config.settings.languageProvider === 'openai' ? config.settings.openAiLanguageModel : config.settings.verificationModel);
        try { analysis = await analyzeLogoScene({ sourcePath: item.sourcePath, settings: config.settings, secrets: this.getSecrets(), apiBaseUrl: config.apiBaseUrl, signal }); payload.analysis = analysis; this.store.updatePayload(item.id, payload); this.store.finishAttempt(attempt, 'success'); }
        catch (error) { this.store.finishAttempt(attempt, 'failed', { error: error instanceof Error ? error.message : String(error) }); throw error; }
      }
      if (analysis.action === 'skip-no-logo' || analysis.action === 'skip-gift-scene') {
        const outputPath = await uniqueOutputPath(item, 'logo', mimeForPath(item.sourcePath), '_原图保留'); await mkdir(dirname(outputPath), { recursive: true }); await copyFile(item.sourcePath, outputPath); const thumbnailPath = await makeThumbnail(outputPath);
        this.store.addArtifact(item.jobId, item.id, 'logo-skip', outputPath, mimeForPath(item.sourcePath)); this.store.setItemState(item.id, 'completed', `已跳过：${analysis.reason || '无需替换'}`, { outputPath, thumbnailPath, error: analysis.reason || null }); return;
      }
    }
    const styles = analysis?.styles?.length ? analysis.styles : [{ id: 'style-1', label: '原 Logo', description: '原位置', occurrences: 1, carrier: '原载体' }];
    const selected = selectLogos(payload.logos || [], styles, Boolean(config.settings.distinctLogoPerOccurrence), item.copyIndex);
    this.store.setItemState(item.id, 'running', 'Logo生成'); this.onChange();
    const attempt = this.store.startAttempt(item, 'logo-generation', config.settings.imageProvider, config.settings.imageProvider === 'openai' ? config.settings.openAiImageModel : config.settings.imageModel);
    let outputPath = '';
    try {
      const generated = await generateLogo({ sourcePath: item.sourcePath, logoPaths: selected.logos.map((logo) => logo.path), oldLogoPath: payload.oldLogo?.path, prompt: config.settings.replacementPrompt, styles: selected.styles, settings: config.settings, secrets: this.getSecrets(), apiBaseUrl: config.apiBaseUrl, signal });
      outputPath = await uniqueOutputPath(item, 'logo', generated.mimeType); await atomicWrite(outputPath, generated.buffer);
      this.store.finishAttempt(attempt, 'success', { outputPath, cost: generated.estimatedCost });
      if (config.settings.strictTextVerification) {
        this.store.setItemState(item.id, 'verifying', 'Logo严格校验', { outputPath }); this.onChange();
        const verificationAttempt = this.store.startAttempt(item, 'logo-verification', config.settings.languageProvider, config.settings.languageProvider === 'openai' ? config.settings.openAiLanguageModel : config.settings.verificationModel);
        try { const result = await verifyLogo({ sourcePath: item.sourcePath, logoPath: selected.logos[0].path, generatedPath: outputPath, settings: config.settings, secrets: this.getSecrets(), apiBaseUrl: config.apiBaseUrl, signal }); this.store.finishAttempt(verificationAttempt, result.passed ? 'success' : 'failed', { error: result.passed ? undefined : result.summary }); if (!result.passed) { const failedPath = join(dirname(outputPath), '_attempts', basename(outputPath)); await mkdir(dirname(failedPath), { recursive: true }); await rename(outputPath, failedPath); throw new Error(`Logo 校验未通过：${result.summary}`); } }
        catch (error) { if (await exists(outputPath)) { const failedPath = join(dirname(outputPath), '_attempts', basename(outputPath)); await mkdir(dirname(failedPath), { recursive: true }); await rename(outputPath, failedPath).catch(() => undefined); } throw error; }
      }
      const thumbnailPath = await makeThumbnail(outputPath); this.store.addArtifact(item.jobId, item.id, 'logo', outputPath, generated.mimeType); this.store.addArtifact(item.jobId, item.id, 'thumbnail', thumbnailPath, 'image/webp'); this.store.setItemState(item.id, 'completed', '已完成', { outputPath, thumbnailPath, error: null, nextRetryAt: null });
      this.store.addEvent(item.jobId, item.id, 'info', 'item-completed', `${item.sourceName} 已保存到 ${outputPath}`);
    } catch (error) { if (!outputPath) this.store.finishAttempt(attempt, signal.aborted ? 'interrupted' : 'failed', { error: error instanceof Error ? error.message : String(error) }); throw error; }
  }

  private async executeLogoRemoval(item: ClaimedItem, payload: { scene: DesktopAssetInput; analysis?: LogoRemovalAnalysis }, config: { settings: LogoRemovalSettings; apiBaseUrl?: string | null }, signal: AbortSignal) {
    let analysis = payload.analysis;
    if (!analysis) {
      this.store.setItemState(item.id, 'analyzing', '分析待去除 Logo'); this.onChange();
      const provider = config.settings.analysisProvider;
      const model = provider === 'openai' ? config.settings.openAiAnalysisModel : config.settings.analysisModel;
      const attempt = this.store.startAttempt(item, 'logo-removal-analysis', provider, model, item.prompt);
      try {
        analysis = await analyzeLogoRemoval({ sourcePath: item.sourcePath, settings: config.settings, secrets: this.getSecrets(), apiBaseUrl: config.apiBaseUrl, signal });
        payload.analysis = analysis; this.store.updatePayload(item.id, payload); this.store.finishAttempt(attempt, 'success');
      } catch (error) { this.store.finishAttempt(attempt, signal.aborted ? 'interrupted' : 'failed', { error: error instanceof Error ? error.message : String(error) }); throw error; }
    }
    if (analysis.action === 'skip_no_target') {
      const outputPath = await uniqueOutputPath(item, 'logo_removed', mimeForPath(item.sourcePath), '_无需处理');
      await mkdir(dirname(outputPath), { recursive: true }); await copyFile(item.sourcePath, outputPath);
      const thumbnailPath = await makeThumbnail(outputPath);
      this.store.addArtifact(item.jobId, item.id, 'logo-removal-skip', outputPath, mimeForPath(item.sourcePath));
      this.store.addArtifact(item.jobId, item.id, 'thumbnail', thumbnailPath, 'image/webp');
      this.store.setItemState(item.id, 'completed', `无需处理：${analysis.reason || '未识别到目标 Logo'}`, { outputPath, thumbnailPath, error: null, nextRetryAt: null });
      this.store.addEvent(item.jobId, item.id, 'info', 'item-skipped', `${item.sourceName} 未识别到目标 Logo，已原样保存`); return;
    }

    let feedback = '';
    for (let repair = 0; repair <= config.settings.verificationRetries; repair += 1) {
      this.store.setItemState(item.id, 'running', repair ? `自动修复 ${repair}/${config.settings.verificationRetries}` : '去除 Logo'); this.onChange();
      const provider = config.settings.imageProvider; const model = provider === 'openai' ? config.settings.openAiImageModel : config.settings.imageModel;
      const attempt = this.store.startAttempt(item, repair ? 'logo-removal-repair' : 'logo-removal-generation', provider, model, item.prompt);
      let candidatePath = '';
      try {
        const generated = await generateLogoRemovalDesktop({ sourcePath: item.sourcePath, analysis, settings: config.settings, secrets: this.getSecrets(), apiBaseUrl: config.apiBaseUrl, signal, feedback });
        candidatePath = await uniqueOutputPath(item, '_attempts', generated.mimeType, `_候选${repair + 1}`);
        await atomicWrite(candidatePath, generated.buffer);
        if (!config.settings.verificationEnabled) {
          const outputPath = await uniqueOutputPath(item, 'logo_removed', generated.mimeType); await mkdir(dirname(outputPath), { recursive: true }); await copyFile(candidatePath, outputPath);
          const thumbnailPath = await makeThumbnail(outputPath); this.store.finishAttempt(attempt, 'success', { outputPath: candidatePath, cost: generated.estimatedCost });
          this.store.addArtifact(item.jobId, item.id, 'logo-removed', outputPath, generated.mimeType); this.store.addArtifact(item.jobId, item.id, 'thumbnail', thumbnailPath, 'image/webp');
          this.store.setItemState(item.id, 'completed', '已完成', { outputPath, thumbnailPath, error: null, nextRetryAt: null }); return;
        }
        this.store.setItemState(item.id, 'verifying', '校验去除结果', { outputPath: candidatePath }); this.onChange();
        const verification = await verifyLogoRemovalDesktop({ sourcePath: item.sourcePath, generatedPath: candidatePath, analysis, settings: config.settings, secrets: this.getSecrets(), apiBaseUrl: config.apiBaseUrl, signal });
        if (!verification.passed) {
          feedback = [...verification.differences, verification.summary].filter(Boolean).join('；');
          this.store.finishAttempt(attempt, 'failed', { outputPath: candidatePath, cost: generated.estimatedCost, error: feedback });
          if (repair >= config.settings.verificationRetries) throw new Error(`去除结果校验未通过：${feedback}`);
          continue;
        }
        const outputPath = await uniqueOutputPath(item, 'logo_removed', generated.mimeType); await mkdir(dirname(outputPath), { recursive: true }); await copyFile(candidatePath, outputPath);
        const thumbnailPath = await makeThumbnail(outputPath); this.store.finishAttempt(attempt, 'success', { outputPath: candidatePath, cost: generated.estimatedCost });
        this.store.addArtifact(item.jobId, item.id, 'logo-removal-attempt', candidatePath, generated.mimeType);
        this.store.addArtifact(item.jobId, item.id, 'logo-removed', outputPath, generated.mimeType); this.store.addArtifact(item.jobId, item.id, 'thumbnail', thumbnailPath, 'image/webp');
        this.store.setItemState(item.id, 'completed', '已完成并通过校验', { outputPath, thumbnailPath, error: null, nextRetryAt: null });
        this.store.addEvent(item.jobId, item.id, 'info', 'item-completed', `${item.sourceName} 已保存到 ${outputPath}`); return;
      } catch (error) {
        if (!feedback || signal.aborted || repair >= config.settings.verificationRetries) {
          if (candidatePath) this.store.addArtifact(item.jobId, item.id, 'logo-removal-attempt', candidatePath, mimeForPath(candidatePath));
          if (!feedback) this.store.finishAttempt(attempt, signal.aborted ? 'interrupted' : 'failed', { outputPath: candidatePath || undefined, error: error instanceof Error ? error.message : String(error) });
          throw error;
        }
      }
    }
  }

  pauseJob(jobId: string) { this.store.setJobStatus(jobId, 'paused'); this.onChange(); }
  resumeJob(jobId: string) { this.store.setJobStatus(jobId, 'queued'); this.onChange(); void this.tick(); }
  cancelJob(jobId: string) { for (const active of this.active.values()) if (active.item.jobId === jobId) active.controller.abort(); this.store.setJobStatus(jobId, 'cancelled'); this.onChange(); }
  retryJob(jobId: string) { this.store.retryJob(jobId); this.onChange(); void this.tick(); }
  pauseAll() { this.store.pauseAll(); this.onChange(); }
  resumeAll() { this.store.resumeAll(); this.onChange(); void this.tick(); }

  async shutdown() {
    this.stopped = true; if (this.timer) clearInterval(this.timer); this.timer = undefined;
    const active = Array.from(this.active.values()); active.forEach(({ controller }) => controller.abort());
    await Promise.allSettled(active.map(({ done }) => done));
    this.store.markActiveInterrupted();
  }
}

function mimeForPath(path: string) { const ext = extname(path).toLowerCase(); return ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png'; }
