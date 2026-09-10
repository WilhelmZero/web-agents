import { prepareOutpaint } from "./outpaint";
import {
  startRequestConsoleEntry,
  updateRequestConsoleEntry,
} from "../requestConsole";
import { buildPrompt } from "./prompts.mjs";
import {
  buildReviewPrompt,
  REVIEW_SCHEMA,
  validateReview,
} from "./quality-review.mjs";
import { AppError } from "./errors.mjs";
import { blobDataUrl, normalizeImage } from "./image";
import { processInWorker } from "./workerClient";
import type { Config, GenerateInput, ReviewInput } from "./types";

export function apiBase(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(
      "请输入完整的兼容 API 地址，例如 https://api.openai.com/v1。",
    );
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["https:", "http:"].includes(url.protocol)
  )
    throw new Error("API 地址不能包含账号、密码、查询参数或片段。");
  if (
    url.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    throw new Error("非本机 API 必须使用 HTTPS，以保护密钥。");
  return url.href.replace(/\/+$/, "");
}

async function request(
  config: Config,
  path: string,
  init: RequestInit,
  timeout: number,
  fetchImpl: typeof fetch,
) {
  if (!config.apiKey.trim())
    throw new AppError("请先在全局 API Key 设置中填写 OpenAI / GPT 密钥。");
  let response: Response;
  try {
    response = await fetchImpl(`${apiBase(config.baseUrl)}${path}`, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(timeout),
      headers: {
        ...init.headers,
        Authorization: `Bearer ${config.apiKey.trim()}`,
      },
    });
  } catch (error) {
    throw new AppError(
      error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError")
        ? "请求超时，未自动重试。服务端可能仍在处理，请检查账单后手动操作。"
        : "无法连接兼容 API：请检查地址、HTTPS、网络和服务端 CORS（需允许当前网页来源及 Authorization）。未自动重试。",
      502,
      "CONNECTION_ERROR",
    );
  }
  if (!response.ok) {
    const label: Record<number, string> = {
      401: "密钥无效",
      403: "权限不足",
      429: "额度不足或限流",
      503: "模型暂不可用",
    };
    await response.body?.cancel();
    throw new AppError(
      `API 返回 HTTP ${response.status}：${label[response.status] || "请求失败"}。未自动重试，请检查服务配置。`,
      response.status,
      "API_ERROR",
    );
  }
  return response;
}

async function boundedJson(
  response: Response,
  limit: number,
): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new AppError("API 返回内容为空。");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.length;
      if (length > limit) throw new AppError("API 返回内容过大。");
      chunks.push(next.value);
    }
    const data = new Uint8Array(length);
    let at = 0;
    chunks.forEach((c) => {
      data.set(c, at);
      at += c.length;
    });
    return JSON.parse(new TextDecoder().decode(data));
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export async function testConnection(
  config: Config,
  fetchImpl = fetch,
): Promise<number> {
  const response = await request(
    config,
    "/models",
    { method: "GET" },
    30_000,
    fetchImpl,
  );
  const json = (await boundedJson(response, 1024 * 1024)) as {
    data?: unknown[];
  };
  if (!Array.isArray(json.data))
    throw new Error("模型列表格式无效，连接尚未验证。");
  return json.data.length;
}

export function createEngravingApi(
  fetchImpl = fetch,
  normalize = processInWorker,
) {
  return {
    async generate(input: GenerateInput) {
      const { config, referenceImage } = input;
      if(input.outpaint?.enabled && (typeof input.outpaint.instructions !== "string" || input.outpaint.instructions.length>800)) throw new AppError("扩图要求最多800字。");
      const image = input.editMode ? input.image : await prepareOutpaint(input.image, input.outpaint);
      const useAnchor = input.editMode || input.outpaint?.enabled;
      const originalAnchor = input.originalImage || input.image;
      if (input.editMode && !input.originalImage) throw new AppError("持续优化缺少原照参考。");
      const prompt = buildPrompt({ ...input, editMode: !!useAnchor, hasReference: true });
      const bitmap = await createImageBitmap(image);
      const ratio = bitmap.width / bitmap.height;
      bitmap.close();
      const form = new FormData();
      Object.entries({
        model: config.imageModel,
        prompt,
        n: "1",
        size:
          ratio > 1.2 ? "1536x1024" : ratio < 0.83 ? "1024x1536" : "1024x1024",
        quality: config.quality,
        background: "transparent",
        output_format: "png",
      }).forEach(([key, value]) => form.append(key, value));
      form.append("image[]", image, input.editMode ? "candidate.png" : "original.png");
      form.append("image[]", referenceImage, "reference.png");
      if (useAnchor) form.append("image[]", originalAnchor, "identity-original.png");
      if (["gpt-image-1", "gpt-image-1.5"].includes(config.imageModel))
        form.append("input_fidelity", "high");
      const id = startRequestConsoleEntry({
        model: config.imageModel,
        connection: "direct",
        requestSummary: input.editMode ? "客户定制黑白 Logo · 持续优化（生成图 + 风格参考 + 原照）" : "客户定制黑白 Logo · 生成（原照 + 风格参考）",
        requestPrompt: prompt,
        inputImages: useAnchor ? [image, referenceImage, originalAnchor] : [image, referenceImage],
      });
      const start = Date.now();
      try {
        const response = await request(
          config,
          "/images/edits",
          { method: "POST", body: form },
          300_000,
          fetchImpl,
        );
        const json = (await boundedJson(response, 90 * 1024 * 1024)) as {
          data?: { b64_json?: string }[];
        };
        if (
          !json.data?.length ||
          json.data.some((v) => typeof v.b64_json !== "string")
        )
          throw new AppError(
            "图片编辑接口未返回 b64_json PNG 图片。请使用支持 output_format 的兼容服务。",
          );
        const blobs = json.data.map((value) => {
          const raw = atob(value.b64_json!);
          return new Blob([Uint8Array.from(raw, (c) => c.charCodeAt(0))], {
            type: "image/png",
          });
        });
        // Count actual returned images even if a later local render/save fails.
        updateRequestConsoleEntry(id, {
          status: "success",
          outputImages: blobs,
          durationMs: Date.now() - start,
        });
        const result = await normalize(blobs[0]);
        return { buffer: result.buffer, warnings: result.warnings };
      } catch (error) {
        updateRequestConsoleEntry(id, {
          status: "failed",
          message: error instanceof Error ? error.message : "生成失败",
          durationMs: Date.now() - start,
        });
        throw error;
      }
    },
    async review(input: ReviewInput) {
      const prompt = buildReviewPrompt(input.params, input.instructions, input.outpaint);
      const images = await Promise.all(
        [input.original, input.reference, input.rendered].map(async (blob) => ({
          type: "input_image",
          image_url: await blobDataUrl(
            (await normalizeImage(blob, 1536, true)).buffer,
          ),
          detail: "high",
        })),
      );
      const id = startRequestConsoleEntry({
        model: input.config.reviewModel,
        connection: "direct",
        requestSummary: "客户定制黑白 Logo · 质量审核（不计生图）",
        requestPrompt: prompt,
        inputImages: [input.original, input.rendered],
      });
      const start = Date.now();
      try {
        const response = await request(
          input.config,
          "/responses",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: input.config.reviewModel,
              store: false,
              max_output_tokens: 3000,
              input: [
                {
                  role: "user",
                  content: [{ type: "input_text", text: prompt }, ...images],
                },
              ],
              text: {
                format: {
                  type: "json_schema",
                  name: "engraving_review",
                  strict: true,
                  schema: REVIEW_SCHEMA,
                },
              },
            }),
          },
          120_000,
          fetchImpl,
        );
        const json = (await boundedJson(response, 1024 * 1024)) as {
          status?: string;
          output?: {
            type: string;
            content?: { type: string; text?: string }[];
          }[];
        };
        if (json.status !== "completed")
          throw new AppError("自动审核未完成，已保留图片且未自动重试。");
        const parts = (json.output || [])
          .filter((v) => v.type === "message")
          .flatMap((v) => v.content || []);
        if (parts.some((v) => v.type === "refusal"))
          throw new AppError("模型拒绝本次审核，已保留图片。");
        const result = validateReview(
          JSON.parse(
            parts
              .filter((v) => v.type === "output_text")
              .map((v) => v.text)
              .join(""),
          ),
        );
        updateRequestConsoleEntry(id, {
          status: "success",
          durationMs: Date.now() - start,
        });
        return result;
      } catch (error) {
        updateRequestConsoleEntry(id, {
          status: "failed",
          message: error instanceof Error ? error.message : "审核失败",
          durationMs: Date.now() - start,
        });
        throw error;
      }
    },
  };
}
