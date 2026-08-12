import type { ImageModel, ImageSize, OptimizerModel, SceneLogoStyle } from '../types';

export type CombinedProvider = 'gemini' | 'openai';
export type CombinedPairSource = 'matched' | 'manual' | 'random';
export interface CombinedLogoProfile { logoId: string; summary: string; style: string; colors: string; suitableFor: string[] }
export interface CombinedSceneAnalysis { sceneId: string; summary: string; subject: string; composition: string; camera: string; lighting: string; styles: SceneLogoStyle[]; individualPrompt: string }
export interface CombinedLogoMapping { styleId: string; logoId: string; source: CombinedPairSource; reason: string }
export interface CombinedScenePlan { sceneId: string; analysis: CombinedSceneAnalysis; mappings: CombinedLogoMapping[]; individualPrompt: string }
export interface CombinedVerification { passed: boolean; scenePassed: boolean; logoPassed: boolean; sceneIssues: string[]; logoIssues: string[]; summary: string }
export interface CombinedAttempt { id: string; index: number; createdAt: number; blob: Blob; url: string; prompt: string; model: string; durationMs: number; verification?: CombinedVerification }
export interface CombinedReplaceSettings {
  analysisProvider: CombinedProvider; analysisModel: OptimizerModel; openAiAnalysisModel: string;
  imageProvider: CombinedProvider; imageModel: ImageModel; openAiImageModel: 'gpt-image-2'; imageSize: ImageSize; quality: 'high' | 'medium' | 'low'; aspectRatio: string;
  verificationProvider: CombinedProvider; verificationModel: OptimizerModel; openAiVerificationModel: string;
  concurrency: number; copiesPerScene: number; reuseAcrossScenes: boolean; smartAnalysis: boolean; autoIndividualPrompt: boolean; autoGenerateAfterAnalysis: boolean;
  repairRetries: number; autoRetryErrors: boolean; errorRetryLimit: number; errorRetryDelaySeconds: number;
}

export const COMBINED_MANDATORY_RULES = `【最高优先级强制约束】场景和氛围替换为指定主题，人物穿搭可改为适合新氛围的样式；人物在图中的位置、姿态、动作和手势严格不变。杯子的外形、轮廓、比例、结构、尺寸、方向、位置、杯口、杯身和杯底严格不变，禁止拉伸、压缩、弯曲、重塑或移动。相机视角、焦段感、透视关系、主体位置和整体构图严格不变。只允许替换杯子和木盒上的旧 Logo，其他位置的 Logo、文字、图案、招牌、服装标识、墙面标识、包装标识和装饰必须保持原样。杯子或木盒上的同一样式全部位置使用映射的新 Logo，不遗漏、不混用、不新增。新 Logo 的图形、文字和比例必须完整，沿用载体曲率、透视、反射、折射、印刷或雕刻工艺，禁止平面覆盖。新环境的光线、阴影、反射和景深必须自然统一。`;

export function isReplaceableLogoCarrier(carrier: string) {
  const value = carrier.trim().toLowerCase();
  return /杯|cup|glass|goblet|mug|木盒|wood(?:en)?\s*box|box/.test(value) && !/纸盒|包装盒|carton|package/.test(value);
}

export function buildCombinedReplacementPrompt(options: { scenePrompt: string; logoPrompt: string; individualPrompt: string; styles: SceneLogoStyle[]; mappings: CombinedLogoMapping[]; logoOrder: string[]; repairFeedback?: string }) {
  const byStyle = new Map(options.mappings.map((item) => [item.styleId, item]));
  const mapping = options.styles.map((style) => {
    const item = byStyle.get(style.id);
    const logoIndex = item ? options.logoOrder.indexOf(item.logoId) : -1;
    return `${style.label}（${style.description}；载体：${style.carrier}；共 ${style.occurrences} 处）全部替换为输入图片第 ${logoIndex + 2} 张的新 Logo`;
  }).join('；');
  return [
    `【公共场景替换目标】${options.scenePrompt.trim()}`,
    options.logoPrompt.trim() ? `【公共 Logo 替换要求】${options.logoPrompt.trim()}` : '',
    options.individualPrompt.trim() ? `【本图补充要求】${options.individualPrompt.trim()}` : '',
    `【Logo 映射】第一张输入图为原始场景，其余为新 Logo。${mapping}。`,
    COMBINED_MANDATORY_RULES,
    options.repairFeedback ? `【上次校验失败，必须逐项修复】${options.repairFeedback}` : '',
  ].filter(Boolean).join('\n\n');
}

function score(profile: CombinedLogoProfile, style: SceneLogoStyle) {
  const haystack = `${profile.summary} ${profile.style} ${profile.colors} ${profile.suitableFor.join(' ')}`.toLowerCase();
  return `${style.description} ${style.carrier}`.toLowerCase().split(/\s+|[,，。、；]/).filter((word) => word.length > 1).reduce((sum, word) => sum + (haystack.includes(word) ? 1 : 0), 0);
}

export function assignCombinedLogos(scenes: CombinedSceneAnalysis[], logos: CombinedLogoProfile[], reuseAcrossScenes: boolean): { plans: CombinedScenePlan[]; error?: string } {
  const maxStyles = Math.max(0, ...scenes.map((scene) => scene.styles.length));
  if (logos.length < maxStyles) return { plans: [], error: `Logo 不足：单张场景最多需要 ${maxStyles} 个不同 Logo，当前只有 ${logos.length} 个` };
  const totalStyles = scenes.reduce((sum, scene) => sum + scene.styles.length, 0);
  if (!reuseAcrossScenes && logos.length < totalStyles) return { plans: [], error: `Logo 不足：全部场景共需 ${totalStyles} 个不同 Logo，当前只有 ${logos.length} 个；可开启跨场景复用` };
  const globallyUsed = new Set<string>();
  const plans = scenes.map((scene) => {
    const usedHere = new Set<string>();
    const mappings = scene.styles.map((style) => {
      const available = logos.filter((logo) => !usedHere.has(logo.logoId) && (reuseAcrossScenes || !globallyUsed.has(logo.logoId)));
      const ranked = available.map((logo) => ({ logo, score: score(logo, style) })).sort((a, b) => b.score - a.score);
      const selected = ranked[0];
      if (!selected) throw new Error('Logo 分配失败');
      usedHere.add(selected.logo.logoId); globallyUsed.add(selected.logo.logoId);
      return { styleId: style.id, logoId: selected.logo.logoId, source: selected.score > 0 ? 'matched' : 'random', reason: selected.score > 0 ? `与 ${style.carrier || style.description} 的风格和载体更匹配` : '未找到明显匹配项，已随机分配' } as CombinedLogoMapping;
    });
    return { sceneId: scene.sceneId, analysis: scene, mappings, individualPrompt: scene.individualPrompt };
  });
  return { plans };
}

export function combinedTaskCount(sceneCount: number, copiesPerScene: number) { return sceneCount * Math.max(1, Math.min(8, copiesPerScene)); }
