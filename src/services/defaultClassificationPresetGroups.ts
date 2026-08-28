import type {
  LogoClassificationPreset,
  LogoClassificationPresetGroup,
  SceneClassificationPreset,
  SceneClassificationPresetGroup,
} from "../types";
import {
  FOLDER_SCENE_COMMON_PROMPT,
  FOLDER_SCENE_POOLS,
  type RecommendedCupType,
} from "./sceneThemeRecommendation";

const BUILT_IN_UPDATED_AT = 0;

const LOGO_SCENE_LOCK =
  "执行严格的 Logo 替换任务。识别原始场景中产品载体上已经存在的品牌 Logo，并用提供的新 Logo 逐一替换；如提供旧 Logo 参考，只用于定位需要替换的旧标识。新 Logo 的图形、文字、字符顺序、大小写、比例、笔画和负空间必须与参考完全一致，不得重绘、翻译或改字。只允许修改旧 Logo 覆盖区域，原本没有 Logo 的位置不得新增 Logo；杯子、木盒、人物、手、背景、道具、构图、裁切、光线、颜色、遮挡和承托关系必须保持不变。先完整清除旧 Logo，再让新 Logo 真实继承载体的曲率、透视、折射、反射、纹理、颗粒、景深、光影和遮挡，禁止平面贴纸、水印、矩形底图或悬浮覆盖感。若输入多张新 Logo，按输入顺序用于对应的待替换位置。";

function logoPreset(
  id: string,
  name: string,
  detail: string,
  isFallback = false,
): LogoClassificationPreset {
  return {
    id,
    name,
    prompt: `${LOGO_SCENE_LOCK}${detail}`,
    isFallback,
    updatedAt: BUILT_IN_UPDATED_AT,
  };
}

const DEFAULT_LOGO_CATEGORIES: LogoClassificationPreset[] = [
  logoPreset(
    "default-logo-original-craft",
    "其他载体 / 沿用原工艺",
    "逐个识别旧 Logo 所在载体及其原有制作方式，沿用该位置真实的印刷、雕刻、蚀刻、凹凸、光泽、颜色和边缘效果，只替换 Logo 内容；同一张图存在不同工艺时必须分别匹配。",
    true,
  ),
  logoPreset(
    "default-logo-glass-etch",
    "玻璃杯 / 磨砂激光雕刻",
    "旧 Logo 位于玻璃杯或其他透明玻璃载体时，将新 Logo 制作为真实的半透明乳白磨砂激光蚀刻，沿杯体实际曲率连续包裹并产生正确的两侧压缩、透视、折射、反射和厚度变化。高脚杯、葡萄酒杯、香槟杯或鸡尾酒杯的 Logo 只可位于杯肚正面上半部，宽度不得超过杯肚最大可见宽度的 42%，不得进入杯梗、底座或杯肚收窄区。",
  ),
  logoPreset(
    "default-logo-beer-mug",
    "啤酒杯 / 光滑区安全替换",
    "本图主要载体为啤酒杯。若杯身上部为连续光滑区域、下部有竖纹、棱柱、浮雕、切面或凹凸花纹，先检测纹理开始线；新 Logo 必须保持参考图原始宽高比并等比收纳在旧 Logo 所在的上部光滑区域，宁可缩小并留白，也不得裁切、拉伸、向下进入纹理区。旧 Logo 靠近泡沫线或液面线时，新 Logo 必须保持相同高度关系。",
  ),
  logoPreset(
    "default-logo-dark-wood",
    "深色木盒 / 激光烧蚀",
    "旧 Logo 位于深色木盒或深色木质涂层时，使用深色激光烧蚀雕刻，形成深棕至炭黑色的真实高对比烧灼图案，文字和图形清晰、边缘锐利，同时保留木纹与自然焦痕；禁止生成白色、乳白色、玻璃磨砂色、白色油墨或发光效果。",
  ),
  logoPreset(
    "default-logo-light-wood",
    "浅色木盒 / 原木同色浅雕",
    "旧 Logo 位于浅色木盒或浅色木质涂层时，使用原木同色的极浅凹刻。Logo 与周围木材保持近零色差，连续保留真实木纹，主要依靠凹槽边缘随原场景光源产生的微弱高光和自然阴影显现；禁止深色轮廓、棕色线稿、填充、烧焦、油墨、颜料、白化或发光。",
  ),
  logoPreset(
    "default-logo-custom-material",
    "其他雕刻载体 / 材质自适应",
    "旧 Logo 位于金属、陶瓷、石材、皮革或其他非玻璃、非木盒载体时，先识别该载体的颜色、纹理、硬度、反光、凹凸和旧 Logo 的真实制作方式，再以相同工艺替换；不得把玻璃磨砂或木材烧蚀效果错误套用到其他材质。",
  ),
];

const SCENE_CUP_TYPES: Exclude<RecommendedCupType, "其他">[] = [
  "小烈酒杯",
  "无柄蛋杯",
  "可乐罐杯",
  "啤酒杯",
  "威士忌杯",
];

function scenePreset(
  cupType: Exclude<RecommendedCupType, "其他">,
): SceneClassificationPreset {
  const candidates = FOLDER_SCENE_POOLS[cupType]
    .map((theme) => theme.replace(/^替换为/, "").replace(/主题$/, ""))
    .join("、");
  return {
    id: `default-scene-${SCENE_CUP_TYPES.indexOf(cupType) + 1}`,
    name: cupType,
    prompt: `将背景替换为${candidates}中与原图地点和氛围差异明显、且最符合${cupType}真实用途的一种欧美日常生活场景。${FOLDER_SCENE_COMMON_PROMPT}`,
    isFallback: false,
    updatedAt: BUILT_IN_UPDATED_AT,
  };
}

const DEFAULT_SCENE_CATEGORIES: SceneClassificationPreset[] = [
  ...SCENE_CUP_TYPES.map(scenePreset),
  {
    id: "default-scene-other",
    name: "其他杯型 / 按真实用途",
    prompt: `根据主要杯型或饮具的真实用途，将背景替换为与原图地点和氛围差异明显、自然可信且不过度节庆化的欧美日常生活场景。${FOLDER_SCENE_COMMON_PROMPT}`,
    isFallback: true,
    updatedAt: BUILT_IN_UPDATED_AT,
  },
];

export function createDefaultLogoClassificationPresetGroup(): LogoClassificationPresetGroup {
  return {
    id: "builtin-multitab-logo-mapping",
    name: "多标签 Logo 替换默认预设",
    categories: DEFAULT_LOGO_CATEGORIES.map((category) => ({ ...category })),
    updatedAt: BUILT_IN_UPDATED_AT,
  };
}

export function createDefaultSceneClassificationPresetGroup(): SceneClassificationPresetGroup {
  return {
    id: "builtin-multitab-scene-mapping",
    name: "多标签场景替换默认预设",
    categories: DEFAULT_SCENE_CATEGORIES.map((category) => ({ ...category })),
    updatedAt: BUILT_IN_UPDATED_AT,
  };
}
