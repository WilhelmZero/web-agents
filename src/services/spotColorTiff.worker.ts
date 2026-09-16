/// <reference lib="webworker" />

import {
  SPOT_TIFF_DPI,
  SPOT_TIFF_HEIGHT,
  SPOT_TIFF_WIDTH,
  containSpotLayer,
  encodeSpotColorTiff,
  type SpotPlacement,
  type SpotRgbMode,
} from "./spotColorTiff";

export interface SpotTiffWorkerRequest {
  id: string;
  blob: Blob;
  sourceName: string;
  placement: SpotPlacement;
  rgbMode: SpotRgbMode;
}

export type SpotTiffWorkerResponse =
  | { id: string; type: "progress"; stage: string; percent: number }
  | { id: string; type: "success"; buffer: ArrayBuffer }
  | { id: string; type: "error"; error: string };

const scope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;
const progress = (id: string, stage: string, percent: number) =>
  scope.postMessage({ id, type: "progress", stage, percent } satisfies SpotTiffWorkerResponse);

scope.onmessage = async ({ data }: MessageEvent<SpotTiffWorkerRequest>) => {
  const { id } = data;
  try {
    progress(id, "正在准备智能对象", 10);
    const bitmap = await createImageBitmap(data.blob);
    try {
      const embeddedCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const embeddedContext = embeddedCanvas.getContext("2d", { willReadFrequently: true });
      if (!embeddedContext) throw new Error("无法创建智能对象画布");
      embeddedContext.drawImage(bitmap, 0, 0);
      if (data.rgbMode === "black") {
        const pixels = embeddedContext.getImageData(0, 0, bitmap.width, bitmap.height);
        for (let offset = 0; offset < pixels.data.length; offset += 4) {
          pixels.data[offset] = 0;
          pixels.data[offset + 1] = 0;
          pixels.data[offset + 2] = 0;
        }
        embeddedContext.putImageData(pixels, 0, 0);
      }
      const embeddedBlob = await embeddedCanvas.convertToBlob({ type: "image/png" });
      const embeddedPng = new Uint8Array(await embeddedBlob.arrayBuffer());
      const bounds = containSpotLayer(bitmap.width, bitmap.height, data.placement);
      const layerCanvas = new OffscreenCanvas(bounds.width, bounds.height);
      const layerContext = layerCanvas.getContext("2d", { willReadFrequently: true });
      if (!layerContext) throw new Error("无法创建 Logo 图层画布");
      layerContext.imageSmoothingEnabled = true;
      layerContext.imageSmoothingQuality = "high";
      layerContext.drawImage(embeddedCanvas, 0, 0, bounds.width, bounds.height);
      const rgba = layerContext.getImageData(0, 0, bounds.width, bounds.height).data;
      progress(id, "正在编码图层与专色通道", 35);
      const buffer = encodeSpotColorTiff({
        width: SPOT_TIFF_WIDTH,
        height: SPOT_TIFF_HEIGHT,
        dpi: SPOT_TIFF_DPI,
        layer: {
          rgba,
          bounds,
          embeddedPng,
          embeddedWidth: bitmap.width,
          embeddedHeight: bitmap.height,
          embeddedName: data.sourceName.replace(/\.[^.]+$/, "") + ".png",
        },
      });
      progress(id, "TIFF 编码完成", 95);
      scope.postMessage({ id, type: "success", buffer } satisfies SpotTiffWorkerResponse, [buffer]);
    } finally {
      bitmap.close();
    }
  } catch (error) {
    scope.postMessage({
      id,
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    } satisfies SpotTiffWorkerResponse);
  }
};

export {};
