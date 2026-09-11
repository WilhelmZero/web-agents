import { AI_PET_LETTERS, type AiPetLetterOutputMode, type AiPetLetterPrompt } from "./types";

const DIRECT_BACKGROUND_REQUIREMENT = "输出背景模式：直接生成完整蓝色底色，底色覆盖整个画布，不保留透明通道。";
const TRANSPARENT_BACKGROUND_REQUIREMENT = "输出背景模式：背景必须完全透明并保留真实 Alpha 通道，只保留字母、萌宠和小贴纸；主体边缘干净，不得残留蓝边、白边、色块或背景阴影。";
const OUTPUT_MODE_REQUIREMENT = /\s*输出背景模式：[^。]*。/g;

const interactionPets = [
  "戴南瓜帽的白猫",
  "裹绷带的灰猫",
  "拿棒棒糖的黑猫",
  "带紫色蝙蝠翅膀的白猫",
  "穿骷髅装的黑猫",
  "戴巫师帽的橙猫",
  "披红色斗篷的白猫",
  "抱南瓜的灰猫",
  "趴在扫帚上的黑猫",
  "披紫色斗篷的黑猫",
  "顶南瓜的白猫",
  "拿木棒的灰猫",
  "橙色小猫",
] as const;

const interactionPoses = [
  "双爪自然趴在字母顶部",
  "从字母左上侧探身抱住边缘",
  "从字母右上侧靠住并伸爪搭边",
  "坐在字母底部并用一只前爪扶住字形",
] as const;

const fixedConstraints = `请把整幅图作为一张完整、连续的插画统一生成，不使用局部矩形重绘、像素回填、贴片或拼接效果，画面中不能出现矩形边界、色差、接缝或局部清晰度差异。直接趴在、抱住或贴住中央字母的萌宠可以根据新字形自然调整或换成参考图中另一只不同造型的萌宠，使爪子、身体与字形边缘产生可信互动；A–Z 各张成品应轮换不同萌宠和互动位置，避免每张都由同一只猫趴在顶部。其他外围角色保持参考图中的身份、造型、数量和大致位置。替换字母后若产生明显空白，可从参考图已有的糖果、星星、蝙蝠、月亮、爪印或蛛网中选择少量小贴纸自然填充，疏密与全图一致；不得在不空的区域额外堆叠，也不得遮挡或贴压字母、萌宠和其他主体。所有萌宠必须完整可见并保留完整肢体：角色之间不得互相遮挡、重叠、穿插或粘连，也不得被画布边缘裁切；脸部、眼睛、耳朵、爪子、身体和尾巴必须清楚完整，不能出现半只角色、重复肢体或残缺结构。字母不得压住角色的脸部、眼睛或主体躯干。保持全图统一的蓝色背景、线条粗细、色彩、光影、清晰度和扁平卡通贴纸画风。画面中不得出现目标字母以外的其他文字或字母。`;

function interactionDirection(letter: string): string {
  const index = Math.max(0, AI_PET_LETTERS.indexOf(letter.toUpperCase()));
  const pet = interactionPets[index % interactionPets.length];
  const alternatePet = interactionPets[(index + 5) % interactionPets.length];
  const pose = interactionPoses[index % interactionPoses.length];
  return `本张优先让参考图中的${pet}${pose}；若该角色与字形不适配，则改用${alternatePet}完成互动，但不要继续沿用相邻字母成品顶部的同一只萌宠。`;
}

export function defaultPromptForLetter(letter: string): string {
  const target = letter.toUpperCase();
  const action = target === "A"
    ? "重新绘制参考图中央相同的大写 A，并改善直接贴住 A 的萌宠与字母的互动关系"
    : `将参考图中央的大写 A 准确替换成大写 ${target}`;
  return `${action}。新字母必须沿用原 A 的 Apex 风格粗体字形观感、橙色渐变填充、黑色描边、视觉高度、宽度比例、中心位置和透视。${interactionDirection(target)}${fixedConstraints}\n${DIRECT_BACKGROUND_REQUIREMENT}`;
}

export function adaptPromptOutputMode(prompt: string, mode: AiPetLetterOutputMode): string {
  let base = prompt.replace(OUTPUT_MODE_REQUIREMENT, "").trim();
  if (mode === "transparent-colorize") {
    base = base.replaceAll("保持全图统一的蓝色背景、", "保持全图统一的");
  }
  return `${base}\n${mode === "transparent-colorize" ? TRANSPARENT_BACKGROUND_REQUIREMENT : DIRECT_BACKGROUND_REQUIREMENT}`;
}

export function createDefaultPrompts(): AiPetLetterPrompt[] {
  return AI_PET_LETTERS.map((letter) => {
    const value = defaultPromptForLetter(letter);
    return { letter, defaultPrompt: value, currentPrompt: value, selected: true };
  });
}

export function validateOptimizedPrompt(letter: string, prompt: string): string | null {
  const value = prompt.trim();
  if (!value) return "优化结果为空";
  const targetPattern = new RegExp(`(?:大写|字母|uppercase|letter)[\\s“\"']*${letter}[\\s”\"']*`, "i");
  if (!targetPattern.test(value)) return `优化结果没有明确保留目标字母 ${letter}`;
  const required = ["整幅", "角色", "肢体", "背景", "遮挡", "空白", "轮换"];
  if (required.some((part) => !value.includes(part))) return "优化结果丢失了整幅生成、角色完整性、互动轮换或空白填充约束";
  return null;
}

export function promptOptimizerInstruction(letter: string, prompt: string): string {
  return `优化下面用于整幅图片编辑的中文提示词。必须保留目标大写字母 ${letter}、橙色渐变、黑色描边、整幅图统一重绘、无矩形边界或拼接痕迹、角色身份与完整肢体、角色之间不得遮挡重叠或裁切、A–Z 轮换与字母互动的萌宠、明显空白处仅用少量参考图已有小贴纸填充且不得遮挡主体、背景保持一致、禁止其他文字这些约束。只返回优化后的完整提示词，不要解释。\n\n原提示词：\n${prompt}`;
}
