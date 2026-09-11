import type { AppSettings, AiProvider } from "../../types";
import { generateExactLogoReplacement } from "../gemini";
import { generateExactLogoReplacementOpenAi } from "../logoReplaceOpenAi";
import {
  chooseContrastingBackground,
  hasUsableTransparency,
} from "../backgroundRemoval";
import { restoreTransparentBackground } from "../transparentImageEdit";
import { spriteBlob } from "./render";
import type { Sprite } from "./types";
export function posePrompt(pose: "top" | "side", color: string) {
  return `制作一张可复用完整角色贴纸，只参考输入图中的角色。保持原角色配色、服装、两只眼睛、耳朵、面部特征、线条风格和道具一致。不添加文字、字母、场景、平台、投影或其他角色。${pose === "top" ? "新姿势为趴在看不见的水平边缘上，完整身体和头在上，两只前爪沿同一水平接触线垂下，后腿和尾巴自然完整。" : "新姿势为抱住身体左侧看不见的垂直边缘，完整头部和身体在右侧，两只前爪向左抓住同一条垂直接触线，两只后腿及尾巴完整。"}不要缺少、截断或增加肢体，不要改变角色身份。完整角色置于画面中并留出边距。背景为精确纯色 ${color}，没有纹理、棋盘格、阴影和渐变，该颜色仅用于程序恢复透明，不可用于角色内部。`;
}
export async function generatePose(
  a: Sprite,
  pose: "top" | "side",
  s: AppSettings,
  provider: AiProvider,
  signal: AbortSignal,
) {
  const blob = await spriteBlob(a);
  const color = await chooseContrastingBackground(blob);
  const scene = new File([blob], `${a.id}.png`, {
    type: blob.type || "image/png",
  });
  const prompt = posePrompt(pose, color);
  const result =
    provider === "openai"
      ? await generateExactLogoReplacementOpenAi({
          apiKey: s.openAiApiKey,
          model: "gpt-image-2",
          scene,
          logos: [],
          prompt,
          size: "1024x1024",
          signal,
          requestLabel: "萌宠字母贴纸 · 互动姿势",
        })
      : await generateExactLogoReplacement({
          apiKey: s.apiKey,
          model: s.imageModel,
          scene,
          logos: [],
          prompt,
          imageSize: s.imageSize,
          signal,
          apiBaseUrl: s.connectionMode === "proxy" ? s.proxyUrl : undefined,
          retry: false,
        });
  if (await hasUsableTransparency(result.blob)) return result.blob;
  return restoreTransparentBackground(result.blob, {
    r: parseInt(color.slice(1, 3), 16),
    g: parseInt(color.slice(3, 5), 16),
    b: parseInt(color.slice(5, 7), 16),
  });
}
