import { describe, expect, it } from 'vitest';
import { groupFolderFiles } from './MultiTabLogoReplaceComposer';
import { buildFolderScenePrompt, buildPickerFolderTree } from './MultiTabSceneReplaceComposer';

function folderFile(name: string, path: string) { const file = new File(['x'], name, { type: 'image/png' }); Object.defineProperty(file, 'webkitRelativePath', { value: path }); return file; }

describe('buildPickerFolderTree', () => {
  it('preserves parent directories but only attaches images to deepest folders', () => {
    const groups = groupFolderFiles([
      folderFile('parent.png', 'root/AM058/parent.png'),
      folderFile('one.png', 'root/AM058/AM058/one.png'),
      folderFile('two.png', 'root/AM059/AM059/two.png'),
    ]);
    const tree = buildPickerFolderTree(groups);
    expect(tree[0].name).toBe('root');
    expect(tree[0].group).toBeUndefined();
    expect(tree[0].children.map((node) => node.name)).toEqual(['AM058', 'AM059']);
    expect(tree[0].children[0].group).toBeUndefined();
    expect(tree[0].children[0].children[0].group?.files.map((file) => file.name)).toEqual(['one.png']);
  });

  it('combines the folder theme with the common prompt used by every worker image', () => {
    expect(buildFolderScenePrompt('保持杯子不变', { cupType: '啤酒杯', theme: '替换为后院 BBQ 主题', source: 'matched', firstFileKey: 'one', status: 'ready' })).toBe('替换为后院 BBQ 主题；保持杯子不变');
  });
});
