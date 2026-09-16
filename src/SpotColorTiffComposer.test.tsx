import { cleanup, render, screen } from "@testing-library/react";
import { App } from "antd";
import { afterEach, describe, expect, it, vi } from "vitest";
import SpotColorTiffComposer from "./SpotColorTiffComposer";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("spot color TIFF composer", () => {
  it("renders the batch workflow and guards unsupported browsers", () => {
    vi.stubGlobal("showDirectoryPicker", undefined);
    render(<App><SpotColorTiffComposer /></App>);
    expect(screen.getByText("批量制作可编辑专色 TIFF")).toBeInTheDocument();
    expect(screen.getByText("当前浏览器不支持文件夹写入")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /选择文件夹并批量导出/ })).toBeDisabled();
    expect(screen.getByText("背景图层（默认隐藏）+ 智能对象 A")).toBeInTheDocument();
    expect(screen.getByText("专色 1 拷贝（灰度细节）")).toBeInTheDocument();
  });
});
