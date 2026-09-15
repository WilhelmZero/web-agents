import type { SourceProfile, Review } from "./types";
export const SUBJECT_KINDS: string[];
export const COUNT_SCHEMA: object;
export const PROFILE_SCHEMA: object;
export function validateProfile(v: unknown): SourceProfile;
export function profileRoute(
  p: SourceProfile,
): "portrait" | "cat" | "dog" | "cartoon" | "generic";
export function lockText(p: SourceProfile): string;
export function profilePrompt(context?: unknown): string;
export function validCounts(v: unknown): boolean;
export function sameCounts(
  a: SourceProfile["counts"],
  b: SourceProfile["counts"],
): boolean;
export function verifyReview(
  lock: SourceProfile,
  review: Review,
  audit: SourceProfile,
): Review;
