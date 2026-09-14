import type { Config } from "./types";
export const IMAGE_MODEL_OPTIONS = [
  "gpt-image-2.5-sunburst", "gpt-image-2.5-flare", "gpt-image-2", "gpt-image-1.5", "gpt-image-1", "gpt-image-1-mini",
].map(value => ({value, label: value}));
export const IMAGE_QUALITIES: Config["quality"][] = ["low", "medium", "high", "xhigh", "max", "auto"];
export function supportsQuality(model: string, quality: Config["quality"]) {
  // Unknown provider model IDs remain usable; only restrict known legacy models.
  return !/^gpt-image-(?:2|1(?:\.5|-mini)?)(?:-\d{4}-\d{2}-\d{2})?$/.test(model.trim()) || !["xhigh", "max"].includes(quality);
}
