import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiBase, createEngravingApi, testConnection } from "./api";
import { DEFAULT_PREFERENCES } from "./storage";
import { buildPrompt } from "./prompts.mjs";
import {
  startRequestConsoleEntry,
  updateRequestConsoleEntry,
} from "../requestConsole";
import type { GenerateInput } from "./types";
vi.mock("../requestConsole", () => ({
  startRequestConsoleEntry: vi.fn(() => "request"),
  updateRequestConsoleEntry: vi.fn(),
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width: 200, height: 100, close: vi.fn() })),
  );
});
afterEach(() => vi.unstubAllGlobals());
const config = {
  ...DEFAULT_PREFERENCES,
  apiKey: "unit-test-key",
  baseUrl: "https://test.invalid/v1",
};
const input = (): GenerateInput => ({
  image: new Blob(["original"], { type: "image/png" }),
  referenceImage: new Blob(["reference"], { type: "image/png" }),
  config,
  subject: "horse",
  instructions: "保留缰绳",
  style: "strong",
});
describe("compatible image API", () => {
  it("sends source then style reference with the exact migrated prompt and accounts only returned images", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ data: [{ b64_json: btoa("png") }] }),
    );
    const normalize = vi.fn(async (buffer: Blob) => ({
      buffer,
      width: 200,
      height: 100,
      warnings: [],
    }));
    const request = input();
    await createEngravingApi(fetcher as typeof fetch, normalize).generate(
      request,
    );
    const [url, options] = vi.mocked(fetcher as typeof fetch).mock.calls[0];
    expect(url).toBe("https://test.invalid/v1/images/edits");
    const body = options!.body as FormData;
    expect(body.get("prompt")).toBe(
      buildPrompt({ ...request, hasReference: true }),
    );
    expect(body.getAll("image[]").map((v) => (v as File).name)).toEqual([
      "original.png",
      "reference.png",
    ]);
    expect(body.get("size")).toBe("1536x1024");
    expect(body.get("input_fidelity")).toBeNull();
    expect(body.get("n")).toBe("1");
    expect(body.get("quality")).toBe("high");
    expect(startRequestConsoleEntry).toHaveBeenCalledTimes(1);
    expect(updateRequestConsoleEntry).toHaveBeenCalledWith(
      "request",
      expect.objectContaining({
        status: "success",
        outputImages: expect.any(Array),
      }),
    );
  });
  it("does not automatically repeat a failed billable request", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ error: {} }, { status: 429 }),
    );
    await expect(createEngravingApi(fetcher).generate(input())).rejects.toThrow(
      "429",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(updateRequestConsoleEntry).not.toHaveBeenCalledWith(
      "request",
      expect.objectContaining({ status: "success" }),
    );
  });
  it("only lists models in connection tests and sends no image request or generation count", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ data: [{ id: "test" }] }),
    );
    expect(await testConnection(config, fetcher)).toBe(1);
    expect(fetcher.mock.calls).toHaveLength(1);
    expect(vi.mocked(fetcher as typeof fetch).mock.calls[0][0]).toBe(
      "https://test.invalid/v1/models",
    );
    expect(startRequestConsoleEntry).not.toHaveBeenCalled();
  });
  it("reports CORS/network failures and rejects unsafe API URLs", async () => {
    await expect(
      testConnection(
        config,
        vi.fn(async () => {
          throw new TypeError("Failed to fetch");
        }),
      ),
    ).rejects.toThrow("CORS");
    expect(() => apiBase("http://example.com/v1")).toThrow("HTTPS");
    expect(() => apiBase("https://key:secret@example.com/v1")).toThrow();
    expect(apiBase("https://example.com/v1/")).toBe("https://example.com/v1");
  });
});
