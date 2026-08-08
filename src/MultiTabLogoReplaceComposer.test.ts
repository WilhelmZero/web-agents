import { describe, expect, it } from 'vitest';
import { groupFolderFiles } from './MultiTabLogoReplaceComposer';

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
