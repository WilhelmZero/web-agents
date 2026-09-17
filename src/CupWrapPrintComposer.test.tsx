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
  expect(
    screen.getByRole("spinbutton", { name: "图案左侧留白 mm" }),
  ).toHaveValue("0");
  const rightGap = screen.getByRole("spinbutton", {
    name: "图案右侧留白 mm",
  });
  expect(rightGap).toHaveValue("0");
  expect(
    screen.getByRole("spinbutton", { name: "图案上方留白 mm" }),
  ).toHaveValue("10");
  expect(
    screen.getByRole("spinbutton", { name: "图案下方留白 mm" }),
  ).toHaveValue("10");
  fireEvent.change(rightGap, { target: { value: "4" } });
  await waitFor(
    () =>
      expect(work).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "png",
          design: expect.objectContaining({
            aiAdjustment: expect.objectContaining({ rightGap: 4 }),
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
    screen.getByRole("checkbox", {
      name: "透明底（自动移除与边界连通的纯色背景）",
    }),
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
