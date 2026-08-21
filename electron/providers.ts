import { GoogleGenAI } from '@google/genai';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { LogoRemovalAnalysis, LogoRemovalSettings, LogoRemovalVerification, LogoReplaceSettings, SceneLogoStyle, SceneReplaceSettings } from '../src/types';
import { buildSceneReplacementPrompt } from '../src/services/sceneReplacementPrompt';

export interface ProviderSecrets { gemini?: string; openAi?: string }
export interface GeneratedBuffer { buffer: Buffer; mimeType: string; model: string; provider: 'gemini' | 'openai'; estimatedCost: number }

const OPENAI_ROOT = 'https://api.openai.com/v1';
const mimeByExtension: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

function mimeFor(path: string, fallback?: string) { return fallback || mimeByExtension[extname(path).toLowerCase()] || 'application/octet-stream'; }
function cleanBaseUrl(value?: string | null) { return value?.replace(/\/$/, '') || ''; }

async function apiError(response: Response) {
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  return new Error(body?.error?.message || `模型请求失败（HTTP ${response.status}）`);
}

function openAiOutputText(data: unknown) {
  const value = data as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
  return value.output_text || value.output?.flatMap((item) => item.content || []).map((item) => item.text || '').join('') || '';
}

async function requestJson(options: { provider: 'gemini' | 'openai'; apiKey: string; apiBaseUrl?: string | null; model: string; imagePaths: string[]; prompt: string; signal: AbortSignal }) {
  const images = await Promise.all(options.imagePaths.map(async (path) => ({ path, mime: mimeFor(path), base64: (await readFile(path)).toString('base64') })));
  if (options.provider === 'openai') {
    const response = await fetch(`${OPENAI_ROOT}/responses`, { method: 'POST', signal: options.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.apiKey}` }, body: JSON.stringify({ model: options.model, input: [{ role: 'user', content: [{ type: 'input_text', text: options.prompt }, ...images.map((image) => ({ type: 'input_image', image_url: `data:${image.mime};base64,${image.base64}`, detail: 'high' }))] }] }) });
    if (!response.ok) throw await apiError(response);
    return openAiOutputText(await response.json()).trim();
  }
  const root = cleanBaseUrl(options.apiBaseUrl);
  const endpoint = root ? `${root}/models/${options.model}:generateContent` : `https://generativelanguage.googleapis.com/v1beta/models/${options.model}:generateContent?key=${encodeURIComponent(options.apiKey)}`;
  const response = await fetch(endpoint, { method: 'POST', signal: options.signal, headers: { 'Content-Type': 'application/json', ...(root ? { 'x-goog-api-key': options.apiKey } : {}) }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: options.prompt }, ...images.map((image) => ({ inlineData: { mimeType: image.mime, data: image.base64 } }))] }] }) });
  if (!response.ok) throw await apiError(response);
  const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  return data.candidates?.flatMap((item) => item.content?.parts || []).map((item) => item.text || '').join('').trim() || '';
}

function extractJson<T>(text: string): T {
  const start = text.indexOf('{'); const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('语言模型未返回有效 JSON');
  return JSON.parse(text.slice(start, end + 1)) as T;
}

export async function analyzeScenePrompt(options: { sourcePath: string; sourcePrompt: string; settings: SceneReplaceSettings; secrets: ProviderSecrets; apiBaseUrl?: string | null; signal: AbortSignal }) {
  const provider = options.settings.sceneRecommendationProvider;
  const apiKey = provider === 'openai' ? options.secrets.openAi : options.secrets.gemini;
  if (!apiKey) throw new Error(`未配置 ${provider === 'openai' ? 'OpenAI' : 'Gemini'} API Key`);
  const model = provider === 'openai' ? options.settings.openAiSceneRecommendationModel : options.settings.sceneRecommendationModel;
  const text = await requestJson({ provider, apiKey, apiBaseUrl: options.apiBaseUrl, model, imagePaths: [options.sourcePath], signal: options.signal, prompt: `你是商业图片编辑提示词分析器。分析输入图片，只从用户当前需求中保留与这张图实际相关的条件，不得虚构。必须识别：是否纯桌面/无纵深棚拍、是否有木盒礼盒、人物和手、多个小图、前景商品说明文字、背景文字、裁切主体、原始景深。输出严格 JSON：{"summary":"简短摘要","prompt":"适合该图的目标场景描述","constraints":"只包含该图实际需要的保护限制"}。用户需求：${options.sourcePrompt}` });
  const parsed = extractJson<{ summary?: string; prompt?: string; constraints?: string }>(text);
  return { summary: parsed.summary || '', prompt: parsed.prompt?.trim() || options.sourcePrompt, constraints: parsed.constraints || '' };
}

export async function analyzeLogoScene(options: { sourcePath: string; settings: LogoReplaceSettings; secrets: ProviderSecrets; apiBaseUrl?: string | null; signal: AbortSignal }) {
  const provider = options.settings.languageProvider;
  const apiKey = provider === 'openai' ? options.secrets.openAi : options.secrets.gemini;
  if (!apiKey) throw new Error(`未配置 ${provider === 'openai' ? 'OpenAI' : 'Gemini'} API Key`);
  const model = provider === 'openai' ? options.settings.openAiLanguageModel : options.settings.verificationModel;
  const text = await requestJson({ provider, apiKey, apiBaseUrl: options.apiBaseUrl, model, imagePaths: [options.sourcePath], signal: options.signal, prompt: `分析输入场景中杯子、醒酒器及木盒表面已经存在、确实需要替换的 Logo。不要把商品说明、背景装饰、无 Logo 礼盒或人物送礼图误判为 Logo。每个样式的 description 必须逐个写出旧 Logo 在整图中的归一化包围框 left/top/right/bottom、中心点 cx/cy，以及相对杯口、泡沫线、液面线、杯把、杯身花纹起始线、杯底或载体边缘等最近地标的位置。带把啤酒杯或马克杯上半部、泡沫/液面附近的 Logo 必须明确标注其高度，禁止描述成杯身居中。输出严格 JSON：{"summary":"摘要","action":"replace|skip-no-logo|skip-gift-scene","reason":"原因","styles":[{"id":"style-1","label":"样式1","description":"位置、归一化包围框与地标特征","occurrences":1,"carrier":"载体"}]}。同一视觉 Logo 多次出现合并为一个样式并准确统计次数。` });
  const parsed = extractJson<{ summary?: string; action?: string; reason?: string; styles?: SceneLogoStyle[] }>(text);
  const action = parsed.action === 'skip-gift-scene' || parsed.action === 'skip-no-logo' ? parsed.action : 'replace';
  return { summary: parsed.summary || '', action, reason: parsed.reason || '', styles: (parsed.styles || []).map((style, index) => ({ ...style, id: style.id || `style-${index + 1}`, occurrences: Math.max(1, Number(style.occurrences) || 1) })) };
}

async function generateGemini(options: { apiKey: string; apiBaseUrl?: string | null; model: string; imagePaths: string[]; prompt: string; imageSize: string; aspectRatio?: string; signal: AbortSignal }) {
  const images = await Promise.all(options.imagePaths.map(async (path) => ({ mime: mimeFor(path), data: (await readFile(path)).toString('base64') })));
  const root = cleanBaseUrl(options.apiBaseUrl);
  const endpoint = root ? `${root}/models/${options.model}:generateContent` : `https://generativelanguage.googleapis.com/v1beta/models/${options.model}:generateContent?key=${encodeURIComponent(options.apiKey)}`;
  const response = await fetch(endpoint, { method: 'POST', signal: options.signal, headers: { 'Content-Type': 'application/json', ...(root ? { 'x-goog-api-key': options.apiKey } : {}) }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: options.prompt }, ...images.map((image) => ({ inlineData: { mimeType: image.mime, data: image.data } }))] }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { imageSize: options.imageSize, ...(options.aspectRatio ? { aspectRatio: options.aspectRatio } : {}) } } }) });
  if (!response.ok) throw await apiError(response);
  const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> } }> };
  const part = data.candidates?.flatMap((item) => item.content?.parts || []).find((item) => item.inlineData?.data)?.inlineData;
  if (!part?.data) throw new Error('Gemini 未返回图片');
  return { buffer: Buffer.from(part.data, 'base64'), mimeType: part.mimeType || 'image/png' };
}

const FINISHED_BATCH_STATES = new Set(['JOB_STATE_SUCCEEDED', 'JOB_STATE_FAILED', 'JOB_STATE_CANCELLED', 'JOB_STATE_EXPIRED']);

function abortableDelay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(new Error('Gemini Batch 已安全中止')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, milliseconds);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function generateGeminiBatch(options: { apiKey: string; apiBaseUrl?: string | null; model: string; imagePath: string; prompt: string; imageSize: string; aspectRatio?: string; signal: AbortSignal; jobName?: string; onJobName?: (name?: string) => void; onState?: (state: string) => void }) {
  const root = cleanBaseUrl(options.apiBaseUrl);
  const client = new GoogleGenAI({ apiKey: options.apiKey, ...(root ? { httpOptions: { baseUrl: root } } : {}) });
  let current = options.jobName ? await client.batches.get({ name: options.jobName }) : await client.batches.create({
    model: options.model,
    src: [{ contents: [{ role: 'user', parts: [{ text: options.prompt }, { inlineData: { mimeType: mimeFor(options.imagePath), data: (await readFile(options.imagePath)).toString('base64') } }] }], config: { responseModalities: ['IMAGE'], imageConfig: { imageSize: options.imageSize, ...(options.aspectRatio ? { aspectRatio: options.aspectRatio } : {}) } } }],
    config: { displayName: `scene-studio-desktop-${Date.now()}` },
  });
  if (!current.name) throw new Error('Gemini Batch 未返回任务编号');
  const jobName = current.name;
  options.onJobName?.(jobName);
  while (!FINISHED_BATCH_STATES.has(String(current.state))) {
    if (options.signal.aborted) {
      await client.batches.cancel({ name: jobName }).catch(() => undefined); options.onJobName?.();
      throw new Error('Gemini Batch 已安全中止');
    }
    options.onState?.(String(current.state || 'JOB_STATE_PENDING'));
    try { await abortableDelay(10_000, options.signal); }
    catch (error) { await client.batches.cancel({ name: jobName }).catch(() => undefined); options.onJobName?.(); throw error; }
    current = await client.batches.get({ name: jobName });
  }
  options.onState?.(String(current.state));
  if (String(current.state) !== 'JOB_STATE_SUCCEEDED') { options.onJobName?.(); throw new Error(`Gemini Batch 任务未完成：${String(current.state)}`); }
  const output = current.dest?.inlinedResponses?.[0];
  if (output?.error) { options.onJobName?.(); throw new Error(output.error.message || 'Gemini Batch 子任务失败'); }
  const part = output?.response?.candidates?.flatMap((candidate) => candidate.content?.parts || []).find((item) => item.inlineData?.data)?.inlineData;
  if (!part?.data) { options.onJobName?.(); throw new Error('Gemini Batch 未返回图片'); }
  options.onJobName?.();
  return { buffer: Buffer.from(part.data, 'base64'), mimeType: part.mimeType || 'image/png' };
}

async function generateOpenAi(options: { apiKey: string; model: string; imagePaths: string[]; prompt: string; quality?: string; signal: AbortSignal }) {
  const form = new FormData();
  for (const path of options.imagePaths) form.append('image[]', new Blob([await readFile(path)], { type: mimeFor(path) }), basename(path));
  form.append('prompt', options.prompt); form.append('model', options.model); form.append('n', '1'); form.append('size', 'auto'); form.append('quality', options.quality || 'high'); form.append('output_format', 'png');
  const response = await fetch(`${OPENAI_ROOT}/images/edits`, { method: 'POST', signal: options.signal, headers: { Authorization: `Bearer ${options.apiKey}` }, body: form });
  if (!response.ok) throw await apiError(response);
  const data = await response.json() as { data?: Array<{ b64_json?: string; url?: string }> };
  const item = data.data?.[0];
  if (item?.b64_json) return { buffer: Buffer.from(item.b64_json, 'base64'), mimeType: 'image/png' };
  if (item?.url) { const image = await fetch(item.url, { signal: options.signal }); if (!image.ok) throw await apiError(image); return { buffer: Buffer.from(await image.arrayBuffer()), mimeType: image.headers.get('content-type') || 'image/png' }; }
  throw new Error('OpenAI 未返回图片');
}

export async function generateScene(options: { sourcePath: string; prompt: string; settings: SceneReplaceSettings; secrets: ProviderSecrets; apiBaseUrl?: string | null; signal: AbortSignal; batchJobName?: string; onBatchJobName?: (name?: string) => void; onBatchState?: (state: string) => void }): Promise<GeneratedBuffer> {
  const prompt = buildSceneReplacementPrompt(options.prompt);
  if (options.settings.imageModel.startsWith('gpt-image')) {
    if (!options.secrets.openAi) throw new Error('未配置 OpenAI API Key');
    const result = await generateOpenAi({ apiKey: options.secrets.openAi, model: options.settings.imageModel, imagePaths: [options.sourcePath], prompt, quality: options.settings.imageQuality, signal: options.signal });
    return { ...result, model: options.settings.imageModel, provider: 'openai', estimatedCost: 0.211 };
  }
  if (!options.secrets.gemini) throw new Error('未配置 Gemini API Key');
  const generatorOptions = { apiKey: options.secrets.gemini, apiBaseUrl: options.apiBaseUrl, model: options.settings.imageModel, prompt, imageSize: options.settings.imageSize, aspectRatio: options.settings.ratioMode === 'fixed' ? options.settings.aspectRatio : undefined, signal: options.signal };
  const result = options.settings.executionMode === 'batch'
    ? await generateGeminiBatch({ ...generatorOptions, imagePath: options.sourcePath, jobName: options.batchJobName, onJobName: options.onBatchJobName, onState: options.onBatchState })
    : await generateGemini({ ...generatorOptions, imagePaths: [options.sourcePath] });
  const costBySize = { '0.5K': 0.045, '1K': 0.067, '2K': 0.101, '4K': 0.151 } as Record<string, number>;
  const realtimeCost = costBySize[options.settings.imageSize] || 0.067;
  return { ...result, model: options.settings.imageModel, provider: 'gemini', estimatedCost: options.settings.executionMode === 'batch' ? realtimeCost * 0.5 : realtimeCost };
}

function logoHardConstraints() {
  return `只替换输入场景中原本存在的 Logo 区域，禁止在无 Logo 处新增。生成前逐个测量旧 Logo 在整图中的归一化包围框 left/top/right/bottom、中心点 cx/cy、文字基线、旋转角，以及相对杯口、泡沫线、液面线、杯把、杯身花纹起始线、杯底和载体边缘的位置，并把它锁定为不可移动定位遮罩。新 Logo 必须在该遮罩内保持原中心点与上下高度原位替换；中心偏移不得超过载体可见宽高约 1.5%，包围框边不得无故漂移超过约 3%，严禁自动移动到杯子或载体中间。带把啤酒杯或马克杯的旧 Logo 若位于上半部并跨越或贴近泡沫/液面分界，新 Logo 必须保持同一高度和分界关系，绝不能下移到杯身中段。新旧宽高比不同时，只能保持新 Logo 原始比例在旧包围框内等比适配。除 Logo 区域外，场景、构图、杯子、木盒、内衬、人物、手、光影、位置、承托和遮挡关系全部保持不变。新 Logo 的图形拓扑、文字、比例、镂空、孔洞和负空间必须与参考完全一致，镂空处继续显示载体，禁止填实或重新设计。若旧 Logo 被手遮挡，新 Logo 必须仍位于手后方，禁止贴到手或皮肤上。盒子内部、内衬、盒盖或其他原本无 Logo 的位置禁止新增 Logo。杯底 Logo 必须完整位于杯底最内层平坦安全区，四周保留 10%–15% 净空，不得跨出内圈、装饰环、倒角、外缘或侧壁。Logo 必须在锁定位置贴合原载体的曲率、透视、反射、折射和雕刻/印刷工艺，禁止平面覆盖。`;
}

export async function generateLogo(options: { sourcePath: string; logoPaths: string[]; oldLogoPath?: string; prompt: string; styles?: SceneLogoStyle[]; settings: LogoReplaceSettings; secrets: ProviderSecrets; apiBaseUrl?: string | null; signal: AbortSignal }): Promise<GeneratedBuffer> {
  if (!options.logoPaths.length) throw new Error('没有可用于替换的新 Logo');
  const mapping = options.styles?.length ? `映射：${options.styles.map((style, index) => `${style.label}的 ${style.occurrences} 个位置使用第 ${index + 2} 张 Logo`).join('；')}。` : '把原有 Logo 替换为随后提供的新 Logo。';
  const prompt = `${mapping}${logoHardConstraints()}${options.prompt || options.settings.replacementPrompt || ''}`;
  const imagePaths = [options.sourcePath, ...(options.oldLogoPath ? [options.oldLogoPath] : []), ...options.logoPaths];
  if (options.settings.imageProvider === 'openai') {
    if (!options.secrets.openAi) throw new Error('未配置 OpenAI API Key');
    const result = await generateOpenAi({ apiKey: options.secrets.openAi, model: options.settings.openAiImageModel, imagePaths, prompt, quality: 'high', signal: options.signal });
    return { ...result, model: options.settings.openAiImageModel, provider: 'openai', estimatedCost: 0.211 };
  }
  if (!options.secrets.gemini) throw new Error('未配置 Gemini API Key');
  const result = await generateGemini({ apiKey: options.secrets.gemini, apiBaseUrl: options.apiBaseUrl, model: options.settings.imageModel, imagePaths, prompt, imageSize: options.settings.imageSize, aspectRatio: options.settings.ratioMode === 'fixed' ? options.settings.aspectRatio : undefined, signal: options.signal });
  return { ...result, model: options.settings.imageModel, provider: 'gemini', estimatedCost: 0.067 };
}

export async function verifyLogo(options: { sourcePath: string; logoPath: string; generatedPath: string; settings: LogoReplaceSettings; secrets: ProviderSecrets; apiBaseUrl?: string | null; signal: AbortSignal }) {
  const provider = options.settings.languageProvider;
  const apiKey = provider === 'openai' ? options.secrets.openAi : options.secrets.gemini;
  if (!apiKey) throw new Error(`未配置 ${provider === 'openai' ? 'OpenAI' : 'Gemini'} API Key`);
  const model = provider === 'openai' ? options.settings.openAiLanguageModel : options.settings.verificationModel;
  const text = await requestJson({ provider, apiKey, apiBaseUrl: options.apiBaseUrl, model, imagePaths: [options.logoPath, options.sourcePath, options.generatedPath], signal: options.signal, prompt: `第一张是新 Logo 参考，第二张是原场景，第三张是生成结果。严格检查 Logo 图形、文字、比例、镂空和负空间是否一致；旧 Logo 是否移除；是否真实融合；是否只修改原 Logo 区域；杯子、木盒、人物、手及遮挡承托是否不变；杯底 Logo 是否完整位于安全区。必须测量新旧 Logo 相对同一载体的归一化包围框、中心点和相对杯口、泡沫线、液面线、杯把、花纹边界的位置；中心漂移超过载体宽高约 1.5%、包围框边漂移超过约 3%、从杯身上半部或泡沫/液面附近移到杯子中间或下方时 passed 必须为 false。只输出 JSON：{"passed":true,"summary":"说明"}。` });
  return extractJson<{ passed: boolean; summary: string }>(text);
}

function removalProvider(settings: LogoRemovalSettings, phase: 'analysis' | 'verification') {
  if (phase === 'analysis') return { provider: settings.analysisProvider, model: settings.analysisProvider === 'openai' ? settings.openAiAnalysisModel : settings.analysisModel } as const;
  return { provider: settings.verificationProvider, model: settings.verificationProvider === 'openai' ? settings.openAiVerificationModel : settings.verificationModel } as const;
}

function removalScopeText(scope: LogoRemovalSettings['scope']) {
  if (scope === 'cup-and-bottom') return '只识别杯身表面和杯底的 Logo';
  if (scope === 'all-product-carriers') return '识别杯、瓶、礼盒及配件等全部产品载体上的 Logo';
  return '只识别杯身表面的 Logo，杯底、礼盒、背景及其他载体不属于目标';
}

export async function analyzeLogoRemoval(options: { sourcePath: string; settings: LogoRemovalSettings; secrets: ProviderSecrets; apiBaseUrl?: string | null; signal: AbortSignal }): Promise<LogoRemovalAnalysis> {
  const route = removalProvider(options.settings, 'analysis');
  const apiKey = route.provider === 'openai' ? options.secrets.openAi : options.secrets.gemini;
  if (!apiKey) throw new Error(`未配置 ${route.provider === 'openai' ? 'OpenAI' : 'Gemini'} API Key`);
  const text = await requestJson({ provider: route.provider, apiKey, apiBaseUrl: options.apiBaseUrl, model: route.model, imagePaths: [options.sourcePath], signal: options.signal, prompt: `分析输入商品图，${removalScopeText(options.settings.scope)}。目标仅限载体表面的印刷、雕刻、蚀刻或贴附 Logo。不要把商品说明、尺寸标注、排版文字、背景装饰、人物、手势或未选中载体上的标识当作目标。输出严格 JSON：{"action":"remove|skip_no_target","summary":"摘要","reason":"原因","targets":[{"id":"target-1","carrier":"载体","markType":"工艺","occlusion":"遮挡关系","left":0,"top":0,"right":1,"bottom":1,"description":"位置说明"}],"preserve":["必须保护的元素"]}。坐标为 0 到 1。没有目标时必须 action=skip_no_target 且 targets=[]。` });
  const parsed = extractJson<LogoRemovalAnalysis>(text);
  return { action: parsed.action === 'remove' && parsed.targets?.length ? 'remove' : 'skip_no_target', summary: parsed.summary || '', reason: parsed.reason || '', targets: parsed.targets || [], preserve: parsed.preserve || [] };
}

function removalGenerationPrompt(settings: LogoRemovalSettings, analysis: LogoRemovalAnalysis, feedback = '') {
  const targets = analysis.targets.map((target, index) => `${index + 1}. ${target.carrier}上的${target.markType} Logo，区域 left=${target.left}, top=${target.top}, right=${target.right}, bottom=${target.bottom}；${target.description}`).join('\n');
  return `${settings.prompt}\n只编辑以下已分析目标区域：\n${targets}\n必须保护：${analysis.preserve.join('、') || '除目标 Logo 外的全部内容'}。移除后自然重建目标下方原有玻璃透明度、折射、反射、液体颜色、杯体曲率和材质纹理。构图、产品位置、人物、手势、礼盒、商品说明、尺寸标注、排版文字和背景元素保持原样。不得去除选定范围之外的标识，不得新增任何文字或图形。${feedback ? `\n上一轮校验反馈，必须修复：${feedback}` : ''}`;
}

export async function generateLogoRemovalDesktop(options: { sourcePath: string; analysis: LogoRemovalAnalysis; settings: LogoRemovalSettings; secrets: ProviderSecrets; apiBaseUrl?: string | null; signal: AbortSignal; feedback?: string }): Promise<GeneratedBuffer> {
  const prompt = removalGenerationPrompt(options.settings, options.analysis, options.feedback);
  if (options.settings.imageProvider === 'openai') {
    if (!options.secrets.openAi) throw new Error('未配置 OpenAI API Key');
    const result = await generateOpenAi({ apiKey: options.secrets.openAi, model: options.settings.openAiImageModel, imagePaths: [options.sourcePath], prompt, quality: 'high', signal: options.signal });
    return { ...result, model: options.settings.openAiImageModel, provider: 'openai', estimatedCost: 0.211 };
  }
  if (!options.secrets.gemini) throw new Error('未配置 Gemini API Key');
  const result = await generateGemini({ apiKey: options.secrets.gemini, apiBaseUrl: options.apiBaseUrl, model: options.settings.imageModel, imagePaths: [options.sourcePath], prompt, imageSize: options.settings.imageSize, signal: options.signal });
  return { ...result, model: options.settings.imageModel, provider: 'gemini', estimatedCost: 0.067 };
}

export async function verifyLogoRemovalDesktop(options: { sourcePath: string; generatedPath: string; analysis: LogoRemovalAnalysis; settings: LogoRemovalSettings; secrets: ProviderSecrets; apiBaseUrl?: string | null; signal: AbortSignal }): Promise<LogoRemovalVerification> {
  const route = removalProvider(options.settings, 'verification');
  const apiKey = route.provider === 'openai' ? options.secrets.openAi : options.secrets.gemini;
  if (!apiKey) throw new Error(`未配置 ${route.provider === 'openai' ? 'OpenAI' : 'Gemini'} API Key`);
  const text = await requestJson({ provider: route.provider, apiKey, apiBaseUrl: options.apiBaseUrl, model: route.model, imagePaths: [options.sourcePath, options.generatedPath], signal: options.signal, prompt: `第一张是原图，第二张是去除 Logo 的结果。目标区域为 ${JSON.stringify(options.analysis.targets)}。检查目标 Logo、文字轮廓和贴纸边缘是否完全去除，同时杯型、液体、透明度、纹理、人物、手势、礼盒、商品说明、尺寸标注、背景和非目标文字是否保持。只输出 JSON：{"passed":true,"logoRemoved":true,"reconstructionNatural":true,"nonTargetPreserved":true,"summary":"结论","differences":["问题"]}。` });
  const parsed = extractJson<LogoRemovalVerification>(text);
  return { passed: Boolean(parsed.passed), summary: parsed.summary || '', logoRemoved: Boolean(parsed.logoRemoved), reconstructionNatural: Boolean(parsed.reconstructionNatural), nonTargetPreserved: Boolean(parsed.nonTargetPreserved), differences: parsed.differences || [] };
}
