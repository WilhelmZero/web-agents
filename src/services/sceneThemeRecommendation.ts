import type { OptimizerModel } from '../types';
import { fileToBase64 } from '../utils';
import { startRequestConsoleEntry, updateRequestConsoleEntry } from './requestConsole';

export const SCENE_COMMON_CONSTRAINT = '严格要求杯子的外形、轮廓、比例、结构、尺寸、朝向及在图中的位置完全不变，禁止拉伸、压缩、弯曲、重塑或改变杯口、杯身、杯底；人物在图中的位置和人物动作、特别是人物手势不变，穿搭及背景氛围可改变，真实的景深效果';

export const CUP_SCENE_RULES = [
  '小烈酒杯：家庭吧台、朋友聚会、派对小酌场景',
  '无柄蛋杯：明亮厨房、早餐桌、Brunch 场景',
  '可乐罐杯：休闲厨房、咖啡角、夏日冷饮、轻松家居场景',
  '啤酒杯：酒吧、后院 BBQ、聚会餐桌、运动观赛场景',
  '威士忌杯：家庭酒吧、书房、胡桃木桌面、品鉴场景',
] as const;

export function buildSceneThemeRecommendationPrompt() {
  return `先根据杯口、杯身、杯底、容量感、是否有柄及整体比例，识别图片中产品的真实杯型和主要用途，再智能匹配最符合该杯型使用习惯的欧美真实生活场景。
必须优先遵守以下映射：
${CUP_SCENE_RULES.join('\n')}
若杯型不在列表中，按照该杯型的真实用途推荐自然、可信的欧美日常生活场景，不得为了视觉效果错误判断杯型或用途。
可以结合人物、姿态、手势和现有构图选择上述类别中最自然的一项，但不要改变产品用途。
严禁推荐圣诞节、感恩节、万圣节、情人节等任何节日、庆典、纪念日或带节日装饰的场景。
只返回一句简短中文提示词，格式必须为“替换为XX主题”，不要输出杯型分析、理由、约束、标点或多个选项。`;
}

function outputText(data: any) { return data?.output_text || data?.output?.flatMap((item: any) => item.content || []).map((item: any) => item.text || '').join('') || ''; }
export function cleanRecommendedTheme(value: string) {
  const first = value.trim().split(/[。；;\n]/)[0].replace(/^["“”'‘’\s]+|["“”'‘’\s]+$/g, '');
  if (!first) return '';
  const theme = first.replace(/^(?:请)?(?:将场景)?(?:改为|替换为)/, '').replace(/主题$/, '').trim();
  return theme ? `替换为${theme}主题` : '';
}

export async function recommendSceneTheme(options: { provider: 'gemini' | 'openai'; apiKey: string; apiBaseUrl?: string | null; geminiModel: OptimizerModel; openAiModel: string; image: File; signal?: AbortSignal }) {
  const prompt = buildSceneThemeRecommendationPrompt();
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
    const result = cleanRecommendedTheme(text); if (!result) throw new Error('模型未返回有效的推荐场景'); updateRequestConsoleEntry(id, { status: 'success', durationMs: Math.round(performance.now() - startedAt), resultSummary: result, message: '场景主题推荐完成' }); return result;
  } catch (error) { updateRequestConsoleEntry(id, { status: options.signal?.aborted ? 'stopped' : 'failed', durationMs: Math.round(performance.now() - startedAt), message: error instanceof Error ? error.message : '推荐失败' }); throw error; }
}
