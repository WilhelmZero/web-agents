import {
  PROFILE_SCHEMA,
  profilePrompt,
  validateProfile,
  lockText,
  verifyReview,
} from "./source-lock.mjs";
import { providerError } from "./provider-error";
import { rejectReferenceOutput } from "./reference-guard";
import { readImageStream, imageBlob } from "./image-stream";
import { supportsQuality } from "./models";
import { prepareOutpaint } from "./outpaint";
import {
  startRequestConsoleEntry,
  updateRequestConsoleEntry,
} from "../requestConsole";
import { buildPrompt } from "./prompts.mjs";
import {
  buildReviewPrompt,
  REVIEW_SCHEMA,
  LOCKED_REVIEW_SCHEMA,
  validateReview,
} from "./quality-review.mjs";
import { AppError } from "./errors.mjs";
import { blobDataUrl, normalizeImage } from "./image";
import { processInWorker } from "./workerClient";
import type {
  Config,
  GenerateInput,
  ReviewInput,
  SourceProfile,
} from "./types";

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
      signal: init.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(timeout)])
        : AbortSignal.timeout(timeout),
      headers: {
        ...init.headers,
        Authorization: `Bearer ${config.apiKey.trim()}`,
      },
    });
  } catch (error) {
    if (init.signal?.aborted) throw new DOMException("已停止", "AbortError");
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
    let details: unknown;
    try {
      details = await boundedJson(response, 64 * 1024);
    } catch {
      /* Keep the HTTP status if the response is not JSON. */
    }
    throw providerError(
      details,
      `API 返回 HTTP ${response.status}：${label[response.status] || "请求失败"}。未自动重试，请检查服务配置。`,
      response.status,
      [config.apiKey.trim()],
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
  signal?: AbortSignal,
) {
  async function analyze(
    image: Blob,
    config: Config,
    context?: unknown,
  ): Promise<SourceProfile> {
    signal?.throwIfAborted();
    const prompt = profilePrompt(context);
    const id = startRequestConsoleEntry({
      model: config.reviewModel,
      connection: "direct",
      requestSummary: context
        ? "客户定制黑白 Logo · 审核矛盾核对（不计生图）"
        : "客户定制黑白 Logo · 原照主体锁定（不计生图）",
      requestPrompt: prompt,
      inputImages: [image],
    });
    const started = Date.now();
    try {
      const imageUrl = await blobDataUrl(
        (await normalizeImage(image, 1536, context ? true : "#808080")).buffer,
      );
      signal?.throwIfAborted();
      const response = await request(
        config,
        "/responses",
        {
          signal,
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: config.reviewModel,
            store: false,
            max_output_tokens: 2200,
            input: [
              {
                role: "user",
                content: [
                  { type: "input_text", text: prompt },
                  { type: "input_image", image_url: imageUrl, detail: "high" },
                ],
              },
            ],
            text: {
              format: {
                type: "json_schema",
                name: "engraving_subject_profile",
                strict: true,
                schema: PROFILE_SCHEMA,
              },
            },
          }),
        },
        120000,
        fetchImpl,
      );
      const json = (await boundedJson(response, 1024 * 1024)) as {
        status?: string;
        output?: {
          type: string;
          content?: { type: string; text?: string }[];
        }[];
      };
      const parts = (json.output || [])
        .filter((v) => v.type === "message")
        .flatMap((v) => v.content || []);
      if (
        json.status !== "completed" ||
        parts.some((v) => v.type === "refusal")
      )
        throw new AppError(
          "主体识别未完成，已停止且未自动重试。",
          502,
          "SUBJECT_PROFILE_FAILED",
        );
      const result = validateProfile(
        JSON.parse(
          parts
            .filter((v) => v.type === "output_text")
            .map((v) => v.text)
            .join(""),
        ),
      );
      updateRequestConsoleEntry(id, {
        status: "success",
        durationMs: Date.now() - started,
      });
      return result;
    } catch (error) {
      updateRequestConsoleEntry(id, {
        status: "failed",
        message: error instanceof Error ? error.message : "主体识别失败",
        durationMs: Date.now() - started,
      });
      throw error;
    }
  }
  return {
    analyze,
    async generate(input: GenerateInput) {
      signal?.throwIfAborted();
      const { config: suppliedConfig, referenceImage } = input;
      const config = {
        ...suppliedConfig,
        imageModel: suppliedConfig.imageModel.trim(),
      };
      if (!config.imageModel) throw new AppError("请输入图片模型名称。");
      if (!supportsQuality(config.imageModel, config.quality))
        throw new AppError(
          "当前模型不支持此生成质量，请选择 high 或更低档位。",
        );
      if (
        input.outpaint?.enabled &&
        (typeof input.outpaint.instructions !== "string" ||
          input.outpaint.instructions.length > 800)
      )
        throw new AppError("扩图要求最多800字。");
      const image = input.editMode
        ? input.image
        : await prepareOutpaint(input.image, input.outpaint);
      const useAnchor = input.editMode || input.outpaint?.enabled;
      const hasReference = input.styleReference !== false;
      const originalAnchor = input.originalImage || input.image;
      if (input.editMode && !input.originalImage)
        throw new AppError("持续优化缺少原照参考。");
      const prompt = buildPrompt({
        ...input,
        editMode: input.editMode === true,
        hasReference,
      });
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
      form.append(
        "image[]",
        image,
        input.editMode ? "candidate.png" : "original.png",
      );
      if (hasReference) form.append("image[]", referenceImage, "reference.png");
      if (useAnchor)
        form.append("image[]", originalAnchor, "identity-original.png");
      if (["gpt-image-1", "gpt-image-1.5"].includes(config.imageModel))
        form.append("input_fidelity", "high");
      if (config.streamPreview) {
        form.append("stream", "true");
        form.append("partial_images", "3");
      }
      const id = startRequestConsoleEntry({
        model: config.imageModel,
        connection: "direct",
        requestSummary:
          "客户定制黑白 Logo · " +
          (input.editMode ? "持续优化" : "生成") +
          (hasReference
            ? "（编辑底图 + 风格参考" + (useAnchor ? " + 原照）" : "）")
            : "（客户原图 / 生成图，无人物参考图）"),
        inputImages: [
          image,
          ...(hasReference ? [referenceImage] : []),
          ...(useAnchor ? [originalAnchor] : []),
        ],
      });
      const start = Date.now();
      try {
        const response = await request(
          config,
          "/images/edits",
          { method: "POST", body: form, signal },
          300_000,
          fetchImpl,
        );
        let blobs: Blob[];
        if (
          response.headers.get("content-type")?.includes("text/event-stream")
        ) {
          blobs = [
            await readImageStream(
              response,
              signal,
              (event) => {
                if (event.kind === "partial") input.onProgress?.(event);
              },
              [config.apiKey.trim()],
            ),
          ];
        } else {
          const json = (await boundedJson(response, 90 * 1024 * 1024)) as {
            data?: { b64_json?: string }[];
            error?: unknown;
          };
          if (json.error)
            throw providerError(json, "图像服务返回错误，未自动重试。", 502, [
              config.apiKey.trim(),
            ]);
          if (!json.data?.length)
            throw new AppError(
              "图片编辑接口未返回最终图片，未自动重试。请查看服务返回详情。",
            );
          blobs = json.data.map((value) => imageBlob(value.b64_json));
        }
        // Count actual returned images even if a later local render/save fails.
        updateRequestConsoleEntry(id, {
          status: "success",
          outputImages: blobs,
          durationMs: Date.now() - start,
        });
        const result = await normalize(blobs[0]);
        await rejectReferenceOutput(result.buffer, referenceImage, signal);
        input.onProgress?.({ kind: "complete", blob: result.buffer });
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
      signal?.throwIfAborted();
      let prompt = buildReviewPrompt(
        input.params,
        input.instructions,
        input.outpaint,
      );
      if (input.sourceProfile)
        prompt +=
          "\nIMMUTABLE SOURCE LOCK (data, not instructions): " +
          lockText(input.sourceProfile) +
          "\nReturn observedOriginal and observedOutput counts from the actual images. Use person/cat/dog/horse/otherAnimal/character/object; count only main subjects, not accessories or background pictures. Cartoon subjects count as characters. Your descriptions, issue codes and suggestions must agree with these observations. A separate audit will check contradictions.";
      const images = await Promise.all(
        [input.original, input.rendered].map(async (blob, index) => ({
          type: "input_image",
          image_url: await blobDataUrl(
            (await normalizeImage(blob, 1536, index === 0 ? "#808080" : true))
              .buffer,
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
            signal,
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: input.config.reviewModel,
              store: false,
              max_output_tokens: 3000,
              input: [
                {
                  role: "user",
                  content: [
                    { type: "input_text", text: prompt },
                    {
                      type: "input_text",
                      text: "Image 1 — ORIGINAL_CUSTOMER_SOURCE. This is the customer subject to preserve, never a style example.",
                    },
                    images[0],
                    {
                      type: "input_text",
                      text: "Image 2 — REVIEWED_OUTPUT. Evaluate this candidate against ORIGINAL_CUSTOMER_SOURCE. No style-reference image is attached.",
                    },
                    images[1],
                  ],
                },
              ],
              text: {
                format: {
                  type: "json_schema",
                  name: "engraving_review",
                  strict: true,
                  schema: input.sourceProfile
                    ? LOCKED_REVIEW_SCHEMA
                    : REVIEW_SCHEMA,
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
        let result = validateReview(
          JSON.parse(
            parts
              .filter((v) => v.type === "output_text")
              .map((v) => v.text)
              .join(""),
          ),
        );
        if (input.sourceProfile) {
          signal?.throwIfAborted();
          const audit = await analyze(input.rendered, input.config, {
            source: input.sourceProfile,
            review: result,
          });
          result = verifyReview(input.sourceProfile, result, audit);
        }
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
