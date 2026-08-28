import { describe, expect, it } from "vitest";
import type { SceneClassificationPreset } from "../types";
import {
  buildSceneClassificationPrompt,
  normalizeSceneClassificationPresets,
  resolveSceneClassification,
  withSceneClassificationFallback,
} from "./sceneClassification";

const presets: SceneClassificationPreset[] = [
  {
    id: "bar",
    name: "酒吧",
    prompt: "替换为酒吧",
    isFallback: false,
    updatedAt: 1,
  },
  {
    id: "home",
    name: "家居",
    prompt: "替换为家居",
    isFallback: true,
    updatedAt: 1,
  },
];

describe("scene classification", () => {
  it("解析有效分类并保留理由", () => {
    expect(
      resolveSceneClassification(
        '{"categoryId":"bar","reason":"吧台饮酒场景"}',
        presets,
      ),
    ).toEqual({
      categoryId: "bar",
      reason: "吧台饮酒场景",
      usedFallback: false,
    });
  });

  it("无效分类和损坏响应使用兜底分类", () => {
    expect(
      resolveSceneClassification('{"categoryId":"missing"}', presets)
        .categoryId,
    ).toBe("home");
    expect(resolveSceneClassification("not-json", presets)).toMatchObject({
      categoryId: "home",
      usedFallback: true,
    });
  });

  it("归一化时只保留一个兜底且首个分类自动兜底", () => {
    const normalized = normalizeSceneClassificationPresets([
      { ...presets[0], isFallback: false },
      { ...presets[1], isFallback: false },
    ]);
    expect(normalized.map((item) => item.isFallback)).toEqual([true, false]);
    expect(
      withSceneClassificationFallback(normalized, "home").map(
        (item) => item.isFallback,
      ),
    ).toEqual([false, true]);
  });

  it("分类提示包含稳定 ID、名称、提示词和兜底 ID", () => {
    const prompt = buildSceneClassificationPrompt(presets);
    expect(prompt).toContain("ID: bar");
    expect(prompt).toContain("分类名: 酒吧");
    expect(prompt).toContain("适用场景描述: 替换为家居");
    expect(prompt).toContain("兜底分类 ID home");
  });
});
