import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { editAiPetLetter, AiPetLetterApiError } from "./api";
import { HIGH_RES_HEIGHT, HIGH_RES_WIDTH, NATIVE_HEIGHT, NATIVE_WIDTH, strictCompositePixels } from "./image";
import { createDefaultPrompts, validateOptimizedPrompt } from "./prompts";
import { loadAiPetLetterPrompts, loadAiPetLetterSettings, loadAiPetLetterWorkspace, saveAiPetLetterPrompts, saveAiPetLetterSettings, saveAiPetLetterWorkspace } from "./storage";
import { AI_PET_LETTERS, DEFAULT_AI_PET_LETTER_SETTINGS, normalizeQuality, qualityOptions } from "./types";
import { getGenerationStatsSnapshot, resetGenerationStats } from "../generationStats";

afterEach(() => vi.unstubAllGlobals());

describe("AI pet letter prompts", () => {
  it("creates complete A-Z prompts including a regenerated A", () => {
    const prompts = createDefaultPrompts();
    expect(prompts.map((item) => item.letter)).toEqual(AI_PET_LETTERS);
    expect(prompts).toHaveLength(26);
    expect(prompts[0].currentPrompt).toContain("重新绘制参考图中央相同的大写 A");
    expect(prompts[1].currentPrompt).toContain("替换成大写 B");
    prompts.forEach((item) => {
      expect(item.currentPrompt).toContain("整幅图");
      expect(item.currentPrompt).toContain("完整肢体");
      expect(item.currentPrompt).toContain("不得互相遮挡");
      expect(item.currentPrompt).toContain("不得被画布边缘裁切");
      expect(item.currentPrompt).toContain("不得出现目标字母以外");
    });
  });

  it("rejects optimized prompts that lose the target or protection rules", () => {
    expect(validateOptimizedPrompt("B", "把它改好")).toContain("目标字母 B");
    expect(validateOptimizedPrompt("B", "整幅图统一生成，将字母 B 改成蓝色，角色不能遮挡，肢体完整，背景不变")).toBeNull();
  });
});

describe("model capabilities", () => {
  it("downgrades unsupported GPT Image 2 quality without changing modern models", () => {
    expect(qualityOptions("gpt-image-2")).toEqual(["auto", "low", "medium", "high"]);
    expect(normalizeQuality("gpt-image-2", "xhigh")).toBe("high");
    expect(normalizeQuality("gpt-image-2.5-sunburst", "max")).toBe("max");
  });
});

describe("strict compositing", () => {
  it("uses the requested native and exact high-resolution output dimensions", () => {
    expect([NATIVE_WIDTH, NATIVE_HEIGHT]).toEqual([3840, 2160]);
    expect(NATIVE_WIDTH * NATIVE_HEIGHT).toBe(8_294_400);
    expect([HIGH_RES_WIDTH, HIGH_RES_HEIGHT]).toEqual([7717, 4346]);
  });
  it("copies outside pixels exactly from the reference", () => {
    const original = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]);
    const generated = new Uint8ClampedArray([200, 210, 220, 255, 230, 240, 250, 255]);
    const mask = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
    expect(Array.from(strictCompositePixels(original, generated, mask))).toEqual([10, 20, 30, 255, 230, 240, 250, 255]);
  });
});

describe("OpenAI image edit request", () => {
  it("submits the visible prompt verbatim with image, mask, model, quality and exact size", async () => {
    resetGenerationStats();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ data: [{ b64_json: btoa("png") }] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await editAiPetLetter({ apiKey: "key", image: new Blob(["image"], { type: "image/png" }), mask: new Blob(["mask"], { type: "image/png" }), prompt: "界面逐字原文", model: "gpt-image-2.5-sunburst", quality: "xhigh" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.openai.com/v1/images/edits");
    const form = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(form.get("prompt")).toBe("界面逐字原文");
    expect(form.get("model")).toBe("gpt-image-2.5-sunburst");
    expect(form.get("quality")).toBe("xhigh");
    expect(form.get("size")).toBe("3840x2160");
    expect(form.get("output_format")).toBe("png");
    expect(form.get("image")).toBeInstanceOf(File);
    expect(form.get("mask")).toBeInstanceOf(File);
    expect(getGenerationStatsSnapshot().byModel["gpt-image-2.5-sunburst"].count).toBe(1);
  });

  it("classifies temporary errors separately from permission errors", () => {
    expect(new AiPetLetterApiError("busy", 503, true).retryable).toBe(true);
    expect(new AiPetLetterApiError("unauthorized", 401, false).retryable).toBe(false);
  });

  it("supports whole-image editing without a mask", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ data: [{ b64_json: btoa("png") }] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await editAiPetLetter({ apiKey: "key", image: new Blob(["image"], { type: "image/png" }), prompt: "整幅生成", model: "gpt-image-2.5-sunburst", quality: "xhigh" });
    const form = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(form.has("mask")).toBe(false);
  });

  it("does not retry an insufficient-quota 429 response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "insufficient quota", code: "insufficient_quota" } }), { status: 429, headers: { "Content-Type": "application/json" } })));
    await expect(editAiPetLetter({ apiKey: "key", image: new Blob(["i"], { type: "image/png" }), mask: new Blob(["m"], { type: "image/png" }), prompt: "字母 A", model: "gpt-image-2.5-sunburst", quality: "xhigh" })).rejects.toMatchObject({ retryable: false, status: 429 });
  });
});

describe("isolated persistence", () => {
  it("persists versioned settings, prompts and blob workspace", async () => {
    localStorage.clear();
    saveAiPetLetterSettings({ ...DEFAULT_AI_PET_LETTER_SETTINGS, concurrency: 4 });
    expect(loadAiPetLetterSettings().concurrency).toBe(4);
    const prompts = createDefaultPrompts(); prompts[2].currentPrompt = "字母 C，外围不变，角色肢体完整，背景不变";
    saveAiPetLetterPrompts(prompts);
    expect(loadAiPetLetterPrompts()[2].currentPrompt).toContain("字母 C");
    const workspace = { tasks: [], updatedAt: 7, referenceBlob: new Blob(["ref"], { type: "image/png" }) };
    await saveAiPetLetterWorkspace(workspace);
    expect((await loadAiPetLetterWorkspace())?.updatedAt).toBe(7);
  });
});
