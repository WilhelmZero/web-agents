export type ImageModel =
  | 'gemini-3.1-flash-lite-image'
  | 'gemini-3.1-flash-image'
  | 'gemini-3-pro-image'
  | 'gemini-2.5-flash-image';

export type OptimizerModel =
  | 'gemini-3.1-flash-lite'
  | 'gemini-3.1-flash'
  | 'gemini-2.5-flash';

export type CombinationMode = 'cartesian' | 'paired';
export type TaskStatus = 'waiting' | 'running' | 'success' | 'failed' | 'stopped';
export type ImageSize = '0.5K' | '1K' | '2K' | '4K';
export type CreationTool = 'scene' | 'scene-replace' | 'logo' | 'logo-replace' | 'logo-replace-dev' | 'paper-text' | 'object-replace' | 'inpaint' | 'product-detail';

export interface AppSettings {
  apiKey: string;
  openAiApiKey: string;
  connectionMode: 'direct' | 'proxy';
  proxyUrl: string;
  imageModel: ImageModel;
  optimizerModel: OptimizerModel;
  aspectRatio: string;
  imageSize: ImageSize;
  concurrency: number;
  combinationMode: CombinationMode;
}

export interface ProductImage {
  id: string;
  file: File;
  name: string;
  mimeType: string;
  previewUrl: string;
  individualPrompt?: string;
}

export interface IndividualPromptPreset {
  id: string;
  name: string;
  content: string;
}

export interface PromptItem {
  id: string;
  content: string;
  optimizing?: boolean;
  originalContent?: string;
}

export interface GenerationTask {
  id: string;
  productId: string;
  productIndex: number;
  promptId: string;
  promptIndex: number;
  prompt: string;
  status: TaskStatus;
  resultBlob?: Blob;
  resultUrl?: string;
  resultMimeType?: string;
  error?: string;
  retryCount: number;
}

export interface ResultGroup {
  product: ProductImage;
  tasks: GenerationTask[];
  successCount: number;
  failedCount: number;
}

export interface PromptPreset {
  id: string;
  name: string;
  content: string;
  prompts?: string[];
  updatedAt: number;
  builtIn?: boolean;
}

export interface ModelCapability {
  label: string;
  description: string;
  aspectRatios: string[];
  imageSizes: ImageSize[];
  defaultSize: ImageSize;
}

export interface PricingEntry {
  outputBySize: Partial<Record<ImageSize, number>>;
  inputImage: number;
}

export interface PricingCatalog {
  updatedAt: string;
  source: string;
  models: Record<ImageModel, PricingEntry>;
}

export interface GeneratedImage {
  blob: Blob;
  mimeType: string;
  usageTokens?: number;
}

export interface GlassLogoEtchOptions {
  scaleRatio: number;
  topMarginRatio: number;
  logoColor: 'white' | 'black';
  textureMode: 'laser_etch' | 'print';
  applyAllCups: boolean;
  outputCoordinateMode: 'relative_percent' | 'pixel';
}

export interface LogoAsset {
  id: string;
  file: File;
  name: string;
  mimeType: string;
  previewUrl: string;
}

export interface LogoPlacement {
  x: number;
  y: number;
  width: number;
  rotation: number;
  invertForGuide?: boolean;
}

export interface LogoInpaintMask {
  mode: 'box' | 'brush';
  guideDataUrl: string;
}

export interface LogoPair {
  id: string;
  index: number;
  scene?: LogoAsset;
  logo?: LogoAsset;
  placement?: LogoPlacement;
  inpaintMask?: LogoInpaintMask;
}

export interface LogoSettings {
  imageModel: ImageModel;
  optimizerModel: OptimizerModel;
  ratioMode: 'original' | 'fixed';
  aspectRatio: string;
  imageSize: ImageSize;
  concurrency: number;
  copiesPerGroup: number;
  useGlassLogoEtchSkill: boolean;
  glassEtchScaleRatio: number;
  glassEtchTopMarginRatio: number;
  glassEtchLogoColor: 'white' | 'black';
  glassEtchTextureMode: 'laser_etch' | 'print';
  glassEtchApplyAllCups: boolean;
  glassEtchOutputCoordinateMode: 'relative_percent' | 'pixel';
}

export interface LogoReplaceSettings {
  useOldLogoReference: boolean;
  imageModel: ImageModel;
  ratioMode: 'original' | 'fixed';
  aspectRatio: string;
  imageSize: ImageSize;
  concurrency: number;
  copiesPerScene: number;
  logoColorMode: 'original' | 'white' | 'black' | 'custom';
  customLogoColor: string;
  engravingMode: 'auto' | 'custom';
  glassEngravingEnabled: boolean;
  woodEngravingEnabled: boolean;
  customEngravingEnabled: boolean;
  woodEngravingStyle: 'auto' | 'dark-burn' | 'natural-recessed' | 'custom';
  woodEngravingColorDepth: number;
  customWoodEngravingMethod: string;
  customEngravingObject: string;
  engravingMethod: string;
  randomAssignLogos: boolean;
  customizeReplacementPrompt: boolean;
  replacementPrompt: string;
  strictTextVerification: boolean;
  verificationModel: OptimizerModel;
  verificationRetries: number;
}

export interface ObjectPreservationOptions {
  print: boolean;
  logo: boolean;
  engraving: boolean;
  liquid: boolean;
  foam: boolean;
  custom: string[];
}

export interface ObjectReplaceSettings {
  imageModel: ImageModel;
  ratioMode: 'original' | 'fixed';
  aspectRatio: string;
  imageSize: ImageSize;
  concurrency: number;
  copiesPerScene: number;
  sourceObjectName: string;
  targetObjectName: string;
  preservation: ObjectPreservationOptions;
}

export interface ObjectReplaceTask {
  id: string;
  sceneId: string;
  sceneIndex: number;
  copyIndex: number;
  status: TaskStatus;
  resultBlob?: Blob;
  resultUrl?: string;
  resultMimeType?: string;
  error?: string;
  retryCount: number;
}

export interface SceneReplaceSettings {
  imageModel: ImageModel;
  ratioMode: 'original' | 'fixed';
  aspectRatio: string;
  imageSize: ImageSize;
  concurrency: number;
  copiesPerScene: number;
}

export interface SceneReplaceTask {
  id: string;
  sceneId: string;
  sceneIndex: number;
  copyIndex: number;
  status: TaskStatus;
  prompt: string;
  resultBlob?: Blob;
  resultUrl?: string;
  resultMimeType?: string;
  error?: string;
  retryCount: number;
}
export interface LogoExpectedText {
  logoId: string;
  text: string;
}

export interface LogoVerificationResult {
  passed: boolean;
  referenceText: string;
  generatedText: string;
  differences: string[];
  graphicConsistent: boolean;
  summary: string;
  materialIntegrated?: boolean;
  placementConsistent?: boolean;
  originalLogoRemoved?: boolean;
  flatOverlayDetected?: boolean;
}
export interface LogoReplaceTask {
  id: string;
  sceneId: string;
  sceneIndex: number;
  newLogoId: string;
  copyIndex: number;
  status: TaskStatus;
  resultBlob?: Blob;
  resultUrl?: string;
  resultMimeType?: string;
  error?: string;
  retryCount: number;
  verificationStatus?: 'pending' | 'verifying' | 'passed' | 'failed' | 'skipped';
  verificationResult?: LogoVerificationResult;
  verificationAttempts?: number;
  acceptedVerificationRisk?: boolean;
}

export interface SceneLogoStyle {
  id: string;
  label: string;
  description: string;
  occurrences: number;
  carrier: string;
}

export interface SceneLogoAnalysis {
  sceneId: string;
  status: 'waiting' | 'analyzing' | 'success' | 'failed';
  styles: SceneLogoStyle[];
  summary?: string;
  error?: string;
}

export interface LogoReplaceDevTask {
  id: string;
  sceneId: string;
  sceneIndex: number;
  newLogoIds: string[];
  copyIndex: number;
  status: TaskStatus;
  resultBlob?: Blob;
  resultUrl?: string;
  resultMimeType?: string;
  error?: string;
  retryCount: number;
}
export interface InpaintSettings {
  imageModel: ImageModel;
  optimizerModel: OptimizerModel;
  ratioMode: 'original' | 'fixed';
  aspectRatio: string;
  imageSize: ImageSize;
}

export interface ProductDetailSettings {
  analyzerModel: OptimizerModel;
  imageModel: ImageModel;
  ratioMode: 'original' | 'fixed';
  aspectRatio: string;
  imageSize: ImageSize;
  concurrency: number;
  targetCount: number;
}

export interface ProductDetailPrompt {
  id: string;
  index: number;
  title: string;
  content: string;
  overlayTexts: string[];
}

export interface ProductDetailTask {
  id: string;
  promptId: string;
  status: TaskStatus;
  resultBlob?: Blob;
  resultUrl?: string;
  resultMimeType?: string;
  error?: string;
  retryCount: number;
}

export interface LogoGenerationTask {
  id: string;
  pairId: string;
  pairIndex: number;
  copyIndex: number;
  status: TaskStatus;
  resultBlob?: Blob;
  resultUrl?: string;
  resultMimeType?: string;
  error?: string;
  retryCount: number;
}

export interface LogoResultGroup {
  pair: LogoPair;
  tasks: LogoGenerationTask[];
  successCount: number;
  failedCount: number;
}

export interface LogoPromptPreset {
  id: string;
  name: string;
  content: string;
  builtIn: boolean;
  updatedAt: number;
}
