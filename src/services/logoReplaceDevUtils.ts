import type { LogoAsset, SceneLogoAnalysis } from '../types';

function stableHash(value: string) {
  return [...value].reduce((hash, char) => ((hash * 33) ^ char.charCodeAt(0)) >>> 0, 5381);
}

export function assignMultipleLogos(
  sceneIds: string[],
  analyses: Record<string, SceneLogoAnalysis>,
  logos: LogoAsset[],
  seed: string,
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const sceneId of sceneIds) {
    const required = Math.max(1, analyses[sceneId]?.styles.length || 1);
    if (!logos.length) { result[sceneId] = []; continue; }
    const offset = stableHash(`${seed}-${sceneId}`) % logos.length;
    result[sceneId] = Array.from({ length: Math.min(required, logos.length) }, (_, index) => logos[(offset + index) % logos.length].id);
  }
  return result;
}

