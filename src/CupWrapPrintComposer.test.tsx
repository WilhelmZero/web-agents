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
vi.mock("./services/cupWrap/client", () => ({
  work: vi.fn(() => Promise.resolve(new Blob())),
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
beforeEach(() => {
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:test"),
      revokeObjectURL: vi.fn(),
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("shows precise default values, edits geometry and creates separate designs", async () => {
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
  fireEvent.click(screen.getByRole("button", { name: "新增设计" }));
  expect(screen.getAllByRole("textbox", { name: "设计名称" })).toHaveLength(2);
  expect(screen.getByText(/下弧 106.814/)).toBeInTheDocument();
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
  expect(screen.getByRole("button", { name: "AI 生成候选图" })).toBeDisabled();
  fireEvent.click(screen.getByRole("tab", { name: "A4 排版" }));
  expect(screen.getByText(/请上传设计后计算排版/)).toBeInTheDocument();
  unmount();
  host.remove();
}, 30000);
