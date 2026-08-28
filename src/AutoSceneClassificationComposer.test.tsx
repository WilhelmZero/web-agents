import { App as AntApp } from "antd";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AutoSceneClassificationComposer from "./AutoSceneClassificationComposer";

describe("AutoSceneClassificationComposer", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders preset-group and folder-management controls", () => {
    render(
      <AntApp>
        <AutoSceneClassificationComposer
          apiKey=""
          openAiApiKey=""
          apiBaseUrl={null}
          connectionMode="direct"
          onRequestKey={vi.fn()}
        />
      </AntApp>,
    );
    expect(
      screen.getByRole("heading", { name: "自动分类场景替换" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /新增预设/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /移除全部文件夹/ }),
    ).toBeDisabled();
    expect(
      screen.getByText("多标签场景替换默认预设 · 6 个分类"),
    ).toBeInTheDocument();
    expect(screen.getByText("小烈酒杯")).toBeInTheDocument();
    expect(screen.getByText("其他杯型 / 按真实用途")).toBeInTheDocument();
  }, 15_000);

  it("loads one selected preset group containing multiple scene prompts", () => {
    localStorage.setItem(
      "scene-studio.scene-classification-preset-groups.v3",
      JSON.stringify([
        {
          id: "indoor",
          name: "室内场景预设",
          categories: [
            {
              id: "bar",
              name: "家庭酒吧",
              prompt: "替换为家庭酒吧场景",
              isFallback: true,
              updatedAt: 1,
            },
            {
              id: "kitchen",
              name: "厨房",
              prompt: "替换为厨房场景",
              isFallback: false,
              updatedAt: 2,
            },
          ],
          updatedAt: 2,
        },
      ]),
    );
    localStorage.setItem(
      "scene-studio.active-scene-classification-preset-group.v1",
      JSON.stringify("indoor"),
    );

    render(
      <AntApp>
        <AutoSceneClassificationComposer
          apiKey=""
          openAiApiKey=""
          apiBaseUrl={null}
          connectionMode="direct"
          onRequestKey={vi.fn()}
        />
      </AntApp>,
    );

    expect(screen.getByText("室内场景预设 · 2 个分类")).toBeInTheDocument();
    expect(screen.getByText("家庭酒吧")).toBeInTheDocument();
    expect(screen.getByText("厨房")).toBeInTheDocument();
    expect(screen.getByText("替换为家庭酒吧场景")).toBeInTheDocument();
    expect(screen.getByText("替换为厨房场景")).toBeInTheDocument();
  }, 15_000);

  it("defaults to Auto output sizing and offers AI prompt optimization", () => {
    localStorage.setItem(
      "scene-studio.scene-classification-preset-groups.v3",
      JSON.stringify([
        {
          id: "group",
          name: "测试预设",
          categories: [
            {
              id: "base",
              name: "基础分类",
              prompt: "替换场景",
              isFallback: true,
              updatedAt: 1,
            },
          ],
          updatedAt: 1,
        },
      ]),
    );
    const settingsHost = document.createElement("div");
    document.body.appendChild(settingsHost);
    render(
      <AntApp>
        <AutoSceneClassificationComposer
          apiKey=""
          openAiApiKey=""
          apiBaseUrl={null}
          connectionMode="direct"
          onRequestKey={vi.fn()}
          settingsHost={settingsHost}
        />
      </AntApp>,
    );
    expect(screen.getByText("Auto（脚本自动选择）")).toBeInTheDocument();
    const addCategory = screen
      .getAllByRole("button", { name: /新增分类/ })
      .find((button) => !button.hasAttribute("disabled"));
    expect(addCategory).toBeDefined();
    fireEvent.click(addCategory!);
    expect(screen.getByRole("button", { name: /AI 优化/ })).toBeDisabled();
    settingsHost.remove();
  }, 30_000);
});
