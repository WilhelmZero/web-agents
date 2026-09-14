import { expect, it, vi } from "vitest";
import { readImageStream } from "./image-stream";
const text = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(blob);
  });
const event = (type: string, text = "final", index = 0) =>
  `data: ${JSON.stringify({ type, b64_json: btoa(text), partial_image_index: index })}\r\n\r\n`;
function response(text: string, chunk = 7) {
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream({
      start(c) {
        for (let i = 0; i < bytes.length; i += chunk)
          c.enqueue(bytes.slice(i, i + chunk));
        c.close();
      },
    }),
  );
}
it("decodes fragmented SSE, ignores duplicate partials and returns only the final image", async () => {
  const progress = vi.fn();
  const blob = await readImageStream(
    response(
      ": heartbeat\r\n\r\n" +
        event("image_edit.partial_image", "preview", 0) +
        event("image_edit.partial_image", "duplicate", 0) +
        event("image_edit.partial_image", "second", 1) +
        event("image_edit.completed"),
    ),
    undefined,
    progress,
  );
  expect(await text(blob)).toBe("final");
  expect(progress.mock.calls.map(([e]) => e.kind)).toEqual([
    "partial",
    "partial",
    "complete",
  ]);
});
it("rejects incomplete streams and provider errors without accepting previews as final", async () => {
  await expect(
    readImageStream(response(event("image_edit.partial_image"))),
  ).rejects.toThrow("未收到最终图片");
  await expect(readImageStream(response(event("error")))).rejects.toThrow(
    "未自动重试",
  );
  await expect(readImageStream(response("data: null\n\n"))).rejects.toThrow(
    "格式无效",
  );
});
it("cancels a pending stream immediately and ignores later results", async () => {
  const control = new AbortController(),
    cancel = vi.fn(),
    progress = vi.fn();
  const waiting = readImageStream(
    new Response(new ReadableStream({ cancel })),
    control.signal,
    progress,
  );
  control.abort();
  await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(progress).not.toHaveBeenCalled();
});
it("keeps simultaneous requests isolated", async () => {
  const a = vi.fn(),
    b = vi.fn();
  const [left, right] = await Promise.all([
    readImageStream(
      response(
        event("image_edit.partial_image", "A") +
          event("image_edit.completed", "A-final"),
      ),
      undefined,
      a,
    ),
    readImageStream(
      response(event("image_edit.completed", "B-final")),
      undefined,
      b,
    ),
  ]);
  expect(await text(left)).toBe("A-final");
  expect(await text(right)).toBe("B-final");
  expect(a).toHaveBeenCalledTimes(2);
  expect(b).toHaveBeenCalledTimes(1);
});

it("preserves SSE provider error details and redacts credentials", async () => {
  const value = {
    type: "error",
    error: {
      message: "quota exceeded for test-secret",
      code: "insufficient_quota",
    },
  };
  await expect(
    readImageStream(
      response("data: " + JSON.stringify(value) + "\n\n"),
      undefined,
      undefined,
      ["test-secret"],
    ),
  ).rejects.toMatchObject({
    status: 502,
    code: "insufficient_quota",
    message: expect.stringContaining("quota exceeded for [已隐藏]"),
  });
});
