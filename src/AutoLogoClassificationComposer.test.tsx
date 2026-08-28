import { App as AntApp } from "antd";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AutoLogoClassificationComposer from "./AutoLogoClassificationComposer";

describe("AutoLogoClassificationComposer", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders the standalone pipeline and defaults Logo count analysis off", () => {
    render(
      <AntApp>
        <AutoLogoClassificationComposer
          apiKey=""
          openAiApiKey=""
          apiBaseUrl={null}
          connectionMode="direct"
          onRequestKey={vi.fn()}
        />
      </AntApp>,
    );
    expect(
      screen.getByRole("heading", { name: "自动分类 Logo 替换" }),
    ).toBeInTheDocument();
    expect(screen.getByText("分析 Logo 个数")).toBeInTheDocument();
    expect(screen.getAllByRole("switch")[0]).not.toBeChecked();
    expect(
      screen.getByRole("button", { name: /开始自动分类并替换/ }),
    ).toBeInTheDocument();
  }, 15_000);

  it("loads one selected preset group containing multiple category prompts", () => {
    localStorage.setItem(
      "scene-studio.logo-classification-preset-groups.v2",
      JSON.stringify([
        {
          id: "cups",
          name: "杯具预设",
          categories: [
            {
              id: "glass",
              name: "玻璃杯",
              prompt: "替换玻璃杯 Logo",
              isFallback: true,
              updatedAt: 1,
            },
            {
              id: "steel",
              name: "不锈钢杯",
              prompt: "替换不锈钢杯 Logo",
              isFallback: false,
              updatedAt: 2,
            },
          ],
          updatedAt: 2,
        },
      ]),
    );
    localStorage.setItem(
      "scene-studio.active-logo-classification-preset-group.v1",
      JSON.stringify("cups"),
    );

    render(
      <AntApp>
        <AutoLogoClassificationComposer
          apiKey=""
          openAiApiKey=""
          apiBaseUrl={null}
          connectionMode="direct"
          onRequestKey={vi.fn()}
        />
      </AntApp>,
    );

    expect(screen.getByText("杯具预设 · 2 个分类")).toBeInTheDocument();
    expect(screen.getByText("玻璃杯")).toBeInTheDocument();
    expect(screen.getByText("不锈钢杯")).toBeInTheDocument();
    expect(screen.getByText("替换玻璃杯 Logo")).toBeInTheDocument();
    expect(screen.getByText("替换不锈钢杯 Logo")).toBeInTheDocument();
  }, 15_000);
});
