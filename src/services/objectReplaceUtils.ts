import type { LogoAsset, ObjectReplaceTask } from '../types';
import { createId } from '../utils';

export function buildObjectReplaceTasks(scenes: LogoAsset[], copiesPerScene: number): ObjectReplaceTask[] {
  return scenes.flatMap((scene, sceneIndex) => Array.from({ length: copiesPerScene }, (_, copyIndex) => ({
    id: createId(),
    sceneId: scene.id,
    sceneIndex,
    copyIndex,
    status: 'waiting' as const,
    retryCount: 0,
  })));
}