import type { AutoDependencies, AutoRun } from "./types";
export function validateAutoOptions(options?: {
  maxRounds?: number;
  targetScore?: number;
}): { maxRounds: number; targetScore: number };
export function runAutoTune(dependencies: AutoDependencies): Promise<AutoRun>;
