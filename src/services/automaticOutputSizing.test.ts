import { describe, expect, it } from "vitest";
import {
  automaticAspectRatio,
  automaticOpenAiSize,
  shouldRestoreOriginalDimensions,
} from "./automaticOutputSizing";

describe("automatic output sizing", () => {
  it("auto selects the nearest supported Gemini ratio", () => {
    expect(
      automaticAspectRatio({
        mode: "auto",
        sourceWidth: 1600,
        sourceHeight: 900,
        fixedRatio: "1:1",
        supportedRatios: ["1:1", "4:3", "16:9"],
      }),
    ).toBe("16:9");
  });

  it("can omit the ratio or keep a fixed ratio", () => {
    const base = {
      sourceWidth: 1000,
      sourceHeight: 700,
      fixedRatio: "4:3",
      supportedRatios: ["1:1", "4:3"],
    };
    expect(
      automaticAspectRatio({ ...base, mode: "unspecified" }),
    ).toBeUndefined();
    expect(automaticAspectRatio({ ...base, mode: "fixed" })).toBe("4:3");
  });

  it("auto selects the nearest GPT fixed size", () => {
    expect(
      automaticOpenAiSize({
        mode: "auto",
        sourceWidth: 1800,
        sourceHeight: 1200,
        fixedSize: "1024x1024",
      }),
    ).toBe("1536x1024");
    expect(
      automaticOpenAiSize({
        mode: "unspecified",
        sourceWidth: 1800,
        sourceHeight: 1200,
        fixedSize: "1024x1024",
      }),
    ).toBeUndefined();
  });

  it("only restores exact pixels in follow-original mode", () => {
    expect(shouldRestoreOriginalDimensions("original")).toBe(true);
    expect(shouldRestoreOriginalDimensions("auto")).toBe(false);
  });
});
