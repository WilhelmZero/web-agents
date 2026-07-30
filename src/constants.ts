import type {
  AppSettings,
  ImageModel,
  ModelCapability,
  PricingCatalog,
  PromptPreset,
} from './types';

export const STORAGE_KEYS = {
  settings: 'scene-studio.settings.v1',
  presets: 'scene-studio.presets.v1',
  logoSettings: 'scene-studio.logo-settings.v1',
  logoPresets: 'scene-studio.logo-presets.v1',
  inpaintSettings: 'scene-studio.inpaint-settings.v1',
  productDetailSettings: 'scene-studio.product-detail-settings.v1',
} as const;

export const DEFAULT_LOGO_SETTINGS = {
  imageModel: 'gemini-3.1-flash-image',
  optimizerModel: 'gemini-3.1-flash-lite',
  ratioMode: 'original',
  aspectRatio: '1:1',
  imageSize: '1K',
  concurrency: 3,
  copiesPerGroup: 1,
} as const;

export const DEFAULT_INPAINT_SETTINGS = {
  imageModel: 'gemini-3.1-flash-image',
  optimizerModel: 'gemini-3.1-flash-lite',
  ratioMode: 'original',
  aspectRatio: '1:1',
  imageSize: '1K',
} as const;

export const DEFAULT_PRODUCT_DETAIL_SETTINGS = {
  analyzerModel: 'gemini-3.1-flash-lite',
  imageModel: 'gemini-3.1-flash-image',
  ratioMode: 'fixed',
  aspectRatio: '3:4',
  imageSize: '1K',
  concurrency: 3,
  targetCount: 6,
} as const;

const CUP_SCALE_REQUIREMENT = '杯子真实尺寸为高 22.6cm、顶部杯口直径 7cm、杯肚直径 9cm。必须依据这些尺寸建立准确的真实物体尺度，杯子与桌面、餐具、礼物、装饰物、家具和人物等场景元素的比例必须符合现实世界的实际大小关系，严禁把杯子生成得过大或过小；严格保持杯子的外观、结构、颜色、材质、文字和 Logo 不变。';

export const BUILT_IN_SCENE_PRESETS: PromptPreset[] = [
  {
    id: 'builtin-scene-christmas',
    name: '欧美圣诞节',
    content: `${CUP_SCALE_REQUIREMENT} 将杯子自然放置在温暖的欧美家庭圣诞节餐桌上，周围有尺寸合理的松枝、红色浆果、姜饼、香槟金小灯串和包装精致的圣诞礼物，背景是一棵柔焦圣诞树与壁炉。采用温暖的室内烛光和窗外冷色冬日环境光，真实商业摄影，浅景深，杯子为视觉主体，但不改变杯子本身及其构图逻辑。`,
    builtIn: true,
    updatedAt: 0,
  },
  {
    id: 'builtin-scene-thanksgiving',
    name: '欧美感恩节',
    content: `${CUP_SCALE_REQUIREMENT} 将杯子自然放置在欧美家庭感恩节聚餐桌面，搭配符合真实尺寸的亚麻餐巾、餐盘、南瓜、枫叶、蜡烛和少量秋季果实，背景呈现柔焦的家庭聚餐氛围。使用温暖金色侧光、自然阴影和高级生活方式商业摄影质感，保持场景克制整洁，杯子清晰突出但比例真实。`,
    builtIn: true,
    updatedAt: 0,
  },
  {
    id: 'builtin-scene-halloween',
    name: '欧美万圣节',
    content: `${CUP_SCALE_REQUIREMENT} 将杯子自然放置在精致的欧美万圣节派对桌面，加入符合真实尺寸的小南瓜、黑色烛台、糖果、枯叶和低调的蜘蛛网装饰，背景为柔焦的暖橙色派对灯光。营造神秘但高级的商业摄影氛围，保持产品清晰、光影真实，所有道具与杯子的大小关系必须符合现实。`,
    builtIn: true,
    updatedAt: 0,
  },
  {
    id: 'builtin-scene-valentines',
    name: '欧美情人节',
    content: `${CUP_SCALE_REQUIREMENT} 将杯子自然放置在欧美情人节风格的双人餐桌或咖啡桌上，搭配符合真实尺寸的玫瑰花、卡片、甜点、餐具和少量心形装饰，背景使用柔焦暖光与细腻散景。采用柔和自然的粉金色调和高级商业摄影构图，不堆砌装饰，严格保持杯子与所有场景物体的真实比例。`,
    builtIn: true,
    updatedAt: 0,
  },
];

export const BUILT_IN_LOGO_PRESETS = [
  {
    id: 'builtin-glass-engraving',
    name: '玻璃杯 Logo 雕刻',
    content: '严格保持原始场景图的构图、画幅、视角、镜头、主体位置、玻璃杯造型、背景、光线、阴影、色彩和所有其他元素完全不变，不得移动、删除、替换或重新生成场景中的任何内容。只将提供的 Logo 自然、准确地雕刻在玻璃杯表面；Logo 顶部边缘距离杯口的实际垂直距离为 2cm，Logo 总宽度不得超过杯肚宽度的 70%。严格保持 Logo 的图形、文字、比例和细节，雕刻效果需要贴合玻璃杯曲面、透视、折射、反光与环境光，看起来像真实制作在杯体上的精细雕刻。除自然加入 Logo 外，不做任何其他修改。',
    builtIn: true,
    updatedAt: 0,
  },
  {
    id: 'builtin-white-glass-laser',
    name: '白色 Logo 激光雕刻玻璃杯',
    content: '严格保持原始场景图的构图、画幅、视角、镜头、主体位置、玻璃杯造型、背景、光线、阴影、色彩和所有其他元素完全不变，不得移动、删除、替换或重新生成场景中的任何内容。只把提供的 Logo 转换为白色，并通过激光雕刻自然呈现在玻璃杯表面；Logo 顶部边缘距离杯口的实际垂直距离为 2cm，Logo 总宽度不得超过杯肚宽度的 70%。严格保持 Logo 原有图形、文字、比例和细节，不得重新设计 Logo。白色激光雕刻应具有真实细腻的磨砂蚀刻质感，正确贴合杯体曲面、透视、折射、反光和环境光。除自然加入白色 Logo 外，不做任何其他修改。',
    builtIn: true,
    updatedAt: 0,
  },
  {
    id: 'builtin-wood-box-laser',
    name: '木盒 Logo 激光雕刻',
    content: '严格保持原始场景图的构图、画幅、视角、镜头、主体位置、木盒造型、背景、光线、阴影、色彩、木纹和所有其他元素完全不变，不得移动、删除、替换或重新生成场景中的任何内容。只通过激光雕刻将提供的 Logo 自然、准确地刻在木盒表面，严格保持 Logo 的图形、文字、比例和细节，不得重新设计 Logo。雕刻应呈现真实的木材烧蚀与凹刻质感，正确贴合木盒表面的透视、木纹、材质和环境光影。除自然加入 Logo 外，不做任何其他修改。',
    builtIn: true,
    updatedAt: 0,
  },
] as const;

export const DEFAULT_SETTINGS: AppSettings = {
  apiKey: '',
  connectionMode: import.meta.env.VITE_GEMINI_PROXY_URL ? 'proxy' : 'direct',
  proxyUrl: import.meta.env.VITE_GEMINI_PROXY_URL || '',
  imageModel: 'gemini-3.1-flash-image',
  optimizerModel: 'gemini-3.1-flash-lite',
  aspectRatio: '1:1',
  imageSize: '1K',
  concurrency: 3,
  combinationMode: 'cartesian',
};

const COMMON_RATIOS = ['1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];

export const MODEL_CAPABILITIES: Record<ImageModel, ModelCapability> = {
  'gemini-3.1-flash-lite-image': {
    label: 'Nano Banana 2 Lite',
    description: '速度最快、成本最低，仅支持 1K。',
    aspectRatios: COMMON_RATIOS,
    imageSizes: ['1K'],
    defaultSize: '1K',
  },
  'gemini-3.1-flash-image': {
    label: 'Nano Banana 2',
    description: '质量、速度与成本平衡，推荐用于大多数场景。',
    aspectRatios: COMMON_RATIOS,
    imageSizes: ['0.5K', '1K', '2K', '4K'],
    defaultSize: '1K',
  },
  'gemini-3-pro-image': {
    label: 'Nano Banana Pro',
    description: '复杂创意和品牌一致性表现最佳。',
    aspectRatios: COMMON_RATIOS,
    imageSizes: ['1K', '2K', '4K'],
    defaultSize: '1K',
  },
  'gemini-2.5-flash-image': {
    label: 'Nano Banana',
    description: '旧版快速模型，固定 1K 输出。',
    aspectRatios: COMMON_RATIOS.slice(0, 9),
    imageSizes: ['1K'],
    defaultSize: '1K',
  },
};

export const PRICING: PricingCatalog = {
  updatedAt: '2026-07-29',
  source: 'https://ai.google.dev/gemini-api/docs/pricing',
  models: {
    'gemini-3.1-flash-lite-image': {
      outputBySize: { '1K': 0.067 },
      inputImage: 0.0003,
    },
    'gemini-3.1-flash-image': {
      outputBySize: { '0.5K': 0.045, '1K': 0.067, '2K': 0.101, '4K': 0.151 },
      inputImage: 0.0006,
    },
    'gemini-3-pro-image': {
      outputBySize: { '1K': 0.134, '2K': 0.134, '4K': 0.24 },
      inputImage: 0.0011,
    },
    'gemini-2.5-flash-image': {
      outputBySize: { '1K': 0.039 },
      inputImage: 0.0003,
    },
  },
};
