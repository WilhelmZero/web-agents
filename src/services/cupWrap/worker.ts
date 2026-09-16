import { renderDesign } from "./render";
import { encodeTiff } from "./tiff";
import { pack } from "./packing";
import { analyzeLocalArtwork, arrangeLocal } from "./localAdaptation";
self.onmessage = async ({ data }) => {
  try {
    if (data.kind === "localAnalyze") {
      self.postMessage({ result: await analyzeLocalArtwork(data.source) });
      return;
    }
    if (data.kind === "localArrange") {
      self.postMessage({ result: arrangeLocal(data.input, data.cup) });
      return;
    }
    if (data.kind === "pack") {
      self.postMessage({ result: pack(data.designs, data.settings) });
      return;
    }
    const canvas = await renderDesign(
      data.design,
      data.dpi,
      data.bleed,
      data.preview,
      data.cutLine,
    );
    if (data.kind === "tiff") {
      const rgba = canvas
        .getContext("2d")!
        .getImageData(0, 0, canvas.width, canvas.height).data;
      const result = encodeTiff(canvas.width, canvas.height, rgba, data.dpi);
      self.postMessage({ result }, { transfer: [result] });
    } else
      self.postMessage({
        result: await canvas.convertToBlob({ type: "image/png" }),
      });
  } catch (e) {
    self.postMessage({ error: e instanceof Error ? e.message : String(e) });
  }
};
