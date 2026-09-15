import { it, expect, vi } from "vitest";
import { createEngravingApi } from "./api";
import { DEFAULTS } from "./processing.mjs";
import { DEFAULT_PREFERENCES } from "./storage";
import { validateProfile } from "./source-lock.mjs";
vi.mock("./image", () => ({
  normalizeImage: vi.fn(async (buffer: Blob) => ({ buffer })),
  blobDataUrl: vi.fn(
    (blob: Blob) =>
      new Promise<string>((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.readAsDataURL(blob);
      }),
  ),
}));
vi.mock("../requestConsole", () => ({
  startRequestConsoleEntry: vi.fn(),
  updateRequestConsoleEntry: vi.fn(),
}));
const c = {
  person: 0,
  cat: 1,
  dog: 0,
  horse: 0,
  otherAnimal: 0,
  character: 0,
  object: 0,
};
const p = {
  medium: "photo",
  confidence: 0.96,
  description: "一只猫，抬头，前爪搭在边缘",
  counts: c,
  reviewConsistent: true,
  reason: "",
};
const r = {
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
  suggestions: "",
  adjustments: {
    texture: 65,
    contrast: 50,
    brightness: 50,
    shadow: 30,
    blackPoint: 10,
  },
  observedOriginal: c,
  observedOutput: c,
};
const config = {
  ...DEFAULT_PREFERENCES,
  baseUrl: "https://unit.invalid/v1",
  apiKey: "test",
};
const answer = (v: unknown) =>
  Response.json({
    status: "completed",
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify(v) }],
      },
    ],
  });
it("analyzes only original, reviews two images, then audits only output without reference images", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(answer(p))
    .mockResolvedValueOnce(answer(r))
    .mockResolvedValueOnce(answer(p));
  const api = createEngravingApi(fetcher);
  const original = new Blob(["cat-original"]),
    rendered = new Blob(["cat-output"]);
  const lock = await api.analyze(original, config);
  const result = await api.review({
    original,
    rendered,
    reference: new Blob(["dog-style"]),
    sourceProfile: lock,
    config,
    params: DEFAULTS,
    instructions: "",
  });
  expect(result.integrity).toBe("verified");
  const bodies = fetcher.mock.calls.map((call) => JSON.parse(call[1].body));
  expect(
    bodies.map(
      (b) =>
        b.input[0].content.filter((x: any) => x.type === "input_image").length,
    ),
  ).toEqual([1, 2, 1]);
  expect(JSON.stringify(bodies)).not.toContain(btoa("dog-style"));
  expect(atob(bodies[2].input[0].content[1].image_url.split(",")[1])).toBe(
    "cat-output",
  );
});
it("does not retry failed or cancelled source analysis", async () => {
  const fetcher = vi.fn(async () =>
    Response.json({ error: { message: "failed" } }, { status: 503 }),
  );
  await expect(
    createEngravingApi(fetcher).analyze(new Blob(["cat"]), config),
  ).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
  const controller = new AbortController();
  controller.abort();
  await expect(
    createEngravingApi(fetcher, undefined, controller.signal).analyze(
      new Blob(["cat"]),
      config,
    ),
  ).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("blocks narrative contradictions returned by the independent audit", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(answer(r))
    .mockResolvedValueOnce(
      answer({
        ...p,
        reviewConsistent: false,
        reason: "review claims people, output shows cat",
      }),
    );
  await expect(
    createEngravingApi(fetcher).review({
      original: new Blob(["cat"]),
      rendered: new Blob(["cat-output"]),
      reference: new Blob(["style"]),
      sourceProfile: validateProfile(p),
      config,
      params: DEFAULTS,
      instructions: "",
    }),
  ).rejects.toThrow(/矛盾/);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
