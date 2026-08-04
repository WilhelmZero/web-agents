import type { LogoAsset, LogoReplaceTask } from '../types';
import { createId } from '../utils';

export interface LogoReplacementPairing {
  scene: LogoAsset;
  logo?: LogoAsset;
}

function stableHash(value: string) {
  return [...value].reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) >>> 0, 2166136261);
}

export function assignReplacementLogos(
  scenes: LogoAsset[],
  logos: LogoAsset[],
  random: boolean,
  seed: string,
): LogoReplacementPairing[] {
  return scenes.map((scene, index) => ({
    scene,
    logo: random && logos.length
      ? logos[stableHash(`${scene.id}-${seed}`) % logos.length]
      : logos[index],
  }));
}

export function buildLogoReplaceTasks(pairings: LogoReplacementPairing[], copiesPerScene: number): LogoReplaceTask[] {
  if (!pairings.length || pairings.some((pairing) => !pairing.logo)) {
    throw new Error('每张场景图都必须匹配一个新 Logo');
  }
  return pairings.flatMap(({ scene, logo }, sceneIndex) => Array.from({ length: copiesPerScene }, (_, copyIndex) => ({
    id: createId(),
    sceneId: scene.id,
    sceneIndex,
    newLogoId: logo!.id,
    copyIndex,
    status: 'waiting' as const,
    retryCount: 0,
  })));
}