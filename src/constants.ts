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
  individualPromptPresets: 'scene-studio.individual-prompt-presets.v1',
  logoSettings: 'scene-studio.logo-settings.v1',
  logoPresets: 'scene-studio.logo-presets.v1',
  logoReplaceSettings: 'scene-studio.logo-replace-settings.v1',
  objectReplaceSettings: 'scene-studio.object-replace-settings.v1',
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
  useGlassLogoEtchSkill: false,
  glassEtchScaleRatio: 0.7,
  glassEtchTopMarginRatio: 0.1,
  glassEtchLogoColor: 'white',
  glassEtchTextureMode: 'laser_etch',
  glassEtchApplyAllCups: true,
  glassEtchOutputCoordinateMode: 'relative_percent',
} as const;

export const DEFAULT_LOGO_REPLACE_SETTINGS = {
  imageModel: 'gemini-3.1-flash-image',
  ratioMode: 'original',
  aspectRatio: '1:1',
  imageSize: '1K',
  concurrency: 3,
  copiesPerScene: 1,
  logoColorMode: 'original',
  customLogoColor: '#ffffff',
  glassEngravingEnabled: true,
  woodEngravingEnabled: false,
  customEngravingEnabled: false,
  woodEngravingStyle: 'auto',
  woodEngravingDepth: 20,
  customWoodEngravingMethod: '',
  customEngravingObject: '',
  engravingMethod: '',
  randomAssignLogos: false,
  customizeReplacementPrompt: false,
  replacementPrompt: '',
} as const;
export const DEFAULT_OBJECT_REPLACE_SETTINGS = {
  imageModel: 'gemini-3.1-flash-image',
  ratioMode: 'original',
  aspectRatio: '1:1',
  imageSize: '1K',
  concurrency: 3,
  copiesPerScene: 1,
  sourceObjectName: '杯子',
  targetObjectName: '',
  preservation: { print: false, logo: false, engraving: false, liquid: false, foam: false, custom: [] },
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

const BUILT_IN_SCENE_PRESETS_EN: Record<string, Pick<PromptPreset, 'name' | 'content'>> = {
  'builtin-scene-christmas': {
    name: 'Western Christmas',
    content: 'The cup is exactly 22.6 cm tall, with a 7 cm top-rim diameter and a 9 cm body diameter. Establish an accurate real-world scale from these dimensions. The proportions between the cup and tables, tableware, gifts, decorations, furniture, and people must match their actual real-world sizes; never make the cup too large or too small. Strictly preserve the cup’s appearance, structure, color, material, text, and logo. Place it naturally on a warm Western family Christmas dining table with realistically sized pine branches, red berries, gingerbread, champagne-gold fairy lights, and elegantly wrapped gifts. Add a softly blurred Christmas tree and fireplace in the background. Use warm candlelight balanced with cool winter daylight, realistic commercial photography, and shallow depth of field. Keep the cup as the visual focus without changing the product or its compositional logic.',
  },
  'builtin-scene-thanksgiving': {
    name: 'Western Thanksgiving',
    content: 'The cup is exactly 22.6 cm tall, with a 7 cm top-rim diameter and a 9 cm body diameter. Establish an accurate real-world scale from these dimensions. The proportions between the cup and tables, tableware, gifts, decorations, furniture, and people must match their actual real-world sizes; never make the cup too large or too small. Strictly preserve the cup’s appearance, structure, color, material, text, and logo. Place it naturally on a Western family Thanksgiving dining table with realistically sized linen napkins, plates, pumpkins, maple leaves, candles, and a restrained amount of autumn fruit. Show a softly blurred family-dinner atmosphere in the background. Use warm golden side light, natural shadows, and premium lifestyle commercial-photography styling. Keep the scene refined and uncluttered, with the cup clearly featured at a realistic scale.',
  },
  'builtin-scene-halloween': {
    name: 'Western Halloween',
    content: 'The cup is exactly 22.6 cm tall, with a 7 cm top-rim diameter and a 9 cm body diameter. Establish an accurate real-world scale from these dimensions. The proportions between the cup and tables, tableware, gifts, decorations, furniture, and people must match their actual real-world sizes; never make the cup too large or too small. Strictly preserve the cup’s appearance, structure, color, material, text, and logo. Place it naturally on a refined Western Halloween party table with realistically sized miniature pumpkins, black candlesticks, candy, dry leaves, and subtle cobweb decorations. Use softly blurred warm-orange party lighting in the background. Create a mysterious yet premium commercial-photography atmosphere, keeping the product sharp, the lighting realistic, and every prop correctly scaled to the cup.',
  },
  'builtin-scene-valentines': {
    name: "Western Valentine's Day",
    content: 'The cup is exactly 22.6 cm tall, with a 7 cm top-rim diameter and a 9 cm body diameter. Establish an accurate real-world scale from these dimensions. The proportions between the cup and tables, tableware, gifts, decorations, furniture, and people must match their actual real-world sizes; never make the cup too large or too small. Strictly preserve the cup’s appearance, structure, color, material, text, and logo. Place it naturally on a Western Valentine’s Day table for two or a coffee table with realistically sized roses, a card, desserts, tableware, and restrained heart-shaped decorations. Use a softly blurred warm background with delicate bokeh, gentle natural pink-and-gold tones, and premium commercial composition. Avoid overcrowding and strictly preserve realistic proportions between the cup and all scene objects.',
  },
};

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

const BUILT_IN_LOGO_PRESETS_EN: Record<string, { name: string; content: string }> = {
  'builtin-glass-engraving': {
    name: 'Engraved logo on a glass',
    content: 'Strictly preserve the original scene image’s composition, framing, viewpoint, lens, subject positions, glass shape, background, lighting, shadows, colors, and every other element. Do not move, remove, replace, or regenerate anything in the scene. Only engrave the supplied logo naturally and accurately onto the glass surface. The logo’s top edge must be exactly 2 cm below the rim, and its total width must not exceed 70% of the widest part of the glass body. Strictly preserve the logo’s graphics, text, proportions, and details. The engraving must conform naturally to the glass curvature, perspective, refraction, reflections, and ambient lighting and look like a real, finely crafted engraving. If the scene contains multiple glasses, apply the same logo to every glass. Make no changes other than adding the logo naturally.',
  },
  'builtin-white-glass-laser': {
    name: 'White logo laser-engraved on a glass',
    content: 'Strictly preserve the original scene image’s composition, framing, viewpoint, lens, subject positions, glass shape, background, lighting, shadows, colors, and every other element. Do not move, remove, replace, or regenerate anything in the scene. Convert only the supplied logo to white and place it naturally on the glass through laser engraving. The logo’s top edge must be exactly 2 cm below the rim, and its total width must not exceed 70% of the widest part of the glass body. Strictly preserve the logo’s original graphics, text, proportions, and details; do not redesign it. The white laser engraving must have a realistic, delicate frosted-etch texture and conform correctly to the glass curvature, perspective, refraction, reflections, and ambient lighting. If the scene contains multiple glasses, apply the same white engraved logo to every glass. Make no changes other than adding the white logo naturally.',
  },
  'builtin-wood-box-laser': {
    name: 'Logo laser-engraved on a wooden box',
    content: 'Strictly preserve the original scene image’s composition, framing, viewpoint, lens, subject positions, wooden-box shape, background, lighting, shadows, colors, wood grain, and every other element. Do not move, remove, replace, or regenerate anything in the scene. Only laser-engrave the supplied logo naturally and accurately onto the wooden-box surface. Strictly preserve the logo’s graphics, text, proportions, and details; do not redesign it. The engraving must show realistic burned and recessed wood texture while conforming correctly to the box perspective, wood grain, material, and environmental lighting. If the scene contains multiple wooden boxes, apply the same logo to every box. Make no changes other than adding the logo naturally.',
  },
};

export function localizeBuiltInScenePresets(language: 'zh-CN' | 'en-US'): PromptPreset[] {
  if (language === 'zh-CN') return BUILT_IN_SCENE_PRESETS;
  return BUILT_IN_SCENE_PRESETS.map((preset) => ({ ...preset, ...BUILT_IN_SCENE_PRESETS_EN[preset.id] }));
}

export function localizeBuiltInLogoPresets(language: 'zh-CN' | 'en-US') {
  if (language === 'zh-CN') return BUILT_IN_LOGO_PRESETS;
  return BUILT_IN_LOGO_PRESETS.map((preset) => ({ ...preset, ...BUILT_IN_LOGO_PRESETS_EN[preset.id] }));
}

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
