import type { RenderParams } from "./types";
export const DEFAULTS: Readonly<RenderParams>;
export const MAX_IMAGE_PIXELS: number;
export const MAX_IMAGE_EDGE: number;
export function validateOptions(options?: Partial<RenderParams>): RenderParams;
export function outputDimensions(
  width: number,
  height: number,
  options: RenderParams,
): {
  width: number;
  height: number;
  contentWidth: number;
  contentHeight: number;
  margin: number;
};
export function preparePixels(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  options: RenderParams,
  mask?: Uint8ClampedArray | null,
): { grayAlpha: Uint8Array; width: number; height: number; visible: number };
export function enhance(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  options: RenderParams,
): Promise<{ gray: Uint8Array; coverage: Uint8Array }>;
export function dither(
  gray: Uint8Array,
  coverage: Uint8Array,
  width: number,
  height: number,
): Uint8Array;
