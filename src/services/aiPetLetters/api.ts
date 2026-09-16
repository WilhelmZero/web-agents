import { OPENAI_ROOT } from "../openAiEndpoint";
import { startRequestConsoleEntry, updateRequestConsoleEntry } from "../requestConsole";
import type { AiPetLetterModel, AiPetLetterQuality } from "./types";
import { AI_PET_LETTERS, type AiPetLetterOutputMode } from "./types";

export class AiPetLetterApiError extends Error {
  constructor(message: string, readonly status?: number, readonly retryable = false) { super(message); }
}

function decodeBase64(value: string): Blob {
  const bytes = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: "image/png" });
}

export async function editAiPetLetter(options: {
  apiKey: string;
  image: Blob;
  mask?: Blob;
  prompt: string;
  model: AiPetLetterModel;
  quality: AiPetLetterQuality;
  background?: "transparent" | "opaque";
  signal?: AbortSignal;
  attempt?: number;
  width?: number;
  height?: number;
}): Promise<Blob> {
  const width = Math.max(1, Math.round(options.width || 3840));
  const height = Math.max(1, Math.round(options.height || 2160));
  const requestId = startRequestConsoleEntry({
    model: options.model,
    connection: "direct",
    requestSummary: `AI 萌宠字母贴纸 · 整幅生成 · ${width}×${height} · PNG`,
    requestPrompt: options.prompt,
    inputImages: [options.image, ...(options.mask ? [options.mask] : [])],
  });
  const startedAt = performance.now();
  try {
    const form = new FormData();
    form.append("image", options.image, "reference.png");
    if (options.mask) form.append("mask", options.mask, "mask.png");
    form.append("prompt", options.prompt);
    form.append("model", options.model);
    form.append("quality", options.quality);
    form.append("size", `${width}x${height}`);
    form.append("output_format", "png");
    if (options.background) form.append("background", options.background);
    form.append("n", "1");
    const response = await fetch(`${OPENAI_ROOT}/images/edits`, {
      method: "POST",
      headers: { Authorization: `Bearer ${options.apiKey}` },
      body: form,
      signal: options.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const message = data?.error?.message || `图片编辑失败（HTTP ${response.status}）`;
      const quotaError = /quota|billing|insufficient/i.test(`${data?.error?.code || ""} ${data?.error?.type || ""} ${message}`);
      const retryable = (response.status === 429 && !quotaError) || response.status === 503 || response.status >= 500;
      throw new AiPetLetterApiError(message, response.status, retryable);
    }
    let blob: Blob;
    if (data?.data?.[0]?.b64_json) blob = decodeBase64(data.data[0].b64_json);
    else if (data?.data?.[0]?.url) {
      const output = await fetch(data.data[0].url, { signal: options.signal });
      if (!output.ok) throw new AiPetLetterApiError("无法下载 OpenAI 返回的图片", output.status, output.status >= 500);
      blob = await output.blob();
    } else throw new AiPetLetterApiError("OpenAI 未返回图片");
    updateRequestConsoleEntry(requestId, { status: "success", durationMs: performance.now() - startedAt, resultSummary: "返回 1 张 PNG", outputImages: [blob] });
    return blob;
  } catch (error) {
    const stopped = error instanceof DOMException && error.name === "AbortError";
    updateRequestConsoleEntry(requestId, { status: stopped ? "stopped" : "failed", durationMs: performance.now() - startedAt, message: error instanceof Error ? error.message : String(error) });
    if (error instanceof AiPetLetterApiError || stopped) throw error;
    throw new AiPetLetterApiError(error instanceof Error ? error.message : "临时网络错误", undefined, true);
  }
}

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error("参考图读取失败"));
    reader.readAsDataURL(blob);
  });
}

export async function regenerateAiPetLetterPromptsFromReference(options: {
  apiKey: string;
  image: Blob;
  outputMode: AiPetLetterOutputMode;
  width: number;
  height: number;
  signal?: AbortSignal;
}): Promise<Record<string, string>> {
  const model = "gpt-5.6-terra";
  const instruction = `分析这张最新参考图，并从零生成 A-Z 共 26 条彼此独立的中文整图编辑提示词。旧提示词和任何预设的宠物、节日、颜色、背景、字体或装饰风格一律无效，只能依据当前参考图。每条提示词必须明确目标大写字母，描述参考图实际存在的字形、材质、配色、背景、构图、主体、装饰元素及它们与字母的空间关系；将参考图中的主字母替换为目标字母，A 也要完整重绘。保持画布比例 ${options.width}:${options.height}，整幅统一生成，不做局部贴片，不出现接缝，不新增其他文字。若参考图包含人物、动物、植物或装饰，应保持其视觉身份、完整性和层级关系，不得遮挡目标字母的可读性或被画布裁切。26 张成品应保持同一系列风格，并根据不同字形自然调整装饰位置。${options.outputMode === "transparent-colorize" ? "输出只保留主体与装饰，背景必须完全透明并保留真实 Alpha。" : "背景与参考图保持一致并覆盖完整画布。"}只返回符合 schema 的 JSON。`;
  const requestId = startRequestConsoleEntry({
    model,
    connection: "direct",
    requestSummary: "根据参考图重新生成 A–Z 全部提示词",
    requestPrompt: instruction,
    inputImages: [options.image],
  });
  const startedAt = performance.now();
  try {
    const response = await fetch(`${OPENAI_ROOT}/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
      signal: options.signal,
      body: JSON.stringify({
        model,
        input: [{ role: "user", content: [
          { type: "input_text", text: instruction },
          { type: "input_image", image_url: await blobDataUrl(options.image), detail: "high" },
        ] }],
        text: { format: { type: "json_schema", name: "reference_letter_prompts", strict: true, schema: {
          type: "object",
          properties: Object.fromEntries(AI_PET_LETTERS.map((letter) => [letter, { type: "string" }])),
          required: AI_PET_LETTERS,
          additionalProperties: false,
        } } },
      }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error?.message || `提示词重建失败（HTTP ${response.status}）`);
    const text = outputText(data).trim();
    if (!text) throw new Error("分析服务没有返回提示词");
    const parsed = JSON.parse(text) as Record<string, string>;
    updateRequestConsoleEntry(requestId, { status: "success", durationMs: performance.now() - startedAt, resultSummary: "已生成 A–Z 参考图提示词" });
    return parsed;
  } catch (error) {
    updateRequestConsoleEntry(requestId, { status: "failed", durationMs: performance.now() - startedAt, message: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

function outputText(data: any): string {
  return data?.output_text || data?.output?.flatMap((item: any) => item?.content || []).find((item: any) => item?.type === "output_text")?.text || "";
}

export async function optimizeAiPetLetterPrompts(options: { apiKey: string; input: string; batch?: boolean; signal?: AbortSignal }): Promise<string> {
  const model = "gpt-5.6-terra";
  const requestId = startRequestConsoleEntry({ model, connection: "direct", requestSummary: options.batch ? "批量优化 A–Z 提示词" : "优化字母提示词", requestPrompt: options.input });
  const startedAt = performance.now();
  try {
    const response = await fetch(`${OPENAI_ROOT}/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
      signal: options.signal,
      body: JSON.stringify({ model, input: options.input, ...(options.batch ? { text: { format: { type: "json_schema", name: "letter_prompts", strict: true, schema: { type: "object", properties: Object.fromEntries("ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letter) => [letter, { type: "string" }])), required: "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""), additionalProperties: false } } } } : {}) }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error?.message || `提示词优化失败（HTTP ${response.status}）`);
    const text = outputText(data).trim();
    if (!text) throw new Error("优化服务没有返回文本");
    updateRequestConsoleEntry(requestId, { status: "success", durationMs: performance.now() - startedAt, resultSummary: "提示词已返回" });
    return text;
  } catch (error) {
    updateRequestConsoleEntry(requestId, { status: "failed", durationMs: performance.now() - startedAt, message: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
