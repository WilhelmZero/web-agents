// @vitest-environment node
import { it, expect, vi, afterEach } from "vitest";
import { adaptArtwork } from "./ai";
import { DEFAULT_SETTINGS } from "../../constants";
vi.mock("../requestConsole", () => ({
  startRequestConsoleEntry: vi.fn(() => "test"),
  updateRequestConsoleEntry: vi.fn(),
}));
import { updateRequestConsoleEntry } from "../requestConsole";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it("sends the exact prompt with only the current dieline image", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: "AQID" }] }), {
        status: 200,
      }),
    );
  vi.stubGlobal("fetch", fetcher);
  const source = new Blob(["source"], { type: "image/png" }),
    prompt = "用户原文\n完整图案";
  await adaptArtwork(
    { ...DEFAULT_SETTINGS, openAiApiKey: "test" },
    "gpt-image-2",
    source,
    prompt,
    new AbortController().signal,
  );
  const form = fetcher.mock.calls[0][1].body as FormData;
  expect(form.get("prompt")).toBe(prompt);
  expect(form.getAll("image[]")).toHaveLength(1);
  expect(await (form.getAll("image[]")[0] as Blob).text()).toBe("source");
  expect(updateRequestConsoleEntry).toHaveBeenCalledWith(
    "test",
    expect.objectContaining({
      status: "success",
      outputImages: [expect.any(Blob)],
    }),
  );
});
it("does not automatically retry errors or record generated images", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "quota" } }), {
        status: 429,
      }),
    );
  vi.stubGlobal("fetch", fetcher);
  await expect(
    adaptArtwork(
      { ...DEFAULT_SETTINGS, openAiApiKey: "test" },
      "gpt-image-2",
      new Blob(),
      "x",
      new AbortController().signal,
    ),
  ).rejects.toThrow("quota");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(updateRequestConsoleEntry).toHaveBeenCalledWith(
    "test",
    expect.objectContaining({ status: "failed" }),
  );
});
it.each(["gpt-image-2.5-sunburst", "gpt-image-2.5-flare"])(
  "uses transparent high-quality custom-size PNG edits for %s",
  async (model) => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: "AQID" }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetcher);
    await adaptArtwork(
      { ...DEFAULT_SETTINGS, openAiApiKey: "test" },
      model,
      new Blob(["original"], { type: "image/png" }),
      "参考原图元素进行扩图，只用精灵和星星进行填充",
      new AbortController().signal,
      { transparent: true, size: "2880x2880" },
    );
    const form = fetcher.mock.calls[0][1].body as FormData;
    expect(form.get("model")).toBe(model);
    expect(form.get("size")).toBe("2880x2880");
    expect(form.get("quality")).toBe("high");
    expect(form.get("background")).toBe("transparent");
    expect(form.get("output_format")).toBe("png");
    expect(form.getAll("image[]")).toHaveLength(1);
    expect(await (form.getAll("image[]")[0] as Blob).text()).toBe("original");
  },
);
