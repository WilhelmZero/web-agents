import type { GeneratedImage, GlassLogoEtchOptions, ImageModel, ImageSize, OptimizerModel } from '../types';
import { fileToBase64 } from '../utils';

const GOOGLE_API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';

export function getGeminiApiRoot(proxyUrl = import.meta.env.VITE_GEMINI_PROXY_URL): string {
  const normalized = proxyUrl?.trim().replace(/\/+$/, '');
  if (!normalized) return GOOGLE_API_ROOT;
  return normalized.endsWith('/v1beta') ? normalized : `${normalized}/v1beta`;
}

export function getProxyHealthUrl(proxyUrl: string): string {
  const normalized = proxyUrl.trim().replace(/\/+$/, '').replace(/\/v1beta$/, '');
  const url = new URL(normalized);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('代理地址必须使用 http:// 或 https://');
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/health`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

export async function testProxyConnection(proxyUrl: string, signal?: AbortSignal): Promise<void> {
  let healthUrl: string;
  try {
    healthUrl = getProxyHealthUrl(proxyUrl);
  } catch {
    throw new Error('代理地址格式不正确，请填写完整的 http:// 或 https:// 地址');
  }

  const response = await fetch(healthUrl, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal,
  });
  const data = await response.json().catch(() => null) as { ok?: boolean } | null;
  if (!response.ok || data?.ok !== true) {
    throw new Error(`代理服务响应异常（HTTP ${response.status}）`);
  }
}

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
  usageMetadata?: { totalTokenCount?: number };
  error?: { message?: string; code?: number; status?: string };
}

const MAX_TRANSIENT_RETRIES = 3;

export function isRetryableGeminiStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504 || status === 524;
}

function retryDelay(attempt: number, retryAfter: string | null): number {
  const retryAfterSeconds = Number(retryAfter);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000, 30_000);
  }
  return Math.min(1000 * (2 ** attempt) + Math.random() * 500, 30_000);
}

function waitForRetry(delay: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('请求已中止', 'AbortError'));
      return;
    }
    const timer = window.setTimeout(resolve, delay);
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timer);
      reject(new DOMException('请求已中止', 'AbortError'));
    }, { once: true });
  });
}

function friendlyError(status: number, body: GeminiResponse): Error {
  const raw = body.error?.message || `Gemini 请求失败（HTTP ${status}）`;
  if (status === 400) return new Error(`请求参数无效：${raw}`);
  if (status === 401 || status === 403) return new Error('API Key 无效、无权限或当前模型不可用');
  if (status === 429) return new Error('请求过于频繁或额度不足，请降低并发后重试');
  if (status === 503) return new Error(`Gemini 当前请求量过高，服务暂时无可用容量：${raw}`);
  if (status === 524) return new Error('Cloudflare 代理等待 Gemini 响应超时（HTTP 524），请重试、降低分辨率，或临时切换为 Gemini 直连');
  if (status >= 500) return new Error(`Gemini 服务暂时不可用：${raw}`);
  return new Error(raw);
}

async function postGemini(
  model: string,
  apiKey: string,
  body: unknown,
  signal?: AbortSignal,
  apiBaseUrl?: string | null,
): Promise<GeminiResponse> {
  const url = `${getGeminiApiRoot(apiBaseUrl === null ? '' : apiBaseUrl)}/models/${encodeURIComponent(model)}:generateContent`;
  for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify(body),
        signal,
      });
      const data = (await response.json().catch(() => ({}))) as GeminiResponse;
      if (response.ok && !data.error) return data;
      const retryable = isRetryableGeminiStatus(response.status);
      const retryLimit = response.status === 524 ? 1 : MAX_TRANSIENT_RETRIES;
      if (!retryable || attempt >= retryLimit) {
        const error = friendlyError(response.status, data);
        if (retryable) error.message += `；已自动重试 ${retryLimit} 次，建议稍后再试、降低并发或临时切换模型`;
        throw error;
      }
      await waitForRetry(retryDelay(attempt, response.headers.get('Retry-After')), signal);
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
      if (error instanceof Error && !error.message.startsWith('Failed to fetch') && !(error instanceof TypeError)) throw error;
      if (attempt === MAX_TRANSIENT_RETRIES) {
        throw new Error(`网络请求失败，已自动重试 ${MAX_TRANSIENT_RETRIES} 次，请检查代理或网络连接`);
      }
      await waitForRetry(retryDelay(attempt, null), signal);
    }
  }
  throw new Error('Gemini 请求重试失败');
}

export async function generateSceneImage(options: {
  apiKey: string;
  model: ImageModel;
  prompt: string;
  image: File;
  aspectRatio: string;
  imageSize: ImageSize;
  signal?: AbortSignal;
  apiBaseUrl?: string | null;
}): Promise<GeneratedImage> {
  const base64 = await fileToBase64(options.image);
  const data = await postGemini(
    options.model,
    options.apiKey,
    {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `基于提供的产品白底图生成一张商业场景图。必须保持产品外观、结构、颜色、Logo 和文字准确，不要复制或增加产品。场景要求：${options.prompt}`,
            },
            { inlineData: { mimeType: options.image.type, data: base64 } },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: {
          aspectRatio: options.aspectRatio,
          imageSize: options.imageSize,
        },
      },
    },
    options.signal,
    options.apiBaseUrl,
  );

  const imagePart = data.candidates
    ?.flatMap((candidate) => candidate.content?.parts ?? [])
    .find((part) => part.inlineData?.data);
  if (!imagePart?.inlineData?.data) throw new Error('模型未返回图片，请调整提示词后重试');

  const bytes = Uint8Array.from(atob(imagePart.inlineData.data), (char) => char.charCodeAt(0));
  const mimeType = imagePart.inlineData.mimeType || 'image/png';
  return {
    blob: new Blob([bytes], { type: mimeType }),
    mimeType,
    usageTokens: data.usageMetadata?.totalTokenCount,
  };
}

export async function optimizePrompt(options: {
  apiKey: string;
  model: OptimizerModel;
  prompt: string;
  signal?: AbortSignal;
  apiBaseUrl?: string | null;
}): Promise<string> {
  const data = await postGemini(
    options.model,
    options.apiKey,
    {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `你是商业产品摄影提示词专家。请把下面的场景描述优化成一段可直接用于图片编辑模型的中文提示词。强调场景、构图、光线、材质、镜头和商业质感，同时要求严格保持原产品外观。只输出优化后的提示词，不要解释。\n\n原提示词：${options.prompt}`,
            },
          ],
        },
      ],
      generationConfig: { temperature: 0.7 },
    },
    options.signal,
    options.apiBaseUrl,
  );
  const text = data.candidates
    ?.flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => part.text ?? '')
    .join('')
    .trim();
  if (!text) throw new Error('模型未返回优化结果');
  return text;
}

export function buildGlassLogoEtchInstruction(options: GlassLogoEtchOptions): string {
  return `启用“玻璃杯 LOGO 雕刻合成”专用流程。先识别所有可见玻璃杯的杯口顶端、杯口下缘、杯身左右边界、杯肚底边和整杯底边；区分平底杯与高脚杯，高脚和底座不计入贴图区。以杯口下缘到杯肚底边为有效高度 H，杯身正面左右边界为宽度 W；Logo 正方形边长为 min(W,H) × ${options.scaleRatio}，顶部位置为杯口下缘 + H × ${options.topMarginRatio}，水平居中。越过杯肚底边时先上移，仍无法容纳时等比缩小，不得拉伸 Logo。Logo 颜色为${options.logoColor === 'white' ? '白色' : '黑色'}，材质为${options.textureMode === 'laser_etch' ? '半透明磨砂、细微凹凸的玻璃内部激光蚀刻' : '实色表面油墨印刷'}。${options.applyAllCups ? '对所有可正面展示 Logo 的有效杯逐一应用；明显侧向或遮挡严重的杯不应强行贴图。' : '仅对画面层级最靠前且视觉尺寸最大的有效主体杯应用。'}保持原场景的背景、酒水、道具、构图、光线和其他内容完全不变，仅在选定杯身增加 Logo。按杯身曲率进行水平包裹、透视压缩和边缘渐缩，匹配遮挡、景深、反光、折射、阴影、颗粒和清晰度。内部分析坐标使用 ${options.outputCoordinateMode === 'relative_percent' ? '[0,1] 相对比例' : '原图像素'} 基准。若未检测到可贴图杯，不得凭空生成杯子或改动场景。`;
}
export async function generateLogoComposite(options: {
  apiKey: string;
  model: ImageModel;
  prompt: string;
  scene: File;
  logo: Blob;
  placementGuide?: Blob;
  guideMode?: 'placement' | 'inpaint';
  guideLogoInverted?: boolean;
  aspectRatio?: string;
  imageSize: ImageSize;
  signal?: AbortSignal;
  apiBaseUrl?: string | null;
  glassLogoEtch?: GlassLogoEtchOptions;
}): Promise<GeneratedImage> {
  const [sceneData, logoData, guideData] = await Promise.all([
    fileToBase64(options.scene),
    fileToBase64(options.logo),
    options.placementGuide ? fileToBase64(options.placementGuide) : Promise.resolve(undefined),
  ]);
  const placementInstruction = options.glassLogoEtch
    ? buildGlassLogoEtchInstruction(options.glassLogoEtch)
    : guideData && options.guideMode === 'inpaint'
    ? '第三张图片是局部重绘区域参考图，其中红色半透明标记是唯一允许修改的区域。仅在该区域内自然加入第二张原始 Logo；严格保持标记区域外的场景内容、主体、构图、机位、光影和材质不变。最终图片不得出现红色遮罩或选区边缘。'
    : guideData
    ? `第三张图片是定位参考图。必须优先遵循其中 Logo 的中心位置、相对大小和旋转角度，同时使用第二张原始 Logo 保持图形、颜色与文字准确。${options.guideLogoInverted ? '定位参考图中的 Logo 仅为增强可见性而进行了颜色反相，绝对不要采用其反相颜色，最终颜色必须以第二张原始 Logo 为准。' : ''}`
    : '请根据用户提示词决定 Logo 的位置、大小和融合方式。';
  const applicationInstruction = options.glassLogoEtch
    ? ''
    : '如果场景中存在多个杯子，必须给每一个杯子都自然添加同一个 Logo，并让每个 Logo 分别贴合对应杯体的曲面、透视、尺寸、光线和材质；不得遗漏任何一个杯子。';
  const parts: GeminiPart[] = [
    {
      text: `请完成专业的 Logo 场景合成。第一张图片是必须保持构图和内容的原始场景，第二张图片是必须准确保留图形、颜色和文字的原始 Logo。${placementInstruction}${applicationInstruction} 让 Logo 与场景的材质、透视、光线、阴影自然融合，不要在杯子以外的位置添加额外 Logo，不要改变场景中的主体。${options.prompt.trim() ? `用户补充要求：${options.prompt.trim()}` : ''}`,
    },
    { inlineData: { mimeType: options.scene.type, data: sceneData } },
    { inlineData: { mimeType: options.logo.type, data: logoData } },
  ];
  if (guideData) {
    parts.push({ inlineData: { mimeType: options.placementGuide?.type || 'image/png', data: guideData } });
  }
  const imageConfig: { imageSize: ImageSize; aspectRatio?: string } = {
    imageSize: options.imageSize,
  };
  if (options.aspectRatio) imageConfig.aspectRatio = options.aspectRatio;
  const data = await postGemini(
    options.model,
    options.apiKey,
    {
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig,
      },
    },
    options.signal,
    options.apiBaseUrl,
  );
  const imagePart = data.candidates
    ?.flatMap((candidate) => candidate.content?.parts ?? [])
    .find((part) => part.inlineData?.data);
  if (!imagePart?.inlineData?.data) throw new Error('模型未返回合成图片，请调整提示词后重试');
  const bytes = Uint8Array.from(atob(imagePart.inlineData.data), (char) => char.charCodeAt(0));
  const mimeType = imagePart.inlineData.mimeType || 'image/png';
  return {
    blob: new Blob([bytes], { type: mimeType }),
    mimeType,
    usageTokens: data.usageMetadata?.totalTokenCount,
  };
}

export function buildLogoReplacementInstruction(options: {
  hasOldLogo: boolean;
  logoColorMode: 'original' | 'white' | 'black' | 'custom';
  customLogoColor?: string;
}): string {
  const colorInstruction = options.logoColorMode === 'original'
    ? '严格保持新 Logo 原始颜色。'
    : options.logoColorMode === 'white'
      ? '将新 Logo 转换为白色，但保持图形、文字、比例和细节不变。'
      : options.logoColorMode === 'black'
        ? '将新 Logo 转换为黑色，但保持图形、文字、比例和细节不变。'
        : `将新 Logo 调整为颜色 ${options.customLogoColor || '#ffffff'}，但保持图形、文字、比例和细节不变。`;
  const referenceInstruction = options.hasOldLogo
    ? '第二张图片是旧 Logo 识别参考，第三张图片是必须用于替换的新 Logo。请在场景中寻找与旧 Logo 相同的所有标识并逐一替换。'
    : '第二张图片是必须用于替换的新 Logo。请识别场景内产品或载体上现有的品牌 Logo，并逐一替换。';
  return `执行严格的 Logo 替换任务。第一张图片是原始场景图，${referenceInstruction}${colorInstruction} 只允许改变旧 Logo 覆盖的区域：保持每个 Logo 原有的位置、大小、角度、透视、曲面包裹、遮挡关系和材质融合方式，并用新 Logo 准确替换。若同一场景存在多个旧 Logo，必须全部替换。除 Logo 外，原图所有像素对应内容必须保持不变，包括画幅、构图、裁切、镜头、主体、产品结构、杯体、背景、人物、道具、已有非 Logo 文字、颜色、光线、阴影、反射、折射、景深、噪点和清晰度。不得移动、删除、增加、重绘或重新设计任何非 Logo 内容，不得在原本没有 Logo 的位置新增 Logo。`;
}

export async function generateLogoReplacement(options: {
  apiKey: string;
  model: ImageModel;
  scene: File;
  oldLogo?: File;
  newLogo: File;
  logoColorMode: 'original' | 'white' | 'black' | 'custom';
  customLogoColor?: string;
  promptOverride?: string;
  aspectRatio?: string;
  imageSize: ImageSize;
  signal?: AbortSignal;
  apiBaseUrl?: string | null;
}): Promise<GeneratedImage> {
  const [sceneData, oldLogoData, newLogoData] = await Promise.all([
    fileToBase64(options.scene),
    options.oldLogo ? fileToBase64(options.oldLogo) : Promise.resolve(undefined),
    fileToBase64(options.newLogo),
  ]);
  const parts: GeminiPart[] = [{
    text: options.promptOverride?.trim() || buildLogoReplacementInstruction({ hasOldLogo: Boolean(options.oldLogo), logoColorMode: options.logoColorMode, customLogoColor: options.customLogoColor }),
  }, { inlineData: { mimeType: options.scene.type, data: sceneData } }];
  if (oldLogoData && options.oldLogo) parts.push({ inlineData: { mimeType: options.oldLogo.type, data: oldLogoData } });
  parts.push({ inlineData: { mimeType: options.newLogo.type, data: newLogoData } });
  const imageConfig: { imageSize: ImageSize; aspectRatio?: string } = { imageSize: options.imageSize };
  if (options.aspectRatio) imageConfig.aspectRatio = options.aspectRatio;
  const data = await postGemini(options.model, options.apiKey, {
    contents: [{ role: 'user', parts }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig },
  }, options.signal, options.apiBaseUrl);
  const imagePart = data.candidates?.flatMap((candidate) => candidate.content?.parts ?? []).find((part) => part.inlineData?.data);
  if (!imagePart?.inlineData?.data) throw new Error('模型未返回 Logo 替换图片，请重试或切换模型');
  const bytes = Uint8Array.from(atob(imagePart.inlineData.data), (char) => char.charCodeAt(0));
  const mimeType = imagePart.inlineData.mimeType || 'image/png';
  return { blob: new Blob([bytes], { type: mimeType }), mimeType, usageTokens: data.usageMetadata?.totalTokenCount };
}
export async function generateInpaintImage(options: {
  apiKey: string;
  model: ImageModel;
  prompt: string;
  image: File;
  maskGuide: Blob;
  aspectRatio?: string;
  imageSize: ImageSize;
  signal?: AbortSignal;
  apiBaseUrl?: string | null;
}): Promise<GeneratedImage> {
  const [imageData, maskData] = await Promise.all([
    fileToBase64(options.image),
    fileToBase64(options.maskGuide),
  ]);
  const data = await postGemini(
    options.model,
    options.apiKey,
    {
      contents: [{
        role: 'user',
        parts: [
          {
            text: `请执行严格的局部重绘。第一张图片是必须保留的原始图片；第二张图片是区域参考图，其中红色半透明标记是唯一允许修改的区域。只在红色标记区域内根据用户要求生成或修改内容，标记区域外的所有像素对应内容必须保持不变，包括主体、构图、机位、裁切、背景、光线、阴影、颜色、材质、文字和 Logo。不得扩大修改区域，最终结果不得出现红色遮罩、选区边缘或标记。用户要求：${options.prompt}`,
          },
          { inlineData: { mimeType: options.image.type, data: imageData } },
          { inlineData: { mimeType: options.maskGuide.type || 'image/png', data: maskData } },
        ],
      }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: {
          imageSize: options.imageSize,
          ...(options.aspectRatio ? { aspectRatio: options.aspectRatio } : {}),
        },
      },
    },
    options.signal,
    options.apiBaseUrl,
  );
  const imagePart = data.candidates
    ?.flatMap((candidate) => candidate.content?.parts ?? [])
    .find((part) => part.inlineData?.data);
  if (!imagePart?.inlineData?.data) throw new Error('模型未返回局部重绘图片，请调整选区或提示词后重试');
  const bytes = Uint8Array.from(atob(imagePart.inlineData.data), (char) => char.charCodeAt(0));
  const mimeType = imagePart.inlineData.mimeType || 'image/png';
  return {
    blob: new Blob([bytes], { type: mimeType }),
    mimeType,
    usageTokens: data.usageMetadata?.totalTokenCount,
  };
}

export async function analyzeProductDetailPrompts(options: {
  apiKey: string;
  model: OptimizerModel;
  image: File;
  productInfo: string;
  count: number;
  signal?: AbortSignal;
  apiBaseUrl?: string | null;
}): Promise<Array<{ title: string; content: string; overlayTexts: string[] }>> {
  const imageData = await fileToBase64(options.image);
  const data = await postGemini(
    options.model,
    options.apiKey,
    {
      contents: [{
        role: 'user',
        parts: [
          {
            text: `你是擅长欧美品牌独立站与国际电商 PDP 的资深视觉策划师。请分析白底产品图和用户提供的商品信息，规划恰好 ${options.count} 张互不重复、但上下连贯的商品详情页图片。单张时生成综合主视觉；多张时形成清晰的视觉叙事顺序：先用高质量主视觉建立产品印象，再用中景与细节特写解释材质、结构和核心利益，然后用真实生活方式场景帮助用户想象使用价值，尺寸或包装信息放在合适位置，最后以品牌感收束。不得编造无法确认的参数或功能。

整套图片必须共享统一的品牌艺术指导，包括一致的色板、背景材质、光线方向、字体风格、信息层级、留白、图形元素、产品比例和修图质感。相邻页面的背景色、光影或装饰图形需要形成自然的上下视觉承接，避免每张图片像来自不同模板；同时每页仍要有独立明确的信息重点。高质量产品图既要有清晰的中性背景展示，也要有帮助用户理解使用收益的生活方式图片，并保证所有详情图都适合纵向拼接成长图。

每项需要提供简短用途标题、可直接交给图片编辑模型的中文完整提示词，以及需要实际显示在图片上的短文案数组。提示词必须要求严格保持原产品外观、结构、颜色、材质、比例、Logo 和已有文字准确。所有需要显示在成图上的文字必须在完整提示词中使用中文双引号包裹，并与 overlayTexts 数组逐项完全一致；不需要上图文字时返回空数组。

用户商品信息：${options.productInfo}`,
          },
          { inlineData: { mimeType: options.image.type, data: imageData } },
        ],
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            seriesStyle: { type: 'STRING' },
            prompts: {
              type: 'ARRAY',
              minItems: options.count,
              maxItems: options.count,
              items: {
                type: 'OBJECT',
                properties: {
                  title: { type: 'STRING' },
                  content: { type: 'STRING' },
                  overlayTexts: { type: 'ARRAY', items: { type: 'STRING' } },
                },
                required: ['title', 'content', 'overlayTexts'],
              },
            },
          },
          required: ['seriesStyle', 'prompts'],
        },
      },
    },
    options.signal,
    options.apiBaseUrl,
  );
  const text = data.candidates?.flatMap((candidate) => candidate.content?.parts ?? []).map((part) => part.text || '').join('').trim();
  if (!text) throw new Error('商品分析模型未返回提示词');
  let parsed: { seriesStyle?: unknown; prompts?: Array<{ title?: unknown; content?: unknown; overlayTexts?: unknown }> };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    throw new Error('商品分析结果不是有效 JSON，请重新分析');
  }
  if (!Array.isArray(parsed.prompts) || parsed.prompts.length !== options.count) {
    throw new Error(`商品分析应返回 ${options.count} 条提示词，实际返回 ${parsed.prompts?.length || 0} 条`);
  }
  if (typeof parsed.seriesStyle !== 'string' || !parsed.seriesStyle.trim()) {
    throw new Error('商品分析结果缺少整套详情图的统一视觉规范');
  }
  const seriesStyle = parsed.seriesStyle.trim();
  return parsed.prompts.map((item, index) => {
    if (typeof item.title !== 'string' || !item.title.trim() || typeof item.content !== 'string' || !item.content.trim() || !Array.isArray(item.overlayTexts) || !item.overlayTexts.every((value) => typeof value === 'string')) {
      throw new Error(`第 ${index + 1} 条商品详情提示词字段不完整`);
    }
    return {
      title: item.title.trim(),
      content: `全套详情图统一视觉规范：${seriesStyle}。本页在保持该规范的基础上完成以下内容：${item.content.trim()}`,
      overlayTexts: item.overlayTexts.map((value) => String(value).trim()).filter(Boolean),
    };
  });
}

export async function generateProductDetailImage(options: {
  apiKey: string;
  model: ImageModel;
  image: File;
  prompt: string;
  aspectRatio?: string;
  imageSize: ImageSize;
  signal?: AbortSignal;
  apiBaseUrl?: string | null;
}): Promise<GeneratedImage> {
  const imageData = await fileToBase64(options.image);
  const data = await postGemini(
    options.model,
    options.apiKey,
    {
      contents: [{
        role: 'user',
        parts: [
          {
            text: `请基于第一张白底产品图制作一张专业电商商品详情页图片。必须严格保持产品外观、结构、颜色、材质、真实比例、Logo 和已有文字准确，不得重新设计、复制或增加产品。按照下面的详情页提示完成场景、构图、卖点表达和指定上图文字；引号内文字需要清晰准确地显示。详情页要求：${options.prompt}`,
          },
          { inlineData: { mimeType: options.image.type, data: imageData } },
        ],
      }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: {
          imageSize: options.imageSize,
          ...(options.aspectRatio ? { aspectRatio: options.aspectRatio } : {}),
        },
      },
    },
    options.signal,
    options.apiBaseUrl,
  );
  const imagePart = data.candidates?.flatMap((candidate) => candidate.content?.parts ?? []).find((part) => part.inlineData?.data);
  if (!imagePart?.inlineData?.data) throw new Error('模型未返回商品详情图，请调整提示词后重试');
  const bytes = Uint8Array.from(atob(imagePart.inlineData.data), (char) => char.charCodeAt(0));
  const mimeType = imagePart.inlineData.mimeType || 'image/png';
  return { blob: new Blob([bytes], { type: mimeType }), mimeType, usageTokens: data.usageMetadata?.totalTokenCount };
}
