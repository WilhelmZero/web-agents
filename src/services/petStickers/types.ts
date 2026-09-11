export const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
export const WIDTH = 7717;
export const HEIGHT = 4346;
export type Pose = "full" | "top" | "side";
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Sprite {
  id: string;
  name: string;
  kind: "character" | "decoration";
  pose: Pose;
  src: string;
  blob?: Blob;
  width: number;
  height: number;
  reviewed: boolean;
  characterId?: string;
  contact?: { x: number; y: number };
  frontSrc?: string;
  rearSrc?: string;
  reviewNotes?: string;
}
export interface PetLibrary {
  version: 1;
  id: string;
  name: string;
  assets: Sprite[];
  source?: Blob;
  builtin?: boolean;
  candidates?: PoseCandidate[];
}
export interface PetSettings {
  fontKey?: string;
  density?: number;
  letters: string[];
  height: number;
  fill: string;
  fillEnd: string;
  gradient: boolean;
  stroke: string;
  strokeWidth: number;
  background: "transparent" | "#00aeff";
  scale: 1 | 0.75 | 0.5;
  seed: number;
}
export interface Placement extends Rect {
  id: string;
  spriteId: string;
  interaction: boolean;
}
export interface Glyph extends Rect {
  fontSize: number;
  baseline: number;
  originX: number;
}
export interface Layout {
  letter: string;
  seed: number;
  glyph: Glyph;
  placements: Placement[];
  warnings: string[];
}
export interface PetResult {
  id: string;
  libraryId: string;
  layout: Layout;
  settings: PetSettings;
  status: "waiting" | "running" | "success" | "failed" | "stopped";
  preview?: Blob;
  error?: string;
  startedAt?: number;
  endedAt?: number;
}
export interface PoseCandidate {
  id: string;
  characterId: string;
  pose: "top" | "side";
  blob?: Blob;
  status: "waiting" | "running" | "review" | "accepted" | "failed" | "stopped";
  error?: string;
  contact: { x: number; y: number };
  notes: string;
}
export const DEFAULT_SETTINGS: PetSettings = {
  fontKey: "barlow-medium",
  density: 70,
  letters: LETTERS,
  height: 83,
  fill: "#ffac22",
  fillEnd: "#ff7900",
  gradient: true,
  stroke: "#111111",
  strokeWidth: 18,
  background: "transparent",
  scale: 1,
  seed: 20260911,
};
