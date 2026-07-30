import { describe, expect, it } from 'vitest';
import type { LogoAsset, LogoInpaintMask, LogoPair, LogoPlacement } from '../types';
import { buildLogoPairs, buildLogoTasks, logoTaskFileName, makeLogoResultGroups } from './logoUtils';

const makeAsset = (id: string): LogoAsset => ({
  id,
  file: new File(['image'], `${id}.png`, { type: 'image/png' }),
  name: `${id}.png`,
  mimeType: 'image/png',
  previewUrl: `blob:${id}`,
});

describe('Logo pairing and task helpers', () => {
  it('按索引配对，并保留定位数据', () => {
    const placement: LogoPlacement = { x: 0.4, y: 0.6, width: 0.2, rotation: 15 };
    const pairs = buildLogoPairs(
      [makeAsset('scene-1'), makeAsset('scene-2')],
      [makeAsset('logo-1')],
      { 0: placement },
    );
    expect(pairs).toHaveLength(2);
    expect(pairs[0].scene?.id).toBe('scene-1');
    expect(pairs[0].logo?.id).toBe('logo-1');
    expect(pairs[0].placement).toEqual(placement);
    expect(pairs[1].logo).toBeUndefined();
  });

  it('按组保留局部重绘参考图', () => {
    const mask: LogoInpaintMask = { mode: 'brush', guideDataUrl: 'data:image/png;base64,bWFzaw==' };
    const pairs = buildLogoPairs(
      [makeAsset('scene-1')],
      [makeAsset('logo-1')],
      {},
      { 0: mask },
    );
    expect(pairs[0].inpaintMask).toEqual(mask);
  });

  it('为每组展开指定数量的独立请求任务', () => {
    const pairs = buildLogoPairs(
      [makeAsset('scene-1'), makeAsset('scene-2')],
      [makeAsset('logo-1'), makeAsset('logo-2')],
    );
    const tasks = buildLogoTasks(pairs, 3);
    expect(tasks).toHaveLength(6);
    expect(tasks.filter((task) => task.pairId === 'logo-pair-0').map((task) => task.copyIndex)).toEqual([0, 1, 2]);
  });

  it('存在未配对图片时拒绝创建任务', () => {
    const pairs = buildLogoPairs([makeAsset('scene-1')], []);
    expect(() => buildLogoTasks(pairs, 1)).toThrow('每组');
  });

  it('聚合结果状态并生成稳定文件名', () => {
    const pair = buildLogoPairs([makeAsset('scene')], [makeAsset('logo')])[0] as LogoPair;
    const tasks = buildLogoTasks([pair], 2);
    tasks[0] = { ...tasks[0], status: 'success', resultMimeType: 'image/jpeg' };
    tasks[1] = { ...tasks[1], status: 'failed', error: '限流' };
    const group = makeLogoResultGroups([pair], tasks)[0];
    expect(group.successCount).toBe(1);
    expect(group.failedCount).toBe(1);
    expect(logoTaskFileName(tasks[0], pair, 'model')).toContain('01_scene_01_model.jpg');
  });
});
