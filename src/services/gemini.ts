import type { GeneratedImage, GlassLogoEtchOptions, ImageModel, ImageSize, ObjectPreservationOptions, OptimizerModel } from '../types';
import { fileToBase64 } from '../utils';
import { startRequestConsoleEntry, summarizeGeminiRequest, updateRequestConsoleEntry } from './requestConsole';

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
        const imageCount = data.candidates?.flatMap((candidate) => candidate.content?.parts ?? []).filter((part) => part.inlineData?.data).length ?? 0;
        updateRequestConsoleEntry(consoleId, { status: 'success', httpStatus: response.status, durationMs: Math.round(performance.now() - requestStartedAt), resultSummary: (imageCount ? imageCount + ' 张图片' : '响应成功') + (data.usageMetadata?.totalTokenCount ? ' · ' + data.usageMetadata.totalTokenCount + ' tokens' : ''), message: 'Gemini 请求完成' });
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
  engravingMode?: 'auto' | 'custom';
  glassEngravingEnabled?: boolean;
  woodEngravingEnabled?: boolean;
  customEngravingEnabled?: boolean;
  woodEngravingStyle?: 'auto' | 'dark-burn' | 'natural-recessed' | 'custom';
  woodEngravingColorDepth?: number;
  customWoodEngravingMethod?: string;
  customEngravingObject?: string;
  engravingMethod?: string;
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
      ? '若旧 Logo 位于玻璃物体上，将新 Logo 以玻璃激光磨砂雕刻方式制作。形成真实的半透明乳白或雾化蚀刻质感，保留玻璃透光、折射、曲面包裹、反射和厚度变化，不得表现为油墨印刷、贴纸或木材烧蚀。'
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
  return `执行严格的 Logo 替换任务。第一张图片是原始场景图，${referenceInstruction}${colorInstruction}${effectInstruction}${microTextInstruction} 只允许改变旧 Logo 覆盖的区域：保持每个 Logo 原有的位置、大小、角度、透视、曲面包裹、遮挡关系和材质融合方式，并用新 Logo 准确替换。若同一场景存在多个旧 Logo，必须全部替换。除 Logo 外，原图所有像素对应内容必须保持不变，包括画幅、构图、裁切、镜头、主体、产品结构、杯体、背景、人物、道具、已有非 Logo 文字、颜色、光线、阴影、反射、折射、景深、噪点和清晰度。不得移动、删除、增加、重绘或重新设计任何非 Logo 内容，不得在原本没有 Logo 的位置新增 Logo。`;
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
  const references: string[] = ['第一张图片是必须保持的原始场景图。'];
  if (options.hasSourceReference) references.push(`${ordinal(imageIndex++)}张图片是原物体识别参考图，用于识别场景中所有“${sourceName}”。`);
  if (options.hasTargetReference) references.push(`${ordinal(imageIndex)}张图片是新物体参考图，必须严格保持其身份、结构、比例和材质；酒液与泡沫是否保留仅由后续保留元素规则决定，不属于默认外观细节。`);
  const labels: Array<[keyof Omit<ObjectPreservationOptions, 'custom'>, string]> = [
    ['print', '印花'], ['logo', 'Logo'], ['engraving', '雕刻'], ['liquid', '酒液或其他液体'], ['foam', '泡沫'],
  ];
  const preserved = [
    ...labels.filter(([key]) => options.preservation[key]).map(([, label]) => label),
    ...options.preservation.custom.map((item) => item.trim()).filter(Boolean),
  ];
  const preservationInstruction = preserved.length
    ? `新物体上的以下元素必须严格保留：${preserved.join('、')}。逐项保持其图形、文字、颜色、位置、比例、清晰度、材质效果和相互关系，不得删除、改写、模糊、重新设计或替换。`
    : '';
  const flexibleContents = [
    !options.preservation.liquid ? '酒液' : '',
    !options.preservation.foam ? '泡沫' : '',
  ].filter(Boolean);
  const flexibleContentInstruction = flexibleContents.length
    ? `${flexibleContents.join('、')}未被勾选，因此不属于必须保留的元素，且此规则优先于参考图外观、保持构图和其他任何约束。允许模型根据新物体结构与当前场景自然调整其有无、数量、液面高度、形态和状态，也允许合理减少或完全移除；不得为了复刻原物体或参考图而强制保留。`
    : '';
  const isCup = /杯|cup|tumbler|mug|goblet|glass/i.test(sourceName);
  const cupInstruction = isCup
    ? '这是杯子专项替换任务。必须替换画面中每一个目标杯子，包括远处、局部遮挡、被手持或仅露出一部分的杯子。保持每个杯子的杯底接触面、杯口朝向、杯身轴线、把手方向和手部握持关系。不得改变桌面、手指、吸管、杯盖、配饰和杯子周围既有的反射、折射与阴影，只能为新杯子做必要且自然的融合。'
    : '';
  return `执行严格的场景物体批量替换。${references.join('')} 找出场景中所有符合名称“${sourceName}”或原物体参考图的同类物体，必须全部替换为“${targetName}”，不得遗漏，也不得在原本没有目标物体的位置新增物体。只允许修改每个旧物体原本占据的区域。禁止 AI 重新设计、重新绘制、重新排版、重新解释或重新生成原始场景及其任何非目标元素。将整个新物体作为一个完整整体精确放置到每个旧物体的位置，保持完全一致的 Position（位置）、Scale（整体大小）、Rotation（旋转）、Perspective（透视）、Camera Angle（相机角度）、接地关系、遮挡关系与景深。保持新物体自身的结构、比例、材质和参考图身份，不得把新物体变形成旧物体，仅允许对整体进行匹配场景所必需的空间变换。除目标物体外，画幅、构图、裁切、镜头、人物、手部、背景、道具、已有文字、光线、阴影、反射、折射、颜色、噪点和清晰度必须保持不变。${cupInstruction}${preservationInstruction}${flexibleContentInstruction}`;
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
