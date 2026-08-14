import type { OptimizerModel, PerImagePromptAssignment, PerImagePromptTool } from '../types';
import { fileToBase64 } from '../utils';
import { startRequestConsoleEntry, updateRequestConsoleEntry } from './requestConsole';

export function perImagePromptFileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function assignmentNeedsAnalysis(assignment: PerImagePromptAssignment | undefined, sourcePrompt: string) {
  return !assignment || assignment.status !== 'ready' || assignment.sourcePrompt !== sourcePrompt.trim();
}

export function parsePerImagePromptResult(text: string) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('语言模型未返回有效的逐图提示词 JSON');
  const value = JSON.parse(match[0]) as { summary?: unknown; applicableConditions?: unknown; prompt?: unknown };
  const summary = typeof value.summary === 'string' ? value.summary.trim() : '';
  const applicableConditions = Array.isArray(value.applicableConditions) ? value.applicableConditions.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean) : [];
  const prompt = typeof value.prompt === 'string' ? value.prompt.trim() : '';
  if (!summary || !prompt) throw new Error('语言模型返回的图片摘要或独立提示词为空');
  return { summary, applicableConditions, prompt };
}

export function buildPerImageAnalysisPrompt(tool: PerImagePromptTool, sourcePrompt: string) {
  const focus = tool === 'logo-replace'
    ? '识别所有原 Logo 所在载体、材质、曲面透视、遮挡关系、手部遮挡、礼盒内外区域、图中图以及实际适用的雕刻或印刷工艺。只保留与本图真实情况有关的条件；没有 Logo 的盒子或盒内衬不得新增 Logo。'
    : '识别杯型、人物及手势、礼盒、产品说明文字、尺寸标注、裁切主体、图中图和当前构图，并选择与本图真实杯型和用途相符的非节日欧美生活场景条件。只保留与本图有关的条件。';
  return `你是图片编辑请求的逐图提示词分配器。\n${focus}\n\n用户公共提示词：\n${sourcePrompt.trim()}\n\n要求：\n1. 只能筛选、整理公共提示词中适用于本图的内容，不得随意增加新任务。\n2. 删除与本图不相关、互相冲突或仅适用于其他图片的分支。\n3. 不要重复通用的强制保护规则，系统会在后面统一追加。\n4. 独立提示词必须可以直接交给图片编辑模型，简洁明确。\n5. 仅返回 JSON，不要 Markdown，固定结构：{"summary":"简短图片摘要","applicableConditions":["适用条件"],"prompt":"本图独立提示词"}。`;
}

function openAiText(data: any) {
  return data?.output_text || data?.output?.flatMap((item: any) => item.content || []).map((item: any) => item.text || '').join('') || '';
}

export async function analyzePerImagePrompt(options: { tool: PerImagePromptTool; image: File; sourcePrompt: string; provider: 'gemini' | 'openai'; apiKey: string; apiBaseUrl?: string | null; geminiModel: OptimizerModel; openAiModel: string; signal?: AbortSignal }): Promise<PerImagePromptAssignment> {
  const prompt = buildPerImageAnalysisPrompt(options.tool, options.sourcePrompt);
  const base64 = await fileToBase64(options.image);
  const model = options.provider === 'openai' ? options.openAiModel : options.geminiModel;
  const startedAt = performance.now();
  const id = startRequestConsoleEntry({ model, connection: options.provider === 'openai' ? 'direct' : options.apiBaseUrl ? 'proxy' : 'direct', requestSummary: `逐图提示词分析 · ${options.image.name}` });
  try {
    let text = '';
    if (options.provider === 'openai') {
      const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', signal: options.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.apiKey}` }, body: JSON.stringify({ model, input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }, { type: 'input_image', image_url: `data:${options.image.type};base64,${base64}`, detail: 'high' }] }], text: { format: { type: 'json_schema', name: 'per_image_prompt', strict: true, schema: { type: 'object', properties: { summary: { type: 'string' }, applicableConditions: { type: 'array', items: { type: 'string' } }, prompt: { type: 'string' } }, required: ['summary', 'applicableConditions', 'prompt'], additionalProperties: false } } } }) });
      const data = await response.json().catch(() => null); if (!response.ok) throw new Error(data?.error?.message || `OpenAI 请求失败（HTTP ${response.status}）`); text = openAiText(data);
    } else {
      const endpoint = options.apiBaseUrl ? `${options.apiBaseUrl.replace(/\/$/, '')}/models/${model}:generateContent` : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(options.apiKey)}`;
      const response = await fetch(endpoint, { method: 'POST', signal: options.signal, headers: { 'Content-Type': 'application/json', ...(options.apiBaseUrl ? { 'x-goog-api-key': options.apiKey } : {}) }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: options.image.type, data: base64 } }] }], generationConfig: { responseMimeType: 'application/json', responseSchema: { type: 'OBJECT', properties: { summary: { type: 'STRING' }, applicableConditions: { type: 'ARRAY', items: { type: 'STRING' } }, prompt: { type: 'STRING' } }, required: ['summary', 'applicableConditions', 'prompt'] } } }) });
      const data = await response.json().catch(() => null); if (!response.ok) throw new Error(data?.error?.message || `Gemini 请求失败（HTTP ${response.status}）`); text = data?.candidates?.flatMap((item: any) => item.content?.parts || []).map((item: any) => item.text || '').join('') || '';
    }
    const parsed = parsePerImagePromptResult(text);
    const result: PerImagePromptAssignment = { fileKey: perImagePromptFileKey(options.image), tool: options.tool, ...parsed, sourcePrompt: options.sourcePrompt.trim(), status: 'ready', updatedAt: Date.now() };
    updateRequestConsoleEntry(id, { status: 'success', durationMs: Math.round(performance.now() - startedAt), resultSummary: result.prompt, message: '逐图提示词分析完成' });
    return result;
  } catch (error) {
    updateRequestConsoleEntry(id, { status: options.signal?.aborted ? 'stopped' : 'failed', durationMs: Math.round(performance.now() - startedAt), message: error instanceof Error ? error.message : '逐图提示词分析失败' });
    throw error;
  }
}

export async function analyzePerImagePromptBatch(files: File[], concurrency: number, analyze: (file: File) => Promise<PerImagePromptAssignment>) {
  const results: Array<{ file: File; assignment?: PerImagePromptAssignment; error?: string }> = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(8, Math.max(1, concurrency), files.length) }, async () => {
    while (cursor < files.length) {
      const file = files[cursor++];
      try { results.push({ file, assignment: await analyze(file) }); }
      catch (error) { results.push({ file, error: error instanceof Error ? error.message : '逐图提示词分析失败' }); }
    }
  }));
  return results;
}
