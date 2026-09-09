import type { RenderParams, Rendered } from "./types";
export function processInWorker(
  blob: Blob,
  params?: RenderParams,
  signal?: AbortSignal,
  upload = false,
): Promise<Rendered> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("已取消", "AbortError"));
      return;
    }
    const worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    const cleanup = () => {
      worker.terminate();
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("已取消", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event) => {
      cleanup();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.result as Rendered);
    };
    worker.onerror = () => {
      cleanup();
      reject(new Error("图像 Worker 运行失败，请使用新版 Chrome / Edge。"));
    };
    worker.postMessage({ blob, params, upload });
  });
}
