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
  startNewTask: vi.fn(async () => {}),
  listTaskHistory: vi.fn(async () => []),
  copyHistoryTask: vi.fn(),
}));
vi.mock("./services/engraving/workerClient", () => ({
  processInWorker: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  (localStorage.clear(), sessionStorage.clear());
});
describe("customer monochrome page", () => {
  it("requires upload, preserves the five subjects and hidden textual references, and opens independent settings", async () => {
    render(
      <CustomMonochromeLogoComposer openAiApiKey="" onConfigureKey={vi.fn()} />,
    );
    await waitFor(() =>
      expect(screen.getByLabelText("上传单张原图")).toBeEnabled(),
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
    expect(
      screen.queryByRole("button", { name: /上传风格参考图/ }),
    ).not.toBeInTheDocument();
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
    const continuous = screen.getByRole("switch", {name:"在生成图上持续优化"});
    expect(continuous).not.toBeChecked();
    fireEvent.click(continuous);
    expect(continuous).toBeChecked();
    fireEvent.click(screen.getAllByRole("switch")[0]);
    expect(continuous).toBeDisabled();
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
      expect(screen.getByLabelText("上传单张原图")).toBeEnabled(),
    );
    expect(
      screen.queryByRole("button", { name: /测试连接|全局 API 设置/ }),
    ).not.toBeInTheDocument();
    expect(test).not.toHaveBeenCalled();
    test.mockRestore();
  }, 15000);
});

it("portals only settings while keeping source, subject and actions in the center", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const view = render(
    <CustomMonochromeLogoComposer
      openAiApiKey=""
      onConfigureKey={vi.fn()}
      settingsHost={host}
    />,
  );
  await waitFor(() =>
    expect(screen.getByLabelText("上传单张原图")).toBeEnabled(),
  );
  expect(within(host).getByText("图片模型")).toBeInTheDocument();
  expect(
    within(host).queryByRole("button", { name: "生成黑白 Logo" }),
  ).not.toBeInTheDocument();
  expect(
    within(screen.getByRole("main")).getByRole("combobox", {
      name: "保留主体",
    }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("combobox", { name: "风格参考" }),
  ).not.toBeInTheDocument();
  view.unmount();
  host.remove();
});

it.each([false, true])(
  "uses portrait despite saved custom references, including supplemental generation (auto=%s)",
  async (auto) => {
    const { loadTask } = await import("./services/engraving/storage");
    const { processInWorker } =
      await import("./services/engraving/workerClient");
    const { DEFAULTS } = await import("./services/engraving/processing.mjs");
    const original = new Blob(["original"]),
      customReference = new Blob(["old custom"]);
    const portrait = new Blob(["portrait"]);
    vi.mocked(loadTask).mockResolvedValueOnce({
      version: 1,
      fileName: "saved.png",
      original,
      customReference,
      params: { ...DEFAULTS },
    });
    localStorage.setItem(
      "custom-monochrome-logo:settings:v1",
      JSON.stringify({ version: 1, settings: { reference: "bouquet", auto } }),
    );
    vi.stubGlobal(
      "URL",
      Object.assign(URL, {
        createObjectURL: vi.fn(() => "blob:test"),
        revokeObjectURL: vi.fn(),
      }),
    );
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 400, height: 600, close: vi.fn() })),
    );
    const fetchMock = vi.fn(async (_url: string) => ({
      ok: true,
      blob: async () => portrait,
    }));
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(processInWorker).mockResolvedValue({
      buffer: portrait,
      width: 400,
      height: 600,
      warnings: [],
    });
    const generate = vi.fn(
      async (_input: import("./services/engraving/types").GenerateInput) => ({
        buffer: new Blob(["generated"]),
        warnings: [],
      }),
    );
    const review = vi.fn(
      async (_input: import("./services/engraving/types").ReviewInput) => ({
        scores: {
          identity: 95,
          subjects: 95,
          hair: 95,
          texture: 95,
          background: 95,
          tones: 95,
        },
        issues: [],
        action: "accept" as const,
        adjustments: { texture: 65, contrast: 50, brightness: 50, shadow: 30, blackPoint: 0 },
      }),
    );
    const api = vi
      .spyOn(engravingApi, "createEngravingApi")
      .mockReturnValue({ generate, review });
    render(
      <CustomMonochromeLogoComposer
        openAiApiKey="fake-key"
        onConfigureKey={vi.fn()}
      />,
    );
    const button = screen.getByRole("button", { name: "生成黑白 Logo" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "补充提示词再生成一张" }),
      ).toBeEnabled(),
    );
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][0].referenceImage).toBe(portrait);
    if (auto) expect(review.mock.calls[0][0].reference).toBe(portrait);
    fireEvent.click(
      screen.getByRole("button", { name: "补充提示词再生成一张" }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "补充提示词" }), {
      target: { value: "加强发丝" },
    });
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "再生成一张",
      }),
    );
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(button).toBeEnabled());
    expect(generate.mock.calls[1][0].referenceImage).toBe(portrait);
    expect(
      fetchMock.mock.calls.every((call) =>
        String(call[0]).endsWith("engraving-references/portrait-reference.jpg"),
      ),
    ).toBe(true);
    expect(review).toHaveBeenCalledTimes(auto ? 1 : 0);
    api.mockRestore();
  },
  15000,
);

it("restores history as a copy without starting generation",async()=>{
 const storage=await import("./services/engraving/storage");
 const {DEFAULTS}=await import("./services/engraving/processing.mjs");
 vi.mocked(storage.listTaskHistory).mockResolvedValueOnce([{id:"task:old",fileName:"旧照片.jpg",updatedAt:1,count:2}]);
 vi.mocked(storage.copyHistoryTask).mockResolvedValueOnce({version:1,fileName:"restored.jpg",params:{...DEFAULTS}});
 render(<CustomMonochromeLogoComposer openAiApiKey="" onConfigureKey={vi.fn()}/>);
 await waitFor(()=>expect(screen.getByRole("button",{name:"任务历史"})).toBeEnabled());
 fireEvent.click(screen.getByRole("button",{name:"任务历史"}));
 await screen.findByText(/旧照片.jpg/);
 fireEvent.click(screen.getByRole("button",{name:"恢复副本"}));
 await screen.findByText(/已恢复为本标签的独立副本/);
 expect(storage.copyHistoryTask).toHaveBeenCalledWith("task:old");
 expect(screen.getByRole("button",{name:"生成黑白 Logo"})).toBeDisabled();
}, 20000);
