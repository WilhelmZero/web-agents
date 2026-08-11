import { describe, expect, it } from 'vitest';
import { buildFolderTree, groupFolderFiles } from './MultiTabLogoReplaceComposer';

function folderFile(name: string, path: string) {
  const file = new File(['x'], name, { type: 'image/png' });
  Object.defineProperty(file, 'webkitRelativePath', { value: path });
  return file;
}

describe('groupFolderFiles', () => {
  it('按最深层图片目录拆分两层同名文件夹', () => {
    const groups = groupFolderFiles([
      folderFile('1.png', '测试图片/AM058/AM058/1.png'),
      folderFile('2.png', '测试图片/AM058/AM058/2.png'),
      folderFile('1.png', '测试图片/AM059/AM059/1.png'),
    ]);
    expect(groups.map((group) => [group.name, group.path, group.files.length])).toEqual([
      ['AM058', '测试图片/AM058/AM058', 2],
      ['AM059', '测试图片/AM059/AM059', 1],
    ]);
  });
});

describe('buildFolderTree', () => {
  it('保留完整目录层级并为每张图片生成可勾选叶节点', () => {
    const tree = buildFolderTree([
      folderFile('1.png', '测试图片/AM058/AM058/1.png'),
      folderFile('2.png', '测试图片/AM059/AM059/2.png'),
    ]);
    expect(tree[0].title).toBe('测试图片');
    expect(tree[0].children?.map((node) => node.title)).toEqual(['AM058', 'AM059']);
    expect(tree[0].children?.[0].children?.[0].children?.[0].key).toBe('file:测试图片/AM058/AM058/1.png');
  });
});
