import { expect, it, vi } from "vitest";
import { createEngravingApi } from "./api";
import { DEFAULTS } from "./processing.mjs";
import { DEFAULT_PREFERENCES } from "./storage";
import { runAutoTune } from "./auto-tune.mjs";
import { buildPrompt } from "./prompts.mjs";
vi.mock("./image", () => ({
  normalizeImage: vi.fn(async (buffer: Blob) => ({ buffer })),
  blobDataUrl: vi.fn(
    (blob: Blob) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); }),
  ),
}));
vi.mock("../requestConsole", () => ({
  startRequestConsoleEntry: vi.fn(),
  updateRequestConsoleEntry: vi.fn(),
}));
const config = {
  ...DEFAULT_PREFERENCES,
  apiKey: "fake",
  baseUrl: "https://test.invalid/v1",
};
const assessment = {
  scores: {
    identity: 30,
    subjects: 30,
    hair: 80,
    texture: 80,
    background: 95,
    tones: 80,
  },
  issues: ["identity"],
  action: "regenerate",
  adjustments: {
    texture: 65,
    contrast: 60,
    brightness: 50,
    shadow: 60,
    blackPoint: 10,
  },
  suggestions: "图1的猫保留耳朵，图2的当前成品改善胡须。",
};
it("sends only source then output with adjacent role labels, never the portrait reference", async () => {
  const fetcher = vi.fn(async () =>
    Response.json({
      status: "completed",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify(assessment) }],
        },
      ],
    }),
  );
  await createEngravingApi(fetcher).review({
    original: new Blob(["cat-source"]),
    reference: new Blob(["portrait-reference"]),
    rendered: new Blob(["cat-output"]),
    config,
    params: DEFAULTS,
    instructions: "",
  });
  const body = JSON.parse(
    (fetcher.mock.calls as unknown as [string, RequestInit][])[0][1]
      .body as string,
  );
  const c = body.input[0].content;
  expect(c.map((x: { type: string }) => x.type)).toEqual([
    "input_text",
    "input_text",
    "input_image",
    "input_text",
    "input_image",
  ]);
  expect(c[1].text).toContain("ORIGINAL_CUSTOMER_SOURCE");
  expect(c[3].text).toContain("REVIEWED_OUTPUT");
  expect(atob(c[2].image_url.split(",")[1])).toBe("cat-source");
  expect(atob(c[4].image_url.split(",")[1])).toBe("cat-output");
  expect(JSON.stringify(body)).not.toContain(btoa("portrait-reference"));
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each([false, true])(
  "keeps correction roles independent of generation numbering (continued=%s)",
  async (continued) => {
    const generate = vi.fn(async () => ({
      buffer: new Blob(["candidate"]),
      warnings: [],
    }));
    let id = 0;
    await runAutoTune({
      original: new Blob(["cat"]),
      reference: new Blob(["portrait"]),
      config,
      subject: "auto",
      instructions: "",
      style: "strong",
      params: DEFAULTS,
      outpaint: { enabled: true, instructions: "" },
      options: {
        maxRounds: 2,
        targetScore: 90,
        continueOnGenerated: continued,
      },
      generate,
      review: async () => assessment as any,
      render: async (buffer) => ({
        buffer,
        width: 100,
        height: 100,
        warnings: [],
      }),
      saveCandidate: async (blob) => ({
        id: String(++id),
        blob,
        width: 100,
        height: 100,
        warnings: [],
      }),
      publish: async () => {},
      cancelled: () => false,
    });
    const input = (generate.mock.calls as unknown as [any][])[1][0];
    expect(input.feedback).toContain("ORIGINAL_CUSTOMER_SOURCE");
    expect(input.feedback).toContain("REVIEWED_OUTPUT");
    expect(input.feedback).not.toMatch(/image [123]|图[123]/i);
    for (const hasReference of [false, true]) {
      const prompt = buildPrompt({ ...input, hasReference });
      expect(prompt).toContain(
        "ORIGINAL_CUSTOMER_SOURCE always means Image " + (hasReference ? 3 : 2),
      );
    }
  },
);
