import { startRequestConsoleEntry, updateRequestConsoleEntry } from './requestConsole';

const OPENAI_ROOT = 'https://api.openai.com/v1';

function outputText(data: unknown) {
  const body = data as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
  return body.output_text || body.output?.flatMap((item) => item.content || []).map((item) => item.text || '').join('') || '';
}

export async function optimizeScenePromptOpenAi(options: { apiKey: string; model: string; prompt: string; signal?: AbortSignal }) {
  const startedAt = performance.now();
  const consoleId = startRequestConsoleEntry({ model: options.model, connection: 'direct', requestSummary: 'OpenAI Responses · 场景替换提示词优化' });
  let httpStatus: number | undefined;
  try {
    const response = await fetch(`${OPENAI_ROOT}/responses`, {
      method: 'POST', signal: options.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.apiKey}` },
      body: JSON.stringify({ model: options.model, input: [{ role: 'user', content: [{ type: 'input_text', text: `你是商业产品摄影和图片编辑提示词专家。将用户的场景替换要求优化为可直接用于图片编辑模型的中文完整提示词。增强主题、背景、穿搭、氛围、构图、光线、材质、镜头和真实景深的描述，但必须逐项保留原文中的所有硬性约束，不得删除、放宽或反转杯子外形、尺寸、位置、人物位置、动作、手势及其他不变要求，也不得增加用户未要求替换的主体。只输出优化后的提示词，不要解释、标题、引号或 Markdown。\n\n原提示词：${options.prompt}` }] }] }),
    });
    httpStatus = response.status;
    const data = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    if (!response.ok) throw new Error(data?.error?.message || `OpenAI 请求失败（HTTP ${response.status}）`);
    const text = outputText(data).trim();
    if (!text) throw new Error('模型未返回提示词优化结果');
    updateRequestConsoleEntry(consoleId, { status: 'success', httpStatus, durationMs: Math.round(performance.now() - startedAt), resultSummary: '场景替换提示词已优化', message: 'GPT 提示词优化完成' });
    return text;
  } catch (error) {
    const stopped = options.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError');
    updateRequestConsoleEntry(consoleId, { status: stopped ? 'stopped' : 'failed', httpStatus, durationMs: Math.round(performance.now() - startedAt), message: stopped ? '用户中止请求' : error instanceof Error ? error.message : 'GPT 提示词优化失败' });
    throw error;
  }
}
