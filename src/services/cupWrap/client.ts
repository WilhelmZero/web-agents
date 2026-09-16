export function work<T>(data: unknown, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    const cleanup = () => {
      worker.terminate();
      signal?.removeEventListener("abort", stop);
    };
    const stop = () => {
      cleanup();
      reject(new DOMException("已停止", "AbortError"));
    };
    worker.onmessage = ({ data }) => {
      cleanup();
      data.error ? reject(new Error(data.error)) : resolve(data.result);
    };
    worker.onerror = (e) => {
      cleanup();
      reject(new Error(e.message));
    };
    if (signal?.aborted) {
      stop();
      return;
    }
    signal?.addEventListener("abort", stop, { once: true });
    worker.postMessage(data);
  });
}
