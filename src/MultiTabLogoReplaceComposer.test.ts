import { describe, expect, it } from 'vitest';
import { buildFolderTree, filesInCheckedFolders, groupFolderFiles } from './MultiTabLogoReplaceComposer';

function folderFile(name: string, path: string) {
  const file = new File(['x'], name, { type: 'image/png' });
  Object.defineProperty(file, 'webkitRelativePath', { value: path });
  return file;
}

describe('groupFolderFiles', () => {
  it('groups images by their deepest folder', () => {
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
  it('keeps the directory hierarchy without exposing file nodes', () => {
    const tree = buildFolderTree([
      folderFile('1.png', '测试图片/AM058/AM058/1.png'),
      folderFile('2.png', '测试图片/AM059/AM059/2.png'),
    ]);
    expect(tree[0].title).toBe('测试图片');
    expect(tree[0].children?.map((node) => node.title)).toEqual(['AM058', 'AM059']);
    expect(tree[0].children?.[0].children?.[0].key).toBe('dir:测试图片/AM058/AM058');
    expect(JSON.stringify(tree)).not.toContain('file:');
  });

  it('imports every image under a checked folder', () => {
    const files = [
      folderFile('1.png', 'root/AM058/AM058/1.png'),
      folderFile('2.png', 'root/AM058/AM058/nested/2.png'),
      folderFile('3.png', 'root/AM059/AM059/3.png'),
    ];
    expect(filesInCheckedFolders(files, ['dir:root/AM058'])).toEqual(files.slice(0, 2));
  });
});
