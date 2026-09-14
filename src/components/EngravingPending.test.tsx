import { it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import EngravingGallery from "./EngravingGallery";
afterEach(cleanup);
it("shows a pending card without counting it as an exportable result, and removes it after completion", () => {
  const view = render(
    <EngravingGallery results={[]} onChange={vi.fn()} pending="正在生成图片" />,
  );
  expect(screen.getByLabelText("正在生成的图片")).toBeVisible();
  expect(screen.getByText("正在生成图片")).toBeVisible();
  expect(screen.getByText("生成结果 · 0 张")).toBeVisible();
  expect(screen.getByRole("button", { name: "下载所选" })).toBeDisabled();
  view.rerender(<EngravingGallery results={[]} onChange={vi.fn()} />);
  expect(screen.queryByLabelText("正在生成的图片")).toBeNull();
});
