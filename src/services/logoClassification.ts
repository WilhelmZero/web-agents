import type { LogoClassificationPreset, OptimizerModel } from "../types";
import { fileToBase64 } from "../utils";
import {
  startRequestConsoleEntry,
  updateRequestConsoleEntry,
} from "./requestConsole";
import { clampLogoCount } from "./autoLogoPipeline";

export interface LogoClassificationResult {
  categoryId: string;
  reason: string;
  usedFallback: boolean;
  rawLogoCount: number;
  effectiveLogoCount: number;
  logoCountTruncated: boolean;
}

export function normalizeLogoClassificationPresets(
  value: unknown,
): LogoClassificationPreset[] {
  if (!Array.isArray(value)) return [];
  const normalized = value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const preset = item as Partial<LogoClassificationPreset>;
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

export function withLogoClassificationFallback(
  presets: LogoClassificationPreset[],
  fallbackId: string,
) {
  if (!presets.some((item) => item.id === fallbackId)) return presets;
  return presets.map((item) => ({
    ...item,
    isFallback: item.id === fallbackId,
  }));
}

export function resolveLogoClassification(
  text: string,
  presets: LogoClassificationPreset[],
  analyzeLogoCount: boolean,
): LogoClassificationResult {
  const fallback = presets.find((item) => item.isFallback) || presets[0];
  if (!fallback) throw new Error("没有可用的 Logo 替换分类预设");
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
      logoCount?: unknown;
    };
    const selected = presets.find((item) => item.id === value.categoryId);
    const count = clampLogoCount(analyzeLogoCount ? value.logoCount : 1);
    return {
      categoryId: selected?.id || fallback.id,
      reason: selected
        ? typeof value.reason === "string" && value.reason.trim()
          ? value.reason.trim()
          : "AI 根据产品载体与画面内容完成分类"
        : "模型未返回有效分类，已使用兜底分类",
      usedFallback: !selected,
      rawLogoCount: count.raw,
      effectiveLogoCount: count.effective,
      logoCountTruncated: count.truncated,
    };
  } catch {
    return {
      categoryId: fallback.id,
      reason: "模型响应无法解析，已使用兜底分类",
      usedFallback: true,
      rawLogoCount: 1,
      effectiveLogoCount: 1,
      logoCountTruncated: false,
    };
  }
}

export function buildLogoClassificationPrompt(
  presets: LogoClassificationPreset[],
  analyzeLogoCount: boolean,
) {
  const categories = presets
    .map(
      (item) =>
        `- ID: ${item.id}\n  分类名: ${item.name}\n  Logo 替换提示词: ${item.prompt}`,
    )
    .join("\n");
  const fallback = presets.find((item) => item.isFallback) || presets[0];
  const countInstruction = analyzeLogoCount
    ? "同时统计需要替换的 Logo 位置总数 logoCount。只统计杯身、杯底、杯盖、木盒等核心产品载体上的明确品牌 Logo；同款 Logo 每个可见位置分别计数。不要统计背景招牌、墙面、人物服装、普通道具、装饰图案、产品说明、刻度或非品牌文字。没有目标时返回 0；如超过 16 仍返回真实数量。"
    : "logoCount 固定返回 1，不需要分析数量。";
  return `你是 Logo 替换任务分类器。查看输入场景，根据产品载体、原 Logo 的呈现方式、材质和构图，从下列用户预设中选择最适合的一项。只能返回给出的分类 ID；无法可靠判断时使用兜底分类 ID ${fallback?.id || ""}。${countInstruction}\n\n${categories}\n\n只返回 JSON，不要 Markdown：{"categoryId":"分类ID","reason":"简短中文理由","logoCount":1}`;
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

export async function classifyLogoReplacementImage(options: {
  provider: "gemini" | "openai";
  apiKey: string;
  apiBaseUrl?: string | null;
  geminiModel: OptimizerModel;
  openAiModel: string;
  image: File;
  presets: LogoClassificationPreset[];
  analyzeLogoCount: boolean;
  signal?: AbortSignal;
}) {
  const prompt = buildLogoClassificationPrompt(
    options.presets,
    options.analyzeLogoCount,
  );
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
    requestSummary: `自动 Logo 分类${options.analyzeLogoCount ? "与数量分析" : ""} · ${options.image.name}`,
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
    const result = resolveLogoClassification(
      text,
      options.presets,
      options.analyzeLogoCount,
    );
    updateRequestConsoleEntry(id, {
      status: "success",
      durationMs: Math.round(performance.now() - startedAt),
      resultSummary: `${result.categoryId} · ${result.effectiveLogoCount} 个 Logo`,
      message: result.reason,
    });
    return result;
  } catch (error) {
    updateRequestConsoleEntry(id, {
      status: options.signal?.aborted ? "stopped" : "failed",
      durationMs: Math.round(performance.now() - startedAt),
      message: error instanceof Error ? error.message : "Logo 分类失败",
    });
    throw error;
  }
}
