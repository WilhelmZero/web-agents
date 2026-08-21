import type { LogoRemovalSettings, LogoReplaceSettings, SceneReplaceSettings } from '../types';

export type DesktopJobTool = 'scene-replace' | 'logo-replace' | 'logo-removal';
export type DesktopJobStatus = 'queued' | 'analyzing' | 'running' | 'verifying' | 'retry_wait' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'interrupted';

export interface DesktopAssetInput {
  path: string;
  name: string;
  mimeType: string;
  relativePath?: string;
}

export interface DesktopJobGroupInput {
  id: string;
  name: string;
  relativePath: string;
  scenes: DesktopAssetInput[];
  logos?: DesktopAssetInput[];
  oldLogo?: DesktopAssetInput;
  prompt?: string;
}

export interface DesktopSceneJobConfig {
  tool: 'scene-replace';
  settings: SceneReplaceSettings;
  prompt: string;
  perImagePromptPrefix?: string;
}

export interface DesktopLogoJobConfig {
  tool: 'logo-replace';
  settings: LogoReplaceSettings;
  expectedTexts?: Record<string, string>;
  distinctLogoPerOccurrence?: boolean;
}

export interface DesktopLogoRemovalJobConfig {
  tool: 'logo-removal';
  settings: LogoRemovalSettings;
}

export type DesktopJobConfig = DesktopSceneJobConfig | DesktopLogoJobConfig | DesktopLogoRemovalJobConfig;

export interface DesktopCreateJobRequest {
  name: string;
  outputRoot: string;
  globalConcurrency: number;
  /** Creates a durable queue that must be explicitly resumed from the controller. */
  startPaused?: boolean;
  apiBaseUrl?: string | null;
  groups: DesktopJobGroupInput[];
  config: DesktopJobConfig;
}

export interface DesktopJobSummary {
  id: string;
  name: string;
  tool: DesktopJobTool;
  status: DesktopJobStatus;
  outputRoot: string;
  total: number;
  completed: number;
  failed: number;
  running: number;
  queued: number;
  actualRequests: number;
  estimatedMinCost: number;
  estimatedMaxCost: number;
  /** Running estimate based on requests that have actually completed. */
  estimatedCost: number;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  error?: string;
}

export interface DesktopJobItem {
  id: string;
  jobId: string;
  groupId: string;
  sourceName: string;
  sourcePath: string;
  status: DesktopJobStatus;
  stage: string;
  copyIndex: number;
  retryCount: number;
  maxRetries: number;
  nextRetryAt?: number;
  outputPath?: string;
  thumbnailPath?: string;
  error?: string;
  prompt?: string;
  updatedAt: number;
}

export interface DesktopJobEvent {
  id: number;
  jobId?: string;
  itemId?: string;
  level: 'info' | 'warning' | 'error';
  type: string;
  message: string;
  createdAt: number;
}

export interface DesktopResourceSnapshot {
  timestamp: number;
  appMemoryBytes: number;
  mainMemoryBytes: number;
  rendererMemoryBytes: number;
  systemTotalMemoryBytes: number;
  systemFreeMemoryBytes: number;
  systemMemoryPercent: number;
  cpuPercent: number;
  uptimeSeconds: number;
  activeRequests: number;
  globalConcurrency: number;
  guardPaused: boolean;
  guardReason?: string;
  diskFreeBytes?: number;
}

export interface DesktopSecretState {
  geminiConfigured: boolean;
  openAiConfigured: boolean;
}

export interface DesktopRuntimeInfo {
  isPackaged: boolean;
  version: string;
  platform: string;
  launchAtLogin: boolean;
  databasePath: string;
}

export interface DesktopApi {
  getPathForFile(file: File): string;
  pickOutputDirectory(): Promise<string | null>;
  pickInputDirectory(): Promise<string | null>;
  getRuntimeInfo(): Promise<DesktopRuntimeInfo>;
  setLaunchAtLogin(value: boolean): Promise<boolean>;
  getSecretState(): Promise<DesktopSecretState>;
  setSecrets(value: { gemini?: string; openAi?: string }): Promise<DesktopSecretState>;
  createJob(request: DesktopCreateJobRequest): Promise<string>;
  listJobs(): Promise<DesktopJobSummary[]>;
  getJobItems(jobId: string): Promise<DesktopJobItem[]>;
  getJobEvents(jobId?: string): Promise<DesktopJobEvent[]>;
  pauseJob(jobId: string): Promise<void>;
  resumeJob(jobId: string): Promise<void>;
  cancelJob(jobId: string): Promise<void>;
  retryJob(jobId: string): Promise<void>;
  pauseAll(): Promise<void>;
  resumeAll(): Promise<void>;
  revealPath(path: string): Promise<void>;
  openPath(path: string): Promise<void>;
  readThumbnail(path: string): Promise<string | null>;
  getResourceSnapshot(): Promise<DesktopResourceSnapshot>;
  onJobsChanged(callback: () => void): () => void;
  onResourcesChanged(callback: (snapshot: DesktopResourceSnapshot) => void): () => void;
}
