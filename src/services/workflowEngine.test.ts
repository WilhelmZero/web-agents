import { describe, expect, it } from 'vitest';
import { createsCycle, preferredWorkflowImageSize, predictWorkflow, topologicalOrder, workflowNodeConcurrency, WorkflowSemaphore, type WorkflowNodeData } from './workflowEngine';

const data = (kind: WorkflowNodeData['kind'], files = 0, logos = 0): WorkflowNodeData => ({ label: kind, kind, files: Array(files) as File[], logos: Array(logos) as File[], predictedInput: 0, predictedOutput: 0, sceneOutput: 0, outpaintOutput: 0, success: 0, failed: 0, waiting: 0, status: 'idle', logs: [], config: { concurrency: 3, copies: 1, prompt: kind === 'scene-replace' ? '换场景' : '', imageModel: 'gemini-3.1-flash-image', imageSize: '1K', quality: 'high', autoOutpaint: false, dualOutpaint: false, outpaintWidth: 3200, outpaintHeight: 1310, randomMatch: true } });

describe('workflow engine', () => {
  it('predicts scene, dual outpaint and downstream logo counts', () => {
    const scene = { id: 'scene', data: data('scene-replace', 5) }; scene.data.config.autoOutpaint = true; scene.data.config.dualOutpaint = true;
    const logo = { id: 'logo', data: data('logo-replace', 0, 1) };
    const result = predictWorkflow([scene, logo], [{ id: 'e', source: 'scene', target: 'logo', sourceHandle: 'outpaint-results', targetHandle: 'images' }]);
    expect(result[0].data.sceneOutput).toBe(5); expect(result[0].data.outpaintOutput).toBe(10); expect(result[1].data.predictedInput).toBe(10); expect(result[1].data.predictedOutput).toBe(10);
  });
  it('blocks logo shortage unless random matching is enabled', () => {
    const logo = { id: 'logo', data: data('logo-replace', 5, 1) }; logo.data.config.randomMatch = false;
    expect(predictWorkflow([logo], [])[0].data.error).toContain('Logo 不足');
    logo.data.config.randomMatch = true; expect(predictWorkflow([logo], [])[0].data.error).toBeUndefined();
  });
  it('rejects cycles and sorts a DAG', () => {
    const nodes = [{ id: 'a', data: data('outpaint') }, { id: 'b', data: data('outpaint') }];
    expect(createsCycle(nodes, [{ id: 'ab', source: 'a', target: 'b' }], 'b', 'a')).toBe(true);
    expect(topologicalOrder(nodes, [{ id: 'ab', source: 'a', target: 'b' }])).toEqual(['a', 'b']);
  });
  it('enforces a global concurrency limit', async () => {
    const semaphore = new WorkflowSemaphore(1); let active = 0; let peak = 0;
    await Promise.all([1, 2, 3].map(() => semaphore.run(async () => { active += 1; peak = Math.max(peak, active); await Promise.resolve(); active -= 1; })));
    expect(peak).toBe(1);
  });
  it('defaults image sizes to 2K when supported and otherwise uses the highest available size', () => {
    expect(preferredWorkflowImageSize(['0.5K', '1K', '2K', '4K'])).toBe('2K');
    expect(preferredWorkflowImageSize(['0.5K', '1K'])).toBe('1K');
    expect(preferredWorkflowImageSize()).toBe('2K');
  });
  it('fixes scene and logo replacement nodes to one concurrent job', () => {
    expect(workflowNodeConcurrency('scene-replace', 8)).toBe(1);
    expect(workflowNodeConcurrency('logo-replace', 8)).toBe(1);
    expect(workflowNodeConcurrency('outpaint', 3)).toBe(3);
  });
});
