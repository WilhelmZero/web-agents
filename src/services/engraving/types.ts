export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface RenderParams {
  crop?: CropRect | null;
  pixelWidth?: number;
  pixelMargin?: number;
  texture: number;
  contrast: number;
  brightness: number;
  shadow: number;
  blackPoint: number;
  mode: "grayscale" | "dither";
  widthMm: number;
  dpi: number;
  margin: number;
  invert: boolean;
  preview?: boolean;
  previewEdge?: number;
  eraseMask?: string;
}
export type Subject = "auto" | "portrait" | "pet" | "group" | "horse";
export type Style = "strong" | "natural";
export interface Config {
  baseUrl: string;
  imageModel: string;
  reviewModel: string;
  quality: "low" | "medium" | "high" | "auto";
  apiKey: string;
}
export interface Preferences extends Omit<Config, "apiKey"> {
  subject: Subject;
  style: Style;
  reference: "portrait" | "couple" | "bouquet";
  instructions: string;
  auto: boolean;
  continueOnGenerated: boolean;
  maxRounds: number;
  targetScore: number;
}
export interface ImageJob {
  id: string;
  blob: Blob;
  width: number;
  height: number;
  warnings: string[];
}
export interface Review {
  suggestions?: string;
  scores: Record<
    "identity" | "subjects" | "hair" | "texture" | "background" | "tones",
    number
  >;
  issues: string[];
  action: "accept" | "adjust" | "regenerate";
  adjustments: Pick<
    RenderParams,
    "texture" | "contrast" | "brightness" | "shadow" | "blackPoint"
  >;
}
export interface Candidate {
  job: ImageJob;
  params: RenderParams;
  round: number;
  assessed?: boolean;
  editedFromRound?: number;
  editedFromJobId?: string;
}
export interface Round extends Candidate, Omit<Review, "action"> {
  action: "generate" | "adjust";
  reviewAction: Review["action"];
  score: number;
  passed: boolean;
  issueLabels: string[];
}
export interface AutoRun {
  status:
    "running" | "completed" | "limit" | "cancelled" | "failed" | "interrupted";
  phase: string;
  maxRounds: number;
  targetScore: number;
  generations: number;
  checks: number;
  rounds: Round[];
  best: Round | null;
  fallback: Candidate | null;
  error?: string;
}
export interface Rendered {
  buffer: Blob;
  width: number;
  height: number;
  warnings: string[];
}
export interface GenerateInput {
  editMode?: boolean;
  originalImage?: Blob;
  image: Blob;
  referenceImage: Blob;
  config: Config;
  subject: Subject;
  instructions: string;
  style: Style;
  feedback?: string;
}
export interface ReviewInput {
  original: Blob;
  reference: Blob;
  rendered: Blob;
  config: Config;
  params: RenderParams;
  instructions: string;
}
export interface AutoDependencies {
  original: Blob;
  reference: Blob;
  config: Config;
  subject: Subject;
  instructions: string;
  style: Style;
  params: RenderParams;
  options: { maxRounds: number; targetScore: number; continueOnGenerated?: boolean };
  generate: (
    input: GenerateInput,
  ) => Promise<{ buffer: Blob; warnings: string[] }>;
  review: (input: ReviewInput) => Promise<Review>;
  render: (source: Blob, params: RenderParams) => Promise<Rendered>;
  saveCandidate: (source: Blob, warnings: string[]) => Promise<ImageJob>;
  publish: (run: AutoRun) => Promise<void>;
  cancelled: () => boolean;
}
export interface SavedTask {
  version: 1;
  original?: Blob;
  fileName: string;
  job?: ImageJob;
  params: RenderParams;
  run?: AutoRun;
  startedAt?: number;
  endedAt?: number;
  customReference?: Blob;
  results?: StoredResult[];
}
export interface StoredResult {
  manualParams?: Partial<RenderParams>;
  job: ImageJob;
  params: RenderParams;
  initialParams: RenderParams;
  reviews: Round[];
  prompt?: string;
  reference?: Blob;
  createdAt: number;
}
