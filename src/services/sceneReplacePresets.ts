export interface SceneReplacePreset {
  id: string;
  icon: string;
  name: string;
  content: string;
  builtIn?: boolean;
}

export const SCENE_PRESET_EMOJIS = ['🎄', '✨', '💝', '🎃', '🍂', '🌷', '🏖️', '🍁', '❄️', '☕', '📷', '🏨', '🏢', '🌃', '🍳', '🏕️'];

export function sceneThemePrompt(theme: string): string {
  return `改为${theme}主题，严格要求杯子及人物动作、特别是人物手势不变，穿搭及背景氛围可改变，真实的景深效果`;
}

const BUILT_IN_THEMES = [
  ['christmas', '🎄', '温馨圣诞'], ['new-year', '✨', '新年派对'], ['valentine', '💝', '情人节'], ['halloween', '🎃', '万圣节'],
  ['thanksgiving', '🍂', '感恩节'], ['spring', '🌷', '春日花园'], ['summer', '🏖️', '海滨夏日'], ['autumn', '🍁', '秋日木屋'],
  ['winter', '❄️', '冬日雪景'], ['cafe', '☕', '巴黎咖啡馆'], ['studio', '📷', '极简摄影棚'], ['hotel', '🏨', '精品酒店'],
  ['office', '🏢', '现代办公'], ['night', '🌃', '都市夜景'], ['kitchen', '🍳', '明亮厨房'], ['camping', '🏕️', '户外露营'],
] as const;

export const BUILT_IN_SCENE_REPLACE_PRESETS: SceneReplacePreset[] = BUILT_IN_THEMES.map(([id, icon, name]) => ({
  id, icon, name, content: sceneThemePrompt(name), builtIn: true,
}));

export function normalizeCustomScenePresets(value: unknown): SceneReplacePreset[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const preset = item as Partial<SceneReplacePreset>;
    if (typeof preset.id !== 'string' || typeof preset.name !== 'string' || typeof preset.icon !== 'string' || typeof preset.content !== 'string') return [];
    if (!preset.name.trim() || !preset.icon.trim() || !preset.content.trim()) return [];
    return [{ id: preset.id, name: preset.name.trim(), icon: preset.icon.trim(), content: preset.content.trim() }];
  });
}
