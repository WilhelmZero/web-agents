export const AI_PET_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

export type AiPetLetterModel =
  | "gpt-image-2.5-sunburst"
  | "gpt-image-2.5-flare"
  | "gpt-image-2";
export type AiPetLetterQuality =
  | "auto"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";
export type AiPetLetterOutputMode = "direct-background" | "transparent-colorize";
export type AiPetLetterDownloadVariant = "colorized" | "transparent";
export type AiPetLetterTaskStatus =
  | "waiting"
  | "running"
  | "success"
  | "failed"
  | "stopped"
  | "interrupted";

export interface AiPetLetterSettings {
  version: 2;
  model: AiPetLetterModel;
  quality: AiPetLetterQuality;
  concurrency: number;
  downloadSize: "native" | "high-res";
  outputMode: AiPetLetterOutputMode;
  backgroundColor: string;
  downloadVariant: AiPetLetterDownloadVariant;
  cropZoom: number;
  cropX: number;
  cropY: number;
}

export interface AiPetLetterPrompt {
  letter: string;
  defaultPrompt: string;
  currentPrompt: string;
  selected: boolean;
  optimizing?: boolean;
}

export interface AiPetLetterMask {
  blob: Blob;
  version: number;
  confirmed: boolean;
  source: "default" | "automatic" | "manual";
  warning?: string;
}

export interface AiPetLetterResult {
  letter: string;
  rawBlob: Blob;
  compositeBlob: Blob;
  outputMode?: AiPetLetterOutputMode;
  backgroundColor?: string;
  referenceFingerprint: string;
  width: number;
  height: number;
  createdAt: number;
}

export interface AiPetLetterTask {
  letter: string;
  status: AiPetLetterTaskStatus;
  prompt: string;
  model: AiPetLetterModel;
  quality: AiPetLetterQuality;
  outputMode?: AiPetLetterOutputMode;
  backgroundColor?: string;
  retries: number;
  startedAt?: number;
  endedAt?: number;
  error?: string;
  result?: AiPetLetterResult;
}

export interface AiPetLetterWorkspace {
  referenceBlob?: Blob;
  referenceFingerprint?: string;
  referenceName?: string;
  mask?: AiPetLetterMask;
  tasks: AiPetLetterTask[];
  updatedAt: number;
}

export const DEFAULT_AI_PET_LETTER_SETTINGS: AiPetLetterSettings = {
  version: 2,
  model: "gpt-image-2.5-sunburst",
  quality: "xhigh",
  concurrency: 1,
  downloadSize: "high-res",
  outputMode: "direct-background",
  backgroundColor: "#00aeff",
  downloadVariant: "colorized",
  cropZoom: 1,
  cropX: 0,
  cropY: 0,
};

export function qualityOptions(model: AiPetLetterModel): AiPetLetterQuality[] {
  return model === "gpt-image-2"
    ? ["auto", "low", "medium", "high"]
    : ["auto", "low", "medium", "high", "xhigh", "max"];
}

export function normalizeQuality(
  model: AiPetLetterModel,
  quality: AiPetLetterQuality,
): AiPetLetterQuality {
  return qualityOptions(model).includes(quality) ? quality : "high";
}
