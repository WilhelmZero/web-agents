import type { OptimizerModel, PerImagePromptAssignment, PerImagePromptTool } from '../types';
import { fileToBase64 } from '../utils';
import { startRequestConsoleEntry, updateRequestConsoleEntry } from './requestConsole';

export function perImagePromptFileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function assignmentNeedsAnalysis(assignment: PerImagePromptAssignment | undefined, sourcePrompt: string) {
  return !assignment || assignment.status !== 'ready' || assignment.sourcePrompt !== sourcePrompt.trim();
}

export function shouldAnalyzePerImagePromptsInController(enabled: boolean, autoGenerateAfterAnalysis: boolean) {
  return enabled && !autoGenerateAfterAnalysis;
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
  let focus = tool === 'logo-replace'
    ? '识别所有原 Logo 所在载体、材质、曲面透视、遮挡关系、手部遮挡、礼盒内外区域、图中图以及实际适用的雕刻或印刷工艺。只保留与本图真实情况有关的条件；没有 Logo 的盒子或盒内衬不得新增 Logo。'
    : '识别杯型、人物及手势、礼盒/木盒、产品说明文字、尺寸标注、功能图标、悬浮营销标题、杯身 Logo/刻字、裁切主体、图中图和当前构图，并评估真正环境背景的可编辑面积、是否属于无纵深商品棚拍/纯桌面俯拍或斜俯拍构图、原图焦平面及背景虚化强度。必须明确判断画面是否只有连续桌面而没有墙面、房间、地平线或可替换的纵深背景；若是，摘要和适用条件必须写明“纯桌面构图，无可编辑纵深背景”，独立提示词必须写明“只更换原桌面材质、纹理、色调与光影，并在原有桌面空白处保留或加入极少量平面小装饰；禁止新增墙面、酒吧、酒柜、货架、房间、家具、窗户、地平线或任何竖向背景”。必须把文字分成两类：第一类是前景商品说明、营销标题、尺寸标注、功能徽标、包装或产品本体文字，逐字列为保留项；第二类是与墙面、窗户、招牌、海报、横幅、旗帜、灯牌、黑板、画板或其他环境陈设存在透视、材质和空间关系的背景场景文字，逐字列为删除项。杯子、酒杯、醒酒器等饮具表面的 Logo、品牌名、姓名、年份、日期、节日词、赛事词、祝福语、占位文字、印刷和雕刻无论内容是什么，一律属于第一类，必须逐字保留，绝不能因为内容像节日或场景文字而列入删除项。所有真正位于背景环境中的原节日、庆典、赛事名称、祝福语、年份和节日符号必须跟随旧背景删除，即使目标也是另一个节日也不得保留。如果存在多个小图或场景面板，必须按阅读顺序逐格列出每格的原环境与应执行的目标变化，明确要求每一格都发生可见的环境替换，不能遗漏、轻微处理或保持任意一格不变。把所有不属于真实环境的商品信息叠加层视为受保护前景，不得当作背景删除；木盒、礼盒和包装无论占据多大面积都属于商品。若产品和木盒后方没有真实空间，只允许更换桌面材质、调整氛围并在空白处加入少量装饰，禁止删除木盒来补出完整房间。若原背景虚化，明确要求新背景保持相同焦平面、景深和模糊强度。若某一格真实背景面积很少，该格提示词必须改为仅在剩余背景、台面材质、光影和少量边缘装饰中表达主题，不得要求完整房间，但也不得跳过该格。识别所有原有产品和参照物之间的相对比例，禁止为适配新场景而缩放产品。在摘要和适用条件中分别按可见原文及位置列出必须保留的前景文字/图标，以及必须删除的背景文字/节日元素。只保留与本图有关的条件。';
  if (tool === 'scene-replace') focus += ' 只要识别到木盒、礼盒或包装盒，必须在独立提示词中原样写入“木盒位置不要改变”，并锁定盒子的坐标、边界、大小、透视、朝向、前后层级以及它与杯子、酒瓶的相对位置。无论目标主题为何，独立提示词都必须明确写入“禁止新增任何背景酒瓶、酒类包装、酒瓶标签、贴纸、Logo、品牌名、文字或商标图案；用无文字调酒工具、普通玻璃器皿或非品牌装饰表达氛围”。';
  return `你是图片编辑请求的逐图提示词分配器。\n${focus}\n\n用户公共提示词：\n${sourcePrompt.trim()}\n\n要求：\n1. 只能筛选、整理公共提示词中适用于本图的内容，不得随意增加新任务。\n2. 删除与本图不相关、互相冲突或仅适用于其他图片的分支。\n3. 不要重复通用的强制保护规则，系统会在后面统一追加。\n4. 独立提示词必须可以直接交给图片编辑模型，简洁明确。${tool === 'scene-replace' ? '必须明确写成“将背景替换为……场景”，不能只写保护原图、优化光影或保持氛围。' : ''}\n5. 仅返回 JSON，不要 Markdown，固定结构：{"summary":"简短图片摘要","applicableConditions":["适用条件"],"prompt":"本图独立提示词"}。`;
}

function openAiText(data: any) {
  return data?.output_text || data?.output?.flatMap((item: any) => item.content || []).map((item: any) => item.text || '').join('') || '';
}

export async function analyzePerImagePrompt(options: { tool: PerImagePromptTool; image: File; sourcePrompt: string; provider: 'gemini' | 'openai'; apiKey: string; apiBaseUrl?: string | null; geminiModel: OptimizerModel; openAiModel: string; signal?: AbortSignal }): Promise<PerImagePromptAssignment> {
  const prompt = buildPerImageAnalysisPrompt(options.tool, options.sourcePrompt);
  const base64 = await fileToBase64(options.image);
  const model = options.provider === 'openai' ? options.openAiModel : options.geminiModel;
  const startedAt = performance.now();
  const id = startRequestConsoleEntry({ model, connection: options.provider === 'openai' ? 'direct' : options.apiBaseUrl ? 'proxy' : 'direct', requestSummary: `逐图提示词分析 · ${options.image.name}`, requestPrompt: prompt, inputImages: [options.image] });
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

export async function analyzePerImagePromptWithRetry<T>(analyze: () => Promise<T>, options: { enabled: boolean; retryLimit: number; delaySeconds: number }, wait: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds))) {
  const retryLimit = options.enabled ? Math.max(0, options.retryLimit) : 0;
  let lastError: unknown;
  for (let retry = 0; retry <= retryLimit; retry += 1) {
    try { return await analyze(); }
    catch (error) {
      lastError = error;
      if (retry >= retryLimit) break;
      await wait(Math.max(1, options.delaySeconds) * 1000);
    }
  }
  throw lastError;
}
