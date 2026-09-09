import {
  DEFAULTS,
  cropPixels,
  outputDimensions,
  validateOptions,
} from "./processing.mjs";
import type { RenderParams, StoredResult, Rendered } from "./types";

export interface ExportSettings {
  unit: "mm" | "px";
  widthMm: number;
  dpi: number;
  margin: number;
  pixelWidth: number;
  pixelMargin: number;
}
export const EXPORT_DEFAULTS: ExportSettings = {
  unit: "mm",
  widthMm: 80,
  dpi: 300,
  margin: 4,
  pixelWidth: 945,
  pixelMargin: 47,
};
const KEY = "custom-monochrome-logo:export:v1";
export function exportParams(
  params: RenderParams,
  settings: ExportSettings,
): RenderParams {
  return validateOptions({
    ...params,
    widthMm: settings.widthMm,
    dpi: settings.dpi,
    margin: settings.margin,
    pixelWidth: settings.unit === "px" ? settings.pixelWidth : undefined,
    pixelMargin: settings.unit === "px" ? settings.pixelMargin : undefined,
    preview: false,
  });
}
export function exportDimensions(
  result: StoredResult,
  settings: ExportSettings,
) {
  const crop = cropPixels(
    result.job.width,
    result.job.height,
    result.params.crop,
  );
  return outputDimensions(
    crop.width,
    crop.height,
    exportParams(result.params, settings),
  );
}
export function loadExportSettings(): ExportSettings {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || "null");
    if (data?.version !== 1) return { ...EXPORT_DEFAULTS };
    const settings = { ...EXPORT_DEFAULTS, ...data.settings };
    if (!["mm", "px"].includes(settings.unit)) throw new Error();
    exportParams({ ...DEFAULTS }, { ...settings, unit: "mm" });
    exportParams({ ...DEFAULTS }, { ...settings, unit: "px" });
    return settings;
  } catch {
    return { ...EXPORT_DEFAULTS };
  }
}
export function saveExportSettings(settings: ExportSettings) {
  localStorage.setItem(KEY, JSON.stringify({ version: 1, settings }));
}
// The immutable snapshot is captured on confirmation, not when opening the dialog.
export function snapshotExport(
  results: StoredResult[],
  settings: ExportSettings,
) {
  return results.map((result) => ({
    id: result.job.id,
    blob: result.job.blob,
    params: structuredClone(exportParams(result.params, settings)),
  }));
}
export async function renderExportBatch(
  items: ReturnType<typeof snapshotExport>,
  render: (blob: Blob, params: RenderParams) => Promise<Rendered>,
  progress: (done: number) => void,
) {
  const files: { name: string; blob: Blob }[] = [],
    errors: string[] = [],
    warnings: string[] = [];
  for (const [index, item] of items.entries()) {
    try {
      const out = await render(item.blob, item.params);
      files.push({ name: `engraving-${item.id}.png`, blob: out.buffer });
      warnings.push(
        ...out.warnings.map((warning) => `图片 ${index + 1}：${warning}`),
      );
    } catch (error) {
      errors.push(
        `图片 ${index + 1}（${item.id}）：${error instanceof Error ? error.message : "导出失败"}`,
      );
    }
    progress(index + 1);
  }
  return { files, errors, warnings };
}
