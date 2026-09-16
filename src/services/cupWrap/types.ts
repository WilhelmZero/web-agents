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
export interface WrapDesign {
  id: string;
  name: string;
  cup: CupParams;
  source?: Blob;
  originalSource?: Blob;
  adopted?: Blob;
  aiResults: Blob[];
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
  margin: number;
  gap: number;
  landscape: boolean;
  rotate: boolean;
  mode: "quantity" | "fill";
}
export const DEFAULT_PRINT: PrintSettings = {
  dpi: 300,
  bleed: false,
  margin: 5,
  gap: 2,
  landscape: false,
  rotate: true,
  mode: "quantity",
};
