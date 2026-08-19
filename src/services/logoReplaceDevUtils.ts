import type { LogoAsset, SceneLogoAnalysis, SceneLogoStyle } from '../types';

function stableHash(value: string) {
  return [...value].reduce((hash, char) => ((hash * 33) ^ char.charCodeAt(0)) >>> 0, 5381);
}

export function assignMultipleLogos(
  sceneIds: string[],
  analyses: Record<string, SceneLogoAnalysis>,
  logos: LogoAsset[],
  seed: string,
  distinctPerOccurrence = false,
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const sceneId of sceneIds) {
    const styles = analyses[sceneId]?.styles || [];
    const required = Math.max(1, distinctPerOccurrence
      ? styles.reduce((sum, style) => sum + Math.max(1, style.occurrences || 1), 0)
      : styles.length || 1);
    if (!logos.length) { result[sceneId] = []; continue; }
    const offset = stableHash(`${seed}-${sceneId}`) % logos.length;
    result[sceneId] = Array.from({ length: distinctPerOccurrence ? required : Math.min(required, logos.length) }, (_, index) => logos[(offset + index) % logos.length].id);
  }
  return result;
}

export function expandStylesByOccurrence(styles: SceneLogoStyle[], distinctPerOccurrence: boolean): SceneLogoStyle[] {
  if (!distinctPerOccurrence) return styles;
  return styles.flatMap((style) => Array.from({ length: Math.max(1, style.occurrences || 1) }, (_, index) => ({
    ...style,
    id: `${style.id}-occurrence-${index + 1}`,
    label: `${style.label} · 位置 ${index + 1}`,
    description: `${style.description}；相同样式的第 ${index + 1}/${Math.max(1, style.occurrences || 1)} 个位置，按画面从上到下、从左到右排序定位`,
    occurrences: 1,
  })));
}
