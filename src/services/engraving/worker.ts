import { normalizeImage, renderImage } from "./image";
import type { RenderParams } from "./types";
self.onmessage = async (
  event: MessageEvent<{ blob: Blob; params?: RenderParams; upload?: boolean }>,
) => {
  try {
    self.postMessage({
      result: event.data.params
        ? await renderImage(event.data.blob, event.data.params)
        : await normalizeImage(event.data.blob, 4096, false, event.data.upload),
    });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : "图像处理失败。",
    });
  }
};
