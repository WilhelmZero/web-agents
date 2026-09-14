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
  fireEvent.click(screen.getByRole("switch", { name: "文字加粗" }));
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
