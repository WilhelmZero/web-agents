import { AI_PET_LETTERS, type AiPetLetterPrompt } from "./types";

const fixedConstraints = `只允许调整直接趴在、抱住或贴住中央字母的萌宠，让它们与字形边缘产生自然、可信的接触和互动。保持每个角色原本的身份、颜色、服装、五官、画风和完整肢体，不得缺少眼睛、耳朵、爪子或尾巴。未接触中央字母的角色、糖果、星星、蝙蝠、月亮、背景和所有外围元素必须逐像素保持原内容、原位置、原大小和原数量，不得新增、删除、移动或重绘。画面中不得出现目标字母以外的其他文字或字母。`;

export function defaultPromptForLetter(letter: string): string {
  const target = letter.toUpperCase();
  const action = target === "A"
    ? "重新绘制参考图中央相同的大写 A，并改善直接贴住 A 的萌宠与字母的互动关系"
    : `将参考图中央的大写 A 准确替换成大写 ${target}`;
  return `${action}。新字母必须沿用原 A 的 Apex 风格粗体字形观感、橙色渐变填充、黑色描边、视觉高度、宽度比例、中心位置和透视。${fixedConstraints}`;
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
  const required = ["外围", "不", "角色", "肢体", "背景"];
  if (required.some((part) => !value.includes(part))) return "优化结果丢失了外围保护或角色完整性约束";
  return null;
}

export function promptOptimizerInstruction(letter: string, prompt: string): string {
  return `优化下面用于图片局部编辑的中文提示词，使模型更稳定地只修改中央字母和直接接触字母的萌宠。必须保留目标大写字母 ${letter}、橙色渐变、黑色描边、角色身份与完整肢体、外围元素逐像素不变、禁止其他文字这几类约束。只返回优化后的完整提示词，不要解释。\n\n原提示词：\n${prompt}`;
}
