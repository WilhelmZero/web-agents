import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
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

it("shows row dividers and supports right-click duplicate and delete", async () => {
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
        {
          id: "star",
          blob,
          rect: { x: 100, y: 20, width: 12, height: 12 },
          role: "decoration",
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
      pathOffsets: [0, 2, 0],
      itemGap: 1,
      showPaths: true,
      backgroundMode: "white",
      backgroundColor: "#ffffff",
      cupKey: JSON.stringify(DEFAULT_CUP),
      unplaced: ["ghost"],
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
    pathInput = screen
      .getByText("路径条数")
      .closest("label")!
      .querySelector("input")!;
  expect(pathInput).toHaveValue("3");
  expect(preview.querySelectorAll("polyline")).toHaveLength(2);
  expect(screen.getByText("路径 2 偏移 mm")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "智能填充小装饰" }),
  ).toBeEnabled();
  expect(
    screen.getByRole("button", { name: "采用无损排布" }),
  ).toBeEnabled();
  expect(screen.getByText("物体 1（60×70px）")).toBeInTheDocument();

  fireEvent.drop(preview, {
    clientX: 80,
    clientY: 80,
    dataTransfer: { getData: () => "ghost" },
  });
  expect(preview.querySelectorAll("image")).toHaveLength(2);
  expect(
    within(document.querySelector(".cup-local-layer-editor")!).getAllByRole(
      "slider",
    ),
  ).toHaveLength(4);
  const panel = screen.getByLabelText("本地排布图层"),
    rows = Array.from(panel.querySelectorAll<HTMLElement>("[data-layer-id]"));
  expect(rows).toHaveLength(2);
  const firstId = rows[0].dataset.layerId!,
    dragData: Record<string, string> = {};
  fireEvent.dragStart(rows[0], {
    dataTransfer: {
      effectAllowed: "move",
      setData: (type: string, value: string) => {
        dragData[type] = value;
      },
    },
  });
  fireEvent.drop(rows[1], {
    dataTransfer: {
      dropEffect: "move",
      getData: (type: string) => dragData[type],
    },
  });
  expect(
    panel.querySelector<HTMLElement>("[data-layer-id]")?.dataset.layerId,
  ).not.toBe(firstId);

  fireEvent.click(screen.getByRole("button", { name: "锁定全部" }));
  for (const control of within(panel).getAllByRole("switch", {
    name: /锁定图层/,
  }))
    expect(control).toHaveAttribute("aria-checked", "true");
  fireEvent.click(screen.getByRole("button", { name: "解锁全部" }));
  for (const control of within(panel).getAllByRole("switch", {
    name: /锁定图层/,
  }))
    expect(control).toHaveAttribute("aria-checked", "false");

  fireEvent.click(
    within(
      panel.querySelector<HTMLElement>(`[data-layer-id="${firstId}"]`)!,
    ).getByRole("switch", { name: /锁定图层/ }),
  );
  for (const slider of within(
    document.querySelector(".cup-local-layer-editor")!,
  ).getAllByRole("slider"))
    expect(slider).toHaveAttribute("aria-disabled", "true");
  fireEvent.click(
    within(
      panel.querySelector<HTMLElement>(`[data-layer-id="${firstId}"]`)!,
    ).getByRole("switch", { name: /锁定图层/ }),
  );

  const bottomImage = preview.querySelector("image")!,
    bottomId = bottomImage.getAttribute("data-layer-id")!;
  fireEvent.contextMenu(bottomImage, {
    clientX: 100,
    clientY: 120,
  });
  fireEvent.click(screen.getByRole("button", { name: "移到最顶层" }));
  expect(
    panel.querySelector<HTMLElement>("[data-layer-id]")?.dataset.layerId,
  ).toBe(bottomId);

  fireEvent.contextMenu(preview.querySelector("image")!, {
    clientX: 100,
    clientY: 120,
  });
  fireEvent.click(screen.getByRole("button", { name: "复制主体" }));
  expect(preview.querySelectorAll("image")).toHaveLength(3);

  fireEvent.contextMenu(preview.querySelector("image")!, {
    clientX: 100,
    clientY: 120,
  });
  fireEvent.click(screen.getByRole("button", { name: "删除主体" }));
  expect(preview.querySelectorAll("image")).toHaveLength(2);

  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(
    (await screen.findAllByText("确认关闭无损元素排版？")).length,
  ).toBeGreaterThan(0);
  fireEvent.click(
    screen.getAllByRole("button", { name: "继续编辑" }).at(-1)!,
  );
}, 20_000);
