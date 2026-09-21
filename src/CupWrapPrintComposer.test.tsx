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
import { adaptArtwork } from "./services/cupWrap/ai";
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
vi.mock("./services/cupWrap/ai", () => ({
  adaptArtwork: vi.fn(),
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
  expect(screen.getByText("设计图拼接")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "替换第 1 张图（左侧）" }),
  ).toBeInTheDocument();
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
it("keeps rectangular AI output as a candidate until the user applies geometry mapping", async () => {
  const original = new Blob(["original-stitch"], { type: "image/png" });
  vi.mocked(loadDesigns).mockResolvedValueOnce([{
    id: "geometry-ai",
    name: "扩图测试",
    cup: { ...DEFAULT_CUP },
    source: original,
    originalSource: original,
    sourceRevision: "v1",
    stitchedSource: true,
    aiResults: [],
    adaptationMode: "ai-geometry",
    fit: "contain", scale: 1, x: 0, y: 0, rotation: 0,
    layers: [], quantity: 1, prompt: "",
  }]);
  vi.mocked(adaptArtwork).mockResolvedValue(new Blob(["candidate"], { type: "image/png" }));
  render(<CupWrapPrintComposer active settingsHost={null} settings={DEFAULT_SETTINGS} />);
  const requestSize = await screen.findByText(/请求尺寸 \d+ × \d+ px/);
  const match = requestSize.textContent!.match(/请求尺寸 (\d+) × (\d+) px/)!;
  vi.stubGlobal("createImageBitmap", async () => ({
    width: Number(match[1]), height: Number(match[2]), close: vi.fn(),
  }));
  expect(screen.getByRole("textbox", { name: "矩形扩图提示词" }))
    .toHaveValue("参考原图元素进行扩图，只用精灵和星星进行填充");
  fireEvent.click(screen.getByRole("button", { name: "生成矩形扩图候选" }));
  await waitFor(() => expect(document.querySelector(".ant-modal-confirm-btns .ant-btn-primary")).not.toBeNull());
  fireEvent.click(document.querySelector(".ant-modal-confirm-btns .ant-btn-primary")!);
  await screen.findByText(/候选 1 · gpt-image-2.5-sunburst/);
  expect(adaptArtwork).toHaveBeenCalledWith(
    expect.anything(), "gpt-image-2.5-sunburst", original,
    "参考原图元素进行扩图，只用精灵和星星进行填充",
    expect.any(AbortSignal),
    expect.objectContaining({ transparent: true, size: `${match[1]}x${match[2]}` }),
  );
  expect(screen.getByRole("button", { name: "应用并几何映射" })).toBeEnabled();
  expect(work).not.toHaveBeenCalledWith(
    expect.objectContaining({ kind: "png", design: expect.objectContaining({ adopted: expect.any(Blob) }) }),
    expect.anything(),
  );
  fireEvent.click(screen.getByRole("button", { name: "应用并几何映射" }));
  await waitFor(() => expect(work).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: "png",
      design: expect.objectContaining({ adaptationMode: "ai-geometry", adopted: expect.any(Blob) }),
    }),
    expect.any(AbortSignal),
  ));
  fireEvent.click(screen.getByRole("button", { name: "重试（使用当前提示词）" }));
  await waitFor(() => expect(document.querySelector(".ant-modal-confirm-btns .ant-btn-primary")).not.toBeNull());
  fireEvent.click(document.querySelector(".ant-modal-confirm-btns .ant-btn-primary")!);
  await screen.findByText(/候选 2 · gpt-image-2.5-sunburst/);
  expect(vi.mocked(adaptArtwork).mock.calls.map((call) => call[2]))
    .toEqual([original, original]);
  fireEvent.click(screen.getByRole("button", { name: "使用原图" }));
  await waitFor(() => expect(work).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: "png",
      design: expect.objectContaining({ adaptationMode: "ai-geometry", adopted: undefined }),
    }),
    expect.any(AbortSignal),
  ));
}, 120000);
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
  expect(screen.getByRole("switch", { name: "保留透明底" })).not.toBeChecked();
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
  await waitFor(() =>
    expect(screen.getByText(/口径 55 ·/)).toBeInTheDocument(),
  );
  expect(screen.getAllByRole("switch", { name: /加入A4混排/ })).toHaveLength(2);
}, 30000);
it("shows a signed stitch gap control when two artwork images exist", async () => {
  const first = new Blob(["first"], { type: "image/png" }),
    second = new Blob(["second"], { type: "image/png" });
  vi.mocked(loadDesigns).mockResolvedValueOnce([
    {
      id: "two-images",
      name: "双图拼接",
      cup: { ...DEFAULT_CUP },
      source: first,
      originalSource: first,
      artworkSlots: [
        {
          id: "front",
          role: "front",
          blob: first,
          enabled: true,
          scale: 1,
          x: 0,
          y: 0,
          rotation: 0,
        },
        {
          id: "back",
          role: "back",
          blob: second,
          enabled: true,
          scale: 1,
          x: 0,
          y: 0,
          rotation: 0,
        },
      ],
      stitchedSource: true,
      stitchGapPx: -24,
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
    await screen.findByRole("slider", {
      name: "图与图之间的间隙滑动条",
    }),
  ).toHaveAttribute("aria-valuenow", "-24");
  expect(
    screen.getByRole("spinbutton", { name: "图与图之间的间隙 px" }),
  ).toHaveValue("-24");
  expect(
    screen.getByText(/负数时第 2 张图位于顶层并覆盖第 1 张图/),
  ).toBeInTheDocument();
  const gapPanel = screen
    .getByText("图与图之间的间隙 px")
    .closest(".cup-stitch-gap");
  expect(gapPanel).not.toBeNull();
  expect(gapPanel?.querySelector(".cup-stitch-gap-controls")).not.toBeNull();
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
    target: {
      files: [new File(["png"], "transparent.png", { type: "image/png" })],
    },
  });
  await waitFor(() =>
    expect(screen.getByRole("switch", { name: "保留透明底" })).toBeChecked(),
  );
}, 30000);
