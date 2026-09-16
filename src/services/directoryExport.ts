export interface WritableDirectoryHandle {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<{
    createWritable(): Promise<{
      write(data: Blob | ArrayBuffer | ArrayBufferView): Promise<void>;
      close(): Promise<void>;
      abort?(): Promise<void>;
    }>;
  }>;
}

declare global {
  interface Window {
    showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<WritableDirectoryHandle>;
  }
}

const splitExtension = (name: string) => {
  const index = name.lastIndexOf(".");
  return index > 0 ? [name.slice(0, index), name.slice(index)] : [name, ""];
};

async function exists(directory: WritableDirectoryHandle, name: string) {
  try {
    await directory.getFileHandle(name);
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") return false;
    // Test doubles and browser implementations do not always expose DOMException.
    if ((error as { name?: string })?.name === "NotFoundError") return false;
    throw error;
  }
}

export async function uniqueFileName(directory: WritableDirectoryHandle, requested: string) {
  if (!(await exists(directory, requested))) return requested;
  const [base, extension] = splitExtension(requested);
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${base}_${index}${extension}`;
    if (!(await exists(directory, candidate))) return candidate;
  }
  throw new Error("输出目录中同名文件过多");
}

export async function writeUniqueFile(directory: WritableDirectoryHandle, requested: string, data: ArrayBuffer) {
  const name = await uniqueFileName(directory, requested);
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(data);
    await writable.close();
    return name;
  } catch (error) {
    await writable.abort?.();
    throw error;
  }
}

export function supportsDirectoryExport() {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

export async function pickWritableDirectory() {
  if (!supportsDirectoryExport()) throw new Error("当前浏览器不支持选择输出文件夹，请使用最新版 Chrome 或 Edge");
  return window.showDirectoryPicker!({ mode: "readwrite" });
}
