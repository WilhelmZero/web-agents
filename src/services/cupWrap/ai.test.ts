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
it("sends exact prompt, two ordered images and counts only a returned image", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: "AQID" }] }), {
        status: 200,
      }),
    );
  vi.stubGlobal("fetch", fetcher);
  const source = new Blob(["source"], { type: "image/png" }),
    guide = new Blob(["guide"], { type: "image/png" }),
    prompt = "用户原文\n完整图案";
  await adaptArtwork(
    { ...DEFAULT_SETTINGS, openAiApiKey: "test" },
    "gpt-image-2",
    source,
    guide,
    prompt,
    new AbortController().signal,
  );
  const form = fetcher.mock.calls[0][1].body as FormData;
  expect(form.get("prompt")).toBe(prompt);
  expect(await (form.getAll("image[]")[0] as Blob).text()).toBe("source");
  expect(await (form.getAll("image[]")[1] as Blob).text()).toBe("guide");
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
