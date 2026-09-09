import {
  fireEvent,
  render,
  screen,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CustomMonochromeLogoComposer from "./CustomMonochromeLogoComposer";
vi.mock("./services/engraving/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./services/engraving/storage")>()),
  loadTask: vi.fn(async () => undefined),
  saveTask: vi.fn(async () => {}),
}));
vi.mock("./services/engraving/workerClient", () => ({
  processInWorker: vi.fn(),
}));
afterEach(() => {
  cleanup();
  localStorage.clear();
});
describe("customer monochrome page", () => {
  it("requires upload, preserves the five subjects and hidden textual references, and opens independent settings", async () => {
    render(
      <CustomMonochromeLogoComposer openAiApiKey="" onConfigureKey={vi.fn()} />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /上传客户照片/ }),
      ).toBeEnabled(),
    );
    expect(
      screen.getByRole("button", { name: /生成黑白 Logo/ }),
    ).toBeDisabled();
    expect(
      screen.queryByText(/体验示例|示例图片|加载示例/),
    ).not.toBeInTheDocument();
    expect(
      screen
        .queryAllByRole("img")
        .filter((el) => (el as HTMLImageElement).src?.includes("reference")),
    ).toHaveLength(0);
    expect(screen.getAllByRole("switch")[0]).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: /工具设置/ }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(screen.getByDisplayValue("gpt-image-2")).toBeInTheDocument();
    expect(screen.getByDisplayValue("gpt-5.4-mini")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /测试连接/ }),
    ).toBeInTheDocument();
  }, 15000);
});
