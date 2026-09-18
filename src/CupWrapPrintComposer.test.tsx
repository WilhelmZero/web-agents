import {
  fireEvent,
  render,
  screen,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import CupWrapPrintComposer from "./CupWrapPrintComposer";
import { DEFAULT_SETTINGS } from "./constants";
import { work } from "./services/cupWrap/client";
import { loadDesigns } from "./services/cupWrap/storage";
import { DEFAULT_CUP } from "./services/cupWrap/geometry";
import { hasUsableTransparency } from "./services/backgroundRemoval";
vi.mock("./services/cupWrap/client", () => ({
  work: vi.fn((input: { kind: string }) =>
    Promise.resolve(
      input.kind === "pack"
        ? { pages: [], omitted: [], width: 210, height: 297 }
        : new Blob(),
    ),
  ),
}));
vi.mock("./services/cupWrap/storage", () => ({
  loadDesigns: vi.fn(() => Promise.resolve([])),
  saveDesigns: vi.fn(() => Promise.resolve()),
}));
vi.mock("./services/cupWrap/pdf", () => ({
  exportPdf: vi.fn(),
  calibrationPdf: vi.fn(),
  tiledPdf: vi.fn(),
}));
vi.mock("./services/backgroundRemoval", () => ({
  hasUsableTransparency: vi.fn(() => Promise.resolve(false)),
}));
vi.mock("./CupWrapSeamPreview", () => ({
  default: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? <button onClick={onClose}>测试 3D 接缝弹窗</button> : null,
}));
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:test"),
      revokeObjectURL: vi.fn(),
    }),
  );
  vi.stubGlobal("createImageBitmap", async () => ({
    width: 100,
    height: 100,
    close: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("shows precise defaults and keeps a single design workflow", async () => {
  render(
    <CupWrapPrintComposer
      active
      settingsHost={null}
      settings={DEFAULT_SETTINGS}
    />,
  );
  expect(screen.getByText(/上弧 125.664/)).toBeInTheDocument();
  fireEvent.change(screen.getByRole("spinbutton", { name: "底径" }), {
    target: { value: "40" },
  });
  await waitFor(() =>
    expect(screen.getByText(/下弧 125.664/)).toBeInTheDocument(),
  );
  expect(
    screen.queryByRole("button", { name: "新增设计" }),
  ).not.toBeInTheDocument();
}, 30000);
it("automatically recalculates A4 layout after design data loads", async () => {
  vi.mocked(loadDesigns).mockResolvedValueOnce([
    {
      id: "auto-layout",
      name: "自动排版",
      cup: { ...DEFAULT_CUP },
      source: new Blob(["image"], { type: "image/png" }),
      stitchedSource: true,
      aiResults: [],
      adaptationMode: "geometry",
      fit: "contain",
      scale: 1,
      x: 0,
      y: 0,
      rotation: 0,
      layers: [],
      quantity: 1,
      prompt: "",
    },
  ]);
  render(
    <CupWrapPrintComposer
      active
      settingsHost={null}
      settings={DEFAULT_SETTINGS}
    />,
  );
  expect(
    screen.queryByRole("button", { name: "计算 A4 混排" }),
  ).not.toBeInTheDocument();
  await waitFor(
    () =>
      expect(work).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "pack" }),
        expect.any(AbortSignal),
      ),
    { timeout: 3000 },
  );
  expect(screen.getByText("设计图拼接")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "替换第 1 张图（左侧）" })).toBeInTheDocument();
  const horizontal = screen.getByRole("spinbutton", {
    name: "水平单轴缩放",
  });
  fireEvent.change(horizontal, { target: { value: "1.25" } });
  await waitFor(
    () =>
      expect(work).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "png",
          design: expect.objectContaining({
            aiAdjustment: expect.objectContaining({ scaleX: 1.25 }),
          }),
        }),
        expect.any(AbortSignal),
      ),
    { timeout: 3000 },
  );
  const cutLine = screen.getByRole("checkbox", {
    name: "导出裁切线（黑色 0.1 mm）",
  });
  expect(cutLine).toBeChecked();
  await waitFor(
    () =>
      expect(work).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "png", cutLine: true }),
        expect.any(AbortSignal),
      ),
    { timeout: 3000 },
  );
}, 30000);
it("renders settings in the independent host and opens artwork options without AI calls", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const { unmount } = render(
    <CupWrapPrintComposer
      active
      settingsHost={host}
      settings={DEFAULT_SETTINGS}
    />,
  );
  expect(host.querySelector(".cup-settings")).not.toBeNull();
  expect(screen.getByText("确定性圆台映射 · 不调用 AI")).toBeInTheDocument();
  expect(
    screen.getByRole("switch", { name: "保留透明底" }),
  ).not.toBeChecked();
  expect(
    screen.getByRole("checkbox", { name: "辅助线（不进入彩图）" }),
  ).toBeChecked();
  expect(
    screen.getByRole("checkbox", {
      name: "导出裁切线（黑色 0.1 mm）",
    }),
  ).toBeChecked();
  expect(
    screen.getByLabelText("排版模式").closest(".ant-select"),
  ).toHaveTextContent("单页尽量填满");
  expect(
    screen.queryByRole("spinbutton", { name: "打印数量" }),
  ).not.toBeInTheDocument();
  fireEvent.mouseDown(screen.getByLabelText("排版模式"));
  fireEvent.click(await screen.findByText("按数量自动分页"));
  expect(screen.getByRole("spinbutton", { name: "打印数量" })).toHaveValue("1");
  fireEvent.click(screen.getByRole("tab", { name: "A4 排版" }));
  expect(screen.getByText(/上传设计后将自动生成 A4 混排/)).toBeInTheDocument();
  unmount();
  host.remove();
}, 30000);
it("opens the seam preview without requiring uploaded artwork", async () => {
  render(
    <CupWrapPrintComposer
      active
      settingsHost={null}
      settings={DEFAULT_SETTINGS}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "3D 模拟" }));
  const calibration = screen.getByRole("button", { name: "校准页" });
  const simulation = screen.getByRole("button", { name: "3D 模拟" });
  expect(
    calibration.compareDocumentPosition(simulation) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(simulation).toHaveClass("ant-btn-primary");
  expect(
    await screen.findByRole("button", { name: "测试 3D 接缝弹窗" }),
  ).toBeInTheDocument();
}, 30000);
it("adds and switches independent cup profiles", async () => {
  render(
    <CupWrapPrintComposer
      active
      settingsHost={null}
      settings={DEFAULT_SETTINGS}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /新增杯型/ }));
  expect(screen.getByDisplayValue("杯型 2")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("spinbutton", { name: "口径" }), {
    target: { value: "55" },
  });
  await waitFor(() => expect(screen.getByText(/口径 55 ·/)).toBeInTheDocument());
  expect(screen.getAllByRole("switch", { name: /加入A4混排/ })).toHaveLength(2);
}, 30000);
it("preserves a transparent background when transparent artwork is uploaded", async () => {
  vi.mocked(hasUsableTransparency).mockResolvedValueOnce(true);
  const { container } = render(
    <CupWrapPrintComposer
      active
      settingsHost={null}
      settings={DEFAULT_SETTINGS}
    />,
  );
  const input = container.querySelector('input[type="file"]')!;
  fireEvent.change(input, {
    target: { files: [new File(["png"], "transparent.png", { type: "image/png" })] },
  });
  await waitFor(() =>
    expect(
      screen.getByRole("switch", { name: "保留透明底" }),
    ).toBeChecked(),
  );
}, 30000);
