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
  });
});
