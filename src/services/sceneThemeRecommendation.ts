import type { OptimizerModel } from '../types';
import { fileToBase64 } from '../utils';
import { startRequestConsoleEntry, updateRequestConsoleEntry } from './requestConsole';

export const SCENE_COMMON_CONSTRAINT = '严格要求杯子的外形、轮廓、比例、结构、尺寸、朝向及在图中的位置完全不变，禁止拉伸、压缩、弯曲、重塑或改变杯口、杯身、杯底；人物在图中的位置和人物动作、特别是人物手势不变，穿搭及背景氛围可改变，真实的景深效果';

export const SCENE_MANUAL_DEFAULT_PROMPT = '根据上传产品自动识别杯型与真实用途，并智能匹配最符合该杯型使用习惯的欧美真实生活场景；小烈酒杯匹配家庭吧台、朋友聚会、派对小酌场景；无柄蛋杯匹配明亮厨房、早餐桌、Brunch场景；可乐罐杯匹配休闲厨房、咖啡角、夏日冷饮、轻松家居场景；啤酒杯匹配酒吧、后院BBQ、聚会餐桌、运动观赛场景；威士忌杯匹配家庭酒吧、书房、胡桃木桌面、品鉴场景。场景需自然合理、不违和，自动搭配正确饮品、桌面材质和少量辅助道具，严格要求杯子的外形、轮廓、比例、结构、尺寸、朝向及在图中的位置完全不变，禁止拉伸、压缩、弯曲、重塑或改变杯口、杯身、杯底；人物在图中的位置和人物动作、特别是人物手势不变，穿搭及背景氛围可改变，真实的景深效果';

export const CUP_SCENE_RULES = [
  '小烈酒杯：家庭吧台、朋友聚会、派对小酌场景',
  '无柄蛋杯：明亮厨房、早餐桌、Brunch 场景',
  '可乐罐杯：休闲厨房、咖啡角、夏日冷饮、轻松家居场景',
  '啤酒杯：酒吧、后院 BBQ、日常朋友聚会餐桌场景',
  '威士忌杯：家庭酒吧、书房、胡桃木桌面、品鉴场景',
] as const;

export type RecommendedCupType = '小烈酒杯' | '无柄蛋杯' | '可乐罐杯' | '啤酒杯' | '威士忌杯' | '其他';

export const FOLDER_SCENE_POOLS: Record<Exclude<RecommendedCupType, '其他'>, string[]> = {
  小烈酒杯: ['替换为家庭吧台主题', '替换为朋友聚会主题', '替换为派对小酌主题'],
  无柄蛋杯: ['替换为明亮厨房主题', '替换为早餐桌主题', '替换为 Brunch 主题'],
  可乐罐杯: ['替换为休闲厨房主题', '替换为咖啡角主题', '替换为夏日冷饮主题', '替换为轻松家居主题'],
  啤酒杯: ['替换为酒吧主题', '替换为后院 BBQ 主题', '替换为聚会餐桌主题'],
  威士忌杯: ['替换为家庭酒吧主题', '替换为书房主题', '替换为胡桃木桌面主题', '替换为品鉴主题'],
};

export const FOLDER_SCENE_COMMON_PROMPT = '场景需自然合理、不违和，自动搭配正确饮品、桌面材质和少量辅助道具，严格要求杯子的外形、轮廓、比例、结构、尺寸、朝向及在图中的位置完全不变，禁止拉伸、压缩、弯曲、重塑或改变杯口、杯身、杯底；人物在图中的位置和人物动作、特别是人物手势不变，穿搭及背景氛围可改变，真实的景深效果';

const ALL_FOLDER_SCENES = Object.values(FOLDER_SCENE_POOLS).flat();

export function assignFolderScene(cupType: RecommendedCupType, usedByType: Record<string, string[]>, random = Math.random) {
  if (cupType === '其他') return { theme: ALL_FOLDER_SCENES[Math.floor(random() * ALL_FOLDER_SCENES.length)] || '替换为自然欧美家居主题', source: 'fallback' as const };
  const pool = FOLDER_SCENE_POOLS[cupType];
  const used = usedByType[cupType] || [];
  const unused = pool.filter((theme) => !used.includes(theme));
  return { theme: (unused.length ? unused[0] : pool[used.length % pool.length]), source: 'matched' as const };
}

export function cleanCupType(value: string): RecommendedCupType {
  const normalized = value.trim();
  return (['小烈酒杯', '无柄蛋杯', '可乐罐杯', '啤酒杯', '威士忌杯'] as const).find((item) => normalized.includes(item)) || '其他';
}

export async function identifyCupType(options: { provider: 'gemini' | 'openai'; apiKey: string; apiBaseUrl?: string | null; geminiModel: OptimizerModel; openAiModel: string; image: File; signal?: AbortSignal }) {
  const prompt = '只判断图片中主要产品的真实杯型与用途。只能返回以下一个标签，不得解释：小烈酒杯、无柄蛋杯、可乐罐杯、啤酒杯、威士忌杯、其他。不要根据 Logo、礼盒或场景风格猜测。';
  const dataUrl = `data:${options.image.type};base64,${await fileToBase64(options.image)}`;
  const model = options.provider === 'openai' ? options.openAiModel : options.geminiModel;
  const startedAt = performance.now();
  const id = startRequestConsoleEntry({ model, connection: options.provider === 'openai' ? 'direct' : options.apiBaseUrl ? 'proxy' : 'direct', requestSummary: `文件夹杯型识别 · ${options.image.name}` });
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
    const result = cleanCupType(text); updateRequestConsoleEntry(id, { status: 'success', durationMs: Math.round(performance.now() - startedAt), resultSummary: result, message: '文件夹杯型识别完成' }); return result;
  } catch (error) { updateRequestConsoleEntry(id, { status: options.signal?.aborted ? 'stopped' : 'failed', durationMs: Math.round(performance.now() - startedAt), message: error instanceof Error ? error.message : '杯型识别失败' }); throw error; }
}

export function buildSceneThemeRecommendationPrompt() {
  return `先根据杯口、杯身、杯底、容量感、是否有柄及整体比例，识别图片中产品的真实杯型和主要用途，再智能匹配最符合该杯型使用习惯的欧美真实生活场景。
必须优先遵守以下映射：
${CUP_SCENE_RULES.join('\n')}
若杯型不在列表中，按照该杯型的真实用途推荐自然、可信的欧美日常生活场景，不得为了视觉效果错误判断杯型或用途。
可以结合人物、姿态、手势和现有构图选择上述类别中最自然的一项，但不要改变产品用途。
严禁推荐圣诞节、感恩节、万圣节、情人节等任何节日、庆典、纪念日或带节日装饰的场景。也禁止世界杯、足球赛、橄榄球赛、超级碗、奥运会、体育观赛、球迷派对、赛事直播等具有赛事节点或准节日属性的场景；只推荐不依赖具体日期、节日或赛事的长期日常生活场景。
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
