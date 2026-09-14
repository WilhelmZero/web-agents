import { AppError } from "./errors.mjs";

export interface ImageProgress {
  kind: "partial" | "complete";
  blob: Blob;
  index?: number;
}
export function imageBlob(value: unknown): Blob {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > 90 * 1024 * 1024
  )
    throw new AppError("图像服务返回了无效图片数据。");
  try {
    const raw = atob(value);
    return new Blob([Uint8Array.from(raw, (c) => c.charCodeAt(0))], {
      type: "image/png",
    });
  } catch {
    throw new AppError("图像服务返回的图片编码无效。");
  }
}
export async function readImageStream(
  response: Response,
  signal?: AbortSignal,
  progress?: (event: ImageProgress) => void,
): Promise<Blob> {
  const reader = response.body?.getReader();
  if (!reader) throw new AppError("图像服务返回空响应。");
  const decoder = new TextDecoder();
  let buffer = "",
    final: Blob | undefined,
    lastIndex = -1,
    total = 0;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  function event(block: string) {
    const data = block
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") return;
    let value: any;
    try {
      value = JSON.parse(data);
    } catch {
      throw new AppError("图像流事件格式无效，未自动重试。");
    }
    if (!value || typeof value !== "object")
      throw new AppError("图像流事件格式无效，未自动重试。");
    if (value.type === "error" || value.error)
      throw new AppError("图像服务在生成过程中返回错误，未自动重试。");
    if (value.type === "image_edit.partial_image" && !final) {
      const index = value.partial_image_index;
      if (!Number.isInteger(index) || index < 0 || index <= lastIndex) return;
      lastIndex = index;
      progress?.({ kind: "partial", index, blob: imageBlob(value.b64_json) });
    }
    if (value.type === "image_edit.completed" && !final) {
      final = imageBlob(value.b64_json);
      progress?.({ kind: "complete", blob: final });
    }
  }
  try {
    signal?.throwIfAborted();
    for (;;) {
      const part = await reader.read();
      signal?.throwIfAborted();
      if (part.done) {
        buffer += decoder.decode();
        break;
      }
      total += part.value.length;
      if (total > 360 * 1024 * 1024) throw new AppError("图像流返回内容过大。");
      buffer = (
        buffer + decoder.decode(part.value, { stream: true })
      ).replaceAll("\r\n", "\n");
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        event(block);
      }
      if (buffer.length > 90 * 1024 * 1024)
        throw new AppError("图像流事件过大。");
      if (final) break;
    }
    if (buffer.trim() && !final) event(buffer);
    if (!final)
      throw new AppError(
        "图像流已中断，未收到最终图片。中间预览不算生成成功；未自动重试。",
      );
    return final;
  } finally {
    signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
