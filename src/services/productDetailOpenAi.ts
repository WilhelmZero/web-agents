import { OPENAI_ROOT } from './openAiEndpoint';
import { fileToBase64 } from '../utils';

export async function analyzeProductDetailPromptsOpenAi(options: {
  apiKey: string;
  model: string;
  image: File;
  productInfo: string;
  count: number;
  signal?: AbortSignal;
}): Promise<Array<{ title: string; content: string; overlayTexts: string[] }>> {
  const base64 = await fileToBase64(options.image);
  const response = await fetch(`${OPENAI_ROOT}/responses`, {
    method: 'POST',
    signal: options.signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.apiKey}` },
    body: JSON.stringify({
      model: options.model,
      input: [{ role: 'user', content: [
        { type: 'input_text', text: `你是欧美电商商品详情页视觉策划师。参考产品图与商品信息，规划恰好 ${options.count} 张上下连贯但主题互不重复的详情图。保持统一的色板、光线、字体和修图风格；从主视觉、材质细节、使用场景到品牌收束。不得编造产品参数。每项返回简短标题、完整中文图片编辑提示词、实际显示在成图上的短文案数组。提示词必须要求保留原产品外观、结构、颜色、材质、比例、Logo 和已有文字；文案在提示词中使用中文双引号，且与 overlayTexts 完全一致。商品信息：${options.productInfo}` },
        { type: 'input_image', image_url: `data:${options.image.type || 'image/png'};base64,${base64}`, detail: 'high' },
      ] }],
      text: { format: { type: 'json_schema', name: 'product_detail_plan', strict: true, schema: {
        type: 'object', additionalProperties: false, properties: {
          seriesStyle: { type: 'string' },
          prompts: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
            title: { type: 'string' }, content: { type: 'string' }, overlayTexts: { type: 'array', items: { type: 'string' } },
          }, required: ['title', 'content', 'overlayTexts'] } },
        }, required: ['seriesStyle', 'prompts'],
      } } },
    }),
  });
  const data = await response.json().catch(() => null) as { error?: { message?: string }; output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> } | null;
  if (!response.ok) throw new Error(data?.error?.message || `商品分析失败（HTTP ${response.status}）`);
  const text = data?.output_text || data?.output?.flatMap((item) => item.content || []).map((item) => item.text || '').join('') || '';
  let parsed: { seriesStyle?: unknown; prompts?: unknown };
  try { parsed = JSON.parse(text); } catch { throw new Error('商品分析结果不是有效 JSON，请重新分析'); }
  if (typeof parsed.seriesStyle !== 'string' || !parsed.seriesStyle.trim()) throw new Error('商品分析结果缺少统一视觉规范');
  if (!Array.isArray(parsed.prompts) || parsed.prompts.length !== options.count) throw new Error(`商品分析应返回 ${options.count} 条提示词`);
  return parsed.prompts.map((raw, index) => {
    const item = raw as { title?: unknown; content?: unknown; overlayTexts?: unknown };
    if (typeof item.title !== 'string' || !item.title.trim() || typeof item.content !== 'string' || !item.content.trim() || !Array.isArray(item.overlayTexts) || !item.overlayTexts.every((value) => typeof value === 'string')) throw new Error(`第 ${index + 1} 条详情提示词不完整`);
    return { title: item.title.trim(), content: `全套详情图统一视觉规范：${parsed.seriesStyle}。本页内容：${item.content.trim()}`, overlayTexts: item.overlayTexts.map((value) => String(value).trim()).filter(Boolean) };
  });
}
