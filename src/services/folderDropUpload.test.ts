import { describe, expect, it } from 'vitest';
import { imageFilesFromDrop } from './folderDropUpload';

function fileEntry(file: File) {
  return { isFile: true, isDirectory: false, file: (callback: (value: File) => void) => callback(file) };
}

function directoryEntry(name: string, children: ReturnType<typeof fileEntry>[]) {
  let delivered = false;
  return { isFile: false, isDirectory: true, name, createReader: () => ({ readEntries: (callback: (entries: typeof children) => void) => { callback(delivered ? [] : children); delivered = true; } }) };
}

describe('imageFilesFromDrop', () => {
  it('recursively expands a dropped folder and keeps only images', async () => {
    const image = new File(['image'], 'logo.png', { type: 'image/png' });
    const text = new File(['text'], 'notes.txt', { type: 'text/plain' });
    const entry = directoryEntry('assets', [fileEntry(image), fileEntry(text)]);
    const items = [{ webkitGetAsEntry: () => entry }] as unknown as DataTransferItemList;
    const files = await imageFilesFromDrop(items);
    expect(files).toEqual([image]);
    expect((files[0] as File & { webkitRelativePath: string }).webkitRelativePath).toBe('assets/logo.png');
  });
});
