import type { AutoDependencies, AutoRun } from "./types";
export function validateAutoOptions(options?: {
  maxRounds?: number;
  targetScore?: number;
  continueOnGenerated?: boolean;
}): { maxRounds: number; targetScore: number; continueOnGenerated: boolean };
export function runAutoTune(dependencies: AutoDependencies): Promise<AutoRun>;
