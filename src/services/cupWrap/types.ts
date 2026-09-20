import type { CupParams } from "./geometry";
export interface ArtLayer {
  id: string;
  blob: Blob;
  x: number;
  y: number;
  width: number;
  rotation: number;
  locked: boolean;
  sourceObjectId?: string;
  pathIndex?: number;
  pathU?: number;
  autoX?: number;
  autoY?: number;
  autoWidth?: number;
  autoRotation?: number;
  manual?: boolean;
}
export type LocalObjectRole = "anchor" | "main" | "decoration" | "excluded";
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
  pathMode?: "auto" | "manual";
  pathCount?: number;
  pathAverageHeight?: number;
  pathGap?: number;
  itemGap?: number;
  showPaths?: boolean;
  backgroundMode: "transparent" | "white" | "color";
  backgroundColor: string;
  cupKey: string;
  unplaced: string[];
}
export interface ImageAdjustment {
  scale: number;
  /** Additional non-uniform scale multipliers; omitted legacy values equal 1. */
  scaleX?: number;
  scaleY?: number;
  x: number;
  y: number;
  warp: number;
  leftGap?: number;
  rightGap?: number;
  topGap?: number;
  bottomGap?: number;
}
export type ArtworkRole = "front" | "back";
export interface ArtworkSlot {
  id: string;
  role: ArtworkRole;
  blob: Blob;
  enabled: boolean;
  scale: number;
  x: number;
  y: number;
  rotation: number;
}
export interface ArtworkMaskPoint {
  x: number;
  y: number;
}
export interface ArtworkMaskStroke {
  id: string;
  mode: "erase" | "restore";
  /** Normalized against the dieline bounding box. */
  points: ArtworkMaskPoint[];
  /** Brush diameter normalized against the shorter dieline side. */
  size: number;
}
export interface WrapDesign {
  id: string;
  name: string;
  cup: CupParams;
  source?: Blob;
  originalSource?: Blob;
  artworkSlots?: ArtworkSlot[];
  /** True when source is the left-to-right composite of artworkSlots. */
  stitchedSource?: boolean;
  maskStrokes?: ArtworkMaskStroke[];
  enabled?: boolean;
  adopted?: Blob;
  aiResults: Blob[];
  aiFrames?: ({ cupKey: string; transparent: boolean } | null)[];
  adoptedFrame?: { cupKey: string; transparent: boolean };
  transparentOutput?: boolean;
  backgroundColor?: string;
  canvasBackground?: "white" | "transparent" | "color";
  canvasBackgroundColor?: string;
  aiAdjustment?: ImageAdjustment;
  adaptationMode?: "original" | "geometry" | "ai" | "local";
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
  cutLine: true,
  margin: 5,
  gap: 2,
  landscape: false,
  rotate: true,
  mode: "fill",
};
