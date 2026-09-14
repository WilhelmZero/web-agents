import { AppError } from "./errors.mjs";

/** Display provider diagnostics as bounded text, with credentials removed. */
export function providerError(
  payload: unknown,
  fallback: string,
  status = 502,
  secrets: string[] = [],
) {
  const root =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const detail =
    root.error && typeof root.error === "object"
      ? (root.error as Record<string, unknown>)
      : root;
  const clean = (value: unknown) => {
    let text = typeof value === "string" ? value : "";
    for (const secret of secrets)
      if (secret) text = text.split(secret).join("[已隐藏]");
    return text
      .replace(/Bearer\s+[^\s,;"']+/gi, "Bearer [已隐藏]")
      .replace(/sk-[a-z0-9_-]+/gi, "[已隐藏]")
      .replace(/[\x00-\x1f\x7f]/g, " ")
      .slice(0, 600);
  };
  const message = clean(
    detail.message || (typeof root.error === "string" ? root.error : ""),
  );
  const code = clean(detail.code).slice(0, 100),
    param = clean(detail.param).slice(0, 100);
  const fields = [
    message,
    code ? "code=" + code : "",
    param ? "param=" + param : "",
  ].filter(Boolean);
  const streamRejected =
    /(?:stream|partial_images)/i.test(param || message) &&
    /unsupported|not supported|unknown|unrecognized|not allowed|invalid|不支持|不允许/i.test(
      message + " " + code,
    );
  return new AppError(
    fallback +
      (fields.length
        ? " 服务详情：" + fields.join("；")
        : " 服务未提供具体原因。") +
      (streamRejected
        ? " 服务明确提示流式参数不兼容，请关闭生成过程预览后手动重试。"
        : ""),
    status,
    code || "PROVIDER_ERROR",
  );
}
