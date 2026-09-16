// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { uniqueFileName, writeUniqueFile, type WritableDirectoryHandle } from "./directoryExport";

function directory(existing: string[] = []) {
  const names = new Set(existing);
  const write = vi.fn(async () => undefined);
  const close = vi.fn(async () => undefined);
  const handle: WritableDirectoryHandle = {
    async getFileHandle(name, options) {
      if (!names.has(name) && !options?.create) {
        throw Object.assign(new Error("missing"), { name: "NotFoundError" });
      }
      names.add(name);
      return { async createWritable() { return { write, close }; } };
    },
  };
  return { handle, names, write, close };
}

describe("directory TIFF export", () => {
  it("avoids overwriting an existing base name", async () => {
    const mock = directory(["logo.tif", "logo_2.tif"]);
    await expect(uniqueFileName(mock.handle, "logo.tif")).resolves.toBe("logo_3.tif");
  });

  it("writes and closes the unique output file", async () => {
    const mock = directory();
    const data = new ArrayBuffer(4);
    await expect(writeUniqueFile(mock.handle, "logo.tif", data)).resolves.toBe("logo.tif");
    expect(mock.write).toHaveBeenCalledWith(data);
    expect(mock.close).toHaveBeenCalledOnce();
  });
});
