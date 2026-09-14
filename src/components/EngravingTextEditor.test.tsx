import { beforeEach, afterEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import Editor from "./EngravingTextEditor";
import { DEFAULTS } from "../services/engraving/processing.mjs";
import type { StoredResult } from "../services/engraving/types";
const { blob } = vi.hoisted(() => ({
  blob: new Blob(["image"], { type: "image/png" }),
}));
vi.mock("../services/engraving/preview", () => ({
  useEngravingPreview: () => ({ blob, error: "", computing: false }),
}));
vi.mock("../services/engraving/layout-fonts", () => ({
  FONT_CATALOG: [],
  ensureLayoutFont: async () => "test",
  localFonts: async () => [],
  importFont: vi.fn(),
}));
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    (() => ({
      font: "",
      arc: vi.fn(),
      fill: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      scale: vi.fn(),
      fillText: vi.fn(),
      strokeText: vi.fn(),
      measureText: (s: string) => ({
        width: s.length * 20,
        actualBoundingBoxAscent: 30,
        actualBoundingBoxDescent: 8,
      }),
    })) as any,
  );
  vi.stubGlobal("createImageBitmap", async () => ({
    width: 600,
    height: 600,
    close: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const result: StoredResult = {
  job: { id: "test", blob, width: 600, height: 600, warnings: [] },
  params: { ...DEFAULTS },
  initialParams: { ...DEFAULTS },
  reviews: [],
  createdAt: 1,
};
it("zooms immediately after modal mount without fit or 100 percent", async () => {
  render(<Editor result={result} onClose={vi.fn()} onApply={vi.fn()} />);
  await screen.findByLabelText("排版画布", {}, { timeout: 5000 });
  const initial = screen.getByTestId("layout-zoom").textContent;
  fireEvent.wheel(screen.getByLabelText("排版画布"), {
    deltaY: -300,
    clientX: 100,
    clientY: 100,
  });
  expect(screen.getByTestId("layout-zoom").textContent).not.toBe(initial);
});
it("keeps numeric canvas input independent of slider range and uses selected layer parameters", async () => {
  const apply = vi.fn();
  render(<Editor result={result} onClose={vi.fn()} onApply={apply} />);
  const width = screen.getByRole("spinbutton", {
    name: "画布宽度",
  });
  fireEvent.change(width, { target: { value: "5000" } });
  fireEvent.blur(width);
  expect(Number((width as HTMLInputElement).value)).toBe(5000);
  expect(
    screen.getByRole("slider", { name: "画布宽度滑动条" }),
  ).toHaveAttribute("aria-valuemax", "4096");
  fireEvent.change(width, { target: { value: "600" } });
  fireEvent.click(screen.getByRole("button", { name: "添加文本图层" }));
  expect(
    screen.queryByRole("spinbutton", { name: "图片 X" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByLabelText("内部对齐")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "文字加粗" }));
  await waitFor(
    () => expect(screen.getByRole("button", { name: "应用" })).toBeEnabled(),
    { timeout: 15000, interval: 200 },
  );
  fireEvent.click(screen.getByRole("button", { name: "应用" }));
  expect(apply.mock.calls[0][0].texts[0]).toMatchObject({
    bold: true,
    autoSize: true,
  });
  expect(result.params.layout).toBeUndefined();
  expect(
    screen.queryByRole("button", { name: "复制" }),
  ).not.toBeInTheDocument();
  const addButton = screen.getByRole("button", { name: "添加文本图层" });
  const layers = screen.getByLabelText("图层列表");
  expect(
    addButton.compareDocumentPosition(layers) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "删除文本图层 Memory 2026" }),
  );
  expect(screen.queryByLabelText("文字内容")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /图片图层/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
}, 20000);

it("paints a complete stroke as one undo step, saves both colors, and cancels interrupted strokes", async () => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  const apply = vi.fn();
  render(<Editor result={result} onClose={vi.fn()} onApply={apply} />);
  const view = screen.getByLabelText("排版画布");
  fireEvent.click(screen.getByRole("button", { name: "白色画笔" }));
  fireEvent.change(screen.getByRole("spinbutton", { name: "画笔大小" }), {
    target: { value: "60" },
  });
  fireEvent.pointerDown(view, { clientX: 70, clientY: 70, button: 0 });
  fireEvent.pointerMove(view, { clientX: 100, clientY: 100 });
  fireEvent.pointerMove(view, { clientX: 130, clientY: 120 });
  fireEvent.pointerUp(view);
  fireEvent.click(screen.getByRole("button", { name: "黑色画笔" }));
  fireEvent.pointerDown(view, { clientX: 160, clientY: 160, button: 0 });
  fireEvent.pointerMove(view, { clientX: 200, clientY: 170 });
  fireEvent.pointerUp(view);
  fireEvent.click(screen.getByRole("button", { name: "撤销" }));
  fireEvent.pointerDown(view, { clientX: 200, clientY: 200, button: 0 });
  fireEvent.pointerCancel(view);
  await waitFor(
    () => expect(screen.getByRole("button", { name: "应用" })).toBeEnabled(),
    { timeout: 10000 },
  );
  fireEvent.click(screen.getByRole("button", { name: "应用" }));
  expect(apply.mock.calls[0][0].strokes).toHaveLength(1);
  expect(apply.mock.calls[0][0].strokes[0]).toMatchObject({
    color: "#ffffff",
    size: 60,
  });
  expect(apply.mock.calls[0][0].strokes[0].points).toHaveLength(3);
  expect(result.params.layout).toBeUndefined();
  fireEvent.click(screen.getByRole("button", { name: "撤销" }));
  expect(screen.getByRole("button", { name: "撤销" })).toBeDisabled();
}, 20000);

it("keeps text icons and input below the canvas and undoes text creation after font fitting", async () => {
  render(<Editor result={result} onClose={vi.fn()} onApply={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "添加文本图层" }));
  const bottom = screen.getByLabelText("画布下方设置");
  expect(bottom.contains(screen.getByLabelText("文字内容"))).toBe(true);
  for (const label of ["文字颜色", "描边颜色", "文字加粗", "文字水平居中"])
    expect(bottom.contains(screen.getByLabelText(label))).toBe(true);
  await waitFor(
    () => expect(screen.getByRole("button", { name: "应用" })).toBeEnabled(),
    { timeout: 10000 },
  );
  fireEvent.click(screen.getByRole("button", { name: "撤销" }));
  expect(screen.queryByLabelText("文字内容")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "撤销" })).toBeDisabled();
  expect(screen.queryByText(/编辑保留彩色/)).not.toBeInTheDocument();
}, 20000);

it("restores saved paint and saves an independently sized eraser without touching the source", async () => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  const original = {
    version: 1 as const,
    width: 600,
    height: 600,
    image: { x: 0, y: 0, width: 600, height: 600 },
    texts: [],
    strokes: [
      { color: "#ffffff" as const, size: 50, points: [{ x: 50, y: 50 }] },
    ],
  };
  const apply = vi.fn();
  render(
    <Editor
      result={{ ...result, params: { ...result.params, layout: original } }}
      onApply={apply}
      onClose={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "橡皮擦" }));
  fireEvent.change(screen.getByRole("spinbutton", { name: "橡皮擦大小" }), {
    target: { value: "80" },
  });
  const view = screen.getByLabelText("排版画布");
  fireEvent.pointerDown(view, { clientX: 70, clientY: 70, button: 0 });
  fireEvent.pointerUp(view);
  fireEvent.click(screen.getByRole("button", { name: "白色画笔" }));
  expect(screen.getByRole("spinbutton", { name: "画笔大小" })).toHaveValue(
    "30.00",
  );
  await waitFor(
    () => expect(screen.getByRole("button", { name: "应用" })).toBeEnabled(),
    { timeout: 10000 },
  );
  fireEvent.click(screen.getByRole("button", { name: "应用" }));
  expect(apply.mock.calls[0][0].strokes[1]).toMatchObject({
    mode: "erase",
    size: 80,
  });
  expect(original.strokes).toHaveLength(1);
}, 20000);
