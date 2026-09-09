import type { Review, RenderParams } from "./types";
export const SCORE_KEYS: (keyof Review["scores"])[];
export const ADJUST_KEYS: (keyof Review["adjustments"])[];
export const ISSUES: Record<string, string>;
export const REVIEW_SCHEMA: object;
export function validateReview(value: unknown): Review;
export function buildReviewPrompt(
  params: RenderParams,
  instructions?: string,
): string;
