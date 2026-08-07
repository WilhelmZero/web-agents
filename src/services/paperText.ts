import { fileToBase64 } from '../utils';

export interface PaperTextRegion {
  original: string;
  text: string;
  box: [number, number, number, number];
}

export interface PaperTextVerification {
  ok: boolean;
  reason: string;
}

export function normalizePaperTextRegions(value: unknown): PaperTextRegion[] {
  const regions = (value as { regions?: unknown[] } | null)?.regions;
  if (!Array.isArray(regions)) return [];
  return regions.flatMap((item) => {
    const region = item as { text?: unknown; box?: unknown; left?: unknown; top?: unknown; width?: unknown; height?: unknown };
    const usesArrayBox = Array.isArray(region.box) && region.box.length === 4;
    const rawBox = usesArrayBox ? region.box as unknown[] : [region.left, region.top, region.width, region.height];
    if (typeof region.text !== 'string' || !region.text.trim() || rawBox.some((part) => !Number.isFinite(Number(part)))) return [];
    const scale = !usesArrayBox && rawBox.some((part) => Number(part) > 100) ? 0.1 : 1;
    const box = rawBox.map((part) => Math.max(0, Math.min(100, Number(part) * scale))) as PaperTextRegion['box'];
    return [{ original: region.text, text: region.text, box }];
  });
}

export function buildPaperTextEditPrompt(regions: PaperTextRegion[], correction = '', commonPrompt = ''): string {
  const changes = regions.filter((region) => region.text !== region.original);
  const lines = changes.map((region, index) => `${index + 1}. 在百分比区域 [${region.box.join(', ')}]，将“${region.original}”准确替换为“${region.text}”`).join('\n');
  return `执行严格的包装花纸文字局部修改。原图是最终画面的唯一基准，只允许修改以下文字区域：\n${lines}\n保持每处新文字与原文字完全相同的字体风格、字重、字号、字距、行距、排版、弧度、透视、颜色、印刷油墨质感、磨损、反光、遮挡和载体曲面贴合关系。完整清除旧文字，不得残留、重影或新增文字。除指定文字外，花纸图案、Logo、插画、器物轮廓、材质、背景、构图、光影和所有像素对应内容必须保持不变。输出完整原尺寸图片，不显示标注框。${commonPrompt.trim() ? `\n公共修改提示词（应用于全部图片）：${commonPrompt.trim()}` : ''}${correction ? `\n上次复核问题，必须修正：${correction}` : ''}`;
}

const OPENAI_ROOT = 'https://api.openai.com/v1';

export function supportsOpenAiInputFidelity(model: string): boolean {
  return !model.trim().toLowerCase().startsWith('gpt-image-2');
}

async function openAiError(response: Response): Promise<Error> {
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  return new Error(body?.error?.message || `OpenAI 请求失败（HTTP ${response.status}）`);
}

function outputText(data: unknown): string {
  const body = data as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
  return body.output_text || body.output?.flatMap((item) => item.content || []).map((item) => item.text || '').join('') || '';
}

async function requestOpenAiJson(options: { apiKey: string; model: string; image: File | Blob; prompt: string; schema: object; signal?: AbortSignal }): Promise<unknown> {
  const base64 = await fileToBase64(options.image);
  const mimeType = options.image.type || 'image/png';
  const response = await fetch(`${OPENAI_ROOT}/responses`, {
    method: 'POST', signal: options.signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.apiKey}` },
    body: JSON.stringify({
      model: options.model,
      input: [{ role: 'user', content: [{ type: 'input_text', text: options.prompt }, { type: 'input_image', image_url: `data:${mimeType};base64,${base64}`, detail: 'high' }] }],
      text: { format: { type: 'json_schema', name: 'paper_text_result', strict: true, schema: options.schema } },
    }),
  });
  if (!response.ok) throw await openAiError(response);
  const data = await response.json();
  const text = outputText(data);
  if (!text) throw new Error('OpenAI 未返回结构化文字结果');
  try { return JSON.parse(text); } catch { throw new Error('OpenAI 返回的文字结果格式无效'); }
}

const regionsSchema = { type: 'object', additionalProperties: false, properties: { regions: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' }, box: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 } }, required: ['text', 'box'] } } }, required: ['regions'] };

export async function recognizePaperTextOpenAi(options: { apiKey: string; model: string; image: File; signal?: AbortSignal }): Promise<PaperTextRegion[]> {
  const value = await requestOpenAiJson({ ...options, prompt: '识别图片中所有可见的包装花纸文字。按独立文字区域分组，严格保持原文、大小写、标点和换行。box 为 [左侧百分比, 顶部百分比, 宽度百分比, 高度百分比]，范围 0-100。不要把纯图形或不可见的猜测内容当作文字。', schema: regionsSchema });
  return normalizePaperTextRegions(value);
}

export async function editPaperTextOpenAi(options: { apiKey: string; model: string; image: File; prompt: string; quality: string; signal?: AbortSignal }): Promise<Blob> {
  const form = new FormData();
  form.append('image[]', options.image, options.image.name);
  form.append('prompt', options.prompt); form.append('model', options.model); form.append('n', '1');
  form.append('size', 'auto'); form.append('quality', options.quality); form.append('output_format', 'png');
  if (supportsOpenAiInputFidelity(options.model)) form.append('input_fidelity', 'high');
  const response = await fetch(`${OPENAI_ROOT}/images/edits`, { method: 'POST', headers: { Authorization: `Bearer ${options.apiKey}` }, body: form, signal: options.signal });
  if (!response.ok) throw await openAiError(response);
  const data = await response.json() as { data?: Array<{ b64_json?: string; url?: string }> };
  const item = data.data?.[0];
  if (item?.b64_json) return new Blob([Uint8Array.from(atob(item.b64_json), (c) => c.charCodeAt(0))], { type: 'image/png' });
  if (item?.url) { const image = await fetch(item.url, { signal: options.signal }); if (image.ok) return image.blob(); }
  throw new Error('OpenAI 未返回编辑后的图片');
}

export async function verifyPaperTextOpenAi(options: { apiKey: string; model: string; image: Blob; regions: PaperTextRegion[]; signal?: AbortSignal }): Promise<PaperTextVerification> {
  const targets = options.regions.filter((r) => r.text !== r.original).map((r) => `“${r.original}”→“${r.text}”`).join('\n');
  const schema = { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, reason: { type: 'string' } }, required: ['ok', 'reason'] };
  return await requestOpenAiJson({ ...options, prompt: `严格检查图片中的花纸文字修改：\n${targets}\n只有全部新文字准确、旧文字消失、非目标区域没有变化时 ok 才能为 true。reason 使用简体中文。`, schema }) as PaperTextVerification;
}
