import { useEffect, useImperativeHandle, useMemo } from "react";
import {
  render,
  fireEvent,
  screen,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { it, expect, vi, afterEach } from "vitest";
import BatchEngravingComposer from "./BatchEngravingComposer";
import type { Preferences, SavedTask } from "../services/engraving/types";
import { DEFAULTS } from "../services/engraving/processing.mjs";
const calls = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  flush: vi.fn(async () => {}),
  busy: false,
}));
vi.mock("../CustomMonochromeLogoComposer", () => ({
  EngravingTaskComposer: ({
    initialFile,
    onTaskState,
    controllerRef,
    scope,
    workspaceActive,
    sharedPreferences,
    onSharedPreferencesChange,
    batchLocked,
  }: {
    initialFile?: File;
    onTaskState: (v: unknown) => void;
    controllerRef: React.Ref<unknown>;
    scope?: string;
    workspaceActive?: boolean;
    sharedPreferences: Preferences;
    onSharedPreferencesChange: (value: Preferences) => void;
    batchLocked?: boolean;
  }) => {
    const task = useMemo<SavedTask>(
      () => ({
        version: 1,
        fileName: initialFile?.name || "",
        original: initialFile,
        params: { ...DEFAULTS },
      }),
      [initialFile],
    );
    useEffect(
      () =>
        onTaskState({
          task,
          busy: calls.busy,
          importing: false,
          ready: !!initialFile,
          loaded: true,
        }),
      [task, onTaskState],
    );
    useImperativeHandle(controllerRef, () => ({
      start: async (preferences: Preferences) => {
        calls.start(scope || "default", preferences);
      },
      flush: () => calls.flush(),
      stop: () => calls.stop(scope || "default"),
    }));
    return (
      <>
        {workspaceActive && (
          <input
            aria-label="整批主体保留要求"
            value={sharedPreferences.instructions}
            disabled={batchLocked}
            onChange={(e) =>
              onSharedPreferencesChange({
                ...sharedPreferences,
                instructions: e.target.value,
              })
            }
          />
        )}
        <div>结果分组：{initialFile?.name || "空"}</div>
      </>
    );
  },
}));
afterEach(() => {
  cleanup();
  calls.busy = false;
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it("imports multiple files into distinct mounted tasks and starts each once", async () => {
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:qa"),
      revokeObjectURL: vi.fn(),
    }),
  );
  const view = render(
    <BatchEngravingComposer openAiApiKey="test" onConfigureKey={vi.fn()} />,
  );
  const input = view.container.querySelector("input[type=file]")!;
  await waitFor(() => expect(input).not.toBeDisabled());
  fireEvent.change(input, {
    target: {
      files: [
        new File(["a"], "A.png", { type: "image/png" }),
        new File(["b"], "B.png", { type: "image/png" }),
      ],
    },
  });
  await screen.findByRole("button", { name: "删除原照 A.png" });
  await screen.findByRole("button", { name: "删除原照 B.png" });
  expect(screen.queryByRole("button", { name: /切换任务/ })).toBeNull();
  fireEvent.change(screen.getByLabelText("整批主体保留要求"), {
    target: { value: "保留全部人物" },
  });
  fireEvent.click(screen.getByRole("button", { name: "全部生成" }));
  await waitFor(() => expect(calls.start).toHaveBeenCalledTimes(2));
  expect(new Set(calls.start.mock.calls.map((c) => c[0])).size).toBe(2);
  expect(
    calls.start.mock.calls.every((c) => c[1].instructions === "保留全部人物"),
  ).toBe(true);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "全部生成" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "全部生成" }));
  await waitFor(() => expect(calls.start).toHaveBeenCalledTimes(4));
  expect(calls.start.mock.calls.slice(2).map((c) => c[0])).toEqual(
    calls.start.mock.calls.slice(0, 2).map((c) => c[0]),
  );
  expect(
    JSON.parse(sessionStorage.getItem("custom-monochrome-logo:workspace:v1")!),
  ).toHaveLength(2);
}, 20000);

async function uploadPair() {
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:qa"),
      revokeObjectURL: vi.fn(),
    }),
  );
  const view = render(
    <BatchEngravingComposer openAiApiKey="test" onConfigureKey={vi.fn()} />,
  );
  const input = view.container.querySelector("input[type=file]")!;
  await waitFor(() => expect(input).not.toBeDisabled());
  fireEvent.change(input, {
    target: {
      files: [
        new File(["a"], "A.png", { type: "image/png" }),
        new File(["b"], "B.png", { type: "image/png" }),
      ],
    },
  });
  await screen.findByRole("button", { name: "删除原照 B.png" });
  return view;
}
it("removes selected photo, clears all into a fresh scope, and stays empty after reload", async () => {
  const view = await uploadPair();
  const key = "custom-monochrome-logo:workspace:v1";
  const originalIds = JSON.parse(sessionStorage.getItem(key)!);
  fireEvent.click(screen.getByRole("button", { name: "删除原照 B.png" }));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "删除原照 B.png" })).toBeNull(),
  );
  expect(screen.getByLabelText("整批主体保留要求")).toBeVisible();
  expect(calls.flush).toHaveBeenCalledTimes(1);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "全部删除" })).not.toHaveClass(
      "ant-btn-loading",
    ),
  );
  expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual([originalIds[0]]);
  fireEvent.click(screen.getByRole("button", { name: "全部删除" }));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "删除原照 A.png" })).toBeNull(),
  );
  const emptyIds = JSON.parse(sessionStorage.getItem(key)!);
  expect(emptyIds).toHaveLength(1);
  expect(originalIds).not.toContain(emptyIds[0]);
  expect(calls.flush).toHaveBeenCalledTimes(2);
  view.unmount();
  const again = render(
    <BatchEngravingComposer openAiApiKey="test" onConfigureKey={vi.fn()} />,
  );
  expect(screen.getByLabelText("整批主体保留要求")).toBeVisible();
  expect(screen.getByRole("button", { name: "全部删除" })).toBeDisabled();
  const input = again.container.querySelector("input[type=file]")!;
  await waitFor(() => expect(input).not.toBeDisabled());
  fireEvent.change(input, {
    target: { files: [new File(["c"], "C.png", { type: "image/png" })] },
  });
  await screen.findByRole("button", { name: "删除原照 C.png" });
  expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(emptyIds);
}, 20000);
it("keeps photos and workspace when saving before deletion fails", async () => {
  await uploadPair();
  const before = sessionStorage.getItem("custom-monochrome-logo:workspace:v1");
  calls.flush.mockRejectedValueOnce(new Error("storage failed"));
  fireEvent.click(screen.getByRole("button", { name: "全部删除" }));
  await screen.findByText("未能保存任务或工作区列表，图片尚未删除，请重试。");
  expect(screen.getByRole("button", { name: "删除原照 A.png" })).toBeVisible();
  expect(screen.getByRole("button", { name: "删除原照 B.png" })).toBeVisible();
  expect(sessionStorage.getItem("custom-monochrome-logo:workspace:v1")).toBe(
    before,
  );
}, 20000);
it("disables removal while a task is generating", async () => {
  calls.busy = true;
  await uploadPair();
  expect(screen.getByRole("button", { name: "删除原照 A.png" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "全部删除" })).toBeDisabled();
  expect(calls.flush).not.toHaveBeenCalled();
}, 20000);

it("has one shared settings form and retains every result group", async () => {
  await uploadPair();
  expect(screen.getAllByLabelText("整批主体保留要求")).toHaveLength(1);
  expect(screen.getByText("结果分组：A.png")).toBeVisible();
  expect(screen.getByText("结果分组：B.png")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: /切换任务|当前任务/ }),
  ).toBeNull();
  expect(
    screen.getByRole("spinbutton", { name: "同时处理任务数" }),
  ).toHaveAttribute("aria-valuemax", "20");
}, 20000);
