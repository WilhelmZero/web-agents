import {
  PDFDocument,
  degrees,
  rgb,
  pushGraphicsState,
  popGraphicsState,
  rectangle,
  clip,
  endPath,
} from "pdf-lib";
import { geometry, pathData } from "./geometry";
import { work } from "./client";
import type { WrapDesign, PrintSettings } from "./types";
import type { PrintLayout } from "./packing";
const pt = 72 / 25.4;
export function tileOffsets(
  length: number,
  available: number,
  overlap: number,
) {
  if (available <= overlap || overlap < 0)
    throw new Error("拼接重叠必须小于可打印范围");
  const out = [0];
  while (out[out.length - 1] + available < length - 0.00001) {
    out.push(out[out.length - 1] + available - overlap);
    if (out.length > 100) throw new Error("拼接页数过多");
  }
  return out;
}
export async function tiledPdf(
  d: WrapDesign,
  s: PrintSettings,
  overlap = 5,
  marks = true,
  signal?: AbortSignal,
) {
  const g = geometry(d.cup),
    b = s.bleed ? d.cup.bleed : 0,
    w = g.width + 2 * b,
    h = g.height + 2 * b,
    pw = s.landscape ? 297 : 210,
    ph = s.landscape ? 210 : 297,
    aw = pw - 2 * s.margin,
    ah = ph - 2 * s.margin;
  const xs = tileOffsets(w, aw, overlap),
    ys = tileOffsets(h, ah, overlap);
  if (xs.length * ys.length > 100) throw new Error("拼接超过 100 页");
  const blob = await work<Blob>(
      {
        kind: "png",
        design: d,
        dpi: s.dpi,
        bleed: s.bleed,
        cutLine: s.cutLine,
      },
      signal,
    ),
    pdf = await PDFDocument.create(),
    image = await pdf.embedPng(await blob.arrayBuffer());
  for (const [row, y] of ys.entries())
    for (const [col, x] of xs.entries()) {
      signal?.throwIfAborted();
      const page = pdf.addPage([pw * pt, ph * pt]);
      page.pushOperators(
        pushGraphicsState(),
        rectangle(s.margin * pt, s.margin * pt, aw * pt, ah * pt),
        clip(),
        endPath(),
      );
      page.drawImage(image, {
        x: (s.margin - x) * pt,
        y: (ph - s.margin + y - h) * pt,
        width: w * pt,
        height: h * pt,
      });
      page.pushOperators(popGraphicsState());
      if (marks) {
        page.drawRectangle({
          x: s.margin * pt,
          y: s.margin * pt,
          width: aw * pt,
          height: ah * pt,
          borderWidth: 0.1 * pt,
          borderColor: rgb(0.6, 0.6, 0.6),
        });
        page.drawText(
          `Row ${row + 1} / Col ${col + 1} - overlap ${overlap} mm`,
          { x: s.margin * pt, y: 2 * pt, size: 6 },
        );
      }
    }
  return new Blob([new Uint8Array(await pdf.save())], {
    type: "application/pdf",
  });
}
export async function exportPdf(
  designs: WrapDesign[],
  s: PrintSettings,
  layout?: PrintLayout,
  signal?: AbortSignal,
  progress?: (n: number) => void,
) {
  const pdf = await PDFDocument.create();
  const images = new Map<string, Awaited<ReturnType<typeof pdf.embedPng>>>();
  for (const [i, d] of designs.entries()) {
    signal?.throwIfAborted();
    if (d.source || d.layers.length) {
      const blob = await work<Blob>(
        {
          kind: "png",
          design: d,
          dpi: s.dpi,
          bleed: s.bleed,
          cutLine: s.cutLine,
        },
        signal,
      );
      images.set(d.id, await pdf.embedPng(await blob.arrayBuffer()));
    }
    progress?.(i + 1);
  }
  if (!layout) {
    for (const d of designs) {
      const g = geometry(d.cup),
        b = s.bleed ? d.cup.bleed : 0,
        page = pdf.addPage([(g.width + 2 * b) * pt, (g.height + 2 * b) * pt]),
        image = images.get(d.id);
      if (image)
        page.drawImage(image, {
          x: 0,
          y: 0,
          width: page.getWidth(),
          height: page.getHeight(),
        });
      else
        page.drawSvgPath(pathData(g.points), {
          x: b * pt,
          y: (g.height + b) * pt,
          scale: pt,
          borderWidth: 0.1 * pt,
          borderColor: rgb(0, 0, 0),
        });
    }
  } else
    for (const placements of layout.pages) {
      const page = pdf.addPage([layout.width * pt, layout.height * pt]);
      for (const item of placements) {
        const image = images.get(item.id);
        if (!image) continue;
        const rotation = item.rotation;
        const nativeW = rotation % 180 ? item.height : item.width,
          nativeH = rotation % 180 ? item.width : item.height;
        const x =
            item.x + (rotation === 180 || rotation === 270 ? item.width : 0),
          y =
            layout.height -
            item.y -
            (rotation === 0 || rotation === 270 ? item.height : 0);
        page.drawImage(image, {
          x: x * pt,
          y: y * pt,
          width: nativeW * pt,
          height: nativeH * pt,
          rotate: degrees(-rotation),
        });
      }
    }
  if (!pdf.getPageCount()) throw new Error("没有可导出的页面");
  return new Blob([new Uint8Array(await pdf.save())], {
    type: "application/pdf",
  });
}
export async function calibrationPdf() {
  const pdf = await PDFDocument.create(),
    p = pdf.addPage([210 * pt, 297 * pt]);
  p.drawRectangle({
    x: 20 * pt,
    y: 150 * pt,
    width: 100 * pt,
    height: 100 * pt,
    borderColor: rgb(0, 0, 0),
    borderWidth: 0.2 * pt,
  });
  p.drawText("100 mm x 100 mm / Print at 100%", {
    x: 20 * pt,
    y: 145 * pt,
    size: 10,
  });
  return new Blob([new Uint8Array(await pdf.save())], {
    type: "application/pdf",
  });
}
