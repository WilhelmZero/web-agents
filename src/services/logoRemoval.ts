import type { GeneratedImage, LogoRemovalAnalysis, LogoRemovalScope, LogoRemovalSettings, LogoRemovalVerification } from '../types';
import { analyzeLogoRemovalGemini, generateLogoRemovalGemini, verifyLogoRemovalGemini } from './gemini';
import { analyzeLogoRemovalOpenAi, generateLogoRemovalOpenAi, verifyLogoRemovalOpenAi } from './logoReplaceOpenAi';

const SCOPE_LABEL: Record<LogoRemovalScope, string> = {
  'cup-body': '只识别并去除杯身外侧表面的印刷、雕刻、蚀刻或贴附 Logo；杯底、瓶体、礼盒和配件上的标识不属于目标',
  'cup-and-bottom': '识别并去除杯身外侧表面与杯底的印刷、雕刻、蚀刻或贴附 Logo；礼盒和其他配件上的标识不属于目标',
  'all-product-carriers': '识别并去除杯、瓶、礼盒及产品配件载体上的品牌或个性化标识',
};

export const DEFAULT_LOGO_REMOVAL_PROMPT = `只去除分析结果明确列出的目标 Logo，不得删除或修改其他内容。用目标 Logo 下方原本应有的玻璃、液体、透明度、折射、反射、杯体曲率、纹理、雕刻底材和环境光自然重建区域，不得留下文字残影、贴纸边缘、模糊块或明显修补痕迹。严格保持画布、构图、产品数量、杯型、杯口、杯身、杯底、把手、液体、泡沫、木盒、内衬、人物、手势、遮挡、景深和光影位置不变。商品说明、尺寸标注、排版文字、背景装饰、前景徽标以及不属于目标载体的任何文字或图形必须完整保留。`;

export function buildLogoRemovalAnalysisPrompt(scope: LogoRemovalScope) {
  return `你是商业产品图的 Logo 去除目标分析器。${SCOPE_LABEL[scope]}。只把真实附着在选定产品载体表面的品牌 Logo、姓名图案、个性化印刷/雕刻/蚀刻识别为目标。不得把商品说明、尺寸箭头和数字、容量文字、卖点图标、版式标题、背景招牌、场景装饰、杯中反射、木纹或玻璃纹理误判为目标。逐个输出目标在整图中的 0 到 1 归一化包围框，并说明载体、工艺和人物/手等遮挡关系。preserve 列出必须保留的商品说明、尺寸标注、人物、礼盒、背景文字及其他关键元素。没有符合当前范围的目标时 action 必须为 skip_no_target，不能为了处理而虚构 Logo。所有说明使用简体中文。`;
}

export function buildLogoRemovalGenerationPrompt(settings: LogoRemovalSettings, analysis: LogoRemovalAnalysis, repairFeedback?: string) {
  const targets = analysis.targets.map((target, index) => `${index + 1}. ${target.carrier}上的${target.markType}：${target.description}；区域 left=${target.left.toFixed(4)}, top=${target.top.toFixed(4)}, right=${target.right.toFixed(4)}, bottom=${target.bottom.toFixed(4)}；遮挡：${target.occlusion || '无'}`).join('\n');
  return `${settings.prompt.trim() || DEFAULT_LOGO_REMOVAL_PROMPT}\n\n当前去除范围：${SCOPE_LABEL[settings.scope]}。\n只处理以下已确认目标：\n${targets}\n必须保留：${analysis.preserve.join('；') || '除目标区域外的全部像素和视觉关系'}。${repairFeedback ? `\n上次校验失败，请仅修复这些问题：${repairFeedback}` : ''}`;
}

function buildVerificationPrompt(analysis: LogoRemovalAnalysis) {
  const targets = analysis.targets.map((target) => `${target.carrier} ${target.description} [${target.left},${target.top},${target.right},${target.bottom}]`).join('；');
  return `第一张是原图，第二张是去除 Logo 后的生成图。目标为：${targets}。必须严格检查：目标 Logo 的全部文字、轮廓、贴纸边缘和残影已经消失；重建后的玻璃、液体、反射、折射、曲率和纹理自然连续；除目标区域外的产品结构、人物、手、礼盒、商品说明、尺寸标注、排版文字、背景装饰、构图、景深和光影没有被删除、移动或重绘。任一项不满足都必须 passed=false。differences 和 summary 使用简体中文。`;
}

export async function analyzeLogoRemovalTarget(options: { settings: LogoRemovalSettings; apiKey: string; openAiApiKey: string; apiBaseUrl?: string | null; scene: File; signal?: AbortSignal }): Promise<LogoRemovalAnalysis> {
  const prompt = buildLogoRemovalAnalysisPrompt(options.settings.scope);
  if (options.settings.analysisProvider === 'openai') {
    if (!options.openAiApiKey) throw new Error('请先配置 OpenAI API Key');
    return analyzeLogoRemovalOpenAi({ apiKey: options.openAiApiKey, model: options.settings.openAiAnalysisModel, scene: options.scene, prompt, signal: options.signal });
  }
  if (!options.apiKey) throw new Error('请先配置 Gemini API Key');
  return analyzeLogoRemovalGemini({ apiKey: options.apiKey, model: options.settings.analysisModel, scene: options.scene, prompt, signal: options.signal, apiBaseUrl: options.apiBaseUrl });
}

export async function generateLogoRemoval(options: { settings: LogoRemovalSettings; apiKey: string; openAiApiKey: string; apiBaseUrl?: string | null; scene: File; analysis: LogoRemovalAnalysis; repairFeedback?: string; signal?: AbortSignal }): Promise<GeneratedImage> {
  const prompt = buildLogoRemovalGenerationPrompt(options.settings, options.analysis, options.repairFeedback);
  if (options.settings.imageProvider === 'openai') {
    if (!options.openAiApiKey) throw new Error('请先配置 OpenAI API Key');
    return generateLogoRemovalOpenAi({ apiKey: options.openAiApiKey, model: options.settings.openAiImageModel, scene: options.scene, prompt, signal: options.signal });
  }
  if (!options.apiKey) throw new Error('请先配置 Gemini API Key');
  return generateLogoRemovalGemini({ apiKey: options.apiKey, model: options.settings.imageModel, scene: options.scene, prompt, imageSize: options.settings.imageSize, signal: options.signal, apiBaseUrl: options.apiBaseUrl });
}

export async function verifyLogoRemoval(options: { settings: LogoRemovalSettings; apiKey: string; openAiApiKey: string; apiBaseUrl?: string | null; originalScene: File; generatedImage: Blob; analysis: LogoRemovalAnalysis; signal?: AbortSignal }): Promise<LogoRemovalVerification> {
  const prompt = buildVerificationPrompt(options.analysis);
  if (options.settings.verificationProvider === 'openai') {
    if (!options.openAiApiKey) throw new Error('请先配置 OpenAI API Key');
    return verifyLogoRemovalOpenAi({ apiKey: options.openAiApiKey, model: options.settings.openAiVerificationModel, originalScene: options.originalScene, generatedImage: options.generatedImage, prompt, signal: options.signal });
  }
  if (!options.apiKey) throw new Error('请先配置 Gemini API Key');
  return verifyLogoRemovalGemini({ apiKey: options.apiKey, model: options.settings.verificationModel, originalScene: options.originalScene, generatedImage: options.generatedImage, prompt, signal: options.signal, apiBaseUrl: options.apiBaseUrl });
}
