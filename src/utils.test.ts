import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './constants';
import type { ProductImage, PromptItem } from './types';
import {
  buildTasks,
  estimateImageCost,
  normalizeSettingsForModel,
  sanitizeFileName,
  splitPrompts,
} from './utils';

const file = new File(['x'], 'product.png', { type: 'image/png' });
const products: ProductImage[] = [0, 1].map((index) => ({
  id: `product-${index}`,
  file,
  name: `product-${index}.png`,
  mimeType: 'image/png',
  previewUrl: `blob:${index}`,
}));
const prompts: PromptItem[] = [
  { id: 'prompt-1', content: '桌面场景' },
  { id: 'prompt-empty', content: '   ' },
  { id: 'prompt-2', content: '户外场景' },
];

describe('splitPrompts', () => {
  it('按自定义分隔符切割、修剪并过滤空段', () => {
    expect(splitPrompts(' 第一条 --- --- 第二条 ', '---')).toEqual(['第一条', '第二条']);
  });
  it('空分隔符将全文视为一条', () => {
    expect(splitPrompts('  一整条  ', '')).toEqual(['一整条']);
  });
  it('支持 Windows 和 Unix 回车换行分割', () => {
    expect(splitPrompts('第一条\r\n第二条\n\n第三条', '\n')).toEqual([
      '第一条',
      '第二条',
      '第三条',
    ]);
  });
});

describe('buildTasks', () => {
  it('构建产品与有效提示词的笛卡尔积', () => {
    const tasks = buildTasks(products, prompts, 'cartesian');
    expect(tasks).toHaveLength(4);
    expect(tasks.map((task) => [task.productIndex, task.promptIndex])).toEqual([
      [0, 0], [0, 1], [1, 0], [1, 1],
    ]);
  });
  it('一一对应模式按顺序构建', () => {
    const tasks = buildTasks(products, prompts, 'paired');
    expect(tasks).toHaveLength(2);
    expect(tasks[1].productId).toBe('product-1');
    expect(tasks[1].promptId).toBe('prompt-2');
  });
  it('一一对应数量不匹配时报错', () => {
    expect(() => buildTasks(products.slice(0, 1), prompts, 'paired')).toThrow('数量一致');
  });
});

describe('model and pricing helpers', () => {
  it('模型切换时回退到支持的分辨率', () => {
    expect(normalizeSettingsForModel('gemini-3.1-flash-lite-image', '16:9', '4K')).toEqual({
      aspectRatio: '16:9',
      imageSize: '1K',
    });
  });
  it('费用随任务数线性增长', () => {
    const one = estimateImageCost(DEFAULT_SETTINGS.imageModel, '1K', 1);
    expect(estimateImageCost(DEFAULT_SETTINGS.imageModel, '1K', 3)).toBeCloseTo(one * 3);
  });
  it('清洗下载文件名', () => {
    expect(sanitizeFileName('a:b?.png')).toBe('a_b_');
  });
});
