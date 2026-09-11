import { OPENAI_ROOT } from "../openAiEndpoint";
import { startRequestConsoleEntry, updateRequestConsoleEntry } from "../requestConsole";
import type { AiPetLetterModel, AiPetLetterQuality } from "./types";

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
}): Promise<Blob> {
  const requestId = startRequestConsoleEntry({
    model: options.model,
    connection: "direct",
    requestSummary: "AI 萌宠字母贴纸 · 整幅生成 · 3840×2160 · PNG",
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
    form.append("size", "3840x2160");
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
