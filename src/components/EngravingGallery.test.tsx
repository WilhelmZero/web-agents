import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import EngravingGallery from "./EngravingGallery";
import { DEFAULTS } from "../services/engraving/processing.mjs";
import type { StoredResult } from "../services/engraving/types";
vi.mock("../services/engraving/preview", () => ({
  useEngravingPreview: () => ({ blob: undefined, computing: false, error: "" }),
}));
vi.mock("../services/engraving/workerClient", () => ({
  processInWorker: vi.fn(async () => ({
    buffer: new Blob(["png"]),
    width: 945,
    height: 945,
    warnings: [],
  })),
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
  localStorage.clear();
});
function result(id: string): StoredResult {
  return {
    job: { id, blob: new Blob([id]), width: 400, height: 600, warnings: [] },
    params: { ...DEFAULTS },
    initialParams: { ...DEFAULTS },
    reviews: [],
    createdAt: 1,
    reference: new Blob(["private-reference"]),
  };
}
it("keeps the current preview on the same result when another image arrives", async () => {
  const a = result("a"),
    b = result("b"),
    c = result("c");
  const view = render(<EngravingGallery results={[a, b]} onChange={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "放大图片 2" }));
  await screen.findByText("2 / 2");
  view.rerender(<EngravingGallery results={[a, b, c]} onChange={vi.fn()} />);
  expect(await screen.findByText("2 / 3")).toBeInTheDocument();
  fireEvent.click(document.querySelector(".ant-image-preview-switch-next")!);
  expect(await screen.findByText("3 / 3")).toBeInTheDocument();
});
it("renders compact cards, selects only existing results, and opens size selection for chosen results", async () => {
  const a = result("a"),
    b = result("b"),
    c = result("c");
  const props = { original: new Blob(["original"]), onChange: vi.fn() };
  const view = render(<EngravingGallery {...props} results={[a, b]} />);
  expect(screen.queryByText("在中间查看此图")).not.toBeInTheDocument();
  expect(screen.queryByText("本次风格参考")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /全\s*选/ }));
  view.rerender(<EngravingGallery {...props} results={[a, b, c]} />);
  expect(screen.getByText("已选 2 张")).toBeInTheDocument();
  expect(
    screen.getByRole("checkbox", { name: "选择图片 3" }),
  ).not.toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "下载选中" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("选择输出尺寸 · 2 张")).toBeInTheDocument();
  expect(
    within(dialog).getByRole("button", { name: "确定并下载" }),
  ).toBeEnabled();
});
it("opens per-image controls without a run lock and sends edits only to that image", async () => {
  const onChange = vi.fn();
  render(
    <EngravingGallery
      results={[result("a"), result("b")]}
      onChange={onChange}
    />,
  );
  fireEvent.click(screen.getAllByRole("button", { name: "编辑图片" })[1]);
  const dialog = await screen.findByRole("dialog");
  expect(
    within(dialog).getByRole("slider", { name: "单张纹理" }),
  ).toBeEnabled();
  fireEvent.click(within(dialog).getByRole("switch"));
  expect(onChange).toHaveBeenCalledWith("b", { invert: true });
  expect(within(dialog).queryByText("本次风格参考")).not.toBeInTheDocument();
  expect(
    within(dialog).queryByRole("spinbutton", { name: "DPI" }),
  ).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: /^裁\s*剪$/ }));
  expect(within(dialog).getByLabelText("裁剪画布")).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "应用裁剪" }));
  expect(onChange).toHaveBeenCalledWith("b", {
    crop: { x: 0, y: 0, width: 1, height: 1 },
  });
  fireEvent.click(
    within(dialog).getAllByRole("button", { name: /下\s*载/ })[0],
  );
  await waitFor(() =>
    expect(screen.getByText("选择输出尺寸 · 1 张")).toBeInTheDocument(),
  );
}, 15000);

it("adopts a version from its score row and updates the cover", async () => {
  const a = result("a"),
    b = result("b");
  const onAdopt = vi.fn();
  const props = { results: [a, b], onChange: vi.fn(), onAdopt, compact: true };
  const view = render(<EngravingGallery {...props} />);
  expect(screen.getByText("第 2 张 · 未评分 · 共 2 张")).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "查看全部生成图片（2）" }),
  );
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "采用此图" }));
  expect(onAdopt).toHaveBeenCalledWith("a");
  view.rerender(<EngravingGallery {...props} coverJobId="a" />);
  expect(screen.getByText("第 1 张 · 未评分 · 共 2 张")).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "已采用" })).toBeDisabled();
});

it("shows a flagged image even when no automatic cover qualifies and retains edit/download access", async () => {
  const suspect = result("flagged");
  suspect.job.referenceSuspect = true;
  render(
    <EngravingGallery
      compact
      results={[suspect]}
      onChange={vi.fn()}
      onAdopt={vi.fn()}
    />,
  );
  expect(screen.getByAltText("封面生成结果")).toBeInTheDocument();
  expect(screen.getByText("疑似误用参考图")).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "查看全部生成图片（1）" }),
  );
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("疑似误用参考图")).toBeInTheDocument();
  expect(
    within(dialog).getByRole("button", { name: "编辑图片" }),
  ).toBeEnabled();
  expect(
    within(dialog).getByRole("button", { name: "下载全部" }),
  ).toBeEnabled();
  expect(
    within(dialog).getByRole("button", { name: "采用此图" }),
  ).toBeEnabled();
});

it('offers retry on a task card and each version, and disables all retry buttons while busy',async()=>{const retry=vi.fn();const props={compact:true,results:[result('a'),result('b')],onChange:vi.fn(),onRetry:retry};const view=render(<EngravingGallery {...props}/>);fireEvent.click(screen.getByRole('button',{name:/重\s*试/}));expect(retry).toHaveBeenCalledTimes(1);fireEvent.click(screen.getByRole('button',{name:'查看全部生成图片（2）'}));const dialog=await screen.findByRole('dialog');const buttons=within(dialog).getAllByRole('button',{name:/重\s*试/});expect(buttons).toHaveLength(2);fireEvent.click(buttons[1]);expect(retry).toHaveBeenCalledTimes(2);view.rerender(<EngravingGallery {...props} retryDisabled/>);screen.getAllByRole('button',{name:/重\s*试/}).forEach(b=>expect(b).toBeDisabled());});
