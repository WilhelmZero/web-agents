// @vitest-environment node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SCENE_REPLACE_SETTINGS } from '../src/constants';
import type { DesktopCreateJobRequest } from '../src/desktop/types';
import type { SceneReplaceSettings } from '../src/types';
import { DesktopDatabase } from './database';

const temporaryDirectories: string[] = [];

function fixture(startPaused = false) {
  const root = mkdtempSync(join(tmpdir(), 'scene-studio-desktop-'));
  temporaryDirectories.push(root);
  const input = join(root, 'input'); const output = join(root, 'output');
  mkdirSync(input); mkdirSync(output);
  const sourcePath = join(input, 'sample.png'); writeFileSync(sourcePath, Buffer.from('not-an-image'));
  const request: DesktopCreateJobRequest = {
    name: '恢复测试', outputRoot: output, globalConcurrency: 1, startPaused,
    groups: [{ id: 'group', name: 'AM001', relativePath: '产品/AM001', scenes: [{ path: sourcePath, name: 'sample.png', mimeType: 'image/png' }] }],
    config: { tool: 'scene-replace', prompt: '改为家庭吧台', settings: { ...DEFAULT_SCENE_REPLACE_SETTINGS, copiesPerScene: 1 } as SceneReplaceSettings },
  };
  return { root, output, request, databasePath: join(root, 'state.sqlite') };
}

afterEach(() => {
  while (temporaryDirectories.length) rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
});

describe('DesktopDatabase durable queue', () => {
  it('creates a paused batch and starts it only after an explicit resume', () => {
    const { databasePath, request } = fixture(true); const store = new DesktopDatabase(databasePath);
    const id = store.createJob(request);
    expect(store.listJobs()[0]).toMatchObject({ id, status: 'paused', total: 1 });
    expect(store.getJobItems(id)[0]).toMatchObject({ status: 'paused', stage: '等待主控开始' });
    expect(store.claimRunnable(1)).toHaveLength(0);
    store.setJobStatus(id, 'queued');
    expect(store.claimRunnable(1)).toHaveLength(1);
    store.close();
  });

  it('recovers an in-flight item after an unexpected process restart', () => {
    const { databasePath, request } = fixture(); const first = new DesktopDatabase(databasePath);
    const id = first.createJob(request); expect(first.claimRunnable(1)[0]?.status).toBe('running'); first.close();
    const restarted = new DesktopDatabase(databasePath);
    expect(restarted.recoverInterrupted()).toBe(1);
    expect(restarted.getJobItems(id)[0]).toMatchObject({ status: 'queued', stage: '恢复排队' });
    expect(restarted.claimRunnable(1)).toHaveLength(1);
    restarted.close();
  });

  it('allows the renderer to open only registered output trees and artifacts', () => {
    const { databasePath, output, request, root } = fixture(); const store = new DesktopDatabase(databasePath);
    store.createJob(request);
    expect(store.isAllowedOpenPath(output)).toBe(true);
    expect(store.isAllowedOpenPath(join(output, 'nested', 'result.png'))).toBe(true);
    expect(store.isAllowedOpenPath(resolve(root, 'input', 'sample.png'))).toBe(false);
    expect(store.isAllowedOpenPath(resolve(root, '..', 'outside.png'))).toBe(false);
    store.close();
  });
});
