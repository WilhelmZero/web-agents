import { it, expect, vi, afterEach } from "vitest";
const instances: FakeWorker[] = [];
class FakeWorker {
  onmessage?: (e: { data: unknown }) => void;
  onerror?: (e: { message: string; preventDefault: () => void }) => void;
  onmessageerror?: () => void;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() {
    instances.push(this);
  }
  done() {
    this.onmessage?.({
      data: {
        result: {
          buffer: new Blob(["png"]),
          width: 1,
          height: 1,
          warnings: [],
        },
      },
    });
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  instances.length = 0;
  vi.resetModules();
});
it("bounds all local image work at two and removes cancelled queued work", async () => {
  vi.stubGlobal("Worker", FakeWorker);
  const { processInWorker } = await import("./workerClient");
  const abort = new AbortController();
  const first = processInWorker(new Blob()),
    second = processInWorker(new Blob());
  const third = processInWorker(new Blob(), undefined, abort.signal);
  const cancelled = expect(third).rejects.toMatchObject({ name: "AbortError" });
  const fourth = processInWorker(new Blob());
  expect(instances).toHaveLength(2);
  abort.abort();
  await cancelled;
  instances[0].done();
  await first;
  await vi.waitFor(() => expect(instances).toHaveLength(3));
  instances[1].done();
  instances[2].done();
  await Promise.all([second, fourth]);
  expect(instances.every((w) => w.terminate.mock.calls.length === 1)).toBe(
    true,
  );
});
it("reports worker details and frees the slot after a crash", async () => {
  vi.stubGlobal("Worker", FakeWorker);
  const { processInWorker } = await import("./workerClient");
  const pending = processInWorker(new Blob());
  const failed = expect(pending).rejects.toThrow("out of memory");
  instances[0].onerror?.({ message: "out of memory", preventDefault: vi.fn() });
  await failed;
  const next = processInWorker(new Blob());
  instances[1].done();
  await next;
});
it("terminates an active operation on cancellation without retrying", async () => {
  vi.stubGlobal("Worker", FakeWorker);
  const { processInWorker } = await import("./workerClient");
  const abort = new AbortController();
  const pending = processInWorker(new Blob(), undefined, abort.signal);
  const failed = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  abort.abort();
  await failed;
  expect(instances).toHaveLength(1);
  expect(instances[0].terminate).toHaveBeenCalledOnce();
});
it("times out stalled work without leaving a slot occupied", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("Worker", FakeWorker);
  const { processInWorker } = await import("./workerClient");
  const pending = processInWorker(new Blob());
  const failed = expect(pending).rejects.toThrow("本地图像处理超时");
  await vi.advanceTimersByTimeAsync(180000);
  await failed;
  expect(instances[0].terminate).toHaveBeenCalledOnce();
});
