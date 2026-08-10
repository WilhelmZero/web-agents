import type { GeneratedImage, GlassLogoEtchOptions, ImageModel, ImageSize, LogoVerificationResult, ObjectPreservationOptions, OptimizerModel, SceneLogoStyle } from '../types';
import { fileToBase64 } from '../utils';
import { startRequestConsoleEntry, summarizeGeminiRequest, updateRequestConsoleEntry } from './requestConsole';
import { normalizePaperTextRegions, type PaperTextRegion, type PaperTextVerification } from './paperText';
import { CUP_RESIZE_PROMPT } from './cupResize';

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
  const requestStartedAt = performance.now();
  const consoleId = startRequestConsoleEntry({ model, connection: apiBaseUrl ? 'proxy' : 'direct', requestSummary: summarizeGeminiRequest(body) });
  for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt += 1) {
    try {
      updateRequestConsoleEntry(consoleId, { status: 'running', attempt: attempt + 1, message: attempt ? '正在进行第 ' + (attempt + 1) + ' 次请求' : '请求已发送' });
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
      if (response.ok && !data.error) {
        const imageParts = data.candidates?.flatMap((candidate) => candidate.content?.parts ?? []).filter((part) => part.inlineData?.data) ?? [];
        const outputImages = imageParts.slice(0, 4).map((part) => new Blob([Uint8Array.from(atob(part.inlineData!.data), (char) => char.charCodeAt(0))], { type: part.inlineData!.mimeType || 'image/png' }));
        updateRequestConsoleEntry(consoleId, { status: 'success', httpStatus: response.status, durationMs: Math.round(performance.now() - requestStartedAt), resultSummary: (imageParts.length ? imageParts.length + ' 张图片' : '响应成功') + (data.usageMetadata?.totalTokenCount ? ' · ' + data.usageMetadata.totalTokenCount + ' tokens' : ''), message: 'Gemini 请求完成', outputImages });
        return data;
      }
      const retryable = isRetryableGeminiStatus(response.status);
      const retryLimit = response.status === 524 ? 1 : MAX_TRANSIENT_RETRIES;
      if (!retryable || attempt >= retryLimit) {
        const error = friendlyError(response.status, data);
        if (retryable) error.message += `；已自动重试 ${retryLimit} 次，建议稍后再试、降低并发或临时切换模型`;
        updateRequestConsoleEntry(consoleId, { status: 'failed', httpStatus: response.status, durationMs: Math.round(performance.now() - requestStartedAt), message: error.message });
        throw error;
      }
      updateRequestConsoleEntry(consoleId, { status: 'retrying', httpStatus: response.status, attempt: attempt + 1, message: 'HTTP ' + response.status + '，等待自动重试' });
      await waitForRetry(retryDelay(attempt, response.headers.get('Retry-After')), signal);
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) { updateRequestConsoleEntry(consoleId, { status: 'stopped', durationMs: Math.round(performance.now() - requestStartedAt), message: '用户中止请求' }); throw error; }
      if (error instanceof Error && !error.message.startsWith('Failed to fetch') && !(error instanceof TypeError)) throw error;
      if (attempt === MAX_TRANSIENT_RETRIES) {
        const networkError = new Error(`网络请求失败，已自动重试 ${MAX_TRANSIENT_RETRIES} 次，请检查代理或网络连接`);
        updateRequestConsoleEntry(consoleId, { status: 'failed', durationMs: Math.round(performance.now() - requestStartedAt), message: networkError.message });
        throw networkError;
      }
      updateRequestConsoleEntry(consoleId, { status: 'retrying', attempt: attempt + 1, message: '网络错误，等待自动重试' });
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

export async function generateSceneReplacementImage(options: {
  apiKey: string;
  model: ImageModel;
  prompt: string;
  image: File;
  aspectRatio?: string;
  imageSize: ImageSize;
  signal?: AbortSignal;
  apiBaseUrl?: string | null;
}): Promise<GeneratedImage> {
  const base64 = await fileToBase64(options.image);
  const data = await postGemini(options.model, options.apiKey, {
    contents: [{ role: 'user', parts: [
      { text: options.prompt.trim() },
      { inlineData: { mimeType: options.image.type, data: base64 } },
    ]}],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: {
      imageSize: options.imageSize,
      ...(options.aspectRatio ? { aspectRatio: options.aspectRatio } : {}),
    } },
  }, options.signal, options.apiBaseUrl);
  const imagePart = data.candidates?.flatMap((candidate) => candidate.content?.parts ?? []).find((part) => part.inlineData?.data);
  if (!imagePart?.inlineData?.data) throw new Error('模型未返回场景替换图片，请调整提示词后重试');
  const bytes = Uint8Array.from(atob(imagePart.inlineData.data), (char) => char.charCodeAt(0));
  const mimeType = imagePart.inlineData.mimeType || 'image/png';
  return { blob: new Blob([bytes], { type: mimeType }), mimeType, usageTokens: data.usageMetadata?.totalTokenCount };
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
  return `启用“玻璃杯 LOGO 雕刻合成”专用流程。先识别所有可见玻璃杯的杯口顶端、杯口下缘、杯身左右边界、杯肚底边和整杯底边；区分平底杯与高脚杯，高脚和底座绝不计入贴图区。以杯口下缘到杯肚底边为有效高度 H，杯身正面左右边界为宽度 W；Logo 正方形边长为 min(W,H) × ${options.scaleRatio}，顶部位置为杯口下缘 + H × ${options.topMarginRatio}，水平居中。若识别为高脚杯、葡萄酒杯、香槟杯或鸡尾酒杯，必须启用更严格规则：只允许在杯肚上半部正面合成，Logo 宽度不得超过杯肚最大宽度的 42%，Logo 中心必须位于杯肚有效高度的 32% 至 46% 区间，Logo 底边不得低于杯肚有效高度的 62%，不得触碰杯肚收窄处、杯梗或底座；宁可缩小并上移，也不得放大或下移。越过杯肚底边时先上移，仍无法容纳时等比缩小，不得拉伸 Logo。Logo 颜色为${options.logoColor === 'white' ? '白色' : '黑色'}，材质为${options.textureMode === 'laser_etch' ? '半透明磨砂、细微凹凸的玻璃内部激光蚀刻' : '实色表面油墨印刷'}。${options.applyAllCups ? '对所有可正面展示 Logo 的有效杯逐一应用；明显侧向或遮挡严重的杯不应强行贴图。' : '仅对画面层级最靠前且视觉尺寸最大的有效主体杯应用。'}保持原场景的背景、酒水、道具、构图、光线和其他内容完全不变，仅在选定杯身增加 Logo。Logo 必须随杯体曲率产生连续的水平包裹、透视压缩、折射、反射、局部明暗和边缘渐缩，并继承原图颗粒、景深和清晰度。严禁把原始 Logo 作为矩形贴纸、平面图层、水印或不透明覆盖物直接叠加；严禁出现与杯体曲率无关的笔直边缘、统一亮度、悬浮感或遮住原有高光与折射。内部分析坐标使用 ${options.outputCoordinateMode === 'relative_percent' ? '[0,1] 相对比例' : '原图像素'} 基准。若未检测到可贴图杯，不得凭空生成杯子或改动场景。`;
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
  engravingMode?: 'auto' | 'custom';
  glassEngravingEnabled?: boolean;
  woodEngravingEnabled?: boolean;
  customEngravingEnabled?: boolean;
  woodEngravingStyle?: 'auto' | 'dark-burn' | 'natural-recessed' | 'custom';
  woodEngravingColorDepth?: number;
  customWoodEngravingMethod?: string;
  customEngravingObject?: string;
  engravingMethod?: string;
  expectedText?: string;
  correctionFeedback?: string;
}): string {
  const automaticEngraving = options.engravingMode === 'auto';
  const hasEngraving = automaticEngraving || Boolean(options.glassEngravingEnabled || options.woodEngravingEnabled || options.customEngravingEnabled);
  const colorInstruction = hasEngraving
    ? '雕刻颜色必须由载体材质、局部底色、深度、烧蚀程度、光线和阴影自然形成，不得强制覆盖为不真实的纯色。'
    : options.logoColorMode === 'original'
    ? '严格保持新 Logo 原始颜色。'
    : options.logoColorMode === 'white'
      ? '将新 Logo 转换为白色，但保持图形、文字、比例和细节不变。'
      : options.logoColorMode === 'black'
        ? '将新 Logo 转换为黑色，但保持图形、文字、比例和细节不变。'
        : `将新 Logo 调整为颜色 ${options.customLogoColor || '#ffffff'}，但保持图形、文字、比例和细节不变。`;
  const referenceInstruction = options.hasOldLogo
    ? '第二张图片是旧 Logo 识别参考，第三张图片是必须用于替换的新 Logo。请在场景中寻找与旧 Logo 相同的所有标识并逐一替换。'
    : '第二张图片是必须用于替换的新 Logo。请识别场景内产品或载体上现有的品牌 Logo，并逐一替换。';
  const customObject = options.customEngravingObject?.trim() || '自定义载体';
  const customMethod = options.engravingMethod?.trim();
  const woodStyle = options.woodEngravingStyle || 'auto';
  const woodColorDepth = Math.max(0, Math.min(100, options.woodEngravingColorDepth ?? 15));
  const woodColorProfile = woodColorDepth === 0
    ? '零着色纯凹刻（最高优先级）：不得改变 Logo 区域木材的色相、饱和度、平均明度或木纹颜色；逐点沿用周围原木本色，颜色差必须近似 0%。绝对禁止深色轮廓、棕色描边、线稿、填充、烧焦、油墨、颜料、白化或发光。只在木材表面刻出极浅的真实几何凹槽，图案仅依靠凹槽内壁及边缘随场景原有光源产生的极微弱高光和自然阴影显现。'
    : woodColorDepth <= 15
      ? '近零着色纯凹刻：Logo 与周围木材的整体颜色差不得超过约 2%，禁止深色轮廓、棕色线稿、填充、烧灼或颜料；主要依靠极浅凹槽边缘的微弱高光和自然阴影显示。'
      : woodColorDepth <= 40
        ? '浅色低对比：Logo 与周围木材保持约 3%–10% 的明暗差，仍以木材本色为主，不得使用白色或黑色填充。'
        : woodColorDepth <= 70
          ? '中等同色对比：Logo 与周围木材保持约 10%–22% 的明暗差，清晰可辨但仍保留原木同色质感。'
          : '较深同色对比：Logo 与周围木材保持约 22%–38% 的明暗差，明显可见但禁止纯黑、纯白、油墨或焦黑烧灼效果。';
  const naturalRecessedInstruction = '原木同色浅雕或凹刻：颜色深浅参数为 ' + woodColorDepth + '%。' + woodColorProfile + ' 此百分比必须直接控制最终 Logo 相对当前木材底色的着色程度，不能使用固定默认色，也不能忽略或自行重置该参数。凹槽物理深度始终保持极浅且固定，颜色参数不得转化为更深的凹槽。保留 Logo 内外连续一致的真实木纹；Logo 参考图的黑色或白色仅代表图形蒙版和笔画形状，绝不能作为输出颜色。';
  const darkBurnInstruction = '深色激光烧蚀雕刻：形成深棕至炭黑色的高对比烧灼图案，文字和大面积图形内部清晰填充，边缘锐利，同时保留可见木纹与自然焦痕。最终 Logo 必须明显比周围木材更深；严禁生成白色、乳白色、浅色、玻璃磨砂色、白色油墨或发光效果，即使新 Logo 参考图本身是白色也必须忽略其颜色，只保留图形与文字形状。';
  const woodMethod = woodStyle === 'auto'
    ? '自动识别木盒底色并逐个选择工艺：若木盒为深色木材或深色涂层，使用深色激光烧蚀效果；若木盒为浅色木材或浅色涂层，使用原木同色浅雕或凹刻效果。不得把浅色木盒误用深黑烧蚀，也不得把深色木盒生成白色 Logo。浅色木盒采用以下浅雕颜色规则：' + naturalRecessedInstruction
    : woodStyle === 'dark-burn'
      ? darkBurnInstruction
      : woodStyle === 'natural-recessed'
        ? naturalRecessedInstruction
        : '自定义木盒雕刻方式：' + (options.customWoodEngravingMethod?.trim() || '根据用户描述自然雕刻并保留木材纹理') + '。';
  const engravingInstructions = [
    options.glassEngravingEnabled
      ? '若旧 Logo 位于玻璃物体上，将新 Logo 以玻璃激光磨砂雕刻方式制作。形成真实的半透明乳白或雾化蚀刻质感，保留玻璃透光、折射、曲面包裹、反射和厚度变化；必须沿玻璃杯实际曲率进行透视弯曲与两侧压缩，不得表现为平面油墨、悬浮贴纸或木材烧蚀。'
      : '',
    options.woodEngravingEnabled
      ? '若旧 Logo 位于木盒上，将新 Logo 按以下木盒工艺雕刻：' + woodMethod + ' 必须严格服从上述工艺及颜色参数，再根据木盒实际木种、纹理方向和光照做自然材质融合；不得擅自加深颜色或凹槽，不得改变木盒本身的颜色、木纹、结构和构图。'
      : '',
    options.customEngravingEnabled
      ? '若旧 Logo 位于场景中的“' + customObject + '”上，采用指定雕刻方式：' + (customMethod || '根据载体材质自然雕刻') + '。必须服从该载体的颜色、纹理、硬度、反光和凹凸特性。'
      : '',
  ].filter(Boolean);
  const effectInstruction = automaticEngraving
    ? '自动识别场景中每一个旧 Logo 当前真实采用的制作或雕刻工艺，并将新 Logo 按该位置完全相同的工艺重新制作。必须分别识别每个 Logo 的载体材质、颜色、纹理、雕刻深度、烧蚀颜色、磨砂程度、凹凸、印刷、光泽和边缘效果：木盒上的 Logo 沿用该木盒原有的深色烧蚀、原木浅雕、凹刻或其他木工工艺；玻璃上的 Logo 沿用原有的激光磨砂、透明蚀刻或其他玻璃工艺；其他载体同样沿用各自原工艺。同一张图中的不同 Logo 可以具有多种不同工艺，必须逐个识别、逐个匹配，严禁把一种工艺统一套用到所有 Logo。'
    : engravingInstructions.length
      ? engravingInstructions.join('') + '必须先识别每个旧 Logo 所在的载体类型，再分别应用匹配的玻璃、木盒或自定义物体工艺；这些工艺可在同一张场景图中同时生效。未匹配上述载体的 Logo 保持原有制作工艺。'
      : '保持原 Logo 在场景中的现有制作工艺和材质融合方式，只替换 Logo 内容。';
  const microTextInstruction = '新 Logo 必须作为完整的不可拆分图形资产进行像素级外观复制，尤其是尺寸很小的文字、字母、数字、标点、细线和负空间。严禁对 Logo 执行 OCR 后重新输入、拼写、翻译、纠错、补字、猜字、改写字体或生成相似字母；不得把任何字符替换为其他字符，不得产生乱码。必须保持参考 Logo 中每个字符的数量、顺序、大小写、字形轮廓、间距、基线、粗细和相对位置完全一致。即使小字无法语义识别，也必须把原始笔画当作图形纹理逐笔保留，而不是解释其文字含义。';
  const exactTextInstruction = options.expectedText?.trim()
    ? '【准确文字最高优先级】新 Logo 中必须准确呈现以下字符序列：〈' + options.expectedText + '〉。必须逐字符保持内容、顺序、大小写、空格、数字和标点完全一致，禁止翻译、纠错、补全或替换。'
    : '';
  const correctionInstruction = options.correctionFeedback?.trim()
    ? '【上次结果校验失败，必须修复】' + options.correctionFeedback + '。针对校验指出的字符、旧 Logo 残留、位置尺寸、曲面贴合或材质融合问题逐项修复；不得用平面覆盖来规避问题，也不得改变场景其他内容。'
    : '';
  const surfaceConformanceInstruction = '【杯体及曲面贴合强制规则】旧 Logo 可能本身没有正确贴合杯面，因此旧 Logo 只用于确定替换目标、中心位置和大致覆盖范围，严禁复制或继承旧 Logo 的平面形状、错误弧度、错误透视缩短或局部变形。若旧 Logo 位于杯子、玻璃杯、保温杯、瓶子或任何弧形载体上，必须忽略旧 Logo 的现有弯曲方式，直接从无 Logo 的杯身轮廓、杯口与杯底椭圆、侧壁收放曲线、杯身中心轴线、局部表面法线和相机视角重新估算该位置真实的圆柱形、锥形或不规则三维曲率，再把新 Logo 当作附着于该三维表面的二维纹理进行 UV 投影，投影输入必须是新 Logo 原始平面图。新 Logo 必须沿杯体真实横向曲率连续包裹，并随离开正面中心的角度增大而使左右两侧逐渐横向压缩；左右两侧的压缩量应由杯体截面半径和视角决定，而不是照抄旧 Logo。其上下边缘、文字基线、字符、图形和每条笔画必须共享同一连续曲面映射，不得保持平面矩形，也不得对不同局部单独拉伸。曲面投影只能改变新 Logo 在画面中的物理投影视形，不能改变 Logo 的字符内容、图形拓扑、笔画数量、相对布局或中心区域比例。保持旧 Logo 的中心位置和大致可见覆盖范围，但最终可见宽高、两侧收缩、旋转、透视缩短和杯体边缘遮挡必须以重新识别的杯面几何为准，不得跨出杯体轮廓。同步继承杯体上的高光、阴影、透明度、反射、折射和材质颗粒，使这些光学效果连续穿过 Logo。禁止平面贴纸感、悬浮感、正视图硬贴、左右宽度不收缩、边缘翘起、照抄错误旧弧度或与杯体真实曲率不一致。输出前沿 Logo 上、中、下三条水平带分别检查其曲率和两侧压缩是否与对应高度的杯身截面一致；若任何笔画看起来是平的、浮在杯子前方或沿用了旧 Logo 的错误弧度，必须按实际杯面重新投影后再输出。';
  const zeroColorFinalCheck = !automaticEngraving && options.woodEngravingEnabled && options.woodEngravingStyle === 'natural-recessed' && woodColorDepth === 0
    ? '【输出前最终强制验收】新 Logo 参考图中的黑色、白色及任何颜色像素只能用于确定凹槽的形状和位置，严禁复制到木盒表面。最终木盒 Logo 不得出现棕色或黑色线条、轮廓、描边、实心笔画、填充或烧灼色；Logo 笔画内部与周围木材必须是相同原木颜色并连续保留木纹。唯一可见差异只能是无着色浅凹槽的微小几何起伏及其自然光影。如果初步结果看起来像深色线稿、印刷或烧蚀，则该结果不合格，必须在输出前改为零着色同色凹刻。'
    : '';
  const stemwareInstruction = '【高脚杯专项】若载体是高脚杯、葡萄酒杯、香槟杯或鸡尾酒杯，先分割杯肚、杯梗和底座，杯梗与底座永远禁止放置 Logo。Logo 仅可位于杯肚正面上半部；其可见宽度不得超过杯肚最大可见宽度的 42%，中心应位于杯口下缘至杯肚底边有效高度的 32% 至 46%，底边不得低于该有效高度的 62%。若旧 Logo 本身过大或偏下，不得继承其错误尺寸和位置，必须将新 Logo 等比缩小并上移到上述安全区。宁可小而自然，也不得覆盖杯肚大面积、进入收窄区、靠近杯梗或底座。';
  const antiOverlayInstruction = '【禁止直接覆盖】必须先完整清除旧 Logo 的图形、文字、颜色和边缘，再按载体真实制作工艺重建新 Logo。严禁把新 Logo 原图作为矩形贴纸、平面图层、水印或不透明蒙版直接盖在原场景上；严禁保留参考图背景、方形边界、统一亮度或与载体无关的锐利边缘。新 Logo 内部必须连续继承载体原有的高光、阴影、透明度、反射、折射、纹理、颗粒、景深与遮挡，任何缺少这些变化的结果都视为不合格。';
  return `执行严格的 Logo 替换任务。第一张图片是原始场景图，${referenceInstruction}${colorInstruction}${effectInstruction}${microTextInstruction}${exactTextInstruction}${correctionInstruction}${surfaceConformanceInstruction}${stemwareInstruction}${antiOverlayInstruction}${zeroColorFinalCheck} 只允许改变旧 Logo 覆盖的区域：保持每个 Logo 原有的合理中心位置、大致覆盖范围、遮挡关系和材质融合方式；若旧 Logo 的位置、尺寸或融合本身明显错误，则必须按载体几何和上述安全区修正。角度、透视和曲面包裹必须依据载体真实几何重新计算，不能照抄可能错误的旧 Logo 形变，并用新 Logo 准确替换。若同一场景存在多个旧 Logo，必须全部替换。除 Logo 外，原图所有像素对应内容必须保持不变，包括画幅、构图、裁切、镜头、主体、产品结构、杯体、背景、人物、道具、已有非 Logo 文字、颜色、光线、阴影、反射、折射、景深、噪点和清晰度。不得移动、删除、增加、重绘或重新设计任何非 Logo 内容，不得在原本没有 Logo 的位置新增 Logo。`;
}

async function normalizedLogoReference(file: File): Promise<{ data: string; mimeType: string }> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    return { data: await fileToBase64(file), mimeType: file.type };
  }
  try {
    const bitmap = await createImageBitmap(file);
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = 820 / Math.max(1, longest);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, (1024 - width) / 2, (1024 - height) / 2, width, height);
    bitmap.close();
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Logo normalization failed')), 'image/png'));
    return { data: await fileToBase64(blob), mimeType: 'image/png' };
  } catch {
    return { data: await fileToBase64(file), mimeType: file.type };
  }
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
  const [sceneData, oldLogoData, normalizedNewLogo] = await Promise.all([
    fileToBase64(options.scene),
    options.oldLogo ? fileToBase64(options.oldLogo) : Promise.resolve(undefined),
    normalizedLogoReference(options.newLogo),
  ]);
  const parts: GeminiPart[] = [{
    text: options.promptOverride?.trim() || buildLogoReplacementInstruction({ hasOldLogo: Boolean(options.oldLogo), logoColorMode: options.logoColorMode, customLogoColor: options.customLogoColor }),
  }, { inlineData: { mimeType: options.scene.type, data: sceneData } }];
  if (oldLogoData && options.oldLogo) parts.push({ inlineData: { mimeType: options.oldLogo.type, data: oldLogoData } });
  parts.push({ inlineData: { mimeType: normalizedNewLogo.mimeType, data: normalizedNewLogo.data } });
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

export async function analyzeSceneLogoStyles(options: {
  apiKey: string;
  model: OptimizerModel;
  scene: File;
  signal?: AbortSignal;
  apiBaseUrl?: string | null;
}): Promise<{ styles: SceneLogoStyle[]; summary: string }> {
  const sceneData = await fileToBase64(options.scene);
  const data = await postGemini(options.model, options.apiKey, {
    contents: [{ role: 'user', parts: [
      { text: '分析这张场景图中所有需要替换的品牌 Logo。把视觉图形、文字排版、外轮廓或配色明显不同的 Logo 归为不同“样式”；同一样式出现在多个位置时只建立一个样式组，并统计出现次数。不要把装饰文字、产品说明、刻度或非品牌图案误判为 Logo。输出 JSON。label 使用“样式 1、样式 2”格式；description 简述可用于定位该样式的文字/图形特征；carrier 描述所在载体；occurrences 为该样式在图中的位置数量。' },
      { inlineData: { mimeType: options.scene.type, data: sceneData } },
    ] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: {
      type: 'OBJECT', properties: {
        styles: { type: 'ARRAY', items: { type: 'OBJECT', properties: { id: { type: 'STRING' }, label: { type: 'STRING' }, description: { type: 'STRING' }, occurrences: { type: 'INTEGER' }, carrier: { type: 'STRING' } }, required: ['id', 'label', 'description', 'occurrences', 'carrier'] } },
        summary: { type: 'STRING' },
      }, required: ['styles', 'summary'],
    } },
  }, options.signal, options.apiBaseUrl);
  const raw = data.candidates?.flatMap((candidate) => candidate.content?.parts ?? []).map((part) => part.text || '').join('').trim();
  if (!raw) throw new Error('场景解析模型未返回结果');
  const parsed = JSON.parse(raw) as { styles?: SceneLogoStyle[]; summary?: string };
  const styles = (parsed.styles || []).map((style, index) => ({ ...style, id: style.id || `style-${index + 1}`, occurrences: Math.max(1, Number(style.occurrences) || 1) }));
  return { styles, summary: String(parsed.summary || '') };
}

export async function generateMultiLogoReplacement(options: {
  apiKey: string;
  model: ImageModel;
  scene: File;
  logos: File[];
  styles: SceneLogoStyle[];
  instruction: string;
  aspectRatio?: string;
  imageSize: ImageSize;
  signal?: AbortSignal;
  apiBaseUrl?: string | null;
}): Promise<GeneratedImage> {
  const [sceneData, ...logoData] = await Promise.all([fileToBase64(options.scene), ...options.logos.map(fileToBase64)]);
  const mapping = options.styles.map((style, index) => `原场景${style.label}（特征：${style.description}；载体：${style.carrier}；共 ${style.occurrences} 个位置）必须全部替换为第 ${index + 2} 张图片的新 Logo`).join('；');
  const parts: GeminiPart[] = [
    { text: `执行多样式 Logo 一对一替换。第一张图是必须保持不变的原场景。后续每张图分别是不同的新 Logo，禁止混用。映射关系：${mapping}。同一样式的所有位置必须使用映射到的同一个新 Logo，不同样式必须使用各自不同的新 Logo；不得遗漏、串换或在无 Logo 处新增。必须先清除每处旧 Logo，再按该位置原有载体、曲率、透视、雕刻/印刷工艺、反射、折射、纹理、光线、景深和颗粒自然重建新 Logo，严禁平面贴图、水印或直接覆盖。除 Logo 区域外不得改变场景任何内容。${options.instruction}` },
    { inlineData: { mimeType: options.scene.type, data: sceneData } },
    ...options.logos.map((logo, index) => ({ inlineData: { mimeType: logo.type, data: logoData[index] } })),
  ];
  const data = await postGemini(options.model, options.apiKey, { contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { imageSize: options.imageSize, ...(options.aspectRatio ? { aspectRatio: options.aspectRatio } : {}) } } }, options.signal, options.apiBaseUrl);
  const imagePart = data.candidates?.flatMap((candidate) => candidate.content?.parts ?? []).find((part) => part.inlineData?.data);
  if (!imagePart?.inlineData?.data) throw new Error('模型未返回多 Logo 替换图片');
  const bytes = Uint8Array.from(atob(imagePart.inlineData.data), (char) => char.charCodeAt(0));
  const mimeType = imagePart.inlineData.mimeType || 'image/png';
  return { blob: new Blob([bytes], { type: mimeType }), mimeType, usageTokens: data.usageMetadata?.totalTokenCount };
}
export async function verifyLogoReplacement(options: {
  apiKey: string;
  model: OptimizerModel;
  referenceLogo: File;
  originalScene: File;
  generatedImage: Blob;
  expectedText?: string;
  signal?: AbortSignal;
  apiBaseUrl?: string | null;
}): Promise<LogoVerificationResult> {
  const [reference, original, generated] = await Promise.all([normalizedLogoReference(options.referenceLogo), fileToBase64(options.originalScene), fileToBase64(options.generatedImage)]);
  const expected = options.expectedText?.trim();
  const data = await postGemini(options.model, options.apiKey, {
    contents: [{ role: 'user', parts: [
      { text: `第一张图片是新 Logo 参考，第二张图片是替换前的原始场景，第三张图片是生成后的场景。执行严格的 Logo 替换验收，以下四项必须全部通过才允许 passed=true：一、新 Logo 的字符、图形和比例与参考一致；二、原 Logo 已完整移除，没有新旧 Logo 重叠或残影；三、新 Logo 真实贴合原 Logo 所在载体的曲面、透视、折射、反射、纹理、凹凸、环境光、景深和颗粒；四、新 Logo 的位置和尺寸处于原 Logo 所在载体的合理视觉区域，不能异常偏大、偏下或越出载体。${expected ? `准确文字必须逐字符等于〈${expected}〉，包括大小写、空格、数字和标点。` : '未提供准确文字，请直接比较参考 Logo 与生成 Logo 的全部可见字符、笔画、布局和图形。'}重点识别“直接覆盖”：如果新 Logo 像平面贴纸、水印或图层一样叠在场景上，具有矩形边界、统一亮度、缺少曲率变形、未继承反光/折射/纹理、遮住原有高光，或相对载体有悬浮感，必须设置 flatOverlayDetected=true、materialIntegrated=false、passed=false。对于高脚杯、葡萄酒杯、香槟杯和鸡尾酒杯，Logo 必须位于杯肚上半部，宽度不超过杯肚最大宽度约 42%，不得接近杯梗或底座；过大或偏下必须 placementConsistent=false、passed=false。任何字符错误、旧 Logo 残留、平面覆盖、材质未融合或位置尺寸异常都判定失败。differences 数组中的每一项和 summary 必须使用简体中文描述；referenceText 和 generatedText 只记录图片中实际识别到的原始字符，必须保持原文、大小写、空格和标点，不得翻译或改写。` },
      { inlineData: { mimeType: reference.mimeType, data: reference.data } },
      { inlineData: { mimeType: options.originalScene.type, data: original } },
      { inlineData: { mimeType: options.generatedImage.type || 'image/png', data: generated } },
    ] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          passed: { type: 'BOOLEAN' }, referenceText: { type: 'STRING' }, generatedText: { type: 'STRING' },
          differences: { type: 'ARRAY', items: { type: 'STRING' } }, graphicConsistent: { type: 'BOOLEAN' }, materialIntegrated: { type: 'BOOLEAN' }, placementConsistent: { type: 'BOOLEAN' }, originalLogoRemoved: { type: 'BOOLEAN' }, flatOverlayDetected: { type: 'BOOLEAN' }, summary: { type: 'STRING' },
        },
        required: ['passed', 'referenceText', 'generatedText', 'differences', 'graphicConsistent', 'materialIntegrated', 'placementConsistent', 'originalLogoRemoved', 'flatOverlayDetected', 'summary'],
      },
    },
  }, options.signal, options.apiBaseUrl);
  const raw = data.candidates?.flatMap((candidate) => candidate.content?.parts ?? []).map((part) => part.text || '').join('').trim();
  if (!raw) throw new Error('Logo 校验模型未返回结果');
  try {
    const parsed = JSON.parse(raw) as LogoVerificationResult;
    if (typeof parsed.passed !== 'boolean' || !Array.isArray(parsed.differences) || typeof parsed.graphicConsistent !== 'boolean' || typeof parsed.materialIntegrated !== 'boolean' || typeof parsed.placementConsistent !== 'boolean' || typeof parsed.originalLogoRemoved !== 'boolean' || typeof parsed.flatOverlayDetected !== 'boolean') throw new Error('invalid');
    const passed = parsed.passed && parsed.graphicConsistent && parsed.materialIntegrated && parsed.placementConsistent && parsed.originalLogoRemoved && !parsed.flatOverlayDetected;
    return { ...parsed, passed, referenceText: String(parsed.referenceText || ''), generatedText: String(parsed.generatedText || ''), differences: parsed.differences.map(String), summary: String(parsed.summary || '') };
  } catch {
    throw new Error('Logo 校验结果格式无效，请重试');
  }
}
export function buildObjectReplacementInstruction(options: {
  sourceObjectName: string;
  targetObjectName: string;
  hasSourceReference: boolean;
  hasTargetReference: boolean;
  preservation: ObjectPreservationOptions;
}): string {
  const sourceName = options.sourceObjectName.trim() || '原物体参考图所示物体';
  const targetName = options.targetObjectName.trim() || '新物体参考图所示物体';
  let imageIndex = 2;
  const ordinal = (index: number) => ['第一', '第二', '第三'][index - 1] || ('第' + index);
  const references: string[] = ['第一张图片是原始场景图，也是最终画面、构图、机位、光照、遮挡和环境的唯一基准。'];
  if (options.hasSourceReference) references.push(`${ordinal(imageIndex++)}张图片仅用于帮助识别原物体“${sourceName}”，不得复制该参考图的背景或外观到结果。`);
  if (options.hasTargetReference) references.push(`${ordinal(imageIndex)}张图片是新物体本体参考图。只提取“${targetName}”实体本身的核心身份特征，不得复制参考图中的背景、构图、相机角度、摆放姿态、阴影、反射、手、道具或附属内容。`);

  const surfaceFeatures = [
    options.preservation.print ? '杯身或物体表面的印花' : '',
    options.preservation.logo ? 'Logo' : '',
    options.preservation.engraving ? '雕刻' : '',
    ...options.preservation.custom.map((item) => item.trim()).filter(Boolean),
  ].filter(Boolean);
  const surfaceInstruction = surfaceFeatures.length
    ? `以下新物体表面特征必须从新物体参考图准确移植：${surfaceFeatures.join('、')}。旧物体上的同类印花、Logo、文字和雕刻全部属于旧物体本体，必须先完整清除，绝不能保留、复用、混合或改写成新设计。最终只能出现新物体参考图中的表面图案。必须像复制不可拆分的图形资产一样保持新图案的每个笔画、字符、大小写、空格、标点、颜色、比例及在新物体本体上的相对位置完全一致，再随场景透视和曲面自然贴合；禁止 OCR 后重新拼写、重新设计或生成相似文字。`
    : '不要强制复制新物体参考图上的印花、Logo、雕刻或装饰；只采用新物体本体的结构、轮廓、材质和基础颜色。';

  const contentRules = [
    options.preservation.liquid
      ? '酒液或其他液体已勾选：从新物体参考图保留其类型、颜色和状态，但液面透视、遮挡与光照仍必须适配原场景。'
      : '酒液或其他液体未勾选：禁止从新物体参考图复制液体；原场景有液体时必须保留原场景的液体类型、颜色、液面高度和可见状态，原场景没有时不得新增。',
    options.preservation.foam
      ? '泡沫已勾选：从新物体参考图保留泡沫特征，并适配原场景。'
      : '泡沫未勾选：禁止从新物体参考图复制泡沫；原场景有泡沫时保持原有泡沫，原场景没有时不得新增。',
  ].join('');

  const isCup = /杯|cup|tumbler|mug|goblet|glass/i.test(sourceName + ' ' + targetName);
  const uniformScaleInstruction = '【最高优先级：严格同比例缩放】新物体本体只能进行刚性变换与各轴相同倍率的统一缩放。缩放系数必须满足 Sx = Sy = Sz；投影到画面前，新物体的宽高比、长宽比、各高度截面宽度占总宽的比例、轮廓控制点相对坐标、曲率、锥度和局部厚度比例必须与新物体参考图完全一致。严禁单轴缩放、自由变换、液化、瘦身、增宽、压扁、拉长、局部收缩、局部膨胀或为了适配旧物体遮罩而变形。统一缩放倍率只能由场景中的接触平面尺度或横向占地估算，严禁用旧物体高度反推或限制该倍率。若新物体轮廓超出旧物体范围，必须扩展局部编辑区域容纳完整新物体，而不是缩短、裁切或压扁新物体。相机透视可以造成自然的视觉缩短，但不得借透视之名修改物体自身几何。输出前必须将生成物体的归一化轮廓与新物体参考图逐段比较；任何杯口、杯肚、腰线、杯底或其他轮廓比例偏差都判定为不合格，必须恢复新物体原始比例后再输出。';
  const silhouetteLockInstruction = '【不可编辑轮廓路径】把新物体参考图中的实体外轮廓转换为归一化矢量路径和截面比例表，并在施加统一缩放、旋转和相机透视之前锁定。以本体总高 H 为基准，至少记录 y/H = 0%、10%、25%、50%、75%、90%、100% 各截面的左右边界和宽度 W(y)/H；生成物体在相同标准化高度处的轮廓宽度误差不得超过参考值约 1%，相邻截面之间的曲率变化也必须一致。对于杯子，杯口外径、杯肚最大宽度、腰部最小宽度、杯底最大宽度、杯底厚度、杯底外扩角度、底脚圆角半径及它们相对 H 的比例全部是不可修改参数。严禁为了显得更稳、更自然、更美观或加强接地而放大杯底、加厚杯底、外扩底脚、收窄杯腰、放大杯肚、改变杯口宽度或平滑原有曲线；尤其禁止生成比新物体参考图更宽或更厚的杯底。材质融合、阴影、反射、折射、液体和泡沫只能覆盖在锁定轮廓之内或按物理关系环绕轮廓，绝不能推动、侵蚀或重塑轮廓。最终验收必须先去除场景透视影响，将生成轮廓逆投影回标准正视比例，再与新物体参考轮廓逐点比对；任一关键截面超过约 1% 或杯底变宽都必须重新生成，不得输出。';
  const cupInstruction = isCup
    ? '【杯子本体专项】把“杯子本体”限定为实体杯身外壳、杯口、杯底以及新杯本身不可分离的把手；只从新参考图采用这些部分的几何结构、轮廓、透明度或不透明度、材质、基础颜色，以及已勾选的杯身表面特征。杯内液体、泡沫、冰块，以及场景中的吸管、可拆卸杯盖、装饰挂件、手和手指默认都不属于新杯本体；其来源必须严格服从前述勾选规则：未勾选时沿用原场景，只有明确勾选的元素才允许从新参考图移植。所有这些元素都只按新杯口和杯身做最小限度的自然遮挡适配。保持原场景杯底接触点、杯身中心轴线、整体旋转、相机视角、手部握持点和前后遮挡顺序，但绝对不要匹配或继承旧杯的可见高度，杯子的几何外形和最终高度只能由新杯参考图决定。必须先测量并锁定新杯正面轮廓的归一化几何特征：总高与最大宽度之比、杯口宽度、杯肚最宽处、腰部最窄处、杯底宽度、各高度截面的宽度变化曲线、侧壁曲率、锥度、杯口厚度和杯底厚度。以旧物体在接触平面上的横向占地或最大宽度仅用于估算一个统一缩放倍率，然后严格按新杯原始总高与最大宽度之比计算最终高度；新杯较高时必须允许其轮廓自然向上延伸，新杯较矮时允许低于旧杯顶部，旧杯遗留区域补回原场景背景。只允许统一缩放、旋转和透视投影，严禁任何横向或纵向非等比拉伸，严禁压缩新杯高度以匹配旧杯，严禁改变腰线、曲线、锥度或杯肚宽度。'
    : '';

  return `执行“仅替换物体本体”的严格局部编辑任务。${references.join('')} 第一步，识别原始场景中所有符合“${sourceName}”的实例，全部实例都必须替换，不得遗漏，并为每个实例分离出实体本体区域；不得把其内部内容物、前景遮挡物、手部、可拆卸附件或背景算入本体区域。第二步，只以旧物体的底部接触点和中心轴线定位新物体，禁止使用旧物体可见高度约束新物体高度，用“${targetName}”的新物体本体替换；允许修改区域为旧物体轮廓与按新物体真实比例放置后的新轮廓之并集，不得用旧物体遮罩边界限制或裁切新物体宽度；新轮廓超出旧轮廓时只在必要的邻近区域恢复正确遮挡，新轮廓小于旧轮廓时必须依据周围像素自然补回原背景；新物体本体必须保持参考图或名称定义的结构、轮廓、比例、材质和基础颜色，但必须重新按照原场景的 Position、整体 Scale、Rotation、Perspective、Camera Angle、接地关系、景深和遮挡关系进行渲染，绝不能复制新物体参考图的拍摄视角和摆放方式。${surfaceInstruction}${contentRules}${uniformScaleInstruction}${silhouetteLockInstruction}${cupInstruction} 原场景是除新物体本体身份之外所有信息的最高优先级来源。人物、手部、背景、桌面、道具、文字、内容物、附件、构图、裁切、镜头、光线、颜色和清晰度必须与原场景一致。原有阴影、反射、折射和高光应尽量保留，只允许在紧贴新物体表面的狭小范围内做符合新几何形状的必要融合，禁止重做整张图的光影。不得新增、删除或移动任何非目标元素，不得改变画面布局，不得把目标参考图的环境带入结果。输出前逐项检查：变化必须仅限于旧物体轮廓、新物体真实比例轮廓及其紧邻融合边缘；若背景、手、液体、泡沫、吸管、杯盖、道具或构图发生变化，则结果不合格，必须恢复为原场景。`;
}
export async function generateObjectReplacementImage(options: {
  apiKey: string;
  model: ImageModel;
  scene: File;
  sourceReference?: File;
  targetReference?: File;
  sourceObjectName: string;
  targetObjectName: string;
  preservation: ObjectPreservationOptions;
  aspectRatio?: string;
  imageSize: ImageSize;
  signal?: AbortSignal;
  apiBaseUrl?: string | null;
}): Promise<GeneratedImage> {
  const [sceneData, sourceData, targetData] = await Promise.all([
    fileToBase64(options.scene),
    options.sourceReference ? fileToBase64(options.sourceReference) : Promise.resolve(undefined),
    options.targetReference ? fileToBase64(options.targetReference) : Promise.resolve(undefined),
  ]);
  const parts: GeminiPart[] = [{ text: buildObjectReplacementInstruction({
    sourceObjectName: options.sourceObjectName,
    targetObjectName: options.targetObjectName,
    hasSourceReference: Boolean(options.sourceReference),
    hasTargetReference: Boolean(options.targetReference),
    preservation: options.preservation,
  }) }, { inlineData: { mimeType: options.scene.type, data: sceneData } }];
  if (sourceData && options.sourceReference) parts.push({ inlineData: { mimeType: options.sourceReference.type, data: sourceData } });
  if (targetData && options.targetReference) parts.push({ inlineData: { mimeType: options.targetReference.type, data: targetData } });
  const imageConfig: { imageSize: ImageSize; aspectRatio?: string } = { imageSize: options.imageSize };
  if (options.aspectRatio) imageConfig.aspectRatio = options.aspectRatio;
  const data = await postGemini(options.model, options.apiKey, {
    contents: [{ role: 'user', parts }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig },
  }, options.signal, options.apiBaseUrl);
  const imagePart = data.candidates?.flatMap((candidate) => candidate.content?.parts ?? []).find((part) => part.inlineData?.data);
  if (!imagePart?.inlineData?.data) throw new Error('模型未返回物体替换图片，请重试或切换模型');
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

export async function generateCupResizeImage(options: {
  apiKey: string;
  model: ImageModel;
  scene: File;
  cup: File;
  compositeGuide: Blob;
  imageSize: ImageSize;
  signal?: AbortSignal;
  apiBaseUrl?: string | null;
}): Promise<GeneratedImage> {
  const [sceneData, cupData, guideData] = await Promise.all([
    fileToBase64(options.scene),
    fileToBase64(options.cup),
    fileToBase64(options.compositeGuide),
  ]);
  const data = await postGemini(options.model, options.apiKey, {
    contents: [{ role: 'user', parts: [
      { text: CUP_RESIZE_PROMPT },
      { inlineData: { mimeType: options.scene.type, data: sceneData } },
      { inlineData: { mimeType: options.cup.type, data: cupData } },
      { inlineData: { mimeType: options.compositeGuide.type || 'image/png', data: guideData } },
    ] }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { imageSize: options.imageSize } },
  }, options.signal, options.apiBaseUrl);
  const imagePart = data.candidates?.flatMap((candidate) => candidate.content?.parts ?? []).find((part) => part.inlineData?.data);
  if (!imagePart?.inlineData?.data) throw new Error('模型未返回杯子尺寸调整图片，请重试或切换模型');
  const bytes = Uint8Array.from(atob(imagePart.inlineData.data), (char) => char.charCodeAt(0));
  const mimeType = imagePart.inlineData.mimeType || 'image/png';
  return { blob: new Blob([bytes], { type: mimeType }), mimeType, usageTokens: data.usageMetadata?.totalTokenCount };
}

export async function recognizePaperTextGemini(options: { apiKey: string; model: string; image: File; signal?: AbortSignal; apiBaseUrl?: string | null }): Promise<PaperTextRegion[]> {
  const imageData = await fileToBase64(options.image);
  const data = await postGemini(options.model, options.apiKey, { contents: [{ role: 'user', parts: [
    { text: '识别完整图片中所有可见的包装花纸文字，严禁裁剪、旋转或交换坐标轴。按独立文字区域分组，严格保持原文、大小写、标点和换行。left、top、width、height 分别是文字外接矩形相对完整原图宽高的左侧、顶部、宽度、高度百分比，全部范围 0-100；left/width 只能按横向像素计算，top/height 只能按纵向像素计算。不要返回右下角坐标，不要把纯图形或不可见的猜测内容当作文字。' },
    { inlineData: { mimeType: options.image.type, data: imageData } },
  ] }], generationConfig: { responseMimeType: 'application/json', responseSchema: { type: 'OBJECT', properties: { regions: { type: 'ARRAY', items: { type: 'OBJECT', properties: { text: { type: 'STRING' }, left: { type: 'NUMBER' }, top: { type: 'NUMBER' }, width: { type: 'NUMBER' }, height: { type: 'NUMBER' } }, required: ['text', 'left', 'top', 'width', 'height'] } } }, required: ['regions'] } } }, options.signal, options.apiBaseUrl);
  const raw = data.candidates?.flatMap((candidate) => candidate.content?.parts ?? []).map((part) => part.text || '').join('').trim();
  if (!raw) throw new Error('Gemini 未返回文字识别结果');
  try { return normalizePaperTextRegions(JSON.parse(raw)); } catch { throw new Error('Gemini 文字识别结果格式无效'); }
}

export async function editPaperTextGemini(options: { apiKey: string; model: string; image: File; prompt: string; signal?: AbortSignal; apiBaseUrl?: string | null }): Promise<Blob> {
  const imageData = await fileToBase64(options.image);
  const data = await postGemini(options.model, options.apiKey, { contents: [{ role: 'user', parts: [{ text: options.prompt }, { inlineData: { mimeType: options.image.type, data: imageData } }] }], generationConfig: { responseModalities: ['IMAGE'] } }, options.signal, options.apiBaseUrl);
  const part = data.candidates?.flatMap((candidate) => candidate.content?.parts ?? []).find((item) => item.inlineData?.data);
  if (!part?.inlineData?.data) throw new Error('Gemini 未返回编辑后的图片');
  return new Blob([Uint8Array.from(atob(part.inlineData.data), (c) => c.charCodeAt(0))], { type: part.inlineData.mimeType || 'image/png' });
}

export async function verifyPaperTextGemini(options: { apiKey: string; model: string; image: Blob; regions: PaperTextRegion[]; signal?: AbortSignal; apiBaseUrl?: string | null }): Promise<PaperTextVerification> {
  const imageData = await fileToBase64(options.image);
  const targets = options.regions.filter((r) => r.text !== r.original).map((r) => `“${r.original}”→“${r.text}”`).join('\n');
  const data = await postGemini(options.model, options.apiKey, { contents: [{ role: 'user', parts: [{ text: `严格检查图片中的花纸文字修改：\n${targets}\n只有全部新文字准确、旧文字消失、非目标区域没有变化时 ok 才能为 true。reason 使用简体中文。` }, { inlineData: { mimeType: options.image.type || 'image/png', data: imageData } }] }], generationConfig: { responseMimeType: 'application/json', responseSchema: { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' }, reason: { type: 'STRING' } }, required: ['ok', 'reason'] } } }, options.signal, options.apiBaseUrl);
  const raw = data.candidates?.flatMap((candidate) => candidate.content?.parts ?? []).map((part) => part.text || '').join('').trim();
  if (!raw) throw new Error('Gemini 未返回复核结果');
  try { return JSON.parse(raw) as PaperTextVerification; } catch { throw new Error('Gemini 复核结果格式无效'); }
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
