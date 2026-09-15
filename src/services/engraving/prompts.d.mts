import type { Subject, Style } from "./types";
export function buildPrompt(options?: {
  subject?: Subject;
  sourceProfile?: import("./types").SourceProfile;
  instructions?: string;
  style?: Style;
  hasReference?: boolean;
  feedback?: string;
  editMode?: boolean;
  outpaint?: import("./types").OutpaintOptions;
}): string;
