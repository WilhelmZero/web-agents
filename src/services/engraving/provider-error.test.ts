import { it, expect } from "vitest";
import { providerError } from "./provider-error";
it("retains nested and top-level error details without suggesting streaming for unrelated failures", () => {
  for (const payload of [
    { error: { message: "Quota exceeded", code: "insufficient_quota" } },
    { type: "error", message: "Model unavailable", code: "model_not_found" },
  ]) {
    const error = providerError(payload, "失败，未自动重试。");
    expect(error.message).toContain("code=");
    expect(error.message).not.toContain("关闭生成过程预览");
  }
});
it("suggests disabling streaming only when the provider explicitly rejects those parameters", () => {
  expect(
    providerError(
      {
        error: {
          message: "Unknown parameter: partial_images",
          param: "partial_images",
          code: "unknown_parameter",
        },
      },
      "失败",
    ).message,
  ).toContain("关闭生成过程预览");
  expect(
    providerError(
      { error: { message: "unsupported model", param: "model" } },
      "失败",
    ).message,
  ).not.toContain("关闭生成过程预览");
});
it("redacts keys and bounds provider-controlled text", () => {
  const error = providerError(
    {
      error: {
        message: "secret-value Bearer abc sk-test123 " + "x".repeat(10000),
      },
    },
    "失败",
    502,
    ["secret-value"],
  );
  expect(error.message).not.toContain("secret-value");
  expect(error.message).not.toContain("abc");
  expect(error.message).not.toContain("sk-test123");
  expect(error.message.length).toBeLessThan(750);
});
