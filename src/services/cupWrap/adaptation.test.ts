import { describe, expect, it } from "vitest";
import { adaptationPrompt, framePlacement } from "./adaptation";
import { DEFAULT_CUP } from "./geometry";

describe("AI dieline canvas", () => {
  it("uses the entire frame rather than an inscribed rectangle", () => {
    expect(framePlacement(2000, 1000, 200, 100)).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 100,
    });
  });
  it("rejects mismatching aspect ratio rather than stretching subjects", () => {
    expect(() => framePlacement(1000, 1000, 200, 100)).toThrow("比例");
  });
  it("keeps correct taper direction and spacing-only constraints", () => {
    const text = adaptationPrompt(DEFAULT_CUP, "保留 Willow");
    expect(text).toContain("125.664mm");
    expect(text).toContain("106.814mm");
    expect(text).toContain("不放大、缩小");
    expect(text).toContain("背景颜色与原图保持一致");
    expect(adaptationPrompt(DEFAULT_CUP, "", true)).toContain("保留白色角色");
  });
});
