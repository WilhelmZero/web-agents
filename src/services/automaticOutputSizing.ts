import type { AutomaticOutputRatioMode, OpenAiImageOutputSize } from "../types";
import { closestAspectRatio } from "./outpaint";

export const OPENAI_IMAGE_OUTPUT_SIZES: OpenAiImageOutputSize[] = [
  "1024x1024",
  "1536x1024",
  "1024x1536",
];

export function automaticAspectRatio(options: {
  mode: AutomaticOutputRatioMode;
  sourceWidth: number;
  sourceHeight: number;
  fixedRatio: string;
  supportedRatios: string[];
}) {
  if (options.mode === "unspecified") return undefined;
  if (options.mode === "fixed") return options.fixedRatio;
  return closestAspectRatio(
    options.sourceWidth,
    options.sourceHeight,
    options.supportedRatios,
  );
}

export function automaticOpenAiSize(options: {
  mode: AutomaticOutputRatioMode;
  sourceWidth: number;
  sourceHeight: number;
  fixedSize: OpenAiImageOutputSize;
}) {
  if (options.mode === "unspecified") return undefined;
  if (options.mode === "fixed") return options.fixedSize;
  const sourceRatio = options.sourceWidth / options.sourceHeight;
  return OPENAI_IMAGE_OUTPUT_SIZES.reduce((best, size) => {
    const [width, height] = size.split("x").map(Number);
    const [bestWidth, bestHeight] = best.split("x").map(Number);
    return Math.abs(width / height - sourceRatio) <
      Math.abs(bestWidth / bestHeight - sourceRatio)
      ? size
      : best;
  });
}

export const shouldRestoreOriginalDimensions = (
  mode: AutomaticOutputRatioMode,
) => mode === "original";
