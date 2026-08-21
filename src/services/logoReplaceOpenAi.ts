import type { GeneratedImage, LogoVerificationResult, SceneLogoStyle } from '../types';
import { fileToBase64 } from '../utils';
import { startRequestConsoleEntry, updateRequestConsoleEntry } from './requestConsole';

const OPENAI_ROOT = 'https://api.openai.com/v1';

async function openAiError(response: Response) {
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  return new Error(body?.error?.message || `OpenAI 请求失败（HTTP ${response.status}）`);
}

async function editImages(options: { apiKey: string; model: 'gpt-image-2' | 'gpt-image-2-2026-04-21'; images: File[]; prompt: string; quality?: 'high' | 'medium' | 'low'; requestLabel?: string; signal?: AbortSignal }): Promise<GeneratedImage> {
  const form = new FormData();
  options.images.forEach((image) => form.append('image[]', image, image.name));
  form.append('prompt', options.prompt); form.append('model', options.model); form.append('n', '1');
  form.append('size', 'auto'); form.append('quality', options.quality || 'high'); form.append('output_format', 'png');
  const startedAt = performance.now();
  const consoleId = startRequestConsoleEntry({ model: options.model, connection: 'direct', requestSummary: `OpenAI Images Edit · ${options.images.length} 张输入图片 · ${options.requestLabel || 'Logo 替换'}`, requestPrompt: options.prompt, inputImages: options.images });
  let httpStatus: number | undefined;
  try {
    const response = await fetch(`${OPENAI_ROOT}/images/edits`, { method: 'POST', headers: { Authorization: `Bearer ${options.apiKey}` }, body: form, signal: options.signal });
    httpStatus = response.status;
    if (!response.ok) throw await openAiError(response);
    const data = await response.json() as { data?: Array<{ b64_json?: string; url?: string }> };
    const item = data.data?.[0];
    let blob: Blob | undefined;
    if (item?.b64_json) blob = new Blob([Uint8Array.from(atob(item.b64_json), (char) => char.charCodeAt(0))], { type: 'image/png' });
    if (!blob && item?.url) { const image = await fetch(item.url, { signal: options.signal }); if (image.ok) blob = await image.blob(); }
    if (!blob) throw new Error('OpenAI 未返回 Logo 替换图片');
    updateRequestConsoleEntry(consoleId, { status: 'success', httpStatus, durationMs: Math.round(performance.now() - startedAt), resultSummary: '1 张 Logo 替换图片', message: 'GPT 图片编辑完成', outputImages: [blob] });
    return { blob, mimeType: blob.type || 'image/png' };
  } catch (error) {
    const stopped = options.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError');
    updateRequestConsoleEntry(consoleId, { status: stopped ? 'stopped' : 'failed', httpStatus, durationMs: Math.round(performance.now() - startedAt), message: stopped ? '用户中止请求' : error instanceof Error ? error.message : 'GPT 图片编辑失败' });
    throw error;
  }
}

function outputText(data: unknown) {
  const body = data as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
  return body.output_text || body.output?.flatMap((item) => item.content || []).map((item) => item.text || '').join('') || '';
}

export function generateCupResizeOpenAi(options: {
  apiKey: string;
  model: 'gpt-image-2' | 'gpt-image-2-2026-04-21';
  compositeGuide: File;
  prompt: string;
  quality: 'high' | 'medium' | 'low';
  signal?: AbortSignal;
}) {
  return editImages({
    apiKey: options.apiKey,
    model: options.model,
    images: [options.compositeGuide],
    prompt: `${options.prompt}\n唯一输入图片是已经包含完整场景、涂抹内容和目标杯子的精确指导合成图。`,
    quality: options.quality,
    requestLabel: '杯子大小精确调整',
    signal: options.signal,
  });
}

async function requestJson(options: { apiKey: string; model: string; images: Array<File | Blob>; prompt: string; schemaName: string; schema: object; signal?: AbortSignal }) {
  const imageParts = await Promise.all(options.images.map(async (image) => ({ type: 'input_image', image_url: `data:${image.type || 'image/png'};base64,${await fileToBase64(image)}`, detail: 'high' })));
  const startedAt = performance.now();
  const consoleId = startRequestConsoleEntry({ model: options.model, connection: 'direct', requestSummary: `OpenAI Responses · ${options.images.length} 张输入图片 · Logo 分析`, requestPrompt: options.prompt, inputImages: options.images });
  let httpStatus: number | undefined;
  try {
    const response = await fetch(`${OPENAI_ROOT}/responses`, { method: 'POST', signal: options.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.apiKey}` }, body: JSON.stringify({ model: options.model, input: [{ role: 'user', content: [{ type: 'input_text', text: options.prompt }, ...imageParts] }], text: { format: { type: 'json_schema', name: options.schemaName, strict: true, schema: options.schema } } }) });
    httpStatus = response.status;
    if (!response.ok) throw await openAiError(response);
    const text = outputText(await response.json());
    if (!text) throw new Error('OpenAI 未返回结构化结果');
    const parsed = JSON.parse(text) as unknown;
    updateRequestConsoleEntry(consoleId, { status: 'success', httpStatus, durationMs: Math.round(performance.now() - startedAt), resultSummary: '结构化 Logo 结果', message: 'GPT 请求完成' });
    return parsed;
  } catch (error) {
    const stopped = options.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError');
    updateRequestConsoleEntry(consoleId, { status: stopped ? 'stopped' : 'failed', httpStatus, durationMs: Math.round(performance.now() - startedAt), message: stopped ? '用户中止请求' : error instanceof Error ? error.message : 'GPT 请求失败' });
    throw error;
  }
}

export function generateLogoReplacementOpenAi(options: { apiKey: string; model: 'gpt-image-2'; scene: File; oldLogo?: File; newLogo: File; prompt: string; signal?: AbortSignal }) {
  const images = [options.scene, ...(options.oldLogo ? [options.oldLogo] : []), options.newLogo];
  const order = options.oldLogo ? '第一张是原始场景，第二张是需要移除的旧 Logo 参考，第三张是必须替换成的新 Logo。' : '第一张是原始场景，第二张是必须替换成的新 Logo。';
  return editImages({ ...options, images, prompt: `${order}\n${options.prompt}` });
}

export function generateMultiLogoReplacementOpenAi(options: { apiKey: string; model: 'gpt-image-2'; scene: File; logos: File[]; styles: SceneLogoStyle[]; instruction: string; distinctPerOccurrence?: boolean; signal?: AbortSignal }) {
  const mapping = options.styles.map((style, index) => `${style.label}的全部 ${style.occurrences} 个位置替换为第 ${index + 2} 张图的新 Logo`).join('；');
  const distinctPerOccurrence = options.distinctPerOccurrence ?? options.styles.some((style) => style.id.includes('-occurrence-'));
  const mappingRule = distinctPerOccurrence ? '相同旧 Logo 的不同位置已分别编号；每个编号只处理对应的一个位置并使用各自映射的新 Logo，禁止把一个新 Logo 复制到其他编号位置。' : '同一样式所有位置必须使用同一个对应 Logo。';
  return editImages({ ...options, images: [options.scene, ...options.logos], prompt: `第一张图是必须保持不变的原始场景，后续图片是按映射分配的新 Logo。映射：${mapping}。${mappingRule}不得混用、遗漏或新增。只修改旧 Logo 原本占据的区域，其他区域逐像素保持不变。杯子在盒内的平放、侧放、倾斜、内衬承托、位置及遮挡完全不变，严禁立起、悬浮、移动或旋转。旧 Logo 被手遮挡时，新 Logo 必须仍在手后方，严禁贴到手或皮肤上。盒子、盒盖、盒内、内衬、锁扣和铰链原本没有旧 Logo 的位置绝对禁止新增 Logo。新 Logo 必须贴合载体曲率、透视、反射、折射和原有印刷或雕刻工艺，不得直接平面覆盖。${options.instruction}` });
}

const verificationSchema = { type: 'object', additionalProperties: false, properties: { passed: { type: 'boolean' }, referenceText: { type: 'string' }, generatedText: { type: 'string' }, differences: { type: 'array', items: { type: 'string' } }, graphicConsistent: { type: 'boolean' }, materialIntegrated: { type: 'boolean' }, placementConsistent: { type: 'boolean' }, originalLogoRemoved: { type: 'boolean' }, flatOverlayDetected: { type: 'boolean' }, summary: { type: 'string' } }, required: ['passed', 'referenceText', 'generatedText', 'differences', 'graphicConsistent', 'materialIntegrated', 'placementConsistent', 'originalLogoRemoved', 'flatOverlayDetected', 'summary'] };

export async function verifyLogoReplacementOpenAi(options: { apiKey: string; model: string; referenceLogo: File; originalScene: File; generatedImage: Blob; expectedText?: string; signal?: AbortSignal }): Promise<LogoVerificationResult> {
  const expected = options.expectedText?.trim();
  const parsed = await requestJson({ ...options, images: [options.referenceLogo, options.originalScene, options.generatedImage], schemaName: 'logo_verification', schema: verificationSchema, prompt: `第一张是新 Logo 参考，第二张是替换前场景，第三张是生成结果。严格检查：新 Logo 图形、文字、比例、内外轮廓、镂空、孔洞和负空间必须一致；参考 Logo 的镂空处必须继续显示载体，镂空被填实、孔洞封闭、开口消失或轮廓变成实心图形时必须 graphicConsistent=false、passed=false。旧 Logo 必须完整移除；材质、曲率、透视、光影真实融合；位置尺寸合理；不得是平面覆盖。若 Logo 位于杯底，必须整体位于杯底最内层平坦安全区且四周保留约 10%–15% 净空，任何笔画跨出内圈、装饰环、倒角、外缘或侧壁时必须 placementConsistent=false、passed=false。若杯身上部光滑、下部为竖纹/棱柱/浮雕结构，必须识别竖纹开始线；新 Logo 的全部文字、外框与装饰必须位于该线以上并留安全间距。Logo 底边进入或贴住纹理区、相对旧 Logo 向下扩张、或本可等比缩小却占满杯身时，必须 placementConsistent=false、passed=false，并要求缩小到上部光滑带内。除旧 Logo 区域外整图必须与原图一致：杯子、盒子、内衬、人物、手、背景和道具不得移动、旋转、重绘或改变承托遮挡关系。杯子原本平放或嵌在盒内却变成立起、悬浮、移动、旋转或离开内衬时，必须 placementConsistent=false、passed=false。旧 Logo 被手遮挡而新 Logo 覆盖手、穿过手或贴到皮肤上时，必须 materialIntegrated=false、placementConsistent=false、passed=false。盒子、盒盖、盒内、内衬、锁扣或铰链原本无旧 Logo 却新增 Logo 时，必须 placementConsistent=false、passed=false。${expected ? `准确文字必须逐字符等于〈${expected}〉。` : ''}所有说明使用简体中文。` }) as LogoVerificationResult;
  const passed = Boolean(parsed.passed && parsed.graphicConsistent && parsed.materialIntegrated && parsed.placementConsistent && parsed.originalLogoRemoved && !parsed.flatOverlayDetected);
  return { ...parsed, passed };
}

const stylesSchema = { type: 'object', additionalProperties: false, properties: { styles: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, label: { type: 'string' }, description: { type: 'string' }, occurrences: { type: 'integer' }, carrier: { type: 'string' } }, required: ['id', 'label', 'description', 'occurrences', 'carrier'] } }, summary: { type: 'string' } }, required: ['styles', 'summary'] };

export async function analyzeSceneLogoStylesOpenAi(options: { apiKey: string; model: string; scene: File; signal?: AbortSignal }) {
  const parsed = await requestJson({ ...options, images: [options.scene], schemaName: 'scene_logo_styles', schema: stylesSchema, prompt: '分析场景图中所有需要替换的品牌 Logo。视觉图形、文字排版、轮廓或配色明显不同的归为不同样式；同一样式多个位置只建一个组并统计 occurrences。不要把装饰文字或说明误判为 Logo。label 使用“样式 1、样式 2”，description 描述定位特征，carrier 描述载体。' }) as { styles: SceneLogoStyle[]; summary: string };
  return { styles: parsed.styles.map((style, index) => ({ ...style, id: style.id || `style-${index + 1}`, occurrences: Math.max(1, Number(style.occurrences) || 1) })), summary: parsed.summary || '' };
}
