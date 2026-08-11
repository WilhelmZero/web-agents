const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i;

interface LegacyFileEntry { isFile: boolean; isDirectory: boolean; file: (callback: (file: File) => void) => void; createReader: () => { readEntries: (callback: (entries: LegacyFileEntry[]) => void) => void } }

async function readEntry(entry: LegacyFileEntry, prefix = ''): Promise<File[]> {
  if (entry.isFile) return new Promise((resolve) => entry.file((file) => {
    Object.defineProperty(file, 'webkitRelativePath', { configurable: true, value: `${prefix}${file.name}` }); resolve([file]);
  }));
  if (!entry.isDirectory) return [];
  const reader = entry.createReader(); const entries: LegacyFileEntry[] = [];
  while (true) {
    const batch = await new Promise<LegacyFileEntry[]>((resolve) => reader.readEntries(resolve));
    if (!batch.length) break; entries.push(...batch);
  }
  return (await Promise.all(entries.map((child) => readEntry(child, `${prefix}${(entry as LegacyFileEntry & { name?: string }).name || ''}/`)))).flat();
}

export async function imageFilesFromDrop(items: DataTransferItemList): Promise<File[]> {
  const entries = Array.from(items).map((item) => (item.webkitGetAsEntry?.() || null) as unknown as LegacyFileEntry | null).filter((entry): entry is LegacyFileEntry => Boolean(entry));
  const files = entries.length ? (await Promise.all(entries.map((entry) => readEntry(entry)))).flat() : Array.from(items).map((item) => item.getAsFile()).filter(Boolean) as File[];
  return files.filter((file) => file.type.startsWith('image/') || IMAGE_EXTENSIONS.test(file.name));
}

export function installFolderDropUploadSupport() {
  const onDrop = async (event: DragEvent) => {
    const target = event.target instanceof Element ? event.target.closest('.ant-upload') : null;
    const input = target?.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input || !input.accept.toLowerCase().includes('image') || !event.dataTransfer?.items.length) return;
    const hasDirectory = Array.from(event.dataTransfer.items).some((item) => (item as DataTransferItem & { webkitGetAsEntry?: () => LegacyFileEntry | null }).webkitGetAsEntry?.()?.isDirectory);
    if (!hasDirectory) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const files = await imageFilesFromDrop(event.dataTransfer.items); if (!files.length) return;
    const transfer = new DataTransfer(); files.forEach((file) => transfer.items.add(file)); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  document.addEventListener('drop', onDrop, true);
  return () => document.removeEventListener('drop', onDrop, true);
}
