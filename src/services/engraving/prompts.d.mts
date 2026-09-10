import type { Subject, Style } from "./types";
export function buildPrompt(options?: {
  subject?: Subject;
  instructions?: string;
  style?: Style;
  hasReference?: boolean;
  feedback?: string;
  editMode?: boolean;
}): string;
