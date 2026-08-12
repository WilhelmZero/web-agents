import type { OptimizerModel } from '../types';
import { fileToBase64 } from '../utils';
import { startRequestConsoleEntry, updateRequestConsoleEntry } from './requestConsole';

export const SCENE_COMMON_CONSTRAINT = '严格要求杯子的外形、轮廓、比例、结构、尺寸、朝向及在图中的位置完全不变，禁止拉伸、压缩、弯曲、重塑或改变杯口、杯身、杯底；人物在图中的位置和人物动作、特别是人物手势不变，穿搭及背景氛围可改变，真实的景深效果';

function outputText(data: any) { return data?.output_text || data?.output?.flatMap((item: any) => item.content || []).map((item: any) => item.text || '').join('') || ''; }
function cleanTheme(value: string) {
  const text = value.trim().replace(/[。；;]+$/, '');
  return text.startsWith('改为') ? text : `改为${text}`;
}

export async function recommendSceneTheme(options: { provider: 'gemini' | 'openai'; apiKey: string; apiBaseUrl?: string | null; geminiModel: OptimizerModel; openAiModel: string; image: File; signal?: AbortSignal }) {
  const prompt = '分析图片中的杯子、人物、穿搭、姿态、手势、构图、光线和当前环境，推荐一个适合替换的新场景和氛围。严禁推荐任何节日、庆典、纪念日或带节日装饰的场景。推荐应与主体自然协调且明显区别于原背景。只返回一句简短中文提示词，格式如“改为海滨夏日主题”，不要输出约束、解释、标点或多个选项。';
  const dataUrl = `data:${options.image.type};base64,${await fileToBase64(options.image)}`;
  const model = options.provider === 'openai' ? options.openAiModel : options.geminiModel;
  const startedAt = performance.now(); const id = startRequestConsoleEntry({ model, connection: options.provider === 'openai' ? 'direct' : options.apiBaseUrl ? 'proxy' : 'direct', requestSummary: `场景主题自动推荐 · ${options.image.name}` });
  try {
    let text = '';
    if (options.provider === 'openai') {
      const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', signal: options.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.apiKey}` }, body: JSON.stringify({ model, input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }, { type: 'input_image', image_url: dataUrl, detail: 'high' }] }] }) });
      const data = await response.json().catch(() => null); if (!response.ok) throw new Error(data?.error?.message || `OpenAI 请求失败（HTTP ${response.status}）`); text = outputText(data);
    } else {
      const endpoint = options.apiBaseUrl ? `${options.apiBaseUrl.replace(/\/$/, '')}/models/${model}:generateContent` : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(options.apiKey)}`;
      const response = await fetch(endpoint, { method: 'POST', signal: options.signal, headers: { 'Content-Type': 'application/json', ...(options.apiBaseUrl ? { 'x-goog-api-key': options.apiKey } : {}) }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: options.image.type, data: dataUrl.split(',')[1] } }] }] }) });
      const data = await response.json().catch(() => null); if (!response.ok) throw new Error(data?.error?.message || `Gemini 请求失败（HTTP ${response.status}）`); text = data?.candidates?.flatMap((item: any) => item.content?.parts || []).map((item: any) => item.text || '').join('') || '';
    }
    if (!text.trim()) throw new Error('模型未返回推荐场景'); const result = cleanTheme(text); updateRequestConsoleEntry(id, { status: 'success', durationMs: Math.round(performance.now() - startedAt), resultSummary: result, message: '场景主题推荐完成' }); return result;
  } catch (error) { updateRequestConsoleEntry(id, { status: options.signal?.aborted ? 'stopped' : 'failed', durationMs: Math.round(performance.now() - startedAt), message: error instanceof Error ? error.message : '推荐失败' }); throw error; }
}
