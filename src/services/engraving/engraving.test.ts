import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULTS,
  dither,
  enhance,
  outputDimensions,
  preparePixels,
  validateOptions,
} from "./processing.mjs";
import { runAutoTune, validateAutoOptions } from "./auto-tune.mjs";
import { buildPrompt } from "./prompts.mjs";
import { validateReview } from "./quality-review.mjs";
import { encodedDimensions, withPngDpi } from "./image";
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  restoreTask,
  savePreferences,
} from "./storage";
import type { AutoDependencies, Review, RenderParams, AutoRun } from "./types";
import { readCreationTool } from "../creationToolUrl";

function pixels(
  width: number,
  height: number,
  pixel: (x: number, y: number) => number[],
) {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) out.set(pixel(x, y), (y * width + x) * 4);
  return out;
}
function expand(source: Uint8Array) {
  const out = new Uint8Array(source.length * 2);
  for (let i = 0; i < source.length / 2; i++) {
    out.fill(source[i * 2], i * 4, i * 4 + 3);
    out[i * 4 + 3] = source[i * 2 + 1];
  }
  return out;
}
const neutral = { ...DEFAULTS, texture: 0, shadow: 0, blackPoint: 0 };
describe("engraving browser pixel engine", () => {
  it("keeps exact black, transparent gaps and erased pixels locked in both modes and inversion", async () => {
    const input = pixels(16, 16, (x, y) =>
      x < 2 || y < 2
        ? [240, 240, 240, 0]
        : x === 8
          ? [0, 0, 0, 255]
          : [40 + x * 5, 40 + x * 5, 40 + x * 5, 255],
    );
    const mask = pixels(16, 16, (x) =>
      x === 6 ? [255, 255, 255, 255] : [0, 0, 0, 255],
    );
    const source = preparePixels(input, 16, 16, DEFAULTS, mask);
    for (const invert of [false, true]) {
      const result = await enhance(expand(source.grayAlpha), 16, 16, {
        ...DEFAULTS,
        invert,
        texture: 100,
        shadow: 100,
      });
      const binary = dither(result.gray, result.coverage, 16, 16);
      for (let y = 0; y < 16; y++)
        for (let x = 0; x < 16; x++)
          if (x < 2 || y < 2 || x === 6 || x === 8) {
            expect(result.gray[y * 16 + x]).toBe(0);
            expect(binary[y * 16 + x]).toBe(0);
          }
      expect([...new Set(binary)].every((x) => x === 0 || x === 255)).toBe(
        true,
      );
    }
  });
  it("cleans connected near-black background but protects enclosed dark details and alpha-defined hair", () => {
    const input = pixels(16, 16, (x, y) =>
      x < 2 || y < 2
        ? [7, 7, 7, 255]
        : x === 8 && y === 8
          ? [8, 8, 8, 255]
          : [60, 60, 60, 255],
    );
    const prepared = preparePixels(input, 16, 16, DEFAULTS);
    expect(prepared.grayAlpha[1]).toBe(0);
    expect(prepared.grayAlpha[(8 * 16 + 8) * 2 + 1]).toBe(255);
    input[3] = 0;
    const cutout = preparePixels(input, 16, 16, DEFAULTS);
    expect(cutout.grayAlpha[5]).toBe(255);
  });
  it("lifts existing dark hair ridges without filling untextured hair or lighting alpha edges", async () => {
    const rgba = pixels(150, 150, (x, y) =>
      x < 20 || x >= 130 || y < 20 || y >= 130
        ? [0, 0, 0, 0]
        : [
            y < 90 ? (x % 4 < 2 ? 18 : 32) : 24,
            y < 90 ? (x % 4 < 2 ? 18 : 32) : 24,
            y < 90 ? (x % 4 < 2 ? 18 : 32) : 24,
            255,
          ],
    );
    const off = await enhance(rgba, 150, 150, { ...neutral, texture: 65 });
    const on = await enhance(rgba, 150, 150, {
      ...neutral,
      texture: 65,
      shadow: 65,
    });
    expect(on.gray[60 * 150 + 75]).toBeGreaterThan(
      off.gray[60 * 150 + 75] + 20,
    );
    expect(on.gray[110 * 150 + 75]).toBeLessThan(40);
    expect(
      Math.abs(on.gray[110 * 150 + 20] - on.gray[110 * 150 + 75]),
    ).toBeLessThanOrEqual(2);
  });
  it("exports 80 mm at 300 DPI as 945 px and bounds extreme output", () => {
    expect(outputDimensions(1000, 1000, DEFAULTS).width).toBe(945);
    expect(() =>
      outputDimensions(100, 2000, { ...DEFAULTS, widthMm: 300, dpi: 1200 }),
    ).toThrow(/过大/);
    expect(() => validateOptions({ ...DEFAULTS, brightness: NaN })).toThrow();
    expect(() =>
      validateOptions({ ...DEFAULTS, widthMm: 10, margin: 5 }),
    ).toThrow();
    const size = outputDimensions(1000, 2000, {
      ...DEFAULTS,
      widthMm: 120,
      preview: true,
    });
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(1200);
  });
  it("writes a valid PNG pHYs chunk with 11811 pixels per metre and strips duplicates", () => {
    const bytes = new Uint8Array(45);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
    new DataView(bytes.buffer).setUint32(8, 13);
    bytes.set([73, 72, 68, 82], 12);
    bytes.set([73, 69, 78, 68], 37);
    const png = withPngDpi(bytes, 300),
      view = new DataView(png.buffer);
    expect(new TextDecoder().decode(png.subarray(37, 41))).toBe("pHYs");
    expect(view.getUint32(41)).toBe(11811);
    expect(view.getUint32(45)).toBe(11811);
    expect(png[49]).toBe(1);
    expect(withPngDpi(png, 300)).toEqual(png);
  });
  it("reads upload dimensions before decoding and rejects unrecognized formats", () => {
    const bytes = new Uint8Array(33);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(bytes.buffer);
    view.setUint32(8, 13);
    view.setUint32(16, 5000);
    view.setUint32(20, 9000);
    expect(encodedDimensions(bytes)).toEqual({
      width: 5000,
      height: 9000,
      type: "image/png",
    });
    expect(() => encodedDimensions(new Uint8Array(10))).toThrow();
  });
});

const assessment = (patch: Partial<Review> = {}): Review => ({
  scores: {
    identity: 95,
    subjects: 95,
    hair: 90,
    texture: 90,
    background: 95,
    tones: 90,
  },
  issues: [],
  action: "accept",
  adjustments: {
    texture: 65,
    contrast: 50,
    brightness: 50,
    shadow: 30,
    blackPoint: 10,
  },
  ...patch,
});
function dependencies(): AutoDependencies {
  const source = new Blob(["source"], { type: "image/png" });
  return {
    original: new Blob(["original"]),
    reference: new Blob(["reference"]),
    config: { ...DEFAULT_PREFERENCES, apiKey: "test" },
    subject: "auto",
    instructions: "保留花束",
    style: "strong",
    params: { ...DEFAULTS },
    options: { maxRounds: 5, targetScore: 85 },
    generate: vi.fn(async () => ({ buffer: source, warnings: [] })),
    review: vi.fn(async () => assessment()),
    render: vi.fn(async (blob: Blob) => ({
      buffer: blob,
      width: 100,
      height: 100,
      warnings: [],
    })),
    saveCandidate: vi.fn(async (blob: Blob) => ({
      id: "job",
      blob,
      width: 100,
      height: 100,
      warnings: [],
    })),
    publish: vi.fn(async () => {}),
    cancelled: () => false,
  };
}
describe("ported automatic optimization state machine", () => {
  it("preserves original prompt, roles and feedback rules", () => {
    const prompt = buildPrompt({
      subject: "horse",
      style: "strong",
      hasReference: true,
      instructions: "保留花束",
    });
    expect(prompt).toContain("Image 1 is the ONLY source");
    expect(prompt).toContain("Keep the rider and the entire visible horse");
    expect(prompt).toContain("保留花束");
    expect(() => buildPrompt({ instructions: "a".repeat(1601) })).toThrow();
    expect(() => validateAutoOptions({ maxRounds: 11 })).toThrow();
    expect(() => validateReview({})).toThrow();
  });
  it("stops immediately when the average reaches the target", async () => {
    const d = dependencies();
    const run = await runAutoTune(d);
    expect(run.status).toBe("completed");
    expect(run.checks).toBe(1);
    expect(run.best?.passed).toBe(true);
  });
  it("adjusts locally without generating again and retains each parameter snapshot", async () => {
    const d = dependencies();
    let n = 0;
    d.review = vi.fn(async () =>
      ++n === 1
        ? assessment({
            scores: { ...assessment().scores, texture: 20 },
            issues: ["texture_weak"],
            action: "adjust",
            adjustments: {
              texture: 90,
              contrast: 55,
              brightness: 50,
              shadow: 35,
              blackPoint: 10,
            },
          })
        : assessment(),
    );
    const result = await runAutoTune(d);
    expect(d.generate).toHaveBeenCalledTimes(1);
    expect(result.rounds.map((r) => r.action)).toEqual(["generate", "adjust"]);
    expect(result.rounds[0].params.texture).toBe(65);
    expect(result.rounds[1].params.texture).toBe(90);
  });
  it("regenerates from original + reference, never from a generated image, and honors the round limit", async () => {
    const d = dependencies();
    d.options.maxRounds = 2;
    d.review = vi.fn(async () =>
      assessment({
        scores: { ...assessment().scores, identity: 20 },
        issues: ["identity"],
        action: "regenerate",
        suggestions:
          "左侧人物的眼睛形状改变，恢复原照眼角与瞳孔轮廓，保留已正确的衣物纹理。",
      }),
    );
    const result = await runAutoTune(d);
    expect(result.status).toBe("limit");
    expect(d.generate).toHaveBeenCalledTimes(2);
    for (const call of vi.mocked(d.generate).mock.calls) {
      expect(call[0].image).toBe(d.original);
      expect(call[0].referenceImage).toBe(d.reference);
    }
    expect(vi.mocked(d.generate).mock.calls[1][0].feedback).toContain(
      "Restore the exact original faces",
    );
    expect(result.best).not.toBeNull();
    expect(vi.mocked(d.generate).mock.calls[1][0].feedback).toContain(
      "左侧人物的眼睛形状改变",
    );
    expect(result.rounds[0].suggestions).toContain("衣物纹理");
  });
  it("does not continue billing at target even when the review suggests regeneration", async () => {
    const d = dependencies();
    d.review = vi.fn(async () =>
      assessment({ action: "regenerate", issues: ["hair_dark"] }),
    );
    const result = await runAutoTune(d);
    expect(result.status).toBe("completed");
    expect(d.generate).toHaveBeenCalledTimes(1);
  });
  it("saves a paid image returned after stop and does not start its review", async () => {
    const d = dependencies();
    let stopped = false;
    d.cancelled = () => stopped;
    d.generate = vi.fn(async () => {
      stopped = true;
      return { buffer: new Blob(["paid"]), warnings: [] };
    });
    const result = await runAutoTune(d);
    expect(result.status).toBe("cancelled");
    expect(d.saveCandidate).toHaveBeenCalledTimes(1);
    expect(d.review).not.toHaveBeenCalled();
    expect(result.fallback).not.toBeNull();
  });
  it("preserves a failed-review result and does not repeat a paid request", async () => {
    const d = dependencies();
    d.review = vi.fn(async () => {
      throw new Error("额度不足");
    });
    const result = await runAutoTune(d);
    expect(result.status).toBe("failed");
    expect(result.fallback).not.toBeNull();
    expect(d.generate).toHaveBeenCalledTimes(1);
    expect(d.review).toHaveBeenCalledTimes(1);
  });
  it("does not submit generation when already stopped", async () => {
    const d = dependencies();
    d.cancelled = () => true;
    expect((await runAutoTune(d)).status).toBe("cancelled");
    expect(d.generate).not.toHaveBeenCalled();
  });
});

describe("isolated settings and recovery", () => {
  beforeEach(() => localStorage.clear());
  it("persists only allowlisted nonsecret preferences", () => {
    savePreferences({
      ...DEFAULT_PREFERENCES,
      instructions: "保留帽子",
      apiKey: "secret",
    } as PreferencesWithKey);
    expect(loadPreferences().instructions).toBe("保留帽子");
    expect(
      localStorage.getItem("custom-monochrome-logo:settings:v1"),
    ).not.toContain("secret");
  });
  it("recovers interrupted tasks without automatic execution", () => {
    const run: AutoRun = {
      status: "running",
      phase: "生成中",
      maxRounds: 5,
      targetScore: 85,
      generations: 1,
      checks: 0,
      rounds: [],
      best: null,
      fallback: null,
    };
    const saved = restoreTask({
      version: 1,
      fileName: "customer.png",
      params: { ...DEFAULTS },
      run,
    });
    expect(saved.run?.status).toBe("interrupted");
    expect(saved.endedAt).toBeDefined();
    expect(run.status).toBe("running");
  });
  it("accepts the independent route", () =>
    expect(readCreationTool("?tool=custom-monochrome-logo")).toBe(
      "custom-monochrome-logo",
    ));
});
type PreferencesWithKey = typeof DEFAULT_PREFERENCES & { apiKey: string };
