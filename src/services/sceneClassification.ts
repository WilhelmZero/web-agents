import type { OptimizerModel, SceneClassificationPreset } from "../types";
import { fileToBase64 } from "../utils";
import {
  startRequestConsoleEntry,
  updateRequestConsoleEntry,
} from "./requestConsole";

export interface SceneClassificationResult {
  categoryId: string;
  reason: string;
  usedFallback: boolean;
}

export function normalizeSceneClassificationPresets(
  value: unknown,
): SceneClassificationPreset[] {
  if (!Array.isArray(value)) return [];
  const normalized = value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const preset = item as Partial<SceneClassificationPreset>;
    const id = typeof preset.id === "string" ? preset.id.trim() : "";
    const name = typeof preset.name === "string" ? preset.name.trim() : "";
    const prompt = typeof preset.prompt === "string" ? preset.prompt : "";
    if (!id || !name || !prompt.trim()) return [];
    return [
      {
        id,
        name,
        prompt,
        isFallback: preset.isFallback === true,
        updatedAt:
          typeof preset.updatedAt === "number" ? preset.updatedAt : Date.now(),
      },
    ];
  });
  const fallbackIndex = Math.max(
    0,
    normalized.findIndex((item) => item.isFallback),
  );
  return normalized.map((item, index) => ({
    ...item,
    isFallback: index === fallbackIndex,
  }));
}

export function withSceneClassificationFallback(
  presets: SceneClassificationPreset[],
  fallbackId: string,
) {
  if (!presets.some((item) => item.id === fallbackId)) return presets;
  return presets.map((item) => ({
    ...item,
    isFallback: item.id === fallbackId,
  }));
}

export function resolveSceneClassification(
  text: string,
  presets: SceneClassificationPreset[],
): SceneClassificationResult {
  const fallback = presets.find((item) => item.isFallback) || presets[0];
  if (!fallback) throw new Error("没有可用的分类预设");
  try {
    const cleaned = text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("missing json");
    const value = JSON.parse(match[0]) as {
      categoryId?: unknown;
      reason?: unknown;
    };
    const selected = presets.find((item) => item.id === value.categoryId);
    if (!selected)
      return {
        categoryId: fallback.id,
        reason: "模型未返回有效分类，已使用兜底分类",
        usedFallback: true,
      };
    return {
      categoryId: selected.id,
      reason:
        typeof value.reason === "string" && value.reason.trim()
          ? value.reason.trim()
          : "AI 根据画面内容完成分类",
      usedFallback: false,
    };
  } catch {
    return {
      categoryId: fallback.id,
      reason: "模型响应无法解析，已使用兜底分类",
      usedFallback: true,
    };
  }
}

export function buildSceneClassificationPrompt(
  presets: SceneClassificationPreset[],
) {
  const categories = presets
    .map(
      (item) =>
        `- ID: ${item.id}\n  分类名: ${item.name}\n  适用场景描述: ${item.prompt}`,
    )
    .join("\n");
  const fallback = presets.find((item) => item.isFallback) || presets[0];
  return `你是图片场景分类器。查看输入图片，根据主要产品、人物、动作、构图和真实使用情境，从下列分类中选择最适合的一项。只能使用给出的分类 ID；如果没有合适分类或无法可靠判断，使用兜底分类 ID ${fallback?.id || ""}。\n\n${categories}\n\n只返回 JSON，不要 Markdown：{"categoryId":"分类ID","reason":"简短中文理由"}`;
}

function outputText(data: any) {
  return (
    data?.output_text ||
    data?.output
      ?.flatMap((item: any) => item.content || [])
      .map((item: any) => item.text || "")
      .join("") ||
    ""
  );
}

export async function classifySceneImage(options: {
  provider: "gemini" | "openai";
  apiKey: string;
  apiBaseUrl?: string | null;
  geminiModel: OptimizerModel;
  openAiModel: string;
  image: File;
  presets: SceneClassificationPreset[];
  signal?: AbortSignal;
}) {
  const prompt = buildSceneClassificationPrompt(options.presets);
  const base64 = await fileToBase64(options.image);
  const model =
    options.provider === "openai" ? options.openAiModel : options.geminiModel;
  const startedAt = performance.now();
  const id = startRequestConsoleEntry({
    model,
    connection:
      options.provider === "openai"
        ? "direct"
        : options.apiBaseUrl
          ? "proxy"
          : "direct",
    requestSummary: `自动场景分类 · ${options.image.name}`,
    requestPrompt: prompt,
    inputImages: [options.image],
  });
  try {
    let text = "";
    if (options.provider === "openai") {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        signal: options.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
          model,
          input: [
            {
              role: "user",
              content: [
                { type: "input_text", text: prompt },
                {
                  type: "input_image",
                  image_url: `data:${options.image.type};base64,${base64}`,
                  detail: "high",
                },
              ],
            },
          ],
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(
          data?.error?.message || `OpenAI 请求失败（HTTP ${response.status}）`,
        );
      text = outputText(data);
    } else {
      const endpoint = options.apiBaseUrl
        ? `${options.apiBaseUrl.replace(/\/$/, "")}/models/${model}:generateContent`
        : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(options.apiKey)}`;
      const response = await fetch(endpoint, {
        method: "POST",
        signal: options.signal,
        headers: {
          "Content-Type": "application/json",
          ...(options.apiBaseUrl ? { "x-goog-api-key": options.apiKey } : {}),
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { text: prompt },
                { inlineData: { mimeType: options.image.type, data: base64 } },
              ],
            },
          ],
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(
          data?.error?.message || `Gemini 请求失败（HTTP ${response.status}）`,
        );
      text =
        data?.candidates
          ?.flatMap((item: any) => item.content?.parts || [])
          .map((item: any) => item.text || "")
          .join("") || "";
    }
    const result = resolveSceneClassification(text, options.presets);
    updateRequestConsoleEntry(id, {
      status: "success",
      durationMs: Math.round(performance.now() - startedAt),
      resultSummary: result.categoryId,
      message: result.reason,
    });
    return result;
  } catch (error) {
    updateRequestConsoleEntry(id, {
      status: options.signal?.aborted ? "stopped" : "failed",
      durationMs: Math.round(performance.now() - startedAt),
      message: error instanceof Error ? error.message : "场景分类失败",
    });
    throw error;
  }
}
