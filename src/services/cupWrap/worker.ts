import { renderDesign } from "./render";
import { encodeTiff } from "./tiff";
import { pack } from "./packing";
self.onmessage = async ({ data }) => {
  try {
    if (data.kind === "pack") {
      self.postMessage({ result: pack(data.designs, data.settings) });
      return;
    }
    const canvas = await renderDesign(
      data.design,
      data.dpi,
      data.bleed,
      data.preview,
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
