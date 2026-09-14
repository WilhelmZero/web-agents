import type { RenderParams, Rendered } from "./types";
// AI requests may run concurrently; large local pixel buffers must stay bounded.
let active = 0;
const queue: { run: () => void }[] = [];
function drain() {
  while (active < 2 && queue.length) {
    active++;
    queue.shift()!.run();
  }
}
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
    const abortQueued = () => {
      const index = queue.indexOf(item);
      if (index >= 0) {
        queue.splice(index, 1);
        reject(new DOMException("已取消", "AbortError"));
      }
    };
    const item = {
      run: () => {
        signal?.removeEventListener("abort", abortQueued);
        void execute(blob, params, signal, upload)
          .then(resolve, reject)
          .finally(() => {
            active--;
            drain();
          });
      },
    };
    signal?.addEventListener("abort", abortQueued, { once: true });
    queue.push(item);
    drain();
  });
}
function execute(
  blob: Blob,
  params: RenderParams | undefined,
  signal: AbortSignal | undefined,
  upload: boolean,
): Promise<Rendered> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("已取消", "AbortError"));
      return;
    }
    let worker: Worker | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      worker?.terminate();
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    const fail = (error: Error) => {
      cleanup();
      reject(error);
    };
    const abort = () => fail(new DOMException("已取消", "AbortError"));
    try {
      worker = new Worker(new URL("./worker.ts", import.meta.url), {
        type: "module",
      });
      signal?.addEventListener("abort", abort, { once: true });
      timer = setTimeout(
        () =>
          fail(
            new Error(
              "本地图像处理超时，请降低输出尺寸或DPI后重试。未重新请求AI。",
            ),
          ),
        180000,
      );
      worker.onmessage = (event) => {
        if (event.data?.error) {
          fail(new Error(event.data.error));
          return;
        }
        if (!event.data?.result?.buffer) {
          fail(new Error("图像处理返回的数据无效，请重试本地预览。"));
          return;
        }
        cleanup();
        resolve(event.data.result);
      };
      worker.onerror = (event) => {
        event.preventDefault();
        fail(
          new Error(
            "本地图像处理线程中断。请降低输出尺寸或DPI；若页面刚更新，请在保存结果后刷新。" +
              (event.message ? " 详情：" + event.message : ""),
          ),
        );
      };
      worker.onmessageerror = () =>
        fail(new Error("本地图像数据传递失败，请降低输出尺寸后重试。"));
      worker.postMessage({ blob, params, upload });
    } catch (error) {
      fail(
        new Error(
          "无法启动本地图像处理：" +
            (error instanceof Error ? error.message : String(error)),
        ),
      );
    }
  });
}
