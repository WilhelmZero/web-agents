import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import CupWrapLocalAdapter from "./CupWrapLocalAdapter";
import { DEFAULT_CUP } from "./services/cupWrap/geometry";
import type { LocalAdaptation } from "./services/cupWrap/types";

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

it("shows row dividers and supports right-click duplicate and delete", () => {
  const blob = new Blob(["subject"], { type: "image/png" }),
    initial: LocalAdaptation = {
      sourceWidth: 200,
      sourceHeight: 160,
      background: "#ffffff",
      confidence: 1,
      objects: [
        {
          id: "ghost",
          blob,
          rect: { x: 20, y: 20, width: 60, height: 70 },
          role: "main",
        },
      ],
      layers: [
        {
          id: "ghost-instance",
          blob,
          sourceObjectId: "ghost",
          x: 50,
          y: 50,
          width: 20,
          rotation: 0,
          locked: true,
        },
      ],
      fill: 0,
      gap: 1,
      scale: 1,
      seed: 1,
      pathMode: "manual",
      pathCount: 3,
      pathAverageHeight: 20,
      pathGap: 1,
      itemGap: 1,
      showPaths: true,
      backgroundMode: "white",
      backgroundColor: "#ffffff",
      cupKey: JSON.stringify(DEFAULT_CUP),
      unplaced: [],
    };
  render(
    <CupWrapLocalAdapter
      source={blob}
      cup={DEFAULT_CUP}
      initial={initial}
      onClose={vi.fn()}
      onApply={vi.fn()}
    />,
  );

  const preview = screen.getByLabelText("本地排布预览"),
    pathInput = screen.getByText("路径条数").closest("label")!.querySelector("input")!;
  expect(pathInput).toHaveValue("3");
  expect(preview.querySelectorAll("polyline")).toHaveLength(2);

  fireEvent.contextMenu(preview.querySelector("image")!, {
    clientX: 100,
    clientY: 120,
  });
  fireEvent.click(screen.getByRole("button", { name: "复制主体" }));
  expect(preview.querySelectorAll("image")).toHaveLength(2);

  fireEvent.contextMenu(preview.querySelector("image")!, {
    clientX: 100,
    clientY: 120,
  });
  fireEvent.click(screen.getByRole("button", { name: "删除主体" }));
  expect(preview.querySelectorAll("image")).toHaveLength(1);
});
