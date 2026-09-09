import {
  fireEvent,
  render,
  screen,
  waitFor,
  cleanup,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CustomMonochromeLogoComposer from "./CustomMonochromeLogoComposer";
import * as engravingApi from "./services/engraving/api";
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
    ).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: /上传风格参考图/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText("3 · 雕刻参数")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /补充提示词再生成一张/ }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("combobox", { name: "常用 DPI" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下载所选" })).toBeDisabled();
    expect(screen.queryByText("雕刻结果")).not.toBeInTheDocument();
    expect(screen.getAllByRole("switch")[0]).toBeChecked();
    expect(
      screen.queryByRole("button", { name: /工具设置/ }),
    ).not.toBeInTheDocument();
    const panel = screen.getByRole("complementary", { name: "参数设置" });
    expect(within(panel).getByDisplayValue("gpt-image-2")).toBeInTheDocument();
    expect(within(panel).getByText("生成质量")).toBeInTheDocument();
    expect(screen.queryByText("兼容 API 地址")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("gpt-image-2")).toBeInTheDocument();
    expect(screen.getByDisplayValue("gpt-5.4-mini")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /测试连接/ }),
    ).not.toBeInTheDocument();
  }, 15000);
  it("ignores legacy tool API addresses and tests the shared GPT endpoint", async () => {
    localStorage.setItem(
      "custom-monochrome-logo:settings:v1",
      JSON.stringify({
        version: 1,
        settings: { baseUrl: "https://legacy.invalid/v1" },
      }),
    );
    const test = vi.spyOn(engravingApi, "testConnection").mockResolvedValue(1);
    render(
      <CustomMonochromeLogoComposer
        openAiApiKey="mock-key"
        onConfigureKey={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /上传客户照片/ }),
      ).toBeEnabled(),
    );
    expect(
      screen.queryByRole("button", { name: /测试连接|全局 API 设置/ }),
    ).not.toBeInTheDocument();
    expect(test).not.toHaveBeenCalled();
    test.mockRestore();
  }, 15000);
});
