import type { CupParams } from "./geometry";
export interface ArtLayer {
  id: string;
  blob: Blob;
  x: number;
  y: number;
  width: number;
  rotation: number;
  locked: boolean;
}
export type LocalObjectRole = "main" | "decoration" | "excluded";
export interface LocalObject {
  id: string;
  blob: Blob;
  rect: { x: number; y: number; width: number; height: number };
  role: LocalObjectRole;
  duplicateOf?: string;
}
export interface LocalAdaptation {
  sourceWidth: number;
  sourceHeight: number;
  background: string;
  confidence: number;
  objects: LocalObject[];
  layers: ArtLayer[];
  fill: number;
  gap: number;
  scale: number;
  seed: number;
  backgroundMode: "transparent" | "white" | "color";
  backgroundColor: string;
  cupKey: string;
  unplaced: string[];
}
export interface ImageAdjustment {
  scale: number;
  x: number;
  y: number;
  warp: number;
  topGap?: number;
  bottomGap?: number;
}
export interface WrapDesign {
  id: string;
  name: string;
  cup: CupParams;
  source?: Blob;
  originalSource?: Blob;
  adopted?: Blob;
  aiResults: Blob[];
  aiFrames?: ({ cupKey: string; transparent: boolean } | null)[];
  adoptedFrame?: { cupKey: string; transparent: boolean };
  transparentOutput?: boolean;
  backgroundColor?: string;
  aiAdjustment?: ImageAdjustment;
  adaptationMode?: "geometry" | "ai" | "local";
  localAdaptation?: LocalAdaptation;
  fit: "contain" | "cover" | "tile";
  scale: number;
  x: number;
  y: number;
  rotation: number;
  layers: ArtLayer[];
  quantity: number;
  prompt: string;
}
export interface PrintSettings {
  dpi: number;
  bleed: boolean;
  cutLine: boolean;
  margin: number;
  gap: number;
  landscape: boolean;
  rotate: boolean;
  mode: "quantity" | "fill";
}
export const DEFAULT_PRINT: PrintSettings = {
  dpi: 300,
  bleed: false,
  cutLine: false,
  margin: 5,
  gap: 2,
  landscape: false,
  rotate: true,
  mode: "fill",
};
