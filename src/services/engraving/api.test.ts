import { rejectReferenceOutput } from "./reference-guard";
vi.mock("./reference-guard", () => ({
  rejectReferenceOutput: vi.fn(async () => {}),
}));
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

it("sends edit candidate, style and identity original in explicit role order", async () => {
  const fetcher = vi.fn(async () =>
    Response.json({ data: [{ b64_json: btoa("png") }] }),
  );
  const normalize = vi.fn(async (buffer: Blob) => ({
    buffer,
    width: 200,
    height: 100,
    warnings: [],
  }));
  await createEngravingApi(fetcher as typeof fetch, normalize).generate({
    ...input(),
    editMode: true,
    originalImage: new Blob(["identity"]),
  });
  const body = vi.mocked(fetcher as typeof fetch).mock.calls[0][1]!
    .body as FormData;
  expect(body.getAll("image[]").map((v) => (v as File).name)).toEqual([
    "candidate.png",
    "reference.png",
    "identity-original.png",
  ]);
  expect(body.get("prompt")).toContain("Image 3 is the ONLY source");
  await expect(
    createEngravingApi(fetcher as typeof fetch, normalize).generate({
      ...input(),
      editMode: true,
    }),
  ).rejects.toThrow("缺少原照");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("sends an expanded edit canvas plus style and untouched identity anchor", async () => {
  const padded = new Blob(["expanded"], { type: "image/png" }),
    draw = vi.fn();
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      constructor(
        public width: number,
        public height: number,
      ) {}
      getContext() {
        return { drawImage: draw };
      }
      convertToBlob() {
        return Promise.resolve(padded);
      }
    },
  );
  const fetcher = vi.fn(async () =>
    Response.json({ data: [{ b64_json: btoa("png") }] }),
  );
  const req = {
    ...input(),
    outpaint: { enabled: true, instructions: "右侧补全手臂" },
  };
  const normalize = vi.fn(async (buffer: Blob) => ({
    buffer,
    width: 200,
    height: 100,
    warnings: [],
  }));
  await createEngravingApi(fetcher as typeof fetch, normalize).generate(req);
  const form = vi.mocked(fetcher as typeof fetch).mock.calls[0][1]!
    .body as FormData;
  expect(form.getAll("image[]")).toHaveLength(3);
  expect(draw).toHaveBeenCalled();
  expect(form.get("prompt")).toContain("OUTPAINTING IS ENABLED");
  expect(form.get("prompt")).toContain("NOT an existing engraving candidate");
  expect(form.get("prompt")).not.toContain("Make targeted improvements");
  expect(form.get("prompt")).toContain("Image 3 is the ONLY source");
  expect(startRequestConsoleEntry).toHaveBeenCalledWith(
    expect.objectContaining({
      inputImages: [padded, req.referenceImage, req.image],
    }),
  );
});

it("aborts only the requested generation and does not retry", async () => {
  const controller = new AbortController();
  const fetcher = vi.fn(
    (_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("stopped", "AbortError")),
        ),
      ),
  );
  const api = createEngravingApi(
    fetcher as typeof fetch,
    undefined,
    controller.signal,
  );
  const pending = api.generate(input());
  const assertion = expect(pending).rejects.toMatchObject({
    name: "AbortError",
  });
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  controller.abort();
  await assertion;
  await expect(api.generate(input())).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each(["gpt-image-2.5-sunburst", "gpt-image-2.5-flare"])(
  "supports %s edits and extended quality without legacy fidelity",
  async (imageModel) => {
    const fetcher = vi.fn(async () =>
      Response.json({ data: [{ b64_json: btoa("png") }] }),
    );
    const normalize = vi.fn(async (buffer: Blob) => ({
      buffer,
      width: 200,
      height: 100,
      warnings: [],
    }));
    for (const quality of ["high", "xhigh", "max"] as const) {
      await createEngravingApi(fetcher as typeof fetch, normalize).generate({
        ...input(),
        config: { ...config, imageModel, quality },
        editMode: true,
        originalImage: new Blob(["identity"]),
      });
      const body = vi.mocked(fetcher as typeof fetch).mock.lastCall![1]!
        .body as FormData;
      expect(body.get("model")).toBe(imageModel);
      expect(body.get("quality")).toBe(quality);
      expect(body.get("background")).toBe("transparent");
      expect(body.get("output_format")).toBe("png");
      expect(body.get("input_fidelity")).toBeNull();
      expect(body.getAll("image[]")).toHaveLength(3);
    }
    expect(fetcher).toHaveBeenCalledTimes(3);
  },
);
it("rejects unsupported legacy quality before making a billable request", async () => {
  const fetcher = vi.fn();
  await expect(
    createEngravingApi(fetcher).generate({
      ...input(),
      config: { ...config, quality: "max" },
    }),
  ).rejects.toThrow("生成质量");
  expect(fetcher).not.toHaveBeenCalled();
});

it("requests streaming once, publishes transient frames and normalizes only the final", async () => {
  const events = ["image_edit.partial_image", "image_edit.completed"]
    .map(
      (type, i) =>
        "data: " +
        JSON.stringify({
          type,
          b64_json: btoa(i ? "final" : "partial"),
          partial_image_index: 0,
        }) +
        "\n\n",
    )
    .join("");
  const fetcher = vi.fn(
    async () =>
      new Response(events, {
        headers: { "content-type": "text/event-stream" },
      }),
  );
  const normalize = vi.fn(async (buffer: Blob) => ({
      buffer,
      width: 200,
      height: 100,
      warnings: [],
    })),
    onProgress = vi.fn();
  await createEngravingApi(fetcher as typeof fetch, normalize).generate({
    ...input(),
    onProgress,
  });
  const body = (fetcher.mock.calls as unknown as [string, RequestInit][])[0][1]
    .body as FormData;
  expect(body.get("stream")).toBe("true");
  expect(body.get("partial_images")).toBe("3");
  expect(onProgress).toHaveBeenCalledTimes(2);
  expect(normalize).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("omits streaming parameters when disabled and accepts JSON responses", async () => {
  const fetcher = vi.fn(async () =>
    Response.json({ data: [{ b64_json: btoa("png") }] }),
  );
  const normalize = vi.fn(async (buffer: Blob) => ({
    buffer,
    width: 200,
    height: 100,
    warnings: [],
  }));
  await createEngravingApi(fetcher as typeof fetch, normalize).generate({
    ...input(),
    config: { ...config, streamPreview: false },
  });
  const body = (fetcher.mock.calls as unknown as [string, RequestInit][])[0][1]
    .body as FormData;
  expect(body.get("stream")).toBeNull();
  expect(body.get("partial_images")).toBeNull();
});

it("rejects a copied reference without retrying or returning a candidate", async () => {
  vi.mocked(rejectReferenceOutput).mockRejectedValueOnce(
    new Error("参考图被当作输出"),
  );
  const fetcher = vi.fn(async () =>
    Response.json({ data: [{ b64_json: btoa("reference-copy") }] }),
  );
  const normalize = vi.fn(async (buffer: Blob) => ({
    buffer,
    width: 200,
    height: 100,
    warnings: [],
  }));
  await expect(
    createEngravingApi(fetcher as typeof fetch, normalize).generate(input()),
  ).rejects.toThrow("参考图被当作输出");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
