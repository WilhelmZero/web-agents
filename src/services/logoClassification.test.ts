import { describe, expect, it } from "vitest";
import type { LogoClassificationPreset } from "../types";
import {
  buildLogoClassificationPrompt,
  normalizeLogoClassificationPresets,
  resolveLogoClassification,
  withLogoClassificationFallback,
} from "./logoClassification";

const presets: LogoClassificationPreset[] = [
  {
    id: "glass",
    name: "玻璃杯",
    prompt: "只替换杯身 Logo。",
    isFallback: false,
    updatedAt: 1,
  },
  {
    id: "fallback",
    name: "其他",
    prompt: "替换产品上的 Logo。",
    isFallback: true,
    updatedAt: 2,
  },
];

describe("Logo classification", () => {
  it("parses category and clamps analyzed logo count to 16", () => {
    expect(
      resolveLogoClassification(
        '{"categoryId":"glass","reason":"玻璃杯","logoCount":21}',
        presets,
        true,
      ),
    ).toEqual({
      categoryId: "glass",
      reason: "玻璃杯",
      usedFallback: false,
      rawLogoCount: 21,
      effectiveLogoCount: 16,
      logoCountTruncated: true,
    });
  });

  it("forces one logo when count analysis is disabled", () => {
    expect(
      resolveLogoClassification(
        '{"categoryId":"glass","reason":"ok","logoCount":0}',
        presets,
        false,
      ).effectiveLogoCount,
    ).toBe(1);
  });

  it("falls back on invalid category or malformed response", () => {
    expect(
      resolveLogoClassification(
        '{"categoryId":"missing","logoCount":2}',
        presets,
        true,
      ).categoryId,
    ).toBe("fallback");
    expect(resolveLogoClassification("not json", presets, true)).toMatchObject({
      categoryId: "fallback",
      effectiveLogoCount: 1,
      usedFallback: true,
    });
  });

  it("normalizes one fallback and can switch it", () => {
    const normalized = normalizeLogoClassificationPresets([
      { ...presets[0], isFallback: true },
      { ...presets[1], isFallback: true },
    ]);
    expect(normalized.filter((item) => item.isFallback)).toHaveLength(1);
    expect(
      withLogoClassificationFallback(normalized, "fallback").find(
        (item) => item.isFallback,
      )?.id,
    ).toBe("fallback");
  });

  it("limits counting to product carriers in the analysis prompt", () => {
    const prompt = buildLogoClassificationPrompt(presets, true);
    expect(prompt).toContain("杯身、杯底、杯盖、木盒");
    expect(prompt).toContain("不要统计背景招牌");
  });
});
