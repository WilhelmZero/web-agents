import type { TextBlock } from "./layout-types";
export function resizeText(t: TextBlock, scale: number): TextBlock {
  const fontSize = Math.max(1, Math.min(4096, t.fontSize * scale));
  const ratio = fontSize / t.fontSize;
  return {
    ...t,
    autoSize: true,
    fontSize,
    width: Math.max(1, t.width * ratio),
    height: Math.max(1, t.height * ratio),
  };
}
// Array order is back to front; the layer list displays the reverse order.
export function reorderTextLayers(
  texts: TextBlock[],
  source: string,
  target: string,
) {
  const from = texts.findIndex((t) => t.id === source),
    to = texts.findIndex((t) => t.id === target);
  if (from < 0 || to < 0 || from === to) return texts;
  const next = [...texts];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}
