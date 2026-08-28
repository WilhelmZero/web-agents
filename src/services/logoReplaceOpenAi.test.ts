import { afterEach, describe, expect, it, vi } from "vitest";
import {
  generateExactLogoReplacementOpenAi,
  generateLogoReplacementOpenAi,
  verifyLogoReplacementOpenAi,
} from "./logoReplaceOpenAi";

describe("OpenAI Logo replacement", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends exact preset text and ordered scene, old Logo, and repeated new Logos", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ data: [{ b64_json: btoa("result") }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await generateExactLogoReplacementOpenAi({
      apiKey: "key",
      model: "gpt-image-2",
      scene: new File(["scene"], "scene.png", { type: "image/png" }),
      oldLogo: new File(["old"], "old.png", { type: "image/png" }),
      logos: [
        new File(["a"], "a.png", { type: "image/png" }),
        new File(["a"], "a.png", { type: "image/png" }),
      ],
      prompt: "用户预设原文",
    });
    const body = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(body.get("prompt")).toBe("用户预设原文");
    expect(body.getAll("image[]").map((item) => (item as File).name)).toEqual([
      "scene.png",
      "old.png",
      "a.png",
      "a.png",
    ]);
    expect(body.get("size")).toBe("auto");
  });

  it("supports a fixed output size and truly omits the size field", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ data: [{ b64_json: btoa("result") }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const base = {
      apiKey: "key",
      model: "gpt-image-2" as const,
      scene: new File(["scene"], "scene.png", { type: "image/png" }),
      logos: [new File(["logo"], "logo.png", { type: "image/png" })],
      prompt: "用户预设原文",
    };
    await generateExactLogoReplacementOpenAi({ ...base, size: "1536x1024" });
    expect((fetchMock.mock.calls[0][1]?.body as FormData).get("size")).toBe(
      "1536x1024",
    );
    await generateExactLogoReplacementOpenAi({ ...base, size: "omit" });
    expect((fetchMock.mock.calls[1][1]?.body as FormData).has("size")).toBe(
      false,
    );
  });

  it("sends the scene and Logo references as multiple image edit inputs", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ data: [{ b64_json: btoa("result") }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await generateLogoReplacementOpenAi({
      apiKey: "openai-key",
      model: "gpt-image-2",
      scene: new File(["scene"], "scene.png", { type: "image/png" }),
      oldLogo: new File(["old"], "old.png", { type: "image/png" }),
      newLogo: new File(["new"], "new.png", { type: "image/png" }),
      prompt: "replace the logo",
    });
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const form = request.body as FormData;
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.openai.com/v1/images/edits",
    );
    expect(form.getAll("image[]")).toHaveLength(3);
    expect(form.get("model")).toBe("gpt-image-2");
    expect(form.has("input_fidelity")).toBe(false);
    expect(form.get("prompt")).toContain(
      "不得新增或加强全局红色、橙色、洋红色偏色",
    );
    expect(form.get("prompt")).toContain("禁止磨皮、美颜、蜡像或塑料皮肤");
    expect(result.mimeType).toBe("image/png");
  });

  it("rejects Logos that extend from the smooth upper band into lower ribs", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            output_text: JSON.stringify({
              passed: false,
              referenceText: "H",
              generatedText: "H",
              differences: ["Logo 底边进入竖纹区"],
              graphicConsistent: true,
              materialIntegrated: true,
              placementConsistent: false,
              originalLogoRemoved: true,
              flatOverlayDetected: false,
              summary: "位置过低",
            }),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await verifyLogoReplacementOpenAi({
      apiKey: "openai-key",
      model: "gpt-5.4-mini",
      referenceLogo: new File(["logo"], "logo.png", { type: "image/png" }),
      originalScene: new File(["scene"], "scene.png", { type: "image/png" }),
      generatedImage: new Blob(["generated"], { type: "image/png" }),
      beerMugContext: true,
    });
    const body = JSON.parse(
      String((fetchMock.mock.calls[0][1] as RequestInit).body),
    );
    expect(body.input[0].content[0].text).toContain("本图已识别为啤酒杯");
    expect(body.input[0].content[0].text).toContain(
      "此规则只用于本张啤酒杯图片",
    );
    expect(result).toMatchObject({ passed: false, placementConsistent: false });
  });
});
