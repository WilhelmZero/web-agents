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
import type { SavedTask } from "../services/engraving/types";
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
  }: {
    initialFile?: File;
    onTaskState: (v: unknown) => void;
    controllerRef: React.Ref<unknown>;
    scope?: string;
    workspaceActive?: boolean;
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
      start: async () => {
        calls.start(scope || "default");
      },
      flush: () => calls.flush(),
      stop: () => calls.stop(scope || "default"),
    }));
    return <div hidden={!workspaceActive}>编辑任务：{initialFile?.name || "空"}</div>;
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
  await screen.findByRole("button", { name: "切换任务 A.png" });
  await screen.findByRole("button", { name: "切换任务 B.png" });
  expect(screen.getByText("编辑任务：B.png")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "切换任务 A.png" }));
  expect(screen.getByText("编辑任务：A.png")).toBeVisible();
  expect(screen.getByText("编辑任务：B.png")).not.toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "全部生成" }));
  await waitFor(() => expect(calls.start).toHaveBeenCalledTimes(2));
  expect(new Set(calls.start.mock.calls.map((c) => c[0])).size).toBe(2);
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
    expect(screen.queryByRole("button", { name: "切换任务 B.png" })).toBeNull(),
  );
  expect(screen.getByText("编辑任务：A.png")).toBeVisible();
  expect(calls.flush).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.getByRole("button", {name:"全部删除"})).not.toHaveClass("ant-btn-loading"));
  expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual([originalIds[0]]);
  fireEvent.click(screen.getByRole("button", { name: "全部删除" }));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "切换任务 A.png" })).toBeNull(),
  );
  const emptyIds = JSON.parse(sessionStorage.getItem(key)!);
  expect(emptyIds).toHaveLength(1);
  expect(originalIds).not.toContain(emptyIds[0]);
  expect(calls.flush).toHaveBeenCalledTimes(2);
  view.unmount();
  const again = render(
    <BatchEngravingComposer openAiApiKey="test" onConfigureKey={vi.fn()} />,
  );
  expect(screen.getByText("编辑任务：空")).toBeVisible();
  expect(screen.getByRole("button", { name: "全部删除" })).toBeDisabled();
  const input = again.container.querySelector("input[type=file]")!;
  await waitFor(() => expect(input).not.toBeDisabled());
  fireEvent.change(input, {
    target: { files: [new File(["c"], "C.png", { type: "image/png" })] },
  });
  await screen.findByRole("button", { name: "切换任务 C.png" });
  expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(emptyIds);
}, 20000);
it("keeps photos and workspace when saving before deletion fails", async () => {
  await uploadPair();
  const before = sessionStorage.getItem("custom-monochrome-logo:workspace:v1");
  calls.flush.mockRejectedValueOnce(new Error("storage failed"));
  fireEvent.click(screen.getByRole("button", { name: "全部删除" }));
  await screen.findByText("未能保存任务或工作区列表，图片尚未删除，请重试。");
  expect(screen.getByRole("button", { name: "切换任务 A.png" })).toBeVisible();
  expect(screen.getByRole("button", { name: "切换任务 B.png" })).toBeVisible();
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
