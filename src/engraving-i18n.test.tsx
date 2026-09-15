import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useState } from "react";
import { createPortal } from "react-dom";
import { LanguageProvider, useLanguage } from "./i18n";
import { translateEngravingText } from "./engraving-i18n";
afterEach(() => {
  cleanup();
  localStorage.clear();
});
function Fixture() {
  const { language, setLanguage } = useLanguage();
  const [round, setRound] = useState(1);
  return (
    <>
      <button
        onClick={() => setLanguage(language === "en-US" ? "zh-CN" : "en-US")}
      >
        switch
      </button>
      <button onClick={() => setRound((v) => v + 1)}>next</button>
      <h2>雕刻设置</h2>
      <p role="status">{"第 " + round + " 次生成中"}</p>
      <input
        aria-label="主体保留要求"
        placeholder={round === 1 ? "选择或输入图片模型" : "主体保留要求"}
        defaultValue="生成结果"
      />
      <span translate="no">生成结果</span>
      {createPortal(<div role="dialog">添加文字与画布排版</div>, document.body)}
    </>
  );
}
it("translates dynamic progress, portals and attributes and restores Chinese without changing user text", async () => {
  localStorage.setItem("scene-studio-language", "en-US");
  render(
    <LanguageProvider>
      <Fixture />
    </LanguageProvider>,
  );
  expect(
    await screen.findByRole("heading", { name: "Engraving settings" }),
  ).toBeVisible();
  expect(screen.getByRole("dialog")).toHaveTextContent(
    "Text and canvas layout",
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "Generating · attempt 1",
  );
  expect(
    screen.getByRole("textbox", { name: "Subject preservation instructions" }),
  ).toHaveValue("生成结果");
  expect(screen.getByText("生成结果")).toHaveAttribute("translate", "no");
  fireEvent.click(screen.getByText("next"));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      "Generating · attempt 2",
    ),
  );
  await waitFor(() =>
    expect(screen.getByRole("textbox")).toHaveAttribute(
      "placeholder",
      "Subject preservation instructions",
    ),
  );
  fireEvent.click(screen.getByText("switch"));
  expect(
    await screen.findByRole("heading", { name: "雕刻设置" }),
  ).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("第 2 次生成中");
  expect(screen.getByRole("dialog")).toHaveTextContent("添加文字与画布排版");
  expect(localStorage.getItem("scene-studio-language")).toBe("zh-CN");
});
it("translates score, round and export size while retaining user filename text", () => {
  expect(translateEngravingText("第 2 张 · 93 分 · 共 5 张")).toBe(
    "Version 2 · 93 points · 5 images",
  );
  expect(translateEngravingText("第 3/5 轮：基于第 1 版继续优化")).toBe(
    "Round 3/5: Continuing from version 1",
  );
  expect(translateEngravingText("选择输出尺寸 · 4 张")).toBe(
    "Output size · 4 images",
  );
  expect(translateEngravingText("选择结果 生成结果.png")).toBe(
    "Select result 生成结果.png",
  );
});
